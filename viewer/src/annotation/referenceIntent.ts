import type { VisualAnnotationIntent, VisualAnnotationInterpretation, VisualAnnotationItem } from '../types/visualAnnotation.js';
import type {
  ReferenceRegion,
  ReferenceRegionRelationship,
  ReferenceRequirementTolerance,
  RegionMeasurementRequirementSubject,
  RegionPropertyRequirementSubject,
  RawReferenceRequirement,
} from '../types/reference.js';
import { withdrawChangedConfirmation } from './confirmation.js';

// v0.9 Batch 5: confirmation helpers moved to the shared ./confirmation.ts (behavior unchanged).
export { confirmCandidate } from './confirmation.js';

/**
 * v0.9 Batch 4: pure, presentation-side model for external-reference
 * annotation intent. It only builds the canonical Prompt 1 structures
 * (`reference-region`, `reference-requirement`, `inspect`,
 * `asset-sensitive`) from explicit user choices, and keeps a confirmed
 * interpretation honest when its meaning changes. It never infers intent,
 * never derives relationships or measurements, and never materializes a
 * reference. The server/domain validators remain the final authority.
 */

/** Mirrors the canonical `REFERENCE_REGION_ID_PATTERN` (the server still validates). */
export const REFERENCE_REGION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Mirrors the canonical `MAX_REFERENCE_REGIONS` (the server still validates). */
export const MAX_REFERENCE_REGIONS = 20;

export const REQUIREMENT_CATEGORIES = ['requested', 'expected-dependent', 'protected', 'preserved'] as const satisfies readonly RawReferenceRequirement['category'][];
export const EXPECTED_DEPENDENT_MODES = ['required', 'permitted'] as const satisfies readonly NonNullable<RawReferenceRequirement['expectedDependentMode']>[];
export const REGION_PROPERTIES = ['x', 'y', 'width', 'height', 'right', 'bottom', 'centerX', 'centerY'] as const satisfies readonly RegionPropertyRequirementSubject['property'][];
export const REGION_MEASUREMENTS = ['vertical-gap', 'horizontal-gap', 'center-x-delta', 'center-y-delta', 'left-edge-delta', 'right-edge-delta'] as const satisfies readonly RegionMeasurementRequirementSubject['measurement'][];
export const TOLERANCE_KINDS = ['exact', 'absolute-reference-px', 'percent'] as const satisfies readonly ReferenceRequirementTolerance['kind'][];

type ReferenceRegionIntent = Extract<VisualAnnotationIntent, { kind: 'reference-region' }>;

export function candidate(intent: VisualAnnotationIntent): VisualAnnotationInterpretation {
  return { state: 'candidate', intent };
}

function withInterpretation(item: VisualAnnotationItem, interpretation: VisualAnnotationInterpretation): VisualAnnotationItem {
  return { ...item, interpretation };
}

// --- regions ------------------------------------------------------------------------

export function regionIntentOf(item: VisualAnnotationItem): ReferenceRegionIntent | undefined {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted' || interpretation.intent.kind !== 'reference-region') return undefined;
  return interpretation.intent;
}

/** Region ids proposed by other items' `reference-region/create` intents, compared case-insensitively. */
function otherCreateIds(items: readonly VisualAnnotationItem[], selfItemId: string): string[] {
  return items.filter((item) => item.annotationItemId !== selfItemId).flatMap((item) => {
    const intent = regionIntentOf(item);
    return intent !== undefined && intent.mode === 'create' ? [intent.region.id] : [];
  });
}

/**
 * Immediate UI checks for a proposed new region id. Never rewrites or
 * lowercases the id and never proposes a replacement. Returns a reason when
 * the candidate cannot be created, otherwise undefined.
 */
export function regionCreateBlockedReason(proposedId: string, sourceRegions: readonly ReferenceRegion[], items: readonly VisualAnnotationItem[], selfItemId: string): string | undefined {
  const others = otherCreateIds(items, selfItemId);
  if (sourceRegions.length + new Set(others.map((id) => id.toLowerCase())).size >= MAX_REFERENCE_REGIONS) {
    return `A new region is unavailable: the reference already has the maximum of ${MAX_REFERENCE_REGIONS} regions (including other candidate creates). Refinement is still available.`;
  }
  if (proposedId.length === 0) return 'Enter a proposed region ID.';
  if (!REFERENCE_REGION_ID_PATTERN.test(proposedId)) return 'Region IDs use only letters, digits, underscore, and hyphen (up to 64 characters).';
  const lower = proposedId.toLowerCase();
  if (sourceRegions.some((region) => region.id.toLowerCase() === lower)) return `Region "${proposedId}" already exists in the source reference (IDs are compared case-insensitively). Use Refine selected region instead.`;
  if (others.some((id) => id.toLowerCase() === lower)) return `Another draft item already proposes region "${proposedId}" (IDs are compared case-insensitively).`;
  return undefined;
}

/** A candidate new region from a rectangle mark's exact geometry. Returns undefined for any other mark kind. */
export function withRegionCreateCandidate(item: VisualAnnotationItem, regionId: string): VisualAnnotationItem | undefined {
  if (item.mark.kind !== 'rectangle') return undefined;
  const { x, y, width, height } = item.mark;
  return withInterpretation(item, candidate({ kind: 'reference-region', mode: 'create', region: { id: regionId, rectangle: { x, y, width, height } } }));
}

/** A candidate refinement of an explicitly selected existing region, plus the explicit association to that region. */
export function withRegionRefineCandidate(item: VisualAnnotationItem, regionId: string): VisualAnnotationItem | undefined {
  if (item.mark.kind !== 'rectangle') return undefined;
  const { x, y, width, height } = item.mark;
  return {
    ...withInterpretation(item, candidate({ kind: 'reference-region', mode: 'refine', region: { id: regionId, rectangle: { x, y, width, height } } })),
    association: { kind: 'reference-region', regionId },
  };
}

/** Keeps a region intent's rectangle identical to its rectangle mark, so the visual mark and the structured proposal never drift. */
export function syncRegionGeometry(item: VisualAnnotationItem): VisualAnnotationItem {
  const intent = regionIntentOf(item);
  if (intent === undefined || item.mark.kind !== 'rectangle' || item.interpretation.state === 'uninterpreted') return item;
  const { x, y, width, height } = item.mark;
  const current = intent.region.rectangle;
  if (current.x === x && current.y === y && current.width === width && current.height === height) return item;
  return withInterpretation(item, { ...item.interpretation, intent: { ...intent, region: { id: intent.region.id, rectangle: { x, y, width, height } } } });
}

export interface CandidateRegionSummary {
  sourceRegions: number;
  candidateCreates: number;
  candidateRefinements: number;
}

export function candidateRegionSummary(sourceRegions: readonly ReferenceRegion[], items: readonly VisualAnnotationItem[]): CandidateRegionSummary {
  const intents = items.map(regionIntentOf).filter((intent): intent is ReferenceRegionIntent => intent !== undefined);
  return { sourceRegions: sourceRegions.length, candidateCreates: intents.filter((i) => i.mode === 'create').length, candidateRefinements: intents.filter((i) => i.mode === 'refine').length };
}

/** Region ids a requirement may name explicitly: existing source regions plus ids already proposed by draft region intents (deduplicated case-insensitively, first spelling kept). */
export function requirementRegionIds(sourceRegions: readonly ReferenceRegion[], items: readonly VisualAnnotationItem[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of [...sourceRegions.map((r) => r.id), ...items.map(regionIntentOf).flatMap((intent) => (intent === undefined ? [] : [intent.region.id]))]) {
    if (seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    ids.push(id);
  }
  return ids;
}

// --- informational and asset-sensitive ------------------------------------------------

export function withInformationalCandidate(item: VisualAnnotationItem): VisualAnnotationItem {
  return withInterpretation(item, candidate({ kind: 'inspect' }));
}

export function withAssetSensitiveCandidate(item: VisualAnnotationItem, regionId?: string): VisualAnnotationItem {
  return withInterpretation(item, candidate(regionId === undefined ? { kind: 'asset-sensitive' } : { kind: 'asset-sensitive', regionId }));
}

// --- requirements -----------------------------------------------------------------------

export interface RequirementForm {
  category: RawReferenceRequirement['category'] | '';
  expectedDependentMode: NonNullable<RawReferenceRequirement['expectedDependentMode']> | '';
  subjectKind: 'region-property' | 'region-relationship' | 'region-measurement' | '';
  region: string;
  property: RegionPropertyRequirementSubject['property'] | '';
  /** Index into the canonical `regionRelationships.pairwiseRelationships` list. */
  relationshipIndex: string;
  subjectRegion: string;
  relatedRegion: string;
  measurement: RegionMeasurementRequirementSubject['measurement'] | '';
  toleranceKind: ReferenceRequirementTolerance['kind'] | '';
  toleranceAmount: string;
}

export const EMPTY_REQUIREMENT_FORM: RequirementForm = {
  category: '',
  expectedDependentMode: '',
  subjectKind: '',
  region: '',
  property: '',
  relationshipIndex: '',
  subjectRegion: '',
  relatedRegion: '',
  measurement: '',
  toleranceKind: '',
  toleranceAmount: '',
};

export type BuildRequirementResult = { ok: true; requirement: RawReferenceRequirement } | { ok: false; reason: string };

function buildTolerance(form: RequirementForm): { ok: true; tolerance: ReferenceRequirementTolerance } | { ok: false; reason: string } {
  if (form.toleranceKind === '') return { ok: false, reason: 'Choose a tolerance.' };
  if (form.toleranceKind === 'exact') return { ok: true, tolerance: { kind: 'exact' } };
  const trimmed = form.toleranceAmount.trim();
  const amount = trimmed.length === 0 ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) return { ok: false, reason: 'Tolerance amount must be a finite number from 0 to 100.' };
  return { ok: true, tolerance: { kind: form.toleranceKind, amount } };
}

/**
 * Builds one canonical-shaped `RawReferenceRequirement` from explicit form
 * choices. A relationship subject must be one of the server's canonical
 * derived relationships (by index), so a relationship involving a candidate
 * region can never be fabricated. Measurement values are never computed or
 * stored here.
 */
export function buildRequirementFromForm(form: RequirementForm, knownRegionIds: readonly string[], relationships: readonly ReferenceRegionRelationship[]): BuildRequirementResult {
  if (form.category === '') return { ok: false, reason: 'Choose a requirement category.' };
  if (form.category === 'expected-dependent' && form.expectedDependentMode === '') return { ok: false, reason: 'Expected-dependent requirements need a mode: required or permitted.' };
  const modePart = form.category === 'expected-dependent' && form.expectedDependentMode !== '' ? { expectedDependentMode: form.expectedDependentMode } : {};
  const known = new Set(knownRegionIds);

  switch (form.subjectKind) {
    case 'region-property': {
      if (!known.has(form.region)) return { ok: false, reason: 'Choose an existing or candidate region.' };
      if (form.property === '') return { ok: false, reason: 'Choose a region property.' };
      const tolerance = buildTolerance(form);
      if (!tolerance.ok) return tolerance;
      return { ok: true, requirement: { category: form.category, ...modePart, subject: { kind: 'region-property', region: form.region, property: form.property }, tolerance: tolerance.tolerance } };
    }
    case 'region-relationship': {
      const relationship = form.relationshipIndex === '' ? undefined : relationships[Number(form.relationshipIndex)];
      if (relationship === undefined) return { ok: false, reason: 'Choose a canonical derived region relationship.' };
      return {
        ok: true,
        requirement: {
          category: form.category,
          ...modePart,
          subject: { kind: 'region-relationship', subjectRegion: relationship.subjectRegion, relatedRegion: relationship.relatedRegion, relationship: relationship.kind },
        },
      };
    }
    case 'region-measurement': {
      if (!known.has(form.subjectRegion) || !known.has(form.relatedRegion)) return { ok: false, reason: 'Choose two existing or candidate regions.' };
      if (form.subjectRegion === form.relatedRegion) return { ok: false, reason: 'A measurement needs two distinct regions.' };
      if (form.measurement === '') return { ok: false, reason: 'Choose a measurement.' };
      const tolerance = buildTolerance(form);
      if (!tolerance.ok) return tolerance;
      return {
        ok: true,
        requirement: { category: form.category, ...modePart, subject: { kind: 'region-measurement', subjectRegion: form.subjectRegion, relatedRegion: form.relatedRegion, measurement: form.measurement }, tolerance: tolerance.tolerance },
      };
    }
    default:
      return { ok: false, reason: 'Choose a requirement subject kind.' };
  }
}

export function withRequirementCandidate(item: VisualAnnotationItem, requirement: RawReferenceRequirement): VisualAnnotationItem {
  return withInterpretation(item, candidate({ kind: 'reference-requirement', requirement }));
}

// --- confirmation -----------------------------------------------------------------------

/**
 * Applies one draft edit to a reference annotation item. Region proposals
 * follow their rectangle's geometry. If the item was confirmed and the edit
 * changed its meaning (mark, association, or intent), the confirmation is
 * withdrawn: the intent is kept as a candidate and `confirmedAt` is removed.
 */
export function applyReferenceItemEdit(item: VisualAnnotationItem, edit: (item: VisualAnnotationItem) => VisualAnnotationItem): VisualAnnotationItem {
  return withdrawChangedConfirmation(item, syncRegionGeometry(edit(item)));
}

// --- v0.9 Batch 6 materialization eligibility ----------------------------------------

export const INFORMATIONAL_NOT_MATERIALIZED_REASON = 'Informational annotation intent is not materialized into the external-reference contract.';

export type ReferenceMaterializationStatus = { materializable: true } | { materializable: false; reason: string };

/** Item kinds shown in the materialization section: reference intent plus informational intent (shown disabled). */
export function isReferenceMaterializationListItem(item: VisualAnnotationItem): boolean {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted') return false;
  const { kind } = interpretation.intent;
  return kind === 'reference-region' || kind === 'reference-requirement' || kind === 'inspect' || kind === 'asset-sensitive';
}

/**
 * Presentation-side materialization eligibility for the reference panel. The
 * server's canonical materialization service repeats these checks, composes
 * the final region and requirement sets, and remains authoritative.
 */
export function referenceMaterializationStatus(item: VisualAnnotationItem): ReferenceMaterializationStatus {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted') return { materializable: false, reason: 'No interpretation.' };
  const { kind } = interpretation.intent;
  if (kind === 'inspect' || kind === 'asset-sensitive') return { materializable: false, reason: INFORMATIONAL_NOT_MATERIALIZED_REASON };
  if (kind !== 'reference-region' && kind !== 'reference-requirement') return { materializable: false, reason: 'Not external-reference intent.' };
  if (interpretation.state === 'candidate') return { materializable: false, reason: 'Candidate intent must be confirmed before materialization.' };
  return { materializable: true };
}
