import type { ArtifactFamily } from './classify.js';

const FAMILY_SLUGS: Record<ArtifactFamily, string> = {
  observation: 'observation',
  comparison: 'comparison',
  'baseline-contract': 'baseline-contract',
  'change-contract': 'change-contract',
  'contract-evaluation': 'contract-evaluation',
  'external-reference-imported': 'external-reference-imported',
  'external-reference-approved': 'external-reference-approved',
};

const SLUG_TO_FAMILY: Record<string, ArtifactFamily> = Object.fromEntries(Object.entries(FAMILY_SLUGS).map(([family, slug]) => [slug, family as ArtifactFamily])) as Record<
  string,
  ArtifactFamily
>;

/**
 * A viewer handle is server-issued, opaque-to-the-browser material: a
 * family-prefixed, percent-encoded root-relative directory path. It is
 * "server-issued" in the sense that it is exactly what discovery/
 * classification already produced - a client can never construct a handle
 * that names a path discovery did not itself walk to and classify.
 * Every route that accepts a handle re-resolves and re-validates it against
 * the evidence root before touching the filesystem (see media.ts/index.ts) -
 * this module only encodes/decodes the opaque string, it never grants
 * filesystem access by itself.
 */
export function encodeArtifactHandle(family: ArtifactFamily, relativeDir: string): string {
  return `${FAMILY_SLUGS[family]}:${encodeURIComponent(relativeDir)}`;
}

export type DecodedArtifactHandle = { ok: true; family: ArtifactFamily; relativeDir: string } | { ok: false };

export function decodeArtifactHandle(handle: string): DecodedArtifactHandle {
  const separatorIndex = handle.indexOf(':');
  if (separatorIndex <= 0) return { ok: false };
  const slug = handle.slice(0, separatorIndex);
  const encodedDir = handle.slice(separatorIndex + 1);
  const family = SLUG_TO_FAMILY[slug];
  if (family === undefined || encodedDir.length === 0) return { ok: false };
  let relativeDir: string;
  try {
    relativeDir = decodeURIComponent(encodedDir);
  } catch {
    return { ok: false };
  }
  return { ok: true, family, relativeDir };
}
