import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeFullPipelineFixture, writeMalformedJsonManifest, writeUnsupportedVersionManifest } from '../support/evidenceFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

let browser: Browser;
let server: Extract<StartViewerResult, { ok: true }>;
let evidenceRoot: string;

/**
 * v0.8 Batch 2 real-browser proof (28.8): the actual built React shell,
 * through the actual loopback viewer server, against real persisted
 * evidence built through the canonical writers/application services - never
 * a hand-authored approximation of either side.
 */
beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }

  evidenceRoot = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-viewer-evidence-shell-'));
  await writeFullPipelineFixture(evidenceRoot);
  await writeMalformedJsonManifest(evidenceRoot, 'broken');
  await writeUnsupportedVersionManifest(evidenceRoot, 'future');

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

describe('viewer evidence data boundary (real Chromium, real persisted evidence)', () => {
  it('lists real recognized evidence with an honest loading state, then a populated list', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      await page.getByText('obs-before', { exact: false }).waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('comparison');
      expect(bodyText).toContain('baseline-contract');
      expect(bodyText).toContain('change-contract');
      expect(bodyText).toContain('contract-evaluation');
    } finally {
      await page.close();
    }
  });

  it('shows unsupported-version and malformed-json evidence honestly in the list, never as "supported"', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      await page.getByText('unsupported version', { exact: false }).waitFor({ timeout: 10_000 });
      await page.getByText('malformed JSON', { exact: false }).waitFor({ timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('selecting a supported non-visualized-family record triggers real on-demand loading and shows its full raw payload', async () => {
    // Since v0.8 Batch 3, "observation" renders the real SVG workspace, and since Batch 4 "comparison"/"contract-evaluation" render
    // their own real workspaces too (see tests/browser/observationSvgWorkspace.test.ts, comparisonEvaluationWorkspace.test.ts) -
    // "baseline-contract" still exercises the plain Batch 2 on-demand-load/raw-JSON path this test protects.
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item', { hasText: 'baseline-contract' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();
      await page.getByText('Loaded baseline-contract', { exact: false }).waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('sourceObservation');
    } finally {
      await page.close();
    }
  });

  it('selecting an unsupported-version record never attempts to load it as if supported', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--unsupported-version');
      await item.waitFor({ timeout: 10_000 });
      await item.click();
      await page.getByText('is not loadable', { exact: false }).waitFor({ timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('shows no visualization for families that still use the plain raw-JSON preview (baseline-contract; observation/comparison/contract-evaluation visualization is covered separately)', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item', { hasText: 'baseline-contract' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();
      await page.getByText('Loaded baseline-contract', { exact: false }).waitFor({ timeout: 10_000 });
      expect(await page.locator('img').count()).toBe(0);
      expect(await page.locator('svg').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
