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
 * meaning here), targetIds (sorted), projectionProfile} only. Never includes
 * an operational output location, a captured timestamp, or contextId - an
 * operational output path must never affect logical identity, and equivalent
 * semantic input must always produce the same identity regardless of the
 * order targets were originally supplied in.
 */
export function buildBoundedAgentContextRequestIdentity(
  sources: BoundedAgentContextSourceReferences,
  targetIds: readonly string[],
  projectionProfile: ProjectionProfile,
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
    },
    targetIds: [...targetIds].sort(),
    projectionProfile,
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
