import type { EvidenceField } from './evidence.js';
import type { Viewport } from '../request/request.js';
import type {
  ScrollableMetrics,
  OverflowEvidence,
  ViewportRelationEvidence,
  TargetGeometry,
  ScrollRuntimeSnapshot,
  TargetScrollRuntimeState,
  ScrollValueChange,
  TargetScrollTransition,
  ScrollScenarioTransition,
  ScrollOwnerInterpretation,
} from './schema.js';

/**
 * Derived only from a bounding rectangle (viewport-relative, as produced by
 * `getBoundingClientRect()`) plus viewport width/height - never from source
 * styles or locator kind (Batch 1 frozen contract). `above`/`below` require
 * the rectangle to be *entirely* outside the viewport on that axis; any
 * vertical overlap with `[0, viewport.height)` is `intersecting`.
 */
export function deriveViewportRelation(rect: TargetGeometry, viewport: Viewport): ViewportRelationEvidence {
  const vertical = rect.bottom <= 0 ? 'above' : rect.y >= viewport.height ? 'below' : 'intersecting';
  const intersectsViewport = rect.right > 0 && rect.x < viewport.width && rect.bottom > 0 && rect.y < viewport.height;
  const fullyWithinViewport = rect.x >= 0 && rect.y >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height;
  return { vertical, intersectsViewport, fullyWithinViewport };
}

/**
 * Distinguishes a computed `overflow-x`/`overflow-y` CSS declaration from
 * actual dimensional overflow. `overflow-x: auto`/`overflow-y: scroll` alone
 * never implies actual overflow - only `scrollWidth > clientWidth` /
 * `scrollHeight > clientHeight` do.
 */
export function deriveOverflowEvidence(metrics: ScrollableMetrics, overflowX: string, overflowY: string): OverflowEvidence {
  return {
    horizontalOverflow: metrics.scrollWidth > metrics.clientWidth,
    verticalOverflow: metrics.scrollHeight > metrics.clientHeight,
    overflowX,
    overflowY,
  };
}

function numberChange(before: number, after: number): ScrollValueChange<number> {
  return { before, after, changed: before !== after };
}

function extractAvailable<T>(field: EvidenceField<T>): T | undefined {
  return field.state === 'available' || field.state === 'partial' ? field.value : undefined;
}

/**
 * Bounded before/after change evidence for one configured target across the
 * one scroll action - not a generic recursive diff. Returns `undefined`
 * (rather than fabricating zeroed/default values) when either snapshot's
 * metrics/boundingRect/viewportRelation evidence for this target is not
 * itself usable (e.g. the target never resolved), consistent with
 * `enteredViewport`/`leftViewport` only being evaluated when both
 * viewport-relation states are valid.
 */
export function deriveTargetScrollTransition(initial: TargetScrollRuntimeState, final: TargetScrollRuntimeState): TargetScrollTransition | undefined {
  const initialMetrics = extractAvailable(initial.metrics);
  const finalMetrics = extractAvailable(final.metrics);
  const initialRect = extractAvailable(initial.boundingRect);
  const finalRect = extractAvailable(final.boundingRect);
  const initialRelation = extractAvailable(initial.viewportRelation);
  const finalRelation = extractAvailable(final.viewportRelation);
  if (!initialMetrics || !finalMetrics || !initialRect || !finalRect || !initialRelation || !finalRelation) {
    return undefined;
  }

  const enteredViewport = !initialRelation.intersectsViewport && finalRelation.intersectsViewport;
  const leftViewport = initialRelation.intersectsViewport && !finalRelation.intersectsViewport;

  return {
    scrollTop: numberChange(initialMetrics.scrollTop, finalMetrics.scrollTop),
    scrollLeft: numberChange(initialMetrics.scrollLeft, finalMetrics.scrollLeft),
    boundingRectPosition: {
      before: { x: initialRect.x, y: initialRect.y },
      after: { x: finalRect.x, y: finalRect.y },
      changed: initialRect.x !== finalRect.x || initialRect.y !== finalRect.y,
    },
    viewportRelation: { before: initialRelation.vertical, after: finalRelation.vertical, changed: initialRelation.vertical !== finalRelation.vertical },
    enteredViewport,
    leftViewport,
  };
}

/** Derives the bounded scenario transition evidence purely from the two already-captured runtime snapshots - no re-measurement, no generic JSON diffing. A target absent from either snapshot's `targets` map, or whose per-target transition cannot be derived (see `deriveTargetScrollTransition`), is simply omitted from `targets` here. */
export function deriveScrollScenarioTransition(initial: ScrollRuntimeSnapshot, final: ScrollRuntimeSnapshot): ScrollScenarioTransition {
  const targets: Record<string, TargetScrollTransition> = {};
  for (const [name, initialState] of Object.entries(initial.targets)) {
    const finalState = final.targets[name];
    if (!finalState) continue;
    const transition = deriveTargetScrollTransition(initialState, finalState);
    if (transition) targets[name] = transition;
  }

  return {
    windowScrollX: numberChange(initial.window.scrollX, final.window.scrollX),
    windowScrollY: numberChange(initial.window.scrollY, final.window.scrollY),
    targets,
  };
}

/**
 * Conservative window-scenario-only scroll-owner derivation (Batch 2 scope):
 * relies solely on observed scroll-*position* changes, never on a target's
 * bounding-rectangle movement (which moves for every configured target
 * whenever the document scrolls, regardless of who "owns" scrolling - using
 * it here would falsely attribute document scrolling to every visible
 * target). Because Batch 2 never executes `target-scroll-by`, a competing
 * target scroll-position change cannot actually occur yet; the
 * `indeterminate` branch exists only so the pure helper already honors the
 * full frozen `ScrollOwnerInterpretation` vocabulary ahead of Batch 3, which
 * proves real nested/target ownership.
 */
export function deriveWindowScrollOwner(transition: ScrollScenarioTransition): EvidenceField<ScrollOwnerInterpretation> {
  const windowMoved = transition.windowScrollX.changed || transition.windowScrollY.changed;
  const competingTargets = Object.entries(transition.targets).filter(([, t]) => t.scrollTop.changed || t.scrollLeft.changed);

  let value: ScrollOwnerInterpretation;
  const derivedFrom = ['window.scrollX', 'window.scrollY', ...competingTargets.map(([name]) => `${name}.scrollTop`)];
  if (!windowMoved && competingTargets.length === 0) {
    value = { kind: 'none' };
  } else if (windowMoved && competingTargets.length === 0) {
    value = { kind: 'document' };
  } else {
    value = { kind: 'indeterminate' };
  }

  return { state: 'available', source: 'derived', value, derivedFrom };
}
