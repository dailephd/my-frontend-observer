/**
 * v0.4 Batch 1 layout-relationship contract, plus the Batch 2 pure
 * derivation engine (`deriveLayoutRelationships`) that consumes it. This
 * module owns geometry tolerance (needed directly by the engine below, so it
 * cannot be imported from domain/comparison.ts without a cycle - see the
 * re-export there) and never imports domain/comparison.ts.
 */
import type { ObservationArtifact, TargetEvidenceRecord, TargetGeometry } from './schema.js';
import { isValidObservationArtifact } from './schema.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Geometry tolerance -------------------------------------------------------

/** Suppresses insignificant geometry noise only - never a design contract, never permission for changes. */
export const GEOMETRY_TOLERANCE_DEFAULT_PX = 0.5;
export const GEOMETRY_TOLERANCE_MIN_PX = 0;
export const GEOMETRY_TOLERANCE_MAX_PX = 10;

export function isValidGeometryTolerancePx(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= GEOMETRY_TOLERANCE_MIN_PX && value <= GEOMETRY_TOLERANCE_MAX_PX;
}

export const HORIZONTAL_ORDER_RELATIONSHIPS = ['left-of', 'right-of', 'horizontally-overlapping'] as const;
export type HorizontalOrderRelationship = (typeof HORIZONTAL_ORDER_RELATIONSHIPS)[number];

export const VERTICAL_ORDER_RELATIONSHIPS = ['above', 'below', 'vertically-overlapping'] as const;
export type VerticalOrderRelationship = (typeof VERTICAL_ORDER_RELATIONSHIPS)[number];

export const AREA_OVERLAP_RELATIONSHIPS = ['overlaps', 'does-not-overlap'] as const;
export type AreaOverlapRelationship = (typeof AREA_OVERLAP_RELATIONSHIPS)[number];

export const RELATIVE_WIDTH_RELATIONSHIPS = ['wider-than', 'narrower-than', 'equal-width-within-tolerance'] as const;
export type RelativeWidthRelationship = (typeof RELATIVE_WIDTH_RELATIONSHIPS)[number];

export const GEOMETRIC_FIT_RELATIONSHIPS = ['fits-inside', 'does-not-fit-inside'] as const;
export type GeometricFitRelationship = (typeof GEOMETRIC_FIT_RELATIONSHIPS)[number];

/** Rendered-geometry sequencing only - never source DOM order (see docs/CONTRACTS.md target containment discussion). */
export const VERTICAL_SEQUENCE_RELATIONSHIPS = ['follows-vertically'] as const;
export type VerticalSequenceRelationship = (typeof VERTICAL_SEQUENCE_RELATIONSHIPS)[number];

export const PAGE_WIDTH_RELATIONSHIPS = ['document-width-fits-viewport', 'document-width-exceeds-viewport'] as const;
export type PageWidthRelationship = (typeof PAGE_WIDTH_RELATIONSHIPS)[number];

/** Every pairwise (two-target) relationship kind this batch freezes. Deliberately bounded - not a general-purpose spatial language. */
export const PAIRWISE_RELATIONSHIP_KINDS = [
  ...HORIZONTAL_ORDER_RELATIONSHIPS,
  ...VERTICAL_ORDER_RELATIONSHIPS,
  ...AREA_OVERLAP_RELATIONSHIPS,
  ...RELATIVE_WIDTH_RELATIONSHIPS,
  ...GEOMETRIC_FIT_RELATIONSHIPS,
  ...VERTICAL_SEQUENCE_RELATIONSHIPS,
] as const;
export type PairwiseRelationshipKind = (typeof PAIRWISE_RELATIONSHIP_KINDS)[number];

/** Every page-level (no target pair) relationship kind this batch freezes. */
export const PAGE_LEVEL_RELATIONSHIP_KINDS = [...PAGE_WIDTH_RELATIONSHIPS] as const;
export type PageLevelRelationshipKind = (typeof PAGE_LEVEL_RELATIONSHIP_KINDS)[number];

/** Points at the supporting observation evidence a derived relationship/difference was computed from (e.g. `targetEvidence.workspace.geometry`, `pageEvidence.documentSize`) - never a duplicated copy of the measurement itself. */
export interface EvidenceReference {
  path: string;
}

export function isValidEvidenceReference(value: unknown): value is EvidenceReference {
  return isPlainObject(value) && typeof value.path === 'string' && value.path.length > 0;
}

function isEvidenceReferenceArray(value: unknown): value is EvidenceReference[] {
  return Array.isArray(value) && value.every((entry) => isValidEvidenceReference(entry));
}

/** One derived spatial relationship between two configured targets, with explicit supporting evidence provenance. */
export interface PairwiseLayoutRelationship {
  kind: PairwiseRelationshipKind;
  subjectTarget: string;
  relatedTarget: string;
  evidence: EvidenceReference[];
}

export function isValidPairwiseLayoutRelationship(value: unknown): value is PairwiseLayoutRelationship {
  if (!isPlainObject(value)) return false;
  if (typeof value.kind !== 'string' || !(PAIRWISE_RELATIONSHIP_KINDS as readonly string[]).includes(value.kind)) return false;
  if (typeof value.subjectTarget !== 'string' || value.subjectTarget.length === 0) return false;
  if (typeof value.relatedTarget !== 'string' || value.relatedTarget.length === 0) return false;
  if (value.subjectTarget === value.relatedTarget) return false;
  return isEvidenceReferenceArray(value.evidence);
}

/** One derived page-level (no target pair) relationship. */
export interface PageLevelLayoutRelationship {
  kind: PageLevelRelationshipKind;
  evidence: EvidenceReference[];
}

export function isValidPageLevelLayoutRelationship(value: unknown): value is PageLevelLayoutRelationship {
  if (!isPlainObject(value)) return false;
  if (typeof value.kind !== 'string' || !(PAGE_LEVEL_RELATIONSHIP_KINDS as readonly string[]).includes(value.kind)) return false;
  return isEvidenceReferenceArray(value.evidence);
}

/** A configured target excluded from relationship derivation because it lacks usable geometry - never a fabricated zero-sized rectangle. */
export const UNRESOLVED_TARGET_REASONS = ['not-found', 'ambiguous', 'unavailable', 'hidden'] as const;
export type UnresolvedTargetReason = (typeof UNRESOLVED_TARGET_REASONS)[number];

export interface UnresolvedRelationshipTarget {
  target: string;
  reason: UnresolvedTargetReason;
}

export function isValidUnresolvedRelationshipTarget(value: unknown): value is UnresolvedRelationshipTarget {
  if (!isPlainObject(value)) return false;
  if (typeof value.target !== 'string' || value.target.length === 0) return false;
  return typeof value.reason === 'string' && (UNRESOLVED_TARGET_REASONS as readonly string[]).includes(value.reason);
}

/**
 * Bounded structured relationship graph for one observation. Existing
 * requests allow at most 20 configured targets, so the pairwise layer is
 * bounded at 20*19/2 = 190 unordered pairs; this contract never traverses
 * arbitrary DOM nodes or derives relationships for unconfigured elements.
 */
export interface LayoutRelationshipGraph {
  observationId: string;
  requestId: string;
  geometryTolerancePx: number;
  targets: string[];
  unresolvedTargets: UnresolvedRelationshipTarget[];
  pairwiseRelationships: PairwiseLayoutRelationship[];
  pageRelationships: PageLevelLayoutRelationship[];
}

export const MAX_CONFIGURED_TARGETS_FOR_RELATIONSHIPS = 20;
export const MAX_PAIRWISE_RELATIONSHIP_PAIRS =
  (MAX_CONFIGURED_TARGETS_FOR_RELATIONSHIPS * (MAX_CONFIGURED_TARGETS_FOR_RELATIONSHIPS - 1)) / 2;

/**
 * A single unordered pair can carry up to one record per independent
 * pairwise relationship family (horizontal-order, vertical-order,
 * area-overlap, relative-width, geometric-fit, vertical-sequence - see
 * `deriveLayoutRelationships` below), never more than one per family per
 * pair. This is the resulting bound on `pairwiseRelationships.length`, not a
 * second target-count configuration.
 */
export const PAIRWISE_RELATIONSHIP_FAMILY_COUNT = 6;
export const MAX_PAIRWISE_RELATIONSHIP_RECORDS = MAX_PAIRWISE_RELATIONSHIP_PAIRS * PAIRWISE_RELATIONSHIP_FAMILY_COUNT;

export function isValidLayoutRelationshipGraph(value: unknown): value is LayoutRelationshipGraph {
  if (!isPlainObject(value)) return false;
  if (typeof value.observationId !== 'string' || value.observationId.length === 0) return false;
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) return false;
  if (typeof value.geometryTolerancePx !== 'number' || !Number.isFinite(value.geometryTolerancePx)) return false;
  if (!Array.isArray(value.targets) || !value.targets.every((t: unknown) => typeof t === 'string' && t.length > 0)) return false;
  if (new Set(value.targets as string[]).size !== (value.targets as string[]).length) return false;
  if (!Array.isArray(value.unresolvedTargets) || !value.unresolvedTargets.every((t: unknown) => isValidUnresolvedRelationshipTarget(t))) return false;
  const targetSet = new Set(value.targets as string[]);
  if ((value.unresolvedTargets as UnresolvedRelationshipTarget[]).some((t) => targetSet.has(t.target))) return false;
  if (!Array.isArray(value.pairwiseRelationships) || !value.pairwiseRelationships.every((r: unknown) => isValidPairwiseLayoutRelationship(r))) return false;
  if ((value.pairwiseRelationships as PairwiseLayoutRelationship[]).length > MAX_PAIRWISE_RELATIONSHIP_RECORDS) return false;
  for (const relationship of value.pairwiseRelationships as PairwiseLayoutRelationship[]) {
    if (!targetSet.has(relationship.subjectTarget) || !targetSet.has(relationship.relatedTarget)) return false;
  }
  if (!Array.isArray(value.pageRelationships) || !value.pageRelationships.every((r: unknown) => isValidPageLevelLayoutRelationship(r))) return false;
  return true;
}

/**
 * Bounded derived clipping concept (docs/PROJECT_MILESTONES.md Milestone 4).
 * `clipped` requires both actual dimensional overflow on that axis AND a
 * computed `overflow` value of `hidden`/`clip` on that axis - `auto`,
 * `scroll`, and `visible` never classify as clipped solely from dimensional
 * overflow. `unavailable` when the underlying overflow/geometry evidence
 * cannot support a conclusion - never guessed.
 */
export const CLIPPING_STATES = ['clipped', 'not-clipped', 'unavailable'] as const;
export type ClippingState = (typeof CLIPPING_STATES)[number];

export const CLIPPING_OVERFLOW_STYLES = ['hidden', 'clip'] as const;
export type ClippingOverflowStyle = (typeof CLIPPING_OVERFLOW_STYLES)[number];

export interface TargetClippingEvidence {
  horizontal: ClippingState;
  vertical: ClippingState;
}

export function isValidTargetClippingEvidence(value: unknown): value is TargetClippingEvidence {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.horizontal === 'string' &&
    (CLIPPING_STATES as readonly string[]).includes(value.horizontal) &&
    typeof value.vertical === 'string' &&
    (CLIPPING_STATES as readonly string[]).includes(value.vertical)
  );
}

/**
 * Pure per-target clipping derivation from one target's own existing
 * `layout`/`style` evidence (never a scroll scenario - normal target
 * evidence already carries `scrollWidth`/`scrollHeight`/`clientWidth`/
 * `clientHeight`/`overflowX`/`overflowY`). `TargetClippingEvidence` has no
 * slot in `LayoutRelationshipGraph` (that graph is spatial/page-level only,
 * per the frozen Batch 1 vocabulary) - this is a standalone per-target
 * derivation for callers (e.g. a later comparison engine) that need it
 * directly from an `ObservationArtifact`'s `targetEvidence`, one target at a
 * time. `unavailable` (never guessed) when the underlying layout/style
 * evidence is not itself available - this naturally covers an unresolved
 * target without any special-casing. A resolved-but-`display:none` target
 * naturally computes `not-clipped` too: its `scrollWidth`/`clientWidth` are
 * both `0`, so `scrollWidth > clientWidth` is false - clipping is never
 * inferred from hidden-ness itself.
 */
export function deriveTargetClipping(record: TargetEvidenceRecord): TargetClippingEvidence {
  const layoutField = record.layout;
  const styleField = record.style;
  if (layoutField.state !== 'available' || styleField.state !== 'available') {
    return { horizontal: 'unavailable', vertical: 'unavailable' };
  }
  const layout = layoutField.value;
  const style = styleField.value;
  const isClippingOverflowStyle = (value: string): boolean => (CLIPPING_OVERFLOW_STYLES as readonly string[]).includes(value);

  const horizontalOverflow = layout.scrollWidth > layout.clientWidth;
  const verticalOverflow = layout.scrollHeight > layout.clientHeight;

  return {
    horizontal: horizontalOverflow && isClippingOverflowStyle(style.overflowX) ? 'clipped' : 'not-clipped',
    vertical: verticalOverflow && isClippingOverflowStyle(style.overflowY) ? 'clipped' : 'not-clipped',
  };
}

// --- deriveLayoutRelationships (v0.4 Batch 2 canonical derivation engine) ----

/**
 * Pure tolerance-aware geometry predicates (Batch 1's frozen rules,
 * verbatim). Every predicate is a total function over exactly one relation
 * family, so it can never itself produce a contradictory pair of values
 * (e.g. `left-of` and `right-of` for the same call) - the caller decides
 * `subject`/`related` once per pair and each family is evaluated exactly
 * once for that fixed direction.
 */
function horizontalOrderOf(a: TargetGeometry, b: TargetGeometry, tolerance: number): HorizontalOrderRelationship {
  if (a.right <= b.x + tolerance) return 'left-of';
  if (b.right <= a.x + tolerance) return 'right-of';
  return 'horizontally-overlapping';
}

function verticalOrderOf(a: TargetGeometry, b: TargetGeometry, tolerance: number): VerticalOrderRelationship {
  if (a.bottom <= b.y + tolerance) return 'above';
  if (b.bottom <= a.y + tolerance) return 'below';
  return 'vertically-overlapping';
}

function areaOverlapOf(a: TargetGeometry, b: TargetGeometry, tolerance: number): AreaOverlapRelationship {
  const overlapWidth = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  return overlapWidth > tolerance && overlapHeight > tolerance ? 'overlaps' : 'does-not-overlap';
}

function relativeWidthOf(a: TargetGeometry, b: TargetGeometry, tolerance: number): RelativeWidthRelationship {
  if (a.width > b.width + tolerance) return 'wider-than';
  if (a.width < b.width - tolerance) return 'narrower-than';
  return 'equal-width-within-tolerance';
}

function geometricFitOf(a: TargetGeometry, b: TargetGeometry, tolerance: number): GeometricFitRelationship {
  const fits = a.x >= b.x - tolerance && a.y >= b.y - tolerance && a.right <= b.right + tolerance && a.bottom <= b.bottom + tolerance;
  return fits ? 'fits-inside' : 'does-not-fit-inside';
}

/**
 * `follows-vertically` is the one family whose vocabulary has a single
 * value (not a total 3-way partition like the others), so it is emitted
 * only when one target's geometry actually precedes the other's - never for
 * both directions, never when they vertically overlap. The direction is
 * decided by actual rendered geometry, not configured target order:
 * `above(x, y)` and "y follows x" share the same tolerance-relative
 * condition, so whichever of the pair is algebraically "above" the other
 * becomes `relatedTarget` and the one that follows becomes `subjectTarget`.
 */
function verticalSequenceOf(
  x: { name: string; geometry: TargetGeometry },
  y: { name: string; geometry: TargetGeometry },
  tolerance: number,
): { subjectTarget: string; relatedTarget: string } | undefined {
  if (x.geometry.bottom <= y.geometry.y + tolerance) return { subjectTarget: y.name, relatedTarget: x.name };
  if (y.geometry.bottom <= x.geometry.y + tolerance) return { subjectTarget: x.name, relatedTarget: y.name };
  return undefined;
}

function geometryEvidence(a: string, b: string): EvidenceReference[] {
  return [{ path: `targetEvidence.${a}.geometry` }, { path: `targetEvidence.${b}.geometry` }];
}

/** Maps a configured target's resolution/visibility evidence to the frozen unresolved-target reason vocabulary - never a fabricated relationship for a target that cannot honestly carry one. */
function classifyUnresolvedTarget(record: TargetEvidenceRecord | undefined): UnresolvedTargetReason {
  if (!record) return 'unavailable';
  const resolutionField = record.resolution;
  if (resolutionField.state === 'available' || resolutionField.state === 'partial') {
    const status = resolutionField.value.selectionStatus;
    if (status === 'not-found') return 'not-found';
    if (status === 'ambiguous') return 'ambiguous';
    if (status === 'unavailable') return 'unavailable';
  }
  return 'unavailable';
}

export type DeriveLayoutRelationshipsOptions = {
  geometryTolerancePx?: number;
};

export type DeriveLayoutRelationshipsResult = { ok: true; graph: LayoutRelationshipGraph } | { ok: false; reason: string };

/**
 * The one canonical pure derivation from an already-captured
 * `ObservationArtifact` to a `LayoutRelationshipGraph` (real Chromium ->
 * ObservationArtifact -> **relationship derivation** -> comparability ->
 * comparison -> ComparisonArtifact, see docs/ARCHITECTURE.md). Deterministic
 * and synchronous: same `observation`/`geometryTolerancePx` in, same graph
 * out, every time - no Chromium, target re-resolution, DOM access, randomness,
 * clock, filesystem, or network involved, and `observation` is never
 * mutated.
 *
 * Scope, by construction:
 * - only targets present in `observation.requestConfig.targets` are ever
 *   considered (bounded at the existing 20-target/190-pair request limit -
 *   never arbitrary DOM/accessibility-tree traversal);
 * - a configured target missing usable geometry (never resolved, or
 *   resolved but reported not-visible) becomes an `unresolvedTargets` entry
 *   with an honest reason, never a fabricated zero-sized relation;
 * - for each unordered pair of geometry-eligible targets, exactly one
 *   record per relationship family is derived, with `subjectTarget`/
 *   `relatedTarget` fixed to that pair's configured order (earlier
 *   configured target is always `subjectTarget`) for every family except
 *   `follows-vertically` (see `verticalSequenceOf`) - so
 *   `pairwiseRelationships.length` never exceeds
 *   `MAX_PAIRWISE_RELATIONSHIP_RECORDS`;
 * - DOM containment is deliberately not re-derived here: it already exists
 *   as `targetEvidence.<name>.containment` on the observation itself (see
 *   `TargetContainment` in domain/schema.ts, explicitly documented there as
 *   "never a layout/relationship graph") and stays separate from
 *   `fits-inside`/`does-not-fit-inside`, which is geometry-only;
 * - the page-width relationship is derived only when both
 *   `pageEvidence.documentWidth` and `pageEvidence.viewportWidth` are
 *   themselves available - never defaulted to "fits" when evidence is
 *   missing.
 */
export function deriveLayoutRelationships(observation: ObservationArtifact, options: DeriveLayoutRelationshipsOptions = {}): DeriveLayoutRelationshipsResult {
  const validation = isValidObservationArtifact(observation);
  if (!validation.valid) {
    return { ok: false, reason: `cannot derive relationships from an invalid ObservationArtifact: ${validation.reason}` };
  }

  const geometryTolerancePx = options.geometryTolerancePx ?? GEOMETRY_TOLERANCE_DEFAULT_PX;
  if (!isValidGeometryTolerancePx(geometryTolerancePx)) {
    return {
      ok: false,
      reason: `geometryTolerancePx must be a finite number in [${GEOMETRY_TOLERANCE_MIN_PX}, ${GEOMETRY_TOLERANCE_MAX_PX}]`,
    };
  }

  const configuredNames = observation.requestConfig.targets.map((target) => target.name);
  if (configuredNames.length > MAX_CONFIGURED_TARGETS_FOR_RELATIONSHIPS) {
    return {
      ok: false,
      reason: `observation.requestConfig.targets has ${configuredNames.length} entries, exceeding the ${MAX_CONFIGURED_TARGETS_FOR_RELATIONSHIPS}-target relationship-derivation bound`,
    };
  }

  const eligible: { name: string; geometry: TargetGeometry }[] = [];
  const unresolvedTargets: UnresolvedRelationshipTarget[] = [];

  for (const name of configuredNames) {
    const record = observation.targetEvidence[name];
    const geometryField = record?.geometry;
    if (!record || geometryField?.state !== 'available') {
      unresolvedTargets.push({ target: name, reason: classifyUnresolvedTarget(record) });
      continue;
    }
    const visibilityField = record.visibility;
    if ((visibilityField.state === 'available' || visibilityField.state === 'partial') && visibilityField.value.visible === false) {
      unresolvedTargets.push({ target: name, reason: 'hidden' });
      continue;
    }
    eligible.push({ name, geometry: geometryField.value });
  }

  const pairwiseRelationships: PairwiseLayoutRelationship[] = [];
  for (let i = 0; i < eligible.length; i += 1) {
    const subject = eligible[i] as { name: string; geometry: TargetGeometry };
    for (let j = i + 1; j < eligible.length; j += 1) {
      const related = eligible[j] as { name: string; geometry: TargetGeometry };
      const evidence = geometryEvidence(subject.name, related.name);

      pairwiseRelationships.push(
        { kind: horizontalOrderOf(subject.geometry, related.geometry, geometryTolerancePx), subjectTarget: subject.name, relatedTarget: related.name, evidence },
        { kind: verticalOrderOf(subject.geometry, related.geometry, geometryTolerancePx), subjectTarget: subject.name, relatedTarget: related.name, evidence },
        { kind: areaOverlapOf(subject.geometry, related.geometry, geometryTolerancePx), subjectTarget: subject.name, relatedTarget: related.name, evidence },
        { kind: relativeWidthOf(subject.geometry, related.geometry, geometryTolerancePx), subjectTarget: subject.name, relatedTarget: related.name, evidence },
        { kind: geometricFitOf(subject.geometry, related.geometry, geometryTolerancePx), subjectTarget: subject.name, relatedTarget: related.name, evidence },
      );

      const sequence = verticalSequenceOf(subject, related, geometryTolerancePx);
      if (sequence) {
        pairwiseRelationships.push({
          kind: 'follows-vertically',
          subjectTarget: sequence.subjectTarget,
          relatedTarget: sequence.relatedTarget,
          evidence: geometryEvidence(sequence.subjectTarget, sequence.relatedTarget),
        });
      }
    }
  }

  const pageRelationships: PageLevelLayoutRelationship[] = [];
  const documentWidthField = observation.pageEvidence.documentWidth;
  const viewportWidthField = observation.pageEvidence.viewportWidth;
  const documentWidth = documentWidthField?.state === 'available' && typeof documentWidthField.value === 'number' ? documentWidthField.value : undefined;
  const viewportWidth = viewportWidthField?.state === 'available' && typeof viewportWidthField.value === 'number' ? viewportWidthField.value : undefined;
  if (documentWidth !== undefined && viewportWidth !== undefined) {
    pageRelationships.push({
      kind: documentWidth <= viewportWidth + geometryTolerancePx ? 'document-width-fits-viewport' : 'document-width-exceeds-viewport',
      evidence: [{ path: 'pageEvidence.documentWidth' }, { path: 'pageEvidence.viewportWidth' }],
    });
  }

  const graph: LayoutRelationshipGraph = {
    observationId: observation.observationId,
    requestId: observation.requestId,
    geometryTolerancePx,
    targets: eligible.map((entry) => entry.name),
    unresolvedTargets,
    pairwiseRelationships,
    pageRelationships,
  };

  return { ok: true, graph };
}
