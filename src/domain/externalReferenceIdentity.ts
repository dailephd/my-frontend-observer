import { createHash, randomBytes } from 'node:crypto';
import type { ExternalReferenceImageFormat } from './externalReferenceImage.js';

/**
 * Deliberately duplicated from domain/identity.ts#canonicalize (itself
 * duplicated across comparisonIdentity.ts/frontendContractIdentity.ts) rather
 * than imported - each identity module owns its own private canonicalize per
 * existing repository convention. Same algorithm (sorted object keys,
 * order-preserving arrays).
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
 * Pure function of {imageSha256, format, width, height, supersedesReferenceId}
 * only - the semantic content of the reference image plus which prior
 * reference (if any) it explicitly supersedes. Never includes a filesystem
 * path, output location, a captured timestamp, or a caller-supplied label:
 * two imports of byte-identical image content from different operational
 * locations, with different labels, produce the same logical identity;
 * changing the image content, its detected format/dimensions, or the
 * supersession target changes it.
 */
export function buildExternalReferenceRequestIdentity(
  imageSha256: string,
  format: ExternalReferenceImageFormat,
  width: number,
  height: number,
  supersedesReferenceId?: string,
): string {
  const semanticView = { imageSha256, format, width, height, supersedes: supersedesReferenceId ?? null };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Fresh, opaque per-persisted-instance identity - never derived from a
 * timestamp alone, never collides even when called twice with the same
 * requestIdentity within the same millisecond. Used both for a fresh import
 * and for a fresh approval of an already-imported reference (same
 * referenceRequestId, a new referenceId each time something is persisted).
 */
export function buildExternalReferenceInstanceIdentity(requestIdentity: string): string {
  const nonce = randomBytes(16).toString('hex');
  return `${requestIdentity}-${nonce}`;
}
