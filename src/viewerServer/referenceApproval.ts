import { approveExternalReference } from '../application/externalReferencePersistenceService.js';
import { referenceOutputLocation } from '../projectWorkflow/projectPaths.js';
import { deriveReferenceRequirementAdequacy } from '../domain/externalReferenceRequirements.js';
import { buildEvidenceIndexMetadata, loadArtifactByHandle } from './evidence/index.js';
import { decodeArtifactHandle, encodeArtifactHandle } from './evidence/handles.js';
import { resolveContainedDir } from './evidence/pathSafety.js';
import { runSerializedAuthoringWrite } from './annotationAuthoring.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';
import type { ImportedExternalReferenceArtifact } from '../domain/externalReference.js';

export function parseApproveReferenceRequest(value: unknown): { ok: true } | { ok: false; error: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0
    ? { ok: true }
    : { ok: false, error: 'request body must be exactly {}' };
}

export type ApproveReferenceResult =
  | { ok: true; referenceId: string; referenceRequestId: string; handle: string; regionCount: number; requirementCount: number; adequacy: ReturnType<typeof deriveReferenceRequirementAdequacy> }
  | { ok: false; reason: 'unknown-handle' | 'wrong-lifecycle' | 'supersession-unresolved' | 'approval-failed'; error: string };

export function approveReferenceFromViewer(root: string, session: ViewerAuthoringSession, handle: string): Promise<ApproveReferenceResult> {
  return runSerializedAuthoringWrite(session, async () => {
    const loaded = await loadArtifactByHandle(root, handle);
    if (!loaded.ok) return { ok: false, reason: 'unknown-handle', error: 'unknown reference handle' };
    if (loaded.detail.family !== 'external-reference-imported') return { ok: false, reason: 'wrong-lifecycle', error: 'only an imported reference may be approved' };
    const decoded = decodeArtifactHandle(handle);
    const importedRoot = decoded.ok ? resolveContainedDir(root, decoded.relativeDir) : undefined;
    if (importedRoot === undefined) return { ok: false, reason: 'unknown-handle', error: 'unknown reference handle' };
    const imported = loaded.detail.artifact as ImportedExternalReferenceArtifact;
    let supersedesReferenceRoot: string | undefined;
    if (imported.supersedesReferenceId !== undefined) {
      const index = await buildEvidenceIndexMetadata(root);
      const matches = index.records.filter((record) =>
        (record.family === 'external-reference-imported' || record.family === 'external-reference-approved') &&
        record.supportState === 'supported' && record.logicalId === imported.supersedesReferenceId,
      );
      if (matches.length !== 1) return { ok: false, reason: 'supersession-unresolved', error: 'the declared predecessor reference could not be resolved uniquely' };
      const predecessor = decodeArtifactHandle(matches[0]!.handle);
      supersedesReferenceRoot = predecessor.ok ? resolveContainedDir(root, predecessor.relativeDir) : undefined;
      if (supersedesReferenceRoot === undefined) return { ok: false, reason: 'supersession-unresolved', error: 'the declared predecessor reference could not be resolved uniquely' };
    }
    const result = await approveExternalReference(importedRoot, { outputLocation: referenceOutputLocation(), cwd: session.projectRoot, ...(supersedesReferenceRoot === undefined ? {} : { supersedesReferenceRoot }) });
    if (!result.ok) return { ok: false, reason: 'approval-failed', error: result.diagnostics.map((item) => item.message).join('; ') };
    return { ok: true, referenceId: result.referenceId, referenceRequestId: result.referenceRequestId, handle: encodeArtifactHandle('external-reference-approved', `references/${result.referenceId}`), regionCount: result.regionCount, requirementCount: result.requirementCount, adequacy: result.adequacy };
  });
}
