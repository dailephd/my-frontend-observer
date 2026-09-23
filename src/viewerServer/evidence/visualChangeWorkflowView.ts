import type { VisualChangeWorkflowArtifact } from '../../domain/visualChangeWorkflow.js';
import type { ArtifactFamily } from './classify.js';
import { classifyManifest } from './classify.js';
import { discoverManifests } from './discovery.js';
import { encodeArtifactHandle } from './handles.js';
import { loadArtifactByHandle } from './index.js';
import { MAX_INDEX_RECORDS } from './limits.js';

export type LinkedWorkflowEvidence = { status: 'available'; handle: string; family: ArtifactFamily } | { status: 'unavailable'; reason: string };
export interface VisualChangeWorkflowView {
  workflow: VisualChangeWorkflowArtifact;
  baselineObservation: LinkedWorkflowEvidence;
  annotation: LinkedWorkflowEvidence;
  changeContract?: LinkedWorkflowEvidence;
  baselineContract?: LinkedWorkflowEvidence;
  approvedReference?: LinkedWorkflowEvidence;
  attempts: Array<{ candidateObservation: LinkedWorkflowEvidence; comparison?: LinkedWorkflowEvidence; contractEvaluation?: LinkedWorkflowEvidence }>;
}
export type GetVisualChangeWorkflowViewResult = { ok: true; view: VisualChangeWorkflowView } | { ok: false; reason: 'unknown-handle' | 'not-a-visual-change-workflow' | 'not-currently-loadable' };
async function exact(root: string, families: readonly ArtifactFamily[], predicate: (artifact: Record<string, unknown>) => boolean): Promise<LinkedWorkflowEvidence> {
  const found: Array<{ handle: string; family: ArtifactFamily }> = [];
  for (const manifest of (await discoverManifests(root)).manifests.slice(0, MAX_INDEX_RECORDS)) {
    const c = await classifyManifest(manifest.absolutePath); if (c.supportState !== 'supported' || !families.includes(c.family)) continue;
    if (predicate(c.artifact as unknown as Record<string, unknown>)) found.push({ handle: encodeArtifactHandle(c.family, manifest.relativeDir), family: c.family });
  }
  return found.length === 1 ? { status: 'available', ...found[0]! } : { status: 'unavailable', reason: found.length === 0 ? 'exact referenced evidence is missing' : 'exact referenced evidence is ambiguous' };
}
export async function getVisualChangeWorkflowView(root: string, handle: string): Promise<GetVisualChangeWorkflowViewResult> {
  const loaded = await loadArtifactByHandle(root, handle);
  if (!loaded.ok) return loaded.reason === 'unknown-handle' ? { ok: false, reason: 'unknown-handle' } : loaded.metadata.family === 'visual-change-workflow' ? { ok: false, reason: 'not-currently-loadable' } : { ok: false, reason: 'not-a-visual-change-workflow' };
  if (loaded.detail.family !== 'visual-change-workflow') return { ok: false, reason: 'not-a-visual-change-workflow' };
  const workflow = loaded.detail.artifact as VisualChangeWorkflowArtifact;
  const baselineObservation = await exact(root, ['observation'], (a) => a.observationId === workflow.scope.baselineObservation.observationId && a.requestId === workflow.scope.baselineObservation.requestId);
  const annotation = await exact(root, ['visual-annotation'], (a) => a.annotationId === workflow.scope.annotationId);
  const baselineContract = workflow.scope.baselineContract === undefined ? undefined : await exact(root, ['baseline-contract'], (a) => a.baselineId === workflow.scope.baselineContract?.baselineId);
  const changeScope = workflow.scope.entryMode === 'actual-frontend' ? workflow.scope : undefined;
  const referenceScope = workflow.scope.entryMode === 'reference' ? workflow.scope : undefined;
  const changeContract = changeScope === undefined ? undefined : await exact(root, ['change-contract'], (a) => a.contractId === changeScope.changeContract.contractId && a.contractRequestId === changeScope.changeContract.contractRequestId);
  const approvedReference = referenceScope === undefined ? undefined : await exact(root, ['external-reference-approved'], (a) => a.referenceId === referenceScope.approvedReference.referenceId && a.referenceRequestId === referenceScope.approvedReference.referenceRequestId);
  const attempts = [];
  for (const attempt of workflow.attempts) attempts.push({ candidateObservation: await exact(root, ['observation'], (a) => a.observationId === attempt.candidateObservation.observationId && a.requestId === attempt.candidateObservation.requestId), ...(attempt.check.comparison === undefined ? {} : { comparison: await exact(root, ['comparison'], (a) => a.comparisonId === attempt.check.comparison?.artifactId) }), ...(attempt.check.contractEvaluation === undefined ? {} : { contractEvaluation: await exact(root, ['contract-evaluation'], (a) => a.evaluationId === attempt.check.contractEvaluation?.artifactId) }) });
  return { ok: true, view: { workflow, baselineObservation, annotation, ...(changeContract === undefined ? {} : { changeContract }), ...(baselineContract === undefined ? {} : { baselineContract }), ...(approvedReference === undefined ? {} : { approvedReference }), attempts } };
}
