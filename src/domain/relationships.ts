/**
 * v0.4 Batch 1 layout-relationship contract. Frozen here as pure
 * types/constants/structural validators only - no derivation from real
 * observation evidence happens in this batch (see docs/ROADMAP.md v0.4 /
 * docs/PROJECT_MILESTONES.md Milestone 4). Batch 2 owns
 * `deriveLayoutRelationships(observation)`.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if ((value.pairwiseRelationships as PairwiseLayoutRelationship[]).length > MAX_PAIRWISE_RELATIONSHIP_PAIRS) return false;
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
