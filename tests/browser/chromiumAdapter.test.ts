import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { captureViewport, captureViewportInternal } from '../../src/browser/chromiumAdapter.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import type { EvidenceField } from '../../src/domain/evidence.js';
import {
  startFixtureServer,
  type FixtureServer,
  OBSERVATION_FIXTURE_SELECTORS,
  OBSERVATION_FIXTURE_BUTTON_GEOMETRY,
  OBSERVATION_FIXTURE_ROLE,
  OBSERVATION_FIXTURE_IDS,
  OBSERVATION_FIXTURE_DATA_ATTRIBUTE,
  OBSERVATION_FIXTURE_SEMANTIC_ELEMENT,
  OBSERVATION_FIXTURE_TEXT,
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
        { name: 'header', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header }] },
        { name: 'button', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.button }] },
        { name: 'main', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.main }] },
        { name: 'footer', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.footer }] },
        { name: 'hidden', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.hidden }] },
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
      targets: [{ name: 'ghost', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.missing }] }],
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
      targets: [{ name: 'dup', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.duplicate }] }],
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

  // v0.2: ordered-locator fallback/ambiguity/hidden-target resolution contract.
  it('v0.2: a unique CSS target selects locator 0 with no fallback and exact confidence', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/observation`,
      targets: [{ name: 'header', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header }] }],
    });
    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const header = result.targetEvidence.header!;
    expect(available(header.resolution) && header.resolution.value).toMatchObject({
      selectionStatus: 'matched',
      selectedLocatorKind: 'css',
      selectedLocatorIndex: 0,
      usedFallback: false,
      confidence: 'exact',
    });
    expect(available(header.resolution) && header.resolution.value.attempts).toEqual([
      { locatorIndex: 0, locatorKind: 'css', status: 'matched', matchCount: 1 },
    ]);
  });

  it('v0.2: when all applicable CSS locators miss, resolution is not-found with confidence none', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/observation`,
      targets: [{ name: 'ghost', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.missing }] }],
    });
    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const ghost = result.targetEvidence.ghost!;
    expect(available(ghost.resolution) && ghost.resolution.value).toMatchObject({ selectionStatus: 'not-found', usedFallback: false, confidence: 'none' });
    expect(available(ghost.resolution) && 'selectedLocatorKind' in ghost.resolution.value).toBe(false);
  });

  it('v0.2: a missing first locator falls back to a uniquely-matching second locator', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/observation`,
      targets: [
        {
          name: 'header',
          locators: [
            { kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.missing },
            { kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header },
          ],
        },
      ],
    });
    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const header = result.targetEvidence.header!;
    expect(available(header.resolution) && header.resolution.value).toMatchObject({
      selectionStatus: 'matched',
      selectedLocatorKind: 'css',
      selectedLocatorIndex: 1,
      usedFallback: true,
      confidence: 'exact',
    });
    expect(available(header.resolution) && header.resolution.value.attempts.map((a) => a.status)).toEqual(['not-found', 'matched']);
  });

  it('v0.2: an ambiguous locator stops immediately and never falls through to a later locator', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/observation`,
      targets: [
        {
          name: 'dup',
          locators: [
            { kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.duplicate },
            { kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header },
          ],
        },
      ],
    });
    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const dup = result.targetEvidence.dup!;
    expect(available(dup.resolution) && dup.resolution.value).toMatchObject({ selectionStatus: 'ambiguous', usedFallback: false, confidence: 'none' });
    expect(available(dup.resolution) && dup.resolution.value.attempts).toHaveLength(1);
    expect(available(dup.resolution) && dup.resolution.value.attempts[0]).toMatchObject({ locatorIndex: 0, locatorKind: 'css', status: 'ambiguous' });
  });

  it('v0.2: a hidden but uniquely-resolved target is matched (not missing), reports visible=false, and yields a target-hidden warning with completion=partial', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/observation`,
      targets: [{ name: 'hidden', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.hidden }] }],
    });
    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const hidden = result.targetEvidence.hidden!;
    expect(available(hidden.resolution) && hidden.resolution.value.selectionStatus).toBe('matched');
    expect(available(hidden.visibility) && hidden.visibility.value.visible).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'target-hidden', severity: 'warning', targetName: 'hidden' }));
    expect(result.diagnostics.some((d) => d.code === 'target-missing' && d.targetName === 'hidden')).toBe(false);

    const { deriveCompletion } = await import('../../src/domain/completion.js');
    expect(deriveCompletion(result.diagnostics, 'post-capture')).toMatchObject({ state: 'partial' });
  });

  // B3-TST-017,018,019: same live page for screenshot + page evidence + target evidence, plain result, cleanup unaffected.
  it('B3-TST-017..019: screenshot, page evidence, and target evidence come from the same observation and cleanup remains reliable', async () => {
    const request: NormalizedObservationRequest = {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [{ name: 'button', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.button }] }],
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

describe('v0.2 Batch 2: real browser semantic locator resolution', () => {
  let fixtures: FixtureServer;

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  function requestWithTarget(name: string, locators: NormalizedObservationRequest['targets'][number]['locators']): NormalizedObservationRequest {
    return {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [{ name, locators }],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    };
  }

  async function resolve(name: string, locators: NormalizedObservationRequest['targets'][number]['locators']) {
    const { result } = await captureViewportInternal(requestWithTarget(name, locators));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    return result;
  }

  describe('role locator', () => {
    it('resolves a unique role+accessible-name match (navigation)', async () => {
      const result = await resolve('nav', [{ kind: 'role', role: OBSERVATION_FIXTURE_ROLE.navRole, name: OBSERVATION_FIXTURE_ROLE.navName }]);
      expect(available(result.targetEvidence.nav!.resolution) && result.targetEvidence.nav!.resolution.value).toMatchObject({
        selectionStatus: 'matched',
        selectedLocatorKind: 'role',
        selectedLocatorIndex: 0,
        usedFallback: false,
        confidence: 'exact',
      });
    });

    it('resolves a unique role+accessible-name match (button)', async () => {
      const result = await resolve('btn', [{ kind: 'role', role: OBSERVATION_FIXTURE_ROLE.buttonRole, name: OBSERVATION_FIXTURE_ROLE.buttonName }]);
      expect(available(result.targetEvidence.btn!.resolution) && result.targetEvidence.btn!.resolution.value.selectionStatus).toBe('matched');
      expect(available(result.targetEvidence.btn!.tag) && result.targetEvidence.btn!.tag.value).toBe('button');
    });

    it('reports not-found for a role with no matching element', async () => {
      const result = await resolve('missing-role', [{ kind: 'role', role: OBSERVATION_FIXTURE_ROLE.missingRole }]);
      expect(available(result.targetEvidence['missing-role']!.resolution) && result.targetEvidence['missing-role']!.resolution.value.selectionStatus).toBe(
        'not-found',
      );
    });

    it('reports ambiguous when a role+name matches multiple elements, without using .first()', async () => {
      const result = await resolve('dup-role', [{ kind: 'role', role: OBSERVATION_FIXTURE_ROLE.duplicateRole, name: OBSERVATION_FIXTURE_ROLE.duplicateName }]);
      expect(available(result.targetEvidence['dup-role']!.resolution) && result.targetEvidence['dup-role']!.resolution.value).toMatchObject({
        selectionStatus: 'ambiguous',
        confidence: 'none',
      });
    });
  });

  describe('id locator', () => {
    it('resolves a unique exact id', async () => {
      const result = await resolve('by-id', [{ kind: 'id', value: OBSERVATION_FIXTURE_IDS.header }]);
      expect(available(result.targetEvidence['by-id']!.resolution) && result.targetEvidence['by-id']!.resolution.value.selectionStatus).toBe('matched');
      expect(available(result.targetEvidence['by-id']!.tag) && result.targetEvidence['by-id']!.tag.value).toBe('header');
    });

    it('reports not-found for a missing id', async () => {
      const result = await resolve('ghost-id', [{ kind: 'id', value: OBSERVATION_FIXTURE_IDS.missing }]);
      expect(available(result.targetEvidence['ghost-id']!.resolution) && result.targetEvidence['ghost-id']!.resolution.value.selectionStatus).toBe(
        'not-found',
      );
    });

    it('reports ambiguous when multiple elements share the same id (invalid but tolerated HTML)', async () => {
      const result = await resolve('dup-id', [{ kind: 'id', value: OBSERVATION_FIXTURE_IDS.duplicate }]);
      expect(available(result.targetEvidence['dup-id']!.resolution) && result.targetEvidence['dup-id']!.resolution.value.selectionStatus).toBe('ambiguous');
    });
  });

  describe('data-attribute locator', () => {
    it('resolves a unique exact data-* attribute/value match', async () => {
      const result = await resolve('region', [
        { kind: 'data-attribute', attribute: OBSERVATION_FIXTURE_DATA_ATTRIBUTE.attribute, value: OBSERVATION_FIXTURE_DATA_ATTRIBUTE.uniqueValue },
      ]);
      expect(available(result.targetEvidence.region!.resolution) && result.targetEvidence.region!.resolution.value.selectionStatus).toBe('matched');
    });

    it('reports not-found for a missing data-* value', async () => {
      const result = await resolve('ghost-region', [
        { kind: 'data-attribute', attribute: OBSERVATION_FIXTURE_DATA_ATTRIBUTE.attribute, value: OBSERVATION_FIXTURE_DATA_ATTRIBUTE.missingValue },
      ]);
      expect(
        available(result.targetEvidence['ghost-region']!.resolution) && result.targetEvidence['ghost-region']!.resolution.value.selectionStatus,
      ).toBe('not-found');
    });

    it('reports ambiguous when multiple elements share the same data-* value', async () => {
      const result = await resolve('dup-region', [
        { kind: 'data-attribute', attribute: OBSERVATION_FIXTURE_DATA_ATTRIBUTE.attribute, value: OBSERVATION_FIXTURE_DATA_ATTRIBUTE.duplicateValue },
      ]);
      expect(
        available(result.targetEvidence['dup-region']!.resolution) && result.targetEvidence['dup-region']!.resolution.value.selectionStatus,
      ).toBe('ambiguous');
    });
  });

  describe('semantic-element locator', () => {
    it('resolves a unique semantic element', async () => {
      const result = await resolve('side', [{ kind: 'semantic-element', tag: OBSERVATION_FIXTURE_SEMANTIC_ELEMENT.uniqueTag }]);
      expect(available(result.targetEvidence.side!.resolution) && result.targetEvidence.side!.resolution.value.selectionStatus).toBe('matched');
      expect(available(result.targetEvidence.side!.tag) && result.targetEvidence.side!.tag.value).toBe(OBSERVATION_FIXTURE_SEMANTIC_ELEMENT.uniqueTag);
    });

    it('reports not-found for a semantic element absent from the page', async () => {
      const result = await resolve('missing-dialog', [{ kind: 'semantic-element', tag: OBSERVATION_FIXTURE_SEMANTIC_ELEMENT.missingTag }]);
      expect(
        available(result.targetEvidence['missing-dialog']!.resolution) && result.targetEvidence['missing-dialog']!.resolution.value.selectionStatus,
      ).toBe('not-found');
    });

    it('reports ambiguous when multiple elements share the same semantic tag', async () => {
      const result = await resolve('dup-article', [{ kind: 'semantic-element', tag: OBSERVATION_FIXTURE_SEMANTIC_ELEMENT.duplicateTag }]);
      expect(
        available(result.targetEvidence['dup-article']!.resolution) && result.targetEvidence['dup-article']!.resolution.value.selectionStatus,
      ).toBe('ambiguous');
    });
  });

  describe('css locator (regression through the unified resolver)', () => {
    it('unique CSS match still resolves', async () => {
      const result = await resolve('css-header', [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header }]);
      expect(available(result.targetEvidence['css-header']!.resolution) && result.targetEvidence['css-header']!.resolution.value.selectionStatus).toBe(
        'matched',
      );
    });

    it('missing CSS selector still reports not-found', async () => {
      const result = await resolve('css-ghost', [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.missing }]);
      expect(available(result.targetEvidence['css-ghost']!.resolution) && result.targetEvidence['css-ghost']!.resolution.value.selectionStatus).toBe(
        'not-found',
      );
    });

    it('ambiguous CSS selector still reports ambiguous', async () => {
      const result = await resolve('css-dup', [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.duplicate }]);
      expect(available(result.targetEvidence['css-dup']!.resolution) && result.targetEvidence['css-dup']!.resolution.value.selectionStatus).toBe(
        'ambiguous',
      );
    });
  });

  describe('exact text locator', () => {
    it('resolves a unique exact text match', async () => {
      const result = await resolve('exact-text', [{ kind: 'text', text: OBSERVATION_FIXTURE_TEXT.unique }]);
      expect(available(result.targetEvidence['exact-text']!.resolution) && result.targetEvidence['exact-text']!.resolution.value.selectionStatus).toBe(
        'matched',
      );
    });

    it('reports not-found for text that does not appear anywhere (no substring/fuzzy match)', async () => {
      const result = await resolve('ghost-text', [{ kind: 'text', text: OBSERVATION_FIXTURE_TEXT.missing }]);
      expect(available(result.targetEvidence['ghost-text']!.resolution) && result.targetEvidence['ghost-text']!.resolution.value.selectionStatus).toBe(
        'not-found',
      );
    });

    it('reports ambiguous when exact text appears on multiple elements', async () => {
      const result = await resolve('dup-text', [{ kind: 'text', text: OBSERVATION_FIXTURE_TEXT.duplicate }]);
      expect(available(result.targetEvidence['dup-text']!.resolution) && result.targetEvidence['dup-text']!.resolution.value.selectionStatus).toBe(
        'ambiguous',
      );
    });

    it('does not accidentally substring-match a longer exact-text target against a shorter configured text', async () => {
      // "Duplicate Text" (2 elements) must not match a text locator configured for
      // "Distinctive Exact Text" (1 element) or vice versa - exact means exact.
      const result = await resolve('no-substring', [{ kind: 'text', text: OBSERVATION_FIXTURE_TEXT.unique }]);
      expect(
        available(result.targetEvidence['no-substring']!.resolution) && result.targetEvidence['no-substring']!.resolution.value.selectionStatus,
      ).toBe('matched');
      expect(available(result.targetEvidence['no-substring']!.resolution) && result.targetEvidence['no-substring']!.resolution.value.attempts).toEqual([
        { locatorIndex: 0, locatorKind: 'text', status: 'matched', matchCount: 1 },
      ]);
    });
  });

  describe('fallback across mixed locator kinds', () => {
    it('a missing role locator falls back to a unique css locator', async () => {
      const result = await resolve('mixed-fallback', [
        { kind: 'role', role: OBSERVATION_FIXTURE_ROLE.missingRole },
        { kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header },
      ]);
      expect(available(result.targetEvidence['mixed-fallback']!.resolution) && result.targetEvidence['mixed-fallback']!.resolution.value).toMatchObject({
        selectionStatus: 'matched',
        selectedLocatorKind: 'css',
        selectedLocatorIndex: 1,
        usedFallback: true,
        confidence: 'exact',
      });
      expect(
        available(result.targetEvidence['mixed-fallback']!.resolution) && result.targetEvidence['mixed-fallback']!.resolution.value.attempts.map((a) => a.status),
      ).toEqual(['not-found', 'matched']);
    });

    it('multi-step fallback: two not-found locators then a unique match', async () => {
      const result = await resolve('multi-fallback', [
        { kind: 'id', value: OBSERVATION_FIXTURE_IDS.missing },
        { kind: 'role', role: OBSERVATION_FIXTURE_ROLE.missingRole },
        { kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header },
      ]);
      expect(available(result.targetEvidence['multi-fallback']!.resolution) && result.targetEvidence['multi-fallback']!.resolution.value).toMatchObject({
        selectionStatus: 'matched',
        selectedLocatorIndex: 2,
        usedFallback: true,
      });
      expect(
        available(result.targetEvidence['multi-fallback']!.resolution) && result.targetEvidence['multi-fallback']!.resolution.value.attempts.map((a) => a.status),
      ).toEqual(['not-found', 'not-found', 'matched']);
    });
  });

  describe('ambiguity never falls back, across locator kinds', () => {
    it('an ambiguous role locator stops immediately even though a later id locator would uniquely match', async () => {
      const result = await resolve('ambiguous-then-unique', [
        { kind: 'role', role: OBSERVATION_FIXTURE_ROLE.duplicateRole, name: OBSERVATION_FIXTURE_ROLE.duplicateName },
        { kind: 'id', value: OBSERVATION_FIXTURE_IDS.header },
      ]);
      const resolution = available(result.targetEvidence['ambiguous-then-unique']!.resolution) && result.targetEvidence['ambiguous-then-unique']!.resolution.value;
      expect(resolution).toMatchObject({ selectionStatus: 'ambiguous', usedFallback: false, confidence: 'none' });
      expect(resolution && resolution.attempts).toHaveLength(1);
      expect(resolution && resolution.attempts[0]).toMatchObject({ locatorIndex: 0, locatorKind: 'role', status: 'ambiguous' });
    });
  });

  describe('unavailable locator evaluation never falls back', () => {
    it('a syntactically invalid CSS locator is unavailable, not not-found, and does not fall back to a later valid locator', async () => {
      const result = await resolve('bad-selector', [
        { kind: 'css', selector: '[' },
        { kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header },
      ]);
      const resolution = available(result.targetEvidence['bad-selector']!.resolution) && result.targetEvidence['bad-selector']!.resolution.value;
      expect(resolution).toMatchObject({ selectionStatus: 'unavailable', usedFallback: false, confidence: 'none' });
      expect(resolution && resolution.attempts).toHaveLength(1);
      expect(resolution && resolution.attempts[0]).toMatchObject({ locatorIndex: 0, locatorKind: 'css', status: 'unavailable' });
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'browser-evidence-unavailable', targetName: 'bad-selector' }));
    });
  });

  describe('hidden target via a non-CSS locator', () => {
    it('an id locator resolves a hidden element as matched, visible=false, with a target-hidden warning', async () => {
      const result = await resolve('hidden-by-id', [{ kind: 'id', value: OBSERVATION_FIXTURE_IDS.hidden }]);
      const hidden = result.targetEvidence['hidden-by-id']!;
      expect(available(hidden.resolution) && hidden.resolution.value.selectionStatus).toBe('matched');
      expect(available(hidden.visibility) && hidden.visibility.value.visible).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'target-hidden', severity: 'warning', targetName: 'hidden-by-id' }));
    });
  });

  describe('cross-locator measurement equivalence', () => {
    it('the same button resolved by role, id, text, and css produces equivalent measurement evidence', async () => {
      const [byRole, byId, byText, byCss] = await Promise.all([
        resolve('via-role', [{ kind: 'role', role: OBSERVATION_FIXTURE_ROLE.buttonRole, name: OBSERVATION_FIXTURE_ROLE.buttonName }]),
        resolve('via-id', [{ kind: 'id', value: OBSERVATION_FIXTURE_IDS.button }]),
        resolve('via-text', [{ kind: 'text', text: OBSERVATION_FIXTURE_ROLE.buttonName }]),
        resolve('via-css', [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.button }]),
      ]);

      const records = [byRole.targetEvidence['via-role']!, byId.targetEvidence['via-id']!, byText.targetEvidence['via-text']!, byCss.targetEvidence['via-css']!];

      for (const record of records) {
        expect(available(record.tag) && record.tag.value).toBe('button');
        expect(available(record.geometry) && record.geometry.value).toEqual(OBSERVATION_FIXTURE_BUTTON_GEOMETRY);
        expect(available(record.visibility) && record.visibility.value.visible).toBe(true);
        expect(available(record.semantics) && record.semantics.value).toEqual({ role: 'button', name: 'Submit' });
      }
    });
  });
});
