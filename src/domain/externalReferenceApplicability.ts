/**
 * v0.7 Prompt 4 reference applicability - the runtime frontend state that an
 * external reference image is intended to represent, so a later candidate
 * comparison can honestly determine whether the reference and a candidate
 * describe the same state (see domain/externalReferenceCompatibility.ts).
 *
 * `viewport` here is deliberately distinct from the reference image's own
 * pixel dimensions (`ExternalReferenceImageReference.width/height` in
 * externalReference.ts): a reference image may be captured at any
 * resolution/DPI, but `applicability.viewport` describes the CSS-pixel
 * runtime viewport the design represents (e.g. a 960x1240 reference image
 * showing a 480x620 CSS-pixel mobile layout at 2x device pixel ratio). This
 * module never reads or infers a viewport from image dimensions.
 */
import type { ExplicitStateDimensions } from './explicitState.js';
import { isValidStateLabel, isValidAuthenticatedState, STATE_LABEL_PATTERN, AUTHENTICATED_STATE_VALUES } from './explicitState.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Intentionally mirrors request/request.ts's VIEWPORT_MIN/MAX values (200/3840) as independently-owned constants - the applicable viewport describes the same kind of CSS-pixel runtime viewport an observation request configures, so the same bounds apply, but this module has no import dependency on request/request.ts. */
export const APPLICABLE_VIEWPORT_MIN = 200;
export const APPLICABLE_VIEWPORT_MAX = 3840;

export interface ApplicableViewport {
  width: number;
  height: number;
}

export function isValidApplicableViewport(value: unknown): value is ApplicableViewport {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== 2) return false;
  return isInRange(value.width, APPLICABLE_VIEWPORT_MIN, APPLICABLE_VIEWPORT_MAX) && isInRange(value.height, APPLICABLE_VIEWPORT_MIN, APPLICABLE_VIEWPORT_MAX);
}

/** Every field independently optional - a reference need not declare every applicability dimension, and an unset dimension is never treated as a wildcard match nor a mismatch (see externalReferenceCompatibility.ts's unassessed semantics). */
export interface ExternalReferenceApplicability extends ExplicitStateDimensions {
  viewport?: ApplicableViewport;
}

const APPLICABILITY_KEYS = ['viewport', 'theme', 'applicationState', 'authenticatedState'];

export type ApplicabilityValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Deliberately its own validator rather than a reuse of
 * isValidExplicitStateDimensions: that function requires at least one of its
 * three fields, which would incorrectly reject an applicability object that
 * declares only `viewport` (a fully valid, common case - a reference may
 * constrain viewport without constraining theme/state at all). The three
 * shared state-label/authenticated-state checks are reused field-by-field
 * instead.
 */
export function isValidExternalReferenceApplicability(value: unknown): ApplicabilityValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'must be an object' };
  const unknownKeys = Object.keys(value).filter((key) => !APPLICABILITY_KEYS.includes(key));
  if (unknownKeys.length > 0) return { valid: false, reason: `has unsupported field(s): ${unknownKeys.join(', ')}` };

  const hasViewport = 'viewport' in value && value.viewport !== undefined;
  if (hasViewport && !isValidApplicableViewport(value.viewport)) {
    return { valid: false, reason: `viewport must be { width, height } integers in [${APPLICABLE_VIEWPORT_MIN}, ${APPLICABLE_VIEWPORT_MAX}]` };
  }
  if ('theme' in value && value.theme !== undefined && !isValidStateLabel(value.theme)) {
    return { valid: false, reason: `theme must match ${STATE_LABEL_PATTERN}` };
  }
  if ('applicationState' in value && value.applicationState !== undefined && !isValidStateLabel(value.applicationState)) {
    return { valid: false, reason: `applicationState must match ${STATE_LABEL_PATTERN}` };
  }
  if ('authenticatedState' in value && value.authenticatedState !== undefined && !isValidAuthenticatedState(value.authenticatedState)) {
    return { valid: false, reason: `authenticatedState must be one of ${AUTHENTICATED_STATE_VALUES.join(', ')}` };
  }
  if (Object.keys(value).length === 0) {
    return { valid: false, reason: 'must declare at least one dimension (viewport, theme, applicationState, or authenticatedState)' };
  }
  return { valid: true };
}
