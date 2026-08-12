/**
 * v0.4 Batch 1 comparison contract. Frozen here as pure
 * types/constants/structural validators only - comparison is downstream of
 * observation (real Chromium -> ObservationArtifact -> relationship
 * derivation -> comparability analysis -> comparison -> ComparisonArtifact,
 * see docs/ARCHITECTURE.md) and this batch implements neither relationship
 * derivation, real comparison, nor persistence. Batch 2 owns relationship
 * derivation; Batch 3 owns `compareObservations()` and comparison
 * persistence; Batch 4 owns CLI exposure.
 *
 * Comparison and observation are different evidence products: this module
 * never reuses `ARTIFACT_KIND`/`SCHEMA_VERSION` from `./schema.js`, and
 * `isValidComparisonArtifact` never delegates to `isValidObservationArtifact`.
 */
import { PRODUCER_NAME, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION } from './schema.js';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITY } from './diagnostics.js';
import type { Diagnostic, DiagnosticCode } from './diagnostics.js';
import type {
  EvidenceReference,
  LayoutRelationshipGraph,
  PageLevelRelationshipKind,
  PairwiseRelationshipKind,
} from './relationships.js';
import { PAGE_LEVEL_RELATIONSHIP_KINDS, PAIRWISE_RELATIONSHIP_KINDS, isValidEvidenceReference, isValidLayoutRelationshipGraph } from './relationships.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEvidenceReferenceArray(value: unknown): value is EvidenceReference[] {
  return Array.isArray(value) && value.every((entry) => isValidEvidenceReference(entry));
}

export const COMPARISON_ARTIFACT_KIND = 'my-frontend-observer/comparison' as const;
export const COMPARISON_SCHEMA_VERSION = '1.0.0' as const;

// --- Geometry tolerance -----------------------------------------------------

/** Suppresses insignificant geometry noise only - never a design contract, never permission for changes. */
export const GEOMETRY_TOLERANCE_DEFAULT_PX = 0.5;
export const GEOMETRY_TOLERANCE_MIN_PX = 0;
export const GEOMETRY_TOLERANCE_MAX_PX = 10;

export function isValidGeometryTolerancePx(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= GEOMETRY_TOLERANCE_MIN_PX && value <= GEOMETRY_TOLERANCE_MAX_PX;
}

// --- Expected dependency declarations (explicit, non-causal) ---------------

export const DEPENDENCY_PROPERTIES = ['x', 'y', 'width', 'height'] as const;
export type DependencyProperty = (typeof DEPENDENCY_PROPERTIES)[number];

export const DEPENDENCY_DIRECTIONS = ['increase', 'decrease', 'change', 'unchanged'] as const;
export type DependencyDirection = (typeof DEPENDENCY_DIRECTIONS)[number];

/** The observer never generates a dependency declaration from co-change; every declaration must explicitly identify that it was supplied externally. */
export const EXPECTED_DEPENDENCY_SOURCES = ['explicit-config'] as const;
export type ExpectedDependencySource = (typeof EXPECTED_DEPENDENCY_SOURCES)[number];

const DEPENDENCY_TARGET_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface DependencyTermDeclaration {
  target: string;
  property: DependencyProperty;
  direction: DependencyDirection;
}

function isValidDependencyTermDeclaration(value: unknown): value is DependencyTermDeclaration {
  if (!isPlainObject(value)) return false;
  if (typeof value.target !== 'string' || !DEPENDENCY_TARGET_NAME_RE.test(value.target)) return false;
  if (typeof value.property !== 'string' || !(DEPENDENCY_PROPERTIES as readonly string[]).includes(value.property)) return false;
  return typeof value.direction === 'string' && (DEPENDENCY_DIRECTIONS as readonly string[]).includes(value.direction);
}

/** A bounded, explicitly-declared expected layout dependency (e.g. "navigation.width decreases -> workspace.width increases") - never inferred from co-change. */
export interface ExpectedDependencyDeclaration {
  cause: DependencyTermDeclaration;
  effect: DependencyTermDeclaration;
  source: ExpectedDependencySource;
}

export function isValidExpectedDependencyDeclaration(value: unknown): value is ExpectedDependencyDeclaration {
  if (!isPlainObject(value)) return false;
  if (!isValidDependencyTermDeclaration(value.cause) || !isValidDependencyTermDeclaration(value.effect)) return false;
  return typeof value.source === 'string' && (EXPECTED_DEPENDENCY_SOURCES as readonly string[]).includes(value.source);
}

/**
 * Non-causal evaluation outcomes only - describes the relationship between a
 * declared expectation and observed differences, never an implementation
 * verdict (no PASS/FAIL/approved/regression/allowed/protected vocabulary).
 */
export const DEPENDENCY_EVIDENCE_OUTCOMES = ['consistent', 'not-observed', 'contradictory-to-declaration', 'unavailable'] as const;
export type DependencyEvidenceOutcome = (typeof DEPENDENCY_EVIDENCE_OUTCOMES)[number];

export interface ExpectedDependencyEvidence {
  declaration: ExpectedDependencyDeclaration;
  outcome: DependencyEvidenceOutcome;
  supportingEvidence: EvidenceReference[];
}

export function isValidExpectedDependencyEvidence(value: unknown): value is ExpectedDependencyEvidence {
  if (!isPlainObject(value)) return false;
  if (!isValidExpectedDependencyDeclaration(value.declaration)) return false;
  if (typeof value.outcome !== 'string' || !(DEPENDENCY_EVIDENCE_OUTCOMES as readonly string[]).includes(value.outcome)) return false;
  return isEvidenceReferenceArray(value.supportingEvidence);
}

// --- Comparison configuration -----------------------------------------------

/** Deliberately excludes any v0.5+ contract/change-scope field (requestedChanges, protected, preserved, allowedChanges, passThreshold, failThreshold, baseline, approval). */
export interface ComparisonConfig {
  geometryTolerancePx: number;
  expectedDependencies?: ExpectedDependencyDeclaration[];
}

const COMPARISON_CONFIG_KEYS = ['geometryTolerancePx', 'expectedDependencies'];

export function isValidComparisonConfig(value: unknown): value is ComparisonConfig {
  if (!isPlainObject(value)) return false;
  if (!Object.keys(value).every((key) => COMPARISON_CONFIG_KEYS.includes(key))) return false;
  if (!isValidGeometryTolerancePx(value.geometryTolerancePx)) return false;
  if ('expectedDependencies' in value && value.expectedDependencies !== undefined) {
    if (!Array.isArray(value.expectedDependencies) || !value.expectedDependencies.every((d: unknown) => isValidExpectedDependencyDeclaration(d))) {
      return false;
    }
  }
  return true;
}

// --- Comparability -----------------------------------------------------------

export const COMPARABILITY_STATES = ['comparable', 'comparable-with-warnings', 'incomparable'] as const;
export type ComparabilityState = (typeof COMPARABILITY_STATES)[number];

/**
 * Hard-incompatibility reason codes are `blocking` (force `incomparable`
 * unless the repository can prove a dimension cannot be evaluated
 * reliably); warning-only differences are `warning` (do not by themselves
 * prevent useful page-level comparison); dimensions the observer does not
 * yet model (theme/authenticated-state/application-state identity) are
 * `unassessed` and never claimed identical without evidence.
 */
export const COMPARABILITY_REASON_CODES = [
  'artifact-kind-mismatch',
  'schema-version-mismatch',
  'page-url-mismatch',
  'viewport-mismatch',
  'scroll-scenario-mismatch',
  'browser-engine-mismatch',
  'producer-version-mismatch',
  'browser-version-mismatch',
  'target-set-mismatch',
  'target-locator-mismatch',
  'theme-unassessed',
  'authenticated-state-unassessed',
  'application-state-unassessed',
] as const;
export type ComparabilityReasonCode = (typeof COMPARABILITY_REASON_CODES)[number];

export type ComparabilityReasonSeverity = 'blocking' | 'warning' | 'unassessed';

export const COMPARABILITY_REASON_SEVERITY: Record<ComparabilityReasonCode, ComparabilityReasonSeverity> = {
  'artifact-kind-mismatch': 'blocking',
  'schema-version-mismatch': 'blocking',
  'page-url-mismatch': 'blocking',
  'viewport-mismatch': 'blocking',
  'scroll-scenario-mismatch': 'blocking',
  'browser-engine-mismatch': 'blocking',
  'producer-version-mismatch': 'warning',
  'browser-version-mismatch': 'warning',
  'target-set-mismatch': 'warning',
  'target-locator-mismatch': 'warning',
  'theme-unassessed': 'unassessed',
  'authenticated-state-unassessed': 'unassessed',
  'application-state-unassessed': 'unassessed',
};

export interface ComparabilityReason {
  code: ComparabilityReasonCode;
  severity: ComparabilityReasonSeverity;
  message: string;
}

function isValidComparabilityReason(value: unknown): value is ComparabilityReason {
  if (!isPlainObject(value)) return false;
  const code = value.code;
  if (typeof code !== 'string' || !(COMPARABILITY_REASON_CODES as readonly string[]).includes(code)) return false;
  if (value.severity !== COMPARABILITY_REASON_SEVERITY[code as ComparabilityReasonCode]) return false;
  return typeof value.message === 'string';
}

export interface ComparabilityResult {
  state: ComparabilityState;
  reasons: ComparabilityReason[];
}

/** `incomparable` requires at least one `blocking` reason; a `blocking` reason forces `incomparable` - the two invariants are enforced together. */
export function isValidComparabilityResult(value: unknown): value is ComparabilityResult {
  if (!isPlainObject(value)) return false;
  if (typeof value.state !== 'string' || !(COMPARABILITY_STATES as readonly string[]).includes(value.state)) return false;
  if (!Array.isArray(value.reasons) || !value.reasons.every((r: unknown) => isValidComparabilityReason(r))) return false;
  const reasons = value.reasons as ComparabilityReason[];
  const hasBlocking = reasons.some((r) => r.severity === 'blocking');
  if (value.state === 'incomparable' && !hasBlocking) return false;
  if (value.state !== 'incomparable' && hasBlocking) return false;
  return true;
}

// --- Target-configuration change (never conflated with appeared/disappeared) --

export const TARGET_CONFIGURATION_CHANGE_KINDS = ['added', 'removed', 'locator-changed'] as const;
export type TargetConfigurationChangeKind = (typeof TARGET_CONFIGURATION_CHANGE_KINDS)[number];

export interface TargetConfigurationChange {
  kind: TargetConfigurationChangeKind;
  target: string;
}

export function isValidTargetConfigurationChange(value: unknown): value is TargetConfigurationChange {
  if (!isPlainObject(value)) return false;
  if (typeof value.kind !== 'string' || !(TARGET_CONFIGURATION_CHANGE_KINDS as readonly string[]).includes(value.kind)) return false;
  return typeof value.target === 'string' && value.target.length > 0;
}

// --- Difference vocabulary ---------------------------------------------------

export const DIFFERENCE_KINDS = [
  'appeared',
  'disappeared',
  'moved',
  'resized',
  'visibility-changed',
  'clipping-changed',
  'containment-changed',
  'horizontal-overflow-changed',
  'vertical-overflow-changed',
  'page-size-changed',
  'scroll-owner-changed',
  'relative-position-changed',
  'relationship-changed',
] as const;
export type DifferenceKind = (typeof DIFFERENCE_KINDS)[number];

export type ComparisonDifferenceSubject =
  | { type: 'target'; target: string }
  | { type: 'relationship'; kind: PairwiseRelationshipKind | PageLevelRelationshipKind; subjectTarget?: string; relatedTarget?: string }
  | { type: 'page' };

function isValidComparisonDifferenceSubject(value: unknown): value is ComparisonDifferenceSubject {
  if (!isPlainObject(value)) return false;
  if (value.type === 'target') return typeof value.target === 'string' && value.target.length > 0;
  if (value.type === 'page') return Object.keys(value).length === 1;
  if (value.type === 'relationship') {
    const allKinds = [...PAIRWISE_RELATIONSHIP_KINDS, ...PAGE_LEVEL_RELATIONSHIP_KINDS] as readonly string[];
    if (typeof value.kind !== 'string' || !allKinds.includes(value.kind)) return false;
    if ('subjectTarget' in value && value.subjectTarget !== undefined && typeof value.subjectTarget !== 'string') return false;
    if ('relatedTarget' in value && value.relatedTarget !== undefined && typeof value.relatedTarget !== 'string') return false;
    return true;
  }
  return false;
}

/**
 * Bounded structured difference record - never prose-only, never a
 * severity/pass-fail score (there is no severity model yet). `before`/
 * `after`/`delta` are intentionally untyped here: their shape depends on
 * `kind` (e.g. numeric geometry for `moved`/`resized`, boolean for
 * `visibility-changed`) and is validated at the point of construction by
 * whichever batch actually produces these records.
 */
export interface ComparisonDifference {
  kind: DifferenceKind;
  subject: ComparisonDifferenceSubject;
  before: unknown;
  after: unknown;
  delta?: unknown;
  classification: string;
  beforeObservationId: string;
  afterObservationId: string;
  evidence: EvidenceReference[];
}

export function isValidComparisonDifference(value: unknown): value is ComparisonDifference {
  if (!isPlainObject(value)) return false;
  if (typeof value.kind !== 'string' || !(DIFFERENCE_KINDS as readonly string[]).includes(value.kind)) return false;
  if (!isValidComparisonDifferenceSubject(value.subject)) return false;
  if (!('before' in value) || !('after' in value)) return false;
  if (typeof value.classification !== 'string' || value.classification.length === 0) return false;
  if (typeof value.beforeObservationId !== 'string' || value.beforeObservationId.length === 0) return false;
  if (typeof value.afterObservationId !== 'string' || value.afterObservationId.length === 0) return false;
  return isEvidenceReferenceArray(value.evidence);
}

/** One before/after transition of a single derived relationship - distinct from `ComparisonDifference` so the relationship graph's own vocabulary stays authoritative. `'unavailable'` covers a pair/page relationship that could not be evaluated on one side. */
export interface RelationshipChangeRecord {
  scope: 'pairwise' | 'page';
  kind: PairwiseRelationshipKind | PageLevelRelationshipKind;
  subjectTarget?: string;
  relatedTarget?: string;
  before: PairwiseRelationshipKind | PageLevelRelationshipKind | 'unavailable';
  after: PairwiseRelationshipKind | PageLevelRelationshipKind | 'unavailable';
  beforeObservationId: string;
  afterObservationId: string;
}

function isValidRelationshipChangeRecord(value: unknown): value is RelationshipChangeRecord {
  if (!isPlainObject(value)) return false;
  if (value.scope !== 'pairwise' && value.scope !== 'page') return false;
  const allKinds = [...PAIRWISE_RELATIONSHIP_KINDS, ...PAGE_LEVEL_RELATIONSHIP_KINDS] as readonly string[];
  const allValues = [...allKinds, 'unavailable'];
  if (typeof value.kind !== 'string' || !allKinds.includes(value.kind)) return false;
  if (value.scope === 'pairwise') {
    if (typeof value.subjectTarget !== 'string' || value.subjectTarget.length === 0) return false;
    if (typeof value.relatedTarget !== 'string' || value.relatedTarget.length === 0) return false;
  } else if ('subjectTarget' in value || 'relatedTarget' in value) {
    return false;
  }
  if (typeof value.before !== 'string' || !allValues.includes(value.before)) return false;
  if (typeof value.after !== 'string' || !allValues.includes(value.after)) return false;
  if (typeof value.beforeObservationId !== 'string' || value.beforeObservationId.length === 0) return false;
  return typeof value.afterObservationId === 'string' && value.afterObservationId.length > 0;
}

// --- Source observation references ------------------------------------------

/**
 * Enough logical identity to trace a comparison back to its authoritative
 * source observations without embedding the full ObservationArtifact,
 * copying screenshot bytes, or persisting a filesystem path as semantic
 * identity.
 */
export interface ComparisonSourceObservationReference {
  observationId: string;
  requestId: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  observationSchemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  screenshot: { path: string };
}

export function isValidComparisonSourceObservationReference(value: unknown): value is ComparisonSourceObservationReference {
  if (!isPlainObject(value)) return false;
  if (typeof value.observationId !== 'string' || value.observationId.length === 0) return false;
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) return false;
  if (!isPlainObject(value.producer) || value.producer.name !== PRODUCER_NAME || typeof value.producer.version !== 'string' || value.producer.version.length === 0) {
    return false;
  }
  if (value.observationSchemaVersion !== OBSERVATION_SCHEMA_VERSION) return false;
  return isPlainObject(value.screenshot) && typeof value.screenshot.path === 'string' && value.screenshot.path.length > 0;
}

// --- Comparison artifact ------------------------------------------------------

/** Comparison is ordered: `before`/`after` are distinct fields (never a swappable pair) so `compare(A, B) !== compare(B, A)` for both identity and difference direction. */
export interface ComparisonArtifact {
  artifactKind: typeof COMPARISON_ARTIFACT_KIND;
  schemaVersion: typeof COMPARISON_SCHEMA_VERSION;
  comparisonId: string;
  comparisonRequestId: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  provenance: { comparedAt: string };
  before: ComparisonSourceObservationReference;
  after: ComparisonSourceObservationReference;
  config: ComparisonConfig;
  comparability: ComparabilityResult;
  configurationChanges: TargetConfigurationChange[];
  relationshipsBefore: LayoutRelationshipGraph;
  relationshipsAfter: LayoutRelationshipGraph;
  differences: ComparisonDifference[];
  relationshipChanges: RelationshipChangeRecord[];
  expectedDependencyEvidence: ExpectedDependencyEvidence[];
  diagnostics: Diagnostic[];
  limits: { truncated: boolean; omittedFields: string[]; omittedTargetPairs: string[] };
}

function isValidDiagnostic(value: unknown): value is Diagnostic {
  if (!isPlainObject(value)) return false;
  const code = value.code;
  if (typeof code !== 'string' || !(DIAGNOSTIC_CODES as readonly string[]).includes(code)) return false;
  if (value.severity !== DIAGNOSTIC_SEVERITY[code as DiagnosticCode]) return false;
  if (typeof value.message !== 'string') return false;
  if ('targetName' in value && value.targetName !== undefined && typeof value.targetName !== 'string') return false;
  return true;
}

export type ComparisonSchemaValidationResult = { valid: true } | { valid: false; reason: string };

/** Structural validator for the frozen ComparisonArtifact contract. Never delegates to `isValidObservationArtifact` - comparison and observation are different artifact kinds/schemas. */
export function isValidComparisonArtifact(value: unknown): ComparisonSchemaValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'artifact must be an object' };
  if (value.artifactKind !== COMPARISON_ARTIFACT_KIND) return { valid: false, reason: 'artifactKind mismatch' };
  if (value.schemaVersion !== COMPARISON_SCHEMA_VERSION) return { valid: false, reason: 'schemaVersion mismatch' };
  if (typeof value.comparisonId !== 'string' || value.comparisonId.length === 0) return { valid: false, reason: 'comparisonId must be a non-empty string' };
  if (typeof value.comparisonRequestId !== 'string' || value.comparisonRequestId.length === 0) {
    return { valid: false, reason: 'comparisonRequestId must be a non-empty string' };
  }
  if (!isPlainObject(value.producer) || value.producer.name !== PRODUCER_NAME || typeof value.producer.version !== 'string' || value.producer.version.length === 0) {
    return { valid: false, reason: 'producer must be { name: "my-frontend-observer", version: string }' };
  }
  if (!isPlainObject(value.provenance) || typeof value.provenance.comparedAt !== 'string' || value.provenance.comparedAt.length === 0) {
    return { valid: false, reason: 'provenance.comparedAt must be a non-empty string' };
  }
  if (!isValidComparisonSourceObservationReference(value.before)) return { valid: false, reason: 'before source observation reference is invalid' };
  if (!isValidComparisonSourceObservationReference(value.after)) return { valid: false, reason: 'after source observation reference is invalid' };
  if (!isValidComparisonConfig(value.config)) return { valid: false, reason: 'config is invalid' };
  if (!isValidComparabilityResult(value.comparability)) return { valid: false, reason: 'comparability is invalid' };
  if (!Array.isArray(value.configurationChanges) || !value.configurationChanges.every((c: unknown) => isValidTargetConfigurationChange(c))) {
    return { valid: false, reason: 'configurationChanges must be an array of valid TargetConfigurationChange values' };
  }
  if (!isValidLayoutRelationshipGraph(value.relationshipsBefore)) return { valid: false, reason: 'relationshipsBefore is invalid' };
  if (!isValidLayoutRelationshipGraph(value.relationshipsAfter)) return { valid: false, reason: 'relationshipsAfter is invalid' };
  if (!Array.isArray(value.differences) || !value.differences.every((d: unknown) => isValidComparisonDifference(d))) {
    return { valid: false, reason: 'differences must be an array of valid ComparisonDifference values' };
  }
  if (!Array.isArray(value.relationshipChanges) || !value.relationshipChanges.every((r: unknown) => isValidRelationshipChangeRecord(r))) {
    return { valid: false, reason: 'relationshipChanges must be an array of valid RelationshipChangeRecord values' };
  }
  if (!Array.isArray(value.expectedDependencyEvidence) || !value.expectedDependencyEvidence.every((e: unknown) => isValidExpectedDependencyEvidence(e))) {
    return { valid: false, reason: 'expectedDependencyEvidence must be an array of valid ExpectedDependencyEvidence values' };
  }
  if (!Array.isArray(value.diagnostics) || !value.diagnostics.every((d: unknown) => isValidDiagnostic(d))) {
    return { valid: false, reason: 'diagnostics must be an array of valid Diagnostic values' };
  }
  const limits = value.limits;
  if (
    !isPlainObject(limits) ||
    typeof limits.truncated !== 'boolean' ||
    !Array.isArray(limits.omittedFields) ||
    !limits.omittedFields.every((f: unknown) => typeof f === 'string') ||
    !Array.isArray(limits.omittedTargetPairs) ||
    !limits.omittedTargetPairs.every((f: unknown) => typeof f === 'string')
  ) {
    return { valid: false, reason: 'limits must be { truncated: boolean; omittedFields: string[]; omittedTargetPairs: string[] }' };
  }
  return { valid: true };
}
