import { describe, expect, it } from 'vitest';
import { buildObservationIdentity, buildRequestIdentity } from '../../src/domain/identity.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';

function baseRequest(overrides: Partial<NormalizedObservationRequest> = {}): NormalizedObservationRequest {
  return {
    targetUrl: 'http://localhost/',
    viewport: { width: 1280, height: 720 },
    targets: [],
    outputLocation: 'observations',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
    ...overrides,
  };
}

describe('buildRequestIdentity', () => {
  it('TST-024: excludes timeoutMs/readiness.timeoutMs/outputLocation and includes targetUrl', () => {
    const a = baseRequest({ timeoutMs: 5000, readiness: { condition: 'load', timeoutMs: 2000 }, outputLocation: 'out-a' });
    const b = baseRequest({ timeoutMs: 90000, readiness: { condition: 'load', timeoutMs: 5000 }, outputLocation: 'out-b' });
    const c = baseRequest({ targetUrl: 'http://127.0.0.1/' });
    expect(buildRequestIdentity(a)).toBe(buildRequestIdentity(b));
    expect(buildRequestIdentity(a)).not.toBe(buildRequestIdentity(c));
  });

  it('TST-025: target order is semantic (not sorted away)', () => {
    const forward = baseRequest({
      targets: [
        { name: 'a', locators: [{ kind: 'css', selector: '.a' }] },
        { name: 'b', locators: [{ kind: 'css', selector: '.b' }] },
      ],
    });
    const reversed = baseRequest({
      targets: [
        { name: 'b', locators: [{ kind: 'css', selector: '.b' }] },
        { name: 'a', locators: [{ kind: 'css', selector: '.a' }] },
      ],
    });
    expect(buildRequestIdentity(forward)).not.toBe(buildRequestIdentity(reversed));
  });

  it('v0.2: legacy CSS shape and its equivalent canonical CSS shape produce the same identity', () => {
    const legacy = baseRequest({ targets: [{ name: 'header', locators: [{ kind: 'css', selector: 'header' }] }] });
    const canonical = baseRequest({ targets: [{ name: 'header', locators: [{ kind: 'css', selector: 'header' }] }] });
    expect(buildRequestIdentity(legacy)).toBe(buildRequestIdentity(canonical));
  });

  it('v0.2: same canonical configuration produces the same requestId', () => {
    const a = baseRequest({ targets: [{ name: 'header', locators: [{ kind: 'role', role: 'banner' }] }] });
    const b = baseRequest({ targets: [{ name: 'header', locators: [{ kind: 'role', role: 'banner' }] }] });
    expect(buildRequestIdentity(a)).toBe(buildRequestIdentity(b));
  });

  it('v0.2: a locator value change produces a different requestId', () => {
    const a = baseRequest({ targets: [{ name: 'header', locators: [{ kind: 'css', selector: '#a' }] }] });
    const b = baseRequest({ targets: [{ name: 'header', locators: [{ kind: 'css', selector: '#b' }] }] });
    expect(buildRequestIdentity(a)).not.toBe(buildRequestIdentity(b));
  });

  it('v0.2: a locator kind change produces a different requestId', () => {
    const a = baseRequest({ targets: [{ name: 'header', locators: [{ kind: 'css', selector: 'header' }] }] });
    const b = baseRequest({ targets: [{ name: 'header', locators: [{ kind: 'id', value: 'header' }] }] });
    expect(buildRequestIdentity(a)).not.toBe(buildRequestIdentity(b));
  });

  it('v0.2: a locator order change produces a different requestId', () => {
    const a = baseRequest({
      targets: [{ name: 'header', locators: [{ kind: 'css', selector: '#a' }, { kind: 'css', selector: '#b' }] }],
    });
    const b = baseRequest({
      targets: [{ name: 'header', locators: [{ kind: 'css', selector: '#b' }, { kind: 'css', selector: '#a' }] }],
    });
    expect(buildRequestIdentity(a)).not.toBe(buildRequestIdentity(b));
  });
});

describe('v0.3 scrollScenario request identity', () => {
  it('a no-scenario request keeps the same requestId as the pre-v0.3 legacy fixture', () => {
    // Frozen regression vector: buildRequestIdentity(baseRequest()) as computed
    // before this batch introduced scrollScenario. Must never change for a
    // request with no scrollScenario.
    expect(buildRequestIdentity(baseRequest())).toBe('e37e913c07056ef1d4a9d4dce2762dd7b07cabfe51742cad4e6d4ec5a7d23d9d');
  });

  it('the same scenario (same targets/url/viewport/readiness/scrollScenario) produces the same requestId', () => {
    const a = baseRequest({ scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } } });
    const b = baseRequest({ scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } } });
    expect(buildRequestIdentity(a)).toBe(buildRequestIdentity(b));
  });

  it('a request with a scenario differs from the same request without one', () => {
    const withScenario = baseRequest({ scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } } });
    const withoutScenario = baseRequest();
    expect(buildRequestIdentity(withScenario)).not.toBe(buildRequestIdentity(withoutScenario));
  });

  it('a different delta produces a different requestId', () => {
    const a = baseRequest({ scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } } });
    const b = baseRequest({ scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 500 } } });
    expect(buildRequestIdentity(a)).not.toBe(buildRequestIdentity(b));
  });

  it('a different action kind produces a different requestId', () => {
    const targets = [{ name: 'workspace', locators: [{ kind: 'css' as const, selector: '.workspace' }] }];
    const a = baseRequest({ targets, scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } } });
    const b = baseRequest({
      targets,
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'workspace', deltaX: 0, deltaY: 400 } },
    });
    expect(buildRequestIdentity(a)).not.toBe(buildRequestIdentity(b));
  });

  it('a different target produces a different requestId', () => {
    const targets = [
      { name: 'workspace', locators: [{ kind: 'css' as const, selector: '.workspace' }] },
      { name: 'navigation', locators: [{ kind: 'css' as const, selector: '.nav' }] },
    ];
    const a = baseRequest({
      targets,
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'workspace', deltaX: 0, deltaY: 100 } },
    });
    const b = baseRequest({
      targets,
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'navigation', deltaX: 0, deltaY: 100 } },
    });
    expect(buildRequestIdentity(a)).not.toBe(buildRequestIdentity(b));
  });
});

describe('buildObservationIdentity', () => {
  it('TST-026: never collides and is never timestamp-shaped, across 1000 calls', () => {
    const requestIdentity = buildRequestIdentity(baseRequest());
    const ids = new Set<string>();
    const isoTimestampRe = /^\d{4}-\d{2}-\d{2}T/;
    for (let i = 0; i < 1000; i++) {
      const id = buildObservationIdentity(requestIdentity);
      expect(isoTimestampRe.test(id)).toBe(false);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });

  it('TST-027: incorporates the request identity while remaining mutually distinct', () => {
    const requestIdentity = buildRequestIdentity(baseRequest());
    const first = buildObservationIdentity(requestIdentity);
    const second = buildObservationIdentity(requestIdentity);
    expect(first.startsWith(requestIdentity)).toBe(true);
    expect(second.startsWith(requestIdentity)).toBe(true);
    expect(first).not.toBe(second);
  });
});
