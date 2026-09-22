import path from 'node:path';
import { recordVisualChangeGovernance, reviewVisualChangeWorkflow, type VisualChangeReviewDecision } from '../application/visualChangeReviewService.js';
import type { ExternalReferenceArtifact } from '../domain/externalReference.js';
import type { PersistentBaselineContract } from '../domain/frontendContracts.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';
import { decodeArtifactHandle } from './evidence/handles.js';
import { loadArtifactByHandle } from './evidence/index.js';
import { resolveContainedDir } from './evidence/pathSafety.js';
import { resolveVisualChangeTarget } from './visualChangeAuthoring.js';

export function parseVisualChangeReviewRequest(value: unknown): { ok: true; decision: VisualChangeReviewDecision } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('decision' in value) || !['correction-requested','accepted','abandoned'].includes(String((value as { decision?: unknown }).decision))) return { ok: false, error: 'request body must contain exactly one valid decision' };
  return { ok: true, decision: (value as { decision: VisualChangeReviewDecision }).decision };
}
export type GovernanceRequest = { kind: 'baseline-approval'|'external-reference-approval'; approvalHandle: string };
export function parseVisualChangeGovernanceRequest(value: unknown): { ok: true; request: GovernanceRequest } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2) return { ok: false, error: 'request body must contain exactly kind and approvalHandle' }; const record = value as Record<string, unknown>;
  if (!['baseline-approval','external-reference-approval'].includes(String(record.kind)) || typeof record.approvalHandle !== 'string' || record.approvalHandle.length === 0) return { ok: false, error: 'invalid governance request' };
  return { ok: true, request: record as GovernanceRequest };
}
export async function reviewVisualChangeFromViewer(root: string, session: ViewerAuthoringSession, handle: string, decision: VisualChangeReviewDecision) {
  const target = await resolveVisualChangeTarget(root, handle); if (!target.ok) return target; const workflowManifestPath = path.relative(session.projectRoot, target.workflowManifestPath).split(path.sep).join('/');
  return reviewVisualChangeWorkflow({ projectRoot: session.projectRoot, workflowManifestPath, decision });
}
export async function recordVisualChangeGovernanceFromViewer(root: string, session: ViewerAuthoringSession, handle: string, request: GovernanceRequest) {
  const target = await resolveVisualChangeTarget(root, handle); if (!target.ok) return target; const approval = await loadArtifactByHandle(root, request.approvalHandle); if (!approval.ok) return { ok: false as const, status: approval.reason === 'unknown-handle' ? 404 as const : 409 as const, error: 'approval handle is not supported' };
  const expected = request.kind === 'baseline-approval' ? 'baseline-contract' : 'external-reference-approved'; if (approval.detail.family !== expected) return { ok: false as const, status: 409 as const, error: `approval handle must identify ${expected}` };
  const decoded = decodeArtifactHandle(request.approvalHandle); const directory = decoded.ok ? resolveContainedDir(root, decoded.relativeDir) : undefined; if (directory === undefined) return { ok: false as const, status: 404 as const, error: 'unknown approval handle' };
  const artifactPath = path.relative(session.projectRoot, directory).split(path.sep).join('/'); const workflowManifestPath = path.relative(session.projectRoot, target.workflowManifestPath).split(path.sep).join('/');
  const governance = request.kind === 'baseline-approval' ? { kind: request.kind, artifact: approval.detail.artifact as PersistentBaselineContract, artifactPath } : { kind: request.kind, artifact: approval.detail.artifact as ExternalReferenceArtifact, artifactPath };
  return recordVisualChangeGovernance({ projectRoot: session.projectRoot, workflowManifestPath, governance });
}
