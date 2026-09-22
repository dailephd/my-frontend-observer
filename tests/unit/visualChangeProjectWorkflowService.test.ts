import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckWorkflowResult } from '../../src/projectWorkflow/checkResult.js';
import type { VisualChangeActualScope, VisualChangeWorkflowArtifact } from '../../src/domain/visualChangeWorkflow.js';
import { activateProjectVisualChangeWorkflow, createProjectVisualChangeWorkflow, projectVisualChangeCheckSnapshot, restoreProjectVisualChangeWorkflowAcceptance, runProjectVisualChangeCheck } from '../../src/application/visualChangeProjectWorkflowService.js';
import { writePersistentBaselineContract, writePerChangeContract } from '../../src/artifacts/frontendContractArtifactWriter.js';
import { buildBaselineContract, buildChangeContract, writeRichObservationFixture } from '../support/evidenceFixtures.js';
import { TestResources, persistAnnotationUnder, readManifest, rectangleItem, runtimeSourceFor, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import { ALIAS_CATALOG_SCHEMA_VERSION, writeAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, projectConfigPath, projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';

const resources = new TestResources(); afterEach(() => resources.cleanup());

async function actualProject() {
  const project = await writeInitializedProject(resources);
  const requestId = 'a'.repeat(64); const observationId = `${requestId}-${'b'.repeat(32)}`; const canonical = await writeRichObservationFixture(projectEvidenceRoot(project.projectRoot), observationId, requestId); const observation = await readManifest<ObservationArtifact>(canonical.artifactRoot);
  const annotation = await persistAnnotationUnder(projectEvidenceRoot(project.projectRoot), runtimeSourceFor(observation), [rectangleItem()]);
  const baseline = buildBaselineContract({ sourceObservation: { observationId: observation.observationId, requestId: observation.requestId, producer: observation.producer, observationSchemaVersion: observation.schemaVersion } });
  const change = buildChangeContract({ activeBaselineIds: [baseline.baselineId] });
  const baselineWritten = await writePersistentBaselineContract(baseline, '.frontend-observer/evidence/contracts', { cwd: project.projectRoot });
  const changeWritten = await writePerChangeContract(change, '.frontend-observer/evidence/contracts', { cwd: project.projectRoot });
  if (!baselineWritten.ok || !changeWritten.ok) throw new Error('contract fixture persistence failed');
  const relative = (absolute: string) => path.relative(project.projectRoot, absolute).split(path.sep).join('/');
  const observationPath = relative(canonical.artifactRoot);
  await writeAliasCatalog(aliasCatalogPath(project.projectRoot), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { baseline: { observationId: observation.observationId, requestId: observation.requestId, relativeArtifactDir: path.relative(projectEvidenceRoot(project.projectRoot), canonical.artifactRoot).split(path.sep).join('/') } } });
  const config = JSON.parse(await readFile(projectConfigPath(project.projectRoot), 'utf8')) as Record<string, unknown>;
  config.acceptance = { comparisonConfigFile: undefined, contract: { baselineArtifact: relative(baselineWritten.artifactRoot), changeArtifact: relative(changeWritten.artifactRoot) }, reference: { approvedArtifact: relative(project.approvedRoot) } };
  await writeFile(projectConfigPath(project.projectRoot), `${JSON.stringify(config, null, 2)}\n`);
  const scope: VisualChangeActualScope = { entryMode: 'actual-frontend', annotationId: annotation.annotationId, annotationArtifactPath: relative(annotation.artifactRoot), baselineObservation: { artifactId: observation.observationId, observationId: observation.observationId, requestId: observation.requestId, artifactPath: observationPath }, baselineContract: { artifactId: baseline.baselineId, baselineId: baseline.baselineId, artifactPath: relative(baselineWritten.artifactRoot) }, changeContract: { artifactId: change.contractId, contractId: change.contractId, contractRequestId: change.contractRequestId, artifactPath: relative(changeWritten.artifactRoot) } };
  return { ...project, scope };
}

function result(status: CheckWorkflowResult['status'] = 'PASS'): CheckWorkflowResult & { baseline: NonNullable<CheckWorkflowResult['baseline']>; candidate: NonNullable<CheckWorkflowResult['candidate']> } {
  return {
    schemaVersion: '1.0.0', status,
    baseline: { alias: 'baseline', observationId: 'baseline-id', requestId: 'baseline-request', artifactPath: '.frontend-observer/evidence/observations/baseline/baseline-id' },
    candidate: { alias: 'current', observationId: 'candidate-id', requestId: 'candidate-request', artifactPath: '.frontend-observer/evidence/observations/current/candidate-id' },
    comparison: { state: 'comparable', comparisonId: 'comparison-id', artifactPath: '.frontend-observer/evidence/comparisons/result' },
    contract: { configured: true, state: status === 'FAIL' ? 'FAIL' : 'PASS', evaluationId: 'evaluation-id', artifactPath: '.frontend-observer/evidence/evaluations/result', overallVerdict: status === 'FAIL' ? 'FAIL' : 'PASS', failedClauses: [], unavailableClauses: [], unexpectedChanges: [], truncated: false },
    reference: { configured: false, state: 'NOT_CONFIGURED', failedRequirements: [], unavailableRequirements: [], truncated: false },
    blockers: [], limits: { maxItemsPerCollection: 50, maxSupportingEvidencePerItem: 10, truncated: false },
  };
}

describe('projectVisualChangeCheckSnapshot', () => {
  it.each(['PASS', 'FAIL', 'BLOCKED', 'REVIEW_REQUIRED'] as const)('projects canonical %s status and canonical artifact references without evaluation', (status) => {
    const canonical = result(status); const getter = vi.fn(); Object.defineProperty(canonical, 'unusedEvaluation', { get: getter });
    const snapshot = projectVisualChangeCheckSnapshot(canonical, { activeBaselineContractId: 'baseline-contract', activeChangeContractId: 'change-contract' });
    expect(snapshot).toMatchObject({ status, baselineObservationId: 'baseline-id', candidateObservationId: 'candidate-id', comparison: { artifactId: 'comparison-id', artifactPath: canonical.comparison.artifactPath }, contractEvaluation: { artifactId: 'evaluation-id', artifactPath: canonical.contract.artifactPath }, activeBaselineContractId: 'baseline-contract', activeChangeContractId: 'change-contract' });
    expect(getter).not.toHaveBeenCalled();
  });

  it('directly projects clause, requirement, reference, and bounded unexpected-change evidence in canonical order', () => {
    const canonical = result('FAIL');
    canonical.contract.failedClauses = [{ clauseId: 'failed-2' }, { clauseId: 'failed-1' }] as CheckWorkflowResult['contract']['failedClauses'];
    canonical.contract.unavailableClauses = [{ clauseId: 'unavailable-1' }] as CheckWorkflowResult['contract']['unavailableClauses'];
    canonical.contract.unexpectedChanges = [{}, {}] as CheckWorkflowResult['contract']['unexpectedChanges'];
    canonical.reference = { configured: true, state: 'FAIL', referenceId: 'reference-id', fidelityState: 'fail', failedRequirements: [{ requirementId: 'requirement-failed' }], unavailableRequirements: [{ requirementId: 'requirement-unavailable' }], truncated: false } as CheckWorkflowResult['reference'];
    expect(projectVisualChangeCheckSnapshot(canonical, {})).toMatchObject({ externalReferenceId: 'reference-id', referenceFidelityState: 'fail', failedClauseIds: ['failed-2', 'failed-1'], unavailableClauseIds: ['unavailable-1'], failedReferenceRequirementIds: ['requirement-failed'], unavailableReferenceRequirementIds: ['requirement-unavailable'], unexpectedChangeCount: 2 });
  });

  it('omits incomplete canonical artifact references instead of synthesizing them', () => {
    const canonical = result(); delete canonical.comparison.artifactPath; delete canonical.contract.evaluationId;
    const snapshot = projectVisualChangeCheckSnapshot(canonical, {}); expect(snapshot.comparison).toBeUndefined(); expect(snapshot.contractEvaluation).toBeUndefined();
  });

  it('bounds blockers to 50 in canonical order and marks truncation', () => {
    const canonical = result('BLOCKED'); canonical.blockers = Array.from({ length: 55 }, (_, index) => ({ code: `code-${index}`, message: `reason-${index}` }));
    const snapshot = projectVisualChangeCheckSnapshot(canonical, {}); expect(snapshot.blockerCodes).toHaveLength(50); expect(snapshot.blockerCodes[49]).toBe('code-49'); expect(snapshot.blockerReasons[49]).toBe('reason-49'); expect(snapshot.truncated).toBe(true);
  });

  it.each(['limits', 'contract', 'reference'] as const)('retains canonical %s truncation', (owner) => {
    const canonical = result(); canonical[owner].truncated = true; expect(projectVisualChangeCheckSnapshot(canonical, {}).truncated).toBe(true);
  });
});

describe('project visual-change composition', () => {
  it('freezes exact project evidence without activating acceptance, then activates and restores immutable revisions', async () => {
    const fixture = await actualProject(); const configBefore = await readFile(projectConfigPath(fixture.projectRoot), 'utf8');
    const created = await createProjectVisualChangeWorkflow({ projectRoot: fixture.projectRoot, scope: fixture.scope, createdAt: '2026-09-22T00:00:00.000Z' });
    expect(created.ok).toBe(true); expect(await readFile(projectConfigPath(fixture.projectRoot), 'utf8')).toBe(configBefore); if (!created.ok) return;
    const parentBytes = await readFile(created.manifestPath); const workflowPath = path.relative(fixture.projectRoot, created.manifestPath).split(path.sep).join('/');
    const activated = await activateProjectVisualChangeWorkflow({ projectRoot: fixture.projectRoot, workflowManifestPath: workflowPath, dependencies: { now: () => '2026-09-22T01:00:00.000Z' } });
    expect(activated.ok).toBe(true); expect(await readFile(created.manifestPath)).toEqual(parentBytes); if (!activated.ok) return;
    const activeArtifact = JSON.parse(await readFile(activated.manifestPath, 'utf8')) as VisualChangeWorkflowArtifact;
    expect(activeArtifact.visualChangeRequestId).toBe(created.visualChangeRequestId); expect(activeArtifact.supersedesVisualChangeWorkflowId).toBe(created.visualChangeWorkflowId); expect(activeArtifact.activation?.before).toEqual(activeArtifact.activation?.after);
    const activePath = path.relative(fixture.projectRoot, activated.manifestPath).split(path.sep).join('/');
    const restored = await restoreProjectVisualChangeWorkflowAcceptance({ projectRoot: fixture.projectRoot, workflowManifestPath: activePath, dependencies: { now: () => '2026-09-22T02:00:00.000Z' } });
    expect(restored.ok).toBe(true); if (!restored.ok) return; const restoredArtifact = JSON.parse(await readFile(restored.manifestPath, 'utf8')) as VisualChangeWorkflowArtifact; expect(restoredArtifact.activation?.restoredAt).toBe('2026-09-22T02:00:00.000Z');
  });

  it('rolls project config back when activation revision persistence fails', async () => {
    const fixture = await actualProject(); const created = await createProjectVisualChangeWorkflow({ projectRoot: fixture.projectRoot, scope: fixture.scope }); if (!created.ok) throw new Error('create failed');
    const before = await readFile(projectConfigPath(fixture.projectRoot), 'utf8'); const persist = vi.fn(async () => ({ ok: false as const, diagnostics: [] }));
    const activated = await activateProjectVisualChangeWorkflow({ projectRoot: fixture.projectRoot, workflowManifestPath: path.relative(fixture.projectRoot, created.manifestPath).split(path.sep).join('/'), dependencies: { persist } });
    expect(activated).toMatchObject({ ok: false, code: 'workflow-persistence-failure' }); expect(await readFile(projectConfigPath(fixture.projectRoot), 'utf8')).toBe(before);
  });

  it('uses the canonical check once and appends a pending attempt revision from its exact candidate', async () => {
    const fixture = await actualProject(); const created = await createProjectVisualChangeWorkflow({ projectRoot: fixture.projectRoot, scope: fixture.scope }); if (!created.ok) throw new Error('create failed');
    const activated = await activateProjectVisualChangeWorkflow({ projectRoot: fixture.projectRoot, workflowManifestPath: path.relative(fixture.projectRoot, created.manifestPath).split(path.sep).join('/') }); if (!activated.ok) throw new Error('activate failed');
    const canonical = result('BLOCKED'); canonical.baseline = { ...canonical.baseline, observationId: fixture.scope.baselineObservation.observationId, requestId: fixture.scope.baselineObservation.requestId }; canonical.candidate.artifactPath = '.frontend-observer/evidence/observations/current/candidate-id'; await mkdir(path.join(fixture.projectRoot, ...canonical.candidate.artifactPath.split('/')), { recursive: true });
    const check = vi.fn(async () => canonical); const run = await runProjectVisualChangeCheck({ projectRoot: fixture.projectRoot, workflowManifestPath: path.relative(fixture.projectRoot, activated.manifestPath).split(path.sep).join('/'), dependencies: { check, now: () => '2026-09-22T03:00:00.000Z' } });
    if (!run.ok) throw new Error(JSON.stringify(run)); expect(check).toHaveBeenCalledTimes(1); expect(run.attempt).toMatchObject({ candidateObservation: { observationId: 'candidate-id', requestId: 'candidate-request' }, review: { state: 'pending' }, recordedAt: '2026-09-22T03:00:00.000Z' });
  });
});
