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
        { name: 'a', selector: '.a' },
        { name: 'b', selector: '.b' },
      ],
    });
    const reversed = baseRequest({
      targets: [
        { name: 'b', selector: '.b' },
        { name: 'a', selector: '.a' },
      ],
    });
    expect(buildRequestIdentity(forward)).not.toBe(buildRequestIdentity(reversed));
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
