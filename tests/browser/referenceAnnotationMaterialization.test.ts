import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startViewer, type StartViewerOptions, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { projectConfigPath, projectEvidenceRoot, projectReferencesRoot } from '../../src/projectWorkflow/projectPaths.js';
import { initializeFrontendObserverProject } from '../../src/application/projectWorkflowService.js';
import { readExternalReferenceArtifact } from '../../src/artifacts/externalReferenceArtifactReader.js';
import type { ExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import { writeReferenceCandidateFixture } from '../support/evidenceFixtures.js';
import { TestResources } from '../support/annotationAuthoringFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');
/** The 400x300 reference image renders at more than one CSS pixel per image pixel, so pointer rounding stays under one reference pixel. */
const TOLERANCE = 1;
const REFERENCE_SVG = 'svg.reference-region-overlay-svg';
const MATERIALIZE_BUTTON = 'Materialize selected into new reference revision';

type RunningViewer = Extract<StartViewerResult, { ok: true }>;
type Family = 'external-reference-imported' | 'external-reference-approved';

let browser: Browser;
const resources = new TestResources();
const openViewers: RunningViewer[] = [];
const openContexts: BrowserContext[] = [];

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

afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
  await Promise.all(openViewers.splice(0).map((viewer) => viewer.close()));
  await resources.cleanup();
});

afterAll(async () => {
  await browser?.close();
});

async function candidateProject(options: { configureReferenceAcceptance?: boolean } = {}) {
  const projectRoot = await resources.tempDir('mfo-reference-materialization-project-');
  const initialized = await initializeFrontendObserverProject({ projectRoot, url: 'http://127.0.0.1:3000', viewport: { width: 1200, height: 800 }, targets: [{ name: 'header', selector: '#header' }], replace: false });
  if (!initialized.ok) throw new Error(initialized.message);
  const root = projectEvidenceRoot(projectRoot);
  const fixture = await writeReferenceCandidateFixture(root);
  if (options.configureReferenceAcceptance === true) {
    const config = JSON.parse(await readFile(projectConfigPath(projectRoot), 'utf8')) as Record<string, unknown>;
    const approvedArtifact = path.relative(projectRoot, fixture.approvedRoot).split(path.sep).join('/');
    await writeFile(projectConfigPath(projectRoot), `${JSON.stringify({ ...config, schemaVersion: '1.1.0', acceptance: { reference: { approvedArtifact } } }, null, 2)}\n`);
  }
  const result = await startViewer({ root, authoringProjectRoot: projectRoot, port: 0, assetsRoot: viewerDist } satisfies StartViewerOptions);
  if (!result.ok) throw new Error(`viewer failed to start: ${JSON.stringify(result.diagnostics)}`);
  openViewers.push(result);
  return { projectRoot, root, fixture, viewer: result };
}

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  openContexts.push(context);
  return context.newPage();
}

async function openReference(page: Page, url: string, family: Family): Promise<void> {
  await page.goto(url);
  const item = page.locator('.evidence-list__item--supported', { hasText: family }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.locator(REFERENCE_SVG).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 10_000 });
}

async function setMode(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: `${label} mode` });
  await button.click();
  await expect.poll(() => button.getAttribute('aria-pressed')).toBe('true');
}

async function revealReferenceSvg(page: Page): Promise<void> {
  await page.evaluate((selector) => (document.querySelector(selector) as SVGSVGElement).scrollIntoView({ block: 'start', inline: 'nearest' }), REFERENCE_SVG);
}

async function sourceToClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([selector, sx, sy]) => {
      const svg = document.querySelector(selector as string) as SVGSVGElement;
      const point = svg.createSVGPoint();
      point.x = sx as number;
      point.y = sy as number;
      const client = point.matrixTransform(svg.getScreenCTM() as DOMMatrix);
      return { x: client.x, y: client.y };
    },
    [REFERENCE_SVG, x, y],
  );
}

async function dragSource(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await revealReferenceSvg(page);
  const a = await sourceToClient(page, from.x, from.y);
  const b = await sourceToClient(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function clickSource(page: Page, x: number, y: number): Promise<void> {
  await revealReferenceSvg(page);
  const client = await sourceToClient(page, x, y);
  await page.mouse.click(client.x, client.y);
}

async function draftItemCount(page: Page): Promise<number> {
  return Number(await page.locator('.annotation-panel__draft-summary').getAttribute('data-draft-item-count'));
}

async function selectedItemId(page: Page): Promise<string> {
  return (await page.locator('.annotation-panel__item').getAttribute('data-selected-annotation-item-id')) as string;
}

async function interpretationState(page: Page): Promise<string | null> {
  return page.locator('.annotation-panel__interpretation').getAttribute('data-interpretation-state');
}

async function button(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

async function confirmIntent(page: Page): Promise<void> {
  await button(page, 'Confirm reference intent');
  await expect.poll(() => interpretationState(page)).toBe('confirmed');
}

/** Draws a rectangle and proposes it as a created region; returns the item id. */
async function drawCreate(page: Page, regionId: string, from: { x: number; y: number }, to: { x: number; y: number }, confirm = true): Promise<string> {
  const before = await draftItemCount(page);
  await setMode(page, 'Rectangle');
  await dragSource(page, from, to);
  await expect.poll(() => draftItemCount(page)).toBe(before + 1);
  await page.getByLabel('Proposed region ID').fill(regionId);
  await button(page, 'Create candidate region');
  if (confirm) await confirmIntent(page);
  return selectedItemId(page);
}

async function drawPoint(page: Page, x: number, y: number): Promise<string> {
  const before = await draftItemCount(page);
  await setMode(page, 'Point');
  await clickSource(page, x, y);
  await expect.poll(() => draftItemCount(page)).toBe(before + 1);
  return selectedItemId(page);
}

async function save(page: Page): Promise<{ annotationId: string; handle: string }> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/annotations' && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save annotation' }).click(),
  ]);
  const json = (await response.json()) as { annotationId: string; handle: string };
  expect(response.status()).toBe(201);
  await page.getByRole('status').filter({ hasText: `Saved annotation ${json.annotationId}` }).waitFor({ timeout: 10_000 });
  return json;
}

interface MaterializeResponse {
  status: number;
  json: { referenceId?: string; supersedesReferenceId?: string; lifecycle?: string; approvalRequired?: boolean; regionCount?: number; requirementCount?: number; handle?: string };
}

async function materialize(page: Page, itemIds: string[]): Promise<MaterializeResponse> {
  for (const id of itemIds) await page.locator(`[data-materialization-item-id="${id}"] input[type="checkbox"]`).check();
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/materialize-reference') && r.request().method() === 'POST'),
    page.getByRole('button', { name: MATERIALIZE_BUTTON }).click(),
  ]);
  return { status: response.status(), json: (await response.json()) as MaterializeResponse['json'] };
}

async function readReference(projectRoot: string, referenceId: string): Promise<ExternalReferenceArtifact> {
  const read = await readExternalReferenceArtifact(path.join(projectReferencesRoot(projectRoot), referenceId, 'manifest.json'));
  if (!read.ok) throw new Error(read.reason);
  return read.artifact;
}

async function snapshotDirs(dirs: string[]): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const dir of dirs) {
    for (const name of await readdir(dir)) snapshot.set(path.join(dir, name), await readFile(path.join(dir, name)));
  }
  return snapshot;
}

async function referenceDirs(projectRoot: string): Promise<string[]> {
  return (await readdir(projectReferencesRoot(projectRoot))).sort();
}

async function imageBytesOf(artifactRoot: string): Promise<Buffer> {
  const image = (await readdir(artifactRoot)).find((name) => name !== 'manifest.json');
  if (image === undefined) throw new Error('expected a reference image file');
  return readFile(path.join(artifactRoot, image));
}

async function indexRecords(page: Page): Promise<{ family: string; handle: string; logicalId?: string }[]> {
  return page.evaluate(async () => ((await (await fetch('/api/index')).json()) as { records: { family: string; handle: string; logicalId?: string }[] }).records);
}

function expectNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(TOLERANCE);
}

describe('reference intent materialization from the reference workspace', () => {
  it('materializes a confirmed created region into a new imported revision without approval, config change, or switching the viewed reference', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject({ configureReferenceAcceptance: true });
    const configBefore = await readFile(projectConfigPath(projectRoot));
    const sourceBefore = await snapshotDirs([fixture.importedRoot, fixture.approvedRoot]);
    const dirsBefore = await referenceDirs(projectRoot);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    const createId = await drawCreate(page, 'new-region', { x: 200, y: 100 }, { x: 350, y: 200 });
    // Unsaved drafts cannot be materialized.
    await page.getByText('Save the annotation before materializing reference intent.').waitFor({ timeout: 5_000 });
    expect(await page.getByRole('button', { name: MATERIALIZE_BUTTON }).isDisabled()).toBe(true);
    await page.getByText('This creates a new imported reference revision. The current reference remains unchanged. The new reference is not approved automatically.').waitFor({ timeout: 5_000 });

    await save(page);
    expect(await page.getByText('Save the annotation before materializing reference intent.').count()).toBe(0);
    expect(await page.getByRole('button', { name: MATERIALIZE_BUTTON }).isDisabled()).toBe(true);
    const result = await materialize(page, [createId]);
    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ lifecycle: 'imported', approvalRequired: true, supersedesReferenceId: fixture.importedReferenceId, regionCount: 3, requirementCount: 4 });
    const referenceId = result.json.referenceId as string;

    const success = page.locator(`[data-materialized-reference-id="${referenceId}"]`);
    await success.waitFor({ timeout: 10_000 });
    const text = (await success.textContent()) as string;
    for (const expected of [`New reference ID: ${referenceId}`, 'Lifecycle: imported', `Supersedes: ${fixture.importedReferenceId}`, 'Regions: 3', 'Requirements: 4', 'Approval required: yes', 'The new reference is imported but not approved. Use the existing explicit approval workflow when ready.']) {
      expect(text).toContain(expected);
    }
    // The selection resets after success.
    expect(await page.locator(`[data-materialization-item-id="${createId}"] input[type="checkbox"]`).isChecked()).toBe(false);
    expect(await page.getByRole('button', { name: MATERIALIZE_BUTTON }).isDisabled()).toBe(true);

    const created = await readReference(projectRoot, referenceId);
    expect(created.lifecycle.state).toBe('imported');
    expect(created.supersedesReferenceId).toBe(fixture.importedReferenceId);
    expect(created.regions?.slice(0, 2).map((region) => region.id)).toEqual(['header', 'sidebar']);
    const region = created.regions?.[2];
    expect(region?.id).toBe('new-region');
    expectNear(region?.rectangle.x as number, 200);
    expectNear(region?.rectangle.width as number, 150);

    // Exactly one new imported artifact; no approved sibling; sources and project config unchanged.
    expect(await referenceDirs(projectRoot)).toEqual([...dirsBefore, referenceId].sort());
    expect(await snapshotDirs([fixture.importedRoot, fixture.approvedRoot])).toEqual(sourceBefore);
    expect((await readFile(projectConfigPath(projectRoot))).equals(configBefore)).toBe(true);

    // Discoverable as external-reference-imported, while the workspace still shows the original reference.
    const records = await indexRecords(page);
    expect(records.find((record) => record.handle === result.json.handle)?.family).toBe('external-reference-imported');
    expect(records.filter((record) => record.family === 'external-reference-approved')).toHaveLength(1);
    expect(await page.locator('dd', { hasText: fixture.importedReferenceId }).count()).toBeGreaterThan(0);
    expect(await page.locator('dd', { hasText: referenceId }).count()).toBe(0);
    await page.reload();
    await expect.poll(() => page.locator('.evidence-list__item--supported', { hasText: 'external-reference-imported' }).count()).toBe(2);
  });

  it('materializes a confirmed refinement from an approved source, superseding the approved id and reusing the owning image bytes', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const sourceBefore = await snapshotDirs([fixture.importedRoot, fixture.approvedRoot]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-approved');

    const sidebar = page.locator('rect[data-region-id="sidebar"]').first();
    await sidebar.click();
    await expect.poll(() => sidebar.getAttribute('aria-pressed')).toBe('true');
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 10, y: 70 }, { x: 140, y: 280 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    await button(page, 'Refine selected region sidebar');
    await confirmIntent(page);
    const refineId = await selectedItemId(page);
    await save(page);

    const result = await materialize(page, [refineId]);
    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ lifecycle: 'imported', approvalRequired: true, supersedesReferenceId: fixture.approvedReferenceId, regionCount: 2 });
    await page.locator(`[data-materialized-reference-id="${result.json.referenceId}"]`).waitFor({ timeout: 10_000 });

    const created = await readReference(projectRoot, result.json.referenceId as string);
    expect(created.lifecycle.state).toBe('imported');
    expect(created.supersedesReferenceId).toBe(fixture.approvedReferenceId);
    expect(created.regions?.map((region) => region.id)).toEqual(['header', 'sidebar']);
    expect(created.regions?.[0]?.rectangle).toEqual({ x: 0, y: 0, width: 400, height: 60 });
    const refined = created.regions?.[1]?.rectangle;
    expectNear(refined?.x as number, 10);
    expectNear(refined?.y as number, 70);
    expectNear(refined?.width as number, 130);
    expectNear(refined?.height as number, 210);
    const newRoot = path.join(projectReferencesRoot(projectRoot), result.json.referenceId as string);
    expect((await imageBytesOf(newRoot)).equals(await imageBytesOf(fixture.importedRoot))).toBe(true);
    expect(await snapshotDirs([fixture.importedRoot, fixture.approvedRoot])).toEqual(sourceBefore);
    const approvedRecords = (await indexRecords(page)).filter((record) => record.family === 'external-reference-approved');
    expect(approvedRecords).toHaveLength(1);
  });

  it('materializes only the selected subset: a created region and a requirement against it, never the unselected create', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    const createA = await drawCreate(page, 'region-a', { x: 200, y: 80 }, { x: 280, y: 140 });
    const createB = await drawCreate(page, 'region-b', { x: 300, y: 160 }, { x: 380, y: 220 });
    const requirementId = await drawPoint(page, 250, 260);
    await page.getByLabel('Requirement category').selectOption('protected');
    await page.getByLabel('Requirement subject').selectOption('region-property');
    await page.getByLabel('Requirement region').selectOption('region-a');
    await page.getByLabel('Region property').selectOption('width');
    await page.getByLabel('Tolerance', { exact: true }).selectOption('absolute-reference-px');
    await page.getByLabel('Tolerance amount').fill('4');
    await button(page, 'Set candidate requirement');
    await confirmIntent(page);
    await save(page);

    const result = await materialize(page, [createA, requirementId]);
    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ regionCount: 3, requirementCount: 5 });
    const created = await readReference(projectRoot, result.json.referenceId as string);
    expect(created.regions?.map((region) => region.id)).toEqual(['header', 'sidebar', 'region-a']);
    expect(created.requirements?.at(-1)).toMatchObject({ category: 'protected', subject: { kind: 'region-property', region: 'region-a', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } });
    expect(JSON.stringify(created)).not.toContain('region-b');
    expect(await page.locator(`[data-materialization-item-id="${createB}"] input[type="checkbox"]`).isChecked()).toBe(false);
  });

  it('keeps informational and candidate items unselectable, and forced API requests for them are rejected without a write', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const dirsBefore = await referenceDirs(projectRoot);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    const inspectId = await drawPoint(page, 300, 100);
    await button(page, 'Mark informational');
    await confirmIntent(page);
    const assetId = await drawPoint(page, 300, 200);
    await button(page, 'Mark asset-sensitive');
    await confirmIntent(page);
    const candidateId = await drawCreate(page, 'candidate-region', { x: 200, y: 220 }, { x: 260, y: 280 }, false);
    expect(await interpretationState(page)).toBe('candidate');
    const saved = await save(page);

    for (const id of [inspectId, assetId]) {
      const row = page.locator(`[data-materialization-item-id="${id}"]`);
      await row.waitFor({ timeout: 5_000 });
      expect(await row.locator('input[type="checkbox"]').isDisabled()).toBe(true);
      expect(await row.textContent()).toContain('Informational annotation intent is not materialized into the external-reference contract.');
    }
    const candidateRow = page.locator(`[data-materialization-item-id="${candidateId}"]`);
    expect(await candidateRow.locator('input[type="checkbox"]').isDisabled()).toBe(true);
    expect(await candidateRow.textContent()).toContain('Candidate intent must be confirmed before materialization.');
    expect(await page.getByRole('button', { name: MATERIALIZE_BUTTON }).isDisabled()).toBe(true);

    const forced = await page.evaluate(
      async ({ handle, ids }) => {
        const session = (await (await fetch('/api/authoring/session')).json()) as { token: string };
        const statuses: number[] = [];
        for (const itemIds of ids) {
          const response = await fetch(`/api/annotations/${encodeURIComponent(handle)}/materialize-reference`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': session.token },
            body: JSON.stringify({ itemIds }),
          });
          statuses.push(response.status);
        }
        return statuses;
      },
      { handle: saved.handle, ids: [[inspectId], [assetId], [candidateId]] },
    );
    expect(forced).toEqual([422, 422, 422]);
    expect(await referenceDirs(projectRoot)).toEqual(dirsBefore);
  });
});
