import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { projectAnnotationsRoot, projectConfigPath, projectContractsRoot } from '../../src/projectWorkflow/projectPaths.js';
import { loadProjectViewerState } from '../../src/application/projectWorkflowService.js';
import { readPerChangeContract } from '../../src/artifacts/frontendContractArtifactReader.js';
import { writePersistentBaselineContract } from '../../src/artifacts/frontendContractArtifactWriter.js';
import type { PerChangeContract } from '../../src/domain/frontendContracts.js';
import type { VisualAnnotationArtifact } from '../../src/domain/visualAnnotation.js';
import { buildBaselineContract } from '../support/evidenceFixtures.js';
import { TestResources, readManifest, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';
import type { ProjectFixture } from '../support/annotationAuthoringFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');
const OBSERVATION_LABEL = 'annotatable-obs';

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

async function projectViewer(project: ProjectFixture): Promise<RunningViewer> {
  const state = await loadProjectViewerState(project.projectRoot);
  if (!state.ok) throw new Error(state.message);
  const result = await startViewer({ root: state.root, port: 0, assetsRoot: viewerDist, aliasMetadata: { observationAliasesByRelativeDir: state.aliases }, authoringProjectRoot: state.projectRoot });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  openViewers.push(result);
  return result;
}

async function openObservation(page: Page, url: string): Promise<void> {
  await page.goto(url);
  const item = page.locator('.evidence-list__item', { hasText: OBSERVATION_LABEL }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.locator('.target-overlay-svg image').waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 10_000 });
}

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  openContexts.push(context);
  return context.newPage();
}

async function setMode(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: `${label} mode` });
  await button.click();
  await expect.poll(() => button.getAttribute('aria-pressed')).toBe('true');
}

async function sourceToClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  await page.evaluate(() => (document.querySelector('svg.target-overlay-svg') as SVGSVGElement).scrollIntoView({ block: 'start' }));
  return page.evaluate(
    ([sx, sy]) => {
      const svg = document.querySelector('svg.target-overlay-svg') as SVGSVGElement;
      const point = svg.createSVGPoint();
      point.x = sx as number;
      point.y = sy as number;
      const client = point.matrixTransform(svg.getScreenCTM() as DOMMatrix);
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

async function draftItemCount(page: Page): Promise<number> {
  return Number(await page.locator('.annotation-panel__draft-summary').getAttribute('data-draft-item-count'));
}

async function selectedItemId(page: Page): Promise<string> {
  return (await page.locator('.annotation-panel__item').getAttribute('data-selected-annotation-item-id')) as string;
}

async function interpretationState(page: Page): Promise<string | null> {
  return page.locator('.annotation-panel__interpretation').getAttribute('data-interpretation-state');
}

async function runtimeIntent(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse((await page.locator('pre[data-runtime-intent]').textContent()) as string) as Record<string, unknown>;
}

async function associateTarget(page: Page, name: string): Promise<void> {
  await page.locator('.target-list__item', { hasText: name }).first().click();
  await page.getByRole('button', { name: `Associate target ${name}`, exact: true }).click();
  await expect.poll(() => page.locator('.annotation-panel__association').textContent()).toBe(`Target association: ${name}`);
}

interface IntentChoice {
  operation: string;
  direction?: string;
  category?: string;
  mode?: string;
  property?: string;
  toleranceKind?: string;
  amount?: string;
}

async function setIntent(page: Page, choice: IntentChoice): Promise<void> {
  await page.getByLabel('Runtime intent operation').selectOption(choice.operation);
  if (choice.operation === 'move' && choice.direction !== undefined) await page.getByLabel('Move direction').selectOption(choice.direction);
  if (choice.operation === 'resize' && choice.direction !== undefined) await page.getByLabel('Resize direction').selectOption(choice.direction);
  if (choice.category !== undefined) await page.getByLabel('Intent category').selectOption(choice.category);
  if (choice.mode !== undefined) await page.getByLabel('Intent expected-dependent mode').selectOption(choice.mode);
  if (choice.property !== undefined) await page.getByLabel('Preserved property').selectOption(choice.property);
  if (choice.toleranceKind !== undefined) await page.getByLabel('Contract tolerance', { exact: true }).selectOption(choice.toleranceKind);
  if (choice.amount !== undefined) await page.getByLabel('Contract tolerance amount').fill(choice.amount);
  await page.getByRole('button', { name: 'Set candidate intent' }).click();
  await expect.poll(() => interpretationState(page)).toBe('candidate');
}

async function confirmIntent(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm runtime intent' }).click();
  await expect.poll(() => interpretationState(page)).toBe('confirmed');
}

async function drawRectangle(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<string> {
  const before = await draftItemCount(page);
  await setMode(page, 'Rectangle');
  await dragSource(page, from, to);
  await expect.poll(() => draftItemCount(page)).toBe(before + 1);
  await setMode(page, 'Select');
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

async function promote(page: Page, itemIds: string[], activate = false): Promise<{ status: number; json: { contractId?: string; clauseCount?: number; activation?: { state: string; reason?: string } } }> {
  for (const id of itemIds) await page.locator(`[data-promotion-item-id="${id}"] input[type="checkbox"]`).check();
  if (activate) await page.getByLabel('Activate this change contract for project check').check();
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/promote-contract') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Promote selected to change contract' }).click(),
  ]);
  return { status: response.status(), json: (await response.json()) as { contractId?: string; clauseCount?: number; activation?: { state: string; reason?: string } } };
}

async function readContract(project: ProjectFixture, contractId: string): Promise<PerChangeContract> {
  const read = await readPerChangeContract(path.join(projectContractsRoot(project.projectRoot), contractId, 'manifest.json'));
  if (!read.ok) throw new Error(read.reason);
  return read.contract;
}

async function contractDirs(project: ProjectFixture): Promise<string[]> {
  return readdir(projectContractsRoot(project.projectRoot)).catch(() => [] as string[]);
}

describe('runtime intent to canonical change contract', () => {
  it('promotes explicit move intents; arrow direction never decides the move direction', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url);

    // An arrow drawn pointing right stays uninterpreted until intent is chosen explicitly.
    await setMode(page, 'Arrow');
    await dragSource(page, { x: 100, y: 40 }, { x: 500, y: 40 });
    await expect.poll(() => draftItemCount(page)).toBe(1);
    const arrowId = await selectedItemId(page);
    expect(await interpretationState(page)).toBe('uninterpreted');
    expect(await page.getByRole('button', { name: 'Set candidate intent' }).isDisabled()).toBe(true);
    await page.getByLabel('Runtime intent operation').selectOption('move');
    await page.getByLabel('Move direction').selectOption('left');
    await page.getByLabel('Intent category').selectOption('requested');
    await page.getByText('Select and explicitly associate a runtime target or relationship first.').waitFor({ timeout: 5_000 });
    expect(await page.getByRole('button', { name: 'Set candidate intent' }).isDisabled()).toBe(true);

    await associateTarget(page, 'header');
    await setIntent(page, { operation: 'move', direction: 'left', category: 'requested' });
    expect(await runtimeIntent(page)).toEqual({ kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-decreases', target: 'header', property: 'x' } });
    expect(await page.getByRole('button', { name: 'Confirm runtime intent' }).isEnabled()).toBe(true);
    await confirmIntent(page);

    const rectId = await drawRectangle(page, { x: 20, y: 150 }, { x: 150, y: 450 });
    await associateTarget(page, 'sidebar');
    await setIntent(page, { operation: 'move', direction: 'right', category: 'requested' });
    expect(await runtimeIntent(page)).toMatchObject({ contractPrimitive: { kind: 'property-increases', target: 'sidebar', property: 'x' } });
    await confirmIntent(page);

    // Unsaved drafts cannot be promoted.
    await page.getByText('Save the annotation before promoting contract intent.').waitFor({ timeout: 5_000 });
    expect(await page.getByRole('button', { name: 'Promote selected to change contract' }).isDisabled()).toBe(true);
    const saved = await save(page);
    const persisted = await readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(project.projectRoot), saved.annotationId));
    expect(persisted.items.map((item) => item.interpretation.state)).toEqual(['confirmed', 'confirmed']);

    const result = await promote(page, [arrowId, rectId]);
    expect(result.status).toBe(201);
    expect(result.json.activation).toEqual({ state: 'not-requested' });
    await page.locator(`[data-promoted-contract-id="${result.json.contractId}"]`).waitFor({ timeout: 10_000 });
    expect(await page.getByRole('status').filter({ hasText: 'with 2 clauses' }).count()).toBe(1);

    const contract = await readContract(project, result.json.contractId as string);
    expect(contract.clauses.map((clause) => [clause.category, clause.primitive])).toEqual([
      ['requested', { kind: 'property-decreases', target: 'header', property: 'x' }],
      ['requested', { kind: 'property-increases', target: 'sidebar', property: 'x' }],
    ]);
    expect(contract.clauses[0]?.supportingEvidence).toEqual([{ path: `visualAnnotation.${saved.annotationId}.source` }, { path: `visualAnnotation.${saved.annotationId}.items.${arrowId}` }]);
    expect(contract.activeBaselineIds).toEqual([]);
  });

  it('promotes only the selected items, including expected-dependent resize and preserve property/relationship intent', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url);

    const resizeId = await drawRectangle(page, { x: 30, y: 10 }, { x: 300, y: 70 });
    await associateTarget(page, 'header');
    await page.getByLabel('Runtime intent operation').selectOption('resize');
    await page.getByLabel('Resize direction').selectOption('wider');
    await page.getByLabel('Intent category').selectOption('expected-dependent');
    expect(await page.getByRole('button', { name: 'Set candidate intent' }).isDisabled()).toBe(true);
    await setIntent(page, { operation: 'resize', direction: 'wider', category: 'expected-dependent', mode: 'permitted' });
    expect(await runtimeIntent(page)).toEqual({ kind: 'change', operation: 'resize', category: 'expected-dependent', expectedDependentMode: 'permitted', contractPrimitive: { kind: 'property-increases', target: 'header', property: 'width' } });
    await confirmIntent(page);

    const preserveId = await drawRectangle(page, { x: 20, y: 200 }, { x: 180, y: 480 });
    await associateTarget(page, 'sidebar');
    await setIntent(page, { operation: 'preserve', category: 'preserved', property: 'width', toleranceKind: 'absolute-px', amount: '2' });
    expect(await runtimeIntent(page)).toEqual({
      kind: 'change',
      operation: 'preserve',
      category: 'preserved',
      contractPrimitive: { kind: 'property-unchanged-within-tolerance', target: 'sidebar', property: 'width', tolerance: { kind: 'absolute-px', amount: 2 } },
    });
    await confirmIntent(page);

    const relationship = await page.evaluate(async () => {
      const index = (await (await fetch('/api/index')).json()) as { records: { family: string; handle: string }[] };
      const observation = index.records.find((r) => r.family === 'observation') as { handle: string };
      return ((await (await fetch(`/api/observations/${observation.handle}/relationships`)).json()) as { graph: { pairwiseRelationships: { kind: string; subjectTarget: string; relatedTarget: string }[] } }).graph.pairwiseRelationships[0];
    });
    if (relationship === undefined) throw new Error('fixture has no canonical relationship');
    await setMode(page, 'Line');
    await dragSource(page, { x: 400, y: 100 }, { x: 400, y: 500 });
    await expect.poll(() => draftItemCount(page)).toBe(3);
    await setMode(page, 'Select');
    const relationshipId = await selectedItemId(page);
    await page.getByLabel('Canonical relationship to associate').selectOption({ label: `${relationship.subjectTarget} ${relationship.kind} ${relationship.relatedTarget}` });
    await page.getByRole('button', { name: 'Associate relationship' }).click();
    await setIntent(page, { operation: 'preserve', category: 'protected' });
    expect(await runtimeIntent(page)).toEqual({
      kind: 'change',
      operation: 'preserve',
      category: 'protected',
      contractPrimitive: { kind: 'relationship-unchanged', relationshipKind: relationship.kind, subjectTarget: relationship.subjectTarget, relatedTarget: relationship.relatedTarget },
    });
    await confirmIntent(page);

    await save(page);
    const result = await promote(page, [relationshipId, resizeId]);
    expect(result.status).toBe(201);
    expect(result.json.clauseCount).toBe(2);
    const contract = await readContract(project, result.json.contractId as string);
    expect(contract.clauses).toHaveLength(2);
    expect(contract.clauses.map((clause) => clause.primitive.kind)).toEqual(['relationship-unchanged', 'property-increases']);
    expect(contract.clauses[1]).toMatchObject({ category: 'expected-dependent', expectedDependentMode: 'permitted' });
    expect(JSON.stringify(contract)).not.toContain(preserveId);

    const second = await promote(page, [preserveId]);
    const preserveContract = await readContract(project, second.json.contractId as string);
    expect(preserveContract.clauses[0]?.primitive).toEqual({ kind: 'property-unchanged-within-tolerance', target: 'sidebar', property: 'width', tolerance: { kind: 'absolute-px', amount: 2 } });
  });

  it('keeps remove, inspect, and unconfirmed candidates out of promotion, including forced API requests', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url);

    const removeId = await drawRectangle(page, { x: 30, y: 10 }, { x: 300, y: 70 });
    await associateTarget(page, 'header');
    await setIntent(page, { operation: 'remove', category: 'requested' });
    expect(await runtimeIntent(page)).toEqual({ kind: 'change', operation: 'remove', category: 'requested' });
    await confirmIntent(page);
    await page.getByText('Confirmed but not canonically promotable: the current frontend-contract vocabulary has no target-absent primitive.').first().waitFor({ timeout: 5_000 });

    const inspectId = await drawRectangle(page, { x: 400, y: 200 }, { x: 600, y: 300 });
    await setIntent(page, { operation: 'inspect' });
    await confirmIntent(page);

    const candidateId = await drawRectangle(page, { x: 20, y: 200 }, { x: 180, y: 480 });
    await associateTarget(page, 'sidebar');
    await setIntent(page, { operation: 'move', direction: 'down', category: 'requested' });

    const saved = await save(page);
    const persisted = await readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(project.projectRoot), saved.annotationId));
    expect(persisted.items.map((item) => item.interpretation.state)).toEqual(['confirmed', 'confirmed', 'candidate']);

    const removeRow = page.locator(`[data-promotion-item-id="${removeId}"]`);
    await removeRow.waitFor({ timeout: 5_000 });
    expect(await removeRow.locator('input[type="checkbox"]').isDisabled()).toBe(true);
    expect(await removeRow.textContent()).toContain('not canonically promotable');
    expect(await page.locator(`[data-promotion-item-id="${inspectId}"]`).count()).toBe(0);
    expect(await page.locator(`[data-promotion-item-id="${candidateId}"]`).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Promote selected to change contract' }).isDisabled()).toBe(true);

    const forced = await page.evaluate(
      async ({ handle, ids }) => {
        const session = (await (await fetch('/api/authoring/session')).json()) as { token: string };
        const statuses: number[] = [];
        for (const itemIds of ids) {
          const response = await fetch(`/api/annotations/${encodeURIComponent(handle)}/promote-contract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': session.token },
            body: JSON.stringify({ itemIds, activateForCheck: false }),
          });
          statuses.push(response.status);
        }
        return statuses;
      },
      { handle: saved.handle, ids: [[removeId], [inspectId], [candidateId]] },
    );
    expect(forced).toEqual([422, 422, 422]);
    expect(await contractDirs(project)).toEqual([]);
  });

  it('withdraws confirmation when the association or the mark changes, and retargets the primitive', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url);

    await drawRectangle(page, { x: 450, y: 200 }, { x: 650, y: 350 });
    await associateTarget(page, 'header');
    await setIntent(page, { operation: 'move', direction: 'down', category: 'requested' });
    await confirmIntent(page);
    expect(await page.locator('.annotation-panel__interpretation').textContent()).toContain(' at ');

    await associateTarget(page, 'footer');
    await expect.poll(() => interpretationState(page)).toBe('candidate');
    expect(await page.locator('.annotation-panel__interpretation').textContent()).not.toContain(' at ');
    expect(await runtimeIntent(page)).toEqual({ kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'footer', property: 'y' } });
    await confirmIntent(page);

    await dragSource(page, { x: 550, y: 275 }, { x: 560, y: 290 });
    await expect.poll(() => interpretationState(page)).toBe('candidate');
    await confirmIntent(page);
    await save(page);
    const promoted = await promote(page, [await page.locator('[data-promotion-item-id]').first().getAttribute('data-promotion-item-id') as string]);
    expect(promoted.status).toBe(201);
    expect((await readContract(project, promoted.json.contractId as string)).clauses[0]?.primitive).toEqual({ kind: 'property-increases', target: 'footer', property: 'y' });
  });
});

describe('explicit project activation', () => {
  async function configureAcceptance(project: ProjectFixture): Promise<{ baselineArtifact: string; baselineId: string; config: Record<string, unknown> }> {
    const baseline = buildBaselineContract({ baselineId: 'browser-baseline-1' });
    const written = await writePersistentBaselineContract(baseline, '.frontend-observer/evidence/baselines', { cwd: project.projectRoot });
    if (!written.ok) throw new Error('baseline write failed');
    const baselineArtifact = path.relative(project.projectRoot, written.artifactRoot).split(path.sep).join('/');
    const current = JSON.parse(await readFile(projectConfigPath(project.projectRoot), 'utf8')) as Record<string, unknown>;
    const config = { ...current, schemaVersion: '1.1.0', acceptance: { contract: { baselineArtifact, changeArtifact: '.frontend-observer/evidence/contracts/earlier' } } };
    await writeFile(projectConfigPath(project.projectRoot), `${JSON.stringify(config, null, 2)}\n`);
    return { baselineArtifact, baselineId: baseline.baselineId, config };
  }

  async function confirmedMoveAndSave(page: Page): Promise<string> {
    const id = await drawRectangle(page, { x: 30, y: 10 }, { x: 300, y: 70 });
    await associateTarget(page, 'header');
    await setIntent(page, { operation: 'move', direction: 'right', category: 'requested' });
    await confirmIntent(page);
    await save(page);
    return id;
  }

  it('activates only changeArtifact when explicitly requested and the project configures contract acceptance', async () => {
    const project = await writeInitializedProject(resources);
    const { baselineArtifact, baselineId, config } = await configureAcceptance(project);
    const viewer = await projectViewer(project);
    const page = await newPage();
    await openObservation(page, viewer.url);

    const id = await confirmedMoveAndSave(page);
    expect(await page.getByLabel('Activate this change contract for project check').isChecked()).toBe(false);
    const result = await promote(page, [id], true);
    expect(result.status).toBe(201);
    expect(result.json.activation).toEqual({ state: 'activated' });
    await page.getByRole('status').filter({ hasText: 'now configured for project check' }).waitFor({ timeout: 10_000 });

    const after = JSON.parse(await readFile(projectConfigPath(project.projectRoot), 'utf8')) as Record<string, unknown>;
    expect(after).toEqual({ ...config, acceptance: { contract: { baselineArtifact, changeArtifact: `.frontend-observer/evidence/contracts/${result.json.contractId as string}` } } });
    expect((await readContract(project, result.json.contractId as string)).activeBaselineIds).toEqual([baselineId]);
  });

  it('persists the contract but reports not-configured activation without changing the project configuration', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await projectViewer(project);
    const configBefore = await readFile(projectConfigPath(project.projectRoot), 'utf8');
    const page = await newPage();
    await openObservation(page, viewer.url);

    const id = await confirmedMoveAndSave(page);
    const result = await promote(page, [id], true);
    expect(result.status).toBe(201);
    expect(result.json.activation?.state).toBe('not-configured');
    await page.getByRole('status').filter({ hasText: 'persisted but is not active for project check' }).waitFor({ timeout: 10_000 });
    expect(await contractDirs(project)).toEqual([result.json.contractId]);
    expect(await readFile(projectConfigPath(project.projectRoot), 'utf8')).toBe(configBefore);
  });
});
