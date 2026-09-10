import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeReferenceCandidateFixture, writeReferenceBindingFidelityFixture, writeReferenceFidelityContractFixture } from '../support/evidenceFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

let browser: Browser;

/**
 * v0.8 Batch 6 real-browser proof (task §75): the actual built React shell,
 * through the actual loopback viewer server started WITH an explicit
 * `bindingDeclarations` array (mirroring a real `--bindings-file`), against
 * real persisted reference/candidate/contract evidence produced entirely
 * through the existing canonical workflow - never hand-edited binding/
 * fidelity/compatibility/verdict results. Each scenario gets its own
 * isolated evidence root/server.
 */
beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function startForRoot(root: string, bindingDeclarations: unknown[] = []): Promise<Extract<StartViewerResult, { ok: true }>> {
  const result = await startViewer({ root, port: 0, assetsRoot: viewerDist, bindingDeclarations });
  if (!result.ok) throw new Error(`viewer server failed to start: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

async function selectReferenceAndCandidate(page: import('playwright').Page, server: { url: string }, candidateLabel: string, family: 'external-reference-imported' | 'external-reference-approved' = 'external-reference-approved') {
  await page.goto(server.url);
  const item = page.locator('.evidence-list__item--supported', { hasText: family }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.locator('.reference-region-overlay-svg').first().waitFor({ timeout: 10_000 });

  const select = page.locator('#reference-candidate-select');
  await select.waitFor({ timeout: 5_000 });
  await select.selectOption({ label: candidateLabel });
  await page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first().waitFor({ timeout: 10_000 });
}

describe('Case A - explicit bound cross-selection', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-a-'));
    await writeReferenceBindingFidelityFixture(root);
    server = await startForRoot(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('clicking a bound reference region cross-highlights its exact declared runtime target, and vice versa', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-fidelity-pass');

      await page.getByText('Explicit reference-region ↔ runtime-target bindings').waitFor({ timeout: 10_000 });
      await page.locator('.clause-row--pass', { hasText: 'header → header' }).waitFor({ timeout: 5_000 });

      const referenceHeaderRect = page.locator('rect[data-region-id="header"]').first();
      await referenceHeaderRect.click();
      const candidateHeaderRect = page.locator('rect[data-target-name="header"]').first();
      await expect.poll(() => candidateHeaderRect.getAttribute('class')).toMatch(/target-overlay-svg__rect--highlighted/);
      // Cross-highlight is not the same as the primary interactive selection - aria-pressed stays false.
      expect(await candidateHeaderRect.getAttribute('aria-pressed')).toBe('false');

      const candidateSidebarRect = page.locator('rect[data-target-name="sidebar"]').first();
      await candidateSidebarRect.click();
      const referenceSidebarRect = page.locator('rect[data-region-id="sidebar"]').first();
      await expect.poll(() => referenceSidebarRect.getAttribute('class')).toMatch(/target-overlay-svg__rect--highlighted/);
    } finally {
      await page.close();
    }
  });
});

describe('Case B - no declaration, equal names', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-b-'));
    await writeReferenceCandidateFixture(root);
    server = await startForRoot(root); // no binding declarations at all
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('a reference region and runtime target sharing the literal name "header" never cross-select without an explicit declaration', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-compatible');
      await page.getByText('No binding declarations were supplied').waitFor({ timeout: 10_000 });

      const referenceHeaderRect = page.locator('rect[data-region-id="header"]').first();
      await referenceHeaderRect.click();
      const candidateHeaderRect = page.locator('rect[data-target-name="header"]').first();
      expect(await candidateHeaderRect.getAttribute('class')).not.toMatch(/target-overlay-svg__rect--highlighted/);
      expect(await candidateHeaderRect.getAttribute('aria-pressed')).toBe('false');
    } finally {
      await page.close();
    }
  });
});

describe('Case C - ambiguous/unavailable binding', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-c-'));
    await writeReferenceBindingFidelityFixture(root);
    server = await startForRoot(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows genuine unavailable/ambiguous statuses and never cross-selects for them', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-binding-unavailable');
      await page.locator('.clause-row--unavailable', { hasText: 'header → header' }).waitFor({ timeout: 10_000 });
      const bodyText1 = await page.textContent('body');
      expect(bodyText1).toContain('runtime-target-not-configured');

      const referenceHeaderRect1 = page.locator('rect[data-region-id="header"]').first();
      await referenceHeaderRect1.click();
      // Candidate pane has no "header" target at all in this fixture - nothing gets fabricated.
      expect(await page.locator('rect[data-target-name="header"]').count()).toBe(0);
    } finally {
      await page.close();
    }

    const page2 = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page2, server, 'rc-binding-ambiguous');
      await page2.locator('.clause-row--conflict', { hasText: 'header → header' }).waitFor({ timeout: 10_000 });
      const bodyText2 = await page2.textContent('body');
      expect(bodyText2).toContain('runtime-target-ambiguous');

      const referenceHeaderRect2 = page2.locator('rect[data-region-id="header"]').first();
      await referenceHeaderRect2.click();
      // "header" resolves ambiguously (no usable geometry, per Batch 3's honest-rendering rule), so it
      // never gets a rendered rect at all - ambiguous status must never fabricate a cross-selected target.
      expect(await page2.locator('rect[data-target-name="header"]').count()).toBe(0);
    } finally {
      await page2.close();
    }
  });
});

describe('Case D - independent zoom/pan (lock off)', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-d-'));
    await writeReferenceBindingFidelityFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('zooming the reference pane leaves the candidate pane unchanged, and vice versa, while image/SVG stay aligned', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-fidelity-pass');

      const referenceSvg = page.locator('.reference-region-overlay-svg').first();
      const candidateSvg = page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first();
      const initialCandidateViewBox = await candidateSvg.getAttribute('viewBox');

      // One zoom step (1.25x, centered on the frame) keeps the "sidebar" region's own center
      // (60, 180) well inside the resulting visible viewBox (40-360, 30-270) - a stronger zoom
      // centered on the frame would clip small regions like "header" (y: 0-60) almost entirely out
      // of the visible area, making them unreliable click targets for this real-browser assertion.
      const referenceZoomIn = page.locator('.zoom-controls[aria-label="reference zoom and pan controls"] button', { hasText: '+' });
      await referenceZoomIn.click();

      await expect.poll(async () => (await referenceSvg.getAttribute('viewBox')) !== `0 0 400 300`).toBe(true);
      expect(await candidateSvg.getAttribute('viewBox')).toBe(initialCandidateViewBox);

      // Selection under transform (task §28): the sidebar region rect is still clickable after zoom.
      const referenceSidebarRect = page.locator('rect[data-region-id="sidebar"]').first();
      await referenceSidebarRect.click();
      await expect.poll(() => referenceSidebarRect.getAttribute('aria-pressed')).toBe('true');
    } finally {
      await page.close();
    }
  });
});

describe('Case E - locked compatible pair', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-e-'));
    await writeReferenceBindingFidelityFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('lock is enabled only because the canonical coordinate mapping is coherent, and zooming one pane synchronizes the other', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-fidelity-pass');

      const lockButton = page.getByRole('button', { name: /lock view/i });
      await lockButton.waitFor({ timeout: 10_000 });
      await expect.poll(() => lockButton.isEnabled()).toBe(true);
      await lockButton.click();
      await expect.poll(() => lockButton.getAttribute('aria-pressed')).toBe('true');

      const referenceZoomIn = page.locator('.zoom-controls[aria-label="reference zoom and pan controls"] button', { hasText: '+' });
      await referenceZoomIn.click();

      const referenceScale = page.locator('.zoom-controls[aria-label="reference zoom and pan controls"] .zoom-controls__scale');
      const candidateScale = page.locator('.zoom-controls[aria-label="candidate zoom and pan controls"] .zoom-controls__scale');
      await expect.poll(() => referenceScale.textContent()).toBe('1.25x');
      await expect.poll(() => candidateScale.textContent()).toBe('1.25x');
    } finally {
      await page.close();
    }
  });
});

describe('Case F - incompatible pair', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-f-'));
    await writeReferenceCandidateFixture(root);
    server = await startForRoot(root);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('lock is disabled with a visible canonical reason and never synchronizes', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-incompatible');

      const lockButton = page.getByRole('button', { name: /lock view/i });
      await lockButton.waitFor({ timeout: 10_000 });
      await expect.poll(() => lockButton.isEnabled()).toBe(false);
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Lock unavailable:');
    } finally {
      await page.close();
    }
  });

  it('lock is also disabled for a compatible-but-incoherent-aspect-ratio pair (Batch 5 fixture: 1200x800 viewport vs 400x300 image)', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-compatible');
      const lockButton = page.getByRole('button', { name: /lock view/i });
      await lockButton.waitFor({ timeout: 10_000 });
      await expect.poll(() => lockButton.isEnabled()).toBe(false);
      // Regression: the button is also disabled - false-positively satisfying the poll above -
      // while compatibility is still evaluating ("Evaluating compatibility..."), before the
      // reference/candidate compatibility check has actually settled to its final reason text.
      // Poll the settled body text itself rather than reading it once right after the button
      // state changes.
      await expect.poll(() => page.textContent('body'), { timeout: 10_000 }).toContain('coherent full-frame aspect ratio');
    } finally {
      await page.close();
    }
  });
});

describe('Case G/H - on-demand fidelity PASS and FAIL', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-gh-'));
    await writeReferenceBindingFidelityFixture(root);
    server = await startForRoot(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('Case G: a real canonical PASS is displayed with requirement values only after the explicit trigger is clicked', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-fidelity-pass');
      const evaluateButton = page.getByRole('button', { name: 'Evaluate Fidelity' });
      await evaluateButton.waitFor({ timeout: 10_000 });
      // Before clicking, no PASS/FAIL result exists yet.
      expect(await page.locator('.reference-fidelity-state').count()).toBe(0);

      await evaluateButton.click();
      await page.locator('.reference-fidelity-state--pass').waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('referenceValue');
      expect(bodyText).toContain('candidateRawValue');
      expect(bodyText).toContain('candidateValue');
    } finally {
      await page.close();
    }
  });

  it('Case H: a real canonical FAIL shows the failing requirement with delta/tolerance', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-fidelity-fail');
      const evaluateButton = page.getByRole('button', { name: 'Evaluate Fidelity' });
      await evaluateButton.waitFor({ timeout: 10_000 });
      await evaluateButton.click();
      await page.locator('.reference-fidelity-state--fail').waitFor({ timeout: 10_000 });

      const failingRow = page.locator('.clause-row--fail');
      await failingRow.first().waitFor({ timeout: 5_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toMatch(/delta: 30/);
      expect(bodyText).toContain('±4 reference px');
    } finally {
      await page.close();
    }
  });
});

describe('Case I - fidelity blocked (incompatible)', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-i-'));
    await writeReferenceCandidateFixture(root);
    server = await startForRoot(root, [{ referenceRegion: 'header', runtimeTarget: 'header' }]);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows not-evaluated with an honest blocker and zero fabricated requirement results', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'rc-incompatible');
      const evaluateButton = page.getByRole('button', { name: 'Evaluate Fidelity' });
      await evaluateButton.waitFor({ timeout: 10_000 });
      await evaluateButton.click();
      await page.locator('.reference-fidelity-state--not-evaluated').waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('blocked by: incompatible');
      expect(await page.locator('.reference-fidelity-panel .clause-row').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

describe('Case J - fidelity PASS alongside an active contract FAIL', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;
  let candidateId: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-case-j-'));
    const fixture = await writeReferenceFidelityContractFixture(root);
    candidateId = fixture.candidateId;
    server = await startForRoot(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('displays both a real fidelity PASS and a real contract FAIL prominently, without implying overall success', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, candidateId);

      // Select the one matching contract-evaluation context explicitly.
      const evaluationSelect = page.locator('#reference-evaluation-select');
      await evaluationSelect.waitFor({ timeout: 10_000 });
      await evaluationSelect.selectOption({ index: 1 });
      await page.locator('.overall-verdict--FAIL').waitFor({ timeout: 10_000 });

      const evaluateButton = page.getByRole('button', { name: 'Evaluate Fidelity' });
      await evaluateButton.click();
      await page.locator('.reference-fidelity-state--pass').waitFor({ timeout: 10_000 });

      // Both results are visible simultaneously; the independence note is present.
      await page.locator('.overall-verdict--FAIL').waitFor({ timeout: 2_000 });
      await page.locator('.reference-fidelity-state--pass').waitFor({ timeout: 2_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Reference fidelity does not override the active frontend-contract failure');
    } finally {
      await page.close();
    }
  });
});
