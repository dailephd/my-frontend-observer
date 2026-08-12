import { createHash, randomBytes } from 'node:crypto';
import type { NormalizedObservationRequest } from '../request/request.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => [key, canonicalize(entryValue)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Pure function of {targetUrl, viewport, targets (order preserved -
 * semantic), readiness.condition, scrollScenario} only. timeoutMs,
 * readiness.timeoutMs, and outputLocation never affect the result - this is
 * the frozen definition of "same configuration" for this batch. A request
 * with no `scrollScenario` omits the key entirely (rather than setting it to
 * `undefined`) so the v0.2 identity for scenario-less requests is unchanged
 * by this v0.3 extension. Only the requested action configuration
 * participates - never runtime scroll results, movement success/failure, or
 * scroll-owner interpretation, which are runtime evidence, not identity.
 */
export function buildRequestIdentity(request: NormalizedObservationRequest): string {
  const semanticView = {
    targetUrl: request.targetUrl,
    viewport: { width: request.viewport.width, height: request.viewport.height },
    targets: request.targets.map((target) => ({ name: target.name.toLowerCase(), locators: target.locators })),
    readinessCondition: request.readiness.condition,
    ...(request.scrollScenario ? { scrollScenario: request.scrollScenario } : {}),
  };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Fresh, opaque per-call identity - never derived from capturedAt/Date.now(),
 * never collides even when called twice within the same millisecond.
 */
export function buildObservationIdentity(requestIdentity: string): string {
  const nonce = randomBytes(16).toString('hex');
  return `${requestIdentity}-${nonce}`;
}
