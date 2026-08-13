import { describe, expect, it } from 'vitest';
import { deriveLayoutRelationships, deriveTargetClipping, isValidLayoutRelationshipGraph, GEOMETRY_TOLERANCE_DEFAULT_PX } from '../../src/domain/relationships.js';
import type { LayoutRelationshipGraph, PairwiseLayoutRelationship } from '../../src/domain/relationships.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type {
  ObservationArtifact,
  TargetEvidenceRecord,
  TargetGeometry,
  TargetLayoutMetrics,
  TargetComputedStyle,
  TargetResolution,
} from '../../src/domain/schema.js';
import type { EvidenceField } from '../../src/domain/evidence.js';

function rect(x: number, y: number, width: number, height: number): TargetGeometry {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function matchedResolution(): TargetResolution {
  return {
    selectionMethod: 'ordered-locators',
    selectionStatus: 'matched',
    selectedLocatorKind: 'css',
    selectedLocatorIndex: 0,
    usedFallback: false,
    confidence: 'exact',
    attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'matched', matchCount: 1 }],
  };
}

function unresolvedResolution(status: 'not-found' | 'ambiguous' | 'unavailable'): TargetResolution {
  return { selectionMethod: 'ordered-locators', selectionStatus: status, usedFallback: false, confidence: 'none', attempts: [] };
}

interface MatchedTargetOptions {
  visible?: boolean;
  layout?: TargetLayoutMetrics;
  style?: TargetComputedStyle;
  containedByTargetIds?: string[];
  evaluatedTargetIds?: string[];
}

function matchedTarget(geometry: TargetGeometry, options: MatchedTargetOptions = {}): TargetEvidenceRecord {
  const visible = options.visible ?? true;
  return {
    resolution: { state: 'available', source: 'derived', value: matchedResolution(), derivedFrom: ['locator-attempts'] },
    tag: { state: 'available', source: 'browser', value: 'div' },
    geometry: { state: 'available', source: 'browser', value: geometry },
    style: {
      state: 'available',
      source: 'computed-browser',
      value: options.style ?? { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' },
    },
    layout: {
      state: 'available',
      source: 'browser',
      value: options.layout ?? {
        scrollWidth: geometry.width,
        scrollHeight: geometry.height,
        clientWidth: geometry.width,
        clientHeight: geometry.height,
        scrollTop: 0,
        scrollLeft: 0,
      },
    },
    visibility: { state: 'available', source: 'derived', value: { visible }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: {
      state: 'available',
      source: 'browser',
      value: {
        containedByTargetIds: options.containedByTargetIds ?? [],
        evaluatedTargetIds: options.evaluatedTargetIds ?? [],
        unresolvedTargetIds: [],
      },
    },
  };
}

function unresolvedTarget(status: 'not-found' | 'ambiguous' | 'unavailable'): TargetEvidenceRecord {
  const reason = `target ${status}`;
  return {
    resolution: { state: 'available', source: 'derived', value: unresolvedResolution(status), derivedFrom: ['locator-attempts'] },
    tag: { state: 'unavailable', reason },
    geometry: { state: 'unavailable', reason },
    style: { state: 'unavailable', reason },
    layout: { state: 'unavailable', reason },
    visibility: { state: 'unavailable', reason },
    semantics: { state: 'unavailable', reason },
    semanticState: { state: 'unavailable', reason },
    landmark: { state: 'unavailable', reason },
    containment: { state: 'unavailable', reason },
  };
}

function baseObservation(overrides: Partial<ObservationArtifact> = {}): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: 'obs-1',
    requestId: 'req-1',
    producer: { name: PRODUCER_NAME, version: '0.3.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '1.0' } },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport: { width: 800, height: 600 },
      targets: [],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence: {},
    screenshot: { state: 'not-applicable' },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [],
    ...overrides,
  };
}

function observationWithTargets(entries: Record<string, TargetEvidenceRecord>, pageEvidence: Record<string, EvidenceField<unknown>> = {}): ObservationArtifact {
  return baseObservation({
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport: { width: 800, height: 600 },
      targets: Object.keys(entries).map((name) => ({ name, locators: [{ kind: 'css', selector: `#${name}` }] })),
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    },
    targetEvidence: entries,
    pageEvidence,
  });
}

function requireOk(result: ReturnType<typeof deriveLayoutRelationships>): LayoutRelationshipGraph {
  if (!result.ok) throw new Error(`expected ok result, got: ${result.reason}`);
  return result.graph;
}

function find(graph: LayoutRelationshipGraph, kind: string, subjectTarget: string, relatedTarget: string): PairwiseLayoutRelationship | undefined {
  return graph.pairwiseRelationships.find((r) => r.kind === kind && r.subjectTarget === subjectTarget && r.relatedTarget === relatedTarget);
}

describe('deriveLayoutRelationships: input validation', () => {
  it('rejects a structurally invalid ObservationArtifact', () => {
    const result = deriveLayoutRelationships({ not: 'an observation' } as unknown as ObservationArtifact);
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range geometryTolerancePx option', () => {
    const observation = observationWithTargets({});
    expect(deriveLayoutRelationships(observation, { geometryTolerancePx: 11 }).ok).toBe(false);
    expect(deriveLayoutRelationships(observation, { geometryTolerancePx: Number.NaN }).ok).toBe(false);
  });

  it('defaults geometryTolerancePx to 0.5 when omitted', () => {
    const observation = observationWithTargets({ a: matchedTarget(rect(0, 0, 10, 10)) });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(graph.geometryTolerancePx).toBe(GEOMETRY_TOLERANCE_DEFAULT_PX);
  });

  it('preserves the source observationId and requestId', () => {
    const observation = observationWithTargets({}, {});
    const graph = requireOk(deriveLayoutRelationships({ ...observation, observationId: 'obs-xyz', requestId: 'req-xyz' }));
    expect(graph.observationId).toBe('obs-xyz');
    expect(graph.requestId).toBe('req-xyz');
  });

  it('produces a graph satisfying the frozen structural validator', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 50)),
      b: matchedTarget(rect(150, 0, 100, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(isValidLayoutRelationshipGraph(graph)).toBe(true);
  });
});

describe('deriveLayoutRelationships: horizontal ordering', () => {
  it('derives left-of/right-of with a gap', () => {
    const observation = observationWithTargets({
      nav: matchedTarget(rect(0, 0, 100, 50)),
      workspace: matchedTarget(rect(150, 0, 200, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'left-of', 'nav', 'workspace')).toBeDefined();
  });

  it('derives horizontally-overlapping when neither separation rule holds', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 50)),
      b: matchedTarget(rect(50, 0, 100, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'horizontally-overlapping', 'a', 'b')).toBeDefined();
  });

  it('flips to right-of when configured order is reversed relative to geometry', () => {
    const observation = observationWithTargets({
      workspace: matchedTarget(rect(150, 0, 200, 50)),
      nav: matchedTarget(rect(0, 0, 100, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'right-of', 'workspace', 'nav')).toBeDefined();
  });
});

describe('deriveLayoutRelationships: vertical ordering', () => {
  it('derives above/below with a gap', () => {
    const observation = observationWithTargets({
      header: matchedTarget(rect(0, 0, 100, 50)),
      body: matchedTarget(rect(0, 100, 100, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'above', 'header', 'body')).toBeDefined();
  });

  it('derives vertically-overlapping when neither separation rule holds', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 50, 100)),
      b: matchedTarget(rect(0, 50, 50, 100)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'vertically-overlapping', 'a', 'b')).toBeDefined();
  });
});

describe('deriveLayoutRelationships: area overlap', () => {
  it('derives overlaps for real rectangle intersection', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 100)),
      b: matchedTarget(rect(50, 50, 100, 100)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'overlaps', 'a', 'b')).toBeDefined();
    expect(find(graph, 'does-not-overlap', 'a', 'b')).toBeUndefined();
  });

  it('does not treat exact edge touch as overlap', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 100)),
      b: matchedTarget(rect(100, 0, 100, 100)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation, { geometryTolerancePx: 0 }));
    expect(find(graph, 'does-not-overlap', 'a', 'b')).toBeDefined();
  });

  it('sub-tolerance overlap is treated as noise (does-not-overlap)', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100.2, 100)),
      b: matchedTarget(rect(100, 0, 100, 100)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation, { geometryTolerancePx: 0.5 }));
    expect(find(graph, 'does-not-overlap', 'a', 'b')).toBeDefined();
  });
});

describe('deriveLayoutRelationships: relative width', () => {
  it('derives wider-than/narrower-than', () => {
    const observation = observationWithTargets({
      workspace: matchedTarget(rect(0, 0, 400, 50)),
      nav: matchedTarget(rect(0, 100, 140, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'wider-than', 'workspace', 'nav')).toBeDefined();
  });

  it('derives equal-width-within-tolerance', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 50)),
      b: matchedTarget(rect(0, 100, 100.3, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation, { geometryTolerancePx: 0.5 }));
    expect(find(graph, 'equal-width-within-tolerance', 'a', 'b')).toBeDefined();
  });
});

describe('deriveLayoutRelationships: geometric fit vs DOM containment', () => {
  it('a DOM-contained child that visually escapes its parent: containment true, fit false', () => {
    const observation = observationWithTargets({
      child: matchedTarget(rect(-10, -10, 100, 60), { containedByTargetIds: ['parent'], evaluatedTargetIds: ['parent'] }),
      parent: matchedTarget(rect(0, 0, 60, 20), { evaluatedTargetIds: ['child'] }),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'does-not-fit-inside', 'child', 'parent')).toBeDefined();
    expect(observation.targetEvidence.child?.containment).toMatchObject({ value: { containedByTargetIds: ['parent'] } });
  });

  it('a geometric fit with no DOM relationship: fit true, containment false', () => {
    const observation = observationWithTargets({
      inner: matchedTarget(rect(20, 10, 50, 50), { evaluatedTargetIds: ['outer'] }),
      outer: matchedTarget(rect(0, 0, 200, 100), { evaluatedTargetIds: ['inner'] }),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'fits-inside', 'inner', 'outer')).toBeDefined();
    expect(observation.targetEvidence.inner?.containment).toMatchObject({ value: { containedByTargetIds: [] } });
  });

  it('geometric fit is directional: A fits B does not imply B fits A', () => {
    const observation = observationWithTargets({
      inner: matchedTarget(rect(20, 10, 50, 50)),
      outer: matchedTarget(rect(0, 0, 200, 100)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(find(graph, 'fits-inside', 'inner', 'outer')).toBeDefined();
    // Only one directional record exists for this pair/family - the reverse fact
    // (outer inside inner) is never separately asserted.
    expect(graph.pairwiseRelationships.filter((r) => r.kind === 'fits-inside' || r.kind === 'does-not-fit-inside')).toHaveLength(1);
  });
});

describe('deriveLayoutRelationships: vertical sequencing', () => {
  it('derives follows-vertically at the boundary (exactly equal to tolerance)', () => {
    const observation = observationWithTargets({
      workspace: matchedTarget(rect(0, 0, 400, 400)),
      footer: matchedTarget(rect(0, 399.5, 400, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation, { geometryTolerancePx: 0.5 }));
    expect(find(graph, 'follows-vertically', 'footer', 'workspace')).toBeDefined();
  });

  it('does not emit follows-vertically when targets vertically overlap', () => {
    const observation = observationWithTargets({
      workspace: matchedTarget(rect(0, 0, 400, 400)),
      footer: matchedTarget(rect(0, 300, 400, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation, { geometryTolerancePx: 0.5 }));
    expect(graph.pairwiseRelationships.some((r) => r.kind === 'follows-vertically')).toBe(false);
  });

  it('just beyond tolerance still resolves to a normal above/below pair without contradiction', () => {
    const observation = observationWithTargets({
      workspace: matchedTarget(rect(0, 0, 400, 400)),
      footer: matchedTarget(rect(0, 400.6, 400, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation, { geometryTolerancePx: 0.5 }));
    expect(find(graph, 'follows-vertically', 'footer', 'workspace')).toBeDefined();
    expect(find(graph, 'above', 'workspace', 'footer')).toBeDefined();
  });
});

describe('deriveLayoutRelationships: page-width relationship', () => {
  it('derives document-width-fits-viewport when equal within tolerance', () => {
    const observation = observationWithTargets(
      {},
      {
        documentWidth: { state: 'available', source: 'derived', value: 800, derivedFrom: ['documentScrollWidth', 'documentClientWidth'] },
        viewportWidth: { state: 'available', source: 'browser', value: 800 },
      },
    );
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(graph.pageRelationships).toEqual([
      { kind: 'document-width-fits-viewport', evidence: [{ path: 'pageEvidence.documentWidth' }, { path: 'pageEvidence.viewportWidth' }] },
    ]);
  });

  it('derives document-width-exceeds-viewport when it exceeds beyond tolerance', () => {
    const observation = observationWithTargets(
      {},
      {
        documentWidth: { state: 'available', source: 'derived', value: 3000, derivedFrom: ['documentScrollWidth', 'documentClientWidth'] },
        viewportWidth: { state: 'available', source: 'browser', value: 800 },
      },
    );
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(graph.pageRelationships[0]?.kind).toBe('document-width-exceeds-viewport');
  });

  it('omits the page-width relationship (never defaults to "fits") when evidence is unavailable', () => {
    const observation = observationWithTargets({}, { documentWidth: { state: 'unavailable', reason: 'x' } });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(graph.pageRelationships).toEqual([]);
  });
});

describe('deriveLayoutRelationships: unresolved targets', () => {
  it('a not-found target is listed as unresolved and does not block relationships among resolved targets', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 50)),
      missing: unresolvedTarget('not-found'),
      b: matchedTarget(rect(150, 0, 100, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(graph.unresolvedTargets).toEqual([{ target: 'missing', reason: 'not-found' }]);
    expect(find(graph, 'left-of', 'a', 'b')).toBeDefined();
    expect(graph.pairwiseRelationships.some((r) => r.subjectTarget === 'missing' || r.relatedTarget === 'missing')).toBe(false);
  });

  it('an ambiguous target is listed as unresolved without fabricated geometry', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 50)),
      dup: unresolvedTarget('ambiguous'),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(graph.unresolvedTargets).toEqual([{ target: 'dup', reason: 'ambiguous' }]);
  });

  it('a resolved-but-not-visible target is listed as unresolved with reason "hidden", never as a zero-sized region', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 50)),
      hidden: matchedTarget(rect(0, 0, 0, 0), { visible: false }),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(graph.unresolvedTargets).toEqual([{ target: 'hidden', reason: 'hidden' }]);
    expect(graph.targets).toEqual(['a']);
  });

  it('an unavailable target (evaluation failure) is listed as unresolved', () => {
    const observation = observationWithTargets({ broken: unresolvedTarget('unavailable') });
    const graph = requireOk(deriveLayoutRelationships(observation));
    expect(graph.unresolvedTargets).toEqual([{ target: 'broken', reason: 'unavailable' }]);
  });
});

describe('deriveLayoutRelationships: evidence references', () => {
  it('every geometry-derived relation references both targets geometry fields', () => {
    const observation = observationWithTargets({
      nav: matchedTarget(rect(0, 0, 100, 50)),
      workspace: matchedTarget(rect(150, 0, 200, 50)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    const relation = find(graph, 'left-of', 'nav', 'workspace');
    expect(relation?.evidence).toEqual([{ path: 'targetEvidence.nav.geometry' }, { path: 'targetEvidence.workspace.geometry' }]);
  });
});

describe('deriveLayoutRelationships: contradiction prevention', () => {
  it('a pair never carries both directions of the same family', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 100)),
      b: matchedTarget(rect(150, 20, 80, 60)),
    });
    const graph = requireOk(deriveLayoutRelationships(observation));
    const families: Record<string, string[]> = {
      horizontal: ['left-of', 'right-of', 'horizontally-overlapping'],
      vertical: ['above', 'below', 'vertically-overlapping'],
      overlap: ['overlaps', 'does-not-overlap'],
      width: ['wider-than', 'narrower-than', 'equal-width-within-tolerance'],
      fit: ['fits-inside', 'does-not-fit-inside'],
    };
    for (const kinds of Object.values(families)) {
      const matches = graph.pairwiseRelationships.filter((r) => kinds.includes(r.kind));
      expect(matches.length).toBe(1);
    }
  });
});

describe('deriveLayoutRelationships: floating-point geometry', () => {
  it('operates in exact floating-point CSS-pixel space, no implicit rounding', () => {
    const observation = observationWithTargets({
      a: matchedTarget(rect(0, 0, 99.75, 50)),
      b: matchedTarget(rect(100.1, 0, 50, 50)),
    });
    const graphTight = requireOk(deriveLayoutRelationships(observation, { geometryTolerancePx: 0 }));
    // a.right = 99.75, b.x = 100.1 -> gap 0.35, left-of holds even at zero tolerance.
    expect(find(graphTight, 'left-of', 'a', 'b')).toBeDefined();

    const observation2 = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100.49, 50)),
      b: matchedTarget(rect(100.51, 0, 50, 50)),
    });
    const graphZero = requireOk(deriveLayoutRelationships(observation2, { geometryTolerancePx: 0 }));
    expect(find(graphZero, 'left-of', 'a', 'b')).toBeDefined();
    const graphNegativeGapAsOverlap = requireOk(
      deriveLayoutRelationships(
        observationWithTargets({
          a: matchedTarget(rect(0, 0, 100.6, 50)),
          b: matchedTarget(rect(100.51, 0, 50, 50)),
        }),
        { geometryTolerancePx: 0 },
      ),
    );
    expect(find(graphNegativeGapAsOverlap, 'horizontally-overlapping', 'a', 'b')).toBeDefined();
  });
});

describe('deriveLayoutRelationships: determinism and immutability', () => {
  function sampleObservation(): ObservationArtifact {
    return observationWithTargets(
      {
        nav: matchedTarget(rect(0, 0, 140, 40)),
        workspace: matchedTarget(rect(150, 0, 400, 400)),
        footer: matchedTarget(rect(0, 450, 400, 50)),
      },
      {
        documentWidth: { state: 'available', source: 'derived', value: 800, derivedFrom: ['documentScrollWidth', 'documentClientWidth'] },
        viewportWidth: { state: 'available', source: 'browser', value: 800 },
      },
    );
  }

  it('produces a deep-equal graph across repeated calls with the same input', () => {
    const observation = sampleObservation();
    const first = requireOk(deriveLayoutRelationships(observation));
    const second = requireOk(deriveLayoutRelationships(observation));
    expect(first).toEqual(second);
  });

  it('never mutates the input ObservationArtifact', () => {
    const observation = sampleObservation();
    const before = JSON.parse(JSON.stringify(observation)) as unknown;
    deriveLayoutRelationships(observation);
    const after = JSON.parse(JSON.stringify(observation)) as unknown;
    expect(after).toEqual(before);
  });
});

describe('deriveLayoutRelationships: tolerance boundaries', () => {
  it('0px tolerance: exact edge touch still counts as left-of, any overlap does not', () => {
    const boundary = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100, 50)),
      b: matchedTarget(rect(100, 0, 50, 50)),
    });
    const graphBoundary = requireOk(deriveLayoutRelationships(boundary, { geometryTolerancePx: 0 }));
    expect(find(graphBoundary, 'left-of', 'a', 'b')).toBeDefined();

    const overlapping = observationWithTargets({
      a: matchedTarget(rect(0, 0, 100.1, 50)),
      b: matchedTarget(rect(100, 0, 50, 50)),
    });
    const graphOverlapping = requireOk(deriveLayoutRelationships(overlapping, { geometryTolerancePx: 0 }));
    expect(find(graphOverlapping, 'horizontally-overlapping', 'a', 'b')).toBeDefined();
  });

  it('10px (maximum) tolerance absorbs up to a 10px overlap as left-of, but not 10.1px', () => {
    // a.right = 110, b.x = 100: a and b overlap by exactly 10px.
    const overlapAtMax = observationWithTargets({
      a: matchedTarget(rect(0, 0, 110, 50)),
      b: matchedTarget(rect(100, 0, 50, 50)),
    });
    const graphAtMax = requireOk(deriveLayoutRelationships(overlapAtMax, { geometryTolerancePx: 10 }));
    expect(find(graphAtMax, 'left-of', 'a', 'b')).toBeDefined();

    // a.right = 110.1, b.x = 100: overlap of 10.1px exceeds the 10px tolerance.
    const beyondMax = observationWithTargets({
      a: matchedTarget(rect(0, 0, 110.1, 50)),
      b: matchedTarget(rect(100, 0, 50, 50)),
    });
    const graphBeyondMax = requireOk(deriveLayoutRelationships(beyondMax, { geometryTolerancePx: 10 }));
    expect(find(graphBeyondMax, 'horizontally-overlapping', 'a', 'b')).toBeDefined();
  });
});

describe('deriveTargetClipping', () => {
  it('is not-clipped on an axis with no dimensional overflow, regardless of overflow style', () => {
    const target = matchedTarget(rect(0, 0, 100, 100), {
      layout: { scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 },
      style: { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'hidden' },
    });
    expect(deriveTargetClipping(target)).toEqual({ horizontal: 'not-clipped', vertical: 'not-clipped' });
  });

  it('is clipped only when dimensional overflow AND a clipping overflow style (hidden/clip) both hold', () => {
    const target = matchedTarget(rect(0, 0, 100, 100), {
      layout: { scrollWidth: 300, scrollHeight: 300, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 },
      style: { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'clip' },
    });
    expect(deriveTargetClipping(target)).toEqual({ horizontal: 'clipped', vertical: 'clipped' });
  });

  it('does not classify overflow:auto or overflow:scroll as clipped, even with real dimensional overflow', () => {
    const autoTarget = matchedTarget(rect(0, 0, 100, 100), {
      layout: { scrollWidth: 300, scrollHeight: 300, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 },
      style: { display: 'block', position: 'static', overflowX: 'auto', overflowY: 'scroll' },
    });
    expect(deriveTargetClipping(autoTarget)).toEqual({ horizontal: 'not-clipped', vertical: 'not-clipped' });

    const visibleTarget = matchedTarget(rect(0, 0, 100, 100), {
      layout: { scrollWidth: 300, scrollHeight: 300, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 },
      style: { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' },
    });
    expect(deriveTargetClipping(visibleTarget)).toEqual({ horizontal: 'not-clipped', vertical: 'not-clipped' });
  });

  it('is unavailable (never guessed) when the underlying layout/style evidence is not itself available', () => {
    const target = unresolvedTarget('not-found');
    expect(deriveTargetClipping(target)).toEqual({ horizontal: 'unavailable', vertical: 'unavailable' });
  });

  it('a display:none target naturally computes not-clipped, never clipped, from its own zeroed metrics', () => {
    const target = matchedTarget(rect(0, 0, 0, 0), {
      visible: false,
      layout: { scrollWidth: 0, scrollHeight: 0, clientWidth: 0, clientHeight: 0, scrollTop: 0, scrollLeft: 0 },
      style: { display: 'none', position: 'static', overflowX: 'hidden', overflowY: 'hidden' },
    });
    expect(deriveTargetClipping(target)).toEqual({ horizontal: 'not-clipped', vertical: 'not-clipped' });
  });

  it('supports independent horizontal/vertical clipping axes', () => {
    const target = matchedTarget(rect(0, 0, 100, 100), {
      layout: { scrollWidth: 300, scrollHeight: 100, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 },
      style: { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' },
    });
    expect(deriveTargetClipping(target)).toEqual({ horizontal: 'clipped', vertical: 'not-clipped' });
  });
});
