import { describe, expect, it } from 'vitest';
import {
  buildFrontendContractRequestIdentity,
  buildFrontendContractInstanceIdentity,
  buildClauseIdentity,
} from '../../src/domain/frontendContractIdentity.js';
import type { ContractPrimitive } from '../../src/domain/frontendContracts.js';

const visiblePrimitive: ContractPrimitive = { kind: 'target-visible', target: 'workspace' };
const widerPrimitive: ContractPrimitive = { kind: 'target-wider-than', targetA: 'workspace', targetB: 'sidebar' };

describe('buildFrontendContractRequestIdentity', () => {
  it('is deterministic for structurally-identical clause sets (TST-013)', () => {
    const a = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    const b = buildFrontendContractRequestIdentity('obs-1', [{ primitive: { kind: 'target-visible', target: 'workspace' } }], []);
    expect(a).toBe(b);
  });

  it('changes when the source observation id changes', () => {
    const a = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    const b = buildFrontendContractRequestIdentity('obs-2', [{ primitive: visiblePrimitive }], []);
    expect(a).not.toBe(b);
  });

  it('changes when a clause primitive differs', () => {
    const a = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    const b = buildFrontendContractRequestIdentity('obs-1', [{ primitive: widerPrimitive }], []);
    expect(a).not.toBe(b);
  });

  it('changes when supersedes ids differ', () => {
    const a = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    const b = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], ['baseline-a']);
    expect(a).not.toBe(b);
  });

  it('is insensitive to supersedes-array ordering (sorted before hashing)', () => {
    const a = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], ['baseline-a', 'baseline-b']);
    const b = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], ['baseline-b', 'baseline-a']);
    expect(a).toBe(b);
  });

  it('is not affected by operational filesystem-path-like values (no path parameter exists to include)', () => {
    const a = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    const b = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    expect(a).toBe(b);
  });
});

describe('buildFrontendContractInstanceIdentity', () => {
  it('is fresh and never collides across 1000 calls with the same requestIdentity (TST-013)', () => {
    const requestIdentity = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(buildFrontendContractInstanceIdentity(requestIdentity));
    }
    expect(ids.size).toBe(1000);
  });

  it('always incorporates the supplied requestIdentity as a prefix', () => {
    const requestIdentity = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    const instanceId = buildFrontendContractInstanceIdentity(requestIdentity);
    expect(instanceId.startsWith(requestIdentity)).toBe(true);
  });

  it('is never derived from a timestamp alone', () => {
    const requestIdentity = buildFrontendContractRequestIdentity('obs-1', [{ primitive: visiblePrimitive }], []);
    const isoTimestampRe = /^\d{4}-\d{2}-\d{2}T/;
    const id = buildFrontendContractInstanceIdentity(requestIdentity);
    expect(isoTimestampRe.test(id)).toBe(false);
  });
});

describe('buildClauseIdentity', () => {
  it('is deterministic for structurally-identical primitive+tolerance pairs (TST-013)', () => {
    const a = buildClauseIdentity(visiblePrimitive, undefined);
    const b = buildClauseIdentity({ kind: 'target-visible', target: 'workspace' }, undefined);
    expect(a).toBe(b);
  });

  it('changes when the primitive differs', () => {
    const a = buildClauseIdentity(visiblePrimitive, undefined);
    const b = buildClauseIdentity(widerPrimitive, undefined);
    expect(a).not.toBe(b);
  });

  it('changes when tolerance is added', () => {
    const a = buildClauseIdentity(visiblePrimitive, undefined);
    const b = buildClauseIdentity(visiblePrimitive, { kind: 'absolute-px', amount: 2 });
    expect(a).not.toBe(b);
  });
});
