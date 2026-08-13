/**
 * v0.5 Batch 3 minimal additive persistence envelope for
 * `frontendContractEvaluation.ts#evaluateFrontendContract`'s output. Batch 1
 * froze the evaluation-result vocabulary (`ClauseEvaluationResult`,
 * `OverallVerdict`) and Batch 2 froze the evaluator itself, but neither froze
 * a persistable artifact envelope (identity, provenance, schema ownership,
 * source-evidence references) - this module adds exactly that and nothing
 * else. It reuses the frozen result types unchanged, contains no evaluation
 * logic, and never imports/calls `evaluateFrontendContract`.
 *
 * Independent artifact family from observation (`1.2.0`), comparison
 * (`1.0.0`), and the frontend-contract family (`1.0.0`) - never reuses
 * `ARTIFACT_KIND`/`COMPARISON_ARTIFACT_KIND`/`CONTRACT_ARTIFACT_KIND`.
 */
import { isValidEvidenceReference } from './relationships.js';
import { PRODUCER_NAME, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION } from './schema.js';
import type {
  ClauseEvaluationResult,
  OverallVerdict,
  FrontendContractObservationReference,
} from './frontendContracts.js';
import { isValidClauseEvaluationResult, OVERALL_VERDICTS, isValidFrontendContractObservationReference } from './frontendContracts.js';
import type { UnexpectedChangeResult } from './frontendContractEvaluation.js';
import { DIFFERENCE_KINDS } from './comparison.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export const EVALUATION_ARTIFACT_KIND = 'my-frontend-observer/frontend-contract-evaluation' as const;
export const EVALUATION_SCHEMA_VERSION = '1.0.0' as const;

/** Enough logical identity to trace an evaluation back to its authoritative baseline/per-change contract without embedding either in full. */
export interface FrontendContractEvaluationSourceReference {
  baselineId: string;
  contractId: string;
}

function isValidFrontendContractEvaluationSourceReference(value: unknown): value is FrontendContractEvaluationSourceReference {
  return isPlainObject(value) && isNonEmptyString(value.baselineId) && isNonEmptyString(value.contractId);
}

function isValidUnexpectedChangeResult(value: unknown): value is UnexpectedChangeResult {
  if (!isPlainObject(value)) return false;
  if (value.classification !== 'unexpected') return false;
  if (typeof value.differenceKind !== 'string' || !(DIFFERENCE_KINDS as readonly string[]).includes(value.differenceKind)) return false;
  if (!isPlainObject(value.subject) || typeof value.subject.type !== 'string') return false;
  return Array.isArray(value.supportingEvidence) && value.supportingEvidence.every((e: unknown) => isValidEvidenceReference(e));
}

export interface FrontendContractEvaluationArtifact {
  artifactKind: typeof EVALUATION_ARTIFACT_KIND;
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  evaluationRequestId: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  provenance: { evaluatedAt: string };
  contracts: FrontendContractEvaluationSourceReference;
  before: FrontendContractObservationReference;
  after: FrontendContractObservationReference;
  comparisonId: string;
  comparisonRequestId: string;
  overallVerdict: OverallVerdict;
  activeBaselineClauseIds: string[];
  supersededBaselineClauseIds: string[];
  clauseResults: ClauseEvaluationResult[];
  unexpectedChanges: UnexpectedChangeResult[];
}

export type FrontendContractEvaluationArtifactValidationResult = { valid: true } | { valid: false; reason: string };

export function isValidFrontendContractEvaluationArtifact(value: unknown): FrontendContractEvaluationArtifactValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'artifact must be an object' };
  if (value.artifactKind !== EVALUATION_ARTIFACT_KIND) return { valid: false, reason: 'artifactKind mismatch' };
  if (value.schemaVersion !== EVALUATION_SCHEMA_VERSION) return { valid: false, reason: 'schemaVersion mismatch' };
  if (!isNonEmptyString(value.evaluationId)) return { valid: false, reason: 'evaluationId must be a non-empty string' };
  if (!isNonEmptyString(value.evaluationRequestId)) return { valid: false, reason: 'evaluationRequestId must be a non-empty string' };
  if (!isPlainObject(value.producer) || value.producer.name !== PRODUCER_NAME || !isNonEmptyString(value.producer.version)) {
    return { valid: false, reason: 'producer must be { name: "my-frontend-observer", version: string }' };
  }
  if (!isPlainObject(value.provenance) || !isNonEmptyString(value.provenance.evaluatedAt)) {
    return { valid: false, reason: 'provenance.evaluatedAt must be a non-empty string' };
  }
  if (!isValidFrontendContractEvaluationSourceReference(value.contracts)) return { valid: false, reason: 'contracts reference is invalid' };
  if (!isValidFrontendContractObservationReference(value.before)) return { valid: false, reason: 'before source observation reference is invalid' };
  if (!isValidFrontendContractObservationReference(value.after)) return { valid: false, reason: 'after source observation reference is invalid' };
  if (value.before.observationSchemaVersion !== OBSERVATION_SCHEMA_VERSION || value.after.observationSchemaVersion !== OBSERVATION_SCHEMA_VERSION) {
    return { valid: false, reason: 'source observation references must carry the current observation schema version' };
  }
  if (!isNonEmptyString(value.comparisonId)) return { valid: false, reason: 'comparisonId must be a non-empty string' };
  if (!isNonEmptyString(value.comparisonRequestId)) return { valid: false, reason: 'comparisonRequestId must be a non-empty string' };
  if (typeof value.overallVerdict !== 'string' || !(OVERALL_VERDICTS as readonly string[]).includes(value.overallVerdict)) {
    return { valid: false, reason: 'overallVerdict must be "PASS" or "FAIL"' };
  }
  if (!Array.isArray(value.activeBaselineClauseIds) || !value.activeBaselineClauseIds.every((id: unknown) => isNonEmptyString(id))) {
    return { valid: false, reason: 'activeBaselineClauseIds must be an array of non-empty strings' };
  }
  if (!Array.isArray(value.supersededBaselineClauseIds) || !value.supersededBaselineClauseIds.every((id: unknown) => isNonEmptyString(id))) {
    return { valid: false, reason: 'supersededBaselineClauseIds must be an array of non-empty strings' };
  }
  if (!Array.isArray(value.clauseResults) || !value.clauseResults.every((r: unknown) => isValidClauseEvaluationResult(r))) {
    return { valid: false, reason: 'clauseResults must be an array of valid ClauseEvaluationResult values' };
  }
  if (!Array.isArray(value.unexpectedChanges) || !value.unexpectedChanges.every((u: unknown) => isValidUnexpectedChangeResult(u))) {
    return { valid: false, reason: 'unexpectedChanges must be an array of valid UnexpectedChangeResult values' };
  }
  return { valid: true };
}

/**
 * Pure assembly of the persistence envelope around an already-computed
 * `FrontendContractEvaluationResult` (from `evaluateFrontendContract`) - never
 * recomputes or reinterprets the evaluation. Callers (the application layer)
 * supply the fresh `evaluationId`/`evaluationRequestId` from
 * `frontendContractIdentity.ts` and the `evaluatedAt` timestamp.
 */
export interface BuildFrontendContractEvaluationArtifactInput {
  evaluationId: string;
  evaluationRequestId: string;
  producerVersion: string;
  evaluatedAt: string;
  baselineId: string;
  contractId: string;
  before: FrontendContractObservationReference;
  after: FrontendContractObservationReference;
  comparisonId: string;
  comparisonRequestId: string;
  overallVerdict: OverallVerdict;
  activeBaselineClauseIds: string[];
  supersededBaselineClauseIds: string[];
  clauseResults: ClauseEvaluationResult[];
  unexpectedChanges: UnexpectedChangeResult[];
}

export function buildFrontendContractEvaluationArtifact(input: BuildFrontendContractEvaluationArtifactInput): FrontendContractEvaluationArtifact {
  return {
    artifactKind: EVALUATION_ARTIFACT_KIND,
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationId: input.evaluationId,
    evaluationRequestId: input.evaluationRequestId,
    producer: { name: PRODUCER_NAME, version: input.producerVersion },
    provenance: { evaluatedAt: input.evaluatedAt },
    contracts: { baselineId: input.baselineId, contractId: input.contractId },
    before: input.before,
    after: input.after,
    comparisonId: input.comparisonId,
    comparisonRequestId: input.comparisonRequestId,
    overallVerdict: input.overallVerdict,
    activeBaselineClauseIds: input.activeBaselineClauseIds,
    supersededBaselineClauseIds: input.supersededBaselineClauseIds,
    clauseResults: input.clauseResults,
    unexpectedChanges: input.unexpectedChanges,
  };
}
