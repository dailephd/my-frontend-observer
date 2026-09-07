import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeAllPassPipelineFixture, writeFullPipelineFixture, writeAppearedDisappearedComparisonFixture, writeIncomparableComparisonFixture } from '../support/evidenceFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

let browser: Browser;

/**
 * v0.8 Batch 4 real-browser proof (task §44): the actual built React shell,
 * through the actual loopback viewer server, against real persisted
 * comparison/contract/evaluation evidence produced entirely through the
 * existing canonical `compareObservations`/`evaluateFrontendContract`
 * workflow (via `evaluateAndPersistFromArtifactRoots`) - never hand-edited
 * `overallVerdict`/`clauseResults`/`differences`. Each scenario gets its own
 * isolated evidence root/server: `writeFullPipelineFixture` and
 * `writeAllPassPipelineFixture` both use fixed literal observation ids
 * (`obs-before`/`obs-after`), so combining them under one shared root would
 * itself trigger the ambiguous-match case rather than the case under test.
 */
beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function startForRoot(root: string): Promise<Extract<StartViewerResult, { ok: true }>> {
  const result = await startViewer({ root, port: 0, assetsRoot: viewerDist });
  if (!result.ok) throw new Error(`viewer server failed to start: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

describe('Case A - all-pass evaluation (real Chromium, real persisted evidence)', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-case-a-'));
    await writeAllPassPipelineFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('resolves the exact comparison, renders both screenshots, shows differences, requested/protected/preserved pass, and overall PASS', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'contract-evaluation' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      await page.getByText('Overall verdict:').waitFor({ timeout: 10_000 });
      await page.locator('.overall-verdict--PASS').waitFor({ timeout: 10_000 });

      // Both before/after screenshots render through the real Batch 2 media endpoint.
      const images = page.locator('.comparison-pane image');
      await expect.poll(() => images.count()).toBe(2);
      for (const src of await images.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
        expect(src).toMatch(/^\/api\/media\/observation:/);
      }

      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('requested-nav');
      expect(bodyText).toContain('protected-rightad');
      expect(bodyText).toContain('preserved-nav-unclipped');

      // Every clause row is a real pass (all-pass fixture).
      await page.locator('.clause-row--pass', { hasText: 'requested-nav' }).waitFor({ timeout: 5_000 });
      await page.locator('.clause-row--pass', { hasText: 'protected-rightad' }).waitFor({ timeout: 5_000 });
      await page.locator('.clause-row--pass', { hasText: 'preserved-nav-unclipped' }).waitFor({ timeout: 5_000 });

      // Clicking a target-scoped clause row highlights the exact stable target's SVG rectangle.
      const requestedRow = page.locator('.clause-row', { hasText: 'requested-nav' }).getByRole('button');
      await requestedRow.click();
      const navRect = page.locator('rect[data-target-name="navigation"]').first();
      await expect.poll(() => navRect.getAttribute('aria-pressed')).toBe('true');
    } finally {
      await page.close();
    }
  });
});

describe('Case B - safety failure (requested pass, protected+preserved fail, overall FAIL)', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-case-b-'));
    await writeFullPipelineFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows the required safety case unmistakably and highlights the failing target', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'contract-evaluation' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      await page.locator('.overall-verdict--FAIL').waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('requested-nav');
      expect(bodyText).toContain('protected-rightad');
      expect(bodyText).toContain('preserved-nav-unclipped');

      // Requested clause is pass; protected and preserved clauses are fail - verify via row classes.
      await page.locator('.clause-row--pass', { hasText: 'requested-nav' }).waitFor({ timeout: 5_000 });
      await page.locator('.clause-row--fail', { hasText: 'protected-rightad' }).waitFor({ timeout: 5_000 });
      await page.locator('.clause-row--fail', { hasText: 'preserved-nav-unclipped' }).waitFor({ timeout: 5_000 });

      // Before/after visual context remains available even though the overall verdict is FAIL.
      const images = page.locator('.comparison-pane image');
      await expect.poll(() => images.count()).toBe(2);

      // Clicking the failing protected clause highlights the exact relevant target.
      const protectedRow = page.locator('.clause-row--fail', { hasText: 'protected-rightad' }).getByRole('button');
      await protectedRow.click();
      const rightAdRect = page.locator('rect[data-target-name="rightAd"]').first();
      await expect.poll(() => rightAdRect.getAttribute('aria-pressed')).toBe('true');
    } finally {
      await page.close();
    }
  });
});

describe('appeared/disappeared target behavior', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-case-ad-'));
    await writeAppearedDisappearedComparisonFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows an appeared and a disappeared difference without fabricating the absent-side rectangle', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'comparison' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();
      await page.locator('.comparison-pane image').first().waitFor({ timeout: 10_000 });

      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('appeared');
      expect(bodyText).toContain('disappeared');

      // The disappeared target ("promo") has no rectangle in the After pane; the appeared target ("banner") has no rectangle in the Before pane.
      const beforePane = page.locator('.comparison-pane', { hasText: 'Before' });
      const afterPane = page.locator('.comparison-pane', { hasText: 'After' });
      await expect.poll(() => beforePane.locator('rect[data-target-name="banner"]').count()).toBe(0);
      await expect.poll(() => afterPane.locator('rect[data-target-name="promo"]').count()).toBe(0);
      await expect.poll(() => afterPane.locator('rect[data-target-name="banner"]').count()).toBe(1);
      await expect.poll(() => beforePane.locator('rect[data-target-name="promo"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});

describe('incomparable comparison state', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-case-ic-'));
    await writeIncomparableComparisonFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('makes the incomparable state obvious', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'comparison' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      await page.locator('.comparability-banner--incomparable').waitFor({ timeout: 10_000 });
      await page.getByText('viewport-mismatch', { exact: false }).waitFor({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });
});
