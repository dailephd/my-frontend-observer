import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverManifests } from './discovery.js';
import { classifyManifest } from './classify.js';
import type { ClassifiedRecord } from './classify.js';
import { buildMetadataRecord, buildArtifactDetail } from './projection.js';
import type { EvidenceArtifactDetail, EvidenceMetadataRecord } from './projection.js';
import { decodeArtifactHandle } from './handles.js';
import { resolveContainedDir } from './pathSafety.js';
import { MAX_INDEX_RECORDS } from './limits.js';

export interface EvidenceIndexResult {
  records: EvidenceMetadataRecord[];
  truncated: boolean;
}

/**
 * The one metadata-first entry point: bounded discovery + narrow
 * classification + canonical-reader dispatch (for anything that looks
 * recognized) + ephemeral metadata projection. Rebuilt on every call rather
 * than cached (frozen plan §30: no persistent viewer cache/database/watcher),
 * so it always reflects the evidence root's current on-disk state.
 */
export async function buildEvidenceIndexMetadata(root: string): Promise<EvidenceIndexResult> {
  const discovery = await discoverManifests(root);
  const limited = discovery.manifests.slice(0, MAX_INDEX_RECORDS);
  const truncated = discovery.truncated || discovery.manifests.length > MAX_INDEX_RECORDS;

  const records: EvidenceMetadataRecord[] = [];
  for (const manifest of limited) {
    const classified = await classifyManifest(manifest.absolutePath);
    records.push(await buildMetadataRecord(classified, manifest.relativeDir, manifest.absoluteDir));
  }

  return { records, truncated };
}

export type LoadArtifactResult =
  | { ok: true; detail: EvidenceArtifactDetail }
  | { ok: false; reason: 'unknown-handle' }
  | { ok: false; reason: 'not-supported'; metadata: EvidenceMetadataRecord };

/**
 * On-demand full-artifact loading (frozen plan §16): decodes and
 * re-validates the handle against the evidence root (never trusts it
 * blindly), then re-classifies *that one candidate* through the same
 * canonical-reader dispatch the index uses - it never returns a cached
 * result and never coerces an unsupported/invalid candidate into a
 * fabricated domain object.
 */
export async function loadArtifactByHandle(root: string, handle: string): Promise<LoadArtifactResult> {
  const decoded = decodeArtifactHandle(handle);
  if (!decoded.ok) return { ok: false, reason: 'unknown-handle' };

  const dir = resolveContainedDir(root, decoded.relativeDir);
  if (dir === undefined) return { ok: false, reason: 'unknown-handle' };

  try {
    const dirInfo = await stat(dir);
    if (!dirInfo.isDirectory()) return { ok: false, reason: 'unknown-handle' };
  } catch {
    // The handle names a path discovery never actually found on disk (or that has since disappeared) - unknown, not "broken".
    return { ok: false, reason: 'unknown-handle' };
  }

  const classified = await classifyManifest(join(dir, 'manifest.json'));
  if (classified.supportState !== 'supported') {
    const metadata = await buildMetadataRecord(classified, decoded.relativeDir, dir);
    return { ok: false, reason: 'not-supported', metadata };
  }
  if (classified.family !== decoded.family) {
    // The handle named a family that no longer matches on-disk reality (e.g. deleted and replaced between requests) - fail closed as unknown rather than serving a mismatched artifact under a stale handle.
    return { ok: false, reason: 'unknown-handle' };
  }

  return { ok: true, detail: buildArtifactDetail(classified.family, handle, classified.artifact) };
}

/**
 * Bounded search for the 'imported' external-reference artifact whose
 * `referenceId` matches `referenceId`, used only to resolve an 'approved'
 * artifact's source-owned image (see mediaResolver.ts). Never assumes a
 * fixed relative location - an approved artifact's `sourceReference` carries
 * only a logical `referenceId`, not a filesystem path (frozen plan §18).
 */
export async function findImportedReferenceDir(root: string, referenceId: string): Promise<string | undefined> {
  const discovery = await discoverManifests(root);
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified: ClassifiedRecord = await classifyManifest(manifest.absolutePath);
    if (classified.supportState === 'supported' && classified.family === 'external-reference-imported' && 'referenceId' in classified.artifact) {
      if (classified.artifact.referenceId === referenceId) return manifest.absoluteDir;
    }
  }
  return undefined;
}
