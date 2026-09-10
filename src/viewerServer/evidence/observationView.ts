import { join } from 'node:path';
import { classifyManifest } from './classify.js';
import { decodeArtifactHandle } from './handles.js';
import { resolveContainedDir } from './pathSafety.js';
import { deriveLayoutRelationships } from '../../domain/relationships.js';
import type { LayoutRelationshipGraph } from '../../domain/relationships.js';
import { stat } from 'node:fs/promises';

export type ObservationRelationshipsResult =
  | { ok: true; graph: LayoutRelationshipGraph }
  | { ok: false; reason: 'unknown-handle' }
  | { ok: false; reason: 'not-an-observation' }
  | { ok: false; reason: 'not-currently-loadable' }
  | { ok: false; reason: 'derivation-failed'; detail: string };

/**
 * Batch 3's one additive server-side computation: invokes the existing
 * canonical, pure `deriveLayoutRelationships` (src/domain/relationships.ts)
 * against one already-validated, already-classified `ObservationArtifact` -
 * never a second relationship engine, never computed in React. Mirrors the
 * same handle-decode -> contained-dir-resolve -> re-classify defense-in-depth
 * discipline as `loadArtifactByHandle`/`resolveMedia` (evidence/index.ts,
 * mediaResolver.ts): a handle is never trusted without being re-validated
 * against the evidence root on every request.
 */
export async function getObservationRelationships(root: string, handle: string): Promise<ObservationRelationshipsResult> {
  const decoded = decodeArtifactHandle(handle);
  if (!decoded.ok) return { ok: false, reason: 'unknown-handle' };
  if (decoded.family !== 'observation') return { ok: false, reason: 'not-an-observation' };

  const dir = resolveContainedDir(root, decoded.relativeDir);
  if (dir === undefined) return { ok: false, reason: 'unknown-handle' };

  try {
    const dirInfo = await stat(dir);
    if (!dirInfo.isDirectory()) return { ok: false, reason: 'unknown-handle' };
  } catch {
    return { ok: false, reason: 'unknown-handle' };
  }

  const classified = await classifyManifest(join(dir, 'manifest.json'));
  if (classified.supportState !== 'supported') {
    return { ok: false, reason: 'not-currently-loadable' };
  }
  if (classified.family !== 'observation') {
    return { ok: false, reason: 'not-an-observation' };
  }

  const derived = deriveLayoutRelationships(classified.artifact);
  if (!derived.ok) return { ok: false, reason: 'derivation-failed', detail: derived.reason };
  return { ok: true, graph: derived.graph };
}
