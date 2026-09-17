import { describe, expect, it, afterEach, vi } from 'vitest';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const activation = vi.hoisted(() => ({ forceFailure: false }));

vi.mock('../../src/application/projectWorkflowService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/application/projectWorkflowService.js')>();
  return {
    ...actual,
    activateProjectChangeContract: vi.fn(async (...args: Parameters<typeof actual.activateProjectChangeContract>) =>
      activation.forceFailure ? { ok: false as const, code: 'project-state-write-failure' as const, reason: 'simulated write failure' } : actual.activateProjectChangeContract(...args),
    ),
  };
});

const { projectConfigPath, projectContractsRoot } = await import('../../src/projectWorkflow/projectPaths.js');
const { resolveContainedAcceptancePath } = await import('../../src/projectWorkflow/checkAcceptance.js');
const { readPerChangeContract } = await import('../../src/artifacts/frontendContractArtifactReader.js');
const { writePersistentBaselineContract } = await import('../../src/artifacts/frontendContractArtifactWriter.js');
const { encodeArtifactHandle } = await import('../../src/viewerServer/evidence/handles.js');
const { buildBaselineContract } = await import('../support/evidenceFixtures.js');
const fixtures = await import('../support/annotationAuthoringFixtures.js');
const { TestResources, authoringHeaders, fetchAuthoringToken, persistAnnotationUnder, rawRequest, referenceSourceFor, runtimeSourceFor, writeInitializedProject } = fixtures;
type ProjectFixture = import('../support/annotationAuthoringFixtures.js').ProjectFixture;
type RunningViewer = import('../support/annotationAuthoringFixtures.js').RunningViewer;
type VisualAnnotationItem = import('../../src/domain/visualAnnotation.js').VisualAnnotationItem;

const resources = new TestResources();
afterEach(async () => {
  activation.forceFailure = false;
  await resources.cleanup();
});

const WORKSPACE = { kind: 'runtime-target' as const, target: 'header' };

function confirmed(id: string, intent: Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>['intent'], association: VisualAnnotationItem['association'] = WORKSPACE): VisualAnnotationItem {
  return { annotationItemId: id, mark: { kind: 'rectangle', x: 10, y: 10, width: 50, height: 40 }, ...(association === undefined ? {} : { association }), interpretation: { state: 'confirmed', intent, confirmedAt: '2026-09-17T00:00:00.000Z' } };
}

const ITEMS: VisualAnnotationItem[] = [
  confirmed('move', { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'header', property: 'x' } }),
  confirmed('resize', { kind: 'change', operation: 'resize', category: 'requested', contractPrimitive: { kind: 'property-decreases', target: 'header', property: 'height' } }),
  confirmed('preserve', { kind: 'change', operation: 'preserve', category: 'preserved', contractPrimitive: { kind: 'property-unchanged-within-tolerance', target: 'header', property: 'width', tolerance: { kind: 'exact' } } }),
  confirmed('remove', { kind: 'change', operation: 'remove', category: 'requested' }),
  confirmed('inspect', { kind: 'inspect' }, undefined),
];

interface Context {
  project: ProjectFixture;
  viewer: RunningViewer;
  token: string;
  annotationHandle: string;
}

async function context(): Promise<Context> {
  const project = await writeInitializedProject(resources);
  const saved = await persistAnnotationUnder(project.root, runtimeSourceFor(project.observation), ITEMS);
  const viewer = await resources.startViewer({ root: project.root, authoringProjectRoot: project.projectRoot });
  return { project, viewer, token: await fetchAuthoringToken(viewer), annotationHandle: encodeArtifactHandle('visual-annotation', saved.relativeDir) };
}

async function promote(ctx: Pick<Context, 'viewer' | 'token'>, handle: string, payload: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(payload);
  const response = await rawRequest(ctx.viewer, { method: 'POST', path: `/api/annotations/${encodeURIComponent(handle)}/promote-contract`, headers: { ...authoringHeaders(ctx.viewer, ctx.token, body), ...headers }, body });
  return { ...response, json: JSON.parse(response.text) as Record<string, unknown> };
}

async function contractDirs(project: ProjectFixture): Promise<string[]> {
  return readdir(projectContractsRoot(project.projectRoot)).catch(() => [] as string[]);
}

async function configureContractAcceptance(project: ProjectFixture, baselineArtifact?: string): Promise<{ baselineArtifact: string; baselineId: string }> {
  const baseline = buildBaselineContract({ baselineId: 'annotation-baseline-1' });
  let relative = baselineArtifact;
  if (relative === undefined) {
    const written = await writePersistentBaselineContract(baseline, '.frontend-observer/evidence/baselines', { cwd: project.projectRoot });
    if (!written.ok) throw new Error('baseline write failed');
    relative = path.relative(project.projectRoot, written.artifactRoot).split(path.sep).join('/');
  }
  const config = JSON.parse(await readFile(projectConfigPath(project.projectRoot), 'utf8')) as Record<string, unknown>;
  const updated = { ...config, schemaVersion: '1.1.0', acceptance: { contract: { baselineArtifact: relative, changeArtifact: '.frontend-observer/evidence/contracts/previous' } } };
  await writeFile(projectConfigPath(project.projectRoot), `${JSON.stringify(updated, null, 2)}\n`);
  return { baselineArtifact: relative, baselineId: baseline.baselineId };
}

describe('POST /api/annotations/:handle/promote-contract security boundary', () => {
  it('reuses the Prompt 2 authoring gate and a closed request shape', async () => {
    const ctx = await context();
    const valid = { itemIds: ['move'], activateForCheck: false };
    expect((await promote(ctx, ctx.annotationHandle, valid, { 'x-frontend-observer-authoring-token': 'b'.repeat(64) })).status).toBe(403);
    expect((await promote(ctx, ctx.annotationHandle, valid, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await promote(ctx, ctx.annotationHandle, valid, { host: `attacker.example:${ctx.viewer.port}` })).status).toBe(403);
    expect((await promote(ctx, ctx.annotationHandle, valid, { 'content-type': 'text/plain' })).status).toBe(415);
    for (const payload of [{ itemIds: [], activateForCheck: false }, { itemIds: ['move', 'move'], activateForCheck: false }, { itemIds: ['move'] }, { itemIds: ['move'], activateForCheck: 'yes' }, { itemIds: [''], activateForCheck: false }, { ...valid, outputLocation: '../x' }, { itemIds: Array.from({ length: 101 }, (_, i) => `i${i}`), activateForCheck: false }]) {
      expect((await promote(ctx, ctx.annotationHandle, payload)).status, JSON.stringify(payload)).toBe(400);
    }
    const big = JSON.stringify({ itemIds: ['move'], activateForCheck: false, padding: 'x'.repeat(262200) });
    expect((await rawRequest(ctx.viewer, { method: 'POST', path: `/api/annotations/${encodeURIComponent(ctx.annotationHandle)}/promote-contract`, headers: authoringHeaders(ctx.viewer, ctx.token, big), body: big })).status).toBe(413);
    const getRoute = await rawRequest(ctx.viewer, { method: 'GET', path: `/api/annotations/${encodeURIComponent(ctx.annotationHandle)}/promote-contract`, headers: { host: `127.0.0.1:${ctx.viewer.port}` } });
    expect(getRoute.status).toBe(405);
    expect(getRoute.headers.allow).toBe('POST');
    const materialize = await rawRequest(ctx.viewer, { method: 'POST', path: `/api/annotations/${encodeURIComponent(ctx.annotationHandle)}/materialize-reference`, headers: authoringHeaders(ctx.viewer, ctx.token, '{}'), body: '{}' });
    expect(materialize.status).toBe(405);
    expect(await contractDirs(ctx.project)).toEqual([]);
  });

  it('refuses promotion on a read-only viewer', async () => {
    const project = await writeInitializedProject(resources);
    const saved = await persistAnnotationUnder(project.root, runtimeSourceFor(project.observation), ITEMS);
    const viewer = await resources.startViewer({ root: project.root });
    const response = await promote({ viewer, token: 'a'.repeat(64) }, encodeArtifactHandle('visual-annotation', saved.relativeDir), { itemIds: ['move'], activateForCheck: false });
    expect(response.status).toBe(403);
    expect(await contractDirs(project)).toEqual([]);
  });
});

describe('promotion resolution and failures', () => {
  it('maps unknown, malformed, non-annotation, and reference annotation handles', async () => {
    const ctx = await context();
    const valid = { itemIds: ['move'], activateForCheck: false };
    expect((await promote(ctx, 'visual-annotation:annotations%2Fmissing', valid)).status).toBe(404);
    const malformed = await rawRequest(ctx.viewer, { method: 'POST', path: '/api/annotations/%E0%A4%A/promote-contract', headers: authoringHeaders(ctx.viewer, ctx.token, JSON.stringify(valid)), body: JSON.stringify(valid) });
    expect(malformed.status).toBe(400);
    const observationHandle = encodeArtifactHandle('observation', path.relative(ctx.project.root, ctx.project.observationRoot).split(path.sep).join('/'));
    expect((await promote(ctx, observationHandle, valid)).status).toBe(409);
    const reference = await persistAnnotationUnder(ctx.project.root, referenceSourceFor(ctx.project.imported), [{ annotationItemId: 'move', mark: { kind: 'point', x: 1, y: 1 }, interpretation: { state: 'uninterpreted' } }]);
    expect((await promote(ctx, encodeArtifactHandle('visual-annotation', reference.relativeDir), valid)).status).toBe(409);
    expect(await contractDirs(ctx.project)).toEqual([]);
  });

  it('refuses when the source observation is gone or the configured baseline is invalid', async () => {
    const ctx = await context();
    await configureContractAcceptance(ctx.project, '.frontend-observer/evidence/baselines/missing');
    expect((await promote(ctx, ctx.annotationHandle, { itemIds: ['move'], activateForCheck: false })).status).toBe(409);

    // Move the source observation completely outside the evidence root (a renamed sibling would still be discovered).
    const moved = path.join(await resources.tempDir('mfo-moved-observation-'), 'observation');
    await rename(ctx.project.observationRoot, moved);
    try {
      expect((await promote(ctx, ctx.annotationHandle, { itemIds: ['move'], activateForCheck: false })).status).toBe(404);
    } finally {
      await rename(moved, ctx.project.observationRoot);
    }
    expect(await contractDirs(ctx.project)).toEqual([]);
  });

  it('returns 422 for unsupported selected items and never writes a partial contract', async () => {
    const ctx = await context();
    for (const itemIds of [['remove'], ['inspect'], ['move', 'remove'], ['move', 'missing']]) {
      const response = await promote(ctx, ctx.annotationHandle, { itemIds, activateForCheck: false });
      expect(response.status, JSON.stringify(itemIds)).toBe(422);
    }
    expect(await contractDirs(ctx.project)).toEqual([]);
  });
});

describe('successful promotion and activation', () => {
  it('persists selected clauses only and returns bounded identity without paths', async () => {
    const ctx = await context();
    const configBefore = await readFile(projectConfigPath(ctx.project.projectRoot), 'utf8');
    const response = await promote(ctx, ctx.annotationHandle, { itemIds: ['preserve', 'move'], activateForCheck: false });
    expect(response.status).toBe(201);
    expect(Object.keys(response.json).sort()).toEqual(['activation', 'clauseCount', 'contractId', 'contractRequestId', 'handle', 'ok']);
    expect(response.json.activation).toEqual({ state: 'not-requested' });
    expect(response.json.clauseCount).toBe(2);
    expect(response.json.handle).toBe(encodeArtifactHandle('change-contract', `contracts/${response.json.contractId as string}`));
    expect(response.text).not.toContain(ctx.project.projectRoot.split(path.sep).join('\\\\'));
    expect(response.text).not.toContain('manifest.json');

    const read = await readPerChangeContract(path.join(projectContractsRoot(ctx.project.projectRoot), response.json.contractId as string, 'manifest.json'));
    if (!read.ok) throw new Error(read.reason);
    expect(read.contract.activeBaselineIds).toEqual([]);
    expect(read.contract.clauses.map((clause) => clause.primitive.kind)).toEqual(['property-unchanged-within-tolerance', 'property-increases']);
    const artifact = await fetch(`${ctx.viewer.url}/api/artifacts/${encodeURIComponent(response.json.handle as string)}`);
    expect(((await artifact.json()) as { family: string }).family).toBe('change-contract');
    expect(await readFile(projectConfigPath(ctx.project.projectRoot), 'utf8')).toBe(configBefore);
  });

  it('reports not-configured activation without creating contract acceptance', async () => {
    const ctx = await context();
    const configBefore = await readFile(projectConfigPath(ctx.project.projectRoot), 'utf8');
    const response = await promote(ctx, ctx.annotationHandle, { itemIds: ['move'], activateForCheck: true });
    expect(response.status).toBe(201);
    expect(response.json.activation).toEqual({ state: 'not-configured', reason: 'Project contract acceptance is not configured; the new contract was persisted but is not active for check.' });
    expect(await contractDirs(ctx.project)).toEqual([response.json.contractId]);
    expect(await readFile(projectConfigPath(ctx.project.projectRoot), 'utf8')).toBe(configBefore);
  });

  it('uses the configured baseline id, activates only changeArtifact on request, and leaves check able to read the new contract', async () => {
    const ctx = await context();
    const { baselineArtifact, baselineId } = await configureContractAcceptance(ctx.project);

    const notRequested = await promote(ctx, ctx.annotationHandle, { itemIds: ['move'], activateForCheck: false });
    expect(notRequested.json.activation).toEqual({ state: 'not-requested' });
    const configAfterFirst = JSON.parse(await readFile(projectConfigPath(ctx.project.projectRoot), 'utf8')) as { acceptance: { contract: { changeArtifact: string } } };
    expect(configAfterFirst.acceptance.contract.changeArtifact).toBe('.frontend-observer/evidence/contracts/previous');

    const response = await promote(ctx, ctx.annotationHandle, { itemIds: ['resize'], activateForCheck: true });
    expect(response.status).toBe(201);
    expect(response.json.activation).toEqual({ state: 'activated' });
    const config = JSON.parse(await readFile(projectConfigPath(ctx.project.projectRoot), 'utf8')) as { acceptance: { contract: { baselineArtifact: string; changeArtifact: string } } };
    expect(config.acceptance.contract).toEqual({ baselineArtifact, changeArtifact: `.frontend-observer/evidence/contracts/${response.json.contractId as string}` });

    // The existing check acceptance resolution reads the activated contract through its normal path.
    const resolved = resolveContainedAcceptancePath(ctx.project.projectRoot, config.acceptance.contract.changeArtifact);
    if (!resolved.ok) throw new Error(resolved.error);
    const read = await readPerChangeContract(path.join(resolved.path, 'manifest.json'));
    if (!read.ok) throw new Error(read.reason);
    expect(read.contract.activeBaselineIds).toEqual([baselineId]);
    expect(read.contract.contractId).toBe(response.json.contractId);
  });

  it('reports failed activation honestly while keeping the persisted contract', async () => {
    const ctx = await context();
    await configureContractAcceptance(ctx.project);
    activation.forceFailure = true;
    const response = await promote(ctx, ctx.annotationHandle, { itemIds: ['move'], activateForCheck: true });
    expect(response.status).toBe(201);
    expect(response.json.activation).toMatchObject({ state: 'failed' });
    expect(await contractDirs(ctx.project)).toEqual([response.json.contractId]);
  });
});
