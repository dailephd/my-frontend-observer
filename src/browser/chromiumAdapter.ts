import { chromium, type Browser } from 'playwright';
import type { NormalizedObservationRequest } from '../request/request.js';
import type { Diagnostic, DiagnosticCode } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import type { EvidenceField } from '../domain/evidence.js';
import type { TargetEvidenceRecord } from '../domain/schema.js';
import { classifyUrl, classifyRedirect, classifySubresource, classifyPopup, classifyDownload } from '../safety/policy.js';
import { capturePageEvidence, captureTargetEvidence } from './evidenceCapture.js';
import type { BrowserCaptureResult, BrowserProvenance } from './types.js';

export type { BrowserCaptureResult, BrowserProvenance } from './types.js';

function diagnostic(code: DiagnosticCode, message: string): Diagnostic {
  return { code, severity: DIAGNOSTIC_SEVERITY[code], message };
}

function classifyNavigationError(error: unknown, readinessTimeoutMs: number): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return diagnostic('readiness-timeout', `readiness condition not reached within ${readinessTimeoutMs}ms: ${message}`);
  }
  return diagnostic('navigation-failure', `navigation failed: ${message}`);
}

export interface CaptureViewportInternalResult {
  result: BrowserCaptureResult;
  /** True if the launched browser process is still connected after cleanup ran. Always false unless cleanup failed. */
  browserConnected: boolean;
}

/**
 * Owns the entire launch -> context -> page -> navigate -> ready -> screenshot
 * -> close lifecycle for one capture. Guarantees `browser.close()` runs on
 * every exit path (success, safety rejection, navigation/readiness failure,
 * or an unexpected internal error), so callers never manage cleanup
 * themselves. Exported (not re-exported from src/index.ts or the application
 * seam) only so integration tests can assert `browserConnected` becomes
 * false after every call - the Browser handle itself never leaves this
 * module.
 */
export async function captureViewportInternal(request: NormalizedObservationRequest): Promise<CaptureViewportInternalResult> {
  const initialDecision = classifyUrl(request.targetUrl);
  if (!initialDecision.allowed) {
    return { result: { ok: false, diagnostics: [initialDecision.diagnostic] }, browserConnected: false };
  }

  let browser: Browser | undefined;
  let result: BrowserCaptureResult;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: request.viewport.width, height: request.viewport.height },
    });
    const page = await context.newPage();

    const diagnostics: Diagnostic[] = [];
    page.on('popup', () => diagnostics.push(classifyPopup()));
    page.on('download', () => diagnostics.push(classifyDownload()));

    let lastAllowedMainFrameUrl = request.targetUrl;
    let rejection: Diagnostic | undefined;

    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const isMainFrameNavigation = req.isNavigationRequest() && req.frame() === page.mainFrame();

      if (!isMainFrameNavigation) {
        const decision = classifySubresource(url);
        if (!decision.allowed) {
          rejection = rejection ?? decision.diagnostic;
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }
        await route.continue().catch(() => undefined);
        return;
      }

      // Chromium follows navigation redirects internally without re-emitting a
      // routable request per hop, so each main-frame hop is fetched manually
      // (maxRedirects: 0) and inspected here before any further hop is
      // allowed to proceed - this is what lets a prohibited redirect target
      // be blocked before it is ever contacted.
      const decision = url === lastAllowedMainFrameUrl ? ({ allowed: true } as const) : classifyRedirect(lastAllowedMainFrameUrl, url);
      if (!decision.allowed) {
        rejection = rejection ?? decision.diagnostic;
        await route.fulfill({ status: 204, body: '' }).catch(() => undefined);
        return;
      }
      lastAllowedMainFrameUrl = url;

      let response;
      try {
        response = await route.fetch({ maxRedirects: 0 });
      } catch {
        await route.abort('failed').catch(() => undefined);
        return;
      }

      const status = response.status();
      if (status >= 300 && status < 400) {
        const location = response.headers()['location'];
        const resolvedUrl = location ? new URL(location, url).toString() : undefined;
        const redirectDecision = resolvedUrl ? classifyRedirect(lastAllowedMainFrameUrl, resolvedUrl) : ({ allowed: true } as const);
        if (!redirectDecision.allowed) {
          rejection = rejection ?? redirectDecision.diagnostic;
          await route.fulfill({ status: 204, body: '' }).catch(() => undefined);
          return;
        }
      }
      await route.fulfill({ response }).catch(() => undefined);
    });

    let navigationError: unknown;
    try {
      await page.goto(request.targetUrl, {
        waitUntil: request.readiness.condition,
        timeout: request.readiness.timeoutMs,
      });
    } catch (err) {
      navigationError = err;
    }

    if (rejection) {
      result = { ok: false, diagnostics: [rejection, ...diagnostics] };
    } else if (navigationError) {
      result = { ok: false, diagnostics: [...diagnostics, classifyNavigationError(navigationError, request.readiness.timeoutMs)] };
    } else {
      // Captured from the same live page, after the same readiness point, as
      // required by Batch 3: no second browser/page is ever opened.
      const screenshotBuffer = await page.screenshot({ type: 'png' });
      const provenance: BrowserProvenance = { engine: 'chromium', version: browser.version() };

      let pageEvidence: Record<string, EvidenceField<unknown>>;
      try {
        pageEvidence = await capturePageEvidence(page, request.targetUrl, request.viewport);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        diagnostics.push(diagnostic('browser-evidence-unavailable', `page evidence collection failed: ${message}`));
        pageEvidence = {};
      }

      let targetEvidence: Record<string, TargetEvidenceRecord>;
      try {
        const captured = await captureTargetEvidence(page, request.targets);
        targetEvidence = captured.targetEvidence;
        diagnostics.push(...captured.diagnostics);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        diagnostics.push(diagnostic('browser-evidence-unavailable', `target evidence collection failed: ${message}`));
        targetEvidence = {};
      }

      result = { ok: true, provenance, screenshot: new Uint8Array(screenshotBuffer), pageEvidence, targetEvidence, diagnostics };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { ok: false, diagnostics: [diagnostic('browser-runtime-failure', `unexpected browser failure: ${message}`)] };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }

  return { result, browserConnected: browser ? browser.isConnected() : false };
}

/** Observer-facing entrypoint: no Playwright object is reachable from its signature or return value. */
export async function captureViewport(request: NormalizedObservationRequest): Promise<BrowserCaptureResult> {
  const { result } = await captureViewportInternal(request);
  return result;
}
