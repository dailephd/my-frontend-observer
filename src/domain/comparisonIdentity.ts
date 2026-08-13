import { createHash, randomBytes } from 'node:crypto';
import type { ComparisonConfig } from './comparison.js';

/**
 * Deliberately duplicated from domain/identity.ts#canonicalize rather than
 * imported: that module's canonicalize is a private helper for the frozen
 * v0.1 request-identity contract, and this batch does not touch that file.
 * Same algorithm (sorted object keys, order-preserving arrays) so the two
 * identity families stay consistent without coupling their ownership.
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
 * Pure function of {beforeObservationId, afterObservationId, normalized
 * config} only. Direction matters: swapping before/after produces a
 * different identity. Never includes a filesystem path, output location, the
 * comparison result itself, or a captured timestamp.
 */
export function buildComparisonRequestIdentity(beforeObservationId: string, afterObservationId: string, config: ComparisonConfig): string {
  const semanticView = {
    beforeObservationId,
    afterObservationId,
    config: {
      geometryTolerancePx: config.geometryTolerancePx,
      expectedDependencies: config.expectedDependencies ?? [],
    },
  };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Fresh, opaque per-execution identity - never derived from a timestamp
 * alone, never collides even when called twice within the same millisecond.
 */
export function buildComparisonIdentity(comparisonRequestId: string): string {
  const nonce = randomBytes(16).toString('hex');
  return `${comparisonRequestId}-${nonce}`;
}
