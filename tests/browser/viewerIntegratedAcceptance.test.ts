import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeManyRegionsOneTargetFixture, writeFidelityFailContractPassFixture, writeBoundedContextEvidenceFixture } from '../support/evidenceFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

let browser: Browser;

/**
 * v0.8 Batch 8 real-browser proof (task §69 items L, M, N): closes the
 * three named remaining coverage gaps from Batches 6 and 7 -
 * many-reference-regions-bound-to-one-runtime-target cross-selection,
 * reference-fidelity-FAIL alongside a genuine frontend-contract-PASS for
 * the same candidate (the asymmetric counterpart to Batch 6's Case J), and
 * a bounded context whose sources include two observations that both
 * contain the same stable target id. All evidence is produced through the
 * existing canonical fixture writers - nothing here hand-edits a
 * verdict/status.
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

async function startForRoot(root: string, options: { bindingDeclarations?: unknown[]; context?: unknown } = {}): Promise<Extract<StartViewerResult, { ok: true }>> {
  const result = await startViewer({ root, port: 0, assetsRoot: viewerDist, bindingDeclarations: options.bindingDeclarations ?? [], ...(options.context !== undefined ? { context: options.context } : {}) });
  if (!result.ok) throw new Error(`viewer server failed to start: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

async function selectReferenceAndCandidate(page: import('playwright').Page, server: { url: string }, candidateLabel: string) {
  await page.goto(server.url);
  const item = page.locator('.evidence-list__item--supported', { hasText: 'external-reference-approved' }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.locator('.reference-region-overlay-svg').first().waitFor({ timeout: 10_000 });

  const select = page.locator('#reference-candidate-select');
  await select.waitFor({ timeout: 5_000 });
  await select.selectOption({ label: candidateLabel });
  await page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first().waitFor({ timeout: 10_000 });
}

describe('Scenario L (item L) - many reference regions bound to one runtime target', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-b8-l-'));
    await writeManyRegionsOneTargetFixture(root);
    server = await startForRoot(root, {
      bindingDeclarations: [
        { referenceRegion: 'region-a', runtimeTarget: 'workspace' },
        { referenceRegion: 'region-b', runtimeTarget: 'workspace' },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('selecting the single bound runtime target highlights ALL bound reference regions, never just one', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, 'many-regions-candidate');

      const candidateWorkspaceRect = page.locator('rect[data-target-name="workspace"]').first();
      await candidateWorkspaceRect.click();

      const regionA = page.locator('rect[data-region-id="region-a"]').first();
      const regionB = page.locator('rect[data-region-id="region-b"]').first();
      await expect.poll(() => regionA.getAttribute('class')).toMatch(/target-overlay-svg__rect--highlighted/);
      await expect.poll(() => regionB.getAttribute('class')).toMatch(/target-overlay-svg__rect--highlighted/);

      // Neither is the primary interactive selection - the highlight is a secondary, accessible state.
      expect(await regionA.getAttribute('aria-pressed')).toBe('false');
      expect(await regionB.getAttribute('aria-pressed')).toBe('false');
      expect(await regionA.getAttribute('data-highlighted')).toBe('true');
      expect(await regionB.getAttribute('data-highlighted')).toBe('true');
      const labelA = await regionA.getAttribute('aria-label');
      const labelB = await regionB.getAttribute('aria-label');
      expect(labelA).toMatch(/highlighted/i);
      expect(labelB).toMatch(/highlighted/i);
    } finally {
      await page.close();
    }
  });
});

describe('Scenario M (item M) - reference fidelity FAIL alongside a genuine contract PASS for the same candidate', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;
  let candidateId: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-b8-m-'));
    const fixture = await writeFidelityFailContractPassFixture(root);
    candidateId = fixture.candidateId;
    server = await startForRoot(root, {
      bindingDeclarations: [
        { referenceRegion: 'header', runtimeTarget: 'header' },
        { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('displays both a real contract PASS and a real fidelity FAIL prominently and independently, with no hidden precedence', async () => {
    const page = await browser.newPage();
    try {
      await selectReferenceAndCandidate(page, server, candidateId);

      const evaluationSelect = page.locator('#reference-evaluation-select');
      await evaluationSelect.waitFor({ timeout: 10_000 });
      await evaluationSelect.selectOption({ index: 1 });
      await page.locator('.overall-verdict--PASS').waitFor({ timeout: 10_000 });

      const evaluateButton = page.getByRole('button', { name: 'Evaluate Fidelity' });
      await evaluateButton.click();
      await page.locator('.reference-fidelity-state--fail').waitFor({ timeout: 10_000 });

      // Both results are visible simultaneously; the contract PASS never masks the fidelity FAIL.
      await page.locator('.overall-verdict--PASS').waitFor({ timeout: 2_000 });
      await page.locator('.reference-fidelity-state--fail').waitFor({ timeout: 2_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Reference fidelity does not override the active frontend-contract result');
    } finally {
      await page.close();
    }
  });
});

describe('Scenario N (item N) - bounded context sources with two observations sharing a target id', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-b8-n-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { context: { status: 'valid', artifact: fixture.baseContext } });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('selecting a bounded target present in multiple source observations lists ALL matching source observations, never just one', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      await page.getByRole('button', { name: 'Bounded context' }).click();
      await page.locator('.context-workspace').waitFor({ timeout: 10_000 });

      const targetButton = page.locator('.clause-row__button', { hasText: 'header' }).first();
      await targetButton.click();

      const sourceList = page.locator('.context-target-source-list');
      await sourceList.waitFor({ timeout: 10_000 });
      await page.locator('.context-target-source-list li', { hasText: 'observation:ctx-before' }).waitFor({ timeout: 10_000 });
      await page.locator('.context-target-source-list li', { hasText: 'observation:ctx-after' }).waitFor({ timeout: 10_000 });

      const items = await sourceList.locator('li').count();
      expect(items).toBe(2);
    } finally {
      await page.close();
    }
  });
});
