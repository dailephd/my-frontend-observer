import { describe, expect, it, afterEach } from 'vitest';
import { mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classifyManifest } from '../../src/viewerServer/evidence/classify.js';
import { findExternalReferenceByIdentity, findObservationByIdentity } from '../../src/viewerServer/evidence/index.js';
import { getAnnotationView } from '../../src/viewerServer/evidence/annotationView.js';
import { encodeArtifactHandle } from '../../src/viewerServer/evidence/handles.js';
import { computeVisualAnnotationOverlaySha256 } from '../../src/artifacts/visualAnnotationArtifactWriter.js';
import type { VisualAnnotationArtifact } from '../../src/domain/visualAnnotation.js';
import {
  TestResources,
  handleFor,
  indexRecords,
  persistAnnotationUnder,
  readManifest,
  rectangleItem,
  referencePointItem,
  referenceSourceFor,
  runtimeSourceFor,
  writeAnnotatableEvidence,
} from '../support/annotationAuthoringFixtures.js';

const resources = new TestResources();
afterEach(async () => resources.cleanup());

async function evidenceRoot() {
  return writeAnnotatableEvidence(await resources.tempDir('mfo-annotation-evidence-'));
}

describe('visual-annotation discovery and classification', () => {
  it('A: indexes a real Prompt 1 annotation as a supported visual-annotation with bounded metadata', async () => {
    const fixture = await evidenceRoot();
    const confirmedItem = { ...rectangleItem('item-2'), interpretation: { state: 'confirmed' as const, intent: { kind: 'inspect' as const }, confirmedAt: '2026-09-17T00:00:00.000Z' } };
    const runtime = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem('item-1'), confirmedItem, rectangleItem('item-3')]);
    const reference = await persistAnnotationUnder(fixture.root, referenceSourceFor(fixture.approved), [referencePointItem('item-1', true)], 'previous-annotation');
    const viewer = await resources.startViewer({ root: fixture.root });

    const records = await indexRecords(viewer);
    const runtimeRecord = records.find((r) => r.logicalId === runtime.annotationId)!;
    expect(runtimeRecord).toMatchObject({
      family: 'visual-annotation',
      supportState: 'supported',
      schemaVersion: '1.0.0',
      annotationSourceKind: 'runtime-observation',
      annotationItemCount: 3,
      annotationConfirmedItemCount: 1,
      relatedIds: { sourceObservationId: fixture.observation.observationId },
      media: [{ role: 'annotation-overlay', available: true }],
      relativeDir: runtime.relativeDir,
    });
    expect(runtimeRecord.handle).toBe(encodeArtifactHandle('visual-annotation', runtime.relativeDir));
    expect(JSON.stringify(runtimeRecord)).not.toContain('"items"');

    const referenceRecord = records.find((r) => r.logicalId === reference.annotationId)!;
    expect(referenceRecord).toMatchObject({
      family: 'visual-annotation',
      supportState: 'supported',
      annotationSourceKind: 'external-reference',
      annotationItemCount: 1,
      annotationConfirmedItemCount: 1,
      relatedIds: { sourceReferenceId: fixture.approved.referenceId, supersedesAnnotationId: 'previous-annotation' },
    });
  });

  it('B: reports an annotation manifest with an unsupported schema version honestly', async () => {
    const fixture = await evidenceRoot();
    const dir = path.join(fixture.root, 'annotations', 'future-annotation');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ artifactKind: 'my-frontend-observer/visual-annotation', schemaVersion: '2.0.0', annotationId: 'future' }));

    const classified = await classifyManifest(path.join(dir, 'manifest.json'));
    expect(classified).toMatchObject({ supportState: 'unsupported-version', family: 'visual-annotation', foundSchemaVersion: '2.0.0', supportedSchemaVersion: '1.0.0' });

    const viewer = await resources.startViewer({ root: fixture.root });
    const record = (await indexRecords(viewer)).find((r) => r.relativeDir === 'annotations/future-annotation');
    expect(record).toMatchObject({ family: 'visual-annotation', supportState: 'unsupported-version', foundSchemaVersion: '2.0.0' });
  });

  it('C: reports a schema-1.0.0 annotation rejected by the canonical reader as invalid-structure', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const manifest = await readManifest<VisualAnnotationArtifact>(annotation.artifactRoot);
    await writeFile(path.join(annotation.artifactRoot, 'manifest.json'), JSON.stringify({ ...manifest, items: 'not-an-array' }));

    const viewer = await resources.startViewer({ root: fixture.root });
    const record = (await indexRecords(viewer)).find((r) => r.relativeDir === annotation.relativeDir);
    expect(record).toMatchObject({ family: 'visual-annotation', supportState: 'invalid-structure' });

    const detail = await fetch(`${viewer.url}/api/artifacts/${encodeURIComponent(record!.handle as string)}`);
    expect(detail.status).toBe(409);
  });

  it('D: loads the full canonical annotation artifact on demand', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const viewer = await resources.startViewer({ root: fixture.root });
    const handle = await handleFor(viewer, 'visual-annotation', annotation.annotationId);

    const response = await fetch(`${viewer.url}/api/artifacts/${encodeURIComponent(handle)}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { family: string; artifact: VisualAnnotationArtifact };
    expect(body.family).toBe('visual-annotation');
    expect(body.artifact).toEqual(await readManifest<VisualAnnotationArtifact>(annotation.artifactRoot));
  });

  it('E: never projects observation alias metadata onto annotation records or provenance', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const observationRelativeDir = path.relative(fixture.root, fixture.observationRoot).split(path.sep).join('/');
    const viewer = await resources.startViewer({
      root: fixture.root,
      aliasMetadata: { observationAliasesByRelativeDir: { [observationRelativeDir]: 'baseline', [annotation.relativeDir]: 'current' } },
    });

    const records = await indexRecords(viewer);
    expect(records.find((r) => r.family === 'observation')?.alias).toBe('baseline');
    const annotationRecord = records.find((r) => r.logicalId === annotation.annotationId)!;
    expect(annotationRecord.alias).toBeUndefined();
    const manifestText = await readFile(path.join(annotation.artifactRoot, 'manifest.json'), 'utf8');
    expect(manifestText).not.toContain('baseline');
    expect(manifestText).not.toContain('alias');
  });
});

describe('annotation-overlay media', () => {
  it('serves exactly the owned overlay SVG as image/svg+xml with a script-blocking policy', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const viewer = await resources.startViewer({ root: fixture.root });
    const handle = await handleFor(viewer, 'visual-annotation', annotation.annotationId);

    const response = await fetch(`${viewer.url}/api/media/${encodeURIComponent(handle)}/annotation-overlay`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe(await readFile(path.join(annotation.artifactRoot, 'annotation-overlay.svg'), 'utf8'));

    const head = await fetch(`${viewer.url}/api/media/${encodeURIComponent(handle)}/annotation-overlay`, { method: 'HEAD' });
    expect(head.status).toBe(200);
  });

  it('rejects the role on the wrong family, an unknown role, a malformed handle, and an unknown handle', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const viewer = await resources.startViewer({ root: fixture.root });
    const annotationHandle = await handleFor(viewer, 'visual-annotation', annotation.annotationId);
    const observationHandle = await handleFor(viewer, 'observation', fixture.observation.observationId);

    expect((await fetch(`${viewer.url}/api/media/${encodeURIComponent(observationHandle)}/annotation-overlay`)).status).toBe(404);
    expect((await fetch(`${viewer.url}/api/media/${encodeURIComponent(annotationHandle)}/screenshot`)).status).toBe(404);
    expect((await fetch(`${viewer.url}/api/media/${encodeURIComponent(annotationHandle)}/overlay.svg`)).status).toBe(404);
    expect((await fetch(`${viewer.url}/api/media/%E0%A4%A/annotation-overlay`)).status).toBe(400);
    expect((await fetch(`${viewer.url}/api/media/${encodeURIComponent('visual-annotation:annotations/does-not-exist')}/annotation-overlay`)).status).toBe(404);
    expect((await fetch(`${viewer.url}/api/media/${encodeURIComponent('visual-annotation:../outside')}/annotation-overlay`)).status).toBe(404);
  });

  it('rejects a missing overlay and a directory in place of the overlay', async () => {
    const fixture = await evidenceRoot();
    const missing = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const directory = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem('item-9')]);
    await unlink(path.join(missing.artifactRoot, 'annotation-overlay.svg'));
    await unlink(path.join(directory.artifactRoot, 'annotation-overlay.svg'));
    await mkdir(path.join(directory.artifactRoot, 'annotation-overlay.svg'));

    const viewer = await resources.startViewer({ root: fixture.root });
    for (const annotation of [missing, directory]) {
      const handle = encodeArtifactHandle('visual-annotation', annotation.relativeDir);
      expect((await fetch(`${viewer.url}/api/media/${encodeURIComponent(handle)}/annotation-overlay`)).status).toBe(404);
    }
  });

  it('never serves a symlinked overlay', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const overlayPath = path.join(annotation.artifactRoot, 'annotation-overlay.svg');
    const outside = await resources.tempDir('mfo-annotation-symlink-outside-');
    const outsideOverlay = path.join(outside, 'annotation-overlay.svg');
    await writeFile(outsideOverlay, await readFile(overlayPath));
    await unlink(overlayPath);
    try {
      await symlink(outsideOverlay, overlayPath, 'file');
    } catch (err) {
      // Windows without symlink privilege cannot create the link at all, so the escape is impossible here.
      expect(['EPERM', 'ENOSYS']).toContain((err as NodeJS.ErrnoException).code);
      return;
    }

    const viewer = await resources.startViewer({ root: fixture.root });
    const handle = encodeArtifactHandle('visual-annotation', annotation.relativeDir);
    expect((await fetch(`${viewer.url}/api/media/${encodeURIComponent(handle)}/annotation-overlay`)).status).toBe(404);
  });

  it('never serves a hand-edited overlay even when the manifest digest was updated to match it', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const malicious = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n';
    await writeFile(path.join(annotation.artifactRoot, 'annotation-overlay.svg'), malicious);
    const manifest = await readManifest<VisualAnnotationArtifact>(annotation.artifactRoot);
    await writeFile(path.join(annotation.artifactRoot, 'manifest.json'), JSON.stringify({ ...manifest, overlay: { ...manifest.overlay, sha256: computeVisualAnnotationOverlaySha256(malicious) } }));

    const viewer = await resources.startViewer({ root: fixture.root });
    const handle = await handleFor(viewer, 'visual-annotation', annotation.annotationId);
    const response = await fetch(`${viewer.url}/api/media/${encodeURIComponent(handle)}/annotation-overlay`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('<script>');
  });
});

describe('annotation source view', () => {
  it('A: resolves a runtime annotation to its exact observation and screenshot media role', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    const viewer = await resources.startViewer({ root: fixture.root });
    const annotationHandle = await handleFor(viewer, 'visual-annotation', annotation.annotationId);
    const observationHandle = await handleFor(viewer, 'observation', fixture.observation.observationId);

    const response = await fetch(`${viewer.url}/api/annotations/${encodeURIComponent(annotationHandle)}/view`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok: boolean; annotation: VisualAnnotationArtifact; source: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.annotation.annotationId).toBe(annotation.annotationId);
    expect(body.source).toEqual({ status: 'available', handle: observationHandle, family: 'observation', mediaRole: 'screenshot' });

    expect((await fetch(`${viewer.url}/api/annotations/${encodeURIComponent(annotationHandle)}/view`, { method: 'HEAD' })).status).toBe(200);
  });

  it('B and C: resolves imported and approved reference annotations to image and source-image roles', async () => {
    const fixture = await evidenceRoot();
    const imported = await persistAnnotationUnder(fixture.root, referenceSourceFor(fixture.imported), [referencePointItem()]);
    const approved = await persistAnnotationUnder(fixture.root, referenceSourceFor(fixture.approved), [referencePointItem()]);

    const importedView = await getAnnotationView(fixture.root, encodeArtifactHandle('visual-annotation', imported.relativeDir));
    const approvedView = await getAnnotationView(fixture.root, encodeArtifactHandle('visual-annotation', approved.relativeDir));
    const importedRelative = path.relative(fixture.root, fixture.importedRoot).split(path.sep).join('/');
    const approvedRelative = path.relative(fixture.root, fixture.approvedRoot).split(path.sep).join('/');

    expect(importedView).toMatchObject({ ok: true, source: { status: 'available', family: 'external-reference-imported', mediaRole: 'image', handle: encodeArtifactHandle('external-reference-imported', importedRelative) } });
    expect(approvedView).toMatchObject({ ok: true, source: { status: 'available', family: 'external-reference-approved', mediaRole: 'source-image', handle: encodeArtifactHandle('external-reference-approved', approvedRelative) } });
  });

  it('D: keeps the annotation loadable and reports the source unavailable when source evidence is removed', async () => {
    const fixture = await evidenceRoot();
    const annotation = await persistAnnotationUnder(fixture.root, runtimeSourceFor(fixture.observation), [rectangleItem()]);
    await rm(fixture.observationRoot, { recursive: true, force: true });
    const viewer = await resources.startViewer({ root: fixture.root });
    const handle = await handleFor(viewer, 'visual-annotation', annotation.annotationId);

    const response = await fetch(`${viewer.url}/api/annotations/${encodeURIComponent(handle)}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { annotation: VisualAnnotationArtifact; source: { status: string; reason?: string } };
    expect(body.annotation.annotationId).toBe(annotation.annotationId);
    expect(body.source.status).toBe('unavailable');
    expect(body.source.reason).toBeTruthy();
    expect((await fetch(`${viewer.url}/api/artifacts/${encodeURIComponent(handle)}`)).status).toBe(200);
  });

  it('E: never resolves a source whose request identity does not match exactly', async () => {
    const fixture = await evidenceRoot();
    const runtimeSource = { ...runtimeSourceFor(fixture.observation), requestId: 'another-request-id' };
    const referenceSource = { ...referenceSourceFor(fixture.imported), referenceRequestId: 'another-reference-request' };
    const runtime = await persistAnnotationUnder(fixture.root, runtimeSource, [rectangleItem()]);
    const reference = await persistAnnotationUnder(fixture.root, referenceSource, [referencePointItem()]);

    expect(await findObservationByIdentity(fixture.root, fixture.observation.observationId, 'another-request-id')).toBeUndefined();
    expect(await findObservationByIdentity(fixture.root, fixture.observation.observationId, fixture.observation.requestId)).toMatchObject({ artifact: { observationId: fixture.observation.observationId } });
    expect(await findExternalReferenceByIdentity(fixture.root, fixture.imported.referenceId, 'another-reference-request')).toBeUndefined();
    expect(await findExternalReferenceByIdentity(fixture.root, fixture.approved.referenceId, fixture.approved.referenceRequestId)).toMatchObject({ family: 'external-reference-approved' });

    expect(await getAnnotationView(fixture.root, encodeArtifactHandle('visual-annotation', runtime.relativeDir))).toMatchObject({ ok: true, source: { status: 'unavailable' } });
    expect(await getAnnotationView(fixture.root, encodeArtifactHandle('visual-annotation', reference.relativeDir))).toMatchObject({ ok: true, source: { status: 'unavailable' } });
  });

  it('maps malformed, unknown, and non-annotation handles to 400, 404, and 409', async () => {
    const fixture = await evidenceRoot();
    const viewer = await resources.startViewer({ root: fixture.root });
    const observationHandle = await handleFor(viewer, 'observation', fixture.observation.observationId);

    expect((await fetch(`${viewer.url}/api/annotations/%E0%A4%A/view`)).status).toBe(400);
    expect((await fetch(`${viewer.url}/api/annotations/${encodeURIComponent('visual-annotation:annotations/missing')}/view`)).status).toBe(404);
    expect((await fetch(`${viewer.url}/api/annotations/${encodeURIComponent(observationHandle)}/view`)).status).toBe(409);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await fetch(`${viewer.url}/api/annotations/${encodeURIComponent(observationHandle)}/view`, { method })).status).toBe(405);
    }
  });
});
