/**
 * v0.7 Prompt 6 structured reference-vs-candidate fidelity evaluation.
 * Answers "for a compatible candidate with explicit valid bindings, does the
 * candidate actually match the selected reference design requirements?" -
 * the first point in this whole v0.7 stack where a reference's authored
 * expectation is actually compared against live candidate evidence.
 *
 * Reuses, never duplicates:
 * - `deriveReferenceRequirementAdequacy`/`deriveReferenceRequirementExpectation`
 *   (v0.7 Prompt 3) for reference-side expected values/relationships and the
 *   reference-adequacy gate.
 * - `evaluateReferenceCandidateCompatibility` (v0.7 Prompt 4) as a hard gate
 *   - viewport/theme/application-state/authenticated-state comparison is
 *   never re-implemented here.
 * - `evaluateReferenceRuntimeBindings` (v0.7 Prompt 5) as the sole source of
 *   which runtime target (if any) represents each reference region for this
 *   candidate - no automatic binding, no name/geometry matching.
 * - `deriveLayoutRelationships` (v0.4) as the sole source of runtime
 *   relationship evidence, scoped to the exact requested relationship
 *   family (the same Prompt 3 bug-fix precedent - matching the first
 *   record for a pair, regardless of family, was a real bug there and would
 *   be here too).
 *
 * Coordinate systems are never conflated: Prompt 2 regions and Prompt 3
 * tolerances are authored in reference-image pixels; `ObservationArtifact`
 * target geometry is CSS pixels. This module establishes one explicit,
 * deterministic, full-frame scale from `reference.applicability.viewport`
 * (CSS pixels) to the reference image's own pixel dimensions, and converts
 * candidate CSS measurements into reference-image-pixel space before
 * comparing them against a Prompt 3 tolerance - it never assumes 1
 * reference-image pixel equals 1 CSS pixel, never re-expresses a tolerance
 * in a different unit, and never performs cropping/offset/rotation/
 * perspective registration.
 *
 * No new persisted artifact family: `evaluateReferenceCandidateFidelity` is
 * a pure, synchronous, on-demand function over already-persisted/in-memory
 * evidence (an `ExternalReferenceArtifact`, an `ObservationArtifact`, and a
 * binding-declaration collection). It mutates none of its inputs.
 */
import type { ExternalReferenceArtifact } from './externalReference.js';
import { isValidExternalReferenceArtifact, isImportedExternalReferenceArtifact } from './externalReference.js';
import type { ReferenceRegionGeometry } from './externalReferenceRegions.js';
import type {
  ExternalReferenceRequirement,
  ReferenceRequirementSubject,
  RegionPropertyRequirementSubject,
  RegionRelationshipRequirementSubject,
  RegionMeasurementRequirementSubject,
  ReferenceRequirementTolerance,
  ReferenceRequirementAdequacy,
  AuthoredChangeScopeCategory,
  ExpectedDependentMode,
} from './externalReferenceRequirements.js';
import {
  deriveReferenceRequirementAdequacy,
  deriveReferenceRequirementExpectation,
  deriveReferenceRequirementMeasurement,
  isAuthoredChangeScopeCategory,
  isValidExpectedDependentMode,
  isValidReferenceRequirementSubjectShape,
  isValidReferenceRequirementTolerance,
} from './externalReferenceRequirements.js';
import type { ObservationArtifact, TargetGeometry } from './schema.js';
import { isValidObservationArtifact } from './schema.js';
import { evidenceValue } from './evidence.js';
import type { ComparabilityResult } from './comparison.js';
import { evaluateReferenceCandidateCompatibility } from './externalReferenceCompatibility.js';
import type { ReferenceRuntimeBindingDeclaration, ReferenceRuntimeBindingEvaluation, ReferenceRuntimeBindingResult } from './externalReferenceRuntimeBinding.js';
import { evaluateReferenceRuntimeBindings } from './externalReferenceRuntimeBinding.js';
import type { PairwiseRelationshipKind } from './relationships.js';
import {
  deriveLayoutRelationships,
  HORIZONTAL_ORDER_RELATIONSHIPS,
  VERTICAL_ORDER_RELATIONSHIPS,
  AREA_OVERLAP_RELATIONSHIPS,
  RELATIVE_WIDTH_RELATIONSHIPS,
  GEOMETRIC_FIT_RELATIONSHIPS,
  VERTICAL_SEQUENCE_RELATIONSHIPS,
  PAIRWISE_RELATIONSHIP_KINDS,
} from './relationships.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// Result vocabulary
// ---------------------------------------------------------------------------

/**
 * Deliberately its own small vocabulary, not an import of v0.5's
 * `CLAUSE_RESULT_STATUSES`: that vocabulary includes `'conflict'`, which has
 * no equivalent here (each requirement is evaluated independently against
 * its own single reference/candidate pair - there is no cross-requirement
 * authoring conflict concept in Prompt 6). `pass`/`fail`/`unavailable` are
 * reused as the same honest three-state shape v0.5 already established.
 */
export const REFERENCE_REQUIREMENT_FIDELITY_STATUSES = ['pass', 'fail', 'unavailable'] as const;
export type ReferenceRequirementFidelityStatus = (typeof REFERENCE_REQUIREMENT_FIDELITY_STATUSES)[number];

export const REFERENCE_REQUIREMENT_FIDELITY_REASON_CODES = [
  'reference-evidence-unavailable',
  'reference-relationship-not-exhibited',
  'binding-unavailable',
  'candidate-evidence-unavailable',
  'coordinate-mapping-unavailable',
] as const;
export type ReferenceRequirementFidelityReasonCode = (typeof REFERENCE_REQUIREMENT_FIDELITY_REASON_CODES)[number];

/**
 * One requirement's structured result. Numeric fields (`referenceValue`
 * through `tolerance`) apply only to `region-property`/`region-measurement`
 * subjects; relationship fields (`expectedRelationship`/`actualRelationship`)
 * apply only to `region-relationship` subjects - never both populated on
 * the same result, mirroring the subject's own discriminated shape.
 * `reasonCode`/`detail` are present only when `status === 'unavailable'` - a
 * `fail` is already fully explained by its numeric/relationship fields.
 */
export interface ReferenceRequirementFidelityResult {
  requirementId: string;
  category: AuthoredChangeScopeCategory;
  expectedDependentMode?: ExpectedDependentMode;
  subject: ReferenceRequirementSubject;
  boundRuntimeTargets: string[];
  status: ReferenceRequirementFidelityStatus;
  reasonCode?: ReferenceRequirementFidelityReasonCode;
  detail?: string;
  referenceValue?: number;
  candidateRawValue?: number;
  candidateValue?: number;
  delta?: number;
  tolerance?: ReferenceRequirementTolerance;
  expectedRelationship?: PairwiseRelationshipKind;
  actualRelationship?: PairwiseRelationshipKind;
}

/**
 * v0.7 Prompt 7 addition (additive; no prior structural validator existed
 * for this Prompt 6 shape - fidelity evaluations previously only ever
 * flowed in-memory from `evaluateReferenceCandidateFidelity`'s own return
 * type, with no external/persisted input path to defend against). Reused by
 * `boundedAgentContext.ts` as defense-in-depth when a caller-supplied
 * `ReferenceRequirementFidelityResult` becomes part of a bounded fidelity
 * projection. No change to `evaluateReferenceCandidateFidelity`'s own logic.
 */
export function isValidReferenceRequirementFidelityResult(value: unknown): value is ReferenceRequirementFidelityResult {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.requirementId)) return false;
  if (!isAuthoredChangeScopeCategory(value.category)) return false;
  if (value.expectedDependentMode !== undefined && !isValidExpectedDependentMode(value.expectedDependentMode)) return false;
  if (!isValidReferenceRequirementSubjectShape(value.subject)) return false;
  if (!Array.isArray(value.boundRuntimeTargets) || !value.boundRuntimeTargets.every(isNonEmptyString)) return false;
  if (typeof value.status !== 'string' || !(REFERENCE_REQUIREMENT_FIDELITY_STATUSES as readonly string[]).includes(value.status)) return false;

  if (value.status === 'unavailable') {
    if (typeof value.reasonCode !== 'string' || !(REFERENCE_REQUIREMENT_FIDELITY_REASON_CODES as readonly string[]).includes(value.reasonCode)) return false;
    if (!isNonEmptyString(value.detail)) return false;
  } else if ('reasonCode' in value && value.reasonCode !== undefined) {
    return false;
  }

  for (const key of ['referenceValue', 'candidateRawValue', 'candidateValue', 'delta'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'number') return false;
  }
  if (value.tolerance !== undefined && !isValidReferenceRequirementTolerance(value.tolerance)) return false;
  for (const key of ['expectedRelationship', 'actualRelationship'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !(PAIRWISE_RELATIONSHIP_KINDS as readonly string[]).includes(value[key] as string))) return false;
  }
  return true;
}

export const REFERENCE_FIDELITY_STATES = ['not-evaluated', 'pass', 'fail'] as const;
export type ReferenceFidelityState = (typeof REFERENCE_FIDELITY_STATES)[number];

export const REFERENCE_FIDELITY_BLOCK_REASONS = ['reference-inadequate', 'incompatible'] as const;
export type ReferenceFidelityBlockReason = (typeof REFERENCE_FIDELITY_BLOCK_REASONS)[number];

/**
 * `state === 'not-evaluated'` exactly when an earlier gate (reference
 * adequacy or reference/candidate compatibility) blocked ordinary
 * evaluation - `requirementResults`/`bindings` are empty in that case, never
 * a fabricated PASS/FAIL set. This is REFERENCE FIDELITY only - a
 * downstream, separate concern from v0.5 baseline/per-change contract
 * evaluation (see docs/CONTRACTS.md "v0.7 Prompt 6"): a `pass` here says
 * nothing about, and never overrides, any v0.5 contract result.
 */
export interface ReferenceCandidateFidelityEvaluation {
  referenceId: string;
  referenceRequestId: string;
  candidateObservationId: string;
  candidateRequestId: string;
  adequacy: ReferenceRequirementAdequacy;
  compatibility?: ComparabilityResult;
  bindings?: ReferenceRuntimeBindingEvaluation;
  state: ReferenceFidelityState;
  blockedBy?: ReferenceFidelityBlockReason;
  requirementResults: ReferenceRequirementFidelityResult[];
}

export type EvaluateReferenceCandidateFidelityResult = { ok: true; evaluation: ReferenceCandidateFidelityEvaluation } | { ok: false; reason: string };

export interface EvaluateReferenceCandidateFidelityOptions {
  geometryTolerancePx?: number;
}

// ---------------------------------------------------------------------------
// Coordinate mapping (reference-image pixels <-> CSS pixels)
// ---------------------------------------------------------------------------

/**
 * A coordinate-mapping-validity check only - never a design tolerance.
 * Independently owned, deliberately tiny: this exists solely to detect
 * "the applicable viewport and the reference image cannot represent the
 * same full-frame content" (e.g. a viewport declared with a materially
 * different aspect ratio than the image), never to forgive an actual
 * design mismatch.
 */
const ASPECT_RATIO_MAPPING_TOLERANCE = 0.01;

export interface CoordinateScale {
  scaleX: number;
  scaleY: number;
}

export type DeriveCoordinateScaleResult = { ok: true; scale: CoordinateScale } | { ok: false; reason: string };

function referenceImageDimensions(reference: ExternalReferenceArtifact): { width: number; height: number } {
  if (isImportedExternalReferenceArtifact(reference)) return { width: reference.image.width, height: reference.image.height };
  return { width: reference.sourceReference.image.width, height: reference.sourceReference.image.height };
}

/**
 * Establishes the one explicit reference-image-pixel <-> CSS-pixel scale
 * this module ever uses, from `reference.applicability.viewport` (the CSS-
 * pixel runtime viewport the design represents) and the reference image's
 * own pixel dimensions (never conflated - see externalReferenceApplicability.ts).
 * No applicable viewport at all means no scale can be established (this
 * module never infers one from image dimensions alone). A deliberately
 * bounded full-frame mapping only: `scaleX`/`scaleY` must agree within
 * `ASPECT_RATIO_MAPPING_TOLERANCE`, or the mapping is rejected outright -
 * this module performs no cropping, offset, rotation, perspective, or other
 * arbitrary affine registration.
 */
/**
 * Exported additively in v0.8 Batch 6 (previously module-private) so the
 * viewer's lock-eligibility/view-lock-source-space-mapping feature can reuse
 * this exact function - never a second aspect-ratio/scale implementation.
 * The function body, formula, and tolerance are unchanged from Prompt 6.
 */
export function deriveCoordinateScale(reference: ExternalReferenceArtifact): DeriveCoordinateScaleResult {
  const viewport = reference.applicability?.viewport;
  if (!viewport) {
    return { ok: false, reason: 'reference declares no applicable viewport; reference-image-pixel <-> CSS-pixel coordinate mapping cannot be established' };
  }
  const { width: imageWidth, height: imageHeight } = referenceImageDimensions(reference);
  const scaleX = imageWidth / viewport.width;
  const scaleY = imageHeight / viewport.height;
  const largerScale = Math.max(scaleX, scaleY);
  const relativeScaleDelta = largerScale === 0 ? 0 : Math.abs(scaleX - scaleY) / largerScale;
  if (relativeScaleDelta > ASPECT_RATIO_MAPPING_TOLERANCE) {
    return {
      ok: false,
      reason: `reference image (${imageWidth}x${imageHeight}) and applicable viewport (${viewport.width}x${viewport.height}) do not share a coherent full-frame aspect ratio (scaleX=${scaleX}, scaleY=${scaleY})`,
    };
  }
  return { ok: true, scale: { scaleX, scaleY } };
}

/** Raw CSS-pixel geometry, reshaped into `ReferenceRegionGeometry`'s exact field set (adding centerX/centerY, computed identically to `deriveReferenceRegionGeometry`) so the same downstream property/measurement logic applies to both reference and candidate geometry uniformly. */
function candidateRawGeometry(geometry: TargetGeometry): ReferenceRegionGeometry {
  return {
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    right: geometry.right,
    bottom: geometry.bottom,
    centerX: geometry.x + geometry.width / 2,
    centerY: geometry.y + geometry.height / 2,
  };
}

/** Applies the coordinate scale per axis - horizontal fields (x/width/right/centerX) scale by `scaleX`, vertical fields (y/height/bottom/centerY) scale by `scaleY`. Never rounds; subpixel precision is preserved through to the final tolerance comparison. */
function scaleGeometryToReferenceSpace(geometry: ReferenceRegionGeometry, scale: CoordinateScale): ReferenceRegionGeometry {
  return {
    x: geometry.x * scale.scaleX,
    y: geometry.y * scale.scaleY,
    width: geometry.width * scale.scaleX,
    height: geometry.height * scale.scaleY,
    right: geometry.right * scale.scaleX,
    bottom: geometry.bottom * scale.scaleY,
    centerX: geometry.centerX * scale.scaleX,
    centerY: geometry.centerY * scale.scaleY,
  };
}

// ---------------------------------------------------------------------------
// Tolerance (reused exactly, never redefined)
// ---------------------------------------------------------------------------

/**
 * `exact` is the zero-tolerance case of the same rule, so a single
 * `abs(delta) <= allowed` comparison covers every Prompt 3 tolerance kind
 * without a separate equality branch. Percent's denominator mirrors
 * v0.5's own `toleranceToPx` convention exactly (`frontendContractEvaluation.ts`:
 * "the absolute before-value, the standard 'may vary by up to N%' reading") -
 * independently reimplemented here in reference-image-pixel units, never
 * imported, since v0.5's CSS-pixel `ContractTolerance` is a different unit
 * (see externalReferenceRequirements.ts's own tolerance doc comment).
 */
function referenceToleranceAmountPx(tolerance: ReferenceRequirementTolerance, referenceValue: number): number {
  switch (tolerance.kind) {
    case 'exact':
      return 0;
    case 'absolute-reference-px':
      return tolerance.amount;
    case 'percent':
      return (tolerance.amount / 100) * Math.abs(referenceValue);
  }
}

// ---------------------------------------------------------------------------
// Runtime-target lookup (mirrors externalReferenceRuntimeBinding.ts's own
// case-insensitive resolution convention - duplicated per the established
// per-module small-helper-ownership pattern, not cross-imported as a
// private helper)
// ---------------------------------------------------------------------------

function resolveConfiguredTargetName(candidate: ObservationArtifact, runtimeTarget: string): string | undefined {
  const lower = runtimeTarget.toLowerCase();
  return candidate.requestConfig.targets.find((t) => t.name.toLowerCase() === lower)?.name;
}

/** Mirrors frontendContractEvaluation.ts's/externalReferenceRequirements.ts's own independently-owned `RELATIONSHIP_FAMILY_GROUPS` shape - the third such duplicate in this repository, per the same established "never share this constant cross-module" convention. */
const RELATIONSHIP_FAMILY_GROUPS: readonly (readonly PairwiseRelationshipKind[])[] = [
  HORIZONTAL_ORDER_RELATIONSHIPS,
  VERTICAL_ORDER_RELATIONSHIPS,
  AREA_OVERLAP_RELATIONSHIPS,
  RELATIVE_WIDTH_RELATIONSHIPS,
  GEOMETRIC_FIT_RELATIONSHIPS,
  VERTICAL_SEQUENCE_RELATIONSHIPS,
];

// ---------------------------------------------------------------------------
// Per-requirement evaluation
// ---------------------------------------------------------------------------

function baseFields(requirement: ExternalReferenceRequirement): Pick<ReferenceRequirementFidelityResult, 'requirementId' | 'category' | 'expectedDependentMode' | 'subject'> {
  return {
    requirementId: requirement.requirementId,
    category: requirement.category,
    subject: requirement.subject,
    ...(requirement.expectedDependentMode !== undefined ? { expectedDependentMode: requirement.expectedDependentMode } : {}),
  };
}

function unavailable(
  requirement: ExternalReferenceRequirement,
  boundRuntimeTargets: string[],
  reasonCode: ReferenceRequirementFidelityReasonCode,
  detail: string,
): ReferenceRequirementFidelityResult {
  return { ...baseFields(requirement), boundRuntimeTargets, status: 'unavailable', reasonCode, detail };
}

function bindingFor(bindingsByRegion: Map<string, ReferenceRuntimeBindingResult>, regionId: string): ReferenceRuntimeBindingResult | undefined {
  return bindingsByRegion.get(regionId.toLowerCase());
}

function evaluateRegionPropertyRequirement(
  requirement: ExternalReferenceRequirement,
  subject: RegionPropertyRequirementSubject,
  reference: ExternalReferenceArtifact,
  candidate: ObservationArtifact,
  bindingsByRegion: Map<string, ReferenceRuntimeBindingResult>,
  scaleResult: DeriveCoordinateScaleResult,
  options: EvaluateReferenceCandidateFidelityOptions,
): ReferenceRequirementFidelityResult {
  const expectation = deriveReferenceRequirementExpectation(subject, reference.regions ?? [], options);
  if (!expectation.available) return unavailable(requirement, [], 'reference-evidence-unavailable', expectation.reason);
  if (expectation.kind !== 'numeric') return unavailable(requirement, [], 'reference-evidence-unavailable', 'a region-property subject unexpectedly produced non-numeric reference evidence');

  const binding = bindingFor(bindingsByRegion, subject.region);
  if (!binding || binding.status !== 'bound') {
    return unavailable(requirement, [], 'binding-unavailable', binding ? binding.detail : `no runtime binding declared for reference region "${subject.region}"`);
  }
  const boundRuntimeTargets = [binding.runtimeTarget];

  const configuredName = resolveConfiguredTargetName(candidate, binding.runtimeTarget);
  const record = configuredName ? candidate.targetEvidence[configuredName] : undefined;
  const visibility = record ? evidenceValue(record.visibility) : undefined;
  if (!visibility || !visibility.visible) {
    return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', 'bound runtime target is not visible; geometry evidence is not usable for fidelity evaluation');
  }
  const geometry = record ? evidenceValue(record.geometry) : undefined;
  if (!geometry) {
    return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', 'bound runtime target has no geometry evidence');
  }

  if (!scaleResult.ok) {
    return unavailable(requirement, boundRuntimeTargets, 'coordinate-mapping-unavailable', scaleResult.reason);
  }

  const rawGeometry = candidateRawGeometry(geometry);
  const scaledGeometry = scaleGeometryToReferenceSpace(rawGeometry, scaleResult.scale);
  const candidateRawValue = rawGeometry[subject.property];
  const candidateValue = scaledGeometry[subject.property];
  const referenceValue = expectation.value;
  const delta = candidateValue - referenceValue;
  const tolerance = requirement.tolerance as ReferenceRequirementTolerance;
  const allowed = referenceToleranceAmountPx(tolerance, referenceValue);
  const status: ReferenceRequirementFidelityStatus = Math.abs(delta) <= allowed ? 'pass' : 'fail';

  return { ...baseFields(requirement), boundRuntimeTargets, status, referenceValue, candidateRawValue, candidateValue, delta, tolerance };
}

function evaluateRegionMeasurementRequirement(
  requirement: ExternalReferenceRequirement,
  subject: RegionMeasurementRequirementSubject,
  reference: ExternalReferenceArtifact,
  candidate: ObservationArtifact,
  bindingsByRegion: Map<string, ReferenceRuntimeBindingResult>,
  scaleResult: DeriveCoordinateScaleResult,
  options: EvaluateReferenceCandidateFidelityOptions,
): ReferenceRequirementFidelityResult {
  const expectation = deriveReferenceRequirementExpectation(subject, reference.regions ?? [], options);
  if (!expectation.available) return unavailable(requirement, [], 'reference-evidence-unavailable', expectation.reason);
  if (expectation.kind !== 'numeric') return unavailable(requirement, [], 'reference-evidence-unavailable', 'a region-measurement subject unexpectedly produced non-numeric reference evidence');

  const subjectBinding = bindingFor(bindingsByRegion, subject.subjectRegion);
  const relatedBinding = bindingFor(bindingsByRegion, subject.relatedRegion);
  if (!subjectBinding || subjectBinding.status !== 'bound') {
    return unavailable(requirement, [], 'binding-unavailable', subjectBinding ? subjectBinding.detail : `no runtime binding declared for reference region "${subject.subjectRegion}"`);
  }
  if (!relatedBinding || relatedBinding.status !== 'bound') {
    return unavailable(requirement, [subjectBinding.runtimeTarget], 'binding-unavailable', relatedBinding ? relatedBinding.detail : `no runtime binding declared for reference region "${subject.relatedRegion}"`);
  }
  const boundRuntimeTargets = [subjectBinding.runtimeTarget, relatedBinding.runtimeTarget];

  const subjectConfiguredName = resolveConfiguredTargetName(candidate, subjectBinding.runtimeTarget);
  const relatedConfiguredName = resolveConfiguredTargetName(candidate, relatedBinding.runtimeTarget);
  const subjectRecord = subjectConfiguredName ? candidate.targetEvidence[subjectConfiguredName] : undefined;
  const relatedRecord = relatedConfiguredName ? candidate.targetEvidence[relatedConfiguredName] : undefined;
  const subjectVisibility = subjectRecord ? evidenceValue(subjectRecord.visibility) : undefined;
  const relatedVisibility = relatedRecord ? evidenceValue(relatedRecord.visibility) : undefined;
  if (!subjectVisibility?.visible || !relatedVisibility?.visible) {
    return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', 'one or both bound runtime targets are not visible; geometry evidence is not usable for fidelity evaluation');
  }
  const subjectGeometry = subjectRecord ? evidenceValue(subjectRecord.geometry) : undefined;
  const relatedGeometry = relatedRecord ? evidenceValue(relatedRecord.geometry) : undefined;
  if (!subjectGeometry || !relatedGeometry) {
    return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', 'one or both bound runtime targets have no geometry evidence');
  }

  if (!scaleResult.ok) {
    return unavailable(requirement, boundRuntimeTargets, 'coordinate-mapping-unavailable', scaleResult.reason);
  }

  const subjectRaw = candidateRawGeometry(subjectGeometry);
  const relatedRaw = candidateRawGeometry(relatedGeometry);
  const subjectScaled = scaleGeometryToReferenceSpace(subjectRaw, scaleResult.scale);
  const relatedScaled = scaleGeometryToReferenceSpace(relatedRaw, scaleResult.scale);

  const candidateRawValue = deriveReferenceRequirementMeasurement(subject.measurement, subjectRaw, relatedRaw);
  const candidateValue = deriveReferenceRequirementMeasurement(subject.measurement, subjectScaled, relatedScaled);
  if (candidateValue === undefined) {
    return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', `"${subject.measurement}" is geometrically undefined for these two bound runtime targets (they overlap on the relevant axis)`);
  }

  const referenceValue = expectation.value;
  const delta = candidateValue - referenceValue;
  const tolerance = requirement.tolerance as ReferenceRequirementTolerance;
  const allowed = referenceToleranceAmountPx(tolerance, referenceValue);
  const status: ReferenceRequirementFidelityStatus = Math.abs(delta) <= allowed ? 'pass' : 'fail';

  return {
    ...baseFields(requirement),
    boundRuntimeTargets,
    status,
    referenceValue,
    ...(candidateRawValue !== undefined ? { candidateRawValue } : {}),
    candidateValue,
    delta,
    tolerance,
  };
}

function evaluateRegionRelationshipRequirement(
  requirement: ExternalReferenceRequirement,
  subject: RegionRelationshipRequirementSubject,
  reference: ExternalReferenceArtifact,
  candidate: ObservationArtifact,
  bindingsByRegion: Map<string, ReferenceRuntimeBindingResult>,
  options: EvaluateReferenceCandidateFidelityOptions,
): ReferenceRequirementFidelityResult {
  const expectation = deriveReferenceRequirementExpectation(subject, reference.regions ?? [], options);
  if (!expectation.available) return unavailable(requirement, [], 'reference-evidence-unavailable', expectation.reason);
  if (expectation.kind === 'relationship' && !expectation.matches) {
    return unavailable(
      requirement,
      [],
      'reference-relationship-not-exhibited',
      `the reference does not exhibit the required "${subject.relationship}" relationship between "${subject.subjectRegion}" and "${subject.relatedRegion}"`,
    );
  }

  const subjectBinding = bindingFor(bindingsByRegion, subject.subjectRegion);
  const relatedBinding = bindingFor(bindingsByRegion, subject.relatedRegion);
  if (!subjectBinding || subjectBinding.status !== 'bound') {
    return unavailable(requirement, [], 'binding-unavailable', subjectBinding ? subjectBinding.detail : `no runtime binding declared for reference region "${subject.subjectRegion}"`);
  }
  if (!relatedBinding || relatedBinding.status !== 'bound') {
    return unavailable(requirement, [subjectBinding.runtimeTarget], 'binding-unavailable', relatedBinding ? relatedBinding.detail : `no runtime binding declared for reference region "${subject.relatedRegion}"`);
  }
  const boundRuntimeTargets = [subjectBinding.runtimeTarget, relatedBinding.runtimeTarget];

  const relationshipsResult = deriveLayoutRelationships(candidate, options.geometryTolerancePx !== undefined ? { geometryTolerancePx: options.geometryTolerancePx } : {});
  if (!relationshipsResult.ok) {
    return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', relationshipsResult.reason);
  }

  const subjectTargetName = resolveConfiguredTargetName(candidate, subjectBinding.runtimeTarget);
  const relatedTargetName = resolveConfiguredTargetName(candidate, relatedBinding.runtimeTarget);
  if (!subjectTargetName || !relatedTargetName) {
    return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', 'bound runtime target is not part of the candidate\'s configured target set');
  }

  const unresolved = new Set(relationshipsResult.graph.unresolvedTargets.map((u) => u.target));
  if (unresolved.has(subjectTargetName) || unresolved.has(relatedTargetName)) {
    return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', 'one or both bound runtime targets have no usable geometry for relationship derivation');
  }

  const family = RELATIONSHIP_FAMILY_GROUPS.find((group) => (group as readonly string[]).includes(subject.relationship));
  const direct = relationshipsResult.graph.pairwiseRelationships.find(
    (r) => (family as readonly string[]).includes(r.kind) && r.subjectTarget === subjectTargetName && r.relatedTarget === relatedTargetName,
  );
  if (direct) {
    const status: ReferenceRequirementFidelityStatus = direct.kind === subject.relationship ? 'pass' : 'fail';
    return { ...baseFields(requirement), boundRuntimeTargets, status, expectedRelationship: subject.relationship, actualRelationship: direct.kind };
  }
  const reversed = relationshipsResult.graph.pairwiseRelationships.find(
    (r) => (family as readonly string[]).includes(r.kind) && r.subjectTarget === relatedTargetName && r.relatedTarget === subjectTargetName,
  );
  if (reversed) {
    return unavailable(
      requirement,
      boundRuntimeTargets,
      'candidate-evidence-unavailable',
      `runtime relationship evidence for the bound targets was only derivable in the opposite order (found "${reversed.kind}") - this requirement's subjectRegion/relatedRegion order does not match the candidate's configured target order`,
    );
  }
  return unavailable(requirement, boundRuntimeTargets, 'candidate-evidence-unavailable', `no "${subject.relationship}" runtime relationship evidence was derivable between the bound targets`);
}

function evaluateOneRequirement(
  requirement: ExternalReferenceRequirement,
  reference: ExternalReferenceArtifact,
  candidate: ObservationArtifact,
  bindingsByRegion: Map<string, ReferenceRuntimeBindingResult>,
  scaleResult: DeriveCoordinateScaleResult,
  options: EvaluateReferenceCandidateFidelityOptions,
): ReferenceRequirementFidelityResult {
  const subject = requirement.subject;
  if (subject.kind === 'region-property') return evaluateRegionPropertyRequirement(requirement, subject, reference, candidate, bindingsByRegion, scaleResult, options);
  if (subject.kind === 'region-measurement') return evaluateRegionMeasurementRequirement(requirement, subject, reference, candidate, bindingsByRegion, scaleResult, options);
  return evaluateRegionRelationshipRequirement(requirement, subject, reference, candidate, bindingsByRegion, options);
}

// ---------------------------------------------------------------------------
// Top-level evaluation
// ---------------------------------------------------------------------------

/**
 * Pure and synchronous. Evaluation order (frozen by this prompt's own
 * design, never reordered): reference structural validation -> candidate
 * structural validation -> binding-declaration structural validation ->
 * Prompt 3 reference adequacy -> Prompt 4 compatibility -> Prompt 5 binding
 * evaluation -> per-requirement candidate-evidence/coordinate-mapping
 * checks -> per-requirement tolerance/relationship comparison -> overall
 * result. An earlier blocking gate (adequacy `inadequate`, compatibility
 * `incomparable`) always short-circuits to `state: 'not-evaluated'` with an
 * empty `requirementResults` - no ordinary PASS/FAIL set is ever fabricated
 * past a blocked gate.
 */
export function evaluateReferenceCandidateFidelity(
  reference: ExternalReferenceArtifact,
  candidate: ObservationArtifact,
  bindingDeclarations: readonly ReferenceRuntimeBindingDeclaration[],
  options: EvaluateReferenceCandidateFidelityOptions = {},
): EvaluateReferenceCandidateFidelityResult {
  const referenceValidation = isValidExternalReferenceArtifact(reference);
  if (!referenceValidation.valid) return { ok: false, reason: `reference is invalid: ${referenceValidation.reason}` };

  const candidateValidation = isValidObservationArtifact(candidate);
  if (!candidateValidation.valid) return { ok: false, reason: `candidate is invalid: ${candidateValidation.reason}` };

  const geometryOptions = options.geometryTolerancePx !== undefined ? { geometryTolerancePx: options.geometryTolerancePx } : {};
  const adequacy = deriveReferenceRequirementAdequacy(reference.regions ?? [], reference.requirements ?? [], geometryOptions);

  const provenance = {
    referenceId: reference.referenceId,
    referenceRequestId: reference.referenceRequestId,
    candidateObservationId: candidate.observationId,
    candidateRequestId: candidate.requestId,
  };

  if (adequacy.status === 'inadequate') {
    return { ok: true, evaluation: { ...provenance, adequacy, state: 'not-evaluated', blockedBy: 'reference-inadequate', requirementResults: [] } };
  }

  const compatibilityResult = evaluateReferenceCandidateCompatibility(reference, candidate);
  if (compatibilityResult.compatibility.state === 'incomparable') {
    return {
      ok: true,
      evaluation: { ...provenance, adequacy, compatibility: compatibilityResult.compatibility, state: 'not-evaluated', blockedBy: 'incompatible', requirementResults: [] },
    };
  }

  const bindingEvaluationResult = evaluateReferenceRuntimeBindings(reference, candidate, bindingDeclarations);
  if (!bindingEvaluationResult.ok) return { ok: false, reason: bindingEvaluationResult.reason };
  const bindingEvaluation = bindingEvaluationResult.evaluation;

  const bindingsByRegion = new Map(bindingEvaluation.bindings.map((b) => [b.referenceRegion.toLowerCase(), b] as const));
  const scaleResult = deriveCoordinateScale(reference);

  const requirementResults = (reference.requirements ?? []).map((requirement) =>
    evaluateOneRequirement(requirement, reference, candidate, bindingsByRegion, scaleResult, geometryOptions),
  );

  const state: ReferenceFidelityState = requirementResults.every((r) => r.status === 'pass') ? 'pass' : 'fail';

  return {
    ok: true,
    evaluation: {
      ...provenance,
      adequacy,
      compatibility: compatibilityResult.compatibility,
      bindings: bindingEvaluation,
      state,
      requirementResults,
    },
  };
}
