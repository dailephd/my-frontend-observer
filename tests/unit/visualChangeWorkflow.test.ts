import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { VisualChangeActualScope, VisualChangeAttemptRecord, VisualChangeReferenceScope, VisualChangeWorkflowArtifact } from '../../src/domain/visualChangeWorkflow.js';
import { MAX_VISUAL_CHANGE_ATTEMPTS, VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND, VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION, isValidVisualChangeWorkflowArtifact } from '../../src/domain/visualChangeWorkflow.js';
import { buildVisualChangeAttemptIdentity, buildVisualChangeRequestIdentity, buildVisualChangeWorkflowInstanceIdentity } from '../../src/domain/visualChangeWorkflowIdentity.js';
import { computeVisualChangeBindingsSha256, serializeVisualChangeBindings, writeVisualChangeWorkflowArtifact } from '../../src/artifacts/visualChangeWorkflowArtifactWriter.js';
import { readVisualChangeWorkflowArtifact } from '../../src/artifacts/visualChangeWorkflowArtifactReader.js';
import { persistVisualChangeWorkflow } from '../../src/application/visualChangeWorkflowPersistenceService.js';
import { classifyManifest } from '../../src/viewerServer/evidence/classify.js';
import { buildEvidenceIndexMetadata } from '../../src/viewerServer/evidence/index.js';
import { encodeArtifactHandle } from '../../src/viewerServer/evidence/handles.js';
import { getVisualChangeWorkflowView } from '../../src/viewerServer/evidence/visualChangeWorkflowView.js';
import { persistAnnotationUnder, runtimeSourceFor, rectangleItem, writeAnnotatableEvidence } from '../support/annotationAuthoringFixtures.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root() { const value = await mkdtemp(path.join(tmpdir(), 'mfo-visual-change-')); roots.push(value); return value; }
const ref = (artifactId: string, artifactPath: string) => ({ artifactId, artifactPath });
function actualScope(overrides: Partial<VisualChangeActualScope> = {}): VisualChangeActualScope {
  return { entryMode: 'actual-frontend', annotationId: 'annotation-1', annotationArtifactPath: '.frontend-observer/evidence/annotations/annotation-1', baselineObservation: { ...ref('observation-1', '.frontend-observer/evidence/observations/baseline/observation-1'), observationId: 'observation-1', requestId: 'observation-request-1' }, changeContract: { ...ref('contract-1', '.frontend-observer/evidence/contracts/contract-1'), contractId: 'contract-1', contractRequestId: 'contract-request-1' }, ...overrides };
}
function referenceScope(): VisualChangeReferenceScope { return { entryMode: 'reference', annotationId: 'annotation-2', annotationArtifactPath: '.frontend-observer/evidence/annotations/annotation-2', baselineObservation: actualScope().baselineObservation, approvedReference: { ...ref('reference-1', '.frontend-observer/evidence/references/reference-1'), referenceId: 'reference-1', referenceRequestId: 'reference-request-1' }, bindings: [{ referenceRegion: 'hero', runtimeTarget: 'main' }] }; }
function attempt(requestId: string, candidate = 'candidate-1'): VisualChangeAttemptRecord { return { visualChangeAttemptId: buildVisualChangeAttemptIdentity(requestId, candidate), candidateObservation: { ...ref(candidate, `.frontend-observer/evidence/observations/current/${candidate}`), observationId: candidate, requestId: `${candidate}-request` }, check: { status: 'FAIL', baselineObservationId: 'observation-1', candidateObservationId: candidate, failedClauseIds: ['clause-1'], unavailableClauseIds: [], failedReferenceRequirementIds: [], unavailableReferenceRequirementIds: [], unexpectedChangeCount: 1, blockerCodes: [], blockerReasons: [], truncated: false }, review: { state: 'pending' }, recordedAt: '2026-09-22T00:00:00.000Z' }; }
function artifact(scope: VisualChangeActualScope | VisualChangeReferenceScope, attempts: VisualChangeAttemptRecord[] = []): VisualChangeWorkflowArtifact {
  const request = buildVisualChangeRequestIdentity(scope); const content = scope.entryMode === 'reference' ? serializeVisualChangeBindings(scope.bindings) : undefined;
  return { artifactKind: VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND, schemaVersion: VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION, visualChangeRequestId: request, visualChangeWorkflowId: `${request}-instance`, producer: { name: 'my-frontend-observer', version: '0.9.1' }, scope, attempts, ...(content === undefined ? {} : { bindings: { path: 'bindings.json', sha256: computeVisualChangeBindingsSha256(content), declarationCount: scope.bindings.length } }), provenance: { createdAt: '2026-09-22T00:00:00.000Z' } };
}

describe('VisualChangeWorkflow domain and identities', () => {
  it('validates minimal actual and explicit-binding reference workflows as closed shapes', () => {
    expect(isValidVisualChangeWorkflowArtifact(artifact(actualScope()))).toEqual({ valid: true });
    expect(isValidVisualChangeWorkflowArtifact(artifact(referenceScope()))).toEqual({ valid: true });
    expect(isValidVisualChangeWorkflowArtifact({ ...artifact(actualScope()), extra: true })).toMatchObject({ valid: false });
    expect(isValidVisualChangeWorkflowArtifact({ ...artifact(actualScope()), artifactKind: 'wrong' })).toMatchObject({ valid: false });
    expect(isValidVisualChangeWorkflowArtifact({ ...artifact(actualScope()), schemaVersion: '2.0.0' })).toMatchObject({ valid: false });
  });
  it('derives request identity only from semantic scope changes', () => {
    const a = actualScope(); expect(buildVisualChangeRequestIdentity(a)).toBe(buildVisualChangeRequestIdentity(structuredClone(a)));
    expect(buildVisualChangeRequestIdentity(actualScope({ baselineObservation: { ...a.baselineObservation, observationId: 'other', artifactId: 'other' } }))).not.toBe(buildVisualChangeRequestIdentity(a));
    expect(buildVisualChangeRequestIdentity(actualScope({ annotationId: 'other' }))).not.toBe(buildVisualChangeRequestIdentity(a));
    expect(buildVisualChangeRequestIdentity(actualScope({ changeContract: { ...a.changeContract, contractRequestId: 'other' } }))).not.toBe(buildVisualChangeRequestIdentity(a));
    const r = referenceScope(); expect(buildVisualChangeRequestIdentity({ ...r, approvedReference: { ...r.approvedReference, referenceId: 'other', artifactId: 'other' } })).not.toBe(buildVisualChangeRequestIdentity(r));
    expect(buildVisualChangeRequestIdentity({ ...r, bindings: [{ referenceRegion: 'hero', runtimeTarget: 'other' }] })).not.toBe(buildVisualChangeRequestIdentity(r));
    expect(buildVisualChangeRequestIdentity({ ...a, annotationArtifactPath: 'another/safe/location', baselineObservation: { ...a.baselineObservation, artifactPath: 'moved/observation' }, changeContract: { ...a.changeContract, artifactPath: 'moved/contract' } })).toBe(buildVisualChangeRequestIdentity(a));
  });
  it('keeps instance IDs fresh and attempt IDs deterministic over request plus candidate', () => {
    const requestA = buildVisualChangeRequestIdentity(actualScope()); const requestB = buildVisualChangeRequestIdentity(actualScope({ annotationId: 'other' }));
    expect(buildVisualChangeWorkflowInstanceIdentity(requestA)).not.toBe(buildVisualChangeWorkflowInstanceIdentity(requestA));
    expect(buildVisualChangeAttemptIdentity(requestA, 'candidate')).toBe(buildVisualChangeAttemptIdentity(requestA, 'candidate'));
    expect(buildVisualChangeAttemptIdentity(requestA, 'candidate')).not.toBe(buildVisualChangeAttemptIdentity(requestA, 'other'));
    expect(buildVisualChangeAttemptIdentity(requestA, 'candidate')).not.toBe(buildVisualChangeAttemptIdentity(requestB, 'candidate'));
  });
  it('accepts 20 attempts, rejects 21, lineage, unsafe paths, and the frozen review vocabulary', () => {
    const req = buildVisualChangeRequestIdentity(actualScope()); expect(isValidVisualChangeWorkflowArtifact(artifact(actualScope(), Array.from({ length: MAX_VISUAL_CHANGE_ATTEMPTS }, (_, i) => attempt(req, `c-${i}`))))).toEqual({ valid: true });
    expect(isValidVisualChangeWorkflowArtifact(artifact(actualScope(), Array.from({ length: MAX_VISUAL_CHANGE_ATTEMPTS + 1 }, (_, i) => attempt(req, `c-${i}`))))).toMatchObject({ valid: false });
    expect(isValidVisualChangeWorkflowArtifact({ ...artifact(actualScope()), supersedesVisualChangeWorkflowId: 'parent' })).toEqual({ valid: true });
    expect(isValidVisualChangeWorkflowArtifact(artifact(actualScope({ annotationArtifactPath: '../escape' })))).toMatchObject({ valid: false });
    const badReview = attempt(req); badReview.review.state = 'approved' as never; expect(isValidVisualChangeWorkflowArtifact(artifact(actualScope(), [badReview]))).toMatchObject({ valid: false });
  });
});

describe('VisualChangeWorkflow persistence and discovery', () => {
  it('round-trips actual mode without bindings and refuses overwrite', async () => {
    const cwd = await root(); const value = artifact(actualScope()); const first = await writeVisualChangeWorkflowArtifact(value, 'visual-changes', { cwd }); expect(first.ok).toBe(true); if (!first.ok) return;
    expect(await readdir(first.artifactRoot)).toEqual(['manifest.json']); expect(await readVisualChangeWorkflowArtifact(first.manifestPath)).toEqual({ ok: true, artifact: value });
    expect((await writeVisualChangeWorkflowArtifact(value, 'visual-changes', { cwd })).ok).toBe(false);
  });
  it('writes canonical reference bindings, verifies digest/count, and rejects tampering', async () => {
    const cwd = await root(); const value = artifact(referenceScope()); const written = await writeVisualChangeWorkflowArtifact(value, '.', { cwd }); expect(written.ok).toBe(true); if (!written.ok) return;
    expect(await readFile(written.bindingsPath!, 'utf8')).toBe(serializeVisualChangeBindings(referenceScope().bindings)); expect((await readVisualChangeWorkflowArtifact(written.manifestPath)).ok).toBe(true);
    await writeFile(written.bindingsPath!, '[]\n'); expect((await readVisualChangeWorkflowArtifact(written.manifestPath)).ok).toBe(false);
  });
  it('cleans its owned temp directory after writer failure', async () => {
    const cwd = await root(); const value = artifact(actualScope()); const result = await writeVisualChangeWorkflowArtifact(value, '.', { cwd, beforeRename: () => { throw new Error('injected'); } }); expect(result.ok).toBe(false);
    await expect(access(path.join(cwd, `.tmp-${value.visualChangeWorkflowId}`))).rejects.toBeDefined(); await expect(access(path.join(cwd, value.visualChangeWorkflowId))).rejects.toBeDefined();
  });
  it('persists same request with fresh workflow IDs and immutable revision bytes', async () => {
    const cwd = await root(); const one = await persistVisualChangeWorkflow({ scope: actualScope(), outputLocation: '.', cwd, createdAt: '2026-01-01' }); const two = await persistVisualChangeWorkflow({ scope: actualScope(), outputLocation: '.', cwd, createdAt: '2026-02-01', ...(one.ok ? { supersedesVisualChangeWorkflowId: one.visualChangeWorkflowId } : {}) });
    expect(one.ok && two.ok).toBe(true); if (!one.ok || !two.ok) return; expect(one.visualChangeRequestId).toBe(two.visualChangeRequestId); expect(one.visualChangeWorkflowId).not.toBe(two.visualChangeWorkflowId);
    const before = await readFile(one.manifestPath); const child = JSON.parse(await readFile(two.manifestPath, 'utf8')) as VisualChangeWorkflowArtifact; expect(child.supersedesVisualChangeWorkflowId).toBe(one.visualChangeWorkflowId); expect(await readFile(one.manifestPath)).toEqual(before);
  });
  it('classifies/indexes bounded workflow metadata without attempt history', async () => {
    const cwd = await root(); const req = buildVisualChangeRequestIdentity(actualScope()); const saved = await writeVisualChangeWorkflowArtifact(artifact(actualScope(), [attempt(req)]), '.', { cwd }); if (!saved.ok) throw new Error('save');
    expect(await classifyManifest(saved.manifestPath)).toMatchObject({ supportState: 'supported', family: 'visual-change-workflow' }); const indexed = await buildEvidenceIndexMetadata(cwd); const record = indexed.records[0]!;
    expect(record).toMatchObject({ family: 'visual-change-workflow', visualChangeAttemptCount: 1, latestVisualChangeCheckStatus: 'FAIL', latestVisualChangeReviewState: 'pending' }); expect(JSON.stringify(record)).not.toContain('failedClauseIds');
  });
  it('read projection resolves exact evidence and reports missing links honestly', async () => {
    const cwd = await root(); const fixture = await writeAnnotatableEvidence(cwd); const annotation = await persistAnnotationUnder(cwd, runtimeSourceFor(fixture.observation), [rectangleItem('item')]);
    const observationPath = path.relative(cwd, fixture.observationRoot).replaceAll('\\', '/');
    const scope = actualScope({ annotationId: annotation.annotationId, annotationArtifactPath: annotation.relativeDir, baselineObservation: { ...ref(fixture.observation.observationId, observationPath), observationId: fixture.observation.observationId, requestId: fixture.observation.requestId } });
    const checked = isValidVisualChangeWorkflowArtifact(artifact(scope)); if (!checked.valid) throw new Error(`${checked.reason}: ${JSON.stringify(scope)}`); const saved = await writeVisualChangeWorkflowArtifact(artifact(scope), 'workflows', { cwd }); if (!saved.ok) throw new Error(JSON.stringify(saved.diagnostics)); const handle = encodeArtifactHandle('visual-change-workflow', `workflows/${artifact(scope).visualChangeWorkflowId}`); const view = await getVisualChangeWorkflowView(cwd, handle); expect(view.ok).toBe(true); if (!view.ok) return;
    expect(view.view.baselineObservation.status).toBe('available'); expect(view.view.annotation.status).toBe('available'); expect(view.view.changeContract).toMatchObject({ status: 'unavailable' });
  });
});
