import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyManifest } from './classify.js';
import { decodeArtifactHandle } from './handles.js';
import { findImportedReferenceDir } from './index.js';
import { resolveContainedDir, resolveContainedFile } from './pathSafety.js';
import type { ExternalReferenceImageFormat } from '../../domain/externalReferenceImage.js';

export type MediaRole = 'screenshot' | 'image' | 'source-image';

const IMAGE_FORMAT_MIME: Record<ExternalReferenceImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export type MediaResolution = { ok: true; absolutePath: string; mimeType: string } | { ok: false; reason: string };

function isMediaRole(value: string): value is MediaRole {
  return value === 'screenshot' || value === 'image' || value === 'source-image';
}

/**
 * Resolves one known media role owned/referenced by one known, already
 * indexed-shaped artifact handle - never an arbitrary filesystem path. Every
 * step re-derives and re-validates from the evidence root; nothing here
 * trusts a client-supplied path string beyond the opaque handle/role pair.
 */
export async function resolveMedia(root: string, artifactHandle: string, role: string): Promise<MediaResolution> {
  if (!isMediaRole(role)) return { ok: false, reason: 'unknown media role' };

  const decoded = decodeArtifactHandle(artifactHandle);
  if (!decoded.ok) return { ok: false, reason: 'unknown handle' };

  const dir = resolveContainedDir(root, decoded.relativeDir);
  if (dir === undefined) return { ok: false, reason: 'unknown handle' };

  const classified = await classifyManifest(join(dir, 'manifest.json'));
  if (classified.supportState !== 'supported' || classified.family !== decoded.family) {
    return { ok: false, reason: 'handle no longer resolves to a supported artifact' };
  }

  if (role === 'screenshot') {
    if (classified.family !== 'observation') return { ok: false, reason: 'screenshot is only defined for observation evidence' };
    const field = classified.artifact.screenshot;
    if (field.state !== 'available' && field.state !== 'partial') return { ok: false, reason: 'this observation has no recorded screenshot' };
    const resolved = resolveContainedFile(dir, field.value.path);
    if (resolved === undefined) return { ok: false, reason: 'screenshot reference is not a safe bare filename' };
    return checkExists(resolved, 'image/png');
  }

  if (role === 'image') {
    if (classified.family !== 'external-reference-imported' || !('image' in classified.artifact)) {
      return { ok: false, reason: 'image is only defined for an imported external reference' };
    }
    const image = classified.artifact.image;
    const resolved = resolveContainedFile(dir, image.path);
    if (resolved === undefined) return { ok: false, reason: 'image reference is not a safe bare filename' };
    return checkExists(resolved, IMAGE_FORMAT_MIME[image.format]);
  }

  // role === 'source-image': only defined for an approved external reference, resolved through the imported
  // artifact it points back to (never assumed to live in the approved artifact's own directory - frozen plan §18).
  if (classified.family !== 'external-reference-approved' || !('sourceReference' in classified.artifact)) {
    return { ok: false, reason: 'source-image is only defined for an approved external reference' };
  }
  const sourceReference = classified.artifact.sourceReference;
  const sourceDir = await findImportedReferenceDir(root, sourceReference.referenceId);
  if (sourceDir === undefined) {
    return { ok: false, reason: 'the imported external-reference artifact that owns this image is not present under the current evidence root' };
  }
  const resolved = resolveContainedFile(sourceDir, sourceReference.image.path);
  if (resolved === undefined) return { ok: false, reason: 'source image reference is not a safe bare filename' };
  return checkExists(resolved, IMAGE_FORMAT_MIME[sourceReference.image.format]);
}

async function checkExists(absolutePath: string, mimeType: string): Promise<MediaResolution> {
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) return { ok: false, reason: 'media reference does not point at a regular file' };
  } catch {
    return { ok: false, reason: 'media file not found on disk' };
  }
  return { ok: true, absolutePath, mimeType };
}
