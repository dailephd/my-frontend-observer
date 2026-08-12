import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { captureViewportInternal } from '../../src/browser/chromiumAdapter.js';
import { buildObservationArtifact } from '../../src/application/observationPersistence.js';
import { deriveLayoutRelationships, isValidLayoutRelationshipGraph } from '../../src/domain/relationships.js';
import type { LayoutRelationshipGraph, PairwiseLayoutRelationship } from '../../src/domain/relationships.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import { startFixtureServer, type FixtureServer, RELATIONSHIPS_FIXTURE_SELECTORS, SCROLL_FIXTURE_SELECTORS } from '../fixtures/server.js';

const VIEWPORT = { width: 800, height: 600 };

function baseRequest(overrides: Partial<NormalizedObservationRequest> = {}): NormalizedObservationRequest {
  return {
    targetUrl: '',
    viewport: VIEWPORT,
    targets: [],
    outputLocation: 'observations',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
    ...overrides,
  };
}

function find(graph: LayoutRelationshipGraph, kind: string, subjectTarget: string, relatedTarget: string): PairwiseLayoutRelationship | undefined {
  return graph.pairwiseRelationships.find((r) => r.kind === kind && r.subjectTarget === subjectTarget && r.relatedTarget === relatedTarget);
}

describe('v0.4 Batch 2: deriveLayoutRelationships against a real ObservationArtifact', () => {
  let fixtures: FixtureServer;

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  it('derives the full expected relationship family from a real deterministic layout', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/relationships`,
      targets: [
        { name: 'navigation', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.navigation }] },
        { name: 'workspace', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.workspace }] },
        { name: 'rightRegion', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.rightRegion }] },
        { name: 'footer', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.footer }] },
      ],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error(`expected ok derivation: ${derived.reason}`);
    const graph = derived.graph;

    expect(isValidLayoutRelationshipGraph(graph)).toBe(true);
    expect(graph.observationId).toBe(observation.observationId);
    expect(graph.requestId).toBe(observation.requestId);
    expect(graph.unresolvedTargets).toEqual([]);

    expect(find(graph, 'left-of', 'navigation', 'workspace')).toBeDefined();
    expect(find(graph, 'left-of', 'workspace', 'rightRegion')).toBeDefined();
    expect(find(graph, 'does-not-overlap', 'navigation', 'workspace')).toBeDefined();
    expect(find(graph, 'does-not-overlap', 'workspace', 'rightRegion')).toBeDefined();
    // "navigation" is configured before "workspace", so subjectTarget=navigation for this pair/family.
    expect(find(graph, 'narrower-than', 'navigation', 'workspace')).toBeDefined();
    expect(find(graph, 'follows-vertically', 'footer', 'workspace')).toBeDefined();

    expect(graph.pageRelationships).toEqual([
      { kind: 'document-width-fits-viewport', evidence: [{ path: 'pageEvidence.documentWidth' }, { path: 'pageEvidence.viewportWidth' }] },
    ]);
  });

  it('derives real area overlap between two overlapping configured targets', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/relationships`,
      targets: [
        { name: 'overlapA', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.overlapA }] },
        { name: 'overlapB', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.overlapB }] },
      ],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('expected ok derivation');
    const graph = derived.graph;

    expect(find(graph, 'overlaps', 'overlapA', 'overlapB')).toBeDefined();
    expect(find(graph, 'does-not-overlap', 'overlapA', 'overlapB')).toBeUndefined();
    expect(find(graph, 'horizontally-overlapping', 'overlapA', 'overlapB')).toBeDefined();
    expect(find(graph, 'vertically-overlapping', 'overlapA', 'overlapB')).toBeDefined();
  });

  it('a DOM-contained child that visually escapes its parent: real containment true, real geometric fit false', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/relationships`,
      targets: [
        { name: 'escapeChild', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.escapeChild }] },
        { name: 'escapeParent', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.escapeParent }] },
      ],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const containment = observation.targetEvidence.escapeChild?.containment;
    expect(containment?.state).toBe('available');
    if (containment?.state === 'available') {
      expect(containment.value.containedByTargetIds).toContain('escapeParent');
    }

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('expected ok derivation');
    expect(find(derived.graph, 'does-not-fit-inside', 'escapeChild', 'escapeParent')).toBeDefined();
  });

  it('a geometric fit between DOM-unrelated siblings: real fit true, real containment false', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/relationships`,
      targets: [
        { name: 'innerUnrelated', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.innerUnrelated }] },
        { name: 'outerUnrelated', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.outerUnrelated }] },
      ],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const containment = observation.targetEvidence.innerUnrelated?.containment;
    expect(containment?.state).toBe('available');
    if (containment?.state === 'available') {
      expect(containment.value.containedByTargetIds).toEqual([]);
    }

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('expected ok derivation');
    expect(find(derived.graph, 'fits-inside', 'innerUnrelated', 'outerUnrelated')).toBeDefined();
  });

  it('a DOM-contained, geometrically-fitting child: both containment and fit are true (no forced divergence)', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/relationships`,
      targets: [
        { name: 'workspaceChild', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.workspaceChild }] },
        { name: 'workspace', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.workspace }] },
      ],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const containment = observation.targetEvidence.workspaceChild?.containment;
    expect(containment?.state).toBe('available');
    if (containment?.state === 'available') {
      expect(containment.value.containedByTargetIds).toContain('workspace');
    }

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('expected ok derivation');
    expect(find(derived.graph, 'fits-inside', 'workspaceChild', 'workspace')).toBeDefined();
  });

  it('real page-width-exceeds-viewport evidence from the existing v0.3 horizontal-overflow fixture', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'aboveTarget', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.aboveTarget }] }],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('expected ok derivation');
    expect(derived.graph.pageRelationships).toEqual([
      { kind: 'document-width-exceeds-viewport', evidence: [{ path: 'pageEvidence.documentWidth' }, { path: 'pageEvidence.viewportWidth' }] },
    ]);
  });

  it('handles a real unresolved (not-found) configured target honestly, without blocking other relationships', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/relationships`,
      targets: [
        { name: 'navigation', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.navigation }] },
        { name: 'workspace', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.workspace }] },
        { name: 'missing', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.missingTarget }] },
      ],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('expected ok derivation');
    expect(derived.graph.unresolvedTargets).toEqual([{ target: 'missing', reason: 'not-found' }]);
    expect(find(derived.graph, 'left-of', 'navigation', 'workspace')).toBeDefined();
  });

  it('handles a real ambiguous configured target honestly, without a fabricated geometry', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/relationships`,
      targets: [
        { name: 'navigation', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.navigation }] },
        { name: 'duplicate', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.duplicateTarget }] },
      ],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('expected ok derivation');
    expect(derived.graph.unresolvedTargets).toEqual([{ target: 'duplicate', reason: 'ambiguous' }]);
    expect(derived.graph.targets).toEqual(['navigation']);
  });

  it('handles a real hidden (display:none) configured target honestly, never as a zero-sized visible region', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/relationships`,
      targets: [
        { name: 'navigation', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.navigation }] },
        { name: 'hidden', locators: [{ kind: 'css', selector: RELATIONSHIPS_FIXTURE_SELECTORS.hiddenTarget }] },
      ],
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok capture');
    const observation = buildObservationArtifact(result, request);

    const derived = deriveLayoutRelationships(observation);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('expected ok derivation');
    expect(derived.graph.unresolvedTargets).toEqual([{ target: 'hidden', reason: 'hidden' }]);
    expect(derived.graph.targets).toEqual(['navigation']);
  });
});
