import { describe, expect, it } from 'vitest';
import {
  deriveViewportRelation,
  deriveOverflowEvidence,
  deriveTargetScrollTransition,
  deriveScrollScenarioTransition,
  deriveScrollOwner,
} from '../../src/domain/scrollEvidence.js';
import type { TargetGeometry, ScrollableMetrics, TargetScrollRuntimeState, ScrollRuntimeSnapshot, ViewportRelationEvidence } from '../../src/domain/schema.js';

const VIEWPORT = { width: 800, height: 600 };

function rect(overrides: Partial<TargetGeometry> = {}): TargetGeometry {
  return { x: 0, y: 0, width: 100, height: 50, right: 100, bottom: 50, ...overrides };
}

function metrics(overrides: Partial<ScrollableMetrics> = {}): ScrollableMetrics {
  return { scrollTop: 0, scrollLeft: 0, scrollWidth: 800, scrollHeight: 600, clientWidth: 800, clientHeight: 600, ...overrides };
}

describe('deriveViewportRelation', () => {
  it('classifies a target entirely above the viewport', () => {
    const relation = deriveViewportRelation(rect({ y: -100, bottom: -50 }), VIEWPORT);
    expect(relation).toEqual({ vertical: 'above', intersectsViewport: false, fullyWithinViewport: false });
  });

  it('classifies a target entirely below the viewport', () => {
    const relation = deriveViewportRelation(rect({ y: 700, bottom: 750 }), VIEWPORT);
    expect(relation).toEqual({ vertical: 'below', intersectsViewport: false, fullyWithinViewport: false });
  });

  it('classifies a target fully within the viewport as intersecting and fully within', () => {
    const relation = deriveViewportRelation(rect({ x: 10, y: 10, width: 50, height: 50, right: 60, bottom: 60 }), VIEWPORT);
    expect(relation).toEqual({ vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true });
  });

  it('classifies a target straddling the bottom edge as intersecting but not fully within', () => {
    const relation = deriveViewportRelation(rect({ x: 10, y: 580, width: 50, height: 100, right: 60, bottom: 680 }), VIEWPORT);
    expect(relation).toEqual({ vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: false });
  });

  it('does not conflate a horizontally offscreen target with above/below', () => {
    const relation = deriveViewportRelation(rect({ x: 900, y: 10, width: 50, height: 50, right: 950, bottom: 60 }), VIEWPORT);
    expect(relation.vertical).toBe('intersecting');
    expect(relation.intersectsViewport).toBe(false);
  });
});

describe('deriveOverflowEvidence', () => {
  it('reports no actual overflow when scroll and client dimensions are equal, even with a scrolling declaration', () => {
    const overflow = deriveOverflowEvidence(metrics({ scrollWidth: 200, clientWidth: 200, scrollHeight: 100, clientHeight: 100 }), 'auto', 'scroll');
    expect(overflow).toEqual({ horizontalOverflow: false, verticalOverflow: false, overflowX: 'auto', overflowY: 'scroll' });
  });

  it('reports actual overflow when scroll dimensions exceed client dimensions', () => {
    const overflow = deriveOverflowEvidence(metrics({ scrollWidth: 3000, clientWidth: 800, scrollHeight: 3000, clientHeight: 600 }), 'visible', 'visible');
    expect(overflow.horizontalOverflow).toBe(true);
    expect(overflow.verticalOverflow).toBe(true);
  });
});

function targetState(metricsValue: ScrollableMetrics, rectValue: TargetGeometry, relation: ViewportRelationEvidence): TargetScrollRuntimeState {
  return {
    metrics: { state: 'available', source: 'browser', value: metricsValue },
    overflow: { state: 'available', source: 'computed-browser', value: { horizontalOverflow: false, verticalOverflow: false, overflowX: 'visible', overflowY: 'visible' } },
    boundingRect: { state: 'available', source: 'browser', value: rectValue },
    viewportRelation: { state: 'available', source: 'derived', value: relation, derivedFrom: ['boundingRect', 'viewport'] },
  };
}

function unavailableTargetState(reason: string): TargetScrollRuntimeState {
  return {
    metrics: { state: 'unavailable', reason },
    overflow: { state: 'unavailable', reason },
    boundingRect: { state: 'unavailable', reason },
    viewportRelation: { state: 'unavailable', reason },
  };
}

describe('deriveTargetScrollTransition', () => {
  it('reports enteredViewport when a target moves from below to intersecting', () => {
    const initial = targetState(metrics(), rect({ y: 1400, bottom: 1450 }), { vertical: 'below', intersectsViewport: false, fullyWithinViewport: false });
    const final = targetState(metrics(), rect({ y: 400, bottom: 450 }), { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true });
    const transition = deriveTargetScrollTransition(initial, final);
    expect(transition?.enteredViewport).toBe(true);
    expect(transition?.leftViewport).toBe(false);
    expect(transition?.boundingRectPosition).toEqual({ before: { x: 0, y: 1400 }, after: { x: 0, y: 400 }, changed: true });
  });

  it('reports leftViewport when a target moves from intersecting to above', () => {
    const initial = targetState(metrics(), rect({ y: 20, bottom: 70 }), { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true });
    const final = targetState(metrics(), rect({ y: -980, bottom: -930 }), { vertical: 'above', intersectsViewport: false, fullyWithinViewport: false });
    const transition = deriveTargetScrollTransition(initial, final);
    expect(transition?.leftViewport).toBe(true);
    expect(transition?.enteredViewport).toBe(false);
  });

  it('reports no change when nothing moved', () => {
    const state = targetState(metrics(), rect({ y: 20, bottom: 70 }), { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true });
    const transition = deriveTargetScrollTransition(state, state);
    expect(transition?.enteredViewport).toBe(false);
    expect(transition?.leftViewport).toBe(false);
    expect(transition?.boundingRectPosition.changed).toBe(false);
    expect(transition?.scrollTop.changed).toBe(false);
  });

  it('returns undefined (never fabricated zeros) when either snapshot lacks usable evidence for the target', () => {
    const good = targetState(metrics(), rect(), { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true });
    const unavailable = unavailableTargetState('target itself did not resolve (status: not-found)');
    expect(deriveTargetScrollTransition(unavailable, good)).toBeUndefined();
    expect(deriveTargetScrollTransition(good, unavailable)).toBeUndefined();
  });
});

function snapshot(scrollX: number, scrollY: number, targets: Record<string, TargetScrollRuntimeState> = {}): ScrollRuntimeSnapshot {
  return {
    window: { scrollX, scrollY },
    document: {
      root: metrics(),
      rootOverflow: { horizontalOverflow: false, verticalOverflow: false, overflowX: 'visible', overflowY: 'visible' },
    },
    targets,
  };
}

describe('deriveScrollScenarioTransition', () => {
  it('reports window scroll changes and omits a target with unusable evidence from the targets map', () => {
    const initialTargets = { workspace: unavailableTargetState('not resolved') };
    const finalTargets = { workspace: unavailableTargetState('not resolved') };
    const transition = deriveScrollScenarioTransition(snapshot(0, 0, initialTargets), snapshot(0, 400, finalTargets));
    expect(transition.windowScrollX).toEqual({ before: 0, after: 0, changed: false });
    expect(transition.windowScrollY).toEqual({ before: 0, after: 400, changed: true });
    expect(transition.targets.workspace).toBeUndefined();
  });
});

function unwrapAvailable(field: ReturnType<typeof deriveScrollOwner>) {
  if (field.state !== 'available') throw new Error('expected available');
  return field;
}

describe('deriveScrollOwner', () => {
  it('derives "none" when nothing relevant changed', () => {
    const owner = unwrapAvailable(deriveScrollOwner(deriveScrollScenarioTransition(snapshot(0, 0), snapshot(0, 0))));
    expect(owner.source).toBe('derived');
    expect(owner.value).toEqual({ kind: 'none' });
    expect(owner.derivedFrom).toContain('window.scrollX');
  });

  it('derives "document" when only the window/document moved', () => {
    const owner = unwrapAvailable(deriveScrollOwner(deriveScrollScenarioTransition(snapshot(0, 0), snapshot(0, 400))));
    expect(owner.value).toEqual({ kind: 'document' });
    expect(owner.source).toBe('derived');
    expect(owner.derivedFrom).toEqual(['window.scrollX', 'window.scrollY']);
  });

  it('derives "target:<name>" when exactly one configured target\'s scroll position changed and the window did not', () => {
    const relation: ViewportRelationEvidence = { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true };
    const initialTargets = { workspace: targetState(metrics({ scrollTop: 0, scrollLeft: 0 }), rect(), relation) };
    const finalTargets = { workspace: targetState(metrics({ scrollTop: 200, scrollLeft: 0 }), rect(), relation) };
    const owner = unwrapAvailable(deriveScrollOwner(deriveScrollScenarioTransition(snapshot(0, 0, initialTargets), snapshot(0, 0, finalTargets))));
    expect(owner.value).toEqual({ kind: 'target', target: 'workspace' });
    expect(owner.source).toBe('derived');
    expect(owner.derivedFrom).toEqual(['workspace.scrollTop', 'workspace.scrollLeft']);
  });

  it('is still one target owner when both scrollTop and scrollLeft change on the same target', () => {
    const relation: ViewportRelationEvidence = { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true };
    const initialTargets = { panel: targetState(metrics({ scrollTop: 0, scrollLeft: 0 }), rect(), relation) };
    const finalTargets = { panel: targetState(metrics({ scrollTop: 150, scrollLeft: 75 }), rect(), relation) };
    const owner = unwrapAvailable(deriveScrollOwner(deriveScrollScenarioTransition(snapshot(0, 0, initialTargets), snapshot(0, 0, finalTargets))));
    expect(owner.value).toEqual({ kind: 'target', target: 'panel' });
  });

  it('derives "indeterminate" when more than one configured target\'s scroll position changed', () => {
    const relation: ViewportRelationEvidence = { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true };
    const initialTargets = {
      a: targetState(metrics({ scrollTop: 0 }), rect(), relation),
      b: targetState(metrics({ scrollTop: 0 }), rect(), relation),
    };
    const finalTargets = {
      a: targetState(metrics({ scrollTop: 50 }), rect(), relation),
      b: targetState(metrics({ scrollTop: 30 }), rect(), relation),
    };
    const owner = unwrapAvailable(deriveScrollOwner(deriveScrollScenarioTransition(snapshot(0, 0, initialTargets), snapshot(0, 0, finalTargets))));
    expect(owner.value).toEqual({ kind: 'indeterminate' });
    expect(owner.derivedFrom).toEqual(expect.arrayContaining(['a.scrollTop', 'a.scrollLeft', 'b.scrollTop', 'b.scrollLeft']));
  });

  it('derives "indeterminate" when both the window and a configured target scroll position changed', () => {
    const relation: ViewportRelationEvidence = { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true };
    const initialTargets = { workspace: targetState(metrics({ scrollTop: 0 }), rect(), relation) };
    const finalTargets = { workspace: targetState(metrics({ scrollTop: 50 }), rect(), relation) };
    const owner = unwrapAvailable(deriveScrollOwner(deriveScrollScenarioTransition(snapshot(0, 0, initialTargets), snapshot(0, 400, finalTargets))));
    expect(owner.value).toEqual({ kind: 'indeterminate' });
    expect(owner.derivedFrom).toEqual(expect.arrayContaining(['window.scrollX', 'window.scrollY', 'workspace.scrollTop', 'workspace.scrollLeft']));
  });

  it('does not attribute target ownership from bounding-rectangle movement alone (document scroll moves every target\'s geometry)', () => {
    // window scrolled; the target's own scrollTop/scrollLeft never changed, only its
    // viewport-relative bounding rectangle (as document scrolling naturally does for
    // every configured target) - ownership must still resolve to "document", not "target".
    const initial = targetState(metrics({ scrollTop: 0, scrollLeft: 0 }), rect({ y: 1400 }), {
      vertical: 'below',
      intersectsViewport: false,
      fullyWithinViewport: false,
    });
    const final = targetState(metrics({ scrollTop: 0, scrollLeft: 0 }), rect({ y: 400 }), {
      vertical: 'intersecting',
      intersectsViewport: true,
      fullyWithinViewport: true,
    });
    const owner = unwrapAvailable(
      deriveScrollOwner(deriveScrollScenarioTransition(snapshot(0, 0, { below: initial }), snapshot(0, 1000, { below: final }))),
    );
    expect(owner.value).toEqual({ kind: 'document' });
  });

  it('does not attribute document ownership from nested-target scrolling alone (window unchanged)', () => {
    const relation: ViewportRelationEvidence = { vertical: 'intersecting', intersectsViewport: true, fullyWithinViewport: true };
    const initialTargets = { container: targetState(metrics({ scrollTop: 0 }), rect(), relation) };
    const finalTargets = { container: targetState(metrics({ scrollTop: 300 }), rect(), relation) };
    const owner = unwrapAvailable(deriveScrollOwner(deriveScrollScenarioTransition(snapshot(0, 0, initialTargets), snapshot(0, 0, finalTargets))));
    expect(owner.value).toEqual({ kind: 'target', target: 'container' });
  });
});
