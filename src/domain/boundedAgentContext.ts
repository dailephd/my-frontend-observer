/**
 * v0.6 Batch 1: frozen contract foundation for a bounded, deterministic,
 * referenceable agent-context artifact plus optional runtime/static
 * correlation evidence.
 *
 * Independent artifact family from observation (`1.2.0`), comparison
 * (`1.0.0`), frontend-contract (`1.0.0`), and frontend-contract-evaluation
 * (`1.0.0`) - never reuses their `ARTIFACT_KIND`/schema constants. Follows
 * the same producer/provenance/source-reference/structural-validator shape
 * as `frontendContractEvaluationArtifact.ts`.
 *
 * This module is pure contract foundation: types, constants, and structural
 * validators only. It contains no runtime-projection derivation, no
 * my-dev-kit invocation, and no correlation-matching logic - those are v0.6
 * Batch 2+ concerns.
 */
import { isValidEvidenceReference, type EvidenceReference } from './relationships.js';
import { PRODUCER_NAME } from './schema.js';
import type { ArtifactReference, TargetGeometry, TargetVisibility, OverflowEvidence, ScrollOwnerInterpretation } from './schema.js';
import type { ReferenceRequirementAdequacy } from './externalReferenceRequirements.js';
import { isValidReferenceRequirementAdequacy } from './externalReferenceRequirements.js';
import type { ComparabilityResult } from './comparison.js';
import { isValidComparabilityResult } from './comparison.js';
import type { ReferenceRequirementFidelityResult, ReferenceFidelityState, ReferenceFidelityBlockReason } from './externalReferenceFidelity.js';
import { REFERENCE_FIDELITY_STATES, REFERENCE_FIDELITY_BLOCK_REASONS, isValidReferenceRequirementFidelityResult } from './externalReferenceFidelity.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isEvidenceReferenceArray(value: unknown): value is EvidenceReference[] {
  return Array.isArray(value) && value.every((entry) => isValidEvidenceReference(entry));
}

function isValidArtifactReference(value: unknown): value is ArtifactReference {
  return isPlainObject(value) && isNonEmptyString(value.path) && isNonEmptyString(value.kind);
}

export const BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND = 'my-frontend-observer/bounded-agent-context' as const;
export const BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Batch 1 freezes exactly one projection profile. A profile discriminator is
 * kept (rather than omitted) because it is required to fail closed on future
 * unsupported profiles; no plugin/registry framework is introduced.
 */
export const PROJECTION_PROFILES = ['frontend-change-review'] as const;
export type ProjectionProfile = (typeof PROJECTION_PROFILES)[number];

function isValidProjectionProfile(value: unknown): value is ProjectionProfile {
  return typeof value === 'string' && (PROJECTION_PROFILES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Numeric bounds (frozen first-version caps, judgment calls grounded in the
// existing ~10-named-target example count in docs/PROJECT_MILESTONES.md and
// the MAX_CONFIGURED_TARGETS_FOR_RELATIONSHIPS=20 precedent in
// relationships.ts; no measured fixture corpus exists yet for this concept)
// ---------------------------------------------------------------------------

export const MAX_RUNTIME_TARGETS = 25;
export const MAX_RELATIONSHIP_EVIDENCE_PER_TARGET = 10;
export const MAX_OMISSIONS = 50;
export const MAX_TRUNCATIONS = 50;
export const MAX_CORRELATION_RECORDS = 25;
export const MAX_STATIC_CANDIDATES_PER_TARGET = 5;
export const MAX_TEXT_SUMMARY_CHARS = 2000;
/** Bounds StaticCandidateReference.evidenceRefs and RuntimeStaticCorrelationRecord.runtimeEvidenceRefs - reuses MAX_RELATIONSHIP_EVIDENCE_PER_TARGET's value so no nested collection in this contract is unbounded. */
export const MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD = MAX_RELATIONSHIP_EVIDENCE_PER_TARGET;
/**
 * v0.7 Prompt 7 addition: bounds `BoundedReferenceFidelityProjection.mismatches`
 * - a judgment-call cap in the same spirit as the Batch 1 bounds above (no
 * measured fixture corpus exists yet for this concept either).
 */
export const MAX_FIDELITY_MISMATCHES = 15;
/** Bounds `BoundedReferenceFidelityProjection.protectedContext` - reuses `MAX_RELATIONSHIP_EVIDENCE_PER_TARGET`'s value for the same "small, bounded per-topic context list" reason. */
export const MAX_FIDELITY_PROTECTED_CONTEXT = MAX_RELATIONSHIP_EVIDENCE_PER_TARGET;

// ---------------------------------------------------------------------------
// Adequacy (explicit, non-boolean, structured reasons)
// ---------------------------------------------------------------------------

export const ADEQUACY_STATES = ['adequate', 'partial', 'inadequate'] as const;
export type AdequacyState = (typeof ADEQUACY_STATES)[number];

export const ADEQUACY_REASON_CODES = [
  'required-runtime-target-unavailable',
  'required-runtime-property-unavailable',
  'required-contract-evidence-unavailable',
  'required-evidence-omitted-by-bound',
  'static-correlation-ambiguous',
  'static-evidence-unavailable',
  'required-source-evidence-truncated',
  'unsupported-evidence-version',
  'consumer-incompatibility',
] as const;
export type AdequacyReasonCode = (typeof ADEQUACY_REASON_CODES)[number];

export interface AdequacyReason {
  code: AdequacyReasonCode;
  detail?: string;
}

function isValidAdequacyReason(value: unknown): value is AdequacyReason {
  if (!isPlainObject(value)) return false;
  if (typeof value.code !== 'string' || !(ADEQUACY_REASON_CODES as readonly string[]).includes(value.code)) return false;
  if (value.detail !== undefined && typeof value.detail !== 'string') return false;
  return true;
}

/** `state` is never implied by evidence merely existing - it is always an explicit field. Non-`adequate` states require at least one reason. */
export interface Adequacy {
  state: AdequacyState;
  reasons: AdequacyReason[];
}

/** v0.6 Batch 3: exported for reuse by `boundedAgentContextCorrelation.ts` (see note on `isValidStaticEvidenceProducerIdentity`). No logic change. */
export function isValidAdequacy(value: unknown): value is Adequacy {
  if (!isPlainObject(value)) return false;
  if (typeof value.state !== 'string' || !(ADEQUACY_STATES as readonly string[]).includes(value.state)) return false;
  if (!Array.isArray(value.reasons) || !value.reasons.every(isValidAdequacyReason)) return false;
  if (value.state !== 'adequate' && value.reasons.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Omission / truncation (kept distinct; required loss visible)
// ---------------------------------------------------------------------------

export const OMISSION_REASONS = [
  'not-observed',
  'unsupported-or-unavailable',
  'intentionally-irrelevant',
  'omitted-by-bound',
  'required-evidence-lost-by-bound',
] as const;
export type OmissionReason = (typeof OMISSION_REASONS)[number];

/** `required: true` with reason `required-evidence-lost-by-bound` is the frozen representation of required-evidence loss (distinct from optional truncation). */
export interface OmissionRecord {
  subject: string;
  reason: OmissionReason;
  required: boolean;
  detail?: string;
}

/** v0.6 Batch 3: exported for reuse by `boundedAgentContextCorrelation.ts` (see note on `isValidStaticEvidenceProducerIdentity`). No logic change. */
export function isValidOmissionRecord(value: unknown): value is OmissionRecord {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.subject)) return false;
  if (typeof value.reason !== 'string' || !(OMISSION_REASONS as readonly string[]).includes(value.reason)) return false;
  if (typeof value.required !== 'boolean') return false;
  if (value.detail !== undefined && typeof value.detail !== 'string') return false;
  return true;
}

/** A bounded collection or text field that exceeded its frozen cap. `required: true` marks loss of evidence the task needed; `required: false` marks optional truncation. */
export interface TruncationRecord {
  subject: string;
  limit: number;
  actualCount: number;
  required: boolean;
}

/** v0.6 Batch 3: exported for reuse by `boundedAgentContextCorrelation.ts` (see note on `isValidStaticEvidenceProducerIdentity`). No logic change. */
export function isValidTruncationRecord(value: unknown): value is TruncationRecord {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.subject)) return false;
  if (typeof value.limit !== 'number' || !Number.isInteger(value.limit) || value.limit < 0) return false;
  if (typeof value.actualCount !== 'number' || !Number.isInteger(value.actualCount) || value.actualCount < 0) return false;
  if (typeof value.required !== 'boolean') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Source references (references only - never embeds source artifact payloads)
// ---------------------------------------------------------------------------

/** References existing v0.1-v0.5 authoritative artifacts by identity only; never embeds their payloads. */
export interface BoundedAgentContextSourceReferences {
  observationIds: string[];
  comparisonId?: string;
  comparisonRequestId?: string;
  baselineContractId?: string;
  changeContractId?: string;
  evaluationId?: string;
  evaluationRequestId?: string;
  /** v0.7 Prompt 7 addition (additive, optional - a pre-Prompt-7 context predates this field entirely and remains valid without it). The `ExternalReferenceArtifact` a bounded fidelity projection, when present, was derived from. */
  referenceId?: string;
  referenceRequestId?: string;
}

function isValidSourceReferences(value: unknown): value is BoundedAgentContextSourceReferences {
  if (!isPlainObject(value)) return false;
  if (!Array.isArray(value.observationIds) || value.observationIds.length === 0 || !value.observationIds.every(isNonEmptyString)) return false;
  const optionalStringFields = ['comparisonId', 'comparisonRequestId', 'baselineContractId', 'changeContractId', 'evaluationId', 'evaluationRequestId', 'referenceId', 'referenceRequestId'] as const;
  for (const field of optionalStringFields) {
    if (value[field] !== undefined && !isNonEmptyString(value[field])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bounded runtime target projection (reuses existing schema value objects -
// no second runtime truth model)
// ---------------------------------------------------------------------------

function isValidTargetGeometry(value: unknown): value is TargetGeometry {
  if (!isPlainObject(value)) return false;
  return (['x', 'y', 'width', 'height', 'right', 'bottom'] as const).every((key) => typeof value[key] === 'number');
}

function isValidTargetVisibility(value: unknown): value is TargetVisibility {
  return isPlainObject(value) && typeof value.visible === 'boolean';
}

function isValidOverflowEvidence(value: unknown): value is OverflowEvidence {
  if (!isPlainObject(value)) return false;
  if (typeof value.horizontalOverflow !== 'boolean' || typeof value.verticalOverflow !== 'boolean') return false;
  return typeof value.overflowX === 'string' && typeof value.overflowY === 'string';
}

function isValidScrollOwnerInterpretation(value: unknown): value is ScrollOwnerInterpretation {
  if (!isPlainObject(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'target') return isNonEmptyString(value.target);
  return value.kind === 'document' || value.kind === 'none' || value.kind === 'indeterminate';
}

/** Task-relevant bounded subset of one stable observer runtime target's evidence. Every field is optional - absence means "not included in this bounded projection", never a fabricated value. */
export interface BoundedRuntimeTargetProjection {
  targetId: string;
  geometry?: TargetGeometry;
  visibility?: TargetVisibility;
  overflow?: OverflowEvidence;
  scrollOwner?: ScrollOwnerInterpretation;
  relationshipEvidence?: EvidenceReference[];
  screenshotRef?: ArtifactReference;
}

function isValidBoundedRuntimeTargetProjection(value: unknown): value is BoundedRuntimeTargetProjection {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.targetId)) return false;
  if (value.geometry !== undefined && !isValidTargetGeometry(value.geometry)) return false;
  if (value.visibility !== undefined && !isValidTargetVisibility(value.visibility)) return false;
  if (value.overflow !== undefined && !isValidOverflowEvidence(value.overflow)) return false;
  if (value.scrollOwner !== undefined && !isValidScrollOwnerInterpretation(value.scrollOwner)) return false;
  if (value.relationshipEvidence !== undefined) {
    if (!isEvidenceReferenceArray(value.relationshipEvidence)) return false;
    if (value.relationshipEvidence.length > MAX_RELATIONSHIP_EVIDENCE_PER_TARGET) return false;
  }
  if (value.screenshotRef !== undefined && !isValidArtifactReference(value.screenshotRef)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Runtime/static correlation (evidence, not ownership or edit authorization)
// ---------------------------------------------------------------------------

export const CORRELATION_STATUSES = ['correlated', 'ambiguous', 'unavailable'] as const;
export type CorrelationStatus = (typeof CORRELATION_STATUSES)[number];

/** Kinds of my-dev-kit stable static identity a candidate reference may carry. Observer never invents a third kind. */
export const STATIC_CANDIDATE_KINDS = ['file', 'symbol'] as const;
export type StaticCandidateKind = (typeof STATIC_CANDIDATE_KINDS)[number];

/** Enough my-dev-kit producer/index identity to reason about compatibility without duplicating its structural schemas. */
export interface StaticEvidenceProducerIdentity {
  name: string;
  version: string;
  indexId: string;
}

/**
 * v0.6 Batch 3: exported (was previously module-private) so
 * `boundedAgentContextCorrelation.ts` can reuse this structural validator
 * instead of duplicating it. No change to its logic, signature, or the
 * frozen `StaticEvidenceProducerIdentity` contract itself.
 */
export function isValidStaticEvidenceProducerIdentity(value: unknown): value is StaticEvidenceProducerIdentity {
  if (!isPlainObject(value)) return false;
  return isNonEmptyString(value.name) && isNonEmptyString(value.version) && isNonEmptyString(value.indexId);
}

/** The exact my-dev-kit node id string is preserved verbatim - never normalized/rewritten into an observer-owned id. */
export interface StaticCandidateReference {
  candidateId: string;
  kind: StaticCandidateKind;
  evidenceRefs: EvidenceReference[];
}

/** v0.6 Batch 3: exported for reuse by `boundedAgentContextCorrelation.ts` (see note on `isValidStaticEvidenceProducerIdentity`). No logic change. */
export function isValidStaticCandidateReference(value: unknown): value is StaticCandidateReference {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.candidateId)) return false;
  if (typeof value.kind !== 'string' || !(STATIC_CANDIDATE_KINDS as readonly string[]).includes(value.kind)) return false;
  // Best-effort my-dev-kit node-id-prefix consistency check (full node-id grammar validation is my-dev-kit's own responsibility, not this observer's).
  if (value.kind === 'file' && !value.candidateId.startsWith('file:')) return false;
  if (value.kind === 'symbol' && !value.candidateId.startsWith('symbol:')) return false;
  if (!isEvidenceReferenceArray(value.evidenceRefs)) return false;
  return value.evidenceRefs.length <= MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD;
}

/**
 * Evidence connecting one observer runtime target to zero, one, or several
 * my-dev-kit static candidates. Deliberately has no `owner`, `causedBy`, or
 * similarly strong-claim field - correlation is evidence, never edit
 * authorization or proof of source ownership.
 */
export interface RuntimeStaticCorrelationRecord {
  runtimeTargetId: string;
  runtimeEvidenceRefs: EvidenceReference[];
  staticProducer: StaticEvidenceProducerIdentity;
  status: CorrelationStatus;
  candidates: StaticCandidateReference[];
  evidenceBasis?: string;
  omissions?: OmissionRecord[];
  truncations?: TruncationRecord[];
  provenance: { correlatedAt: string };
}

/** v0.6 Batch 3: exported for reuse by `boundedAgentContextCorrelation.ts` (see note on `isValidStaticEvidenceProducerIdentity`). No logic change. */
export function isValidRuntimeStaticCorrelationRecord(value: unknown): value is RuntimeStaticCorrelationRecord {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.runtimeTargetId)) return false;
  if (!isEvidenceReferenceArray(value.runtimeEvidenceRefs)) return false;
  if (value.runtimeEvidenceRefs.length > MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD) return false;
  if (!isValidStaticEvidenceProducerIdentity(value.staticProducer)) return false;
  if (typeof value.status !== 'string' || !(CORRELATION_STATUSES as readonly string[]).includes(value.status)) return false;
  if (!Array.isArray(value.candidates) || !value.candidates.every(isValidStaticCandidateReference)) return false;
  if (value.candidates.length > MAX_STATIC_CANDIDATES_PER_TARGET) return false;
  // Status/candidate-count invariants: correlated=>exactly one, ambiguous=>at least two, unavailable=>none fabricated.
  if (value.status === 'correlated' && value.candidates.length !== 1) return false;
  if (value.status === 'ambiguous' && value.candidates.length < 2) return false;
  if (value.status === 'unavailable' && value.candidates.length !== 0) return false;
  if (value.evidenceBasis !== undefined) {
    if (typeof value.evidenceBasis !== 'string' || value.evidenceBasis.length > MAX_TEXT_SUMMARY_CHARS) return false;
  }
  if (value.omissions !== undefined && !(Array.isArray(value.omissions) && value.omissions.every(isValidOmissionRecord))) return false;
  if (value.truncations !== undefined && !(Array.isArray(value.truncations) && value.truncations.every(isValidTruncationRecord))) return false;
  if (!isPlainObject(value.provenance) || !isNonEmptyString(value.provenance.correlatedAt)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// v0.7 Prompt 7: bounded reference-fidelity projection (additive - a
// pre-Prompt-7 caller/context predates this concept entirely and remains
// valid without it). Reuses v0.7 Prompt 3/4/6 types wholesale rather than
// re-deriving or duplicating any of their fields - this is a bounded,
// prioritized SELECTION of already-computed `ReferenceRequirementFidelityResult`
// values (Prompt 6), never a second fidelity-evaluation engine.
// ---------------------------------------------------------------------------

/**
 * Bounded, prioritized subset of one `evaluateReferenceCandidateFidelity`
 * result, shaped for a coding-agent's bounded context rather than exhaustive
 * reporting. `mismatches` holds only non-`pass` requirement results (failed/
 * unavailable), highest-priority first, bounded to `MAX_FIDELITY_MISMATCHES`;
 * `protectedContext` holds passing `protected`/`preserved` requirement
 * results surfaced as "do not break this" constraints (disjoint from
 * `mismatches` - a *failing* protected/preserved requirement already
 * appears there, at the highest priority), bounded to
 * `MAX_FIDELITY_PROTECTED_CONTEXT`. Both arrays are empty when
 * `state !== 'pass'` would still fabricate content, or when
 * `state === 'not-evaluated'` - an earlier Prompt 6 blocking gate is always
 * reported via `blockedBy`, never silently converted into "no problems".
 */
export interface BoundedReferenceFidelityProjection {
  referenceId: string;
  referenceRequestId: string;
  candidateObservationId: string;
  candidateRequestId: string;
  adequacy: ReferenceRequirementAdequacy;
  compatibility?: ComparabilityResult;
  state: ReferenceFidelityState;
  blockedBy?: ReferenceFidelityBlockReason;
  mismatches: ReferenceRequirementFidelityResult[];
  protectedContext: ReferenceRequirementFidelityResult[];
}

export function isValidBoundedReferenceFidelityProjection(value: unknown): value is BoundedReferenceFidelityProjection {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.referenceId)) return false;
  if (!isNonEmptyString(value.referenceRequestId)) return false;
  if (!isNonEmptyString(value.candidateObservationId)) return false;
  if (!isNonEmptyString(value.candidateRequestId)) return false;
  if (!isValidReferenceRequirementAdequacy(value.adequacy)) return false;
  if (value.compatibility !== undefined && !isValidComparabilityResult(value.compatibility)) return false;
  if (typeof value.state !== 'string' || !(REFERENCE_FIDELITY_STATES as readonly string[]).includes(value.state)) return false;
  if (value.blockedBy !== undefined && !(REFERENCE_FIDELITY_BLOCK_REASONS as readonly string[]).includes(value.blockedBy as string)) return false;
  if (!Array.isArray(value.mismatches) || !value.mismatches.every(isValidReferenceRequirementFidelityResult)) return false;
  if (value.mismatches.length > MAX_FIDELITY_MISMATCHES) return false;
  if (!Array.isArray(value.protectedContext) || !value.protectedContext.every(isValidReferenceRequirementFidelityResult)) return false;
  if (value.protectedContext.length > MAX_FIDELITY_PROTECTED_CONTEXT) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Top-level artifact
// ---------------------------------------------------------------------------

export interface BoundedAgentContextArtifact {
  artifactKind: typeof BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND;
  schemaVersion: typeof BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION;
  contextId: string;
  contextRequestId: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  provenance: { generatedAt: string };
  projectionProfile: ProjectionProfile;
  sources: BoundedAgentContextSourceReferences;
  targets: BoundedRuntimeTargetProjection[];
  adequacy: Adequacy;
  omissions: OmissionRecord[];
  truncations: TruncationRecord[];
  /**
   * Absent or empty means static correlation was not included for this
   * context - an explicit, distinguishable state, never conflated with
   * "correlation attempted and unavailable" (which is represented per-target
   * via a `RuntimeStaticCorrelationRecord` with `status: 'unavailable'`).
   * The artifact remains fully valid and independently usable with this
   * field absent.
   */
  correlations?: RuntimeStaticCorrelationRecord[];
  /**
   * v0.7 Prompt 7 addition (additive, optional - same backward-compatibility
   * reasoning as `correlations`: a pre-Prompt-7 context predates this field
   * entirely and remains valid without it). Absent means no reference-
   * fidelity evidence was requested for this context - distinct from an
   * evaluated-but-passing fidelity result (`fidelity.state === 'pass'`,
   * `mismatches: []`) or a blocked one (`fidelity.state === 'not-evaluated'`,
   * `blockedBy` set) - both of which are always present, structured,
   * inspectable states when this field is present at all.
   */
  fidelity?: BoundedReferenceFidelityProjection;
}

export type BoundedAgentContextValidationResult = { valid: true } | { valid: false; reason: string };

export function isValidBoundedAgentContextArtifact(value: unknown): BoundedAgentContextValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'artifact must be an object' };
  if (value.artifactKind !== BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND) return { valid: false, reason: 'artifactKind mismatch' };
  if (value.schemaVersion !== BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION) return { valid: false, reason: 'schemaVersion mismatch' };
  if (!isNonEmptyString(value.contextId)) return { valid: false, reason: 'contextId must be a non-empty string' };
  if (!isNonEmptyString(value.contextRequestId)) return { valid: false, reason: 'contextRequestId must be a non-empty string' };
  if (!isPlainObject(value.producer) || value.producer.name !== PRODUCER_NAME || !isNonEmptyString(value.producer.version)) {
    return { valid: false, reason: 'producer must be { name: "my-frontend-observer", version: string }' };
  }
  if (!isPlainObject(value.provenance) || !isNonEmptyString(value.provenance.generatedAt)) {
    return { valid: false, reason: 'provenance.generatedAt must be a non-empty string' };
  }
  if (!isValidProjectionProfile(value.projectionProfile)) {
    return { valid: false, reason: `projectionProfile must be one of: ${PROJECTION_PROFILES.join(', ')}` };
  }
  if (!isValidSourceReferences(value.sources)) return { valid: false, reason: 'sources reference is invalid' };
  if (!Array.isArray(value.targets) || !value.targets.every(isValidBoundedRuntimeTargetProjection)) {
    return { valid: false, reason: 'targets must be an array of valid bounded runtime target projections' };
  }
  if (value.targets.length > MAX_RUNTIME_TARGETS) return { valid: false, reason: `targets exceeds the frozen limit of ${MAX_RUNTIME_TARGETS}` };
  if (!isValidAdequacy(value.adequacy)) return { valid: false, reason: 'adequacy is invalid' };
  if (!Array.isArray(value.omissions) || !value.omissions.every(isValidOmissionRecord)) {
    return { valid: false, reason: 'omissions must be an array of valid omission records' };
  }
  if (value.omissions.length > MAX_OMISSIONS) return { valid: false, reason: `omissions exceeds the frozen limit of ${MAX_OMISSIONS}` };
  if (!Array.isArray(value.truncations) || !value.truncations.every(isValidTruncationRecord)) {
    return { valid: false, reason: 'truncations must be an array of valid truncation records' };
  }
  if (value.truncations.length > MAX_TRUNCATIONS) return { valid: false, reason: `truncations exceeds the frozen limit of ${MAX_TRUNCATIONS}` };
  if (value.correlations !== undefined) {
    if (!Array.isArray(value.correlations) || !value.correlations.every(isValidRuntimeStaticCorrelationRecord)) {
      return { valid: false, reason: 'correlations must be an array of valid runtime/static correlation records' };
    }
    if (value.correlations.length > MAX_CORRELATION_RECORDS) {
      return { valid: false, reason: `correlations exceeds the frozen limit of ${MAX_CORRELATION_RECORDS}` };
    }
  }
  if (value.fidelity !== undefined && !isValidBoundedReferenceFidelityProjection(value.fidelity)) {
    return { valid: false, reason: 'fidelity is invalid' };
  }
  return { valid: true };
}
