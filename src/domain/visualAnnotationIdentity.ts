import { createHash, randomBytes } from 'node:crypto';
import type { VisualAnnotationItem, VisualAnnotationSource } from './visualAnnotation.js';

/**
 * Deliberately duplicated from domain/identity.ts#canonicalize (itself
 * duplicated across comparisonIdentity.ts/frontendContractIdentity.ts/
 * externalReferenceIdentity.ts) rather than imported - each identity module
 * owns its own private canonicalize per existing repository convention. Same
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
 * Pure function of {source, items, supersedes} - the canonical source
 * identity and coordinate domain/dimensions, every item's mark, association,
 * and interpretation (in authored array order), and the explicitly
 * superseded annotation (if any). Never includes createdAt, an output
 * location, cwd, project root, a mutable alias, a viewer port or HTTP
 * handle, a temporary path, the overlay digest, or annotationId: saving
 * identical semantic content twice produces the same request identity.
 */
export function buildVisualAnnotationRequestIdentity(
  source: VisualAnnotationSource,
  items: readonly VisualAnnotationItem[],
  supersedesAnnotationId?: string,
): string {
  const semanticView = {
    source,
    items,
    supersedes: supersedesAnnotationId ?? null,
  };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Fresh, opaque per-persisted-instance identity - never derived from a
 * timestamp, never collides even when called twice with the same
 * annotationRequestId within the same millisecond.
 */
export function buildVisualAnnotationInstanceIdentity(annotationRequestId: string): string {
  const nonce = randomBytes(16).toString('hex');
  return `${annotationRequestId}-${nonce}`;
}
