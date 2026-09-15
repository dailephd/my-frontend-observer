import type { BaselineClause, ContractPrimitive, PerChangeClause } from '../domain/frontendContracts.js';
import type { FrontendContractEvaluationArtifact } from '../domain/frontendContractEvaluationArtifact.js';
import type { EvidenceReference } from '../domain/relationships.js';
import type { ComparisonDifferenceSubject, DifferenceKind } from '../domain/comparison.js';
import type { ReferenceCandidateFidelityEvaluation, ReferenceRequirementFidelityResult } from '../domain/externalReferenceFidelity.js';

export const CHECK_RESULT_SCHEMA_VERSION = '1.0.0' as const;
export const CHECK_WORKFLOW_STATUSES = ['PASS', 'FAIL', 'REVIEW_REQUIRED', 'BLOCKED'] as const;
export type CheckWorkflowStatus = (typeof CHECK_WORKFLOW_STATUSES)[number];
export const CHECK_MAX_ITEMS_PER_COLLECTION = 50 as const;
export const CHECK_MAX_SUPPORTING_EVIDENCE_PER_ITEM = 10 as const;

export interface CheckObservationSummary { alias: string; observationId: string; requestId: string; artifactPath: string }
export interface CheckComparisonSummary { state: 'NOT_RUN' | 'BLOCKED' | 'comparable' | 'comparable-with-warnings' | 'incomparable'; comparisonId?: string; artifactPath?: string; differenceCount?: number; relationshipChangeCount?: number; diagnosticsCount?: number }
export interface CheckClauseProblem { clauseId: string; source: 'baseline' | 'change'; category?: 'requested' | 'expected-dependent' | 'protected' | 'preserved'; primitive: ContractPrimitive; status: 'fail' | 'unavailable' | 'conflict'; reason?: string; supportingEvidence: EvidenceReference[] }
export interface CheckUnexpectedChange { classification: 'unexpected'; subject: ComparisonDifferenceSubject; differenceKind: DifferenceKind; supportingEvidence: EvidenceReference[] }
export interface CheckContractSummary { configured: boolean; state: 'NOT_CONFIGURED' | 'NOT_RUN' | 'PASS' | 'FAIL' | 'BLOCKED'; overallVerdict?: 'PASS' | 'FAIL'; evaluationId?: string; artifactPath?: string; failedClauses: CheckClauseProblem[]; unavailableClauses: CheckClauseProblem[]; unexpectedChanges: CheckUnexpectedChange[]; truncated: boolean }
export interface CheckReferenceSummary { configured: boolean; state: 'NOT_CONFIGURED' | 'NOT_RUN' | 'PASS' | 'FAIL' | 'BLOCKED'; referenceId?: string; fidelityState?: 'not-evaluated' | 'pass' | 'fail'; blockedBy?: 'reference-inadequate' | 'incompatible'; failedRequirements: ReferenceRequirementFidelityResult[]; unavailableRequirements: ReferenceRequirementFidelityResult[]; truncated: boolean }
export interface CheckBlocker { code: string; message: string }
export interface CheckWorkflowResult { schemaVersion: '1.0.0'; status: CheckWorkflowStatus; baseline?: CheckObservationSummary; candidate?: CheckObservationSummary; comparison: CheckComparisonSummary; contract: CheckContractSummary; reference: CheckReferenceSummary; blockers: CheckBlocker[]; limits: { maxItemsPerCollection: 50; maxSupportingEvidencePerItem: 10; truncated: boolean } }

export function emptyCheckResult(): CheckWorkflowResult {
  return {
    schemaVersion: CHECK_RESULT_SCHEMA_VERSION,
    status: 'BLOCKED',
    comparison: { state: 'NOT_RUN' },
    contract: { configured: false, state: 'NOT_CONFIGURED', failedClauses: [], unavailableClauses: [], unexpectedChanges: [], truncated: false },
    reference: { configured: false, state: 'NOT_CONFIGURED', failedRequirements: [], unavailableRequirements: [], truncated: false },
    blockers: [],
    limits: { maxItemsPerCollection: CHECK_MAX_ITEMS_PER_COLLECTION, maxSupportingEvidencePerItem: CHECK_MAX_SUPPORTING_EVIDENCE_PER_ITEM, truncated: false },
  };
}

function boundedEvidence(evidence: readonly EvidenceReference[]): { value: EvidenceReference[]; truncated: boolean } {
  return { value: evidence.slice(0, CHECK_MAX_SUPPORTING_EVIDENCE_PER_ITEM), truncated: evidence.length > CHECK_MAX_SUPPORTING_EVIDENCE_PER_ITEM };
}

/** Project canonical contract evidence without evaluating any clause. */
export function projectContractResult(
  artifact: FrontendContractEvaluationArtifact,
  baselineClauses: readonly BaselineClause[],
  changeClauses: readonly PerChangeClause[],
  artifactPath: string,
): CheckContractSummary {
  const clauses = new Map<string, { source: 'baseline' | 'change'; clause: BaselineClause | PerChangeClause }>();
  for (const clause of baselineClauses) clauses.set(clause.clauseId, { source: 'baseline', clause });
  for (const clause of changeClauses) clauses.set(clause.clauseId, { source: 'change', clause });

  let truncated = false;
  const problems: CheckClauseProblem[] = [];
  for (const result of artifact.clauseResults) {
    if (result.status === 'pass') continue;
    const authored = clauses.get(result.clauseId);
    if (authored === undefined) continue;
    const evidence = boundedEvidence(result.supportingEvidence);
    truncated ||= evidence.truncated;
    problems.push({
      clauseId: result.clauseId,
      source: authored.source,
      ...(authored.source === 'change' ? { category: (authored.clause as PerChangeClause).category } : {}),
      primitive: authored.clause.primitive,
      status: result.status,
      ...('reason' in result ? { reason: result.reason } : {}),
      supportingEvidence: evidence.value,
    });
  }

  const failedAll = problems.filter((item) => item.status === 'fail');
  const unavailableAll = problems.filter((item) => item.status !== 'fail');
  const failedClauses = failedAll.slice(0, CHECK_MAX_ITEMS_PER_COLLECTION);
  const unavailableClauses = unavailableAll.slice(0, CHECK_MAX_ITEMS_PER_COLLECTION);
  truncated ||= failedAll.length > failedClauses.length || unavailableAll.length > unavailableClauses.length;

  const unexpectedChanges = artifact.unexpectedChanges.slice(0, CHECK_MAX_ITEMS_PER_COLLECTION).map((change) => {
    const evidence = boundedEvidence(change.supportingEvidence);
    truncated ||= evidence.truncated;
    return { ...change, supportingEvidence: evidence.value };
  });
  truncated ||= artifact.unexpectedChanges.length > unexpectedChanges.length;

  const blocked = unavailableAll.length > 0;
  return {
    configured: true,
    state: blocked ? 'BLOCKED' : artifact.overallVerdict,
    overallVerdict: artifact.overallVerdict,
    evaluationId: artifact.evaluationId,
    artifactPath,
    failedClauses,
    unavailableClauses,
    unexpectedChanges,
    truncated,
  };
}

/** Project canonical in-memory fidelity evidence without inferring bindings. */
export function projectReferenceResult(evaluation: ReferenceCandidateFidelityEvaluation): CheckReferenceSummary {
  const failedAll = evaluation.requirementResults.filter((item) => item.status === 'fail');
  const unavailableAll = evaluation.requirementResults.filter((item) => item.status === 'unavailable');
  const failedRequirements = failedAll.slice(0, CHECK_MAX_ITEMS_PER_COLLECTION);
  const unavailableRequirements = unavailableAll.slice(0, CHECK_MAX_ITEMS_PER_COLLECTION);
  const truncated = failedAll.length > failedRequirements.length || unavailableAll.length > unavailableRequirements.length;
  const state = evaluation.state === 'not-evaluated' || unavailableAll.length > 0 ? 'BLOCKED' : evaluation.state === 'pass' ? 'PASS' : 'FAIL';
  return {
    configured: true,
    state,
    referenceId: evaluation.referenceId,
    fidelityState: evaluation.state,
    ...(evaluation.blockedBy === undefined ? {} : { blockedBy: evaluation.blockedBy }),
    failedRequirements,
    unavailableRequirements,
    truncated,
  };
}

export function finalizeCheckStatus(result: CheckWorkflowResult): CheckWorkflowResult {
  result.limits.truncated = result.contract.truncated || result.reference.truncated;
  if (result.blockers.length > 0 || result.contract.state === 'BLOCKED' || result.reference.state === 'BLOCKED') result.status = 'BLOCKED';
  else if (result.contract.state === 'FAIL' || result.reference.state === 'FAIL') result.status = 'FAIL';
  else if (result.contract.configured || result.reference.configured) result.status = 'PASS';
  else result.status = 'REVIEW_REQUIRED';
  return result;
}
