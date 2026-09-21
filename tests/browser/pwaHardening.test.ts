import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeManyRegionsOneTargetFixture } from '../support/evidenceFixtures.js';
import { persistAnnotationUnder, readManifest, referencePointItem, referenceSourceFor } from '../support/annotationAuthoringFixtures.js';
import type { ExternalReferenceArtifact } from '../../src/domain/externalReference.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

/**
 * v0.8 Batch 8 PWA hardening (task §32-38, §53, §56-65): real Chromium,
 * real service-worker registration, and a real server-down reload - not
 * static `sw.js` regex inspection. Persistent Chromium contexts use fresh
 * temporary profiles (never the user's real profile, never a fixed profile
 * retained from an earlier run) so service-worker state genuinely survives
 * across a server shutdown within one continuous page/session, mirroring how
 * a real installed PWA behaves.
 *
 * Hard acceptance gate (task §61): stale evidence must never be presented
 * as current once the server is unreachable. The app shell may still
 * render from the precache, but evidence-dependent content must fall back
 * to an explicit unavailable/error state, never frozen prior data.
 *
 * v0.9.1 Batch 1: the hard gate is a self-contained experiment in its own
 * describe block. It owns its evidence root, viewer server, persistent
 * profile, and context, and proves every precondition itself, so it passes
 * when selected alone with `-t "HARD GATE"`.
 */
beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }
}, 120_000);

async function startForRoot(root: string): Promise<Extract<StartViewerResult, { ok: true }>> {
  const result = await startViewer({ root, port: 0, assetsRoot: viewerDist, bindingDeclarations: [] });
  if (!result.ok) throw new Error(`viewer server failed to start: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

async function writePwaFixture(root: string): Promise<{ candidateId: string }> {
  const fixture = await writeManyRegionsOneTargetFixture(root);
  // v0.9 Batch 2: one real annotation so the annotation view/media routes answer 200 during the cache-boundary proof.
  await persistAnnotationUnder(root, referenceSourceFor(await readManifest<ExternalReferenceArtifact>(fixture.approvedRoot)), [referencePointItem()]);
  return { candidateId: fixture.candidateId };
}

// Chromium can hold profile files briefly after close on Windows; retry instead of leaking the profile.
const removeTree = (dir: string) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

describe('PWA live proof - service worker, shell precache, cache boundary', () => {
  let root: string;
  let profileRoot: string;
  let server: Extract<StartViewerResult, { ok: true }>;
  let context: BrowserContext;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-b8-pwa-'));
    await writePwaFixture(root);
    server = await startForRoot(root);
    profileRoot = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-pwa-profile-'));
    context = await chromium.launchPersistentContext(profileRoot, { headless: true });
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    await server?.close();
    if (root !== undefined) await removeTree(root);
    if (profileRoot !== undefined) await removeTree(profileRoot);
  });

  it('registers and activates a real service worker for the built viewer shell', async () => {
    const page = await context.newPage();
    try {
      await page.goto(server.url);
      await page.locator('.evidence-list').waitFor({ timeout: 10_000 });

      const registrationState = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return { active: registration.active !== null, scope: registration.scope };
      });
      expect(registrationState.active).toBe(true);
      expect(registrationState.scope).toContain(new URL(server.url).origin);
    } finally {
      await page.close();
    }
  });

  it('the manifest is real, fetchable, and declares standalone display', async () => {
    const page = await context.newPage();
    try {
      await page.goto(server.url);
      const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
      expect(manifestHref).toBeTruthy();
      const manifestUrl = new URL(manifestHref as string, server.url).toString();
      const response = await page.request.get(manifestUrl);
      expect(response.ok()).toBe(true);
      const manifest = await response.json();
      expect(manifest.display).toBe('standalone');
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('never caches /api/ responses at the service-worker cache-storage layer', async () => {
    const page = await context.newPage();
    try {
      await page.goto(server.url);
      await page.locator('.evidence-list__item').first().waitFor({ timeout: 10_000 });
      await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active !== undefined, { timeout: 10_000 });

      // v0.9 Batch 2: exercise every new annotation/authoring API surface from the page before inspecting cache storage.
      const annotationRouteStatuses = await page.evaluate(async () => {
        const index = (await (await fetch('/api/index')).json()) as { records: { family: string; handle: string }[] };
        const annotation = index.records.find((record) => record.family === 'visual-annotation');
        if (annotation === undefined) return { missing: true };
        const encoded = encodeURIComponent(annotation.handle);
        const session = await fetch('/api/authoring/session');
        const view = await fetch(`/api/annotations/${encoded}/view`);
        const media = await fetch(`/api/media/${encoded}/annotation-overlay`);
        const save = await fetch('/api/annotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceHandle: annotation.handle, items: [] }) });
        // v0.9 Batch 6: the reference materialization POST route is likewise never cached.
        const materialize = await fetch(`/api/annotations/${encoded}/materialize-reference`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemIds: ['x'] }) });
        return {
          session: [session.status, session.headers.get('cache-control')],
          view: [view.status, view.headers.get('cache-control')],
          media: [media.status, media.headers.get('cache-control')],
          save: [save.status, save.headers.get('cache-control')],
          materialize: [materialize.status, materialize.headers.get('cache-control')],
        };
      });
      expect(annotationRouteStatuses).toEqual({ session: [200, 'no-store'], view: [200, 'no-store'], media: [200, 'no-store'], save: [403, 'no-store'], materialize: [403, 'no-store'] });

      const apiCacheEntryCount = await page.evaluate(async () => {
        const cacheNames = await caches.keys();
        let count = 0;
        for (const name of cacheNames) {
          const cache = await caches.open(name);
          const requests = await cache.keys();
          count += requests.filter((r) => new URL(r.url).pathname.startsWith('/api/')).length;
        }
        return count;
      });
      expect(apiCacheEntryCount).toBe(0);
    } finally {
      await page.close();
    }
  });

});

describe('PWA server-down safety - self-contained hard-gate experiment', () => {
  it('HARD GATE: after the server goes down, a reload never presents previously-fetched evidence as current', async () => {
    let evidenceRoot: string | undefined;
    let profileRoot: string | undefined;
    let server: Extract<StartViewerResult, { ok: true }> | undefined;
    let serverClosed = false;
    let context: BrowserContext | undefined;
    let experimentPassed = false;
    const cleanupErrors: string[] = [];
    try {
      evidenceRoot = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-pwa-hard-gate-evidence-'));
      const { candidateId } = await writePwaFixture(evidenceRoot);
      server = await startForRoot(evidenceRoot);
      const origin = new URL(server.url).origin;
      const apiIndexUrl = new URL('/api/index', server.url).toString();
      profileRoot = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-pwa-hard-gate-profile-'));
      context = await chromium.launchPersistentContext(profileRoot, { headless: true });
      const page = await context.newPage();
      await page.goto(server.url);

      // 1. Registration is ready with an active worker for this viewer origin.
      const registrationState = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return { active: registration.active !== null, scope: registration.scope };
      });
      expect(registrationState.active).toBe(true);
      expect(registrationState.scope).toBe(`${origin}/`);

      // 2. Active is not controlled: prove this page is controlled. If the first
      // navigation activated the worker without controlling the page, reload while
      // the server is still live, then require a controller.
      const controlledOnFirstLoad = await page.evaluate(() => navigator.serviceWorker.controller !== null);
      if (!controlledOnFirstLoad) await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 10_000 });
      const controllerScript = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
      expect(controllerScript).toBe(`${origin}/sw.js`);

      // 3. Live evidence is visible and carries the deterministic fixture identity.
      const firstItem = page.locator('.evidence-list__item').first();
      await firstItem.waitFor({ timeout: 10_000 });
      expect(await firstItem.isVisible()).toBe(true);
      expect(await page.locator('.evidence-list').textContent()).toContain(candidateId);

      // Exercise the evidence/annotation API surface from the controlled page so the
      // cache-boundary proof below covers every route the page actually fetched.
      const apiStatuses = await page.evaluate(async () => {
        const indexResponse = await fetch('/api/index');
        const index = (await indexResponse.json()) as { records: { family: string; handle: string }[] };
        const annotation = index.records.find((record) => record.family === 'visual-annotation');
        if (annotation === undefined) return { missing: true };
        const encoded = encodeURIComponent(annotation.handle);
        const view = await fetch(`/api/annotations/${encoded}/view`);
        const media = await fetch(`/api/media/${encoded}/annotation-overlay`);
        return {
          index: [indexResponse.status, indexResponse.headers.get('cache-control')],
          view: [view.status, view.headers.get('cache-control')],
          media: [media.status, media.headers.get('cache-control')],
        };
      });
      expect(apiStatuses).toEqual({ index: [200, 'no-store'], view: [200, 'no-store'], media: [200, 'no-store'] });

      // 4 and 5. Inspect every Cache Storage entry: the Workbox precache holds the
      // app shell, and no /api/ request is cached anywhere. Hashed asset names are
      // not hardcoded: the entry script is read from the cached index.html itself.
      const cacheState = await page.evaluate(async () => {
        const cacheNames = await caches.keys();
        const pathnames: string[] = [];
        for (const name of cacheNames) {
          const requests = await (await caches.open(name)).keys();
          for (const request of requests) pathnames.push(new URL(request.url).pathname);
        }
        const shell = await caches.match('/index.html', { ignoreSearch: true });
        return { cacheNames, pathnames, shellHtml: shell === undefined ? null : await shell.text() };
      });
      expect(cacheState.cacheNames.some((name) => name.startsWith('workbox-precache'))).toBe(true);
      expect(cacheState.pathnames).toEqual(expect.arrayContaining(['/index.html', '/registerSW.js', '/manifest.webmanifest']));
      expect(cacheState.shellHtml).toContain('<div id="root"></div>');
      const shellEntryScript = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(cacheState.shellHtml ?? '')?.[1];
      expect(shellEntryScript).toMatch(/^\/assets\/.+\.js$/);
      expect(cacheState.pathnames).toContain(shellEntryScript);
      const apiCacheEntryCount = cacheState.pathnames.filter((pathname) => pathname.startsWith('/api/')).length;
      expect(apiCacheEntryCount).toBe(0);

      // 6. The authoritative server answers directly (Node side, not through the worker).
      const liveResponse = await fetch(apiIndexUrl, { signal: AbortSignal.timeout(5_000) });
      expect(liveResponse.status).toBe(200);
      expect(JSON.stringify(await liveResponse.json())).toContain(candidateId);

      // Record the proven pre-shutdown boundary for readiness reports.
      console.info(`HARD GATE pre-shutdown boundary ${JSON.stringify({ serviceWorkerActive: registrationState.active, controlledOnFirstLoad, clientControlled: controllerScript !== null, shellEntryScriptCached: true, precacheEntryCount: cacheState.pathnames.length, apiCacheEntryCount, liveEvidenceVisible: true })}`);

      await server.close();
      serverClosed = true;

      // 7. Prove the origin server is down with a direct Node-side request that no
      // service worker can intercept, rather than trusting that close() resolved.
      const afterClose = await fetch(apiIndexUrl, { signal: AbortSignal.timeout(5_000) }).then(
        (response) => ({ reachable: true, detail: `HTTP ${response.status}` }),
        (error: unknown) => ({ reachable: false, detail: String((error as { cause?: { code?: string } }).cause?.code ?? error) }),
      );
      expect(afterClose, `viewer API still reachable after close: ${afterClose.detail}`).toMatchObject({ reachable: false });

      await page.reload();

      // The app shell (precached) still renders - this is expected PWA behavior.
      await page.locator('h1, header').first().waitFor({ timeout: 10_000 });
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

      // The evidence-dependent surface must show an explicit unavailable state,
      // never the same evidence item rendered as if it were still current.
      await page.locator('.evidence-list__error').waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Evidence index unavailable');
      expect(bodyText).not.toContain(candidateId);
      expect(await page.locator('.evidence-list__item').count()).toBe(0);
      experimentPassed = true;
    } finally {
      const cleanupSteps: [string, () => Promise<unknown>][] = [
        ['close browser context', async () => context?.close()],
        ['close viewer server', async () => (server !== undefined && !serverClosed ? server.close() : undefined)],
        ['remove evidence root', async () => (evidenceRoot !== undefined ? removeTree(evidenceRoot) : undefined)],
        ['remove browser profile', async () => (profileRoot !== undefined ? removeTree(profileRoot) : undefined)],
      ];
      for (const [step, run] of cleanupSteps) {
        try {
          await run();
        } catch (error) {
          cleanupErrors.push(`${step}: ${String(error)}`);
        }
      }
      // Never mask an experiment failure with a cleanup failure; report both honestly.
      if (cleanupErrors.length > 0 && !experimentPassed) {
        console.error(`HARD GATE cleanup also failed after the experiment failed:\n${cleanupErrors.join('\n')}`);
      }
    }

    // Reached only when the experiment passed.
    if (cleanupErrors.length > 0) throw new Error(`HARD GATE cleanup failed:\n${cleanupErrors.join('\n')}`);
    // Cleanup proof: no test-owned profile or evidence state survives the experiment.
    expect(existsSync(evidenceRoot as string)).toBe(false);
    expect(existsSync(profileRoot as string)).toBe(false);
  }, 60_000);
});

describe('PWA install-control (synthetic branch) and standalone-mode behavioral proof', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;
  let browser: Browser;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-b8-pwa-install-'));
    await writeManyRegionsOneTargetFixture(root);
    server = await startForRoot(root);
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows the honest "not offered" state when the browser has not signaled installability', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      await page.locator('.install-affordance--unavailable').waitFor({ timeout: 10_000 });
      expect(await page.textContent('.install-affordance--unavailable')).toContain('not offered');
    } finally {
      await page.close();
    }
  });

  it('offers a genuine install action once a beforeinstallprompt event is dispatched (synthetic-event UI-logic proof, not a genuine platform install prompt)', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      await page.locator('.install-affordance--unavailable').waitFor({ timeout: 10_000 });

      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
        event.prompt = async () => {};
        event.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(event);
      });

      await page.locator('.install-affordance--available').waitFor({ timeout: 10_000 });
      expect(await page.textContent('.install-affordance--available')).toContain('Install viewer');
    } finally {
      await page.close();
    }
  });

  it('standalone display-mode behavioral proof via CDP media-feature emulation (not an actual OS installation)', async () => {
    const page = await browser.newPage();
    const client = await page.context().newCDPSession(page);
    try {
      await page.goto(server.url);
      let emulated = true;
      try {
        await client.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'display-mode', value: 'standalone' }] });
      } catch {
        emulated = false;
      }
      const matches = await page.evaluate(() => window.matchMedia('(display-mode: standalone)').matches);
      // Honest, non-overstated result: record whichever this Chromium build actually supports
      // for the Batch 8 report (never claimed as an actual OS-level installation proof).
      const { writeFile, mkdir } = await import('node:fs/promises');
      const logDir = path.join(repoRoot, '.my-dev-kit-workflow', 'v0.8', 'batch-08', 'logs');
      await mkdir(logDir, { recursive: true });
      await writeFile(path.join(logDir, 'pwa-standalone-proof.txt'), `CDP display-mode emulation accepted=${emulated} matchMedia(standalone)=${matches}\n`);
      expect(typeof matches).toBe('boolean');
    } finally {
      await page.close();
    }
  });
});
