/**
 * v0.7 Prompt 4 explicit frontend-state identity - shared by both
 * ObservationArtifact's `requestConfig.explicitState` (what state a candidate
 * was captured in) and ExternalReferenceArtifact's `applicability` (what
 * state a reference describes). State identity here is always
 * caller/configuration-supplied metadata, never inferred from screenshot
 * pixels, CSS, DOM classes/text, URLs, source code, filenames, accessibility
 * labels, localStorage, or cookies - the observer performs no automatic
 * state detection of any kind. Labels are bounded opaque identities compared
 * by exact, case-sensitive string equality - never fuzzy-matched (`dark` and
 * `one-dark` are different labels, full stop).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Same character/length convention as request/request.ts's target-name pattern and every other bounded opaque identifier in this repository - reused directly for the same "stable, portable, log-safe identifier" reason. */
export const STATE_LABEL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidStateLabel(value: unknown): value is string {
  return typeof value === 'string' && STATE_LABEL_PATTERN.test(value);
}

/**
 * Closed, deliberately tiny vocabulary - this is state identity only, never
 * a place for credentials, tokens, cookies, session ids, or authorization
 * headers. A caller who needs finer-grained authentication context should
 * express it via `applicationState` instead; this dimension exists solely so
 * "authenticated" and "unauthenticated" renders (which are frequently
 * visually distinct) can be declared and compared without conflating them
 * with the open-ended `applicationState` label.
 */
export const AUTHENTICATED_STATE_VALUES = ['authenticated', 'unauthenticated'] as const;
export type AuthenticatedState = (typeof AUTHENTICATED_STATE_VALUES)[number];

export function isValidAuthenticatedState(value: unknown): value is AuthenticatedState {
  return typeof value === 'string' && (AUTHENTICATED_STATE_VALUES as readonly string[]).includes(value);
}

/** Every field is independently optional - a caller may declare only the dimension(s) that matter for a given request/reference. */
export interface ExplicitStateDimensions {
  theme?: string;
  applicationState?: string;
  authenticatedState?: AuthenticatedState;
}

const EXPLICIT_STATE_DIMENSION_KEYS = ['theme', 'applicationState', 'authenticatedState'];

export type ExplicitStateValidationResult = { valid: true } | { valid: false; reason: string };

export function isValidExplicitStateDimensions(value: unknown): ExplicitStateValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'must be an object' };
  const unknownKeys = Object.keys(value).filter((key) => !EXPLICIT_STATE_DIMENSION_KEYS.includes(key));
  if (unknownKeys.length > 0) return { valid: false, reason: `has unsupported field(s): ${unknownKeys.join(', ')}` };
  if ('theme' in value && value.theme !== undefined && !isValidStateLabel(value.theme)) {
    return { valid: false, reason: `theme must match ${STATE_LABEL_PATTERN}` };
  }
  if ('applicationState' in value && value.applicationState !== undefined && !isValidStateLabel(value.applicationState)) {
    return { valid: false, reason: `applicationState must match ${STATE_LABEL_PATTERN}` };
  }
  if ('authenticatedState' in value && value.authenticatedState !== undefined && !isValidAuthenticatedState(value.authenticatedState)) {
    return { valid: false, reason: `authenticatedState must be one of ${AUTHENTICATED_STATE_VALUES.join(', ')}` };
  }
  if (Object.keys(value).length === 0) return { valid: false, reason: 'must declare at least one dimension (theme, applicationState, or authenticatedState)' };
  return { valid: true };
}
