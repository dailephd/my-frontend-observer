/**
 * v0.7 Prompt 8 controlled end-to-end external-reference coding-agent
 * correction workflow coordinator. This module composes the already-
 * existing, independently-owned Prompt 1-7 and v0.1/v0.4/v0.5/v0.6 engines
 * into two pure operations - `prepareReferenceCorrection` (produce a
 * bounded coding-agent handoff from the current, pre-change state) and
 * `reviewReferenceCorrectionAttempt` (compose one candidate's overall PASS/
 * FAIL after an external actor has edited target source) - without
 * reimplementing, recomputing, or duplicating any of them:
 *
 * - reference structural/lifecycle rules: `domain/externalReference.ts` (Prompt 1)
 * - reference regions/relationships: `domain/externalReferenceRegions*.ts` (Prompt 2)
 * - selected requirements/tolerances/adequacy: `domain/externalReferenceRequirements.ts` (Prompt 3)
 * - reference/candidate compatibility: `domain/externalReferenceCompatibility.ts` (Prompt 4)
 * - reference-region <-> runtime-target binding: `domain/externalReferenceRuntimeBinding.ts` (Prompt 5)
 * - reference fidelity evaluation: `domain/externalReferenceFidelity.ts` (Prompt 6)
 * - bounded fidelity/runtime/static context: `domain/referenceFidelityProjection.ts` +
 *   `domain/boundedAgentContextProjection.ts` (Prompt 7)
 * - runtime baseline-vs-candidate comparison: `domain/comparisonEngine.ts` (v0.4)
 * - baseline/per-change contract evaluation: `domain/frontendContractEvaluation.ts` (v0.5)
 *
 * This module owns only: reading which of those already-computed results
 * says what, composing one honest overall result, and giving the external
 * implementation actor a bounded, traceable handoff. It never edits target
 * source, never launches a browser, never calls a remote AI provider, never
 * persists anything, and never auto-approves a baseline or a reference -
 * approval remains the caller's own separate, explicit action via the
 * existing `approveAndPersistBaseline`/`approveExternalReference` owners.
 */
import type { ExternalReferenceArtifact } from './externalReference.js';
import { isValidExternalReferenceArtifact, isApprovedExternalReferenceArtifact } from './externalReference.js';
import type { ObservationArtifact } from './schema.js';
import { isValidObservationArtifact } from './schema.js';
import type { PersistentBaselineContract, PerChangeContract } from './frontendContracts.js';
import { isValidPersistentBaselineContract, isValidPerChangeContract } from './frontendContracts.js';
import type { ComparisonArtifact, ComparisonConfig } from './comparison.js';
import { compareObservations } from './comparisonEngine.js';
import type { FrontendContractEvaluationResult } from './frontendContractEvaluation.js';
import { evaluateFrontendContract } from './frontendContractEvaluation.js';
import type { ReferenceRuntimeBindingDeclaration } from './externalReferenceRuntimeBinding.js';
import { isValidReferenceRuntimeBindingDeclarations } from './externalReferenceRuntimeBinding.js';
import type { ReferenceCandidateFidelityEvaluation } from './externalReferenceFidelity.js';
import { evaluateReferenceCandidateFidelity } from './externalReferenceFidelity.js';
import type { BoundedAgentContextArtifact, ProjectionProfile } from './boundedAgentContext.js';
import { projectBoundedAgentContext } from './boundedAgentContextProjection.js';
import { buildReferenceCorrectionReviewIdentity, buildReferenceCorrectionAttemptIdentity } from './referenceCorrectionIdentity.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// Shared preconditions
// ---------------------------------------------------------------------------

interface CommonInput {
  reference: ExternalReferenceArtifact;
  baselineObservation: ObservationArtifact;
  baselineContract: PersistentBaselineContract;
  changeContract: PerChangeContract;
  bindingDeclarations: readonly ReferenceRuntimeBindingDeclaration[];
}

function validateCommon(input: CommonInput): string | undefined {
  const referenceValidation = isValidExternalReferenceArtifact(input.reference);
  if (!referenceValidation.valid) return `reference is invalid: ${referenceValidation.reason}`;
  if (!isApprovedExternalReferenceArtifact(input.reference)) {
    return 'reference must be approved (lifecycle.state !== "approved") - an imported-but-unapproved reference is never treated as an authoritative target design by this workflow';
  }

  const baselineObservationValidation = isValidObservationArtifact(input.baselineObservation);
  if (!baselineObservationValidation.valid) return `baselineObservation is invalid: ${baselineObservationValidation.reason}`;

  const baselineContractValidation = isValidPersistentBaselineContract(input.baselineContract);
  if (!baselineContractValidation.valid) return `baselineContract is invalid: ${baselineContractValidation.reason}`;
  if (input.baselineContract.sourceObservation.observationId !== input.baselineObservation.observationId) {
    return 'baselineContract.sourceObservation.observationId does not match the supplied baselineObservation';
  }

  const changeContractValidation = isValidPerChangeContract(input.changeContract);
  if (!changeContractValidation.valid) return `changeContract is invalid: ${changeContractValidation.reason}`;

  const bindingsValidation = isValidReferenceRuntimeBindingDeclarations(input.bindingDeclarations, input.reference);
  if (!bindingsValidation.valid) return `bindingDeclarations is invalid: ${bindingsValidation.reason}`;

  return undefined;
}

function reviewIdentityFor(input: CommonInput): string {
  return buildReferenceCorrectionReviewIdentity(
    input.reference.referenceRequestId,
    input.baselineObservation.observationId,
    input.baselineContract.baselineId,
    input.baselineContract.clauses,
    input.changeContract.contractId,
    input.changeContract.clauses,
    input.bindingDeclarations,
  );
}

// ---------------------------------------------------------------------------
// A. PREPARE: current (pre-change) state -> bounded coding-agent handoff
// ---------------------------------------------------------------------------

export interface PrepareReferenceCorrectionInput extends CommonInput {
  /** The current, pre-change candidate observation fidelity is measured against. For the canonical proof this is the approved baseline observation itself (see docs/CONTRACTS.md "v0.7 Prompt 8"); a caller may supply a distinct current-state observation only when its own architecture justifies that distinction. */
  currentObservation: ObservationArtifact;
  generatedAt: string;
  producerVersion: string;
  projectionProfile: ProjectionProfile;
  fidelityGeometryTolerancePx?: number;
}

export type PrepareReferenceCorrectionStatus = 'handoff-ready' | 'blocked-not-evaluated';

/**
 * The concrete, machine-readable, human-inspectable handoff boundary the
 * external implementation actor receives. Carries no raw image bytes, no
 * full `ObservationArtifact`/`ExternalReferenceArtifact` payload, and no
 * source excerpt - only stable identities plus the already-bounded Prompt 7
 * projection (which itself already carries the actionable fidelity
 * mismatches, protected/preserved context, and - when the caller supplied
 * it - runtime/static correlation).
 */
export interface ReferenceCorrectionHandoff {
  reviewRequestId: string;
  referenceId: string;
  referenceRequestId: string;
  baselineObservationId: string;
  currentObservationId: string;
  boundedContext: BoundedAgentContextArtifact;
  /** Human-readable statement of what will be re-checked after the external actor edits source - never "make it look like the screenshot". */
  verificationPlan: string[];
}

export type PrepareReferenceCorrectionResult =
  | { ok: true; status: 'handoff-ready'; reviewRequestId: string; fidelity: ReferenceCandidateFidelityEvaluation; handoff: ReferenceCorrectionHandoff }
  | { ok: true; status: 'blocked-not-evaluated'; reviewRequestId: string; fidelity: ReferenceCandidateFidelityEvaluation }
  | { ok: false; reason: string };

const VERIFICATION_PLAN = [
  'A fresh candidate observation will be captured through the existing real-Chromium observation pipeline after the external edit.',
  'The approved external reference will be re-evaluated against that fresh candidate using the same explicit runtime-target bindings (v0.7 Prompt 6 reference fidelity).',
  'The same approved baseline observation will be compared against the fresh candidate using canonical v0.4 comparison, then evaluated against the still-active baseline and per-change contracts using canonical v0.5 contract evaluation.',
  'Overall PASS requires both reference fidelity PASS and v0.5 contract evaluation PASS - matching the reference alone is necessary but not sufficient.',
];

/**
 * Pure and synchronous: no browser, no filesystem, no network, no remote AI
 * call. Evaluates the approved reference against the supplied current
 * (pre-change) observation via Prompt 6, then - only when that evaluation
 * actually produced a result (`state !== 'not-evaluated'`) - projects it
 * into a bounded coding-agent context via Prompt 7/v0.6 and returns the
 * handoff. A `not-evaluated` fidelity (inadequate reference, or reference/
 * candidate incompatible state) is reported honestly as `blocked-not-
 * evaluated`, carrying the full Prompt 6 result for inspection, but never a
 * fabricated handoff that pretends evidence is adequate.
 */
export function prepareReferenceCorrection(input: PrepareReferenceCorrectionInput): PrepareReferenceCorrectionResult {
  const commonError = validateCommon(input);
  if (commonError) return { ok: false, reason: commonError };

  const currentValidation = isValidObservationArtifact(input.currentObservation);
  if (!currentValidation.valid) return { ok: false, reason: `currentObservation is invalid: ${currentValidation.reason}` };
  if (!isNonEmptyString(input.generatedAt)) return { ok: false, reason: 'generatedAt must be a non-empty string' };
  if (!isNonEmptyString(input.producerVersion)) return { ok: false, reason: 'producerVersion must be a non-empty string' };

  const reviewRequestId = reviewIdentityFor(input);

  const geometryOptions = input.fidelityGeometryTolerancePx !== undefined ? { geometryTolerancePx: input.fidelityGeometryTolerancePx } : {};
  const fidelityResult = evaluateReferenceCandidateFidelity(input.reference, input.currentObservation, input.bindingDeclarations, geometryOptions);
  if (!fidelityResult.ok) return { ok: false, reason: `reference fidelity could not be evaluated: ${fidelityResult.reason}` };
  const fidelity = fidelityResult.evaluation;

  if (fidelity.state === 'not-evaluated') {
    return { ok: true, status: 'blocked-not-evaluated', reviewRequestId, fidelity };
  }

  const boundedContextResult = projectBoundedAgentContext({
    generatedAt: input.generatedAt,
    producerVersion: input.producerVersion,
    projectionProfile: input.projectionProfile,
    focusTargetIds: [],
    observation: input.currentObservation,
    fidelity,
  });
  if (!boundedContextResult.ok) return { ok: false, reason: `bounded context could not be constructed: ${boundedContextResult.reason}` };

  const handoff: ReferenceCorrectionHandoff = {
    reviewRequestId,
    referenceId: input.reference.referenceId,
    referenceRequestId: input.reference.referenceRequestId,
    baselineObservationId: input.baselineObservation.observationId,
    currentObservationId: input.currentObservation.observationId,
    boundedContext: boundedContextResult.artifact,
    verificationPlan: VERIFICATION_PLAN,
  };

  return { ok: true, status: 'handoff-ready', reviewRequestId, fidelity, handoff };
}

// ---------------------------------------------------------------------------
// C/D. REVIEW: fresh post-edit candidate -> one overall attempt result
// ---------------------------------------------------------------------------

export const REFERENCE_CORRECTION_OVERALL_STATES = ['not-evaluated', 'pass', 'fail'] as const;
export type ReferenceCorrectionOverallState = (typeof REFERENCE_CORRECTION_OVERALL_STATES)[number];

export interface ReviewReferenceCorrectionAttemptInput extends CommonInput {
  reviewRequestId: string;
  /** The fresh, newly-captured candidate observation (never the baseline itself, never a prior attempt's candidate) to evaluate. */
  candidateObservation: ObservationArtifact;
  /** The immediately-preceding attempt's identity, if this is a correction re-attempt - carried through purely for traceability, never used to alter this attempt's own evaluation (every attempt always compares against the same approved baseline, never attempt-to-attempt). */
  priorAttemptId?: string;
  comparisonConfig?: Partial<ComparisonConfig>;
  fidelityGeometryTolerancePx?: number;
}

/**
 * One fully composed, inspectable review attempt. `overallState` is
 * `'pass'` only when both `fidelity.state === 'pass'` and
 * `contractEvaluation.overallVerdict === 'PASS'`; it is `'not-evaluated'`
 * exactly when Prompt 6's own fidelity evaluation could not run at all
 * (preserved, never collapsed into an ordinary FAIL); otherwise `'fail'` -
 * this covers a structurally-incomparable baseline/candidate pair too,
 * since v0.5's own `evaluateFrontendContract` already reports `'FAIL'`
 * (never `'PASS'`) for that case, per its own established precedent, which
 * this workflow reuses rather than re-deciding. `approvalEligible` is
 * `true` only when `overallState === 'pass'` - it is never itself an
 * approval action; the caller must still invoke the existing explicit
 * `approveAndPersistBaseline`/`approveExternalReference` owners separately.
 */
export interface ReferenceCorrectionAttemptResult {
  reviewRequestId: string;
  attemptId: string;
  priorAttemptId?: string;
  referenceId: string;
  referenceRequestId: string;
  baselineObservationId: string;
  candidateObservationId: string;
  comparison: ComparisonArtifact;
  fidelity: ReferenceCandidateFidelityEvaluation;
  contractEvaluation: FrontendContractEvaluationResult;
  overallState: ReferenceCorrectionOverallState;
  approvalEligible: boolean;
}

export type ReviewReferenceCorrectionAttemptResult = { ok: true; attempt: ReferenceCorrectionAttemptResult } | { ok: false; reason: string };

/**
 * Pure and synchronous: no browser, no filesystem, no network, no remote AI
 * call, no source access. Consumes exactly one already-captured candidate
 * `ObservationArtifact` (the caller is responsible for capturing it through
 * the existing real-Chromium observation pipeline after the external actor
 * has edited target source) and composes the canonical v0.4 comparison,
 * v0.7 Prompt 6 fidelity, and v0.5 contract evaluation into one overall
 * result - reimplementing none of them. Every attempt evaluates the
 * candidate against the *same* supplied `baselineObservation`/
 * `baselineContract`/`changeContract` - this function has no mechanism to
 * compare against a prior attempt's candidate instead, so accumulated
 * drift from the approved baseline can never be hidden.
 */
export function reviewReferenceCorrectionAttempt(input: ReviewReferenceCorrectionAttemptInput): ReviewReferenceCorrectionAttemptResult {
  const commonError = validateCommon(input);
  if (commonError) return { ok: false, reason: commonError };

  const candidateValidation = isValidObservationArtifact(input.candidateObservation);
  if (!candidateValidation.valid) return { ok: false, reason: `candidateObservation is invalid: ${candidateValidation.reason}` };
  if (!isNonEmptyString(input.reviewRequestId)) return { ok: false, reason: 'reviewRequestId must be a non-empty string' };

  const expectedReviewRequestId = reviewIdentityFor(input);
  if (input.reviewRequestId !== expectedReviewRequestId) {
    return { ok: false, reason: 'reviewRequestId does not match the supplied reference/baseline/contracts/bindings (it must be the exact id prepareReferenceCorrection returned for this same semantic review)' };
  }

  const comparisonResult = compareObservations(input.baselineObservation, input.candidateObservation, input.comparisonConfig ?? {});
  if (!comparisonResult.ok) return { ok: false, reason: `baseline/candidate comparison could not be computed: ${comparisonResult.reason}` };
  const comparison = comparisonResult.artifact;

  const geometryOptions = input.fidelityGeometryTolerancePx !== undefined ? { geometryTolerancePx: input.fidelityGeometryTolerancePx } : {};
  const fidelityResult = evaluateReferenceCandidateFidelity(input.reference, input.candidateObservation, input.bindingDeclarations, geometryOptions);
  if (!fidelityResult.ok) return { ok: false, reason: `reference fidelity could not be evaluated: ${fidelityResult.reason}` };
  const fidelity = fidelityResult.evaluation;

  const contractEvaluationResult = evaluateFrontendContract({
    before: input.baselineObservation,
    after: input.candidateObservation,
    comparison,
    baseline: input.baselineContract,
    change: input.changeContract,
  });
  if (!contractEvaluationResult.ok) return { ok: false, reason: `contract evaluation could not be computed: ${contractEvaluationResult.reason}` };
  const contractEvaluation = contractEvaluationResult.evaluation;

  const overallState: ReferenceCorrectionOverallState =
    fidelity.state === 'not-evaluated' ? 'not-evaluated' : fidelity.state === 'pass' && contractEvaluation.overallVerdict === 'PASS' ? 'pass' : 'fail';

  const attemptId = buildReferenceCorrectionAttemptIdentity(input.reviewRequestId, input.candidateObservation.observationId);

  const attempt: ReferenceCorrectionAttemptResult = {
    reviewRequestId: input.reviewRequestId,
    attemptId,
    ...(input.priorAttemptId !== undefined ? { priorAttemptId: input.priorAttemptId } : {}),
    referenceId: input.reference.referenceId,
    referenceRequestId: input.reference.referenceRequestId,
    baselineObservationId: input.baselineObservation.observationId,
    candidateObservationId: input.candidateObservation.observationId,
    comparison,
    fidelity,
    contractEvaluation,
    overallState,
    approvalEligible: overallState === 'pass',
  };

  return { ok: true, attempt };
}
