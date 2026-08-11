import { describe, expect, it } from 'vitest';
import { normalizeOutputLocation } from '../../src/request/paths.js';

describe('normalizeOutputLocation', () => {
  it('TST-011: rejects non-portable forms and normalizes portable ones', () => {
    expect(normalizeOutputLocation('C:/Users/x/out').ok).toBe(false);
    expect(normalizeOutputLocation('/abs/path').ok).toBe(false);
    expect(normalizeOutputLocation('a/../b').ok).toBe(false);

    const backslashes = normalizeOutputLocation('a\\b\\c');
    expect(backslashes.ok).toBe(true);
    if (backslashes.ok) expect(backslashes.value).toBe('a/b/c');

    const dotSegments = normalizeOutputLocation('./a/./b/');
    expect(dotSegments.ok).toBe(true);
    if (dotSegments.ok) expect(dotSegments.value).toBe('a/b');
  });
});
