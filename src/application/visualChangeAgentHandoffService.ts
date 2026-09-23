import path from 'node:path';
import { readObservationArtifact } from '../artifacts/artifactReader.js';
import { readExternalReferenceArtifact } from '../artifacts/externalReferenceArtifactReader.js';
import { readPerChangeContract, readPersistentBaselineContract } from '../artifacts/frontendContractArtifactReader.js';
import type { BoundedAgentContextArtifact } from '../domain/boundedAgentContext.js';
import { projectBoundedAgentContext } from '../domain/boundedAgentContextProjection.js';
import { evaluateReferenceCandidateFidelity } from '../domain/externalReferenceFidelity.js';
import type { PerChangeContract, PersistentBaselineContract } from '../domain/frontendContracts.js';
import { prepareReferenceCorrection } from '../domain/referenceCorrectionWorkflow.js';
import type { VisualChangeAgentConfirmedScope, VisualChangeAgentHandoff, VisualChangeExternalCoordination, VisualChangeReferenceCorrectionTrace } from '../domain/visualChangeAgentHandoff.js';
import { VISUAL_CHANGE_AGENT_HANDOFF_KIND, VISUAL_CHANGE_AGENT_HANDOFF_VERSION, isValidVisualChangeAgentHandoff } from '../domain/visualChangeAgentHandoff.js';
import { resolveContainedAcceptancePath } from '../projectWorkflow/checkAcceptance.js';
import { prepareActiveVisualChangeWorkflow, readProjectVisualChangeCycle } from './visualChangeProjectWorkflowService.js';

export type PrepareVisualChangeAgentHandoffFailureCode = 'workflow-invalid'|'workflow-inactive'|'workflow-restored'|'acceptance-drift'|'baseline-drift'|'evidence-unavailable'|'reference-not-evaluable'|'unsupported-context'|'context-mismatch'|'bounded-context-failed'|'invalid-handoff'|'review-required'|'workflow-accepted'|'workflow-abandoned';
export type PrepareVisualChangeAgentHandoffResult = { ok: true; handoff: VisualChangeAgentHandoff } | { ok: false; code: PrepareVisualChangeAgentHandoffFailureCode; reason: string };
export interface PrepareVisualChangeAgentHandoffInput { projectRoot: string; workflowManifestPath: string; context: { status: 'none' } | { status: 'unsupported-version'; foundSchemaVersion: string } | { status: 'valid'; artifact: BoundedAgentContextArtifact }; generatedAt: string; producerVersion: string; coordination?: VisualChangeExternalCoordination }

const fail = (code: PrepareVisualChangeAgentHandoffFailureCode, reason: string): PrepareVisualChangeAgentHandoffResult => ({ ok: false, code, reason });
function manifest(projectRoot: string, portable: string): string | undefined { const resolved = resolveContainedAcceptancePath(projectRoot, portable); return resolved.ok ? path.join(resolved.path, 'manifest.json') : undefined; }

function contextCoherent(context: BoundedAgentContextArtifact, scope: VisualChangeAgentConfirmedScope): boolean {
  if (!context.sources.observationIds.includes(scope.baselineObservation.observationId)) return false;
  if (scope.entryMode === 'actual-frontend') return (context.sources.baselineContractId === undefined || context.sources.baselineContractId === scope.baselineContract.baselineId) && (context.sources.changeContractId === undefined || context.sources.changeContractId === scope.changeContract.contractId);
  return (context.sources.baselineContractId === undefined || context.sources.baselineContractId === scope.baselineContract?.baselineId) && (context.sources.referenceId === undefined || context.sources.referenceId === scope.approvedReference.referenceId) && (context.sources.referenceRequestId === undefined || context.sources.referenceRequestId === scope.approvedReference.referenceRequestId);
}

export async function prepareVisualChangeAgentHandoff(input: PrepareVisualChangeAgentHandoffInput): Promise<PrepareVisualChangeAgentHandoffResult> {
  const preflight = await readProjectVisualChangeCycle(input.projectRoot, input.workflowManifestPath); if (!preflight.ok) return fail('workflow-invalid', preflight.reason); if (preflight.cycle === 'review-required') return fail('review-required', 'the latest attempt requires explicit human review before another handoff'); if (preflight.cycle === 'accepted') return fail('workflow-accepted', 'accepted workflow is terminal'); if (preflight.cycle === 'abandoned') return fail('workflow-abandoned', 'abandoned workflow is terminal');
  const ready = await prepareActiveVisualChangeWorkflow(input.projectRoot, input.workflowManifestPath);
  if (!ready.ok) {
    const mapping: Record<string, PrepareVisualChangeAgentHandoffFailureCode> = { 'activation-not-configured': 'workflow-inactive', 'activation-already-restored': 'workflow-restored', 'acceptance-drift': 'acceptance-drift', 'baseline-drift': 'baseline-drift', 'workflow-invalid': 'workflow-invalid', 'workflow-reference-invalid': 'evidence-unavailable' };
    return fail(mapping[ready.code] ?? 'evidence-unavailable', ready.reason);
  }
  if (input.context.status === 'unsupported-version') return fail('unsupported-context', `supplemental context schema ${input.context.foundSchemaVersion} is unsupported`);
  const { projectRoot, workflow, config, baselineAlias } = ready.context; const scope = workflow.scope;
  const baselinePath = manifest(projectRoot, scope.baselineObservation.artifactPath); const baselineRead = baselinePath === undefined ? undefined : await readObservationArtifact(baselinePath);
  if (baselineRead === undefined || !baselineRead.ok) return fail('evidence-unavailable', 'frozen baseline observation is unavailable');
  const observation = baselineRead.artifact;
  let baselineContract: PersistentBaselineContract | undefined;
  if (scope.baselineContract !== undefined) { const file = manifest(projectRoot, scope.baselineContract.artifactPath); const read = file === undefined ? undefined : await readPersistentBaselineContract(file); if (read === undefined || !read.ok) return fail('evidence-unavailable', 'frozen baseline contract is unavailable'); baselineContract = read.contract; }
  let activeChangeContract: PerChangeContract | undefined;
  if (config.acceptance?.contract !== undefined) { const file = manifest(projectRoot, config.acceptance.contract.changeArtifact); const read = file === undefined ? undefined : await readPerChangeContract(file); if (read === undefined || !read.ok) return fail('evidence-unavailable', 'active change contract is unavailable'); activeChangeContract = read.contract; }

  let confirmedScope: VisualChangeAgentConfirmedScope; let primary: BoundedAgentContextArtifact; let trace: VisualChangeReferenceCorrectionTrace | undefined;
  if (scope.entryMode === 'actual-frontend') {
    if (baselineContract === undefined) return fail('evidence-unavailable', 'actual workflow baseline contract is unavailable');
    const changeFile = manifest(projectRoot, scope.changeContract.artifactPath); const changeRead = changeFile === undefined ? undefined : await readPerChangeContract(changeFile); if (changeRead === undefined || !changeRead.ok) return fail('evidence-unavailable', 'frozen change contract is unavailable');
    confirmedScope = { entryMode: 'actual-frontend', annotationId: scope.annotationId, baselineObservation: { observationId: observation.observationId, requestId: observation.requestId }, baselineContract: { baselineId: baselineContract.baselineId, clauses: baselineContract.clauses }, changeContract: { contractId: changeRead.contract.contractId, contractRequestId: changeRead.contract.contractRequestId, clauses: changeRead.contract.clauses } };
    const projected = projectBoundedAgentContext({ generatedAt: input.generatedAt, producerVersion: input.producerVersion, projectionProfile: 'frontend-change-review', observation, baseline: baselineContract, change: changeRead.contract, focusTargetIds: [] });
    if (!projected.ok) return fail('bounded-context-failed', projected.reason); primary = projected.artifact;
  } else {
    const referenceFile = manifest(projectRoot, scope.approvedReference.artifactPath); const referenceRead = referenceFile === undefined ? undefined : await readExternalReferenceArtifact(referenceFile); if (referenceRead === undefined || !referenceRead.ok) return fail('evidence-unavailable', 'approved reference is unavailable'); const reference = referenceRead.artifact;
    const fidelityResult = evaluateReferenceCandidateFidelity(reference, observation, scope.bindings); if (!fidelityResult.ok || fidelityResult.evaluation.state === 'not-evaluated') return fail('reference-not-evaluable', fidelityResult.ok ? 'canonical reference fidelity is not evaluated' : fidelityResult.reason);
    const coherentBaseline = baselineContract !== undefined && baselineContract.sourceObservation.observationId === observation.observationId ? baselineContract : undefined;
    if (baselineContract !== undefined && coherentBaseline === undefined) trace = { status: 'not-applicable', reason: 'baseline-contract-source-mismatch' };
    else if (coherentBaseline !== undefined && activeChangeContract !== undefined) {
      const correction = prepareReferenceCorrection({ reference, baselineObservation: observation, currentObservation: observation, baselineContract: coherentBaseline, changeContract: activeChangeContract, bindingDeclarations: scope.bindings, generatedAt: input.generatedAt, producerVersion: input.producerVersion, projectionProfile: 'frontend-change-review' });
      if (!correction.ok) return fail('reference-not-evaluable', correction.reason); if (correction.status !== 'handoff-ready') return fail('reference-not-evaluable', 'canonical reference correction is blocked'); trace = { status: 'available', reviewRequestId: correction.reviewRequestId };
    } else trace = { status: 'not-applicable', reason: 'project-contract-context-not-configured' };
    const projected = projectBoundedAgentContext({ generatedAt: input.generatedAt, producerVersion: input.producerVersion, projectionProfile: 'frontend-change-review', observation, fidelity: fidelityResult.evaluation, focusTargetIds: [...new Set(scope.bindings.map((binding) => binding.runtimeTarget))], ...(coherentBaseline === undefined ? {} : { baseline: coherentBaseline }), ...(activeChangeContract === undefined ? {} : { change: activeChangeContract }) });
    if (!projected.ok) return fail('bounded-context-failed', projected.reason); primary = projected.artifact;
    confirmedScope = { entryMode: 'reference', annotationId: scope.annotationId, baselineObservation: { observationId: observation.observationId, requestId: observation.requestId }, approvedReference: { referenceId: reference.referenceId, referenceRequestId: reference.referenceRequestId, requirements: reference.requirements ?? [] }, bindings: scope.bindings, ...(coherentBaseline === undefined ? {} : { baselineContract: { baselineId: coherentBaseline.baselineId, clauses: coherentBaseline.clauses } }), ...(activeChangeContract === undefined ? {} : { activeChangeContract: { contractId: activeChangeContract.contractId, contractRequestId: activeChangeContract.contractRequestId, clauses: activeChangeContract.clauses } }) };
  }
  const supplemental = input.context.status === 'valid' ? input.context.artifact : undefined; if (supplemental !== undefined && !contextCoherent(supplemental, confirmedScope)) return fail('context-mismatch', 'supplemental context does not match the frozen workflow evidence');
  const verificationPlan = ['Edit target source outside Observer.', `Run my-frontend-observer check ${baselineAlias} --json.`, 'The check captures a fresh current observation and evaluates active contracts.', 'A machine PASS still requires later explicit human review/acceptance.', ...(scope.entryMode === 'reference' ? ['The same approved reference and explicit bindings are re-evaluated.', 'Reference fidelity does not override active frontend-contract failures.'] : [])];
  const handoff: VisualChangeAgentHandoff = { handoffKind: VISUAL_CHANGE_AGENT_HANDOFF_KIND, handoffVersion: VISUAL_CHANGE_AGENT_HANDOFF_VERSION, visualChangeRequestId: workflow.visualChangeRequestId, visualChangeWorkflowId: workflow.visualChangeWorkflowId, entryMode: scope.entryMode, confirmedScope, boundedAgentContext: primary, ...(supplemental === undefined ? {} : { supplementalContext: supplemental }), ...(trace === undefined ? {} : { referenceCorrection: trace }), verificationPlan, expectedPostEditCheck: { command: 'check', baselineAlias, json: true }, ...(input.coordination === undefined ? {} : { externalCoordination: input.coordination }) };
  return isValidVisualChangeAgentHandoff(handoff) ? { ok: true, handoff } : fail('invalid-handoff', 'constructed handoff failed canonical validation');
}
