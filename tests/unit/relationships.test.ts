import { describe, expect, it } from 'vitest';
import {
  HORIZONTAL_ORDER_RELATIONSHIPS,
  VERTICAL_ORDER_RELATIONSHIPS,
  AREA_OVERLAP_RELATIONSHIPS,
  RELATIVE_WIDTH_RELATIONSHIPS,
  GEOMETRIC_FIT_RELATIONSHIPS,
  VERTICAL_SEQUENCE_RELATIONSHIPS,
  PAGE_WIDTH_RELATIONSHIPS,
  MAX_PAIRWISE_RELATIONSHIP_RECORDS,
  isValidPairwiseLayoutRelationship,
  isValidPageLevelLayoutRelationship,
  isValidLayoutRelationshipGraph,
  isValidTargetClippingEvidence,
} from '../../src/domain/relationships.js';
import type { LayoutRelationshipGraph, PairwiseLayoutRelationship } from '../../src/domain/relationships.js';

function baseGraph(overrides: Partial<LayoutRelationshipGraph> = {}): LayoutRelationshipGraph {
  return {
    observationId: 'obs-1',
    requestId: 'req-1',
    geometryTolerancePx: 0.5,
    targets: ['navigation', 'workspace'],
    unresolvedTargets: [],
    pairwiseRelationships: [],
    pageRelationships: [],
    ...overrides,
  };
}

describe('pairwise relationship vocabulary', () => {
  it('accepts every frozen relationship kind', () => {
    const kinds = [
      ...HORIZONTAL_ORDER_RELATIONSHIPS,
      ...VERTICAL_ORDER_RELATIONSHIPS,
      ...AREA_OVERLAP_RELATIONSHIPS,
      ...RELATIVE_WIDTH_RELATIONSHIPS,
      ...GEOMETRIC_FIT_RELATIONSHIPS,
      ...VERTICAL_SEQUENCE_RELATIONSHIPS,
    ];
    for (const kind of kinds) {
      const relationship: PairwiseLayoutRelationship = {
        kind,
        subjectTarget: 'navigation',
        relatedTarget: 'workspace',
        evidence: [{ path: 'targetEvidence.navigation.geometry' }],
      };
      expect(isValidPairwiseLayoutRelationship(relationship)).toBe(true);
    }
  });

  it('rejects an unsupported relationship kind', () => {
    expect(
      isValidPairwiseLayoutRelationship({
        kind: 'diagonal-of',
        subjectTarget: 'navigation',
        relatedTarget: 'workspace',
        evidence: [],
      }),
    ).toBe(false);
  });

  it('rejects a relationship whose subject and related target are the same', () => {
    expect(
      isValidPairwiseLayoutRelationship({
        kind: 'left-of',
        subjectTarget: 'navigation',
        relatedTarget: 'navigation',
        evidence: [],
      }),
    ).toBe(false);
  });

  it('rejects a relationship with an evidence entry missing a path', () => {
    expect(
      isValidPairwiseLayoutRelationship({
        kind: 'left-of',
        subjectTarget: 'navigation',
        relatedTarget: 'workspace',
        evidence: [{}],
      }),
    ).toBe(false);
  });
});

describe('page-level relationship vocabulary', () => {
  it('accepts every frozen page-width relationship kind', () => {
    for (const kind of PAGE_WIDTH_RELATIONSHIPS) {
      expect(isValidPageLevelLayoutRelationship({ kind, evidence: [] })).toBe(true);
    }
  });

  it('rejects an unsupported page-level kind', () => {
    expect(isValidPageLevelLayoutRelationship({ kind: 'document-height-exceeds-viewport', evidence: [] })).toBe(false);
  });
});

describe('isValidLayoutRelationshipGraph', () => {
  it('accepts a minimal empty graph', () => {
    expect(isValidLayoutRelationshipGraph(baseGraph())).toBe(true);
  });

  it('accepts a graph with pairwise and page relationships referencing configured targets', () => {
    const graph = baseGraph({
      pairwiseRelationships: [{ kind: 'left-of', subjectTarget: 'navigation', relatedTarget: 'workspace', evidence: [{ path: 'x' }] }],
      pageRelationships: [{ kind: 'document-width-fits-viewport', evidence: [{ path: 'pageEvidence.documentSize' }] }],
    });
    expect(isValidLayoutRelationshipGraph(graph)).toBe(true);
  });

  it('rejects a pairwise relationship referencing an unconfigured target', () => {
    const graph = baseGraph({
      pairwiseRelationships: [{ kind: 'left-of', subjectTarget: 'navigation', relatedTarget: 'sidebar', evidence: [] }],
    });
    expect(isValidLayoutRelationshipGraph(graph)).toBe(false);
  });

  it('rejects an unresolved target that is also listed as a resolved target', () => {
    const graph = baseGraph({ unresolvedTargets: [{ target: 'navigation', reason: 'not-found' }] });
    expect(isValidLayoutRelationshipGraph(graph)).toBe(false);
  });

  it('rejects duplicate target names', () => {
    const graph = baseGraph({ targets: ['navigation', 'navigation'] });
    expect(isValidLayoutRelationshipGraph(graph)).toBe(false);
  });

  it('rejects a non-finite geometryTolerancePx', () => {
    expect(isValidLayoutRelationshipGraph(baseGraph({ geometryTolerancePx: Number.NaN }))).toBe(false);
  });

  it('rejects more pairwise relationships than the 1140-record bound (190 pairs * 6 families) allows', () => {
    const targets = Array.from({ length: 2 }, (_, i) => `t${i}`);
    const relationships = Array.from({ length: MAX_PAIRWISE_RELATIONSHIP_RECORDS + 1 }, () => ({
      kind: 'left-of' as const,
      subjectTarget: 't0',
      relatedTarget: 't1',
      evidence: [],
    }));
    expect(isValidLayoutRelationshipGraph(baseGraph({ targets, pairwiseRelationships: relationships }))).toBe(false);
  });
});

describe('isValidTargetClippingEvidence', () => {
  it('accepts every combination of clipped/not-clipped/unavailable', () => {
    const states = ['clipped', 'not-clipped', 'unavailable'] as const;
    for (const horizontal of states) {
      for (const vertical of states) {
        expect(isValidTargetClippingEvidence({ horizontal, vertical })).toBe(true);
      }
    }
  });

  it('rejects an unsupported clipping state', () => {
    expect(isValidTargetClippingEvidence({ horizontal: 'auto', vertical: 'not-clipped' })).toBe(false);
  });
});
