import type { Diagnostic } from '../domain/diagnostics.js';

export type NormalizeOutputLocationResult = { ok: true; value: string } | { ok: false; diagnostic: Diagnostic };

const DRIVE_LETTER_RE = /^[A-Za-z]:\//;

/**
 * Portable, relative, forward-slash logical path only: no drive letter, no
 * leading "/", no ".." segment. Backslashes are converted to forward slashes
 * before validation. Never touches the real filesystem.
 */
export function normalizeOutputLocation(raw: string): NormalizeOutputLocationResult {
  const withForwardSlashes = raw.replace(/\\/g, '/');

  if (withForwardSlashes.startsWith('/') || DRIVE_LETTER_RE.test(withForwardSlashes)) {
    return {
      ok: false,
      diagnostic: {
        code: 'invalid-request',
        severity: 'error',
        message: 'outputLocation must be a relative, portable path (no drive letter or leading "/")',
      },
    };
  }

  const segments = withForwardSlashes.split('/');
  if (segments.some((segment) => segment === '..')) {
    return {
      ok: false,
      diagnostic: {
        code: 'invalid-request',
        severity: 'error',
        message: 'outputLocation must not contain ".." segments',
      },
    };
  }

  const cleaned = segments.filter((segment) => segment.length > 0 && segment !== '.');
  return { ok: true, value: cleaned.length > 0 ? cleaned.join('/') : '.' };
}
