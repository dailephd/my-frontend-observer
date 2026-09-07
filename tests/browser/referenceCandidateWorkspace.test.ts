import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeReferenceCandidateFixture, writeExternalReferencePairFixture } from '../support/evidenceFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

let browser: Browser;

/**
 * v0.8 Batch 5 real-browser proof (task §51): the actual built React shell,
 * through the actual loopback viewer server, against real persisted
 * external-reference/candidate evidence produced entirely through the
 * existing canonical `importExternalReference`/`approveExternalReference`/
 * `writeObservationArtifact` workflow (via `writeReferenceCandidateFixture`)
 * - never hand-edited region/requirement/compatibility results. Each
 * scenario gets its own isolated evidence root/server.
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

describe('Case A - imported reference inspection', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-ref-case-a-'));
    await writeReferenceCandidateFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('loads the reference image, aligns both regions, supports region selection, and shows requirements and imported lifecycle', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'external-reference-imported' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      await page.locator('.reference-region-overlay-svg image').first().waitFor({ timeout: 10_000 });
      const image = page.locator('.reference-region-overlay-svg image').first();
      expect(await image.getAttribute('href')).toMatch(/^\/api\/media\/external-reference-imported:.*\/image$/);

      const headerRect = page.locator('rect[data-region-id="header"]').first();
      const sidebarRect = page.locator('rect[data-region-id="sidebar"]').first();
      await headerRect.waitFor({ timeout: 5_000 });
      await sidebarRect.waitFor({ timeout: 5_000 });
      expect(await headerRect.getAttribute('width')).toBe('400');
      expect(await sidebarRect.getAttribute('height')).toBe('240');

      await headerRect.click();
      await expect.poll(() => headerRect.getAttribute('aria-pressed')).toBe('true');
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Reference region: header');

      expect(bodyText).toContain('imported');
    } finally {
      await page.close();
    }
  });
});

describe('Case B - approved reference inspection', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-ref-case-b-'));
    await writeReferenceCandidateFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('loads the approved artifact image from the exact imported source (never a co-located duplicate) and shows approved lifecycle/sourceReference', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'external-reference-approved' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      await page.locator('.reference-region-overlay-svg image').first().waitFor({ timeout: 10_000 });
      const image = page.locator('.reference-region-overlay-svg image').first();
      expect(await image.getAttribute('href')).toMatch(/^\/api\/media\/external-reference-approved:.*\/source-image$/);

      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('approved (');
      expect(bodyText).toContain('owned by imported source referenceId');
    } finally {
      await page.close();
    }
  });
});

describe('Case C - compatible reference/candidate', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-ref-case-c-'));
    await writeReferenceCandidateFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows reference and candidate side by side, each in its own coordinate domain, with a real canonical comparable/warnings compatibility result', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'external-reference-approved' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      await page.locator('.reference-region-overlay-svg').first().waitFor({ timeout: 10_000 });

      // Explicit candidate selection - never auto-selected.
      const select = page.locator('#reference-candidate-select');
      await select.waitFor({ timeout: 5_000 });
      await select.selectOption({ label: 'rc-compatible' });

      // Candidate pane renders through the reused Batch 3/4 runtime SVG machinery.
      await page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first().waitFor({ timeout: 10_000 });
      const referenceViewBox = await page.locator('.reference-region-overlay-svg').first().getAttribute('viewBox');
      const candidateViewBox = await page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first().getAttribute('viewBox');
      expect(referenceViewBox).toBe('0 0 400 300');
      expect(candidateViewBox).toBe('0 0 1200 800');

      await page.getByText('Reference/candidate compatibility').waitFor({ timeout: 10_000 });
      await page.locator('.comparability-banner--comparable').waitFor({ timeout: 10_000 });

      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('not evaluated in this batch');
    } finally {
      await page.close();
    }
  });
});

describe('Case D - incompatible candidate', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-ref-case-d-'));
    await writeReferenceCandidateFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('still displays both panes with a real canonical incompatible reason - never a fabricated fidelity failure', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'external-reference-approved' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      const select = page.locator('#reference-candidate-select');
      await select.waitFor({ timeout: 5_000 });
      await select.selectOption({ label: 'rc-incompatible' });

      await page.locator('.comparability-banner--incomparable').waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('viewport-mismatch');
      expect(bodyText).toContain('theme-mismatch');
      expect(bodyText).not.toMatch(/fidelity[^.]*(PASS|FAIL)/i);

      // Reference and candidate panes both still render.
      await page.locator('.reference-region-overlay-svg').first().waitFor({ timeout: 5_000 });
      await page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first().waitFor({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });
});

describe('Case E - equal region/target names never imply a binding', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-ref-case-e-'));
    await writeReferenceCandidateFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('selecting the reference region "header" does not select or highlight the identically-named runtime target "header"', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'external-reference-approved' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      const select = page.locator('#reference-candidate-select');
      await select.waitFor({ timeout: 5_000 });
      await select.selectOption({ label: 'rc-compatible' });
      await page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first().waitFor({ timeout: 10_000 });

      const referenceHeaderRect = page.locator('rect[data-region-id="header"]').first();
      await referenceHeaderRect.click();
      await expect.poll(() => referenceHeaderRect.getAttribute('aria-pressed')).toBe('true');

      // The candidate side also has a target literally named "header" - it must remain unselected.
      const candidateHeaderRect = page.locator('rect[data-target-name="header"]').first();
      await candidateHeaderRect.waitFor({ timeout: 5_000 });
      expect(await candidateHeaderRect.getAttribute('aria-pressed')).toBe('false');

      // No connector/binding line was drawn between the two panes.
      const connectorCount = await page.locator('[data-binding-connector]').count();
      expect(connectorCount).toBe(0);
    } finally {
      await page.close();
    }
  });
});

describe('Reference with no regions/requirements still inspects honestly', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-ref-plain-'));
    await writeExternalReferencePairFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows the image with no region rectangles and an honest "no requirements selected" state', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item--supported', { hasText: 'external-reference-imported' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      await page.locator('.reference-region-overlay-svg image').first().waitFor({ timeout: 10_000 });
      expect(await page.locator('rect[data-region-id]').count()).toBe(0);
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('No requirements selected on this reference.');
      expect(bodyText).toContain('No design requirements selected for this reference.');
    } finally {
      await page.close();
    }
  });
});
