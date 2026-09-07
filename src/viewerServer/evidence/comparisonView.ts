import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { classifyManifest } from './classify.js';
import { decodeArtifactHandle } from './handles.js';
import { resolveContainedDir } from './pathSafety.js';
import { resolveObservationByReference } from './linkedEvidence.js';
import type { LinkStatus } from './linkedEvidence.js';

export type ComparisonViewResult =
  | { ok: true; before: LinkStatus; after: LinkStatus }
  | { ok: false; reason: 'unknown-handle' }
  | { ok: false; reason: 'not-a-comparison' }
  | { ok: false; reason: 'not-currently-loadable' };

/**
 * Batch 4's one additive server-side computation for comparisons: resolves
 * the persisted `ComparisonArtifact`'s `before`/`after` source-observation
 * references (exact identity only, `linkedEvidence.ts`) against the current
 * evidence root. Never calls `compareObservations` - the persisted
 * `ComparisonArtifact` (differences, relationshipsBefore/After,
 * comparability, etc.) remains authoritative and is fetched unchanged
 * through the existing Batch 2 `GET /api/artifacts/<handle>`; this endpoint
 * only answers "where are its source observations, if anywhere in this
 * root". Same handle-decode -> contained-dir-resolve -> re-classify
 * discipline as `observationView.ts`/`mediaResolver.ts`.
 */
export async function getComparisonView(root: string, handle: string): Promise<ComparisonViewResult> {
  const decoded = decodeArtifactHandle(handle);
  if (!decoded.ok) return { ok: false, reason: 'unknown-handle' };

  const dir = resolveContainedDir(root, decoded.relativeDir);
  if (dir === undefined) return { ok: false, reason: 'unknown-handle' };

  try {
    const dirInfo = await stat(dir);
    if (!dirInfo.isDirectory()) return { ok: false, reason: 'unknown-handle' };
  } catch {
    return { ok: false, reason: 'unknown-handle' };
  }

  const classified = await classifyManifest(join(dir, 'manifest.json'));
  if (classified.supportState !== 'supported') return { ok: false, reason: 'not-currently-loadable' };
  if (classified.family !== 'comparison') return { ok: false, reason: 'not-a-comparison' };

  const { artifact } = classified;
  const [before, after] = await Promise.all([resolveObservationByReference(root, artifact.before), resolveObservationByReference(root, artifact.after)]);

  return { ok: true, before, after };
}
