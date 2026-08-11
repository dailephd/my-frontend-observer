import { describe, expect, it } from 'vitest';
import { isValidEvidenceField } from '../../src/domain/evidence.js';

describe('isValidEvidenceField', () => {
  it('TST-012: enforces the "available" combination invariant', () => {
    expect(isValidEvidenceField({ state: 'available', source: 'browser', value: 42 })).toBe(true);
    expect(isValidEvidenceField({ state: 'available', source: 'browser' })).toBe(false);
  });

  it('TST-013: enforces the "unavailable"/"not-applicable" combination invariants', () => {
    expect(isValidEvidenceField({ state: 'unavailable', reason: 'timed out' })).toBe(true);
    expect(isValidEvidenceField({ state: 'unavailable', reason: 'timed out', value: 1 })).toBe(false);
    expect(isValidEvidenceField({ state: 'not-applicable' })).toBe(true);
  });

  it('TST-014: enforces derivedFrom iff source is "derived"', () => {
    expect(isValidEvidenceField({ state: 'available', source: 'derived', value: 1, derivedFrom: ['a'] })).toBe(true);
    expect(isValidEvidenceField({ state: 'available', source: 'derived', value: 1 })).toBe(false);
    expect(isValidEvidenceField({ state: 'available', source: 'browser', value: 1, derivedFrom: ['a'] })).toBe(false);
  });

  it('TST-015: rejects unrecognized evidence states', () => {
    expect(isValidEvidenceField({ state: 'unknown' })).toBe(false);
  });

  it('TST-016: rejects unrecognized evidence sources', () => {
    expect(isValidEvidenceField({ state: 'available', source: 'server', value: 1 })).toBe(false);
  });
});
