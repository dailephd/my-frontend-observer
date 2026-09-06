import { describe, expect, it } from 'vitest';
import {
  STATE_LABEL_PATTERN,
  AUTHENTICATED_STATE_VALUES,
  isValidStateLabel,
  isValidAuthenticatedState,
  isValidExplicitStateDimensions,
} from '../../src/domain/explicitState.js';

describe('isValidStateLabel', () => {
  it('accepts a bounded alphanumeric/dash/underscore label', () => {
    expect(isValidStateLabel('dark')).toBe(true);
    expect(isValidStateLabel('one-dark_2')).toBe(true);
  });

  it('rejects an empty label, an over-length label, and non-strings', () => {
    expect(isValidStateLabel('')).toBe(false);
    expect(isValidStateLabel('a'.repeat(65))).toBe(false);
    expect(isValidStateLabel(42)).toBe(false);
    expect(isValidStateLabel(undefined)).toBe(false);
  });

  it('never fuzzy-matches - distinct labels are distinct, full stop', () => {
    expect('dark' === 'one-dark').toBe(false);
    expect(STATE_LABEL_PATTERN.test('dark')).toBe(true);
    expect(STATE_LABEL_PATTERN.test('one-dark')).toBe(true);
  });
});

describe('isValidAuthenticatedState', () => {
  it('accepts only the closed vocabulary', () => {
    for (const value of AUTHENTICATED_STATE_VALUES) {
      expect(isValidAuthenticatedState(value)).toBe(true);
    }
  });

  it('rejects anything outside the closed vocabulary, including near-misses', () => {
    expect(isValidAuthenticatedState('logged-in')).toBe(false);
    expect(isValidAuthenticatedState('Authenticated')).toBe(false);
    expect(isValidAuthenticatedState('')).toBe(false);
    expect(isValidAuthenticatedState(null)).toBe(false);
  });
});

describe('isValidExplicitStateDimensions', () => {
  it('accepts a single declared dimension', () => {
    expect(isValidExplicitStateDimensions({ theme: 'dark' })).toEqual({ valid: true });
    expect(isValidExplicitStateDimensions({ applicationState: 'cart-empty' })).toEqual({ valid: true });
    expect(isValidExplicitStateDimensions({ authenticatedState: 'authenticated' })).toEqual({ valid: true });
  });

  it('accepts all three dimensions declared together', () => {
    expect(
      isValidExplicitStateDimensions({ theme: 'dark', applicationState: 'cart-empty', authenticatedState: 'unauthenticated' }),
    ).toEqual({ valid: true });
  });

  it('rejects a non-object value', () => {
    expect(isValidExplicitStateDimensions('dark').valid).toBe(false);
    expect(isValidExplicitStateDimensions(null).valid).toBe(false);
    expect(isValidExplicitStateDimensions([]).valid).toBe(false);
  });

  it('rejects an empty object - at least one dimension must be declared', () => {
    const result = isValidExplicitStateDimensions({});
    expect(result.valid).toBe(false);
  });

  it('rejects an unsupported field, refusing to become an arbitrary metadata bag', () => {
    const result = isValidExplicitStateDimensions({ theme: 'dark', locale: 'en-US' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('locale');
  });

  it('rejects an invalid theme label, application state label, or authenticatedState value', () => {
    expect(isValidExplicitStateDimensions({ theme: '' }).valid).toBe(false);
    expect(isValidExplicitStateDimensions({ applicationState: 'a'.repeat(65) }).valid).toBe(false);
    expect(isValidExplicitStateDimensions({ authenticatedState: 'logged-in' }).valid).toBe(false);
  });
});
