import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initializeFrontendObserverProject } from '../../src/application/projectWorkflowService.js';
import { readExternalReferenceArtifact } from '../../src/artifacts/externalReferenceArtifactReader.js';
import { writeObservationArtifact } from '../../src/artifacts/artifactWriter.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import type { VisualAnnotationItem } from '../../src/domain/visualAnnotation.js';
import type { VisualChangeWorkflowArtifact } from '../../src/domain/visualChangeWorkflow.js';
import { ALIAS_CATALOG_SCHEMA_VERSION, writeAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, projectConfigPath, projectEvidenceRoot, projectVisualChangesRoot } from '../../src/projectWorkflow/projectPaths.js';
import { writeReferenceCandidateFixture } from '../support/evidenceFixtures.js';
import { TestResources, authoringHeaders, fetchAuthoringToken, handleFor, persistAnnotationUnder, rawRequest, referenceSourceFor } from '../support/annotationAuthoringFixtures.js';

const resources = new TestResources();
afterEach(async () => resources.cleanup());

const exactRegion = (id = 'region-intent'): VisualAnnotationItem => ({ annotationItemId: id, mark: { kind: 'rectangle', x: 0, y: 60, width: 120, height: 240 }, association: { kind: 'reference-region', regionId: 'sidebar' }, interpretation: { state: 'confirmed', confirmedAt: '2026-09-22T00:00:00.000Z', intent: { kind: 'reference-region', mode: 'refine', region: { id: 'sidebar', rectangle: { x: 0, y: 60, width: 120, height: 240 } } } } });

async function context() {
  const projectRoot = await resources.tempDir('mfo-reference-start-');
  const initialized = await initializeFrontendObserverProject({ projectRoot, url: 'http://127.0.0.1:3000', viewport: { width: 1200, height: 800 }, targets: [{ name: 'header', selector: '#header' }, { name: 'sidebar', selector: '#sidebar' }], replace: false });
  if (!initialized.ok) throw new Error(initialized.message);
  const root = projectEvidenceRoot(projectRoot);
  const fixture = await writeReferenceCandidateFixture(root);
  const approvedRead = await readExternalReferenceArtifact(path.join(fixture.approvedRoot, 'manifest.json'));
  if (!approvedRead.ok) throw new Error(approvedRead.reason);
  const annotation = await persistAnnotationUnder(root, referenceSourceFor(approvedRead.artifact), [exactRegion()]);
  const candidate = JSON.parse(await readFile(path.join(fixture.compatibleCandidateRoot, 'manifest.json'), 'utf8')) as ObservationArtifact;
  if (candidate.screenshot.state !== 'available') throw new Error('expected screenshot');
  const requestId = 'a'.repeat(64); const observationId = `${requestId}-${'b'.repeat(32)}`;
  const written = await writeObservationArtifact({ ...candidate, requestId, observationId }, await readFile(path.join(fixture.compatibleCandidateRoot, candidate.screenshot.value.path)), { cwd: root });
  if (!written.ok) throw new Error('baseline write failed');
  await writeAliasCatalog(aliasCatalogPath(projectRoot), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { baseline: { observationId, requestId, relativeArtifactDir: path.relative(root, written.artifactRoot).split(path.sep).join('/') } } });
  const configPath = projectConfigPath(projectRoot); const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  await writeFile(configPath, `${JSON.stringify({ ...config, schemaVersion: '1.1.0', acceptance: { reference: { approvedArtifact: path.relative(projectRoot, fixture.approvedRoot).split(path.sep).join('/') } } }, null, 2)}\n`);
  const viewer = await resources.startViewer({ root, authoringProjectRoot: projectRoot }); const token = await fetchAuthoringToken(viewer);
  return { projectRoot, root, fixture, approved: approvedRead.artifact, annotation, viewer, token, configPath, baselineRoot: written.artifactRoot, requestId, referenceHandle: await handleFor(viewer, 'external-reference-approved', fixture.approvedReferenceId), importedHandle: await handleFor(viewer, 'external-reference-imported', fixture.importedReferenceId), annotationHandle: await handleFor(viewer, 'visual-annotation', annotation.annotationId), baselineHandle: await handleFor(viewer, 'observation', observationId), observationId };
}

async function start(ctx: Awaited<ReturnType<typeof context>>, overrides: Record<string, unknown> = {}, handle = ctx.referenceHandle) {
  const body = JSON.stringify({ annotationHandle: ctx.annotationHandle, itemIds: ['region-intent'], baselineObservationHandle: ctx.baselineHandle, bindings: [{ referenceRegion: 'header', runtimeTarget: 'header' }, { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' }], ...overrides });
  const response = await rawRequest(ctx.viewer, { method: 'POST', path: `/api/references/${encodeURIComponent(handle)}/start-visual-change`, headers: authoringHeaders(ctx.viewer, ctx.token, body), body });
  return { ...response, json: JSON.parse(response.text) as Record<string, unknown> };
}

describe('Batch 5 approved-reference workflow start route', () => {
  it('rejects imported scope, exact-source mismatch, non-executable intent, missing alias, missing acceptance, and structural binding errors', async () => {
    const ctx = await context();
    expect((await start(ctx, {}, ctx.importedHandle)).status).toBe(409);
    const other = await persistAnnotationUnder(ctx.root, referenceSourceFor(ctx.approved), [{ ...exactRegion('inspect'), interpretation: { state: 'confirmed', confirmedAt: '2026-09-22T00:00:00.000Z', intent: { kind: 'inspect' } } }]);
    expect((await start(ctx, { annotationHandle: await handleFor(ctx.viewer, 'visual-annotation', other.annotationId), itemIds: ['inspect'] })).status).toBe(422);
    expect((await start(ctx, { bindings: [] })).status).toBe(422);
    expect((await start(ctx, { bindings: [{ referenceRegion: 'missing', runtimeTarget: 'header' }] })).status).toBe(422);
    expect((await start(ctx, { bindings: [{ referenceRegion: 'header', runtimeTarget: 'header' }, { referenceRegion: 'header', runtimeTarget: 'sidebar' }] })).status).toBe(422);
    await writeAliasCatalog(aliasCatalogPath(ctx.projectRoot), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: {} });
    expect((await start(ctx)).status).toBe(409);
    await writeAliasCatalog(aliasCatalogPath(ctx.projectRoot), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { baseline: { observationId: ctx.observationId, requestId: ctx.requestId, relativeArtifactDir: path.relative(ctx.root, ctx.baselineRoot).split(path.sep).join('/') } } });
    const config = JSON.parse(await readFile(ctx.configPath, 'utf8')) as { acceptance?: Record<string, unknown> };
    delete config.acceptance;
    await writeFile(ctx.configPath, `${JSON.stringify(config, null, 2)}\n`);
    expect((await start(ctx)).status).toBe(409);
  });

  it('creates an exact inactive reference scope with optional contract omitted, zero attempts, no config mutation, and no path leakage', async () => {
    const ctx = await context(); const configBefore = await readFile(ctx.configPath);
    const response = await start(ctx);
    expect(response.status).toBe(201);
    expect(JSON.stringify(response.json)).not.toContain(ctx.projectRoot);
    expect(response.json.referenceId).toBe(ctx.fixture.approvedReferenceId);
    expect(response.json.bindingCount).toBe(2);
    const workflowId = response.json.visualChangeWorkflowId as string;
    const workflow = JSON.parse(await readFile(path.join(projectVisualChangesRoot(ctx.projectRoot), workflowId, 'manifest.json'), 'utf8')) as VisualChangeWorkflowArtifact;
    expect(workflow.scope.entryMode).toBe('reference');
    expect(workflow.scope.annotationId).toBe(ctx.annotation.annotationId);
    expect(workflow.scope.baselineObservation.observationId).toBe(ctx.observationId);
    expect(workflow.scope.approvedReference.referenceId).toBe(ctx.fixture.approvedReferenceId);
    expect(workflow.scope.bindings).toEqual([{ referenceRegion: 'header', runtimeTarget: 'header' }, { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' }]);
    expect(workflow.scope).not.toHaveProperty('baselineContract');
    expect(workflow.attempts).toEqual([]);
    expect(workflow).not.toHaveProperty('activation');
    expect(await readFile(ctx.configPath)).toEqual(configBefore);
  });

  it('allows several required regions to bind explicitly to the same unique runtime target', async () => {
    const ctx = await context();
    const response = await start(ctx, { bindings: [{ referenceRegion: 'header', runtimeTarget: 'header' }, { referenceRegion: 'sidebar', runtimeTarget: 'header' }] });
    expect(response.status).toBe(201);
  });
});
