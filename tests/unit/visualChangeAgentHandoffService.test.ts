import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareVisualChangeAgentHandoff } from '../../src/application/visualChangeAgentHandoffService.js';
import { activateProjectVisualChangeWorkflow, createProjectVisualChangeWorkflow, restoreProjectVisualChangeWorkflowAcceptance } from '../../src/application/visualChangeProjectWorkflowService.js';
import { writeObservationArtifact } from '../../src/artifacts/artifactWriter.js';
import { readExternalReferenceArtifact } from '../../src/artifacts/externalReferenceArtifactReader.js';
import { writePerChangeContract, writePersistentBaselineContract } from '../../src/artifacts/frontendContractArtifactWriter.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import type { VisualChangeActualScope, VisualChangeReferenceScope } from '../../src/domain/visualChangeWorkflow.js';
import { serializeVisualChangeAgentHandoff } from '../../src/domain/visualChangeAgentHandoff.js';
import { ALIAS_CATALOG_SCHEMA_VERSION, writeAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, projectConfigPath, projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';
import { buildBaselineContract, buildChangeContract, writeReferenceCandidateFixture, writeRichObservationFixture } from '../support/evidenceFixtures.js';
import { TestResources, persistAnnotationUnder, readManifest, rectangleItem, referenceSourceFor, runtimeSourceFor, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';

const resources = new TestResources(); afterEach(() => resources.cleanup());
const relative = (root: string, absolute: string) => path.relative(root, absolute).split(path.sep).join('/');

async function actualFixture() {
  const project = await writeInitializedProject(resources); const root = projectEvidenceRoot(project.projectRoot);
  const requestId = 'a'.repeat(64); const observationId = `${requestId}-${'b'.repeat(32)}`; const written = await writeRichObservationFixture(root, observationId, requestId); const observation = await readManifest<ObservationArtifact>(written.artifactRoot);
  const annotation = await persistAnnotationUnder(root, runtimeSourceFor(observation), [rectangleItem()]);
  const baseline = buildBaselineContract({ sourceObservation: { observationId, requestId, producer: observation.producer, observationSchemaVersion: observation.schemaVersion } });
  const change = buildChangeContract({ activeBaselineIds: [baseline.baselineId] });
  const bw = await writePersistentBaselineContract(baseline, '.frontend-observer/evidence/contracts', { cwd: project.projectRoot }); const cw = await writePerChangeContract(change, '.frontend-observer/evidence/contracts', { cwd: project.projectRoot }); if (!bw.ok || !cw.ok) throw new Error('contract write failed');
  await writeAliasCatalog(aliasCatalogPath(project.projectRoot), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { baseline: { observationId, requestId, relativeArtifactDir: relative(root, written.artifactRoot) } } });
  const config = JSON.parse(await readFile(projectConfigPath(project.projectRoot), 'utf8')) as Record<string, unknown>; config.acceptance = { contract: { baselineArtifact: relative(project.projectRoot, bw.artifactRoot), changeArtifact: relative(project.projectRoot, cw.artifactRoot) } }; await writeFile(projectConfigPath(project.projectRoot), `${JSON.stringify(config, null, 2)}\n`);
  const scope: VisualChangeActualScope = { entryMode: 'actual-frontend', annotationId: annotation.annotationId, annotationArtifactPath: relative(project.projectRoot, annotation.artifactRoot), baselineObservation: { artifactId: observationId, observationId, requestId, artifactPath: relative(project.projectRoot, written.artifactRoot) }, baselineContract: { artifactId: baseline.baselineId, baselineId: baseline.baselineId, artifactPath: relative(project.projectRoot, bw.artifactRoot) }, changeContract: { artifactId: change.contractId, contractId: change.contractId, contractRequestId: change.contractRequestId, artifactPath: relative(project.projectRoot, cw.artifactRoot) } };
  const created = await createProjectVisualChangeWorkflow({ projectRoot: project.projectRoot, scope }); if (!created.ok) throw new Error('create failed');
  const active = await activateProjectVisualChangeWorkflow({ projectRoot: project.projectRoot, workflowManifestPath: relative(project.projectRoot, created.manifestPath) }); if (!active.ok) throw new Error('activate failed');
  return { ...project, observation, baseline, change, scope, created, active, activePath: relative(project.projectRoot, active.manifestPath) };
}

async function referenceFixture(withContracts = false) {
  const projectRoot = await resources.tempDir('mfo-b6-reference-'); const initialized = await import('../../src/application/projectWorkflowService.js').then(({ initializeFrontendObserverProject }) => initializeFrontendObserverProject({ projectRoot, url: 'http://127.0.0.1:3000', viewport: { width: 1200, height: 800 }, targets: [{ name: 'header', selector: '#header' }, { name: 'sidebar', selector: '#sidebar' }], replace: false })); if (!initialized.ok) throw new Error(initialized.message);
  const root = projectEvidenceRoot(projectRoot); const fixture = await writeReferenceCandidateFixture(root); const refRead = await readExternalReferenceArtifact(path.join(fixture.approvedRoot, 'manifest.json')); if (!refRead.ok) throw new Error(refRead.reason);
  const annotation = await persistAnnotationUnder(root, referenceSourceFor(refRead.artifact), [{ annotationItemId: 'intent', mark: { kind: 'point', x: 1, y: 1 }, interpretation: { state: 'confirmed', confirmedAt: '2026-09-22T00:00:00.000Z', intent: { kind: 'inspect' } } }]);
  const candidate = JSON.parse(await readFile(path.join(fixture.compatibleCandidateRoot, 'manifest.json'), 'utf8')) as ObservationArtifact; if (candidate.screenshot.state !== 'available') throw new Error('screenshot unavailable'); const requestId = 'c'.repeat(64); const observationId = `${requestId}-${'d'.repeat(32)}`; const observationWrite = await writeObservationArtifact({ ...candidate, requestId, observationId }, await readFile(path.join(fixture.compatibleCandidateRoot, candidate.screenshot.value.path)), { cwd: root }); if (!observationWrite.ok) throw new Error('observation write failed');
  await writeAliasCatalog(aliasCatalogPath(projectRoot), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { baseline: { observationId, requestId, relativeArtifactDir: relative(root, observationWrite.artifactRoot) } } });
  let baseline: ReturnType<typeof buildBaselineContract> | undefined; let change: ReturnType<typeof buildChangeContract> | undefined; let baselineRoot: string | undefined;
  if (withContracts) {
    baseline = buildBaselineContract({ sourceObservation: { observationId, requestId, producer: candidate.producer, observationSchemaVersion: candidate.schemaVersion } }); change = buildChangeContract({ activeBaselineIds: [baseline.baselineId] });
    const bw = await writePersistentBaselineContract(baseline, '.frontend-observer/evidence/contracts', { cwd: projectRoot }); const cw = await writePerChangeContract(change, '.frontend-observer/evidence/contracts', { cwd: projectRoot }); if (!bw.ok || !cw.ok) throw new Error('contract write failed'); baselineRoot = bw.artifactRoot;
    const config = JSON.parse(await readFile(projectConfigPath(projectRoot), 'utf8')) as Record<string, unknown>; config.acceptance = { reference: { approvedArtifact: relative(projectRoot, fixture.approvedRoot) }, contract: { baselineArtifact: relative(projectRoot, bw.artifactRoot), changeArtifact: relative(projectRoot, cw.artifactRoot) } }; await writeFile(projectConfigPath(projectRoot), `${JSON.stringify(config, null, 2)}\n`);
  } else { const config = JSON.parse(await readFile(projectConfigPath(projectRoot), 'utf8')) as Record<string, unknown>; config.acceptance = { reference: { approvedArtifact: relative(projectRoot, fixture.approvedRoot) } }; await writeFile(projectConfigPath(projectRoot), `${JSON.stringify(config, null, 2)}\n`); }
  const bindings = [{ referenceRegion: 'header', runtimeTarget: 'header' }, { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' }];
  const scope: VisualChangeReferenceScope = { entryMode: 'reference', annotationId: annotation.annotationId, annotationArtifactPath: relative(projectRoot, annotation.artifactRoot), baselineObservation: { artifactId: observationId, observationId, requestId, artifactPath: relative(projectRoot, observationWrite.artifactRoot) }, ...(baseline !== undefined && baselineRoot !== undefined ? { baselineContract: { artifactId: baseline.baselineId, baselineId: baseline.baselineId, artifactPath: relative(projectRoot, baselineRoot) } } : {}), approvedReference: { artifactId: refRead.artifact.referenceId, referenceId: refRead.artifact.referenceId, referenceRequestId: refRead.artifact.referenceRequestId, artifactPath: relative(projectRoot, fixture.approvedRoot) }, bindings };
  const created = await createProjectVisualChangeWorkflow({ projectRoot, scope }); if (!created.ok) throw new Error('create failed'); const active = await activateProjectVisualChangeWorkflow({ projectRoot, workflowManifestPath: relative(projectRoot, created.manifestPath) }); if (!active.ok) throw new Error('activate failed');
  return { projectRoot, root, fixture, scope, active, activePath: relative(projectRoot, active.manifestPath), baseline, change };
}

describe('visual-change coding-agent handoff application owner', () => {
  it('projects exact actual scope and bounded context without checking, capturing, editing, or persisting a handoff', async () => {
    const fixture = await actualFixture(); const before = await readFile(fixture.active.manifestPath);
    const result = await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath, context: { status: 'none' }, generatedAt: '2026-09-22T10:00:00.000Z', producerVersion: '0.9.1' }); if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.handoff.confirmedScope).toMatchObject({ entryMode: 'actual-frontend', annotationId: fixture.scope.annotationId, baselineContract: { baselineId: fixture.baseline.baselineId }, changeContract: { contractId: fixture.change.contractId, clauses: fixture.change.clauses } });
    expect(result.handoff.boundedAgentContext.sources).toMatchObject({ observationIds: [fixture.observation.observationId], baselineContractId: fixture.baseline.baselineId, changeContractId: fixture.change.contractId }); expect(result.handoff.supplementalContext).toBeUndefined(); expect(result.handoff.expectedPostEditCheck).toEqual({ command: 'check', baselineAlias: 'baseline', json: true }); expect(await readFile(fixture.active.manifestPath)).toEqual(before);
    if (process.env.MFO_BATCH6_PROOF_ROOT) {
      await mkdir(process.env.MFO_BATCH6_PROOF_ROOT, { recursive: true }); await writeFile(path.join(process.env.MFO_BATCH6_PROOF_ROOT, 'observer-visual-change-handoff.json'), serializeVisualChangeAgentHandoff(result.handoff));
      if (process.env.MFO_BATCH6_PROOF_RUN_ID) { const coordinated = await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath, context: { status: 'none' }, generatedAt: '2026-09-22T10:00:00.000Z', producerVersion: '0.9.1', coordination: { provider: 'my-dev-kit-orchestrator', runId: process.env.MFO_BATCH6_PROOF_RUN_ID, ...(process.env.MFO_BATCH6_ORCH_VERSION ? { packageVersion: process.env.MFO_BATCH6_ORCH_VERSION } : {}) } }); if (!coordinated.ok) throw new Error('coordinated proof failed'); expect(coordinated.handoff.visualChangeRequestId).toBe(result.handoff.visualChangeRequestId); expect(coordinated.handoff.visualChangeWorkflowId).toBe(result.handoff.visualChangeWorkflowId); await writeFile(path.join(process.env.MFO_BATCH6_PROOF_ROOT, 'observer-visual-change-handoff-coordinated.json'), serializeVisualChangeAgentHandoff(coordinated.handoff)); }
    }
  });

  it('rejects inactive, restored, acceptance-drifted, and baseline-drifted workflows through the shared readiness owner', async () => {
    const fixture = await actualFixture();
    const inactive = await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: relative(fixture.projectRoot, fixture.created.manifestPath), context: { status: 'none' }, generatedAt: 'x', producerVersion: '0.9.1' }); expect(inactive).toMatchObject({ ok: false, code: 'workflow-inactive' });
    const restored = await restoreProjectVisualChangeWorkflowAcceptance({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath }); if (!restored.ok) throw new Error('restore failed'); const restoredResult = await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: relative(fixture.projectRoot, restored.manifestPath), context: { status: 'none' }, generatedAt: 'x', producerVersion: '0.9.1' }); expect(restoredResult).toMatchObject({ ok: false, code: 'workflow-restored' });
  });

  it('projects canonical reference fidelity, exact requirements/bindings, focus targets, and an honest not-applicable correction trace', async () => {
    const fixture = await referenceFixture(); const result = await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath, context: { status: 'none' }, generatedAt: '2026-09-22T10:00:00.000Z', producerVersion: '0.9.1' }); if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.handoff.confirmedScope).toMatchObject({ entryMode: 'reference', approvedReference: { referenceId: fixture.scope.approvedReference.referenceId }, bindings: fixture.scope.bindings }); expect(result.handoff.referenceCorrection).toEqual({ status: 'not-applicable', reason: 'project-contract-context-not-configured' }); expect(result.handoff.boundedAgentContext.fidelity?.state).not.toBe('not-evaluated'); expect(result.handoff.boundedAgentContext.targets.map((target) => target.targetId).sort()).toEqual(['header','sidebar']);
  });

  it('reuses the canonical v0.7 reference correction identity when its exact contract preconditions apply', async () => {
    const fixture = await referenceFixture(true); const result = await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath, context: { status: 'none' }, generatedAt: '2026-09-22T10:00:00.000Z', producerVersion: '0.9.1' }); if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.handoff.referenceCorrection).toMatchObject({ status: 'available', reviewRequestId: expect.any(String) }); expect(result.handoff.confirmedScope).toMatchObject({ entryMode: 'reference', baselineContract: { baselineId: fixture.baseline?.baselineId }, activeChangeContract: { contractId: fixture.change?.contractId } });
  });

  it('includes coherent supplemental context verbatim and rejects unsupported or mismatched context', async () => {
    const fixture = await actualFixture(); const base = await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath, context: { status: 'none' }, generatedAt: 'fixed', producerVersion: '0.9.1' }); if (!base.ok) throw new Error('base failed');
    const included = await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath, context: { status: 'valid', artifact: base.handoff.boundedAgentContext }, generatedAt: 'fixed', producerVersion: '0.9.1' }); expect(included.ok && included.handoff.supplementalContext).toEqual(base.handoff.boundedAgentContext);
    expect(await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath, context: { status: 'unsupported-version', foundSchemaVersion: '2.0.0' }, generatedAt: 'fixed', producerVersion: '0.9.1' })).toMatchObject({ ok: false, code: 'unsupported-context' });
    const mismatch = structuredClone(base.handoff.boundedAgentContext); mismatch.sources.observationIds = ['other']; expect(await prepareVisualChangeAgentHandoff({ projectRoot: fixture.projectRoot, workflowManifestPath: fixture.activePath, context: { status: 'valid', artifact: mismatch }, generatedAt: 'fixed', producerVersion: '0.9.1' })).toMatchObject({ ok: false, code: 'context-mismatch' });
  });
});
