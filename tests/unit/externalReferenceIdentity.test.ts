import { describe, expect, it } from 'vitest';
import { buildExternalReferenceRequestIdentity, buildExternalReferenceInstanceIdentity } from '../../src/domain/externalReferenceIdentity.js';

describe('externalReferenceIdentity', () => {
  // TST-006: request identity is a pure function of semantic content only - path-independent by construction (it never takes a path argument at all).
  it('TST-006: identical semantic content produces the identical request identity', () => {
    const a = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600);
    const b = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600);
    expect(a).toBe(b);
  });

  // TST-007: any identity-bearing field change changes the identity, including the supersedesReferenceId.
  it('TST-007: changing any identity-bearing field changes the request identity', () => {
    const base = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600);
    expect(buildExternalReferenceRequestIdentity('def456', 'png', 800, 600)).not.toBe(base);
    expect(buildExternalReferenceRequestIdentity('abc123', 'jpeg', 800, 600)).not.toBe(base);
    expect(buildExternalReferenceRequestIdentity('abc123', 'png', 801, 600)).not.toBe(base);
    expect(buildExternalReferenceRequestIdentity('abc123', 'png', 800, 601)).not.toBe(base);
    const withSupersedes = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, 'some-prior-reference-id');
    expect(withSupersedes).not.toBe(base);
    expect(buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, 'a-different-prior-id')).not.toBe(withSupersedes);
  });

  // TST-008: instance identity is fresh (nonce-based) on every call, even for the identical requestId, and is never derived purely from a timestamp.
  it('TST-008: instance identity is fresh per call and prefixed by the request identity', () => {
    const requestId = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600);
    const first = buildExternalReferenceInstanceIdentity(requestId);
    const second = buildExternalReferenceInstanceIdentity(requestId);
    expect(first).not.toBe(second);
    expect(first.startsWith(`${requestId}-`)).toBe(true);
    expect(second.startsWith(`${requestId}-`)).toBe(true);
  });
});
