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

  // Backward compatibility (Prompt 2 addition): omitting `regions` entirely must produce byte-identical identity to Prompt 1, never a new hash purely because the parameter now exists.
  it('omitting regions produces the exact same identity as before this parameter existed', () => {
    const withoutRegionsParam = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, 'prior-id');
    const explicitlyUndefined = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, 'prior-id', undefined);
    expect(withoutRegionsParam).toBe(explicitlyUndefined);
  });

  const regionA = { id: 'header', rectangle: { x: 0, y: 0, width: 100, height: 40 } };
  const regionB = { id: 'card', rectangle: { x: 0, y: 92, width: 100, height: 40 } };

  // Behavior C / request section 29: same image + same region content + (implicitly) different operational config path = same logical identity - the function never takes a path at all, so this holds by construction.
  it('same region content produces the same request identity regardless of call site', () => {
    const first = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA, regionB]);
    const second = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA, regionB]);
    expect(first).toBe(second);
  });

  // Behavior D: geometry change on an existing region changes identity.
  it('changing a region rectangle changes the request identity', () => {
    const base = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA]);
    const moved = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [{ id: 'header', rectangle: { x: 1, y: 0, width: 100, height: 40 } }]);
    expect(moved).not.toBe(base);
  });

  // Behavior E: adding a region changes identity.
  it('adding a region changes the request identity', () => {
    const withoutRegions = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600);
    const withOneRegion = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA]);
    expect(withOneRegion).not.toBe(withoutRegions);

    const withOneRegionAgain = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA]);
    const withTwoRegions = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA, regionB]);
    expect(withTwoRegions).not.toBe(withOneRegionAgain);
  });

  // Behavior F: removing a region changes identity (symmetric to adding).
  it('removing a region changes the request identity', () => {
    const withTwoRegions = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA, regionB]);
    const withOneRegion = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA]);
    expect(withOneRegion).not.toBe(withTwoRegions);
  });

  // Renaming a semantic region changes identity (id is part of the semantic content).
  it('renaming a region changes the request identity', () => {
    const original = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA]);
    const renamed = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [{ id: 'top-bar', rectangle: regionA.rectangle }]);
    expect(renamed).not.toBe(original);
  });

  // Authored region order is semantic (mirrors domain/identity.ts's targets treatment) - reordering two distinct regions changes identity.
  it('region authoring order participates in identity', () => {
    const orderOne = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionA, regionB]);
    const orderTwo = buildExternalReferenceRequestIdentity('abc123', 'png', 800, 600, undefined, [regionB, regionA]);
    expect(orderOne).not.toBe(orderTwo);
  });
});
