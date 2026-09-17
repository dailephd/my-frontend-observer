import { describe, expect, it, afterEach } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isSameVisualAnnotationSource, parseSaveAnnotationRequest } from '../../src/viewerServer/annotationAuthoring.js';
import { readVisualAnnotationArtifact } from '../../src/artifacts/visualAnnotationArtifactReader.js';
import { projectAnnotationsRoot, projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';
import { startViewer } from '../../src/viewerServer/viewerService.js';
import type { VisualAnnotationArtifact, VisualAnnotationSource } from '../../src/domain/visualAnnotation.js';
import type { ProjectFixture, RunningViewer } from '../support/annotationAuthoringFixtures.js';
import {
  TestResources,
  fetchAuthoringToken,
  handleFor,
  indexRecords,
  persistAnnotationUnder,
  postAnnotation,
  readManifest,
  rectangleItem,
  referencePointItem,
  referenceSourceFor,
  runtimeSourceFor,
  writeAnnotatableEvidence,
  writeInitializedProject,
} from '../support/annotationAuthoringFixtures.js';

const resources = new TestResources();
afterEach(async () => resources.cleanup());

interface AuthoringContext {
  project: ProjectFixture;
  viewer: RunningViewer;
  token: string;
  observationHandle: string;
  importedHandle: string;
  approvedHandle: string;
}

async function authoringContext(): Promise<AuthoringContext> {
  const project = await writeInitializedProject(resources);
  const viewer = await resources.startViewer({ root: projectEvidenceRoot(project.projectRoot), authoringProjectRoot: project.projectRoot });
  return {
    project,
    viewer,
    token: await fetchAuthoringToken(viewer),
    observationHandle: await handleFor(viewer, 'observation', project.observation.observationId),
    importedHandle: await handleFor(viewer, 'external-reference-imported', project.imported.referenceId),
    approvedHandle: await handleFor(viewer, 'external-reference-approved', project.approved.referenceId),
  };
}

async function savedAnnotationDirs(projectRoot: string): Promise<string[]> {
  return (await readdir(projectAnnotationsRoot(projectRoot)).catch(() => [] as string[])).sort();
}

async function snapshot(projectRoot: string, annotationId: string): Promise<{ manifest: Buffer; overlay: Buffer }> {
  const dir = path.join(projectAnnotationsRoot(projectRoot), annotationId);
  return { manifest: await readFile(path.join(dir, 'manifest.json')), overlay: await readFile(path.join(dir, 'annotation-overlay.svg')) };
}

const RUNTIME_ITEM = {
  annotationItemId: 'item-1',
  mark: { kind: 'rectangle', x: 10, y: 20, width: 100, height: 50 },
  association: { kind: 'runtime-target', target: 'workspace' },
  interpretation: { state: 'uninterpreted' },
};

describe('project-aware authoring mode', () => {
  it('A: a normal initialized-project viewer enables authoring with a 64-character hex token', async () => {
    const { viewer } = await authoringContext();
    const body = (await (await fetch(`${viewer.url}/api/authoring/session`)).json()) as { enabled: boolean; token: string };
    expect(body.enabled).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('B: a standalone arbitrary-root viewer is read-only and refuses saves', async () => {
    const root = await resources.tempDir('mfo-standalone-root-');
    const evidence = await writeAnnotatableEvidence(root);
    const viewer = await resources.startViewer({ root });
    expect(await (await fetch(`${viewer.url}/api/authoring/session`)).json()).toEqual({ ok: true, enabled: false });
    const response = await postAnnotation(viewer, 'a'.repeat(64), { sourceHandle: await handleFor(viewer, 'observation', evidence.observation.observationId), items: [RUNTIME_ITEM] });
    expect(response.status).toBe(403);
    expect(await readdir(root)).not.toContain('annotations');
  });

  it('C: never infers authoring from a root that happens to be a project evidence root', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await resources.startViewer({ root: projectEvidenceRoot(project.projectRoot) });
    expect(await (await fetch(`${viewer.url}/api/authoring/session`)).json()).toEqual({ ok: true, enabled: false });
    const response = await postAnnotation(viewer, 'a'.repeat(64), { sourceHandle: await handleFor(viewer, 'observation', project.observation.observationId), items: [RUNTIME_ITEM] });
    expect(response.status).toBe(403);
    expect(await savedAnnotationDirs(project.projectRoot)).toEqual([]);
  });

  it('D: refuses to start authoring when the root is not exactly the project evidence root or the project is invalid', async () => {
    const first = await writeInitializedProject(resources);
    const second = await writeInitializedProject(resources);
    const notAProject = await resources.tempDir('mfo-not-a-project-');
    const assetsRoot = await resources.assetsRoot();

    const cases = [
      { root: projectEvidenceRoot(second.projectRoot), authoringProjectRoot: first.projectRoot },
      { root: path.join(projectEvidenceRoot(first.projectRoot), 'observations'), authoringProjectRoot: first.projectRoot },
      { root: first.projectRoot, authoringProjectRoot: first.projectRoot },
      { root: notAProject, authoringProjectRoot: notAProject },
    ];
    for (const options of cases) {
      const result = await startViewer({ ...options, port: 0, assetsRoot });
      if (result.ok) await result.close();
      expect(result.ok, JSON.stringify(options)).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code).toBe('viewer-root-invalid');
    }
  });
});

describe('POST /api/annotations saves', () => {
  it('A: saves an initial runtime annotation into project-managed evidence and makes it discoverable', async () => {
    const context = await authoringContext();
    const response = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, items: [RUNTIME_ITEM] });
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { annotationId, annotationRequestId, handle } = response.json as { annotationId: string; annotationRequestId: string; handle: string };
    expect(Object.keys(response.json).sort()).toEqual(['annotationId', 'annotationRequestId', 'handle', 'ok']);
    expect(annotationRequestId).toMatch(/^[0-9a-f]{64}$/);
    expect(annotationId.startsWith(`${annotationRequestId}-`)).toBe(true);
    expect(handle).toBe(`visual-annotation:${encodeURIComponent(`annotations/${annotationId}`)}`);
    expect(response.text).not.toContain(context.project.projectRoot);

    expect(await savedAnnotationDirs(context.project.projectRoot)).toEqual([annotationId]);
    const read = await readVisualAnnotationArtifact(path.join(projectAnnotationsRoot(context.project.projectRoot), annotationId, 'manifest.json'));
    if (!read.ok) throw new Error(read.reason);
    expect(read.artifact.source).toEqual(runtimeSourceFor(context.project.observation));
    expect(read.artifact.source.coordinateSpace).toEqual({ kind: 'runtime-css-px', width: 800, height: 600 });
    expect(read.artifact.items).toEqual([RUNTIME_ITEM]);
    expect(read.artifact.provenance.origin).toBe('viewer');
    expect('supersedesAnnotationId' in read.artifact).toBe(false);

    const record = (await indexRecords(context.viewer)).find((r) => r.handle === handle);
    expect(record).toMatchObject({ family: 'visual-annotation', supportState: 'supported', logicalId: annotationId });
    expect((await fetch(`${context.viewer.url}/api/artifacts/${encodeURIComponent(handle)}`)).status).toBe(200);
    const view = (await (await fetch(`${context.viewer.url}/api/annotations/${encodeURIComponent(handle)}/view`)).json()) as { source: Record<string, unknown> };
    expect(view.source).toEqual({ status: 'available', handle: context.observationHandle, family: 'observation', mediaRole: 'screenshot' });
    expect((await fetch(`${context.viewer.url}/api/media/${encodeURIComponent(handle)}/annotation-overlay`)).status).toBe(200);
  });

  it('B: constructs imported and approved reference source identity server-side', async () => {
    const context = await authoringContext();
    const imported = await postAnnotation(context.viewer, context.token, { sourceHandle: context.importedHandle, items: [referencePointItem()] });
    const approved = await postAnnotation(context.viewer, context.token, { sourceHandle: context.approvedHandle, items: [referencePointItem('item-1', true)] });
    expect(imported.status).toBe(201);
    expect(approved.status).toBe(201);

    const importedArtifact = await readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(context.project.projectRoot), imported.json.annotationId as string));
    const approvedArtifact = await readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(context.project.projectRoot), approved.json.annotationId as string));
    expect(importedArtifact.source).toEqual(referenceSourceFor(context.project.imported));
    expect(approvedArtifact.source).toEqual(referenceSourceFor(context.project.approved));
    expect(approvedArtifact.source).toMatchObject({ lifecycle: 'approved', imageOwnerReferenceId: context.project.imported.referenceId, coordinateSpace: { kind: 'reference-image-px', width: 32, height: 24 } });

    const view = (await (await fetch(`${context.viewer.url}/api/annotations/${encodeURIComponent(approved.json.handle as string)}/view`)).json()) as { source: Record<string, unknown> };
    expect(view.source).toMatchObject({ status: 'available', handle: context.approvedHandle, mediaRole: 'source-image' });
  });

  it('C: refuses browser-supplied identity, path, and alias fields', async () => {
    const context = await authoringContext();
    for (const extra of [{ annotationId: 'x' }, { annotationRequestId: 'x' }, { projectRoot: 'C:/' }, { outputLocation: '../outside' }, { alias: 'baseline' }, { source: runtimeSourceFor(context.project.observation) }, { createdAt: 'now' }]) {
      const response = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, items: [RUNTIME_ITEM], ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await savedAnnotationDirs(context.project.projectRoot)).toEqual([]);
  });

  it('maps unknown, non-annotatable, and invalid content to 404, 409, and 422 without writing', async () => {
    const context = await authoringContext();
    const saved = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, items: [RUNTIME_ITEM] });
    const annotationHandle = saved.json.handle as string;

    expect((await postAnnotation(context.viewer, context.token, { sourceHandle: 'observation:observations%2Fmissing', items: [] })).status).toBe(404);
    expect((await postAnnotation(context.viewer, context.token, { sourceHandle: annotationHandle, items: [] })).status).toBe(409);
    expect((await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, parentAnnotationHandle: 'visual-annotation:annotations%2Fmissing', items: [] })).status).toBe(404);
    expect((await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, parentAnnotationHandle: context.importedHandle, items: [] })).status).toBe(409);

    const outOfFrame = { ...RUNTIME_ITEM, mark: { kind: 'rectangle', x: 790, y: 0, width: 100, height: 10 } };
    const invalid = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, items: [outOfFrame] });
    expect(invalid.status).toBe(422);
    expect(invalid.text).not.toContain(context.project.projectRoot);
    const crossDomain = await postAnnotation(context.viewer, context.token, { sourceHandle: context.importedHandle, items: [RUNTIME_ITEM] });
    expect(crossDomain.status).toBe(422);

    expect(await savedAnnotationDirs(context.project.projectRoot)).toEqual([saved.json.annotationId]);
  });
});

describe('annotation revisions', () => {
  it('A: a valid revision supersedes its parent and leaves the parent byte-for-byte unchanged', async () => {
    const context = await authoringContext();
    const a = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, items: [RUNTIME_ITEM] });
    const before = await snapshot(context.project.projectRoot, a.json.annotationId as string);

    const b = await postAnnotation(context.viewer, context.token, {
      sourceHandle: context.observationHandle,
      parentAnnotationHandle: a.json.handle,
      items: [{ ...RUNTIME_ITEM, mark: { kind: 'rectangle', x: 15, y: 20, width: 100, height: 50 } }],
    });
    expect(b.status).toBe(201);
    const bArtifact = await readManifest<VisualAnnotationArtifact>(path.join(projectAnnotationsRoot(context.project.projectRoot), b.json.annotationId as string));
    expect(bArtifact.supersedesAnnotationId).toBe(a.json.annotationId);
    expect(await snapshot(context.project.projectRoot, a.json.annotationId as string)).toEqual(before);

    const record = (await indexRecords(context.viewer)).find((r) => r.logicalId === b.json.annotationId);
    expect(record?.relatedIds).toEqual({ sourceObservationId: context.project.observation.observationId, supersedesAnnotationId: a.json.annotationId });
  });

  it('B: refuses a revision whose parent was made over a different canonical source', async () => {
    const context = await authoringContext();
    const a = await postAnnotation(context.viewer, context.token, { sourceHandle: context.importedHandle, items: [referencePointItem()] });
    const wrongSource = await postAnnotation(context.viewer, context.token, { sourceHandle: context.approvedHandle, parentAnnotationHandle: a.json.handle, items: [referencePointItem()] });
    expect(wrongSource.status).toBe(409);
    const runtimeOverReference = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, parentAnnotationHandle: a.json.handle, items: [RUNTIME_ITEM] });
    expect(runtimeOverReference.status).toBe(409);
    expect(await savedAnnotationDirs(context.project.projectRoot)).toEqual([a.json.annotationId]);
  });

  it('C: refuses a stale revision from a parent that already has a child', async () => {
    const context = await authoringContext();
    const a = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, items: [RUNTIME_ITEM] });
    const b = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, parentAnnotationHandle: a.json.handle, items: [rectangleItem('item-1', 'workspace')] });
    expect(b.status).toBe(201);
    const aBefore = await snapshot(context.project.projectRoot, a.json.annotationId as string);
    const bBefore = await snapshot(context.project.projectRoot, b.json.annotationId as string);

    const c = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, parentAnnotationHandle: a.json.handle, items: [rectangleItem('item-2')] });
    expect(c.status).toBe(409);
    expect(await savedAnnotationDirs(context.project.projectRoot)).toEqual([a.json.annotationId, b.json.annotationId].sort());
    expect(await snapshot(context.project.projectRoot, a.json.annotationId as string)).toEqual(aBefore);
    expect(await snapshot(context.project.projectRoot, b.json.annotationId as string)).toEqual(bBefore);
  });

  it('D: still conflicts when historical evidence already holds multiple children of the parent', async () => {
    const context = await authoringContext();
    const a = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, items: [RUNTIME_ITEM] });
    const source = runtimeSourceFor(context.project.observation);
    const evidenceRoot = projectEvidenceRoot(context.project.projectRoot);
    await persistAnnotationUnder(evidenceRoot, source, [rectangleItem('child-1')], a.json.annotationId as string);
    await persistAnnotationUnder(evidenceRoot, source, [rectangleItem('child-2')], a.json.annotationId as string);

    const response = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, parentAnnotationHandle: a.json.handle, items: [rectangleItem('item-3')] });
    expect(response.status).toBe(409);
    expect(await savedAnnotationDirs(context.project.projectRoot)).toHaveLength(3);
  });

  it('serializes concurrent revisions of the same parent so exactly one succeeds', async () => {
    const context = await authoringContext();
    const a = await postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, items: [RUNTIME_ITEM] });
    const results = await Promise.all(
      ['x', 'y', 'z'].map((suffix) => postAnnotation(context.viewer, context.token, { sourceHandle: context.observationHandle, parentAnnotationHandle: a.json.handle, items: [rectangleItem(`item-${suffix}`)] })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await savedAnnotationDirs(context.project.projectRoot)).toHaveLength(2);
  });
});

describe('save request shape and source equality helpers', () => {
  it('accepts exactly sourceHandle, optional parentAnnotationHandle, and items', () => {
    expect(parseSaveAnnotationRequest({ sourceHandle: 's', items: [] })).toEqual({ ok: true, request: { sourceHandle: 's', items: [] } });
    expect(parseSaveAnnotationRequest({ sourceHandle: 's', parentAnnotationHandle: 'p', items: [] })).toEqual({ ok: true, request: { sourceHandle: 's', parentAnnotationHandle: 'p', items: [] } });
    for (const invalid of [null, [], { sourceHandle: 's', items: [], overlay: {} }, { sourceHandle: 1, items: [] }, { sourceHandle: 's', parentAnnotationHandle: null, items: [] }]) {
      expect(parseSaveAnnotationRequest(invalid).ok, JSON.stringify(invalid)).toBe(false);
    }
  });

  it('treats sources as equal only when every canonical identity field matches', async () => {
    const evidence = await writeAnnotatableEvidence(await resources.tempDir('mfo-same-source-'));
    const runtime = runtimeSourceFor(evidence.observation);
    const reference = referenceSourceFor(evidence.approved);
    expect(isSameVisualAnnotationSource(runtime, { ...runtime })).toBe(true);
    expect(isSameVisualAnnotationSource(reference, { ...reference })).toBe(true);
    expect(isSameVisualAnnotationSource(runtime, reference)).toBe(false);

    const runtimeVariants: VisualAnnotationSource[] = [
      { ...runtime, observationId: 'other' } as VisualAnnotationSource,
      { ...runtime, requestId: 'other' } as VisualAnnotationSource,
      { ...runtime, screenshot: { path: 'other.png' } } as VisualAnnotationSource,
      { ...runtime, coordinateSpace: { kind: 'runtime-css-px', width: 801, height: 600 } } as VisualAnnotationSource,
      { ...runtime, coordinateSpace: { kind: 'runtime-css-px', width: 800, height: 601 } } as VisualAnnotationSource,
    ];
    for (const variant of runtimeVariants) expect(isSameVisualAnnotationSource(runtime, variant)).toBe(false);

    const referenceVariants: VisualAnnotationSource[] = [
      { ...reference, referenceId: 'other' } as VisualAnnotationSource,
      { ...reference, referenceRequestId: 'other' } as VisualAnnotationSource,
      { ...reference, lifecycle: 'imported' } as VisualAnnotationSource,
      { ...reference, imageOwnerReferenceId: 'other' } as VisualAnnotationSource,
      { ...reference, imageSha256: 'b'.repeat(64) } as VisualAnnotationSource,
      { ...reference, coordinateSpace: { kind: 'reference-image-px', width: 33, height: 24 } } as VisualAnnotationSource,
    ];
    for (const variant of referenceVariants) expect(isSameVisualAnnotationSource(reference, variant)).toBe(false);
  });
});
