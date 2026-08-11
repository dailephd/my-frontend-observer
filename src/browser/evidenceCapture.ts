import type { Page } from 'playwright';
import type { EvidenceField } from '../domain/evidence.js';
import type { Diagnostic, DiagnosticCode } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import type { NamedTarget, Viewport } from '../request/request.js';
import type { TargetEvidenceRecord, TargetGeometry, TargetComputedStyle, TargetLayoutMetrics } from '../domain/schema.js';

function diagnostic(code: DiagnosticCode, message: string, targetName?: string): Diagnostic {
  const base: Diagnostic = { code, severity: DIAGNOSTIC_SEVERITY[code], message };
  return targetName === undefined ? base : { ...base, targetName };
}

function browserField<T>(value: T): EvidenceField<T> {
  return { state: 'available', source: 'browser', value };
}

function derivedField<T>(value: T, derivedFrom: string[]): EvidenceField<T> {
  return { state: 'available', source: 'derived', value, derivedFrom };
}

function computedField<T>(value: T): EvidenceField<T> {
  return { state: 'available', source: 'computed-browser', value };
}

function unavailableField<T>(reason: string): EvidenceField<T> {
  return { state: 'unavailable', reason };
}

interface RawDocumentMetrics {
  title: string;
  windowScrollX: number;
  windowScrollY: number;
  documentScrollWidth: number;
  documentScrollHeight: number;
  documentClientWidth: number;
  documentClientHeight: number;
}

/**
 * Captures the v0.1 minimum page evidence (docs/PROJECT_MILESTONES.md
 * "Minimum page evidence") from the already-navigated, already-ready page.
 * `documentWidth`/`documentHeight` are the one explicitly *derived* pair -
 * max(scroll, client) in each axis - everything else is a direct browser
 * read, per the Batch 1 evidence-source model.
 */
export async function capturePageEvidence(
  page: Page,
  requestedUrl: string,
  viewport: Viewport,
): Promise<Record<string, EvidenceField<unknown>>> {
  const raw: RawDocumentMetrics = await page.evaluate(() => ({
    title: document.title,
    windowScrollX: window.scrollX,
    windowScrollY: window.scrollY,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentScrollHeight: document.documentElement.scrollHeight,
    documentClientWidth: document.documentElement.clientWidth,
    documentClientHeight: document.documentElement.clientHeight,
  }));

  const documentWidth = Math.max(raw.documentScrollWidth, raw.documentClientWidth);
  const documentHeight = Math.max(raw.documentScrollHeight, raw.documentClientHeight);

  return {
    requestedUrl: browserField(requestedUrl),
    finalUrl: browserField(page.url()),
    title: browserField(raw.title),
    viewportWidth: browserField(viewport.width),
    viewportHeight: browserField(viewport.height),
    devicePixelRatio: browserField(await page.evaluate(() => window.devicePixelRatio)),
    documentScrollWidth: browserField(raw.documentScrollWidth),
    documentScrollHeight: browserField(raw.documentScrollHeight),
    documentClientWidth: browserField(raw.documentClientWidth),
    documentClientHeight: browserField(raw.documentClientHeight),
    documentWidth: derivedField(documentWidth, ['documentScrollWidth', 'documentClientWidth']),
    documentHeight: derivedField(documentHeight, ['documentScrollHeight', 'documentClientHeight']),
    windowScrollX: browserField(raw.windowScrollX),
    windowScrollY: browserField(raw.windowScrollY),
  };
}

/**
 * Extracts only the target element's own role/name from a Playwright
 * `ariaSnapshot()` string (e.g. `- button "Click me"`), never its
 * descendants - bounded, target-local semantic evidence, not an
 * accessibility-tree dump. A generic `- text: ...` line (no distinct ARIA
 * role) or an empty snapshot both mean "no reliable role/name", not a role
 * of "text".
 */
function parseAriaSnapshotFirstLine(snapshot: string): { role?: string; name?: string } | undefined {
  const firstLine = snapshot.split('\n')[0]?.trim();
  if (!firstLine) return undefined;
  const match = /^-\s+([A-Za-z][\w-]*)\s*(?:"([^"]*)")?:?$/.exec(firstLine);
  if (!match) return undefined;
  const role = match[1];
  const name = match[2];
  if (role === undefined || role === 'text') return undefined;
  return name !== undefined && name.length > 0 ? { role, name } : { role };
}

interface RawTargetMeasurement {
  tag: string;
  geometry: TargetGeometry;
  style: TargetComputedStyle;
  layout: TargetLayoutMetrics;
  computedVisibility: string;
}

function missingTargetRecord(): TargetEvidenceRecord {
  const reason = 'target selector matched no element';
  return {
    resolution: { state: 'available', source: 'derived', value: { selectionMethod: 'css-selector', selectionStatus: 'not-found' }, derivedFrom: ['selector-query'] },
    tag: unavailableField(reason),
    geometry: unavailableField(reason),
    style: unavailableField(reason),
    layout: unavailableField(reason),
    visibility: unavailableField(reason),
    semantics: unavailableField(reason),
  };
}

function ambiguousTargetRecord(matchCount: number): TargetEvidenceRecord {
  const reason = `target selector matched ${matchCount} elements; expected exactly one`;
  return {
    resolution: { state: 'available', source: 'derived', value: { selectionMethod: 'css-selector', selectionStatus: 'ambiguous' }, derivedFrom: ['selector-query'] },
    tag: unavailableField(reason),
    geometry: unavailableField(reason),
    style: unavailableField(reason),
    layout: unavailableField(reason),
    visibility: unavailableField(reason),
    semantics: unavailableField(reason),
  };
}

/**
 * Captures the v0.1 minimum target evidence for one resolved (single-match)
 * target element, from the same live page/readiness state as the page
 * evidence and screenshot. Role/name come from Playwright's real
 * accessibility tree (`page.accessibility.snapshot`), not a hand-rolled
 * approximation; when the browser cannot supply them reliably for this
 * element, they are reported `unavailable` rather than guessed.
 */
async function captureResolvedTargetRecord(page: Page, selector: string): Promise<TargetEvidenceRecord> {
  const handle = await page.$(selector);
  if (!handle) return missingTargetRecord();

  try {
    const raw: RawTargetMeasurement = await handle.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const computed = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        geometry: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        style: { display: computed.display, position: computed.position, overflowX: computed.overflowX, overflowY: computed.overflowY },
        layout: {
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
        },
        computedVisibility: computed.visibility,
      };
    });

    const visible = raw.style.display !== 'none' && raw.computedVisibility !== 'hidden' && raw.geometry.width > 0 && raw.geometry.height > 0;

    let semantics: EvidenceField<{ role?: string; name?: string }>;
    try {
      const snapshot = await page.locator(selector).ariaSnapshot();
      const parsed = parseAriaSnapshotFirstLine(snapshot);
      semantics = parsed ? computedField(parsed) : unavailableField('no distinct accessible role/name is exposed for this target');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      semantics = unavailableField(`accessibility snapshot failed: ${message}`);
    }

    return {
      resolution: {
        state: 'available',
        source: 'derived',
        value: { selectionMethod: 'css-selector', selectionStatus: 'matched' },
        derivedFrom: ['selector-query'],
      },
      tag: browserField(raw.tag),
      geometry: browserField(raw.geometry),
      style: computedField(raw.style),
      layout: browserField(raw.layout),
      visibility: derivedField({ visible }, ['style.display', 'computed-visibility', 'geometry.width', 'geometry.height']),
      semantics,
    };
  } finally {
    await handle.dispose();
  }
}

export interface TargetEvidenceCaptureResult {
  targetEvidence: Record<string, TargetEvidenceRecord>;
  diagnostics: Diagnostic[];
}

/** Observes every explicitly configured Batch 1 target from the same live page, honoring the 0/1/many cardinality contract. */
export async function captureTargetEvidence(page: Page, targets: readonly NamedTarget[]): Promise<TargetEvidenceCaptureResult> {
  const targetEvidence: Record<string, TargetEvidenceRecord> = {};
  const diagnostics: Diagnostic[] = [];

  for (const target of targets) {
    const matchCount = await page.evaluate((selector) => document.querySelectorAll(selector).length, target.selector);

    if (matchCount === 0) {
      targetEvidence[target.name] = missingTargetRecord();
      diagnostics.push(diagnostic('target-missing', `no element matched selector for target "${target.name}"`, target.name));
      continue;
    }

    if (matchCount > 1) {
      targetEvidence[target.name] = ambiguousTargetRecord(matchCount);
      diagnostics.push(diagnostic('target-ambiguous', `${matchCount} elements matched selector for target "${target.name}"`, target.name));
      continue;
    }

    try {
      targetEvidence[target.name] = await captureResolvedTargetRecord(page, target.selector);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = `target evaluation failed: ${message}`;
      targetEvidence[target.name] = {
        resolution: {
          state: 'available',
          source: 'derived',
          value: { selectionMethod: 'css-selector', selectionStatus: 'matched' },
          derivedFrom: ['selector-query'],
        },
        tag: unavailableField(reason),
        geometry: unavailableField(reason),
        style: unavailableField(reason),
        layout: unavailableField(reason),
        visibility: unavailableField(reason),
        semantics: unavailableField(reason),
      };
      diagnostics.push(diagnostic('browser-evidence-unavailable', reason, target.name));
    }
  }

  return { targetEvidence, diagnostics };
}
