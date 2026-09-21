import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startViewer, type StartViewerOptions, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { projectAnnotationsRoot, aliasCatalogPath } from '../../src/projectWorkflow/projectPaths.js';
import { loadProjectViewerState } from '../../src/application/projectWorkflowService.js';
import { ALIAS_CATALOG_SCHEMA_VERSION, writeAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem } from '../../src/domain/visualAnnotation.js';
import { writeRichObservationFixture } from '../support/evidenceFixtures.js';
import { TestResources, persistAnnotationUnder, readManifest, runtimeSourceFor, writeAnnotatableEvidence, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';
import type { ProjectFixture } from '../support/annotationAuthoringFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');
const OBSERVATION_LABEL = 'annotatable-obs';
/** Browser client coordinates are CSS pixels; the pane renders the 800x600 frame at >= 1 CSS px per source px, so rounding stays well under one source pixel. */
const TOLERANCE = 1;

type RunningViewer = Extract<StartViewerResult, { ok: true }>;

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

async function projectViewer(project: ProjectFixture): Promise<RunningViewer> {
  const state = await loadProjectViewerState(project.projectRoot);
  if (!state.ok) throw new Error(state.message);
  return start({ root: state.root, aliasMetadata: { observationAliasesByRelativeDir: state.aliases }, authoringProjectRoot: state.projectRoot });
}

async function newPage(deviceScaleFactor = 1): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor });
  openContexts.push(context);
  return context.newPage();
}

async function openObservation(page: Page, url: string, label: string, expectEditable = true): Promise<void> {
  await page.goto(url);
  const item = page.locator('.evidence-list__item', { hasText: label }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.locator('.target-overlay-svg image').waitFor({ timeout: 10_000 });
  if (expectEditable) await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 10_000 });
  else await page.getByText('Read-only viewer', { exact: true }).waitFor({ timeout: 10_000 });
}

async function setMode(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: `${label} mode` });
  await button.click();
  await expect.poll(() => button.getAttribute('aria-pressed')).toBe('true');
}

/** Maps a source-frame point to browser client coordinates through the SVG's own current CTM, so tests stay robust to layout, zoom, and pan. */
async function sourceToClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([sx, sy]) => {
      const svg = document.querySelector('svg.target-overlay-svg') as SVGSVGElement;
      const ctm = svg.getScreenCTM() as DOMMatrix;
      const point = svg.createSVGPoint();
      point.x = sx as number;
      point.y = sy as number;
      const client = point.matrixTransform(ctm);
      return { x: client.x, y: client.y };
    },
    [x, y],
  );
}

async function dragSource(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await sourceToClient(page, from.x, from.y);
  const b = await sourceToClient(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function clickSource(page: Page, x: number, y: number): Promise<void> {
  const client = await sourceToClient(page, x, y);
  await page.mouse.click(client.x, client.y);
}

async function draftItemCount(page: Page): Promise<number> {
  return Number(await page.locator('.annotation-panel__draft-summary').getAttribute('data-draft-item-count'));
}

async function viewBox(page: Page): Promise<string> {
  return (await page.locator('svg.target-overlay-svg').getAttribute('viewBox')) as string;
}

async function save(page: Page): Promise<{ status: number; json: { annotationId?: string; handle?: string; error?: string } }> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/annotations' && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save annotation' }).click(),
  ]);
  return { status: response.status(), json: (await response.json()) as { annotationId?: string; handle?: string; error?: string } };
}

async function saveOk(page: Page): Promise<{ annotationId: string; handle: string }> {
  const result = await save(page);
  expect(result.status, JSON.stringify(result.json)).toBe(201);
  await page.getByRole('status').filter({ hasText: `Saved annotation ${result.json.annotationId}` }).waitFor({ timeout: 10_000 });
  return { annotationId: result.json.annotationId as string, handle: result.json.handle as string };
}

async function persisted(project: ProjectFixture, annotationId: string): Promise<VisualAnnotationArtifact> {
  return readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(project.projectRoot), annotationId));
}

async function savedAnnotationIds(project: ProjectFixture): Promise<string[]> {
  return (await readdir(projectAnnotationsRoot(project.projectRoot)).catch(() => [] as string[])).sort();
}

function expectNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(TOLERANCE);
}

function markOf<K extends VisualAnnotationItem['mark']['kind']>(artifact: VisualAnnotationArtifact, kind: K): Extract<VisualAnnotationItem['mark'], { kind: K }> {
  const item = artifact.items.find((candidate) => candidate.mark.kind === kind);
  if (item === undefined) throw new Error(`no ${kind} mark persisted`);
  return item.mark as Extract<VisualAnnotationItem['mark'], { kind: K }>;
}

function recordRequests(page: Page): { method: string; path: string }[] {
  const requests: { method: string; path: string }[] = [];
  page.on('request', (request) => requests.push({ method: request.method(), path: new URL(request.url()).pathname }));
  return requests;
}

describe('runtime annotation authoring availability', () => {
  it('offers the annotation toolbar in a project-aware viewer and keeps a standalone viewer read-only without any POST', async () => {
    const project = await writeInitializedProject(resources);
    const authoring = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, authoring.url, OBSERVATION_LABEL);
    for (const label of ['Select', 'Pan', 'Point', 'Rectangle', 'Line', 'Arrow', 'Note']) {
      await expect(page.getByRole('button', { name: `${label} mode` }).count()).resolves.toBe(1);
    }
    await expect(page.getByRole('button', { name: 'Save annotation' }).count()).resolves.toBe(1);

    const standaloneRoot = await resources.tempDir('mfo-standalone-annotation-');
    await writeAnnotatableEvidence(standaloneRoot);
    const standalone = await start({ root: standaloneRoot });
    const readOnlyPage = await newPage();
    const requests = recordRequests(readOnlyPage);
    await openObservation(readOnlyPage, standalone.url, OBSERVATION_LABEL, false);
    for (const label of ['Point', 'Rectangle', 'Line', 'Arrow', 'Note']) {
      await expect(readOnlyPage.getByRole('button', { name: `${label} mode` }).count()).resolves.toBe(0);
    }
    await expect(readOnlyPage.getByRole('button', { name: 'Save annotation' }).count()).resolves.toBe(0);

    // Observation inspection is unchanged.
    const headerRect = readOnlyPage.locator('rect[data-target-name="header"]');
    await headerRect.click();
    await expect.poll(() => headerRect.getAttribute('aria-pressed')).toBe('true');
    await readOnlyPage.getByText('Target: header').waitFor({ timeout: 5_000 });
    expect(requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')).toEqual([]);
    expect(await readdir(standaloneRoot)).not.toContain('annotations');
  });
});

describe('runtime annotation drawing', () => {
  it('draws all five persisted mark kinds with real pointer input and persists them', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    await setMode(page, 'Point');
    await clickSource(page, 50, 150);
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 300, y: 150 }, { x: 400, y: 250 });
    await setMode(page, 'Line');
    await dragSource(page, { x: 450, y: 300 }, { x: 600, y: 350 });
    await setMode(page, 'Arrow');
    await dragSource(page, { x: 450, y: 400 }, { x: 650, y: 450 });
    await setMode(page, 'Note');
    // A note without text is never created.
    await clickSource(page, 700, 520);
    expect(await draftItemCount(page)).toBe(4);
    await page.getByLabel('Note text for new notes').fill('Move this closer');
    await clickSource(page, 700, 520);
    await expect.poll(() => draftItemCount(page)).toBe(5);

    const { annotationId } = await saveOk(page);
    const artifact = await persisted(project, annotationId);
    expect(artifact.items.map((item) => item.mark.kind).sort()).toEqual(['arrow', 'line', 'note', 'point', 'rectangle']);
    for (const item of artifact.items) {
      expect(item.association).toBeUndefined();
      expect(item.interpretation).toEqual({ state: 'uninterpreted' });
      expect(item.annotationItemId).toMatch(/^annotation-item-[0-9a-f-]{36}$/);
    }
    const point = markOf(artifact, 'point');
    expectNear(point.x, 50);
    expectNear(point.y, 150);
    const line = markOf(artifact, 'line');
    expectNear(line.start.x, 450);
    expectNear(line.end.x, 600);
    expectNear(line.end.y, 350);
    const arrow = markOf(artifact, 'arrow');
    expectNear(arrow.start.x, 450);
    expectNear(arrow.end.x, 650);
    const note = markOf(artifact, 'note');
    expect(note.text).toBe('Move this closer');
    expectNear(note.anchor.x, 700);
    expectNear(note.anchor.y, 520);
    expect(artifact.source).toEqual(runtimeSourceFor(project.observation));
  });

  it('persists exact runtime CSS-pixel rectangle coordinates regardless of drag direction', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 250, y: 220 }, { x: 100, y: 120 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    // A zero-area drag never creates a rectangle.
    await dragSource(page, { x: 500, y: 500 }, { x: 500, y: 500 });
    expect(await draftItemCount(page)).toBe(1);

    const { annotationId } = await saveOk(page);
    const rect = markOf(await persisted(project, annotationId), 'rectangle');
    expectNear(rect.x, 100);
    expectNear(rect.y, 120);
    expectNear(rect.width, 150);
    expectNear(rect.height, 100);
  });

  it('preserves source coordinates when drawing while zoomed', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    const fitted = await viewBox(page);
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Zoom in observation' }).click();
    await expect.poll(() => viewBox(page)).not.toBe(fitted);
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 350, y: 260 }, { x: 450, y: 330 });
    const { annotationId } = await saveOk(page);
    const rect = markOf(await persisted(project, annotationId), 'rectangle');
    expectNear(rect.x, 350);
    expectNear(rect.y, 260);
    expectNear(rect.width, 100);
    expectNear(rect.height, 70);

    await page.getByRole('button', { name: 'Fit observation' }).click();
    await expect.poll(() => viewBox(page)).toBe('0 0 800 600');
    // Zoom changes only the viewBox, never target geometry.
    expect(await page.locator('rect[data-target-name="header"]').getAttribute('width')).toBe('800');
  });

  it('preserves source coordinates when drawing after panning, and keeps pan and draw gestures exclusive', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Zoom in observation' }).click();
    await setMode(page, 'Pan');
    const beforePan = await viewBox(page);
    await dragSource(page, { x: 400, y: 300 }, { x: 330, y: 250 });
    const afterPan = await viewBox(page);
    expect(afterPan).not.toBe(beforePan);
    expect(await draftItemCount(page)).toBe(0);

    const [minX, minY, width, height] = afterPan.split(' ').map(Number) as [number, number, number, number];
    const start = { x: minX + width * 0.3, y: minY + height * 0.3 };
    const end = { x: minX + width * 0.6, y: minY + height * 0.55 };
    await setMode(page, 'Rectangle');
    await dragSource(page, start, end);
    await expect.poll(() => draftItemCount(page)).toBe(1);
    expect(await viewBox(page)).toBe(afterPan);

    const { annotationId } = await saveOk(page);
    const rect = markOf(await persisted(project, annotationId), 'rectangle');
    expectNear(rect.x, start.x);
    expectNear(rect.y, start.y);
    expectNear(rect.width, end.x - start.x);
    expectNear(rect.height, end.y - start.y);
  });

  it('never doubles persisted coordinates at deviceScaleFactor 2', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage(2);
    await openObservation(page, viewer.url, OBSERVATION_LABEL);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);

    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 100, y: 120 }, { x: 250, y: 220 });
    await setMode(page, 'Point');
    await clickSource(page, 320, 240);
    const { annotationId } = await saveOk(page);
    const artifact = await persisted(project, annotationId);
    const rect = markOf(artifact, 'rectangle');
    expectNear(rect.x, 100);
    expectNear(rect.y, 120);
    expectNear(rect.width, 150);
    expectNear(rect.height, 100);
    const point = markOf(artifact, 'point');
    expectNear(point.x, 320);
    expectNear(point.y, 240);
  });
});

describe('explicit runtime associations', () => {
  it('never associates a mark drawn over a target until the user explicitly associates it', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    // header target is rect(0, 0, 800, 80); the drawn rectangle lies entirely inside it.
    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 100, y: 10 }, { x: 300, y: 60 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    expect(await page.locator('.annotation-panel__association').getAttribute('data-association-kind')).toBe('none');
    expect(await page.locator('rect[data-target-name="header"]').getAttribute('aria-pressed')).toBe('false');

    await setMode(page, 'Select');
    const mark = page.locator('[data-annotation-kind="rectangle"]');
    await mark.click();
    await expect.poll(() => mark.getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('.annotation-panel__association').getAttribute('data-association-kind')).toBe('none');

    await page.locator('.target-list__item', { hasText: 'header' }).click();
    await page.getByRole('button', { name: 'Associate target header' }).click();
    await expect.poll(() => page.locator('.annotation-panel__association').textContent()).toBe('Target association: header');

    const { annotationId } = await saveOk(page);
    expect((await persisted(project, annotationId)).items[0]?.association).toEqual({ kind: 'runtime-target', target: 'header' });
  });

  it('associates a canonical relationship chosen explicitly from the server relationship graph', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    const graph = await page.evaluate(async () => {
      const index = (await (await fetch('/api/index')).json()) as { records: { family: string; handle: string }[] };
      const observation = index.records.find((r) => r.family === 'observation') as { handle: string };
      return ((await (await fetch(`/api/observations/${observation.handle}/relationships`)).json()) as { graph: { pairwiseRelationships: { kind: string; subjectTarget: string; relatedTarget: string }[] } }).graph;
    });
    const relationship = graph.pairwiseRelationships[0];
    if (relationship === undefined) throw new Error('fixture has no canonical pairwise relationship');

    await setMode(page, 'Arrow');
    await dragSource(page, { x: 100, y: 300 }, { x: 200, y: 540 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    // An arrow never implies a relationship.
    expect(await page.locator('.annotation-panel__association').getAttribute('data-association-kind')).toBe('none');

    await page.getByLabel('Canonical relationship to associate').selectOption({ label: `${relationship.subjectTarget} ${relationship.kind} ${relationship.relatedTarget}` });
    await page.getByRole('button', { name: 'Associate relationship' }).click();
    await expect.poll(() => page.locator('.annotation-panel__association').getAttribute('data-association-kind')).toBe('runtime-relationship');

    const { annotationId } = await saveOk(page);
    expect((await persisted(project, annotationId)).items[0]?.association).toEqual({
      kind: 'runtime-relationship',
      relationshipKind: relationship.kind,
      subjectTarget: relationship.subjectTarget,
      relatedTarget: relationship.relatedTarget,
    });
  });
});

describe('draft editing', () => {
  it('selects, moves, edits, deletes, and cancels draft items without regenerating ids or issuing DELETE', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    const requests = recordRequests(page);
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    await setMode(page, 'Point');
    await clickSource(page, 200, 300);
    await page.getByLabel('Note text for new notes').fill('First text');
    await setMode(page, 'Note');
    await clickSource(page, 500, 400);
    await expect.poll(() => draftItemCount(page)).toBe(2);

    const pointMark = page.locator('[data-annotation-kind="point"]');
    const pointId = (await pointMark.getAttribute('data-annotation-item-id')) as string;
    const noteMark = page.locator('[data-annotation-kind="note"]');
    const noteId = (await noteMark.getAttribute('data-annotation-item-id')) as string;

    // Move the point by (+40, +30) source pixels.
    await setMode(page, 'Select');
    await dragSource(page, { x: 200, y: 300 }, { x: 240, y: 330 });
    const circle = page.locator(`[data-annotation-item-id="${pointId}"] circle`);
    await expect.poll(async () => Number(await circle.getAttribute('cx'))).toBeGreaterThan(238);
    expectNear(Number(await circle.getAttribute('cx')), 240);
    expectNear(Number(await circle.getAttribute('cy')), 330);
    expect(await pointMark.getAttribute('data-annotation-item-id')).toBe(pointId);

    // Edit the note text; anchor and id are unchanged.
    await clickSource(page, 500, 400); // the note anchor
    await expect.poll(() => noteMark.getAttribute('aria-pressed')).toBe('true');
    const anchorBefore = await page.locator(`[data-annotation-item-id="${noteId}"] circle`).getAttribute('cx');
    await page.getByLabel('Selected note text').fill('Edited text');
    await expect.poll(() => page.locator(`[data-annotation-item-id="${noteId}"] text`).textContent()).toBe('Edited text');
    expect(await page.locator(`[data-annotation-item-id="${noteId}"] circle`).getAttribute('cx')).toBe(anchorBefore);

    // Save, then delete a draft item and cancel back to the persisted state.
    const { annotationId } = await saveOk(page);
    const saved = await persisted(project, annotationId);
    expect(saved.items.map((item) => item.annotationItemId).sort()).toEqual([pointId, noteId].sort());
    expect(saved.items.find((item) => item.annotationItemId === noteId)?.mark).toMatchObject({ kind: 'note', text: 'Edited text' });

    await page.locator(`[data-annotation-item-id="${pointId}"]`).click();
    await page.getByRole('button', { name: 'Delete draft item' }).click();
    await expect.poll(() => draftItemCount(page)).toBe(1);
    await page.getByRole('button', { name: 'Cancel changes' }).click();
    await expect.poll(() => draftItemCount(page)).toBe(2);
    expect(await page.locator(`[data-annotation-item-id="${pointId}"]`).count()).toBe(1);

    // Cancel on a new draft returns to an empty draft.
    await page.getByRole('button', { name: 'New annotation' }).click();
    await expect.poll(() => draftItemCount(page)).toBe(0);
    await setMode(page, 'Point');
    await clickSource(page, 100, 100);
    await expect.poll(() => draftItemCount(page)).toBe(1);
    await page.getByRole('button', { name: 'Cancel changes' }).click();
    await expect.poll(() => draftItemCount(page)).toBe(0);

    expect(requests.filter((r) => r.method === 'DELETE')).toEqual([]);
    expect(await savedAnnotationIds(project)).toEqual([annotationId]);
  });

  it('selects annotation marks and targets with the keyboard', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    await setMode(page, 'Point');
    await clickSource(page, 150, 250);
    await clickSource(page, 350, 250);
    await expect.poll(() => draftItemCount(page)).toBe(2);
    await setMode(page, 'Select');
    const marks = page.locator('[data-annotation-item-id]');
    // The most recently created mark starts selected.
    await expect.poll(() => marks.nth(1).getAttribute('aria-pressed')).toBe('true');

    // Tab from the last target rectangle reaches the first annotation mark.
    await page.locator('rect[data-target-name="footer"]').focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-annotation-item-id') ?? null)).toBe(await marks.nth(0).getAttribute('data-annotation-item-id'));
    await page.keyboard.press('Enter');
    await expect.poll(() => marks.nth(0).getAttribute('aria-pressed')).toBe('true');
    await page.keyboard.press('Tab');
    await page.keyboard.press(' ');
    await expect.poll(() => marks.nth(1).getAttribute('aria-pressed')).toBe('true');

    const headerRect = page.locator('rect[data-target-name="header"]');
    await headerRect.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => headerRect.getAttribute('aria-pressed')).toBe('true');
    // Target selection never clears the annotation selection.
    expect(await marks.nth(1).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('save, reload, and revisions', () => {
  it('reloads a saved annotation from canonical evidence with the same ids, marks, associations, and source', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 20, y: 110 }, { x: 180, y: 480 });
    await page.locator('.target-list__item', { hasText: 'sidebar' }).click();
    await page.getByRole('button', { name: 'Associate target sidebar' }).click();
    await setMode(page, 'Point');
    await clickSource(page, 600, 300);
    const saved = await saveOk(page);
    const artifact = await persisted(project, saved.annotationId);

    await page.reload();
    const item = page.locator('.evidence-list__item', { hasText: OBSERVATION_LABEL }).first();
    await item.waitFor({ timeout: 10_000 });
    await item.click();
    await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 10_000 });
    expect(await draftItemCount(page)).toBe(0); // no unsaved or saved draft is recovered from browser state

    const savedButton = page.locator(`[data-annotation-id="${saved.annotationId}"]`);
    await savedButton.waitFor({ timeout: 10_000 });
    await savedButton.click();
    await expect.poll(() => draftItemCount(page)).toBe(artifact.items.length);
    const renderedIds = await page.locator('[data-annotation-item-id]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-annotation-item-id')));
    expect(renderedIds.sort()).toEqual(artifact.items.map((i) => i.annotationItemId).sort());
    const rectItem = artifact.items.find((i) => i.mark.kind === 'rectangle') as VisualAnnotationItem;
    const renderedRect = page.locator(`[data-annotation-item-id="${rectItem.annotationItemId}"] rect`);
    if (rectItem.mark.kind !== 'rectangle') throw new Error('expected rectangle');
    expect(Number(await renderedRect.getAttribute('x'))).toBe(rectItem.mark.x);
    expect(Number(await renderedRect.getAttribute('width'))).toBe(rectItem.mark.width);
    expect(rectItem.association).toEqual({ kind: 'runtime-target', target: 'sidebar' });
    await page.locator(`[data-annotation-item-id="${rectItem.annotationItemId}"]`).click();
    await expect.poll(() => page.locator('.annotation-panel__association').textContent()).toBe('Target association: sidebar');

    const view = await page.evaluate(async (handle) => (await (await fetch(`/api/annotations/${encodeURIComponent(handle)}/view`)).json()) as { source: { handle: string } }, saved.handle);
    const observationHandle = await page.evaluate(async () => ((await (await fetch('/api/index')).json()) as { records: { family: string; handle: string }[] }).records.find((r) => r.family === 'observation')?.handle);
    expect(view.source.handle).toBe(observationHandle);
  });

  it('saves an edited saved annotation as a new child revision and leaves the parent unchanged', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    await setMode(page, 'Point');
    await clickSource(page, 300, 300);
    const a = await saveOk(page);
    const aDir = path.join(projectAnnotationsRoot(project.projectRoot), a.annotationId);
    const aBytes = await readFile(path.join(aDir, 'manifest.json'));

    // After saving, A is the loaded parent; modify one mark and save again.
    await setMode(page, 'Select');
    await dragSource(page, { x: 300, y: 300 }, { x: 350, y: 320 });
    await expect.poll(() => page.locator('.annotation-panel__draft-summary').getAttribute('data-draft-dirty')).toBe('true');
    const b = await saveOk(page);
    expect(b.annotationId).not.toBe(a.annotationId);
    const bArtifact = await persisted(project, b.annotationId);
    expect(bArtifact.supersedesAnnotationId).toBe(a.annotationId);
    expect(bArtifact.items[0]?.annotationItemId).toBe((await persisted(project, a.annotationId)).items[0]?.annotationItemId);
    expect(await readFile(path.join(aDir, 'manifest.json'))).toEqual(aBytes);
    await expect.poll(() => page.locator('.annotation-panel__parent').textContent()).toContain(b.annotationId);
    await expect.poll(() => page.locator(`[data-annotation-id="${b.annotationId}"]`).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the draft and shows a conflict when the loaded parent was already revised elsewhere, without retrying', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    const requests = recordRequests(page);
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    await setMode(page, 'Point');
    await clickSource(page, 300, 300);
    const a = await saveOk(page);
    // Let the post-save saved-list refresh finish before writing outside the page, so the
    // out-of-band writer never races the viewer's own evidence discovery on Windows.
    await page.locator(`[data-annotation-id="${a.annotationId}"]`).waitFor({ timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Another save of a child of A happens outside this page.
    await persistAnnotationUnder(project.root, runtimeSourceFor(project.observation), [{ annotationItemId: 'elsewhere', mark: { kind: 'point', x: 1, y: 1 }, interpretation: { state: 'uninterpreted' } }], a.annotationId);
    const before = await savedAnnotationIds(project);
    expect(before).toHaveLength(2);

    await clickSource(page, 400, 400);
    await expect.poll(() => draftItemCount(page)).toBe(2);
    const result = await save(page);
    expect(result.status).toBe(409);
    await page.getByRole('alert').filter({ hasText: 'Save conflict' }).waitFor({ timeout: 10_000 });
    expect(await draftItemCount(page)).toBe(2);
    expect(await page.locator('.annotation-panel__status--success').count()).toBe(0);
    await page.waitForTimeout(500);
    expect(requests.filter((r) => r.method === 'POST' && r.path === '/api/annotations')).toHaveLength(2);
    expect(await savedAnnotationIds(project)).toEqual(before);
  });
});

describe('canonical source identity', () => {
  it('never rebinds a saved annotation when the alias moves to another observation', async () => {
    const project = await writeInitializedProject(resources);
    const idA = `${'a'.repeat(64)}-${'1'.repeat(32)}`;
    const idB = `${'b'.repeat(64)}-${'2'.repeat(32)}`;
    const reqA = 'c'.repeat(64);
    const reqB = 'd'.repeat(64);
    await writeRichObservationFixture(project.root, idA, reqA);
    await writeRichObservationFixture(project.root, idB, reqB);
    const catalogPath = aliasCatalogPath(project.projectRoot);
    await writeAliasCatalog(catalogPath, { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { current: { observationId: idA, requestId: reqA, relativeArtifactDir: `observations/${idA}` } } });

    const first = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, first.url, 'current');
    await setMode(page, 'Point');
    await clickSource(page, 250, 250);
    const x = await saveOk(page);
    expect((await persisted(project, x.annotationId)).source).toMatchObject({ observationId: idA, requestId: reqA });

    // The canonical project workflow moves the alias; the viewer is restarted from project state.
    // Leave the page first so no in-flight request keeps the first server's connections open during close.
    await page.goto('about:blank');
    openViewers.splice(openViewers.indexOf(first), 1);
    await first.close();
    await writeAliasCatalog(catalogPath, { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { current: { observationId: idB, requestId: reqB, relativeArtifactDir: `observations/${idB}` } } });
    const second = await projectViewer(project);

    await openObservation(page, second.url, 'current');
    await page.getByText('No saved annotations for this observation.').waitFor({ timeout: 10_000 });
    expect(await page.locator(`[data-annotation-id="${x.annotationId}"]`).count()).toBe(0);

    await openObservation(page, second.url, idA);
    await page.locator(`[data-annotation-id="${x.annotationId}"]`).waitFor({ timeout: 10_000 });
    expect((await persisted(project, x.annotationId)).source).toMatchObject({ observationId: idA });
  });

  it('shows a save failure and keeps the draft when the source observation disappears before save', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url, OBSERVATION_LABEL);

    await setMode(page, 'Rectangle');
    await dragSource(page, { x: 100, y: 100 }, { x: 200, y: 200 });
    await expect.poll(() => draftItemCount(page)).toBe(1);

    const moved = `${project.observationRoot}.moved-away`;
    await rename(project.observationRoot, moved);
    try {
      const result = await save(page);
      expect(result.status).toBe(404);
      await page.getByRole('alert').filter({ hasText: 'no longer exists' }).waitFor({ timeout: 10_000 });
      expect(await draftItemCount(page)).toBe(1);
      expect(await page.locator('[data-annotation-kind="rectangle"]').count()).toBe(1);
      expect(await page.locator('.annotation-panel__status--success').count()).toBe(0);
      expect(await savedAnnotationIds(project)).toEqual([]);
    } finally {
      await rename(moved, project.observationRoot);
    }
  });
});
