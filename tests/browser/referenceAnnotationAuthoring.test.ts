import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startViewer, type StartViewerOptions, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { projectAnnotationsRoot, projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';
import { initializeFrontendObserverProject } from '../../src/application/projectWorkflowService.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem } from '../../src/domain/visualAnnotation.js';
import type { ExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import { writeReferenceBindingFidelityFixture, writeReferenceCandidateFixture } from '../support/evidenceFixtures.js';
import { TestResources, readManifest } from '../support/annotationAuthoringFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');
/** The 400x300 reference image renders at more than one CSS pixel per image pixel, so pointer rounding stays under one reference pixel. */
const TOLERANCE = 1;
const REFERENCE_SVG = 'svg.reference-region-overlay-svg';

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

async function start(options: Omit<StartViewerOptions, 'port' | 'assetsRoot'>): Promise<RunningViewer> {
  const result = await startViewer({ ...options, port: 0, assetsRoot: viewerDist });
  if (!result.ok) throw new Error(`viewer failed to start: ${JSON.stringify(result.diagnostics)}`);
  openViewers.push(result);
  return result;
}

async function initProject(): Promise<{ projectRoot: string; root: string }> {
  const projectRoot = await resources.tempDir('mfo-reference-annotation-project-');
  const initialized = await initializeFrontendObserverProject({ projectRoot, url: 'http://127.0.0.1:3000', viewport: { width: 1200, height: 800 }, targets: [{ name: 'header', selector: '#header' }], replace: false });
  if (!initialized.ok) throw new Error(initialized.message);
  return { projectRoot, root: projectEvidenceRoot(projectRoot) };
}

async function candidateProject(bindingDeclarations: unknown[] = []) {
  const project = await initProject();
  const fixture = await writeReferenceCandidateFixture(project.root);
  const viewer = await start({ root: project.root, authoringProjectRoot: project.projectRoot, bindingDeclarations });
  return { ...project, fixture, viewer };
}

async function bindingProject(bindingDeclarations: unknown[] = []) {
  const project = await initProject();
  const fixture = await writeReferenceBindingFidelityFixture(project.root);
  const viewer = await start({ root: project.root, authoringProjectRoot: project.projectRoot, bindingDeclarations });
  return { ...project, fixture, viewer };
}

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  openContexts.push(context);
  return context.newPage();
}

async function openReference(page: Page, url: string, family: Family, expectEditable = true): Promise<string> {
  await page.goto(url);
  const item = page.locator('.evidence-list__item--supported', { hasText: family }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.locator(REFERENCE_SVG).waitFor({ timeout: 10_000 });
  if (expectEditable) await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 10_000 });
  else await page.getByText('Read-only viewer', { exact: true }).waitFor({ timeout: 10_000 });
  return page.evaluate(async (wanted) => ((await (await fetch('/api/index')).json()) as { records: { family: string; handle: string }[] }).records.find((r) => r.family === wanted)?.handle as string, family);
}

async function selectCandidate(page: Page, label: string): Promise<void> {
  await page.locator('#reference-candidate-select').selectOption({ label });
  await page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first().waitFor({ timeout: 10_000 });
}

async function setMode(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: `${label} mode` });
  await button.click();
  await expect.poll(() => button.getAttribute('aria-pressed')).toBe('true');
}

/** Scrolls every scrollable ancestor so the whole reference SVG is visible (top aligned), without moving it again during a gesture. */
async function revealReferenceSvg(page: Page): Promise<void> {
  await page.evaluate((selector) => (document.querySelector(selector) as SVGSVGElement).scrollIntoView({ block: 'start', inline: 'nearest' }), REFERENCE_SVG);
}

/** Maps a reference-image point to client coordinates through the SVG's own current CTM. */
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

async function referenceViewBox(page: Page): Promise<string> {
  return (await page.locator(REFERENCE_SVG).getAttribute('viewBox')) as string;
}

async function selectedIntent(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse((await page.locator('pre[data-candidate-intent]').textContent()) as string) as Record<string, unknown>;
}

async function interpretationState(page: Page): Promise<string | null> {
  return page.locator('.annotation-panel__interpretation').getAttribute('data-interpretation-state');
}

async function button(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

async function save(page: Page): Promise<{ status: number; json: { annotationId?: string; handle?: string } }> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/annotations' && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save annotation' }).click(),
  ]);
  return { status: response.status(), json: (await response.json()) as { annotationId?: string; handle?: string } };
}

async function saveOk(page: Page): Promise<{ annotationId: string; handle: string }> {
  const result = await save(page);
  expect(result.status, JSON.stringify(result.json)).toBe(201);
  await page.getByRole('status').filter({ hasText: `Saved annotation ${result.json.annotationId}` }).waitFor({ timeout: 10_000 });
  return { annotationId: result.json.annotationId as string, handle: result.json.handle as string };
}

async function persisted(projectRoot: string, annotationId: string): Promise<VisualAnnotationArtifact> {
  return readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(projectRoot), annotationId));
}

function expectNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(TOLERANCE);
}

function markOf<K extends VisualAnnotationItem['mark']['kind']>(artifact: VisualAnnotationArtifact, kind: K): Extract<VisualAnnotationItem['mark'], { kind: K }> {
  const item = artifact.items.find((candidate) => candidate.mark.kind === kind);
  if (item === undefined) throw new Error(`no ${kind} mark persisted`);
  return item.mark as Extract<VisualAnnotationItem['mark'], { kind: K }>;
}

async function referenceRelationships(page: Page, handle: string): Promise<{ kind: string; subjectRegion: string; relatedRegion: string }[]> {
  return page.evaluate(async (h) => ((await (await fetch(`/api/references/${h}/view`)).json()) as { regionRelationships: { pairwiseRelationships: { kind: string; subjectRegion: string; relatedRegion: string }[] } }).regionRelationships.pairwiseRelationships, handle);
}

/** Byte snapshot of every file in the given artifact directories (source manifests and owned images). */
async function snapshotDirs(dirs: string[]): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const dir of dirs) {
    for (const name of await readdir(dir)) snapshot.set(path.join(dir, name), await readFile(path.join(dir, name)));
  }
  return snapshot;
}

async function referenceArtifactCount(page: Page): Promise<number> {
  return page.evaluate(async () => ((await (await fetch('/api/index')).json()) as { records: { family: string }[] }).records.filter((r) => r.family.startsWith('external-reference')).length);
}

function recordRequests(page: Page): { method: string; path: string }[] {
  const requests: { method: string; path: string }[] = [];
  page.on('request', (request) => requests.push({ method: request.method(), path: new URL(request.url()).pathname }));
  return requests;
}

describe('reference annotation availability and source identity', () => {
  it('offers reference annotation authoring in a project-aware viewer and stays read-only standalone without any POST', async () => {
    const { viewer } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');
    for (const label of ['Select', 'Pan', 'Point', 'Rectangle', 'Line', 'Arrow', 'Note']) {
      expect(await page.getByRole('button', { name: `${label} mode` }).count()).toBe(1);
    }
    expect(await page.getByRole('button', { name: 'Save annotation' }).count()).toBe(1);

    const standaloneRoot = await resources.tempDir('mfo-reference-standalone-');
    await writeReferenceCandidateFixture(standaloneRoot);
    const standalone = await start({ root: standaloneRoot });
    const readOnlyPage = await newPage();
    const requests = recordRequests(readOnlyPage);
    await openReference(readOnlyPage, standalone.url, 'external-reference-imported', false);
    for (const label of ['Point', 'Rectangle', 'Line', 'Arrow', 'Note']) {
      expect(await readOnlyPage.getByRole('button', { name: `${label} mode` }).count()).toBe(0);
    }
    expect(await readOnlyPage.getByRole('button', { name: 'Save annotation' }).count()).toBe(0);
    expect(await readOnlyPage.getByRole('button', { name: 'Confirm reference intent' }).count()).toBe(0);
    const headerRegion = readOnlyPage.locator('rect[data-region-id="header"]').first();
    await headerRegion.click();
    await expect.poll(() => headerRegion.getAttribute('aria-pressed')).toBe('true');
    expect(requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')).toEqual([]);
  });

  it('annotates an imported reference in exact reference-image pixels with the imported source identity', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 250, y: 200 }, { x: 50, y: 80 });
    await page.getByLabel('Note text for new notes').fill('Hero spacing');
    await setMode(page, 'Note');
    await clickSource(page, 300, 250);
    await expect.poll(() => draftItemCount(page)).toBe(2);
    const { annotationId } = await saveOk(page);

    const artifact = await persisted(projectRoot, annotationId);
    const imported = await readManifest<ExternalReferenceArtifact>(fixture.importedRoot);
    expect(artifact.source).toMatchObject({
      kind: 'external-reference',
      lifecycle: 'imported',
      referenceId: fixture.importedReferenceId,
      imageOwnerReferenceId: fixture.importedReferenceId,
      coordinateSpace: { kind: 'reference-image-px', width: 400, height: 300 },
    });
    if ('image' in imported) expect(artifact.source).toMatchObject({ imageSha256: imported.image.sha256 });
    const rect = markOf(artifact, 'rectangle');
    expectNear(rect.x, 50);
    expectNear(rect.y, 80);
    expectNear(rect.width, 200);
    expectNear(rect.height, 120);
    expect(markOf(artifact, 'note').text).toBe('Hero spacing');
  });

  it('annotates an approved reference with the approved identity and the imported image owner, drawing all five mark kinds', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-approved');

    await setMode(page, 'Point');
    await clickSource(page, 30, 30);
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 150, y: 90 }, { x: 250, y: 150 });
    await setMode(page, 'Line');
    await dragSource(page, { x: 150, y: 200 }, { x: 350, y: 220 });
    await setMode(page, 'Arrow');
    await dragSource(page, { x: 150, y: 260 }, { x: 380, y: 280 });
    await page.getByLabel('Note text for new notes').fill('Approved note');
    await setMode(page, 'Note');
    await clickSource(page, 300, 100);
    await expect.poll(() => draftItemCount(page)).toBe(5);
    const { annotationId } = await saveOk(page);

    const artifact = await persisted(projectRoot, annotationId);
    expect(artifact.source).toMatchObject({ kind: 'external-reference', lifecycle: 'approved', referenceId: fixture.approvedReferenceId, imageOwnerReferenceId: fixture.importedReferenceId });
    expect(artifact.source.coordinateSpace).toEqual({ kind: 'reference-image-px', width: 400, height: 300 });
    expect(artifact.items.map((item) => item.mark.kind).sort()).toEqual(['arrow', 'line', 'note', 'point', 'rectangle']);
    const point = markOf(artifact, 'point');
    expectNear(point.x, 30);
    expectNear(point.y, 30);
    const arrow = markOf(artifact, 'arrow');
    expectNear(arrow.end.x, 380);
    expectNear(arrow.end.y, 280);
    for (const item of artifact.items) expect(item.interpretation).toEqual({ state: 'uninterpreted' });
  });
});

describe('reference coordinates under zoom, pan, and view lock', () => {
  it('keeps exact reference-image coordinates when drawing zoomed and after panning, with pan and draw exclusive', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    for (let i = 0; i < 2; i += 1) await page.getByRole('button', { name: 'Zoom in reference' }).click();
    await expect.poll(() => referenceViewBox(page)).not.toBe('0 0 400 300');
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 180, y: 130 }, { x: 230, y: 170 });
    await expect.poll(() => draftItemCount(page)).toBe(1);

    await page.getByRole('button', { name: 'Zoom in reference' }).click();
    await setMode(page, 'Pan');
    const beforePan = await referenceViewBox(page);
    await dragSource(page, { x: 200, y: 150 }, { x: 170, y: 130 });
    const afterPan = await referenceViewBox(page);
    expect(afterPan).not.toBe(beforePan);
    expect(await draftItemCount(page)).toBe(1);

    const [minX, minY, width, height] = afterPan.split(' ').map(Number) as [number, number, number, number];
    const start = { x: minX + width * 0.2, y: minY + height * 0.3 };
    const end = { x: minX + width * 0.5, y: minY + height * 0.6 };
    await setMode(page, 'Rectangle');
    await dragSource(page, start, end);
    await expect.poll(() => draftItemCount(page)).toBe(2);
    expect(await referenceViewBox(page)).toBe(afterPan);

    const { annotationId } = await saveOk(page);
    const [zoomed, panned] = (await persisted(projectRoot, annotationId)).items.map((item) => item.mark) as [VisualAnnotationItem['mark'], VisualAnnotationItem['mark']];
    if (zoomed.kind !== 'rectangle' || panned.kind !== 'rectangle') throw new Error('expected rectangles');
    expectNear(zoomed.x, 180);
    expectNear(zoomed.y, 130);
    expectNear(zoomed.width, 50);
    expectNear(zoomed.height, 40);
    expectNear(panned.x, start.x);
    expectNear(panned.y, start.y);
    expectNear(panned.width, end.x - start.x);
    expectNear(panned.height, end.y - start.y);
  });

  it('keeps the view lock working while annotations stay on the reference in reference pixels, with bindings unchanged', async () => {
    const { viewer, projectRoot } = await bindingProject([{ referenceRegion: 'header', runtimeTarget: 'header' }]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-approved');
    await selectCandidate(page, 'rc-fidelity-pass');
    await page.locator('.clause-row--pass', { hasText: 'header → header' }).waitFor({ timeout: 10_000 });

    const lock = page.getByRole('button', { name: /lock view/i });
    await expect.poll(() => lock.isEnabled()).toBe(true);
    await lock.click();
    const candidateSvg = page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg)').first();
    const candidateBefore = await candidateSvg.getAttribute('viewBox');
    await page.getByRole('button', { name: 'Zoom in reference' }).click();
    await expect.poll(() => candidateSvg.getAttribute('viewBox')).not.toBe(candidateBefore);
    const candidateLocked = await candidateSvg.getAttribute('viewBox');

    const [minX, minY, width, height] = (await referenceViewBox(page)).split(' ').map(Number) as [number, number, number, number];
    const start = { x: minX + width * 0.3, y: minY + height * 0.3 };
    const end = { x: minX + width * 0.6, y: minY + height * 0.6 };
    await setMode(page, 'Rectangle');
    await dragSource(page, start, end);
    await expect.poll(() => draftItemCount(page)).toBe(1);

    expect(await candidateSvg.getAttribute('viewBox')).toBe(candidateLocked);
    expect(await candidateSvg.locator('[data-annotation-item-id]').count()).toBe(0);
    expect(await page.locator('.clause-row--pass', { hasText: 'header → header' }).count()).toBe(1);

    const { annotationId } = await saveOk(page);
    const artifact = await persisted(projectRoot, annotationId);
    expect(artifact.source.coordinateSpace).toEqual({ kind: 'reference-image-px', width: 400, height: 300 });
    const rect = markOf(artifact, 'rectangle');
    // Reference pixels, never mapped through the 0.25 reference/candidate scale.
    expectNear(rect.x, start.x);
    expectNear(rect.y, start.y);
    expectNear(rect.width, end.x - start.x);
    expect(artifact.items[0]?.association).toBeUndefined();
    expect(await candidateSvg.locator('rect[data-target-name="header"]').first().getAttribute('data-target-name')).toBe('header');
  });
});

describe('explicit reference associations', () => {
  it('never auto-binds equal names and associates a region only through the explicit action', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-approved');
    await selectCandidate(page, 'rc-compatible');
    await page.getByText('No binding declarations were supplied').waitFor({ timeout: 10_000 });

    // Draw inside the "header" region (0,0,400,60); the candidate also has a runtime target named "header".
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 40, y: 10 }, { x: 200, y: 50 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    expect(await page.locator('.annotation-panel__association').getAttribute('data-association-kind')).toBe('none');
    expect(await page.locator('rect[data-region-id="header"]').first().getAttribute('aria-pressed')).toBe('false');

    await setMode(page, 'Select');
    await page.locator('rect[data-region-id="header"]').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('rect[data-region-id="header"]').first().getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('.annotation-panel__association').getAttribute('data-association-kind')).toBe('none');
    await button(page, 'Associate region header');
    await expect.poll(() => page.locator('.annotation-panel__association').textContent()).toBe('Region association: header');

    const candidateHeader = page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg) rect[data-target-name="header"]').first();
    expect(await candidateHeader.getAttribute('class')).not.toMatch(/target-overlay-svg__rect--highlighted/);
    expect(await candidateHeader.getAttribute('aria-pressed')).toBe('false');

    const { annotationId } = await saveOk(page);
    const artifact = await persisted(projectRoot, annotationId);
    expect(artifact.items[0]?.association).toEqual({ kind: 'reference-region', regionId: 'header' });
    expect(JSON.stringify(artifact)).not.toContain('runtime-target');
  });

  it('associates a canonical region relationship chosen explicitly from the server graph', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const page = await newPage();
    const handle = await openReference(page, viewer.url, 'external-reference-imported');
    const relationship = (await referenceRelationships(page, handle))[0];
    if (relationship === undefined) throw new Error('fixture has no canonical region relationship');

    await setMode(page, 'Arrow');
    await dragSource(page, { x: 60, y: 30 }, { x: 60, y: 200 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    expect(await page.locator('.annotation-panel__association').getAttribute('data-association-kind')).toBe('none');

    await page.getByLabel('Canonical region relationship to associate').selectOption({ label: `${relationship.subjectRegion} ${relationship.kind} ${relationship.relatedRegion}` });
    await button(page, 'Associate relationship');
    const { annotationId } = await saveOk(page);
    expect((await persisted(projectRoot, annotationId)).items[0]?.association).toEqual({
      kind: 'reference-relationship',
      subjectRegion: relationship.subjectRegion,
      relatedRegion: relationship.relatedRegion,
      relationship: relationship.kind,
    });
  });

  it('keeps explicit binding cross-highlighting separate from annotation association', async () => {
    const { viewer, projectRoot } = await bindingProject([
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-approved');
    await selectCandidate(page, 'rc-fidelity-pass');
    await page.locator('.clause-row--pass', { hasText: 'header → header' }).waitFor({ timeout: 10_000 });

    const referenceHeader = page.locator('rect[data-region-id="header"]').first();
    const candidateHeader = page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg) rect[data-target-name="header"]').first();
    await referenceHeader.click();
    await expect.poll(() => candidateHeader.getAttribute('class')).toMatch(/target-overlay-svg__rect--highlighted/);

    const candidateSidebar = page.locator('.comparison-pane .target-overlay-svg:not(.reference-region-overlay-svg) rect[data-target-name="sidebar"]').first();
    await candidateSidebar.click();
    const referenceSidebar = page.locator('rect[data-region-id="sidebar"]').first();
    await expect.poll(() => referenceSidebar.getAttribute('class')).toMatch(/target-overlay-svg__rect--highlighted/);

    await setMode(page, 'Point');
    await clickSource(page, 300, 200);
    await expect.poll(() => draftItemCount(page)).toBe(1);
    await button(page, 'Associate region header');
    await expect.poll(() => page.locator('.annotation-panel__association').textContent()).toBe('Region association: header');

    // Binding highlights are unchanged by the annotation association.
    expect(await candidateHeader.getAttribute('class')).toMatch(/target-overlay-svg__rect--highlighted/);
    expect(await referenceSidebar.getAttribute('class')).toMatch(/target-overlay-svg__rect--highlighted/);
    const { annotationId } = await saveOk(page);
    expect((await persisted(projectRoot, annotationId)).items[0]?.association).toEqual({ kind: 'reference-region', regionId: 'header' });
  });
});

describe('candidate regions', () => {
  it('creates a candidate region with a visible preview, re-requires confirmation after a move, and never changes the source reference', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const before = await snapshotDirs([fixture.importedRoot, fixture.approvedRoot]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 200, y: 100 }, { x: 350, y: 200 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    const rectMark = page.locator('[data-annotation-kind="rectangle"] rect');
    const geometry = async () => ({ x: Number(await rectMark.getAttribute('x')), y: Number(await rectMark.getAttribute('y')), width: Number(await rectMark.getAttribute('width')), height: Number(await rectMark.getAttribute('height')) });
    const drawn = await geometry();

    // Obvious duplicates are refused without rewriting the id.
    await page.getByLabel('Proposed region ID').fill('HEADER');
    expect(await page.getByRole('button', { name: 'Create candidate region' }).isDisabled()).toBe(true);
    await page.getByLabel('Proposed region ID').fill('new-region');
    await button(page, 'Create candidate region');
    expect(await selectedIntent(page)).toEqual({ kind: 'reference-region', mode: 'create', region: { id: 'new-region', rectangle: drawn } });
    expect(await interpretationState(page)).toBe('candidate');
    await page.locator('[data-candidate-region-id="new-region"][data-candidate-mode="create"]').waitFor({ timeout: 5_000 });
    expect(await page.locator('.annotation-panel__candidates').getAttribute('data-candidate-creates')).toBe('1');

    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');
    const firstConfirmation = (await page.locator('.annotation-panel__interpretation').textContent()) as string;

    await setMode(page, 'Select');
    await dragSource(page, { x: 275, y: 150 }, { x: 255, y: 140 });
    await expect.poll(() => interpretationState(page)).toBe('candidate');
    const moved = await geometry();
    expect(moved).not.toEqual(drawn);
    expect(await selectedIntent(page)).toEqual({ kind: 'reference-region', mode: 'create', region: { id: 'new-region', rectangle: moved } });

    await page.waitForTimeout(5); // guarantees a distinct ISO timestamp
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');
    expect(await page.locator('.annotation-panel__interpretation').textContent()).not.toBe(firstConfirmation);

    const { annotationId } = await saveOk(page);
    const item = (await persisted(projectRoot, annotationId)).items[0] as VisualAnnotationItem;
    expect(item.interpretation.state).toBe('confirmed');
    if (item.interpretation.state !== 'confirmed' || item.mark.kind !== 'rectangle') throw new Error('expected confirmed rectangle');
    expect(item.interpretation.intent).toEqual({ kind: 'reference-region', mode: 'create', region: { id: 'new-region', rectangle: { x: item.mark.x, y: item.mark.y, width: item.mark.width, height: item.mark.height } } });
    expect(await snapshotDirs([fixture.importedRoot, fixture.approvedRoot])).toEqual(before);
  });

  it('refines an explicitly selected region, showing the original and the candidate while the source region stays unchanged', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const before = await snapshotDirs([fixture.importedRoot, fixture.approvedRoot]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-approved');

    const sidebar = page.locator('rect[data-region-id="sidebar"]').first();
    await sidebar.click();
    await expect.poll(() => sidebar.getAttribute('aria-pressed')).toBe('true');
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 10, y: 70 }, { x: 140, y: 280 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    await button(page, 'Refine selected region sidebar');

    const intent = await selectedIntent(page);
    expect(intent).toMatchObject({ kind: 'reference-region', mode: 'refine', region: { id: 'sidebar' } });
    expect(await page.locator('.annotation-panel__association').textContent()).toBe('Region association: sidebar');
    const preview = page.locator('[data-candidate-region-id="sidebar"][data-candidate-mode="refine"]');
    await preview.waitFor({ timeout: 5_000 });
    expect(await preview.locator('[data-preview-role="original"]').getAttribute('width')).toBe('120');
    expect(await preview.locator('[data-preview-role="candidate"]').count()).toBe(1);
    // The persisted source region is still rendered with its original geometry.
    expect(await sidebar.getAttribute('width')).toBe('120');
    expect(await sidebar.getAttribute('height')).toBe('240');
    expect(await page.locator('.annotation-panel__candidates').getAttribute('data-candidate-refinements')).toBe('1');

    const { annotationId } = await saveOk(page);
    const item = (await persisted(projectRoot, annotationId)).items[0] as VisualAnnotationItem;
    if (item.mark.kind !== 'rectangle' || item.interpretation.state !== 'candidate') throw new Error('expected candidate rectangle');
    expect(item.association).toEqual({ kind: 'reference-region', regionId: 'sidebar' });
    expect(item.interpretation.intent).toEqual({ kind: 'reference-region', mode: 'refine', region: { id: 'sidebar', rectangle: { x: item.mark.x, y: item.mark.y, width: item.mark.width, height: item.mark.height } } });
    expectNear(item.mark.x, 10);
    expectNear(item.mark.height, 210);
    expect(await snapshotDirs([fixture.importedRoot, fixture.approvedRoot])).toEqual(before);
  });
});

describe('informational and asset-sensitive intent', () => {
  it('records informational and asset-sensitive intent only through explicit actions and confirmation', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const before = await snapshotDirs([fixture.importedRoot]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    await setMode(page, 'Point');
    await clickSource(page, 300, 100);
    await button(page, 'Mark informational');
    expect(await selectedIntent(page)).toEqual({ kind: 'inspect' });
    expect(await interpretationState(page)).toBe('candidate');
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');

    await clickSource(page, 300, 200);
    await expect.poll(() => draftItemCount(page)).toBe(2);
    await button(page, 'Mark asset-sensitive');
    expect(await selectedIntent(page)).toEqual({ kind: 'asset-sensitive' });

    await setMode(page, 'Select');
    const headerRegion = page.locator('rect[data-region-id="header"]').first();
    await headerRegion.click();
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 20, y: 10 }, { x: 120, y: 50 });
    await expect.poll(() => draftItemCount(page)).toBe(3);
    await button(page, 'Mark asset-sensitive for region header');
    expect(await selectedIntent(page)).toEqual({ kind: 'asset-sensitive', regionId: 'header' });
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');

    const { annotationId } = await saveOk(page);
    const items = (await persisted(projectRoot, annotationId)).items;
    expect(items.map((item) => item.interpretation.state)).toEqual(['confirmed', 'candidate', 'confirmed']);
    expect(items.map((item) => (item.interpretation.state === 'uninterpreted' ? undefined : item.interpretation.intent))).toEqual([{ kind: 'inspect' }, { kind: 'asset-sensitive' }, { kind: 'asset-sensitive', regionId: 'header' }]);
    for (const item of items) if (item.interpretation.state === 'confirmed') expect(Number.isNaN(Date.parse(item.interpretation.confirmedAt))).toBe(false);
    expect(await snapshotDirs([fixture.importedRoot])).toEqual(before);
  });
});

describe('candidate reference requirements', () => {
  async function drawPointAndOpenForm(page: Page): Promise<void> {
    await setMode(page, 'Point');
    await clickSource(page, 300, 250);
    await expect.poll(() => draftItemCount(page)).toBe(1);
  }

  it('authors a protected region-property requirement with a reference-pixel tolerance, confirms it, and leaves source requirements unchanged', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const before = await snapshotDirs([fixture.importedRoot]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');
    await drawPointAndOpenForm(page);

    await page.getByLabel('Requirement category').selectOption('protected');
    await page.getByLabel('Requirement subject').selectOption('region-property');
    await page.getByLabel('Requirement region').selectOption('header');
    await page.getByLabel('Region property').selectOption('width');
    await page.getByLabel('Tolerance', { exact: true }).selectOption('absolute-reference-px');
    expect(await page.getByLabel('Tolerance', { exact: true }).locator('option:checked').textContent()).toContain('reference-image pixels');
    await page.getByLabel('Tolerance amount').fill('4');
    await button(page, 'Set candidate requirement');
    const expected = { category: 'protected', subject: { kind: 'region-property', region: 'header', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } };
    expect(await selectedIntent(page)).toEqual({ kind: 'reference-requirement', requirement: expected });
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');

    const { annotationId } = await saveOk(page);
    const item = (await persisted(projectRoot, annotationId)).items[0] as VisualAnnotationItem;
    expect(item.interpretation).toMatchObject({ state: 'confirmed', intent: { kind: 'reference-requirement', requirement: expected } });
    expect(await snapshotDirs([fixture.importedRoot])).toEqual(before);
    const imported = await readManifest<ExternalReferenceArtifact>(fixture.importedRoot);
    expect(imported.requirements).toHaveLength(4);
  });

  it('requires an expected-dependent mode and omits the mode for other categories', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');
    await drawPointAndOpenForm(page);

    await page.getByLabel('Requirement category').selectOption('expected-dependent');
    await page.getByLabel('Requirement subject').selectOption('region-measurement');
    await page.getByLabel('Subject region').selectOption('header');
    await page.getByLabel('Related region').selectOption('sidebar');
    await page.getByLabel('Measurement', { exact: true }).selectOption('center-x-delta');
    await page.getByLabel('Tolerance', { exact: true }).selectOption('exact');
    const setButton = page.getByRole('button', { name: 'Set candidate requirement' });
    expect(await setButton.isDisabled()).toBe(true);
    await page.getByLabel('Expected-dependent mode').selectOption('permitted');
    expect(await setButton.isDisabled()).toBe(false);
    await setButton.click();
    expect(await selectedIntent(page)).toMatchObject({ requirement: { category: 'expected-dependent', expectedDependentMode: 'permitted' } });

    await page.getByLabel('Requirement category').selectOption('requested');
    expect(await page.getByLabel('Expected-dependent mode').count()).toBe(0);
    await setButton.click();
    const intent = await selectedIntent(page);
    expect(intent).toMatchObject({ requirement: { category: 'requested' } });
    expect('expectedDependentMode' in ((intent as { requirement: Record<string, unknown> }).requirement)).toBe(false);

    const { annotationId } = await saveOk(page);
    const item = (await persisted(projectRoot, annotationId)).items[0] as VisualAnnotationItem;
    expect(item.interpretation.state === 'candidate' && item.interpretation.intent.kind === 'reference-requirement' ? 'expectedDependentMode' in item.interpretation.intent.requirement : true).toBe(false);
  });

  it('authors a region-relationship requirement only from canonical relationships, with no tolerance', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const page = await newPage();
    const handle = await openReference(page, viewer.url, 'external-reference-imported');
    const relationship = (await referenceRelationships(page, handle))[0];
    if (relationship === undefined) throw new Error('fixture has no canonical region relationship');

    // A candidate-created region never appears as a relationship subject.
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 200, y: 100 }, { x: 350, y: 200 });
    await page.getByLabel('Proposed region ID').fill('new-region');
    await button(page, 'Create candidate region');

    await setMode(page, 'Point');
    await clickSource(page, 300, 250);
    await expect.poll(() => draftItemCount(page)).toBe(2);
    await page.getByLabel('Requirement category').selectOption('preserved');
    await page.getByLabel('Requirement subject').selectOption('region-relationship');
    const options = await page.getByLabel('Requirement relationship').locator('option').allTextContents();
    expect(options.some((option) => option.includes('new-region'))).toBe(false);
    expect(await page.getByLabel('Tolerance', { exact: true }).count()).toBe(0);
    await page.getByLabel('Requirement relationship').selectOption({ label: `${relationship.subjectRegion} ${relationship.kind} ${relationship.relatedRegion}` });
    await button(page, 'Set candidate requirement');
    const expected = { category: 'preserved', subject: { kind: 'region-relationship', subjectRegion: relationship.subjectRegion, relatedRegion: relationship.relatedRegion, relationship: relationship.kind } };
    expect(await selectedIntent(page)).toEqual({ kind: 'reference-requirement', requirement: expected });
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');

    const { annotationId } = await saveOk(page);
    const requirementItem = (await persisted(projectRoot, annotationId)).items[1] as VisualAnnotationItem;
    expect(requirementItem.interpretation).toMatchObject({ state: 'confirmed', intent: { kind: 'reference-requirement', requirement: expected } });
    expect(JSON.stringify(requirementItem)).not.toContain('tolerance');
  });

  it('authors a region-measurement requirement with a percent tolerance and never stores a computed value, and invalidates confirmation on edits', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');
    await drawPointAndOpenForm(page);

    await page.getByLabel('Requirement category').selectOption('requested');
    await page.getByLabel('Requirement subject').selectOption('region-measurement');
    await page.getByLabel('Subject region').selectOption('header');
    await page.getByLabel('Related region').selectOption('sidebar');
    await page.getByLabel('Measurement', { exact: true }).selectOption('vertical-gap');
    await page.getByLabel('Tolerance', { exact: true }).selectOption('percent');
    await page.getByLabel('Tolerance amount').fill('150');
    expect(await page.getByRole('button', { name: 'Set candidate requirement' }).isDisabled()).toBe(true);
    await page.getByLabel('Tolerance amount').fill('10');
    await button(page, 'Set candidate requirement');
    const expected = { category: 'requested', subject: { kind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'sidebar', measurement: 'vertical-gap' }, tolerance: { kind: 'percent', amount: 10 } };
    expect(await selectedIntent(page)).toEqual({ kind: 'reference-requirement', requirement: expected });
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');

    // Changing the tolerance re-requires confirmation.
    await page.getByLabel('Tolerance amount').fill('12');
    await button(page, 'Set candidate requirement');
    await expect.poll(() => interpretationState(page)).toBe('candidate');
    expect(await page.locator('.annotation-panel__interpretation').textContent()).not.toContain(' at ');
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');

    // Changing the association of a confirmed item also re-requires confirmation. Regions are selectable in Select mode.
    await setMode(page, 'Select');
    await page.locator('rect[data-region-id="sidebar"]').first().click();
    await button(page, 'Associate region sidebar');
    await expect.poll(() => interpretationState(page)).toBe('candidate');
    expect(await selectedIntent(page)).toMatchObject({ requirement: { tolerance: { kind: 'percent', amount: 12 } } });
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');

    const { annotationId } = await saveOk(page);
    const item = (await persisted(projectRoot, annotationId)).items[0] as VisualAnnotationItem;
    expect(item.interpretation).toMatchObject({ state: 'confirmed', intent: { kind: 'reference-requirement', requirement: { ...expected, tolerance: { kind: 'percent', amount: 12 } } } });
    const requirementKeys = item.interpretation.state === 'confirmed' && item.interpretation.intent.kind === 'reference-requirement' ? Object.keys(item.interpretation.intent.requirement).sort() : [];
    expect(requirementKeys).toEqual(['category', 'subject', 'tolerance']);
  });

  it('never turns drawn geometry over a region into a requirement, and saving never confirms', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const before = await snapshotDirs([fixture.importedRoot]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 10, y: 5 }, { x: 390, y: 55 });
    await setMode(page, 'Point');
    await clickSource(page, 200, 200);
    await button(page, 'Mark informational');
    await expect.poll(() => draftItemCount(page)).toBe(2);
    const { annotationId } = await saveOk(page);

    const items = (await persisted(projectRoot, annotationId)).items;
    expect(items[0]?.interpretation).toEqual({ state: 'uninterpreted' });
    expect(items[1]?.interpretation).toEqual({ state: 'candidate', intent: { kind: 'inspect' } });
    expect(JSON.stringify(items)).not.toContain('reference-requirement');
    expect(await snapshotDirs([fixture.importedRoot])).toEqual(before);
  });
});

describe('reference save, reload, revision, and immutability', () => {
  it('reloads marks, associations, and candidate/confirmed intent from canonical evidence on the exact reference', async () => {
    const { viewer, projectRoot } = await candidateProject();
    const page = await newPage();
    const handle = await openReference(page, viewer.url, 'external-reference-approved');

    await setMode(page, 'Line');
    await dragSource(page, { x: 150, y: 120 }, { x: 300, y: 160 });
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 200, y: 180 }, { x: 330, y: 280 });
    await page.getByLabel('Proposed region ID').fill('promo');
    await button(page, 'Create candidate region');
    await setMode(page, 'Point');
    await clickSource(page, 350, 90);
    await page.getByLabel('Requirement category').selectOption('protected');
    await page.getByLabel('Requirement subject').selectOption('region-property');
    await page.getByLabel('Requirement region').selectOption('promo');
    await page.getByLabel('Region property').selectOption('height');
    await page.getByLabel('Tolerance', { exact: true }).selectOption('exact');
    await button(page, 'Set candidate requirement');
    await button(page, 'Confirm reference intent');
    await clickSource(page, 380, 20);
    await button(page, 'Mark asset-sensitive');
    await expect.poll(() => draftItemCount(page)).toBe(4);
    const saved = await saveOk(page);
    const artifact = await persisted(projectRoot, saved.annotationId);

    await page.reload();
    const item = page.locator('.evidence-list__item--supported', { hasText: 'external-reference-approved' }).first();
    await item.waitFor({ timeout: 10_000 });
    await item.click();
    await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 10_000 });
    expect(await draftItemCount(page)).toBe(0);
    const savedButton = page.locator(`[data-annotation-id="${saved.annotationId}"]`);
    await savedButton.waitFor({ timeout: 10_000 });
    await savedButton.click();
    await expect.poll(() => draftItemCount(page)).toBe(4);

    const renderedIds = await page.locator(`${REFERENCE_SVG} [data-annotation-item-id]`).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-annotation-item-id')));
    expect(renderedIds).toEqual(artifact.items.map((i) => i.annotationItemId));
    await page.locator('[data-candidate-region-id="promo"]').waitFor({ timeout: 5_000 });
    expect(artifact.items.map((i) => i.interpretation.state)).toEqual(['uninterpreted', 'candidate', 'confirmed', 'candidate']);
    const view = await page.evaluate(async (h) => (await (await fetch(`/api/annotations/${encodeURIComponent(h)}/view`)).json()) as { annotation: VisualAnnotationArtifact; source: { handle: string; mediaRole: string } }, saved.handle);
    expect(view.source.handle).toBe(handle);
    expect(view.source.mediaRole).toBe('source-image');
    expect(view.annotation).toEqual(artifact);
  });

  it('saves a revision, keeps the parent unchanged, never materializes a reference, and leaves every source file byte-identical', async () => {
    const { viewer, projectRoot, fixture } = await candidateProject();
    const before = await snapshotDirs([fixture.importedRoot, fixture.approvedRoot]);
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-approved');
    const referenceCountBefore = await referenceArtifactCount(page);

    await page.locator('rect[data-region-id="header"]').first().click();
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 5, y: 5 }, { x: 395, y: 70 });
    await button(page, 'Refine selected region header');
    await button(page, 'Confirm reference intent');
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 200, y: 150 }, { x: 300, y: 250 });
    await page.getByLabel('Proposed region ID').fill('hero');
    await button(page, 'Create candidate region');
    const a = await saveOk(page);
    const aManifest = await readFile(path.join(projectAnnotationsRoot(projectRoot), a.annotationId, 'manifest.json'));

    // Edit the loaded parent: confirm the create, then save a revision.
    await setMode(page, 'Select');
    await page.locator('[data-annotation-kind="rectangle"]').nth(1).click();
    await button(page, 'Confirm reference intent');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');
    const b = await saveOk(page);

    expect(b.annotationId).not.toBe(a.annotationId);
    const bArtifact = await persisted(projectRoot, b.annotationId);
    expect(bArtifact.supersedesAnnotationId).toBe(a.annotationId);
    expect(bArtifact.items.map((i) => i.annotationItemId)).toEqual((await persisted(projectRoot, a.annotationId)).items.map((i) => i.annotationItemId));
    expect(await readFile(path.join(projectAnnotationsRoot(projectRoot), a.annotationId, 'manifest.json'))).toEqual(aManifest);

    expect(await snapshotDirs([fixture.importedRoot, fixture.approvedRoot])).toEqual(before);
    expect(await referenceArtifactCount(page)).toBe(referenceCountBefore);
    const referenceDirs = await readdir(path.dirname(fixture.importedRoot));
    expect(referenceDirs).toHaveLength(2);
    for (const dir of referenceDirs) {
      expect(await readFile(path.join(path.dirname(fixture.importedRoot), dir, 'manifest.json'), 'utf8')).not.toContain('supersedesReferenceId');
    }
    expect(await readdir(projectAnnotationsRoot(projectRoot))).toHaveLength(2);
  });

  it('selects reference annotation marks and regions with the keyboard', async () => {
    const { viewer } = await candidateProject();
    const page = await newPage();
    await openReference(page, viewer.url, 'external-reference-imported');

    await setMode(page, 'Point');
    await clickSource(page, 250, 150);
    await clickSource(page, 350, 250);
    await expect.poll(() => draftItemCount(page)).toBe(2);
    await setMode(page, 'Select');
    const marks = page.locator(`${REFERENCE_SVG} [data-annotation-item-id]`);
    await expect.poll(() => marks.nth(1).getAttribute('aria-pressed')).toBe('true');

    // Tab from the last region reaches the first annotation mark.
    await page.locator('rect[data-region-id="sidebar"]').first().focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-annotation-item-id') ?? null)).toBe(await marks.nth(0).getAttribute('data-annotation-item-id'));
    await page.keyboard.press('Enter');
    await expect.poll(() => marks.nth(0).getAttribute('aria-pressed')).toBe('true');
    await page.keyboard.press('Tab');
    await page.keyboard.press(' ');
    await expect.poll(() => marks.nth(1).getAttribute('aria-pressed')).toBe('true');

    const header = page.locator('rect[data-region-id="header"]').first();
    await header.focus();
    await page.keyboard.press(' ');
    await expect.poll(() => header.getAttribute('aria-pressed')).toBe('true');
    expect(await marks.nth(1).getAttribute('aria-pressed')).toBe('true');

    // Intent controls are native buttons operable from the keyboard.
    await page.getByRole('button', { name: 'Mark informational' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => interpretationState(page)).toBe('candidate');
    await page.getByRole('button', { name: 'Confirm reference intent' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => interpretationState(page)).toBe('confirmed');
  });
});
