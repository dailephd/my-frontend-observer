import { describe, expect, it, afterEach, vi } from 'vitest';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gate = vi.hoisted(() => {
  const state = { block: false, entered: undefined as undefined | (() => void), release: undefined as undefined | (() => void), calls: 0 };
  return state;
});

vi.mock('../../src/application/visualAnnotationReferenceMaterializationService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/application/visualAnnotationReferenceMaterializationService.js')>();
  return {
    ...actual,
    materializeVisualAnnotationReference: vi.fn(async (...args: Parameters<typeof actual.materializeVisualAnnotationReference>) => {
      gate.calls += 1;
      if (gate.block) {
        gate.entered?.();
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
      return actual.materializeVisualAnnotationReference(...args);
    }),
  };
});

const { projectConfigPath, projectReferencesRoot } = await import('../../src/projectWorkflow/projectPaths.js');
const { readExternalReferenceArtifact } = await import('../../src/artifacts/externalReferenceArtifactReader.js');
const { encodeArtifactHandle } = await import('../../src/viewerServer/evidence/handles.js');
const { parseMaterializeAnnotationReferenceRequest } = await import('../../src/viewerServer/annotationReferenceMaterialization.js');
const fixtures = await import('../support/annotationAuthoringFixtures.js');
const { TestResources, authoringHeaders, fetchAuthoringToken, persistAnnotationUnder, postAnnotation, rawRequest, referenceSourceFor, runtimeSourceFor, writeInitializedProject } = fixtures;
type ProjectFixture = import('../support/annotationAuthoringFixtures.js').ProjectFixture;
type RunningViewer = import('../support/annotationAuthoringFixtures.js').RunningViewer;
type VisualAnnotationItem = import('../../src/domain/visualAnnotation.js').VisualAnnotationItem;

const resources = new TestResources();
afterEach(async () => {
  gate.block = false;
  gate.entered = undefined;
  gate.release?.();
  gate.release = undefined;
  gate.calls = 0;
  await resources.cleanup();
});

type Intent = Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>['intent'];

function confirmed(id: string, intent: Intent): VisualAnnotationItem {
  return { annotationItemId: id, mark: { kind: 'rectangle', x: 2, y: 2, width: 10, height: 10 }, interpretation: { state: 'confirmed', intent, confirmedAt: '2026-09-17T00:00:00.000Z' } };
}

const ITEMS: VisualAnnotationItem[] = [
  confirmed('create-a', { kind: 'reference-region', mode: 'create', region: { id: 'region-a', rectangle: { x: 2, y: 2, width: 10, height: 10 } } }),
  confirmed('create-b', { kind: 'reference-region', mode: 'create', region: { id: 'region-b', rectangle: { x: 16, y: 2, width: 10, height: 10 } } }),
  confirmed('req-a', { kind: 'reference-requirement', requirement: { category: 'protected', subject: { kind: 'region-property', region: 'region-a', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 1 } } }),
  confirmed('inspect', { kind: 'inspect' }),
  confirmed('asset', { kind: 'asset-sensitive' }),
  { annotationItemId: 'candidate', mark: { kind: 'point', x: 1, y: 1 }, interpretation: { state: 'candidate', intent: { kind: 'reference-region', mode: 'create', region: { id: 'region-c', rectangle: { x: 2, y: 14, width: 5, height: 5 } } } } },
];

interface Context {
  project: ProjectFixture;
  viewer: RunningViewer;
  token: string;
  importedAnnotationHandle: string;
  approvedAnnotationHandle: string;
}

async function context(): Promise<Context> {
  const project = await writeInitializedProject(resources);
  const imported = await persistAnnotationUnder(project.root, referenceSourceFor(project.imported), ITEMS);
  const approved = await persistAnnotationUnder(project.root, referenceSourceFor(project.approved), ITEMS);
  const viewer = await resources.startViewer({ root: project.root, authoringProjectRoot: project.projectRoot });
  return {
    project,
    viewer,
    token: await fetchAuthoringToken(viewer),
    importedAnnotationHandle: encodeArtifactHandle('visual-annotation', imported.relativeDir),
    approvedAnnotationHandle: encodeArtifactHandle('visual-annotation', approved.relativeDir),
  };
}

function materializeRequest(ctx: Pick<Context, 'viewer' | 'token'>, handle: string, payload: unknown, headers: Record<string, string> = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return rawRequest(ctx.viewer, { method: 'POST', path: `/api/annotations/${encodeURIComponent(handle)}/materialize-reference`, headers: { ...authoringHeaders(ctx.viewer, ctx.token, body), ...headers }, body });
}

async function materialize(ctx: Pick<Context, 'viewer' | 'token'>, handle: string, payload: unknown, headers: Record<string, string> = {}) {
  const response = await materializeRequest(ctx, handle, payload, headers);
  return { ...response, json: JSON.parse(response.text) as Record<string, unknown> };
}

async function referenceDirs(project: ProjectFixture): Promise<string[]> {
  return (await readdir(projectReferencesRoot(project.projectRoot)).catch(() => [] as string[])).sort();
}

async function imageFileOf(artifactRoot: string): Promise<string> {
  const image = (await readdir(artifactRoot)).find((name) => name !== 'manifest.json');
  if (image === undefined) throw new Error('expected a reference image file');
  return path.join(artifactRoot, image);
}

describe('materialize-reference request shape', () => {
  it('accepts exactly { itemIds } with the shared item id rules', () => {
    expect(parseMaterializeAnnotationReferenceRequest({ itemIds: ['a', 'b'] })).toEqual({ ok: true, request: { itemIds: ['a', 'b'] } });
    for (const value of [null, [], 'x', {}, { itemIds: [] }, { itemIds: ['a', 'a'] }, { itemIds: [''] }, { itemIds: [1] }, { itemIds: 'a' }, { itemIds: ['a'], activateForCheck: false }, { itemIds: Array.from({ length: 101 }, (_, i) => `i${i}`) }]) {
      expect(parseMaterializeAnnotationReferenceRequest(value).ok, JSON.stringify(value)).toBe(false);
    }
    expect(parseMaterializeAnnotationReferenceRequest({ itemIds: Array.from({ length: 100 }, (_, i) => `i${i}`) }).ok).toBe(true);
  });
});

describe('POST /api/annotations/:handle/materialize-reference security boundary', () => {
  it('reuses the Prompt 2/5 authoring gate and a closed request body, writing nothing on rejection', async () => {
    const ctx = await context();
    const before = await referenceDirs(ctx.project);
    const valid = { itemIds: ['create-a'] };
    expect((await materialize(ctx, ctx.importedAnnotationHandle, valid, { 'x-frontend-observer-authoring-token': 'b'.repeat(64) })).status).toBe(403);
    expect((await materialize(ctx, ctx.importedAnnotationHandle, valid, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await materialize(ctx, ctx.importedAnnotationHandle, valid, { host: `attacker.example:${ctx.viewer.port}` })).status).toBe(403);
    expect((await materialize(ctx, ctx.importedAnnotationHandle, valid, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await materialize(ctx, ctx.importedAnnotationHandle, valid, { 'content-encoding': 'gzip' })).status).toBe(415);
    for (const payload of [{}, { itemIds: [] }, { itemIds: ['create-a', 'create-a'] }, { itemIds: [''] }, { ...valid, outputLocation: '../x' }, { ...valid, sourceReferenceRoot: 'C:/' }, { itemIds: Array.from({ length: 101 }, (_, i) => `i${i}`) }]) {
      expect((await materialize(ctx, ctx.importedAnnotationHandle, payload)).status, JSON.stringify(payload)).toBe(400);
    }
    expect((await materializeRequest(ctx, ctx.importedAnnotationHandle, '{not json')).status).toBe(400);
    const big = JSON.stringify({ itemIds: ['create-a'], padding: 'x'.repeat(262200) });
    expect((await materializeRequest(ctx, ctx.importedAnnotationHandle, big)).status).toBe(413);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const response = await rawRequest(ctx.viewer, { method, path: `/api/annotations/${encodeURIComponent(ctx.importedAnnotationHandle)}/materialize-reference`, headers: { host: `127.0.0.1:${ctx.viewer.port}` } });
      expect(response.status, method).toBe(405);
      // GET/HEAD reach the route (Allow: POST); PUT/PATCH/DELETE keep the existing global method rejection.
      expect(response.headers.allow).toBe(method === 'GET' ? 'POST' : 'GET, HEAD');
    }
    expect(gate.calls).toBe(0);
    expect(await referenceDirs(ctx.project)).toEqual(before);
  });

  it('refuses materialization on a read-only viewer', async () => {
    const project = await writeInitializedProject(resources);
    const saved = await persistAnnotationUnder(project.root, referenceSourceFor(project.imported), ITEMS);
    const before = await referenceDirs(project);
    const viewer = await resources.startViewer({ root: project.root });
    const response = await materialize({ viewer, token: 'a'.repeat(64) }, encodeArtifactHandle('visual-annotation', saved.relativeDir), { itemIds: ['create-a'] });
    expect(response.status).toBe(403);
    expect(await referenceDirs(project)).toEqual(before);
  });
});

describe('materialization resolution and failures', () => {
  it('maps unknown, malformed, wrong-family, and runtime annotation handles', async () => {
    const ctx = await context();
    const before = await referenceDirs(ctx.project);
    const valid = { itemIds: ['create-a'] };
    expect((await materialize(ctx, 'visual-annotation:annotations%2Fmissing', valid)).status).toBe(404);
    const body = JSON.stringify(valid);
    expect((await rawRequest(ctx.viewer, { method: 'POST', path: '/api/annotations/%E0%A4%A/materialize-reference', headers: authoringHeaders(ctx.viewer, ctx.token, body), body })).status).toBe(400);
    const observationHandle = encodeArtifactHandle('observation', path.relative(ctx.project.root, ctx.project.observationRoot).split(path.sep).join('/'));
    expect((await materialize(ctx, observationHandle, valid)).status).toBe(409);
    const runtime = await persistAnnotationUnder(ctx.project.root, runtimeSourceFor(ctx.project.observation), [{ annotationItemId: 'create-a', mark: { kind: 'point', x: 1, y: 1 }, interpretation: { state: 'confirmed', intent: { kind: 'inspect' }, confirmedAt: '2026-09-17T00:00:00.000Z' } }]);
    const runtimeResponse = await materialize(ctx, encodeArtifactHandle('visual-annotation', runtime.relativeDir), valid);
    expect(runtimeResponse.status).toBe(409);
    expect(await referenceDirs(ctx.project)).toEqual(before);
  });

  it('returns 404 when the source reference or its image is unavailable', async () => {
    const ctx = await context();
    const imageFile = await imageFileOf(ctx.project.importedRoot);
    const movedImage = path.join(await resources.tempDir('mfo-moved-image-'), path.basename(imageFile));
    await rename(imageFile, movedImage);
    try {
      expect((await materialize(ctx, ctx.importedAnnotationHandle, { itemIds: ['create-a'] })).status).toBe(404);
    } finally {
      await rename(movedImage, imageFile);
    }

    const movedApproved = path.join(await resources.tempDir('mfo-moved-reference-'), 'approved');
    const before = await referenceDirs(ctx.project);
    await rename(ctx.project.approvedRoot, movedApproved);
    try {
      expect((await materialize(ctx, ctx.approvedAnnotationHandle, { itemIds: ['create-a'] })).status).toBe(404);
      expect(await referenceDirs(ctx.project)).toEqual(before.filter((name) => name !== path.basename(ctx.project.approvedRoot)));
    } finally {
      await rename(movedApproved, ctx.project.approvedRoot);
    }
  });

  it('returns 422 for candidate, informational, unknown, and uncomposable selections without writing', async () => {
    const ctx = await context();
    const before = await referenceDirs(ctx.project);
    for (const itemIds of [['candidate'], ['inspect'], ['asset'], ['missing'], ['req-a'], ['create-a', 'inspect']]) {
      const response = await materialize(ctx, ctx.importedAnnotationHandle, { itemIds });
      expect(response.status, JSON.stringify(itemIds)).toBe(422);
    }
    expect(await referenceDirs(ctx.project)).toEqual(before);
  });
});

describe('successful materialization', () => {
  it('materializes selected items only, returns a bounded path-free body, and never approves or touches the project config', async () => {
    const ctx = await context();
    const approvedRelative = path.relative(ctx.project.projectRoot, ctx.project.approvedRoot).split(path.sep).join('/');
    const config = JSON.parse(await readFile(projectConfigPath(ctx.project.projectRoot), 'utf8')) as Record<string, unknown>;
    await writeFile(projectConfigPath(ctx.project.projectRoot), `${JSON.stringify({ ...config, schemaVersion: '1.1.0', acceptance: { reference: { approvedArtifact: approvedRelative } } }, null, 2)}\n`);
    const configBefore = await readFile(projectConfigPath(ctx.project.projectRoot));
    const before = await referenceDirs(ctx.project);

    const response = await materialize(ctx, ctx.importedAnnotationHandle, { itemIds: ['create-a', 'req-a'] });
    expect(response.status).toBe(201);
    expect(Object.keys(response.json).sort()).toEqual(['approvalRequired', 'handle', 'lifecycle', 'ok', 'referenceId', 'referenceRequestId', 'regionCount', 'requirementCount', 'supersedesReferenceId']);
    expect(response.json).toMatchObject({ ok: true, lifecycle: 'imported', approvalRequired: true, supersedesReferenceId: ctx.project.imported.referenceId, regionCount: 1, requirementCount: 1 });
    const referenceId = response.json.referenceId as string;
    expect(response.json.handle).toBe(encodeArtifactHandle('external-reference-imported', `references/${referenceId}`));
    expect(response.text).not.toContain('manifest.json');
    expect(response.text).not.toContain(path.basename(ctx.project.projectRoot));
    expect(response.text).not.toContain(ctx.token);
    expect(response.text.length).toBeLessThan(2048);

    // Exactly one new imported artifact; no approved sibling.
    expect(await referenceDirs(ctx.project)).toEqual([...before, referenceId].sort());
    const read = await readExternalReferenceArtifact(path.join(projectReferencesRoot(ctx.project.projectRoot), referenceId, 'manifest.json'));
    if (!read.ok) throw new Error(read.reason);
    expect(read.artifact.lifecycle.state).toBe('imported');
    expect(read.artifact.referenceRequestId).toBe(response.json.referenceRequestId);
    expect(read.artifact.regions?.map((region) => region.id)).toEqual(['region-a']);

    const artifact = await fetch(`${ctx.viewer.url}/api/artifacts/${encodeURIComponent(response.json.handle as string)}`);
    expect(artifact.status).toBe(200);
    expect(((await artifact.json()) as { family: string }).family).toBe('external-reference-imported');
    expect((await readFile(projectConfigPath(ctx.project.projectRoot))).equals(configBefore)).toBe(true);
  });

  it('from an approved source supersedes the approved id and reuses the owning image bytes exactly', async () => {
    const ctx = await context();
    const sourceImageBytes = await readFile(await imageFileOf(ctx.project.importedRoot));
    const response = await materialize(ctx, ctx.approvedAnnotationHandle, { itemIds: ['create-b'] });
    expect(response.status).toBe(201);
    expect(response.json.supersedesReferenceId).toBe(ctx.project.approved.referenceId);
    const newRoot = path.join(projectReferencesRoot(ctx.project.projectRoot), response.json.referenceId as string);
    expect((await readFile(await imageFileOf(newRoot))).equals(sourceImageBytes)).toBe(true);
  });

  it('shares the single session write queue with annotation save and contract promotion', async () => {
    const ctx = await context();
    gate.block = true;
    const entered = new Promise<void>((resolve) => {
      gate.entered = resolve;
    });
    const materializing = materialize(ctx, ctx.importedAnnotationHandle, { itemIds: ['create-a'] });
    await entered;

    const order: string[] = [];
    const saving = postAnnotation(ctx.viewer, ctx.token, { sourceHandle: encodeArtifactHandle('external-reference-imported', path.relative(ctx.project.root, ctx.project.importedRoot).split(path.sep).join('/')), items: [ITEMS[0]] }).then((response) => {
      order.push('save');
      return response;
    });
    const promoteBody = JSON.stringify({ itemIds: ['create-a'], activateForCheck: false });
    const promoting = rawRequest(ctx.viewer, { method: 'POST', path: `/api/annotations/${encodeURIComponent(ctx.importedAnnotationHandle)}/promote-contract`, headers: authoringHeaders(ctx.viewer, ctx.token, promoteBody), body: promoteBody }).then((response) => {
      order.push('promote');
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(order).toEqual([]);

    gate.release?.();
    const materialized = await materializing;
    order.push('materialize-resolved');
    const [saved, promoted] = await Promise.all([saving, promoting]);
    expect(materialized.status).toBe(201);
    expect(saved.status).toBe(201);
    // A reference annotation is refused by contract promotion, but only after the queued materialization finished.
    expect(promoted.status).toBe(409);
  });
});
