import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { projectAnnotationsRoot, projectConfigPath, projectContractsRoot, projectEvidenceRoot, projectReferencesRoot } from '../../src/projectWorkflow/projectPaths.js';
import { initializeFrontendObserverProject, loadProjectViewerState } from '../../src/application/projectWorkflowService.js';
import { readPerChangeContract } from '../../src/artifacts/frontendContractArtifactReader.js';
import { readExternalReferenceArtifact } from '../../src/artifacts/externalReferenceArtifactReader.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem } from '../../src/domain/visualAnnotation.js';
import { writeReferenceCandidateFixture, writeRichObservationFixture } from '../support/evidenceFixtures.js';
import { TestResources, authoringHeaders, fetchAuthoringToken, persistAnnotationUnder, rawRequest, readManifest, referenceSourceFor, runtimeSourceFor, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';

/**
 * v0.9 Batch 7 integrated acceptance. Each test drives one complete v0.9
 * workflow through the real Node viewer server, the built React viewer, real
 * Chromium, and the canonical readers/writers. Lower-level behavior already
 * proven by the Batch 3-6 suites is not repeated here.
 */

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');
const OBSERVATION_LABEL = 'annotatable-obs';
const RUNTIME_SVG = 'svg.target-overlay-svg';
const REFERENCE_SVG = 'svg.reference-region-overlay-svg';
/** The 400x300 reference image renders at more than one CSS pixel per image pixel, so pointer rounding stays under one reference pixel. */
const TOLERANCE = 1;

type RunningViewer = Extract<StartViewerResult, { ok: true }>;

let browser: Browser;
const resources = new TestResources();
const openViewers: RunningViewer[] = [];
const openContexts: BrowserContext[] = [];
const openServers: Server[] = [];

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
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await resources.cleanup();
});

afterAll(async () => {
  await browser?.close();
});

// --- shared real-surface helpers -------------------------------------------------------------

async function projectViewer(projectRoot: string): Promise<RunningViewer> {
  const state = await loadProjectViewerState(projectRoot);
  if (!state.ok) throw new Error(state.message);
  const result = await startViewer({ root: state.root, port: 0, assetsRoot: viewerDist, aliasMetadata: { observationAliasesByRelativeDir: state.aliases }, authoringProjectRoot: state.projectRoot });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  openViewers.push(result);
  return result;
}

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  openContexts.push(context);
  return context.newPage();
}

async function openEvidence(page: Page, url: string, label: string, readySelector: string): Promise<void> {
  if (page.url() !== `${url}/`) await page.goto(url);
  const item = page.locator('.evidence-list__item--supported', { hasText: label }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.locator(readySelector).first().waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 10_000 });
}

async function setMode(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: `${label} mode` });
  await button.click();
  await expect.poll(() => button.getAttribute('aria-pressed')).toBe('true');
}

async function sourceToClient(page: Page, svgSelector: string, x: number, y: number): Promise<{ x: number; y: number }> {
  await page.evaluate((selector) => (document.querySelector(selector) as SVGSVGElement).scrollIntoView({ block: 'start', inline: 'nearest' }), svgSelector);
  return page.evaluate(
    ([selector, sx, sy]) => {
      const svg = document.querySelector(selector as string) as SVGSVGElement;
      const point = svg.createSVGPoint();
      point.x = sx as number;
      point.y = sy as number;
      const client = point.matrixTransform(svg.getScreenCTM() as DOMMatrix);
      return { x: client.x, y: client.y };
    },
    [svgSelector, x, y],
  );
}

async function dragSource(page: Page, svgSelector: string, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await sourceToClient(page, svgSelector, from.x, from.y);
  const b = await sourceToClient(page, svgSelector, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function clickSource(page: Page, svgSelector: string, x: number, y: number): Promise<void> {
  const client = await sourceToClient(page, svgSelector, x, y);
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

async function drawRectangle(page: Page, svgSelector: string, from: { x: number; y: number }, to: { x: number; y: number }): Promise<string> {
  const before = await draftItemCount(page);
  await setMode(page, 'Rectangle');
  await dragSource(page, svgSelector, from, to);
  await expect.poll(() => draftItemCount(page)).toBe(before + 1);
  return selectedItemId(page);
}

async function saveAnnotation(page: Page): Promise<{ status: number; json: { annotationId?: string; handle?: string } }> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/annotations' && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save annotation' }).click(),
  ]);
  return { status: response.status(), json: (await response.json()) as { annotationId?: string; handle?: string } };
}

async function saveOk(page: Page): Promise<{ annotationId: string; handle: string }> {
  const result = await saveAnnotation(page);
  expect(result.status, JSON.stringify(result.json)).toBe(201);
  await page.getByRole('status').filter({ hasText: `Saved annotation ${result.json.annotationId}` }).waitFor({ timeout: 10_000 });
  await page.locator(`[data-annotation-id="${result.json.annotationId}"]`).waitFor({ timeout: 10_000 });
  return { annotationId: result.json.annotationId as string, handle: result.json.handle as string };
}

async function loadSaved(page: Page, annotationId: string, expectedItems: number): Promise<void> {
  const savedButton = page.locator(`[data-annotation-id="${annotationId}"]`);
  await savedButton.waitFor({ timeout: 10_000 });
  await savedButton.click();
  await expect.poll(() => draftItemCount(page)).toBe(expectedItems);
}

async function annotationDirs(projectRoot: string): Promise<string[]> {
  return (await readdir(projectAnnotationsRoot(projectRoot)).catch(() => [] as string[])).sort();
}

async function forcedPost(page: Page, route: string, body: unknown): Promise<number> {
  return page.evaluate(
    async ({ path: target, payload }) => {
      const session = (await (await fetch('/api/authoring/session')).json()) as { token: string };
      const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': session.token }, body: JSON.stringify(payload) });
      return response.status;
    },
    { path: route, payload: body },
  );
}

async function snapshotDirs(dirs: string[]): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const dir of dirs) {
    for (const name of await readdir(dir)) snapshot.set(path.join(dir, name), await readFile(path.join(dir, name)));
  }
  return snapshot;
}

function expectNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(TOLERANCE);
}

// --- runtime helpers ---------------------------------------------------------------------------

async function associateTarget(page: Page, name: string): Promise<void> {
  await page.locator('.target-list__item', { hasText: name }).first().click();
  await page.getByRole('button', { name: `Associate target ${name}`, exact: true }).click();
  await expect.poll(() => page.locator('.annotation-panel__association').textContent()).toBe(`Target association: ${name}`);
}

async function setRuntimeIntent(page: Page, operation: string, category: string, direction?: string): Promise<void> {
  await page.getByLabel('Runtime intent operation').selectOption(operation);
  if (direction !== undefined) await page.getByLabel('Move direction').selectOption(direction);
  await page.getByLabel('Intent category').selectOption(category);
  await page.getByRole('button', { name: 'Set candidate intent' }).click();
  await expect.poll(() => interpretationState(page)).toBe('candidate');
  await page.getByRole('button', { name: 'Confirm runtime intent' }).click();
  await expect.poll(() => interpretationState(page)).toBe('confirmed');
}

describe('v0.9 integrated runtime workflow (real Chromium)', () => {
  it('annotates a runtime observation, reloads it from canonical evidence, promotes only confirmed supported intent, and keeps remove, notes, and free marks non-contractual', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project.projectRoot);
    const page = await newPage();
    await openEvidence(page, viewer.url, OBSERVATION_LABEL, `${RUNTIME_SVG} image`);

    // Scenario 3: explicit move right on header.
    const moveId = await drawRectangle(page, RUNTIME_SVG, { x: 30, y: 10 }, { x: 300, y: 70 });
    await associateTarget(page, 'header');
    await setRuntimeIntent(page, 'move', 'requested', 'right');

    // Scenario 5: remove is confirmable but has no primitive.
    const removeId = await drawRectangle(page, RUNTIME_SVG, { x: 20, y: 200 }, { x: 180, y: 480 });
    await associateTarget(page, 'sidebar');
    await setRuntimeIntent(page, 'remove', 'requested');

    // Scenarios 6 and 11: a free rectangle over header and a note stay plain visual evidence.
    const freeId = await drawRectangle(page, RUNTIME_SVG, { x: 40, y: 20 }, { x: 200, y: 60 });
    expect(await page.locator('.annotation-panel__association').getAttribute('data-association-kind')).toBe('none');
    expect(await interpretationState(page)).toBe('uninterpreted');
    await page.getByLabel('Note text for new notes').fill('Integrated acceptance note');
    await setMode(page, 'Note');
    await clickSource(page, RUNTIME_SVG, 600, 300);
    await expect.poll(() => draftItemCount(page)).toBe(4);
    const noteId = await selectedItemId(page);
    const saved = await saveOk(page);

    // Scenario 1: a fresh browser load reloads the same canonical evidence.
    const persisted = await readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(project.projectRoot), saved.annotationId));
    expect(persisted.source).toMatchObject({ kind: 'runtime-observation', observationId: project.observation.observationId, requestId: project.observation.requestId });
    expect(persisted.items.map((item) => item.annotationItemId)).toEqual([moveId, removeId, freeId, noteId]);
    const byId = new Map(persisted.items.map((item) => [item.annotationItemId, item] as const));
    expect(byId.get(moveId)?.interpretation).toMatchObject({ state: 'confirmed', intent: { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'header', property: 'x' } } });
    expect(byId.get(removeId)?.interpretation).toMatchObject({ state: 'confirmed', intent: { kind: 'change', operation: 'remove' } });
    expect(JSON.stringify(byId.get(removeId)?.interpretation)).not.toContain('contractPrimitive');
    expect(byId.get(freeId)).toMatchObject({ interpretation: { state: 'uninterpreted' } });
    expect(byId.get(freeId)?.association).toBeUndefined();
    expect(byId.get(noteId)).toMatchObject({ mark: { kind: 'note', text: 'Integrated acceptance note' }, interpretation: { state: 'uninterpreted' } });

    await page.reload();
    await openEvidence(page, viewer.url, OBSERVATION_LABEL, `${RUNTIME_SVG} image`);
    expect(await draftItemCount(page)).toBe(0);
    await loadSaved(page, saved.annotationId, 4);
    const renderedIds = await page.locator('[data-annotation-item-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-annotation-item-id')));
    expect(renderedIds.sort()).toEqual([moveId, removeId, freeId, noteId].sort());
    const moveMark = byId.get(moveId)?.mark as Extract<VisualAnnotationItem['mark'], { kind: 'rectangle' }>;
    const renderedMove = page.locator(`[data-annotation-item-id="${moveId}"] rect`);
    // Runtime CSS pixels: the rendered SVG rectangle uses the persisted source coordinates exactly.
    expect(Number(await renderedMove.getAttribute('x'))).toBe(moveMark.x);
    expect(Number(await renderedMove.getAttribute('width'))).toBe(moveMark.width);
    expectNear(moveMark.x, 30);
    expectNear(moveMark.width, 270);

    // Scenario 5/6/11 in the UI: only the move item is selectable for promotion.
    const moveRow = page.locator(`[data-promotion-item-id="${moveId}"]`);
    await moveRow.waitFor({ timeout: 10_000 });
    expect(await moveRow.locator('input[type="checkbox"]').isDisabled()).toBe(false);
    expect(await page.locator(`[data-promotion-item-id="${removeId}"] input[type="checkbox"]`).isDisabled()).toBe(true);
    expect(await page.locator(`[data-promotion-item-id="${freeId}"]`).count()).toBe(0);
    expect(await page.locator(`[data-promotion-item-id="${noteId}"]`).count()).toBe(0);

    await moveRow.locator('input[type="checkbox"]').check();
    const [promotion] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/promote-contract') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Promote selected to change contract' }).click(),
    ]);
    expect(promotion.status()).toBe(201);
    const promoted = (await promotion.json()) as { contractId: string; clauseCount: number };
    expect(promoted.clauseCount).toBe(1);
    const contract = await readPerChangeContract(path.join(projectContractsRoot(project.projectRoot), promoted.contractId, 'manifest.json'));
    if (!contract.ok) throw new Error(contract.reason);
    expect(contract.contract).toMatchObject({ contractClass: 'change', schemaVersion: '1.0.0' });
    expect(contract.contract.clauses.map((clause) => [clause.category, clause.primitive])).toEqual([['requested', { kind: 'property-increases', target: 'header', property: 'x' }]]);

    // Forced promotion of remove, a free mark, or a note never fabricates a contract.
    const promoteRoute = `/api/annotations/${encodeURIComponent(saved.handle)}/promote-contract`;
    for (const itemId of [removeId, freeId, noteId]) {
      expect(await forcedPost(page, promoteRoute, { itemIds: [itemId], activateForCheck: false }), itemId).toBe(422);
    }
    expect(await readdir(projectContractsRoot(project.projectRoot))).toEqual([promoted.contractId]);

    // The promoted contract is ordinary evidence in the viewer.
    await page.reload();
    const contractItem = page.locator('.evidence-list__item--supported', { hasText: promoted.contractId }).first();
    await contractItem.waitFor({ timeout: 10_000 });
    await contractItem.click();
    await page.getByText('change-contract', { exact: true }).first().waitFor({ timeout: 10_000 });
    expect(await page.locator('.artifact-preview__raw').textContent()).toContain('"property-increases"');
  });

  it('rejects a second child of a stale revision without overwrite, and keeps an annotation inspectable with an honestly unavailable source', async () => {
    const project = await writeInitializedProject(resources);
    // Another observation exists, so a guessed replacement source would be possible if the product guessed.
    await writeRichObservationFixture(project.root, 'unrelated-obs');
    const viewer = await projectViewer(project.projectRoot);

    const first = await newPage();
    await openEvidence(first, viewer.url, OBSERVATION_LABEL, `${RUNTIME_SVG} image`);
    await setMode(first, 'Point');
    await clickSource(first, RUNTIME_SVG, 300, 300);
    const a = await saveOk(first);
    await first.waitForLoadState('networkidle');

    const second = await newPage();
    await openEvidence(second, viewer.url, OBSERVATION_LABEL, `${RUNTIME_SVG} image`);
    await loadSaved(second, a.annotationId, 1);

    // Scenario 12: B supersedes A from the first page.
    await setMode(first, 'Select');
    await dragSource(first, RUNTIME_SVG, { x: 300, y: 300 }, { x: 350, y: 320 });
    await expect.poll(() => first.locator('.annotation-panel__draft-summary').getAttribute('data-draft-dirty')).toBe('true');
    const b = await saveOk(first);
    const bArtifact = await readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(project.projectRoot), b.annotationId));
    expect(bArtifact.supersedesAnnotationId).toBe(a.annotationId);
    const aManifest = path.join(projectAnnotationsRoot(project.projectRoot), a.annotationId, 'manifest.json');
    const bManifest = path.join(projectAnnotationsRoot(project.projectRoot), b.annotationId, 'manifest.json');
    const aBytes = await readFile(aManifest);
    const bBytes = await readFile(bManifest);

    // The second page still holds stale A and tries to save another child.
    await setMode(second, 'Point');
    await clickSource(second, RUNTIME_SVG, 500, 400);
    await expect.poll(() => draftItemCount(second)).toBe(2);
    const stale = await saveAnnotation(second);
    expect(stale.status).toBe(409);
    await second.getByRole('alert').filter({ hasText: 'Save conflict' }).waitFor({ timeout: 10_000 });
    expect(await draftItemCount(second)).toBe(2);
    expect(await annotationDirs(project.projectRoot)).toEqual([a.annotationId, b.annotationId].sort());
    expect((await readFile(aManifest)).equals(aBytes)).toBe(true);
    expect((await readFile(bManifest)).equals(bBytes)).toBe(true);

    // Scenario 14: the canonical source leaves the evidence root entirely.
    await second.goto('about:blank');
    const moved = path.join(await resources.tempDir('mfo-v09-moved-source-'), 'observation');
    await rename(project.observationRoot, moved);
    await first.reload();
    const annotationItem = first.locator('.evidence-list__item--supported', { hasText: b.annotationId }).first();
    await annotationItem.waitFor({ timeout: 10_000 });
    await annotationItem.click();
    await first.getByText('visual-annotation', { exact: true }).first().waitFor({ timeout: 10_000 });
    expect(await first.locator('.artifact-preview__raw').textContent()).toContain(b.annotationId);
    const view = await first.evaluate(async (handle) => {
      const response = await fetch(`/api/annotations/${encodeURIComponent(handle)}/view`);
      return { status: response.status, body: (await response.json()) as { annotation: { annotationId: string }; source: Record<string, unknown> } };
    }, b.handle);
    expect(view.status).toBe(200);
    expect(view.body.annotation.annotationId).toBe(b.annotationId);
    expect(view.body.source.status).toBe('unavailable');
    expect(view.body.source.handle).toBeUndefined();
    expect(JSON.stringify(view.body.source)).not.toContain('unrelated-obs');
  });
});

describe('v0.9 integrated reference workflow (real Chromium)', () => {
  it('annotates an approved reference in image pixels, reloads it, and materializes a confirmed region and measurement requirement into a new imported revision without touching sources or project acceptance', async () => {
    const projectRoot = await resources.tempDir('mfo-v09-reference-project-');
    const initialized = await initializeFrontendObserverProject({ projectRoot, url: 'http://127.0.0.1:3000', viewport: { width: 1200, height: 800 }, targets: [{ name: 'header', selector: '#header' }], replace: false });
    if (!initialized.ok) throw new Error(initialized.message);
    const fixture = await writeReferenceCandidateFixture(projectEvidenceRoot(projectRoot));
    const config = JSON.parse(await readFile(projectConfigPath(projectRoot), 'utf8')) as Record<string, unknown>;
    const approvedArtifact = path.relative(projectRoot, fixture.approvedRoot).split(path.sep).join('/');
    await writeFile(projectConfigPath(projectRoot), `${JSON.stringify({ ...config, schemaVersion: '1.1.0', acceptance: { reference: { approvedArtifact } } }, null, 2)}\n`);
    const configBefore = await readFile(projectConfigPath(projectRoot));
    const sourcesBefore = await snapshotDirs([fixture.importedRoot, fixture.approvedRoot]);
    const referenceDirsBefore = (await readdir(projectReferencesRoot(projectRoot))).sort();

    const viewer = await projectViewer(projectRoot);
    const page = await newPage();
    await openEvidence(page, viewer.url, 'external-reference-approved', REFERENCE_SVG);

    // Scenario 8: rectangle -> candidate create -> confirm.
    const createId = await drawRectangle(page, REFERENCE_SVG, { x: 200, y: 100 }, { x: 350, y: 200 });
    await page.getByLabel('Proposed region ID').fill('hero-new');
    await page.getByRole('button', { name: 'Create candidate region', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm reference intent', exact: true }).click();
    await expect.poll(() => interpretationState(page)).toBe('confirmed');

    // Scenario 10: a region-measurement requirement against the new region.
    await setMode(page, 'Point');
    await clickSource(page, REFERENCE_SVG, 300, 260);
    await expect.poll(() => draftItemCount(page)).toBe(2);
    const requirementId = await selectedItemId(page);
    await page.getByLabel('Requirement category').selectOption('preserved');
    await page.getByLabel('Requirement subject').selectOption('region-measurement');
    await page.getByLabel('Subject region').selectOption('header');
    await page.getByLabel('Related region').selectOption('hero-new');
    await page.getByLabel('Measurement', { exact: true }).selectOption('vertical-gap');
    await page.getByLabel('Tolerance', { exact: true }).selectOption('exact');
    await page.getByRole('button', { name: 'Set candidate requirement', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm reference intent', exact: true }).click();
    await expect.poll(() => interpretationState(page)).toBe('confirmed');
    const saved = await saveOk(page);

    // Scenario 7: reload from canonical evidence in reference-image pixels.
    const persisted = await readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(projectRoot), saved.annotationId));
    expect(persisted.source).toMatchObject({ kind: 'external-reference', lifecycle: 'approved', referenceId: fixture.approvedReferenceId, imageOwnerReferenceId: fixture.importedReferenceId, coordinateSpace: { kind: 'reference-image-px', width: 400, height: 300 } });
    const createItem = persisted.items.find((item) => item.annotationItemId === createId) as VisualAnnotationItem;
    if (createItem.mark.kind !== 'rectangle') throw new Error('expected a rectangle mark');
    expectNear(createItem.mark.x, 200);
    expectNear(createItem.mark.y, 100);
    expectNear(createItem.mark.width, 150);
    expectNear(createItem.mark.height, 100);

    await page.reload();
    await openEvidence(page, viewer.url, 'external-reference-approved', REFERENCE_SVG);
    await loadSaved(page, saved.annotationId, 2);
    const renderedCreate = page.locator(`[data-annotation-item-id="${createId}"] rect`).first();
    expect(Number(await renderedCreate.getAttribute('x'))).toBe(createItem.mark.x);
    expect(Number(await renderedCreate.getAttribute('height'))).toBe(createItem.mark.height);

    // Scenario 8/10: materialize both confirmed items.
    for (const id of [createId, requirementId]) await page.locator(`[data-materialization-item-id="${id}"] input[type="checkbox"]`).check();
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/materialize-reference') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Materialize selected into new reference revision' }).click(),
    ]);
    expect(response.status()).toBe(201);
    const materialized = (await response.json()) as { referenceId: string; supersedesReferenceId: string; lifecycle: string; approvalRequired: boolean };
    expect(materialized).toMatchObject({ lifecycle: 'imported', approvalRequired: true, supersedesReferenceId: fixture.approvedReferenceId });
    await page.locator(`[data-materialized-reference-id="${materialized.referenceId}"]`).waitFor({ timeout: 10_000 });

    const read = await readExternalReferenceArtifact(path.join(projectReferencesRoot(projectRoot), materialized.referenceId, 'manifest.json'));
    if (!read.ok) throw new Error(read.reason);
    expect(read.artifact.lifecycle.state).toBe('imported');
    expect(read.artifact.supersedesReferenceId).toBe(fixture.approvedReferenceId);
    expect(read.artifact.regions?.map((region) => region.id)).toEqual(['header', 'sidebar', 'hero-new']);
    const requirement = read.artifact.requirements?.at(-1);
    expect(requirement).toMatchObject({ category: 'preserved', subject: { kind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'hero-new', measurement: 'vertical-gap' }, tolerance: { kind: 'exact' } });
    expect(Object.keys(requirement ?? {}).sort()).toEqual(['category', 'requirementId', 'subject', 'tolerance']);

    // Source immutability, exactly one new imported revision, no approval, project acceptance untouched.
    expect(await snapshotDirs([fixture.importedRoot, fixture.approvedRoot])).toEqual(sourcesBefore);
    expect((await readdir(projectReferencesRoot(projectRoot))).sort()).toEqual([...referenceDirsBefore, materialized.referenceId].sort());
    expect((await readFile(projectConfigPath(projectRoot))).equals(configBefore)).toBe(true);

    // The new imported reference is inspectable through the normal reference workspace.
    await page.reload();
    const newReference = page.locator('.evidence-list__item--supported', { hasText: materialized.referenceId }).first();
    await newReference.waitFor({ timeout: 10_000 });
    await newReference.click();
    await page.locator(`${REFERENCE_SVG} rect[data-region-id="hero-new"]`).first().waitFor({ timeout: 10_000 });
    const records = await page.evaluate(async () => ((await (await fetch('/api/index')).json()) as { records: { family: string }[] }).records);
    expect(records.filter((record) => record.family === 'external-reference-approved')).toHaveLength(1);
  });
});

describe('v0.9 integrated authoring security (real Chromium)', () => {
  it('never lets an unrelated browser origin read the authoring capability or write through any authoring POST route', async () => {
    const project = await writeInitializedProject(resources);
    const runtime = await persistAnnotationUnder(project.root, runtimeSourceFor(project.observation), [
      { annotationItemId: 'move', mark: { kind: 'rectangle', x: 10, y: 10, width: 50, height: 40 }, association: { kind: 'runtime-target', target: 'header' }, interpretation: { state: 'confirmed', intent: { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'header', property: 'x' } }, confirmedAt: '2026-09-17T00:00:00.000Z' } },
    ]);
    const reference = await persistAnnotationUnder(project.root, referenceSourceFor(project.imported), [
      { annotationItemId: 'create', mark: { kind: 'rectangle', x: 2, y: 2, width: 10, height: 10 }, interpretation: { state: 'confirmed', intent: { kind: 'reference-region', mode: 'create', region: { id: 'region-a', rectangle: { x: 2, y: 2, width: 10, height: 10 } } }, confirmedAt: '2026-09-17T00:00:00.000Z' } },
    ]);
    const viewer = await projectViewer(project.projectRoot);
    const annotationsBefore = await annotationDirs(project.projectRoot);
    const referencesBefore = (await readdir(path.join(project.root, 'references'))).sort();
    const runtimeHandle = `visual-annotation:${encodeURIComponent(runtime.relativeDir)}`;
    const referenceHandle = `visual-annotation:${encodeURIComponent(reference.relativeDir)}`;
    const routes = [
      { path: '/api/annotations', body: { sourceHandle: 'observation:x', items: [] } },
      { path: `/api/annotations/${encodeURIComponent(runtimeHandle)}/promote-contract`, body: { itemIds: ['move'], activateForCheck: false } },
      { path: `/api/annotations/${encodeURIComponent(referenceHandle)}/materialize-reference`, body: { itemIds: ['create'] } },
    ];

    // A real page served from a different loopback origin.
    const attacker = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>unrelated origin</title>');
    });
    openServers.push(attacker);
    await new Promise<void>((resolve) => attacker.listen(0, '127.0.0.1', () => resolve()));
    const attackerPort = (attacker.address() as { port: number }).port;
    const attackerOrigin = `http://127.0.0.1:${attackerPort}`;
    const page = await newPage();
    await page.goto(`${attackerOrigin}/`);

    const outcome = await page.evaluate(
      async ({ viewerUrl, targets }) => {
        const results: Record<string, string> = {};
        try {
          const session = await fetch(`${viewerUrl}/api/authoring/session`);
          results.session = `readable:${session.status}`;
        } catch {
          results.session = 'blocked';
        }
        for (const target of targets) {
          try {
            const response = await fetch(`${viewerUrl}${target.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': 'f'.repeat(64) }, body: JSON.stringify(target.body) });
            results[`json:${target.path}`] = `readable:${response.status}`;
          } catch {
            results[`json:${target.path}`] = 'blocked';
          }
          // A "simple" cross-origin request is sent without preflight; its response is opaque.
          const simple = await fetch(`${viewerUrl}${target.path}`, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(target.body) });
          results[`simple:${target.path}`] = simple.type;
        }
        return results;
      },
      { viewerUrl: viewer.url, targets: routes },
    );
    expect(outcome.session).toBe('blocked');
    for (const route of routes) {
      expect(outcome[`json:${route.path}`], route.path).toBe('blocked');
      expect(outcome[`simple:${route.path}`], route.path).toBe('opaque');
    }

    // Even with the real session token, the unrelated Origin is refused on all three routes.
    const token = await fetchAuthoringToken(viewer);
    for (const route of routes) {
      const body = JSON.stringify(route.body);
      const response = await rawRequest(viewer, { method: 'POST', path: route.path, headers: { ...authoringHeaders(viewer, token, body), origin: attackerOrigin }, body });
      expect(response.status, route.path).toBe(403);
    }

    expect(await annotationDirs(project.projectRoot)).toEqual(annotationsBefore);
    expect(await readdir(projectContractsRoot(project.projectRoot)).catch(() => [] as string[])).toEqual([]);
    expect((await readdir(path.join(project.root, 'references'))).sort()).toEqual(referencesBefore);
  });
});
