import { describe, expect, it } from 'vitest';
import {
  APPLICABLE_VIEWPORT_MIN,
  APPLICABLE_VIEWPORT_MAX,
  isValidApplicableViewport,
  isValidExternalReferenceApplicability,
} from '../../src/domain/externalReferenceApplicability.js';

describe('isValidApplicableViewport', () => {
  it('accepts an in-bounds integer width/height pair', () => {
    expect(isValidApplicableViewport({ width: 1280, height: 720 })).toBe(true);
    expect(isValidApplicableViewport({ width: APPLICABLE_VIEWPORT_MIN, height: APPLICABLE_VIEWPORT_MIN })).toBe(true);
    expect(isValidApplicableViewport({ width: APPLICABLE_VIEWPORT_MAX, height: APPLICABLE_VIEWPORT_MAX })).toBe(true);
  });

  it('rejects out-of-bound, non-integer, negative, or missing dimensions', () => {
    expect(isValidApplicableViewport({ width: APPLICABLE_VIEWPORT_MIN - 1, height: 720 })).toBe(false);
    expect(isValidApplicableViewport({ width: APPLICABLE_VIEWPORT_MAX + 1, height: 720 })).toBe(false);
    expect(isValidApplicableViewport({ width: 1280.5, height: 720 })).toBe(false);
    expect(isValidApplicableViewport({ width: -1280, height: 720 })).toBe(false);
    expect(isValidApplicableViewport({ width: 1280 })).toBe(false);
    expect(isValidApplicableViewport({ width: 1280, height: 720, extra: 1 })).toBe(false);
    expect(isValidApplicableViewport(null)).toBe(false);
  });
});

describe('isValidExternalReferenceApplicability', () => {
  it('accepts a viewport-only applicability object (no state dimension required)', () => {
    expect(isValidExternalReferenceApplicability({ viewport: { width: 1280, height: 720 } })).toEqual({ valid: true });
  });

  it('accepts a state-only applicability object (no viewport required)', () => {
    expect(isValidExternalReferenceApplicability({ theme: 'dark' })).toEqual({ valid: true });
  });

  it('accepts viewport and all state dimensions declared together', () => {
    expect(
      isValidExternalReferenceApplicability({
        viewport: { width: 1280, height: 720 },
        theme: 'dark',
        applicationState: 'cart-empty',
        authenticatedState: 'authenticated',
      }),
    ).toEqual({ valid: true });
  });

  it('rejects an empty applicability object', () => {
    expect(isValidExternalReferenceApplicability({}).valid).toBe(false);
  });

  it('rejects a non-object value', () => {
    expect(isValidExternalReferenceApplicability(null).valid).toBe(false);
    expect(isValidExternalReferenceApplicability('dark').valid).toBe(false);
  });

  it('rejects an unsupported field', () => {
    const result = isValidExternalReferenceApplicability({ theme: 'dark', browser: 'chrome' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('browser');
  });

  it('rejects an invalid viewport nested inside an otherwise-valid applicability object', () => {
    expect(isValidExternalReferenceApplicability({ viewport: { width: 10, height: 10 }, theme: 'dark' }).valid).toBe(false);
  });

  it('rejects an invalid theme, applicationState, or authenticatedState', () => {
    expect(isValidExternalReferenceApplicability({ theme: '' }).valid).toBe(false);
    expect(isValidExternalReferenceApplicability({ applicationState: 'a'.repeat(65) }).valid).toBe(false);
    expect(isValidExternalReferenceApplicability({ authenticatedState: 'logged-in' }).valid).toBe(false);
  });
});
