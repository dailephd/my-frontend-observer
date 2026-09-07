import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { classifyManifest } from './classify.js';
import { decodeArtifactHandle } from './handles.js';
import { resolveContainedDir } from './pathSafety.js';
import { resolveObservationByReference, resolveComparisonByIdentity, resolveBaselineContractById, resolveChangeContractById } from './linkedEvidence.js';
import type { LinkStatus } from './linkedEvidence.js';

export type EvaluationViewResult =
  | { ok: true; comparison: LinkStatus; baseline: LinkStatus; change: LinkStatus; before: LinkStatus; after: LinkStatus }
  | { ok: false; reason: 'unknown-handle' }
  | { ok: false; reason: 'not-an-evaluation' }
  | { ok: false; reason: 'not-currently-loadable' };

/**
 * Batch 4's linked-evidence resolver for `FrontendContractEvaluationArtifact`:
 * resolves its `contracts.baselineId`, `contracts.contractId`,
 * `comparisonId`+`comparisonRequestId`, and `before`/`after` references
 * against the current evidence root, all by exact identity
 * (`linkedEvidence.ts`) - never by shape/proximity. Never calls
 * `evaluateFrontendContract`: `overallVerdict`, `clauseResults`,
 * `activeBaselineClauseIds`, `supersededBaselineClauseIds`, and
 * `unexpectedChanges` are read unchanged from the persisted artifact via the
 * existing Batch 2 `GET /api/artifacts/<handle>` - this endpoint only
 * answers "where are its linked contracts/comparison/observations, if
 * anywhere in this root".
 */
export async function getEvaluationView(root: string, handle: string): Promise<EvaluationViewResult> {
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
  if (classified.family !== 'contract-evaluation') return { ok: false, reason: 'not-an-evaluation' };

  const { artifact } = classified;
  const [comparison, baseline, change, before, after] = await Promise.all([
    resolveComparisonByIdentity(root, artifact.comparisonId, artifact.comparisonRequestId),
    resolveBaselineContractById(root, artifact.contracts.baselineId),
    resolveChangeContractById(root, artifact.contracts.contractId),
    resolveObservationByReference(root, artifact.before),
    resolveObservationByReference(root, artifact.after),
  ]);

  return { ok: true, comparison, baseline, change, before, after };
}
