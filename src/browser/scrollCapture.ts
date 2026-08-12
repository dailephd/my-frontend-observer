import type { Page } from 'playwright';
import type { Viewport } from '../request/request.js';
import type { EvidenceField } from '../domain/evidence.js';
import type { ScrollRuntimeSnapshot, ScrollableMetrics, TargetScrollRuntimeState, TargetGeometry, ViewportRelationEvidence } from '../domain/schema.js';
import { deriveOverflowEvidence, deriveViewportRelation } from '../domain/scrollEvidence.js';
import type { ResolvedTargetInfo } from './evidenceCapture.js';

function browserField<T>(value: T): EvidenceField<T> {
  return { state: 'available', source: 'browser', value };
}

function computedField<T>(value: T): EvidenceField<T> {
  return { state: 'available', source: 'computed-browser', value };
}

function derivedField<T>(value: T, derivedFrom: string[]): EvidenceField<T> {
  return { state: 'available', source: 'derived', value, derivedFrom };
}

function unavailableField<T>(reason: string): EvidenceField<T> {
  return { state: 'unavailable', reason };
}

function notApplicableField<T>(reason: string): EvidenceField<T> {
  return { state: 'not-applicable', reason };
}

interface RawWindowAndDocument {
  scrollX: number;
  scrollY: number;
  root: ScrollableMetrics;
  rootOverflowX: string;
  rootOverflowY: string;
  documentElement: ScrollableMetrics | undefined;
  body: ScrollableMetrics | undefined;
}

/**
 * `document.scrollingElement` (falling back to `documentElement`, which is
 * what `scrollingElement` resolves to for any standards-mode document) is
 * the browser's own answer to "which element actually scrolls the page" -
 * that becomes `document.root`. `documentElement` is included as its own
 * field only when it is a *different* element from the scrolling root
 * (legacy quirks-mode pages, not exercised by this repository's fixtures);
 * otherwise it would just duplicate `root`'s own metrics. `body` is always
 * a distinct DOM element from `documentElement` when present, so its own
 * metrics are genuine measurement, not fabrication, even when numerically
 * equal to `root`.
 */
async function captureWindowAndDocument(page: Page): Promise<RawWindowAndDocument> {
  return page.evaluate(() => {
    const metricsOf = (el: Element) => ({
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
    });
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const rootStyle = getComputedStyle(scrollingElement);
    const body = document.body;
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      root: metricsOf(scrollingElement),
      rootOverflowX: rootStyle.overflowX,
      rootOverflowY: rootStyle.overflowY,
      documentElement: scrollingElement !== document.documentElement ? metricsOf(document.documentElement) : undefined,
      body: body ? metricsOf(body) : undefined,
    };
  });
}

interface RawTargetScrollMeasurement {
  metrics: ScrollableMetrics;
  overflowX: string;
  overflowY: string;
  rect: TargetGeometry;
  visible: boolean;
}

/** Same hidden-element convention as `evidenceCapture.ts#captureResolvedTargetRecord`: `display:none`/`visibility:hidden`/zero-size all mean "not visibly rendered". */
async function captureTargetScrollMeasurement(handle: NonNullable<ResolvedTargetInfo['handle']>): Promise<RawTargetScrollMeasurement> {
  return handle.evaluate((el: Element) => {
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    return {
      metrics: {
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
      },
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      visible: computed.display !== 'none' && computed.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
    };
  });
}

/**
 * Builds one bounded `TargetScrollRuntimeState` for a single already-resolved
 * configured target. Metrics/overflow/boundingRect are reported as real
 * browser measurement (even when zero, for a hidden element) - consistent
 * with how `evidenceCapture.ts` already reports geometry for hidden v0.2
 * targets - but `viewportRelation` is `not-applicable` for a hidden target
 * (Batch 1 Section 20/24: hidden is not the same claim as offscreen, so a
 * hidden target must never receive ordinary above/below/intersecting
 * geometry).
 */
async function captureTargetScrollRuntimeState(info: ResolvedTargetInfo, viewport: Viewport): Promise<TargetScrollRuntimeState> {
  if (info.status !== 'matched' || !info.handle) {
    const reason = info.unavailableReason ?? `target itself did not resolve (status: ${info.status})`;
    return {
      metrics: unavailableField(reason),
      overflow: unavailableField(reason),
      boundingRect: unavailableField(reason),
      viewportRelation: unavailableField(reason),
    };
  }

  const raw = await captureTargetScrollMeasurement(info.handle);
  const overflow = deriveOverflowEvidence(raw.metrics, raw.overflowX, raw.overflowY);
  const viewportRelation = raw.visible
    ? derivedField(deriveViewportRelation(raw.rect, viewport), ['boundingRect', 'viewport'])
    : notApplicableField<ViewportRelationEvidence>('target is hidden or non-rendered; viewport relation is not meaningful');

  return {
    metrics: browserField(raw.metrics),
    overflow: computedField(overflow),
    boundingRect: browserField(raw.rect),
    viewportRelation,
  };
}

/**
 * Captures one point-in-time bounded `ScrollRuntimeSnapshot` (Batch 1 frozen
 * contract) from the live page, using already-resolved target handles -
 * never re-resolving targets itself. Called twice by the scenario lifecycle
 * (once before the scroll action, once after stabilization) against the
 * exact same `resolved` set, so "which browser element is target X" is
 * answered exactly once per observation's scenario capture.
 */
export async function captureScrollRuntimeSnapshot(page: Page, resolved: readonly ResolvedTargetInfo[], viewport: Viewport): Promise<ScrollRuntimeSnapshot> {
  const raw = await captureWindowAndDocument(page);
  const rootOverflow = deriveOverflowEvidence(raw.root, raw.rootOverflowX, raw.rootOverflowY);

  const targets: Record<string, TargetScrollRuntimeState> = {};
  for (const info of resolved) {
    targets[info.name] = await captureTargetScrollRuntimeState(info, viewport);
  }

  return {
    window: { scrollX: raw.scrollX, scrollY: raw.scrollY },
    document: {
      root: raw.root,
      rootOverflow,
      ...(raw.documentElement ? { documentElement: raw.documentElement } : {}),
      ...(raw.body ? { body: raw.body } : {}),
    },
    targets,
  };
}

/**
 * Immediate, non-smooth window scroll using the Batch 1 normalized delta.
 * `behavior: 'instant'` guarantees no smooth-scroll animation regardless of
 * any `scroll-behavior: smooth` the observed page's own CSS declares - the
 * position change is synchronous within this one `evaluate()` call.
 */
export async function performWindowScrollBy(page: Page, deltaX: number, deltaY: number): Promise<void> {
  await page.evaluate(
    ({ deltaX, deltaY }) => {
      window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' });
    },
    { deltaX, deltaY },
  );
}

/** The Batch 1 frozen stabilization contract: exactly two `requestAnimationFrame` cycles on the live page, no timers/sleeps/network-idle substitutes. */
export async function waitTwoAnimationFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
