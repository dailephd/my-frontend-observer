/**
 * v0.7 Prompt 2 reference-region relationship derivation. Reuses the exact
 * same pure, tolerance-aware geometry predicates that
 * domain/relationships.ts#deriveLayoutRelationships uses for runtime
 * targets (horizontalOrderOf/verticalOrderOf/areaOverlapOf/relativeWidthOf/
 * geometricFitOf/verticalSequenceOf, and the PairwiseRelationshipKind
 * vocabulary/EvidenceReference type) - never a duplicated or reinterpreted
 * copy of those formulas. Only the six geometry-only families apply here;
 * DOM containment, scroll ownership, runtime visibility, and page-width-vs-
 * viewport are runtime/browser concepts with no reference-image equivalent
 * and are deliberately not reused (see docs/CONTRACTS.md).
 *
 * A reference relationship is a fact about the reference image's geometry
 * only. It is never a design requirement, never a pass/fail verdict, and
 * never claims a runtime target or source owner exists - those are later
 * v0.7 prompts.
 */
import type { PairwiseRelationshipKind, EvidenceReference } from './relationships.js';
import {
  PAIRWISE_RELATIONSHIP_KINDS,
  isValidEvidenceReference,
  horizontalOrderOf,
  verticalOrderOf,
  areaOverlapOf,
  relativeWidthOf,
  geometricFitOf,
  verticalSequenceOf,
} from './relationships.js';
import type { ReferenceRegion } from './externalReferenceRegions.js';
import { deriveReferenceRegionGeometry, MAX_REFERENCE_REGIONS } from './externalReferenceRegions.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Same bound-derivation shape as relationships.ts's MAX_PAIRWISE_RELATIONSHIP_PAIRS/RECORDS, over MAX_REFERENCE_REGIONS instead of the runtime-target limit - this is a maximum capacity, never a required minimum region count. */
export const MAX_REFERENCE_REGION_PAIRS = (MAX_REFERENCE_REGIONS * (MAX_REFERENCE_REGIONS - 1)) / 2;
export const REFERENCE_REGION_RELATIONSHIP_FAMILY_COUNT = 6;
export const MAX_REFERENCE_REGION_RELATIONSHIP_RECORDS = MAX_REFERENCE_REGION_PAIRS * REFERENCE_REGION_RELATIONSHIP_FAMILY_COUNT;

/** One derived spatial relationship between two reference regions - subjectRegion/relatedRegion are region ids, deliberately named distinctly from PairwiseLayoutRelationship's subjectTarget/relatedTarget so a reference relationship can never be mistaken for a runtime-target relationship at the type level. */
export interface ReferenceRegionRelationship {
  kind: PairwiseRelationshipKind;
  subjectRegion: string;
  relatedRegion: string;
  evidence: EvidenceReference[];
}

export function isValidReferenceRegionRelationship(value: unknown): value is ReferenceRegionRelationship {
  if (!isPlainObject(value)) return false;
  if (typeof value.kind !== 'string' || !(PAIRWISE_RELATIONSHIP_KINDS as readonly string[]).includes(value.kind)) return false;
  if (typeof value.subjectRegion !== 'string' || value.subjectRegion.length === 0) return false;
  if (typeof value.relatedRegion !== 'string' || value.relatedRegion.length === 0) return false;
  if (value.subjectRegion === value.relatedRegion) return false;
  return Array.isArray(value.evidence) && value.evidence.every((entry: unknown) => isValidEvidenceReference(entry));
}

/** Bounded structured relationship graph for one reference's region set - never persisted (see externalReference.ts), always re-derivable on demand from the artifact's own `regions` field. */
export interface ReferenceRegionRelationshipGraph {
  referenceRequestId: string;
  geometryTolerancePx: number;
  regions: string[];
  pairwiseRelationships: ReferenceRegionRelationship[];
}

export function isValidReferenceRegionRelationshipGraph(value: unknown): value is ReferenceRegionRelationshipGraph {
  if (!isPlainObject(value)) return false;
  if (typeof value.referenceRequestId !== 'string' || value.referenceRequestId.length === 0) return false;
  if (typeof value.geometryTolerancePx !== 'number' || !Number.isFinite(value.geometryTolerancePx)) return false;
  if (!Array.isArray(value.regions) || !value.regions.every((r: unknown) => typeof r === 'string' && r.length > 0)) return false;
  if (new Set(value.regions as string[]).size !== (value.regions as string[]).length) return false;
  const regionSet = new Set(value.regions as string[]);
  if (!Array.isArray(value.pairwiseRelationships) || !value.pairwiseRelationships.every((r: unknown) => isValidReferenceRegionRelationship(r))) return false;
  if ((value.pairwiseRelationships as ReferenceRegionRelationship[]).length > MAX_REFERENCE_REGION_RELATIONSHIP_RECORDS) return false;
  for (const relationship of value.pairwiseRelationships as ReferenceRegionRelationship[]) {
    if (!regionSet.has(relationship.subjectRegion) || !regionSet.has(relationship.relatedRegion)) return false;
  }
  return true;
}

function regionGeometryEvidence(a: string, b: string): EvidenceReference[] {
  return [{ path: `regions.${a}.rectangle` }, { path: `regions.${b}.rectangle` }];
}

export interface DeriveReferenceRegionRelationshipsOptions {
  geometryTolerancePx?: number;
}

export type DeriveReferenceRegionRelationshipsResult = { ok: true; graph: ReferenceRegionRelationshipGraph } | { ok: false; reason: string };

/**
 * The one canonical pure derivation from an authored region set to a
 * ReferenceRegionRelationshipGraph - deterministic and synchronous: same
 * `regions`/`geometryTolerancePx` in, same graph out, every time. Mirrors
 * `deriveLayoutRelationships`'s pairwise-loop shape exactly (earlier
 * authored region is always `subjectRegion` for every family except
 * `follows-vertically`, whose direction is decided by actual geometry) but
 * has no `unresolvedTargets`/`pageRelationships` concept: every authored
 * region that reaches this function has already passed
 * `isValidReferenceRegions`, so there is no "could not resolve" case, and a
 * static image has no page/viewport to derive a page-level relationship
 * from.
 */
export function deriveReferenceRegionRelationships(
  referenceRequestId: string,
  regions: readonly ReferenceRegion[],
  options: DeriveReferenceRegionRelationshipsOptions = {},
): DeriveReferenceRegionRelationshipsResult {
  if (regions.length > MAX_REFERENCE_REGIONS) {
    return { ok: false, reason: `regions has ${regions.length} entries, exceeding the ${MAX_REFERENCE_REGIONS}-region relationship-derivation bound` };
  }
  const geometryTolerancePx = options.geometryTolerancePx ?? 0.5;
  if (!Number.isFinite(geometryTolerancePx) || geometryTolerancePx < 0) {
    return { ok: false, reason: 'geometryTolerancePx must be a non-negative finite number' };
  }

  const entries = regions.map((region) => ({ name: region.id, geometry: deriveReferenceRegionGeometry(region.rectangle) }));

  const pairwiseRelationships: ReferenceRegionRelationship[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const subject = entries[i]!;
    for (let j = i + 1; j < entries.length; j += 1) {
      const related = entries[j]!;
      const evidence = regionGeometryEvidence(subject.name, related.name);

      pairwiseRelationships.push(
        { kind: horizontalOrderOf(subject.geometry, related.geometry, geometryTolerancePx), subjectRegion: subject.name, relatedRegion: related.name, evidence },
        { kind: verticalOrderOf(subject.geometry, related.geometry, geometryTolerancePx), subjectRegion: subject.name, relatedRegion: related.name, evidence },
        { kind: areaOverlapOf(subject.geometry, related.geometry, geometryTolerancePx), subjectRegion: subject.name, relatedRegion: related.name, evidence },
        { kind: relativeWidthOf(subject.geometry, related.geometry, geometryTolerancePx), subjectRegion: subject.name, relatedRegion: related.name, evidence },
        { kind: geometricFitOf(subject.geometry, related.geometry, geometryTolerancePx), subjectRegion: subject.name, relatedRegion: related.name, evidence },
      );

      const sequence = verticalSequenceOf(subject, related, geometryTolerancePx);
      if (sequence) {
        pairwiseRelationships.push({
          kind: 'follows-vertically',
          subjectRegion: sequence.subjectTarget,
          relatedRegion: sequence.relatedTarget,
          evidence: regionGeometryEvidence(sequence.subjectTarget, sequence.relatedTarget),
        });
      }
    }
  }

  return {
    ok: true,
    graph: {
      referenceRequestId,
      geometryTolerancePx,
      regions: entries.map((entry) => entry.name),
      pairwiseRelationships,
    },
  };
}
