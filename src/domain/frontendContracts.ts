/**
 * v0.5 Batch 1 frontend contract / change-scope contract. Frozen here as
 * pure types/constants/structural validators only - downstream of the v0.4
 * observation/comparison/relationship system (src/domain/comparison.ts,
 * src/domain/relationships.ts, src/domain/schema.ts). This batch implements
 * neither contract evaluation, unexpected-change classification, PASS/FAIL
 * computation, nor persistence - see docs/ARCHITECTURE.md.
 *
 * Contract and observation/comparison are different evidence products: this
 * module never reuses ARTIFACT_KIND (observation) or COMPARISON_ARTIFACT_KIND,
 * and adds no field to ComparisonConfig/ComparisonArtifact.
 */
import type { EvidenceReference, PairwiseRelationshipKind, PageLevelRelationshipKind } from './relationships.js';
import { isValidEvidenceReference, PAIRWISE_RELATIONSHIP_KINDS, PAGE_LEVEL_RELATIONSHIP_KINDS } from './relationships.js';
import type { DependencyProperty } from './comparison.js';
import { DEPENDENCY_PROPERTIES } from './comparison.js';
import { PRODUCER_NAME, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION } from './schema.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isEvidenceReferenceArray(value: unknown): value is EvidenceReference[] {
  return Array.isArray(value) && value.every((entry) => isValidEvidenceReference(entry));
}

export const CONTRACT_ARTIFACT_KIND = 'my-frontend-observer/frontend-contract' as const;
export const CONTRACT_SCHEMA_VERSION = '1.0.0' as const;

// --- Change-scope vocabulary --------------------------------------------------

/** The authored per-change contract has exactly these 4 intent categories - `'unexpected'` is never a member. */
export const AUTHORED_CHANGE_SCOPE_CATEGORIES = ['requested', 'expected-dependent', 'protected', 'preserved'] as const;
export type AuthoredChangeScopeCategory = (typeof AUTHORED_CHANGE_SCOPE_CATEGORIES)[number];

export function isAuthoredChangeScopeCategory(value: unknown): value is AuthoredChangeScopeCategory {
  return typeof value === 'string' && (AUTHORED_CHANGE_SCOPE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Full derived classification vocabulary, kept structurally separate from
 * AUTHORED_CHANGE_SCOPE_CATEGORIES - `'unexpected'` is a classification a
 * future evaluator produces, never an authored permission. No function in
 * this module converts between the two vocabularies.
 */
export const CHANGE_SCOPE_CLASSIFICATIONS = [...AUTHORED_CHANGE_SCOPE_CATEGORIES, 'unexpected'] as const;
export type ChangeScopeClassification = (typeof CHANGE_SCOPE_CLASSIFICATIONS)[number];

export const EXPECTED_DEPENDENT_MODES = ['required', 'permitted'] as const;
export type ExpectedDependentMode = (typeof EXPECTED_DEPENDENT_MODES)[number];

export function isValidExpectedDependentMode(value: unknown): value is ExpectedDependentMode {
  return typeof value === 'string' && (EXPECTED_DEPENDENT_MODES as readonly string[]).includes(value);
}

// --- Contract tolerance (bounded, closed - never a generic expression) -------

/** Independently declared from GEOMETRY_TOLERANCE_*_PX (src/domain/relationships.ts): comparison tolerance suppresses insignificant geometry noise and is never contract authorization. */
export const CONTRACT_TOLERANCE_ABSOLUTE_PX_MIN = 0;
export const CONTRACT_TOLERANCE_ABSOLUTE_PX_MAX = 100;
export const CONTRACT_TOLERANCE_PERCENT_MIN = 0;
export const CONTRACT_TOLERANCE_PERCENT_MAX = 100;

export type ContractTolerance = { kind: 'exact' } | { kind: 'absolute-px'; amount: number } | { kind: 'percent'; amount: number };

export function isValidContractTolerance(value: unknown): value is ContractTolerance {
  if (!isPlainObject(value)) return false;
  if (value.kind === 'exact') return Object.keys(value).length === 1;
  if (value.kind === 'absolute-px') {
    return (
      typeof value.amount === 'number' &&
      Number.isFinite(value.amount) &&
      value.amount >= CONTRACT_TOLERANCE_ABSOLUTE_PX_MIN &&
      value.amount <= CONTRACT_TOLERANCE_ABSOLUTE_PX_MAX
    );
  }
  if (value.kind === 'percent') {
    return (
      typeof value.amount === 'number' &&
      Number.isFinite(value.amount) &&
      value.amount >= CONTRACT_TOLERANCE_PERCENT_MIN &&
      value.amount <= CONTRACT_TOLERANCE_PERCENT_MAX
    );
  }
  return false;
}

// --- Contract primitive vocabulary (bounded, closed) --------------------------

/** Every contract primitive kind this batch freezes - deliberately bounded, never a generic rule/expression language. */
export const CONTRACT_PRIMITIVE_KINDS = [
  'target-visible',
  'target-not-clipped',
  'target-width-within-bound',
  'targets-do-not-overlap',
  'target-wider-than',
  'target-follows-vertically',
  'target-fits-inside',
  'document-width-fits-viewport',
  'scroll-owner-is-document',
  'target-does-not-own-scroll',
  'target-begins-below-initial-viewport',
  'relationship-unchanged',
  'property-unchanged-within-tolerance',
  'property-increases',
  'property-decreases',
] as const;
export type ContractPrimitiveKind = (typeof CONTRACT_PRIMITIVE_KINDS)[number];

/** `target-fits-inside` mirrors relationships.ts's GEOMETRIC_FIT_RELATIONSHIPS ('fits-inside') - geometric fit, explicitly distinct from schema.ts's TargetContainment (DOM containment). */
export type ContractPrimitive =
  | { kind: 'target-visible'; target: string }
  | { kind: 'target-not-clipped'; target: string; axis?: 'horizontal' | 'vertical' | 'both' }
  | { kind: 'target-width-within-bound'; target: string; minPx?: number; maxPx?: number }
  | { kind: 'targets-do-not-overlap'; targetA: string; targetB: string }
  | { kind: 'target-wider-than'; targetA: string; targetB: string }
  | { kind: 'target-follows-vertically'; targetA: string; targetB: string }
  | { kind: 'target-fits-inside'; target: string; container: string }
  | { kind: 'document-width-fits-viewport' }
  | { kind: 'scroll-owner-is-document' }
  | { kind: 'target-does-not-own-scroll'; target: string }
  | { kind: 'target-begins-below-initial-viewport'; target: string }
  | {
      kind: 'relationship-unchanged';
      relationshipKind: PairwiseRelationshipKind | PageLevelRelationshipKind;
      subjectTarget?: string;
      relatedTarget?: string;
    }
  | { kind: 'property-unchanged-within-tolerance'; target: string; property: DependencyProperty; tolerance: ContractTolerance }
  | { kind: 'property-increases'; target: string; property: DependencyProperty; minimumDeltaPx?: number }
  | { kind: 'property-decreases'; target: string; property: DependencyProperty; minimumDeltaPx?: number };

const ALL_RELATIONSHIP_KINDS = [...PAIRWISE_RELATIONSHIP_KINDS, ...PAGE_LEVEL_RELATIONSHIP_KINDS] as readonly string[];

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalNonNegativeFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

/** Rejects extra keys beyond the given allowlist, keeping every ContractPrimitive variant a closed shape rather than an open bag of fields. */
function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function isValidContractPrimitive(value: unknown): value is ContractPrimitive {
  if (!isPlainObject(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'target-visible':
      return hasOnlyKeys(value, ['kind', 'target']) && isNonEmptyString(value.target);
    case 'target-not-clipped':
      return (
        hasOnlyKeys(value, ['kind', 'target', 'axis']) &&
        isNonEmptyString(value.target) &&
        (value.axis === undefined || value.axis === 'horizontal' || value.axis === 'vertical' || value.axis === 'both')
      );
    case 'target-width-within-bound': {
      if (!hasOnlyKeys(value, ['kind', 'target', 'minPx', 'maxPx'])) return false;
      if (!isNonEmptyString(value.target)) return false;
      if (!isOptionalFiniteNumber(value.minPx) || !isOptionalFiniteNumber(value.maxPx)) return false;
      if (value.minPx === undefined && value.maxPx === undefined) return false;
      if (typeof value.minPx === 'number' && typeof value.maxPx === 'number' && value.minPx > value.maxPx) return false;
      return true;
    }
    case 'targets-do-not-overlap':
    case 'target-wider-than':
    case 'target-follows-vertically':
      return (
        hasOnlyKeys(value, ['kind', 'targetA', 'targetB']) &&
        isNonEmptyString(value.targetA) &&
        isNonEmptyString(value.targetB) &&
        value.targetA !== value.targetB
      );
    case 'target-fits-inside':
      return (
        hasOnlyKeys(value, ['kind', 'target', 'container']) &&
        isNonEmptyString(value.target) &&
        isNonEmptyString(value.container) &&
        value.target !== value.container
      );
    case 'document-width-fits-viewport':
    case 'scroll-owner-is-document':
      return hasOnlyKeys(value, ['kind']) && Object.keys(value).length === 1;
    case 'target-does-not-own-scroll':
    case 'target-begins-below-initial-viewport':
      return hasOnlyKeys(value, ['kind', 'target']) && isNonEmptyString(value.target);
    case 'relationship-unchanged':
      return (
        hasOnlyKeys(value, ['kind', 'relationshipKind', 'subjectTarget', 'relatedTarget']) &&
        typeof value.relationshipKind === 'string' &&
        ALL_RELATIONSHIP_KINDS.includes(value.relationshipKind) &&
        (value.subjectTarget === undefined || typeof value.subjectTarget === 'string') &&
        (value.relatedTarget === undefined || typeof value.relatedTarget === 'string')
      );
    case 'property-unchanged-within-tolerance':
      return (
        hasOnlyKeys(value, ['kind', 'target', 'property', 'tolerance']) &&
        isNonEmptyString(value.target) &&
        typeof value.property === 'string' &&
        (DEPENDENCY_PROPERTIES as readonly string[]).includes(value.property) &&
        isValidContractTolerance(value.tolerance)
      );
    case 'property-increases':
    case 'property-decreases':
      return (
        hasOnlyKeys(value, ['kind', 'target', 'property', 'minimumDeltaPx']) &&
        isNonEmptyString(value.target) &&
        typeof value.property === 'string' &&
        (DEPENDENCY_PROPERTIES as readonly string[]).includes(value.property) &&
        isOptionalNonNegativeFiniteNumber(value.minimumDeltaPx)
      );
    default:
      return false;
  }
}

// --- Clauses -------------------------------------------------------------------

export interface FrontendContractClauseBase {
  clauseId: string;
  primitive: ContractPrimitive;
  supportingEvidence: EvidenceReference[];
}

export type BaselineClause = FrontendContractClauseBase;

export function isValidBaselineClause(value: unknown): value is BaselineClause {
  if (!isPlainObject(value)) return false;
  return isNonEmptyString(value.clauseId) && isValidContractPrimitive(value.primitive) && isEvidenceReferenceArray(value.supportingEvidence);
}

export interface PerChangeClause extends FrontendContractClauseBase {
  category: AuthoredChangeScopeCategory;
  expectedDependentMode?: ExpectedDependentMode;
  /** Explicit supersession of baseline clause identities - never inferred from same-target/same-property overlap. Non-empty when present. */
  supersedesBaselineClauseIds?: string[];
}

export function isValidPerChangeClause(value: unknown): value is PerChangeClause {
  if (!isPlainObject(value)) return false;
  if (!isValidBaselineClause(value)) return false;
  const record = value;
  if (!isAuthoredChangeScopeCategory(record.category)) return false;
  const hasMode = 'expectedDependentMode' in record && record.expectedDependentMode !== undefined;
  if (record.category === 'expected-dependent') {
    if (!hasMode || !isValidExpectedDependentMode(record.expectedDependentMode)) return false;
  } else if (hasMode) {
    return false;
  }
  if ('supersedesBaselineClauseIds' in record && record.supersedesBaselineClauseIds !== undefined) {
    const ids = record.supersedesBaselineClauseIds;
    if (!Array.isArray(ids) || ids.length === 0) return false;
    if (!ids.every((id: unknown) => isNonEmptyString(id))) return false;
  }
  return true;
}

// --- Source observation reference ----------------------------------------------

/** Enough logical identity to trace a contract back to its authoritative source observation without embedding the full ObservationArtifact. */
export interface FrontendContractObservationReference {
  observationId: string;
  requestId: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  observationSchemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
}

export function isValidFrontendContractObservationReference(value: unknown): value is FrontendContractObservationReference {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.observationId) || !isNonEmptyString(value.requestId)) return false;
  if (!isPlainObject(value.producer) || value.producer.name !== PRODUCER_NAME || !isNonEmptyString(value.producer.version)) return false;
  return value.observationSchemaVersion === OBSERVATION_SCHEMA_VERSION;
}

// --- Persistent baseline contract -----------------------------------------------

export interface PersistentBaselineContract {
  artifactKind: typeof CONTRACT_ARTIFACT_KIND;
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  contractClass: 'baseline';
  baselineId: string;
  /** Explicit, append-based supersession - never rewrites/removes the prior baseline value. */
  supersedesBaselineId?: string;
  sourceObservation: FrontendContractObservationReference;
  clauses: BaselineClause[];
  provenance: { approvedAt: string };
}

export type FrontendContractValidationResult = { valid: true } | { valid: false; reason: string };

export function isValidPersistentBaselineContract(value: unknown): FrontendContractValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'contract must be an object' };
  if (value.artifactKind !== CONTRACT_ARTIFACT_KIND) return { valid: false, reason: 'artifactKind mismatch' };
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION) return { valid: false, reason: 'schemaVersion mismatch' };
  if (value.contractClass !== 'baseline') return { valid: false, reason: 'contractClass must be "baseline"' };
  if (!isNonEmptyString(value.baselineId)) return { valid: false, reason: 'baselineId must be a non-empty string' };
  if ('supersedesBaselineId' in value && value.supersedesBaselineId !== undefined && !isNonEmptyString(value.supersedesBaselineId)) {
    return { valid: false, reason: 'supersedesBaselineId must be a non-empty string when present' };
  }
  if (!isValidFrontendContractObservationReference(value.sourceObservation)) return { valid: false, reason: 'sourceObservation is invalid' };
  if (!Array.isArray(value.clauses) || !value.clauses.every((c: unknown) => isValidBaselineClause(c))) {
    return { valid: false, reason: 'clauses must be an array of valid BaselineClause values' };
  }
  if (!isPlainObject(value.provenance) || !isNonEmptyString(value.provenance.approvedAt)) {
    return { valid: false, reason: 'provenance.approvedAt must be a non-empty string' };
  }
  return { valid: true };
}

// --- Per-change contract ---------------------------------------------------------

export interface PerChangeContract {
  artifactKind: typeof CONTRACT_ARTIFACT_KIND;
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  contractClass: 'change';
  contractId: string;
  contractRequestId: string;
  activeBaselineIds: string[];
  clauses: PerChangeClause[];
}

export function isValidPerChangeContract(value: unknown): FrontendContractValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'contract must be an object' };
  if (value.artifactKind !== CONTRACT_ARTIFACT_KIND) return { valid: false, reason: 'artifactKind mismatch' };
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION) return { valid: false, reason: 'schemaVersion mismatch' };
  if (value.contractClass !== 'change') return { valid: false, reason: 'contractClass must be "change"' };
  if (!isNonEmptyString(value.contractId)) return { valid: false, reason: 'contractId must be a non-empty string' };
  if (!isNonEmptyString(value.contractRequestId)) return { valid: false, reason: 'contractRequestId must be a non-empty string' };
  if (!Array.isArray(value.activeBaselineIds) || !value.activeBaselineIds.every((id: unknown) => isNonEmptyString(id))) {
    return { valid: false, reason: 'activeBaselineIds must be an array of non-empty strings' };
  }
  if (!Array.isArray(value.clauses) || !value.clauses.every((c: unknown) => isValidPerChangeClause(c))) {
    return { valid: false, reason: 'clauses must be an array of valid PerChangeClause values' };
  }
  return { valid: true };
}

// --- Per-clause evaluation result vocabulary (frozen vocabulary only; no producer in this batch) --

export const CLAUSE_RESULT_STATUSES = ['pass', 'fail', 'unavailable', 'conflict'] as const;
export type ClauseResultStatus = (typeof CLAUSE_RESULT_STATUSES)[number];

export type ClauseEvaluationResult =
  | { clauseId: string; status: 'pass' | 'fail'; supportingEvidence: EvidenceReference[] }
  | { clauseId: string; status: 'unavailable'; reason: string; supportingEvidence: EvidenceReference[] }
  | { clauseId: string; status: 'conflict'; conflictingClauseIds: string[]; reason: string; supportingEvidence: EvidenceReference[] };

/** Honest per-clause result vocabulary: `'unavailable'` requires a non-empty reason (never fabricated pass/fail); `'conflict'` requires at least 2 conflicting clause ids. */
export function isValidClauseEvaluationResult(value: unknown): value is ClauseEvaluationResult {
  if (!isPlainObject(value) || !isNonEmptyString(value.clauseId)) return false;
  if (!isEvidenceReferenceArray(value.supportingEvidence)) return false;
  switch (value.status) {
    case 'pass':
    case 'fail':
      return !('reason' in value) && !('conflictingClauseIds' in value);
    case 'unavailable':
      return isNonEmptyString(value.reason) && !('conflictingClauseIds' in value);
    case 'conflict':
      return (
        isNonEmptyString(value.reason) &&
        Array.isArray(value.conflictingClauseIds) &&
        value.conflictingClauseIds.length >= 2 &&
        value.conflictingClauseIds.every((id: unknown) => isNonEmptyString(id))
      );
    default:
      return false;
  }
}

// --- Overall verdict vocabulary (type only; no producer in this batch) -----------

export const OVERALL_VERDICTS = ['PASS', 'FAIL'] as const;
export type OverallVerdict = (typeof OVERALL_VERDICTS)[number];
