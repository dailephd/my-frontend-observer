import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverManifests } from './discovery.js';
import { classifyManifest } from './classify.js';
import type { ClassifiedRecord } from './classify.js';
import { buildMetadataRecord, buildArtifactDetail } from './projection.js';
import type { EvidenceArtifactDetail, EvidenceMetadataRecord } from './projection.js';
import { decodeArtifactHandle, encodeArtifactHandle } from './handles.js';
import { resolveContainedDir } from './pathSafety.js';
import { MAX_INDEX_RECORDS } from './limits.js';
import type { ObservationArtifact } from '../../domain/schema.js';
import type { ExternalReferenceArtifact } from '../../domain/externalReference.js';

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
export async function buildEvidenceIndexMetadata(root: string, observationAliasesByRelativeDir: Readonly<Record<string, string>> = {}): Promise<EvidenceIndexResult> {
  const discovery = await discoverManifests(root);
  const limited = discovery.manifests.slice(0, MAX_INDEX_RECORDS);
  const truncated = discovery.truncated || discovery.manifests.length > MAX_INDEX_RECORDS;

  const records: EvidenceMetadataRecord[] = [];
  for (const manifest of limited) {
    const classified = await classifyManifest(manifest.absolutePath);
    const record = await buildMetadataRecord(classified, manifest.relativeDir, manifest.absoluteDir);
    const alias = record.family === 'observation' ? observationAliasesByRelativeDir[manifest.relativeDir] : undefined;
    records.push(alias === undefined ? record : { ...record, alias });
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

export interface ObservationIdentityMatch {
  handle: string;
  artifact: ObservationArtifact;
  absoluteDir: string;
}

export interface ExternalReferenceIdentityMatch {
  handle: string;
  artifact: ExternalReferenceArtifact;
  family: 'external-reference-imported' | 'external-reference-approved';
  absoluteDir: string;
}

/**
 * v0.9 Batch 2: bounded exact-identity lookup of one supported observation by
 * `observationId` plus `requestId` (both required - never a logical-id-only,
 * alias, folder-name, or filename match). Uses the same bounded
 * discovery/classification as the index. Returns `undefined` when no
 * currently supported observation matches, and also when more than one does:
 * an ambiguous identity is never resolved by silently picking one.
 */
export async function findObservationByIdentity(root: string, observationId: string, requestId: string): Promise<ObservationIdentityMatch | undefined> {
  const discovery = await discoverManifests(root);
  const matches: ObservationIdentityMatch[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'observation') continue;
    if (classified.artifact.observationId === observationId && classified.artifact.requestId === requestId) {
      matches.push({ handle: encodeArtifactHandle('observation', manifest.relativeDir), artifact: classified.artifact, absoluteDir: manifest.absoluteDir });
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * v0.9 Batch 2: bounded exact-identity lookup of one supported imported or
 * approved external reference by `referenceId` plus `referenceRequestId`.
 * Same bounded, never-guess, ambiguity-is-unresolved discipline as
 * `findObservationByIdentity`.
 */
export async function findExternalReferenceByIdentity(root: string, referenceId: string, referenceRequestId: string): Promise<ExternalReferenceIdentityMatch | undefined> {
  const discovery = await discoverManifests(root);
  const matches: ExternalReferenceIdentityMatch[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported') continue;
    if (classified.family !== 'external-reference-imported' && classified.family !== 'external-reference-approved') continue;
    if (classified.artifact.referenceId === referenceId && classified.artifact.referenceRequestId === referenceRequestId) {
      matches.push({ handle: encodeArtifactHandle(classified.family, manifest.relativeDir), artifact: classified.artifact, family: classified.family, absoluteDir: manifest.absoluteDir });
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}
