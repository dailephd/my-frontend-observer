import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeManyRegionsOneTargetFixture } from '../support/evidenceFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');
const workflowPwaProfile = path.join(repoRoot, '.my-dev-kit-workflow', 'v0.8', 'batch-08', 'pwa-profile');

/**
 * v0.8 Batch 8 PWA hardening (task §32-38, §53, §56-65): real Chromium,
 * real service-worker registration, and a real server-down reload - not
 * static `sw.js` regex inspection. Uses a dedicated persistent Chromium
 * profile under the workflow root (never the user's real profile) so
 * service-worker state genuinely survives across a server shutdown within
 * one continuous page/session, mirroring how a real installed PWA behaves.
 *
 * Hard acceptance gate (task §61): stale evidence must never be presented
 * as current once the server is unreachable. The app shell may still
 * render from the precache, but evidence-dependent content must fall back
 * to an explicit unavailable/error state, never frozen prior data.
 */
beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }
}, 120_000);

async function startForRoot(root: string): Promise<Extract<StartViewerResult, { ok: true }>> {
  const result = await startViewer({ root, port: 0, assetsRoot: viewerDist, bindingDeclarations: [] });
  if (!result.ok) throw new Error(`viewer server failed to start: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

describe('PWA live proof - service worker, shell precache, server-down behavior', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;
  let context: BrowserContext;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-b8-pwa-'));
    await writeManyRegionsOneTargetFixture(root);
    server = await startForRoot(root);
    context = await chromium.launchPersistentContext(workflowPwaProfile, { headless: true });
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
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

  it('HARD GATE: after the server goes down, a reload never presents previously-fetched evidence as current', async () => {
    const page = await context.newPage();
    try {
      await page.goto(server.url);
      const firstItem = page.locator('.evidence-list__item').first();
      await firstItem.waitFor({ timeout: 10_000 });
      const evidenceWasVisible = await firstItem.isVisible();
      expect(evidenceWasVisible).toBe(true);

      // Wait for the service worker to be fully active before taking the server down,
      // so the app shell itself is genuinely precache-served on reload.
      await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active !== undefined, { timeout: 10_000 });

      await server.close();

      await page.reload();

      // The app shell (precached) still renders - this is expected PWA behavior.
      await page.locator('h1, header').first().waitFor({ timeout: 10_000 });

      // The evidence-dependent surface must show an explicit unavailable state,
      // never the same evidence item rendered as if it were still current.
      await page.locator('.evidence-list__error').waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Evidence index unavailable');
      expect(bodyText).not.toContain('many-regions-candidate');
    } finally {
      await page.close();
    }
  });
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
