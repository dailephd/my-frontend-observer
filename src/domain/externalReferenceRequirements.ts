/**
 * v0.7 Prompt 3 selected design requirements, tolerance semantics, and
 * reference-evidence adequacy. Builds only on Prompt 2's `ReferenceRegion`/
 * `ReferenceRegionGeometry`/relationship-derivation - it does not implement
 * runtime-target binding, candidate comparison, or fidelity PASS/FAIL (those
 * remain later v0.7 prompts).
 *
 * Central distinction (see docs/CONTRACTS.md "v0.7 Prompt 3"): a reference
 * region's geometry is REFERENCE EVIDENCE - everything visibly/measurably
 * present in the supplied image. A requirement is SELECTED DESIGN INTENT -
 * only what the user/configuration explicitly authored as mattering for
 * later candidate evaluation. This module never infers a requirement merely
 * because a property or relationship exists.
 *
 * Requirement categories are the exact v0.5 `AuthoredChangeScopeCategory`
 * vocabulary (`requested`/`expected-dependent`/`protected`/`preserved`),
 * imported directly rather than reinvented as a "reference-only" taxonomy -
 * that type carries no runtime-only coupling in its own definition. As in
 * v0.5, `'unexpected'` remains impossible to author here: it is not a member
 * of `AuthoredChangeScopeCategory` at all.
 */
import { AUTHORED_CHANGE_SCOPE_CATEGORIES, isAuthoredChangeScopeCategory, EXPECTED_DEPENDENT_MODES, isValidExpectedDependentMode } from './frontendContracts.js';
import type { AuthoredChangeScopeCategory, ExpectedDependentMode } from './frontendContracts.js';
import type { PairwiseRelationshipKind } from './relationships.js';
import {
  PAIRWISE_RELATIONSHIP_KINDS,
  HORIZONTAL_ORDER_RELATIONSHIPS,
  VERTICAL_ORDER_RELATIONSHIPS,
  AREA_OVERLAP_RELATIONSHIPS,
  RELATIVE_WIDTH_RELATIONSHIPS,
  GEOMETRIC_FIT_RELATIONSHIPS,
  VERTICAL_SEQUENCE_RELATIONSHIPS,
} from './relationships.js';
import type { ReferenceRegion, ReferenceRegionGeometry } from './externalReferenceRegions.js';
import { deriveReferenceRegionGeometry } from './externalReferenceRegions.js';
import { deriveReferenceRegionRelationships } from './externalReferenceRegionRelationships.js';
import { buildReferenceRequirementIdentity } from './externalReferenceRequirementIdentity.js';

export { AUTHORED_CHANGE_SCOPE_CATEGORIES, isAuthoredChangeScopeCategory, EXPECTED_DEPENDENT_MODES, isValidExpectedDependentMode };
export type { AuthoredChangeScopeCategory, ExpectedDependentMode };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export const MAX_REFERENCE_REQUIREMENTS = 50;

// --- bounded property/measurement/relationship vocabulary ------------------------

/** Exactly the fields of ReferenceRegionGeometry - the smallest coherent vocabulary already available from Prompt 2, nothing invented (no separate "left"/"top" aliases - x/y already are the left/top edges of the canonical rectangle). */
export const REFERENCE_REQUIREMENT_REGION_PROPERTIES = ['x', 'y', 'width', 'height', 'right', 'bottom', 'centerX', 'centerY'] as const;
export type ReferenceRequirementRegionProperty = (typeof REFERENCE_REQUIREMENT_REGION_PROPERTIES)[number];

export function isReferenceRequirementRegionProperty(value: unknown): value is ReferenceRequirementRegionProperty {
  return typeof value === 'string' && (REFERENCE_REQUIREMENT_REGION_PROPERTIES as readonly string[]).includes(value);
}

/** Smallest useful set of pure two-region derived measurements (request section 18) - not an unrestricted geometry expression language. */
export const REFERENCE_REQUIREMENT_MEASUREMENTS = ['vertical-gap', 'horizontal-gap', 'center-x-delta', 'center-y-delta', 'left-edge-delta', 'right-edge-delta'] as const;
export type ReferenceRequirementMeasurement = (typeof REFERENCE_REQUIREMENT_MEASUREMENTS)[number];

export function isReferenceRequirementMeasurement(value: unknown): value is ReferenceRequirementMeasurement {
  return typeof value === 'string' && (REFERENCE_REQUIREMENT_MEASUREMENTS as readonly string[]).includes(value);
}

/**
 * Pure derived two-region measurements. `vertical-gap`/`horizontal-gap`
 * return `undefined` when the two regions overlap on that axis (the gap is
 * geometrically undefined, never fabricated as 0 or negative) - direction is
 * decided by actual geometry, mirroring relationships.ts's
 * verticalSequenceOf/horizontalOrderOf convention. The delta measurements
 * are always defined (a plain numeric distance, never negative).
 */
export function deriveReferenceRequirementMeasurement(kind: ReferenceRequirementMeasurement, a: ReferenceRegionGeometry, b: ReferenceRegionGeometry): number | undefined {
  switch (kind) {
    case 'vertical-gap':
      if (a.bottom <= b.y) return b.y - a.bottom;
      if (b.bottom <= a.y) return a.y - b.bottom;
      return undefined;
    case 'horizontal-gap':
      if (a.right <= b.x) return b.x - a.right;
      if (b.right <= a.x) return a.x - b.right;
      return undefined;
    case 'center-x-delta':
      return Math.abs(a.centerX - b.centerX);
    case 'center-y-delta':
      return Math.abs(a.centerY - b.centerY);
    case 'left-edge-delta':
      return Math.abs(a.x - b.x);
    case 'right-edge-delta':
      return Math.abs(a.right - b.right);
  }
}

// --- tolerance (independently owned - never mislabeled as CSS/runtime pixels) ----

/**
 * Deliberately not a reuse of domain/frontendContracts.ts#ContractTolerance:
 * that type's `'absolute-px'` member is implicitly runtime/CSS pixels
 * (compared against `TargetGeometry` from a live ObservationArtifact).
 * Reference-image pixels are a different, explicitly-labeled unit (see
 * externalReferenceRegions.ts's coordinate-semantics doc comment) - Prompt 6
 * will eventually need an explicit scale/compatibility mapping between the
 * two; nothing here assumes 1 reference pixel = 1 CSS pixel. Numeric bounds
 * intentionally mirror CONTRACT_TOLERANCE_ABSOLUTE_PX_MIN/MAX and
 * CONTRACT_TOLERANCE_PERCENT_MIN/MAX (same values, independently owned
 * constants) rather than importing them, for the same unit-labeling reason.
 */
export const REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MIN = 0;
export const REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MAX = 100;
export const REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MIN = 0;
export const REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MAX = 100;

export type ReferenceRequirementTolerance = { kind: 'exact' } | { kind: 'absolute-reference-px'; amount: number } | { kind: 'percent'; amount: number };

export function isValidReferenceRequirementTolerance(value: unknown): value is ReferenceRequirementTolerance {
  if (!isPlainObject(value)) return false;
  if (value.kind === 'exact') return Object.keys(value).length === 1;
  if (value.kind === 'absolute-reference-px') {
    return (
      Object.keys(value).length === 2 &&
      typeof value.amount === 'number' &&
      Number.isFinite(value.amount) &&
      value.amount >= REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MIN &&
      value.amount <= REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MAX
    );
  }
  if (value.kind === 'percent') {
    return (
      Object.keys(value).length === 2 &&
      typeof value.amount === 'number' &&
      Number.isFinite(value.amount) &&
      value.amount >= REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MIN &&
      value.amount <= REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MAX
    );
  }
  return false;
}

// --- requirement subject (authored - refers only to existing reference evidence) --

export interface RegionPropertyRequirementSubject {
  kind: 'region-property';
  region: string;
  property: ReferenceRequirementRegionProperty;
}

export interface RegionRelationshipRequirementSubject {
  kind: 'region-relationship';
  subjectRegion: string;
  relatedRegion: string;
  relationship: PairwiseRelationshipKind;
}

export interface RegionMeasurementRequirementSubject {
  kind: 'region-measurement';
  subjectRegion: string;
  relatedRegion: string;
  measurement: ReferenceRequirementMeasurement;
}

export type ReferenceRequirementSubject = RegionPropertyRequirementSubject | RegionRelationshipRequirementSubject | RegionMeasurementRequirementSubject;

function isValidRegionPropertySubjectShape(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.region) && isReferenceRequirementRegionProperty(value.property) && Object.keys(value).length === 3;
}

function isValidRegionRelationshipSubjectShape(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.subjectRegion) &&
    isNonEmptyString(value.relatedRegion) &&
    value.subjectRegion !== value.relatedRegion &&
    typeof value.relationship === 'string' &&
    (PAIRWISE_RELATIONSHIP_KINDS as readonly string[]).includes(value.relationship) &&
    Object.keys(value).length === 4
  );
}

function isValidRegionMeasurementSubjectShape(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.subjectRegion) &&
    isNonEmptyString(value.relatedRegion) &&
    value.subjectRegion !== value.relatedRegion &&
    isReferenceRequirementMeasurement(value.measurement) &&
    Object.keys(value).length === 4
  );
}

export function isValidReferenceRequirementSubjectShape(value: unknown): value is ReferenceRequirementSubject {
  if (!isPlainObject(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'region-property':
      return isValidRegionPropertySubjectShape(value);
    case 'region-relationship':
      return isValidRegionRelationshipSubjectShape(value);
    case 'region-measurement':
      return isValidRegionMeasurementSubjectShape(value);
    default:
      return false;
  }
}

/** Mirrors frontendContractEvaluation.ts's RELATIONSHIP_FAMILY_GROUPS shape (independently owned here - no page-level family exists for a static reference image). */
const RELATIONSHIP_FAMILY_GROUPS: readonly (readonly PairwiseRelationshipKind[])[] = [
  HORIZONTAL_ORDER_RELATIONSHIPS,
  VERTICAL_ORDER_RELATIONSHIPS,
  AREA_OVERLAP_RELATIONSHIPS,
  RELATIVE_WIDTH_RELATIONSHIPS,
  GEOMETRIC_FIT_RELATIONSHIPS,
  VERTICAL_SEQUENCE_RELATIONSHIPS,
];

function subjectRegionIds(subject: ReferenceRequirementSubject): string[] {
  if (subject.kind === 'region-property') return [subject.region];
  return [subject.subjectRegion, subject.relatedRegion];
}

/** Structural equality for the duplicate-subject rule below - deliberately not identity-based (two subjects are "the same" whenever their content matches, regardless of authoring position). */
function sameSubject(a: ReferenceRequirementSubject, b: ReferenceRequirementSubject): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'region-property' && b.kind === 'region-property') return a.region === b.region && a.property === b.property;
  if (a.kind === 'region-relationship' && b.kind === 'region-relationship') {
    return a.relationship === b.relationship && ((a.subjectRegion === b.subjectRegion && a.relatedRegion === b.relatedRegion) || (a.subjectRegion === b.relatedRegion && a.relatedRegion === b.subjectRegion));
  }
  if (a.kind === 'region-measurement' && b.kind === 'region-measurement') {
    return a.measurement === b.measurement && ((a.subjectRegion === b.subjectRegion && a.relatedRegion === b.relatedRegion) || (a.subjectRegion === b.relatedRegion && a.relatedRegion === b.subjectRegion));
  }
  return false;
}

// --- external reference requirement (authored) ------------------------------------

export interface ExternalReferenceRequirement {
  /** Deterministic identity from {subject, category, expectedDependentMode, tolerance} only - see externalReferenceRequirementIdentity.ts. Never a timestamp or config path. */
  requirementId: string;
  category: AuthoredChangeScopeCategory;
  expectedDependentMode?: ExpectedDependentMode;
  subject: ReferenceRequirementSubject;
  /** Required for region-property/region-measurement subjects (a numeric comparison needs a tolerance); must be absent for region-relationship subjects (a categorical fact - see docs/CONTRACTS.md). */
  tolerance?: ReferenceRequirementTolerance;
}

export type ReferenceRequirementValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Raw authored input shape: exactly what a user/config supplies via
 * `--requirements-file` - {category, expectedDependentMode?, subject,
 * tolerance?}, deliberately with no `requirementId` field. Identity is
 * always system-computed from this exact content (see
 * buildReferenceRequirement below), never author-supplied - unlike v0.5's
 * BaselineClause/PerChangeClause, which need an author-visible `clauseId` so
 * separate documents can cross-reference it via `supersedesBaselineClauseIds`;
 * Prompt 3 requirements have no cross-document reference need yet, so
 * requiring (and trusting) an authored id would only invite drift between a
 * user-typed id and the content it is supposed to identify.
 */
export interface RawReferenceRequirement {
  category: AuthoredChangeScopeCategory;
  expectedDependentMode?: ExpectedDependentMode;
  subject: ReferenceRequirementSubject;
  tolerance?: ReferenceRequirementTolerance;
}

function validateAuthoredRequirementFields(value: Record<string, unknown>): ReferenceRequirementValidationResult {
  if (!isAuthoredChangeScopeCategory(value.category)) return { valid: false, reason: `requirement.category must be one of ${AUTHORED_CHANGE_SCOPE_CATEGORIES.join(', ')}` };

  const hasMode = 'expectedDependentMode' in value && value.expectedDependentMode !== undefined;
  if (value.category === 'expected-dependent') {
    if (!hasMode || !isValidExpectedDependentMode(value.expectedDependentMode)) {
      return { valid: false, reason: 'requirement.expectedDependentMode is required and must be "required" or "permitted" when category is "expected-dependent"' };
    }
  } else if (hasMode) {
    return { valid: false, reason: 'requirement.expectedDependentMode must be absent unless category is "expected-dependent"' };
  }

  if (!isValidReferenceRequirementSubjectShape(value.subject)) return { valid: false, reason: 'requirement.subject is invalid' };
  const subject = value.subject as ReferenceRequirementSubject;

  const hasTolerance = 'tolerance' in value && value.tolerance !== undefined;
  if (subject.kind === 'region-relationship') {
    if (hasTolerance) return { valid: false, reason: 'requirement.tolerance must be absent for a "region-relationship" subject (a categorical fact, not a numeric comparison)' };
  } else {
    if (!hasTolerance || !isValidReferenceRequirementTolerance(value.tolerance)) {
      return { valid: false, reason: 'requirement.tolerance is required and must be valid for a "region-property"/"region-measurement" subject' };
    }
  }

  return { valid: true };
}

/** Validates one raw, not-yet-identified authored requirement - the shape accepted from `--requirements-file`. */
export function isValidRawReferenceRequirement(value: unknown): ReferenceRequirementValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'requirement must be an object' };
  if ('requirementId' in value && value.requirementId !== undefined) return { valid: false, reason: 'requirement.requirementId must not be authored - it is always computed from content' };
  return validateAuthoredRequirementFields(value);
}

/** Computes the deterministic requirementId and returns a complete ExternalReferenceRequirement. Callers must validate via isValidRawReferenceRequirement first. */
export function buildReferenceRequirement(raw: RawReferenceRequirement): ExternalReferenceRequirement {
  const requirementId = buildReferenceRequirementIdentity(raw.subject, raw.category, raw.tolerance, raw.expectedDependentMode);
  return {
    requirementId,
    category: raw.category,
    ...(raw.expectedDependentMode === undefined ? {} : { expectedDependentMode: raw.expectedDependentMode }),
    subject: raw.subject,
    ...(raw.tolerance === undefined ? {} : { tolerance: raw.tolerance }),
  };
}

/** Validates one already-identified, fully-constructed requirement's own shape (category/mode/subject/tolerance-applicability, plus requirementId presence) - never region existence, which needs the owning reference's `regions` (see isValidReferenceRequirements). Used to defensively re-validate a persisted/about-to-be-persisted ExternalReferenceRequirement, mirroring how every other artifact family's writer re-validates via the same gate it will later read with. */
export function isValidReferenceRequirementShape(value: unknown): ReferenceRequirementValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'requirement must be an object' };
  if (!isNonEmptyString(value.requirementId)) return { valid: false, reason: 'requirement.requirementId must be a non-empty string' };
  return validateAuthoredRequirementFields(value);
}

/**
 * Collection-level validation: bounded count, every subject's region id(s)
 * must exist among the owning artifact's own already-validated `regions`
 * (an authored requirement pointing at a nonexistent region is a structural
 * validation failure, never merely "unavailable" evidence - see
 * docs/CONTRACTS.md), and no two requirements may share the same structural
 * subject (the chosen conflict-handling rule - see the same doc section for
 * why v0.5's runtime-evidence conflict detector could not be reused here).
 */
export function isValidReferenceRequirements(value: unknown, regions: readonly ReferenceRegion[]): ReferenceRequirementValidationResult {
  if (!Array.isArray(value)) return { valid: false, reason: 'requirements must be an array' };
  if (value.length > MAX_REFERENCE_REQUIREMENTS) return { valid: false, reason: `requirements must contain at most ${MAX_REFERENCE_REQUIREMENTS} entries` };

  const regionIds = new Set(regions.map((r) => r.id.toLowerCase()));
  const seenRequirementIds = new Set<string>();
  const seenSubjects: ReferenceRequirementSubject[] = [];

  for (const entry of value) {
    const shapeValidation = isValidReferenceRequirementShape(entry);
    if (!shapeValidation.valid) return shapeValidation;
    const requirement = entry as ExternalReferenceRequirement;

    if (seenRequirementIds.has(requirement.requirementId)) return { valid: false, reason: `duplicate requirement id "${requirement.requirementId}"` };
    seenRequirementIds.add(requirement.requirementId);

    for (const regionId of subjectRegionIds(requirement.subject)) {
      if (!regionIds.has(regionId.toLowerCase())) return { valid: false, reason: `requirement "${requirement.requirementId}" refers to unknown region id "${regionId}"` };
    }

    if (seenSubjects.some((s) => sameSubject(s, requirement.subject))) {
      return { valid: false, reason: `requirement "${requirement.requirementId}" duplicates the subject of an earlier requirement in this collection` };
    }
    seenSubjects.push(requirement.subject);
  }

  return { valid: true };
}

// --- reference expectation derivation (pure, on demand - never persisted) ---------

export type ReferenceRequirementExpectation =
  | { available: true; kind: 'numeric'; value: number }
  | { available: true; kind: 'relationship'; matches: boolean }
  | { available: false; reason: string };

/**
 * Derives what the reference itself shows for one requirement's subject,
 * purely from the supplied regions - never stored on the requirement or the
 * artifact (avoids the exact drift risk request section 14 warns about: a
 * stored `width: 424` could silently disagree with the region's own
 * rectangle after some future change). `geometryTolerancePx` is passed
 * through to relationship derivation unchanged (Prompt 2's own default
 * applies when omitted).
 */
export function deriveReferenceRequirementExpectation(
  subject: ReferenceRequirementSubject,
  regions: readonly ReferenceRegion[],
  options: { geometryTolerancePx?: number } = {},
): ReferenceRequirementExpectation {
  const byId = new Map(regions.map((r) => [r.id.toLowerCase(), r] as const));

  if (subject.kind === 'region-property') {
    const region = byId.get(subject.region.toLowerCase());
    if (!region) return { available: false, reason: `region "${subject.region}" not found` };
    const geometry = deriveReferenceRegionGeometry(region.rectangle);
    return { available: true, kind: 'numeric', value: geometry[subject.property] };
  }

  const subjectRegion = byId.get(subject.subjectRegion.toLowerCase());
  const relatedRegion = byId.get(subject.relatedRegion.toLowerCase());
  if (!subjectRegion || !relatedRegion) return { available: false, reason: 'one or both referenced regions were not found' };

  if (subject.kind === 'region-measurement') {
    const measurement = deriveReferenceRequirementMeasurement(subject.measurement, deriveReferenceRegionGeometry(subjectRegion.rectangle), deriveReferenceRegionGeometry(relatedRegion.rectangle));
    if (measurement === undefined) return { available: false, reason: `"${subject.measurement}" is geometrically undefined for these two regions (they overlap on the relevant axis)` };
    return { available: true, kind: 'numeric', value: measurement };
  }

  // subject.kind === 'region-relationship'. Every pairwise call site derives up to one record per
  // family (see externalReferenceRegionRelationships.ts) for the SAME (subjectRegion, relatedRegion)
  // pair - so the lookup must be scoped to the requested relationship's own family, never "the first
  // record for this pair" (which would usually be a different family's record entirely).
  const family = RELATIONSHIP_FAMILY_GROUPS.find((group) => (group as readonly string[]).includes(subject.relationship));
  const derived = deriveReferenceRegionRelationships('adequacy-check', [subjectRegion, relatedRegion], options);
  if (!derived.ok) return { available: false, reason: derived.reason };
  const direct = derived.graph.pairwiseRelationships.find(
    (r) => (family as readonly string[]).includes(r.kind) && r.subjectRegion === subject.subjectRegion && r.relatedRegion === subject.relatedRegion,
  );
  if (direct) return { available: true, kind: 'relationship', matches: direct.kind === subject.relationship };
  const reversed = derived.graph.pairwiseRelationships.find(
    (r) => (family as readonly string[]).includes(r.kind) && r.subjectRegion === subject.relatedRegion && r.relatedRegion === subject.subjectRegion,
  );
  if (reversed) {
    return {
      available: false,
      reason: `relationship evidence for "${subject.subjectRegion}"/"${subject.relatedRegion}" was only derivable in the opposite region order (found "${reversed.kind}" from "${subject.relatedRegion}"'s perspective) - author this requirement with subjectRegion/relatedRegion matching the derivation order to evaluate it`,
    };
  }
  return { available: false, reason: `no "${subject.relationship}" relationship evidence was derivable between "${subject.subjectRegion}" and "${subject.relatedRegion}"` };
}

// --- reference-side adequacy (structured, deterministic, never a numeric score) ---

export const REFERENCE_REQUIREMENT_ADEQUACY_STATES = ['adequate', 'partial', 'inadequate'] as const;
export type ReferenceRequirementAdequacyState = (typeof REFERENCE_REQUIREMENT_ADEQUACY_STATES)[number];

/**
 * Deliberately its own small, reference-owned vocabulary - not a reuse of
 * domain/boundedAgentContext.ts#ADEQUACY_REASON_CODES, which describes
 * runtime-target/static-correlation concerns that do not exist yet at this
 * stage (see docs/CONTRACTS.md "v0.7 Prompt 3" for the full precedent
 * review). Only two codes exist because only two conditions can make an
 * already-*structurally-valid* requirement collection reference-inadequate:
 * authoring zero requirements at all, or a validly-shaped relationship/
 * measurement requirement whose evidence cannot actually be derived from the
 * reference geometry. An unknown-region or malformed requirement is a
 * construction-time validation failure (isValidReferenceRequirements) and
 * never reaches adequacy at all.
 */
export const REFERENCE_REQUIREMENT_ADEQUACY_REASON_CODES = ['no-selected-requirements', 'missing-reference-relationship-evidence'] as const;
export type ReferenceRequirementAdequacyReasonCode = (typeof REFERENCE_REQUIREMENT_ADEQUACY_REASON_CODES)[number];

export interface ReferenceRequirementAdequacyReason {
  code: ReferenceRequirementAdequacyReasonCode;
  requirementId?: string;
  detail?: string;
}

export interface ReferenceRequirementAdequacy {
  status: ReferenceRequirementAdequacyState;
  totalRequirements: number;
  evaluableRequirements: number;
  unavailableRequirements: number;
  reasons: ReferenceRequirementAdequacyReason[];
}

/**
 * REFERENCE-SIDE adequacy only: does the reference definition itself contain
 * enough evidence to understand every selected requirement? This never asks
 * whether a runtime target/candidate exists (that is Prompt 4/5's
 * responsibility). A reference with zero authored requirements is explicitly
 * `inadequate` (request section 24F's documented decision: an
 * externally-valid, region-rich reference is still not usable for a
 * correction task until the user has actually selected what matters).
 * Deterministic: reasons are ordered by authored requirement index, never by
 * object-key iteration order.
 */
export function deriveReferenceRequirementAdequacy(
  regions: readonly ReferenceRegion[],
  requirements: readonly ExternalReferenceRequirement[],
  options: { geometryTolerancePx?: number } = {},
): ReferenceRequirementAdequacy {
  if (requirements.length === 0) {
    return {
      status: 'inadequate',
      totalRequirements: 0,
      evaluableRequirements: 0,
      unavailableRequirements: 0,
      reasons: [{ code: 'no-selected-requirements', detail: 'no design requirements have been selected for this reference' }],
    };
  }

  const reasons: ReferenceRequirementAdequacyReason[] = [];
  let evaluableRequirements = 0;

  for (const requirement of requirements) {
    const expectation = deriveReferenceRequirementExpectation(requirement.subject, regions, options);
    const unavailable = !expectation.available || (expectation.kind === 'relationship' && !expectation.matches);
    if (unavailable) {
      const detail = !expectation.available
        ? expectation.reason
        : `the reference does not exhibit the required "${(requirement.subject as RegionRelationshipRequirementSubject).relationship}" relationship`;
      reasons.push({ code: 'missing-reference-relationship-evidence', requirementId: requirement.requirementId, detail });
    } else {
      evaluableRequirements += 1;
    }
  }

  const unavailableRequirements = requirements.length - evaluableRequirements;
  const status: ReferenceRequirementAdequacyState = unavailableRequirements === 0 ? 'adequate' : unavailableRequirements === requirements.length ? 'inadequate' : 'partial';

  return { status, totalRequirements: requirements.length, evaluableRequirements, unavailableRequirements, reasons };
}

/**
 * v0.7 Prompt 7 addition (additive, previously no structural validator
 * existed for this already-frozen Prompt 3 shape): a defense-in-depth
 * structural check, reused by `boundedAgentContext.ts` when accepting an
 * already-computed `ReferenceRequirementAdequacy` value as part of a bounded
 * fidelity projection. No change to `deriveReferenceRequirementAdequacy`'s
 * own logic or the `ReferenceRequirementAdequacy` contract itself.
 */
export function isValidReferenceRequirementAdequacy(value: unknown): value is ReferenceRequirementAdequacy {
  if (!isPlainObject(value)) return false;
  if (typeof value.status !== 'string' || !(REFERENCE_REQUIREMENT_ADEQUACY_STATES as readonly string[]).includes(value.status)) return false;
  for (const key of ['totalRequirements', 'evaluableRequirements', 'unavailableRequirements'] as const) {
    if (typeof value[key] !== 'number' || !Number.isInteger(value[key]) || (value[key] as number) < 0) return false;
  }
  if (!Array.isArray(value.reasons)) return false;
  for (const reason of value.reasons) {
    if (!isPlainObject(reason)) return false;
    if (typeof reason.code !== 'string' || !(REFERENCE_REQUIREMENT_ADEQUACY_REASON_CODES as readonly string[]).includes(reason.code)) return false;
    if (reason.requirementId !== undefined && !isNonEmptyString(reason.requirementId)) return false;
    if (reason.detail !== undefined && typeof reason.detail !== 'string') return false;
  }
  return true;
}
