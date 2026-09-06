import { describe, expect, it } from 'vitest';
import {
  deriveReferenceRegionRelationships,
  isValidReferenceRegionRelationshipGraph,
  MAX_REFERENCE_REGION_RELATIONSHIP_RECORDS,
} from '../../src/domain/externalReferenceRegionRelationships.js';
import { MAX_REFERENCE_REGIONS } from '../../src/domain/externalReferenceRegions.js';
import type { ReferenceRegion } from '../../src/domain/externalReferenceRegions.js';

function region(id: string, x: number, y: number, width: number, height: number): ReferenceRegion {
  return { id, rectangle: { x, y, width, height } };
}

function relationshipsOfKind(result: ReturnType<typeof deriveReferenceRegionRelationships>, kind: string) {
  if (!result.ok) throw new Error('expected ok result');
  return result.graph.pairwiseRelationships.filter((r) => r.kind === kind);
}

describe('externalReferenceRegionRelationships', () => {
  // Behavior L: A entirely left of B -> canonical horizontal-order relationship.
  it('derives left-of/right-of for horizontally separated regions', () => {
    const result = deriveReferenceRegionRelationships('req-1', [region('a', 0, 0, 50, 50), region('b', 100, 0, 50, 50)]);
    if (!result.ok) throw new Error('expected ok result');
    expect(relationshipsOfKind(result, 'left-of')).toEqual([{ kind: 'left-of', subjectRegion: 'a', relatedRegion: 'b', evidence: [{ path: 'regions.a.rectangle' }, { path: 'regions.b.rectangle' }] }]);
  });

  // Behavior M: A above B -> canonical vertical-order relationship.
  it('derives above/below for vertically separated regions', () => {
    const result = deriveReferenceRegionRelationships('req-1', [region('header', 0, 0, 100, 40), region('card', 0, 92, 100, 40)]);
    if (!result.ok) throw new Error('expected ok result');
    const above = relationshipsOfKind(result, 'above');
    expect(above).toEqual([{ kind: 'above', subjectRegion: 'header', relatedRegion: 'card', evidence: expect.any(Array) }]);
  });

  // Behavior N: overlap evidence.
  it('derives overlaps for two overlapping regions and does-not-overlap for two separated regions', () => {
    const overlapping = deriveReferenceRegionRelationships('req-1', [region('a', 0, 0, 50, 50), region('b', 25, 25, 50, 50)]);
    expect(relationshipsOfKind(overlapping, 'overlaps')).toHaveLength(1);

    const separated = deriveReferenceRegionRelationships('req-1', [region('a', 0, 0, 50, 50), region('b', 200, 200, 50, 50)]);
    expect(relationshipsOfKind(separated, 'does-not-overlap')).toHaveLength(1);
  });

  // Behavior O: existing relative-width semantic family reused.
  it('derives wider-than/narrower-than/equal-width-within-tolerance', () => {
    const wider = deriveReferenceRegionRelationships('req-1', [region('a', 0, 0, 200, 10), region('b', 0, 100, 50, 10)]);
    expect(relationshipsOfKind(wider, 'wider-than')).toHaveLength(1);

    const equal = deriveReferenceRegionRelationships('req-1', [region('a', 0, 0, 100, 10), region('b', 0, 100, 100, 10)]);
    expect(relationshipsOfKind(equal, 'equal-width-within-tolerance')).toHaveLength(1);
  });

  // Behavior P: geometric fit is geometry-only, never a DOM containment claim (no such field exists on the relationship type at all).
  it('derives fits-inside for a region fully contained in another, geometry-only', () => {
    const result = deriveReferenceRegionRelationships('req-1', [region('inner', 10, 10, 20, 20), region('outer', 0, 0, 100, 100)]);
    if (!result.ok) throw new Error('expected ok result');
    const fits = result.graph.pairwiseRelationships.find((r) => r.kind === 'fits-inside');
    expect(fits).toBeDefined();
    expect(fits).not.toHaveProperty('domContainment');
    expect(Object.keys(fits!).sort()).toEqual(['evidence', 'kind', 'relatedRegion', 'subjectRegion']);
  });

  it('derives follows-vertically directed by actual geometry, not authored order', () => {
    // "card" is authored first but is actually below "header" in geometry.
    const result = deriveReferenceRegionRelationships('req-1', [region('card', 0, 92, 100, 40), region('header', 0, 0, 100, 40)]);
    if (!result.ok) throw new Error('expected ok result');
    const sequence = result.graph.pairwiseRelationships.find((r) => r.kind === 'follows-vertically');
    expect(sequence).toEqual({ kind: 'follows-vertically', subjectRegion: 'card', relatedRegion: 'header', evidence: expect.any(Array) });
  });

  // Behavior Q: deterministic relationships - same input, same output/ordering.
  it('produces identical output and ordering for the same input across repeated calls', () => {
    const regions = [region('a', 0, 0, 50, 50), region('b', 60, 0, 50, 50), region('c', 0, 60, 50, 50)];
    const first = deriveReferenceRegionRelationships('req-1', regions);
    const second = deriveReferenceRegionRelationships('req-1', regions);
    expect(first).toEqual(second);
  });

  // Reference relationships never claim runtime/browser or DOM-containment provenance.
  it('relationship evidence paths reference region geometry, never targetEvidence/browser paths', () => {
    const result = deriveReferenceRegionRelationships('req-1', [region('a', 0, 0, 50, 50), region('b', 100, 0, 50, 50)]);
    if (!result.ok) throw new Error('expected ok result');
    for (const relationship of result.graph.pairwiseRelationships) {
      for (const evidence of relationship.evidence) {
        expect(evidence.path.startsWith('regions.')).toBe(true);
        expect(evidence.path.includes('targetEvidence')).toBe(false);
      }
    }
  });

  // Pair-count bound: exactly MAX_REFERENCE_REGIONS accepted, one more rejected.
  it('accepts exactly MAX_REFERENCE_REGIONS and rejects one over, bounding relationship record count', () => {
    const maxRegions = Array.from({ length: MAX_REFERENCE_REGIONS }, (_, i) => region(`r${i}`, i * 10, 0, 5, 5));
    const atMax = deriveReferenceRegionRelationships('req-1', maxRegions);
    expect(atMax.ok).toBe(true);
    if (atMax.ok) expect(atMax.graph.pairwiseRelationships.length).toBeLessThanOrEqual(MAX_REFERENCE_REGION_RELATIONSHIP_RECORDS);

    const overMax = [...maxRegions, region('one-more', 1000, 0, 5, 5)];
    const overResult = deriveReferenceRegionRelationships('req-1', overMax);
    expect(overResult.ok).toBe(false);
  });

  it('rejects an invalid geometryTolerancePx', () => {
    const result = deriveReferenceRegionRelationships('req-1', [region('a', 0, 0, 10, 10)], { geometryTolerancePx: -1 });
    expect(result.ok).toBe(false);
  });

  it('a single region produces no pairwise relationships', () => {
    const result = deriveReferenceRegionRelationships('req-1', [region('only', 0, 0, 10, 10)]);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.graph.pairwiseRelationships).toEqual([]);
    expect(result.graph.regions).toEqual(['only']);
  });

  it('never mutates the input regions array', () => {
    const regions = [region('a', 0, 0, 50, 50), region('b', 100, 0, 50, 50)];
    const snapshot = JSON.parse(JSON.stringify(regions));
    deriveReferenceRegionRelationships('req-1', regions);
    expect(regions).toEqual(snapshot);
  });

  it('isValidReferenceRegionRelationshipGraph accepts a derived graph and rejects a malformed one', () => {
    const result = deriveReferenceRegionRelationships('req-1', [region('a', 0, 0, 50, 50), region('b', 100, 0, 50, 50)]);
    if (!result.ok) throw new Error('expected ok result');
    expect(isValidReferenceRegionRelationshipGraph(result.graph)).toBe(true);
    expect(isValidReferenceRegionRelationshipGraph({ ...result.graph, regions: ['a'] })).toBe(false); // relatedRegion "b" not in regions list
  });
});
