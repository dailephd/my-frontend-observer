import { createHash, randomBytes } from 'node:crypto';
import type { ExternalReferenceImageFormat } from './externalReferenceImage.js';
import type { ReferenceRegion } from './externalReferenceRegions.js';
import type { ExternalReferenceRequirement } from './externalReferenceRequirements.js';
import type { ExternalReferenceApplicability } from './externalReferenceApplicability.js';

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
 * Pure function of {imageSha256, format, width, height, supersedesReferenceId,
 * regions?} - the semantic content of the reference image, which prior
 * reference (if any) it explicitly supersedes, and (v0.7 Prompt 2 addition)
 * its explicitly authored reference regions when present. Never includes a
 * filesystem path, output location, a captured timestamp, or a
 * caller-supplied label: two imports of byte-identical image content and
 * region content from different operational locations, with different
 * labels, produce the same logical identity; changing the image content, its
 * detected format/dimensions, the supersession target, or the region set
 * (added/removed/renamed/moved/resized) changes it.
 *
 * `regions`/`requirements`/`applicability` are each omitted from the hashed
 * view entirely when not supplied (rather than included as `null`, unlike
 * `supersedes`) so that every pre-Prompt-2/3/4 call site - and every later
 * call that legitimately omits one of them - keeps producing byte-identical
 * identity to the earlier prompt, never a new hash purely because a
 * parameter now exists. Region/requirement order is part of the semantic
 * view (authored order is semantic, mirroring domain/identity.ts's `targets`
 * treatment) - canonicalize sorts object keys but deliberately never
 * reorders arrays. `requirements` entries already carry their own
 * content-derived `requirementId` (see externalReferenceRequirementIdentity.ts),
 * so changing a selected property, tolerance, or category changes both that
 * requirement's own id and this artifact-level identity.
 */
export function buildExternalReferenceRequestIdentity(
  imageSha256: string,
  format: ExternalReferenceImageFormat,
  width: number,
  height: number,
  supersedesReferenceId?: string,
  regions?: readonly ReferenceRegion[],
  requirements?: readonly ExternalReferenceRequirement[],
  applicability?: ExternalReferenceApplicability,
): string {
  const semanticView = {
    imageSha256,
    format,
    width,
    height,
    supersedes: supersedesReferenceId ?? null,
    ...(regions !== undefined ? { regions } : {}),
    ...(requirements !== undefined ? { requirements } : {}),
    ...(applicability !== undefined ? { applicability } : {}),
  };
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
