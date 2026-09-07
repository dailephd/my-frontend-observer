import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

let browser: Browser;
let server: Extract<StartViewerResult, { ok: true }>;
let evidenceRoot: string;

/**
 * Real-browser proof (13.7/Batch-1 gate): loads the actual built React
 * shell - not a hand-authored approximation of it - through the actual
 * loopback viewer server, in real Chromium, and checks it renders the
 * expected honest foundation state without fabricating evidence.
 */
beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }

  evidenceRoot = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-viewer-shell-root-'));
  // Explicit assetsRoot: this test runs against source (not the compiled dist/viewerServer bundle), where
  // the real startViewer()'s package-relative default would resolve beside src/ instead of dist/viewer.
  // Pointing directly at the actual built dist/viewer output keeps this test proving the real build artifact.
  const result = await startViewer({ root: evidenceRoot, port: 0, assetsRoot: viewerDist });
  if (!result.ok) throw new Error(`viewer server failed to start: ${JSON.stringify(result.diagnostics)}`);
  server = result;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (evidenceRoot !== undefined) await rm(evidenceRoot, { recursive: true, force: true });
});

describe('viewer shell (real Chromium against the built PWA)', () => {
  it('renders the product identity, an honest connected-session status, and every foundation placeholder region - no fabricated evidence', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      expect(await page.title()).toContain('my-frontend-observer Viewer');
      await page.getByText('my-frontend-observer').first().waitFor();
      await page.getByText('Local Observation Viewer').waitFor();

      // Status banner reaches the "available" state (real fetch to the real running server) and shows the exact supplied root.
      await page.getByText(evidenceRoot, { exact: false }).waitFor({ timeout: 10_000 });

      // The three Batch 1 foundation regions exist and are honest placeholders, not fabricated evidence.
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Evidence navigation will appear here');
      expect(bodyText).toContain('No observation, comparison, contract, or reference viewing is implemented yet');
      expect(bodyText).toContain('Details and diagnostics for the selected evidence will appear here');
    } finally {
      await page.close();
    }
  });

  it('never claims installability when the browser has not offered an install prompt', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      await page.getByText('Install prompt not offered by this browser yet').waitFor({ timeout: 10_000 });
      expect(await page.locator('button:has-text("Install viewer")').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shows an actionable local-server-unavailable state when the status endpoint cannot be reached, instead of fabricating a session', async () => {
    const page = await browser.newPage();
    try {
      // Intercepts only the app's own status fetch (never the real evidence root or server), forcing the honest "unavailable" branch deterministically.
      await page.route('**/api/status', (route) => route.abort('connectionrefused'));
      await page.goto(server.url);
      await page.getByText('Local viewer server unavailable', { exact: false }).waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).not.toContain(evidenceRoot);
    } finally {
      await page.close();
    }
  });
});
