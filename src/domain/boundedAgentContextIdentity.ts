import { createHash, randomBytes } from 'node:crypto';
import type { BoundedAgentContextSourceReferences, ProjectionProfile } from './boundedAgentContext.js';

/**
 * Deliberately duplicated from domain/identity.ts#canonicalize (and its other
 * per-module duplicates) rather than imported - each identity module owns its
 * own private canonicalize per existing repository convention. Same
 * algorithm (sorted object keys, order-preserving arrays).
 */
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
 * Pure function of {sources (arrays sorted - order carries no semantic
 * meaning here), targetIds (sorted), projectionProfile, fidelity?} only.
 * Never includes an operational output location, a captured timestamp, or
 * contextId - an operational output path must never affect logical
 * identity, and equivalent semantic input must always produce the same
 * identity regardless of the order targets were originally supplied in.
 *
 * `fidelity` (v0.7 Prompt 7 addition) is omitted from the hashed semantic
 * view entirely when `undefined` (never included as `null`), so every
 * pre-Prompt-7 call site - and any later call that legitimately supplies no
 * fidelity evidence - keeps producing the exact byte-identical hash it
 * always did. When present, it is the caller's already-derived, bounded
 * `BoundedReferenceFidelityProjection` (canonicalized like any other nested
 * semantic value) - not the raw Prompt 6 evaluation - so identity changes
 * exactly when the *content a caller would actually receive* changes,
 * never merely because an internal, unselected requirement result changed.
 */
export function buildBoundedAgentContextRequestIdentity(
  sources: BoundedAgentContextSourceReferences,
  targetIds: readonly string[],
  projectionProfile: ProjectionProfile,
  fidelity?: unknown,
): string {
  const semanticView = {
    sources: {
      observationIds: [...sources.observationIds].sort(),
      comparisonId: sources.comparisonId ?? null,
      comparisonRequestId: sources.comparisonRequestId ?? null,
      baselineContractId: sources.baselineContractId ?? null,
      changeContractId: sources.changeContractId ?? null,
      evaluationId: sources.evaluationId ?? null,
      evaluationRequestId: sources.evaluationRequestId ?? null,
      // referenceId/referenceRequestId (v0.7 Prompt 7) are omitted entirely when absent - never
      // defaulted to null like the pre-existing fields above - so a caller supplying no reference
      // evidence produces the exact same hash a pre-Prompt-7 call site always did.
      ...(sources.referenceId !== undefined ? { referenceId: sources.referenceId } : {}),
      ...(sources.referenceRequestId !== undefined ? { referenceRequestId: sources.referenceRequestId } : {}),
    },
    targetIds: [...targetIds].sort(),
    projectionProfile,
    ...(fidelity !== undefined ? { fidelity } : {}),
  };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Fresh, opaque per-generated-instance identity - never derived from a
 * timestamp alone, never collides even when called twice with the same
 * requestIdentity within the same millisecond.
 */
export function buildBoundedAgentContextInstanceIdentity(requestIdentity: string): string {
  const nonce = randomBytes(16).toString('hex');
  return `${requestIdentity}-${nonce}`;
}
