import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { captureViewport, captureViewportInternal } from '../../src/browser/chromiumAdapter.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import type { EvidenceField } from '../../src/domain/evidence.js';
import {
  startFixtureServer,
  type FixtureServer,
  OBSERVATION_FIXTURE_SELECTORS,
  OBSERVATION_FIXTURE_BUTTON_GEOMETRY,
} from '../fixtures/server.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function baseRequest(overrides: Partial<NormalizedObservationRequest> = {}): NormalizedObservationRequest {
  return {
    targetUrl: 'http://127.0.0.1:0/normal',
    viewport: { width: 800, height: 600 },
    targets: [],
    outputLocation: 'observations',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
    ...overrides,
  };
}

describe('chromiumAdapter (Batch 2 browser boundary)', () => {
  let fixtures: FixtureServer;

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  // B2-TST-001 Launch, B2-TST-002 Loopback navigation, B2-TST-003 Viewport,
  // B2-TST-004 Readiness, B2-TST-006 Screenshot, B2-TST-007 Browser provenance,
  // B2-TST-011 Cleanup after success.
  it('B2-TST-001..004,006,007,011: launches Chromium, navigates the fixture, honors viewport, captures a real PNG, returns provenance, and cleans up', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/normal`,
      viewport: { width: 800, height: 600 },
    });

    const { result, browserConnected } = await captureViewportInternal(request);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    expect(result.diagnostics).toEqual([]);

    expect(result.provenance.engine).toBe('chromium');
    expect(typeof result.provenance.version).toBe('string');
    expect(result.provenance.version.length).toBeGreaterThan(0);

    expect(result.screenshot.length).toBeGreaterThan(0);
    expect(isPngSignature(result.screenshot)).toBe(true);
    expect(readPngDimensions(result.screenshot)).toEqual({ width: 800, height: 600 });

    expect(browserConnected).toBe(false);
  });

  // B2-TST-005 Readiness timeout, B2-TST-012 Cleanup after failure.
  it('B2-TST-005,012: bounds readiness and cleans up when the fixture never becomes ready', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/hang`,
      timeoutMs: 5000,
      readiness: { condition: 'load', timeoutMs: 1200 },
    });

    const started = Date.now();
    const { result, browserConnected } = await captureViewportInternal(request);
    const elapsedMs = Date.now() - started;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure result');
    expect(result.diagnostics.some((d) => d.code === 'readiness-timeout')).toBe(true);
    // Bounded: must not wait anywhere near the overall request timeoutMs (5000ms).
    expect(elapsedMs).toBeLessThan(4000);

    expect(browserConnected).toBe(false);
  });

  // B6 Scenario 8: a genuine browser/navigation failure (connection reset mid-navigation),
  // distinct from both a readiness timeout and a pre-launch safety rejection.
  it('B6-SCN-008: a real connection failure during navigation is reported as navigation-failure, not readiness-timeout, and cleans up', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/connection-reset`,
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    });

    const { result, browserConnected } = await captureViewportInternal(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure result');
    expect(result.diagnostics.some((d) => d.code === 'navigation-failure')).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'readiness-timeout')).toBe(false);

    expect(browserConnected).toBe(false);
  });

  // B2-TST-008 Unsafe initial target.
  it('B2-TST-008: rejects a prohibited (non-loopback) initial target without launching a browser', async () => {
    const request = baseRequest({ targetUrl: 'http://example.invalid/remote' });

    const { result, browserConnected } = await captureViewportInternal(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure result');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('unsafe-url');

    // Rejected before any browser was launched.
    expect(browserConnected).toBe(false);
  });

  // B2-TST-009 Redirect enforcement.
  it('B2-TST-009: blocks a redirect to a non-loopback target', async () => {
    const request = baseRequest({ targetUrl: `${fixtures.baseUrl}/redirect-remote` });

    const { result, browserConnected } = await captureViewportInternal(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure result');
    expect(result.diagnostics.some((d) => d.code === 'prohibited-redirect')).toBe(true);

    expect(browserConnected).toBe(false);
  });

  // B2-TST-010 Subresource/network enforcement.
  it('B2-TST-010: blocks a subresource request to a non-loopback host', async () => {
    const request = baseRequest({ targetUrl: `${fixtures.baseUrl}/subresource-remote` });

    const { result, browserConnected } = await captureViewportInternal(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure result');
    expect(result.diagnostics.some((d) => d.code === 'prohibited-subresource-request')).toBe(true);

    expect(browserConnected).toBe(false);
  });

  // B2-TST-013 Playwright boundary: the observer-facing result is plain, serializable data.
  it('B2-TST-013: the observer-facing result exposes no Playwright object', async () => {
    const request = baseRequest({ targetUrl: `${fixtures.baseUrl}/normal` });

    const result = await captureViewport(request);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    expect(Object.keys(result).sort()).toEqual(['diagnostics', 'ok', 'pageEvidence', 'provenance', 'screenshot', 'targetEvidence']);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.provenance)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.pageEvidence)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.targetEvidence)).toBe(Object.prototype);
    expect(result.screenshot).toBeInstanceOf(Uint8Array);
    // A plain data result never carries Playwright's request-handling methods.
    expect('close' in result).toBe(false);
    expect('newPage' in result).toBe(false);

    // Round-trips through JSON (except the raw screenshot bytes, asserted separately above)
    // to prove the rest of the shape is plain/serializable.
    const serializable = {
      ok: result.ok,
      diagnostics: result.diagnostics,
      provenance: result.provenance,
      pageEvidence: result.pageEvidence,
      targetEvidence: result.targetEvidence,
    };
    expect(() => JSON.parse(JSON.stringify(serializable))).not.toThrow();
  });
});

function available<T>(field: EvidenceField<T>): field is Extract<EvidenceField<T>, { state: 'available' }> {
  return field.state === 'available';
}

describe('chromiumAdapter (Batch 3 page/target observation)', () => {
  let fixtures: FixtureServer;

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  // B3-TST-001..006: requested/final URL, title, viewport, device pixel ratio, document dimensions, window scroll.
  it('B3-TST-001..006,016: captures the v0.1 minimum page evidence with correct source/state tagging', async () => {
    const request: NormalizedObservationRequest = {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    };

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const pe = result.pageEvidence;

    expect(available(pe.requestedUrl!) && pe.requestedUrl!.value).toBe(request.targetUrl);
    expect(available(pe.finalUrl!) && pe.finalUrl!.value).toBe(request.targetUrl);
    expect(pe.requestedUrl!.state === 'available' && pe.requestedUrl!.source).toBe('browser');

    expect(available(pe.title!) && pe.title!.value).toBe('observation fixture');

    expect(available(pe.viewportWidth!) && pe.viewportWidth!.value).toBe(800);
    expect(available(pe.viewportHeight!) && pe.viewportHeight!.value).toBe(600);

    expect(pe.devicePixelRatio!.state).toBe('available');
    expect(available(pe.devicePixelRatio!) && typeof pe.devicePixelRatio!.value).toBe('number');
    expect(available(pe.devicePixelRatio!) && (pe.devicePixelRatio!.value as number)).toBeGreaterThan(0);

    // Direct browser reads: scroll/client dimensions.
    const scrollWidth = available(pe.documentScrollWidth!) ? (pe.documentScrollWidth!.value as number) : undefined;
    const scrollHeight = available(pe.documentScrollHeight!) ? (pe.documentScrollHeight!.value as number) : undefined;
    const clientWidth = available(pe.documentClientWidth!) ? (pe.documentClientWidth!.value as number) : undefined;
    const clientHeight = available(pe.documentClientHeight!) ? (pe.documentClientHeight!.value as number) : undefined;
    expect(pe.documentScrollWidth!.state === 'available' && pe.documentScrollWidth!.source).toBe('browser');
    expect(scrollWidth).toBeGreaterThanOrEqual(2000);
    expect(scrollHeight).toBeGreaterThanOrEqual(1200);
    expect(clientWidth).toBeLessThanOrEqual(800);
    expect(clientHeight).toBeLessThanOrEqual(600);

    // Derived: document width/height is max(scroll, client) in each axis, and must say so via source+derivedFrom.
    expect(pe.documentWidth!.state).toBe('available');
    expect(pe.documentWidth!.state === 'available' && pe.documentWidth!.source).toBe('derived');
    expect(pe.documentWidth!.state === 'available' && pe.documentWidth!.derivedFrom).toEqual(['documentScrollWidth', 'documentClientWidth']);
    expect(available(pe.documentWidth!) && pe.documentWidth!.value).toBe(Math.max(scrollWidth!, clientWidth!));
    expect(available(pe.documentHeight!) && pe.documentHeight!.value).toBe(Math.max(scrollHeight!, clientHeight!));
    // The fixture is deliberately larger than the viewport, so the derived value must come from the scroll side.
    expect(available(pe.documentWidth!) && pe.documentWidth!.value).toBe(scrollWidth);
    expect(available(pe.documentHeight!) && pe.documentHeight!.value).toBe(scrollHeight);

    expect(available(pe.windowScrollX!) && pe.windowScrollX!.value).toBe(0);
    expect(available(pe.windowScrollY!) && pe.windowScrollY!.value).toBe(0);
  });

  // B3-TST-007..013,016: multiple targets, tag, geometry, computed style, scroll/client, visibility, semantics.
  it('B3-TST-007..013,016: captures target evidence for multiple explicit targets in one observation', async () => {
    const request: NormalizedObservationRequest = {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [
        { name: 'header', selector: OBSERVATION_FIXTURE_SELECTORS.header },
        { name: 'button', selector: OBSERVATION_FIXTURE_SELECTORS.button },
        { name: 'main', selector: OBSERVATION_FIXTURE_SELECTORS.main },
        { name: 'footer', selector: OBSERVATION_FIXTURE_SELECTORS.footer },
        { name: 'hidden', selector: OBSERVATION_FIXTURE_SELECTORS.hidden },
      ],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    };

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    // B3-TST-007: deterministic target identity - every configured target is present, keyed by its own name.
    expect(Object.keys(result.targetEvidence).sort()).toEqual(['button', 'footer', 'header', 'hidden', 'main']);

    const header = result.targetEvidence.header!;
    const button = result.targetEvidence.button!;
    const main = result.targetEvidence.main!;
    const footer = result.targetEvidence.footer!;
    const hidden = result.targetEvidence.hidden!;

    // B3-TST-008: tag.
    expect(available(header.tag) && header.tag.value).toBe('header');
    expect(available(button.tag) && button.tag.value).toBe('button');

    // B3-TST-009: geometry, exact for absolutely (and simply block-flow) positioned elements.
    expect(button.geometry.state).toBe('available');
    expect(available(button.geometry) && button.geometry.value).toEqual(OBSERVATION_FIXTURE_BUTTON_GEOMETRY);
    expect(available(header.geometry) && header.geometry.value).toEqual({ x: 0, y: 0, width: 800, height: 60, right: 800, bottom: 60 });

    // B3-TST-010: computed layout properties, from getComputedStyle (source computed-browser), not stylesheet inspection.
    expect(main.style.state === 'available' && main.style.source).toBe('computed-browser');
    expect(available(main.style) && main.style.value.overflowX).toBe('hidden');
    expect(available(main.style) && main.style.value.overflowY).toBe('auto');
    expect(available(footer.style) && footer.style.value.overflowX).toBe('hidden');
    expect(available(footer.style) && footer.style.value.overflowY).toBe('scroll');

    // B3-TST-011: scroll/client measurements from real runtime DOM state, not scrolled programmatically.
    expect(main.layout.state === 'available' && main.layout.source).toBe('browser');
    const mainLayout = available(main.layout) ? main.layout.value : undefined;
    expect(mainLayout!.scrollWidth).toBeGreaterThanOrEqual(1600);
    expect(mainLayout!.scrollHeight).toBeGreaterThanOrEqual(900);
    expect(mainLayout!.scrollWidth).toBeGreaterThan(mainLayout!.clientWidth);
    expect(mainLayout!.scrollHeight).toBeGreaterThan(mainLayout!.clientHeight);
    expect(mainLayout!.scrollTop).toBe(0);
    expect(mainLayout!.scrollLeft).toBe(0);

    // B3-TST-012: initial visibility, without any controlled scrolling.
    expect(button.visibility.state === 'available' && button.visibility.source).toBe('derived');
    expect(available(button.visibility) && button.visibility.value.visible).toBe(true);
    expect(available(hidden.visibility) && hidden.visibility.value.visible).toBe(false);
    // The hidden target is still *resolved* - a real (zero) measurement, not "unavailable".
    expect(hidden.geometry.state).toBe('available');
    expect(available(hidden.geometry) && hidden.geometry.value).toEqual({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 });

    // B3-TST-013: semantic role/name through the bounded, target-local aria snapshot.
    expect(button.semantics.state === 'available' && button.semantics.source).toBe('computed-browser');
    expect(available(button.semantics) && button.semantics.value).toEqual({ role: 'button', name: 'Submit' });

    expect(result.diagnostics.filter((d) => d.code === 'target-missing' || d.code === 'target-ambiguous')).toEqual([]);
  });

  // B3-TST-014: missing target.
  it('B3-TST-014: a selector matching no element is reported as explicit missing evidence, not fake zero geometry', async () => {
    const request: NormalizedObservationRequest = {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [{ name: 'ghost', selector: OBSERVATION_FIXTURE_SELECTORS.missing }],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    };

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const ghost = result.targetEvidence.ghost!;
    expect(available(ghost.resolution) && ghost.resolution.value.selectionStatus).toBe('not-found');
    expect(ghost.geometry.state).toBe('unavailable');
    expect(ghost.style.state).toBe('unavailable');
    expect(ghost.visibility.state).toBe('unavailable');

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'target-missing', severity: 'warning', targetName: 'ghost' }),
    );
  });

  // B3-TST-015: ambiguous target.
  it('B3-TST-015: a selector matching multiple elements is reported as ambiguous, not an arbitrary first match', async () => {
    const request: NormalizedObservationRequest = {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [{ name: 'dup', selector: OBSERVATION_FIXTURE_SELECTORS.duplicate }],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    };

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const dup = result.targetEvidence.dup!;
    expect(available(dup.resolution) && dup.resolution.value.selectionStatus).toBe('ambiguous');
    expect(dup.geometry.state).toBe('unavailable');

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'target-ambiguous', severity: 'warning', targetName: 'dup' }));
  });

  // B3-TST-017,018,019: same live page for screenshot + page evidence + target evidence, plain result, cleanup unaffected.
  it('B3-TST-017..019: screenshot, page evidence, and target evidence come from the same observation and cleanup remains reliable', async () => {
    const request: NormalizedObservationRequest = {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [{ name: 'button', selector: OBSERVATION_FIXTURE_SELECTORS.button }],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    };

    const { result, browserConnected } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    // Same navigation: page evidence's finalUrl is the same fixture URL the target evidence was measured against.
    expect(available(result.pageEvidence.finalUrl!) && result.pageEvidence.finalUrl!.value).toBe(request.targetUrl);
    // Same viewport used for both the screenshot and the reported page evidence.
    expect(available(result.pageEvidence.viewportWidth!) && result.pageEvidence.viewportWidth!.value).toBe(800);
    const dims = { width: new DataView(result.screenshot.buffer, result.screenshot.byteOffset).getUint32(16), height: new DataView(result.screenshot.buffer, result.screenshot.byteOffset).getUint32(20) };
    expect(dims).toEqual({ width: 800, height: 600 });

    // Plain, recursively: the target evidence's nested value objects are plain data too.
    const button = result.targetEvidence.button!;
    expect(Object.getPrototypeOf(button)).toBe(Object.prototype);
    expect(available(button.geometry) && Object.getPrototypeOf(button.geometry.value)).toBe(Object.prototype);

    expect(browserConnected).toBe(false);
  });
});
