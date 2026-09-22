import path from 'node:path';
import { getProducerInfo } from '../domain/schema.js';
import type { VisualChangeScope, VisualChangeWorkflowArtifact } from '../domain/visualChangeWorkflow.js';
import { VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND, VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION, isValidVisualChangeWorkflowArtifact } from '../domain/visualChangeWorkflow.js';
import type { VisualChangeProjectWorkflowFailure, VisualChangeProjectWorkflowFailureCode } from '../application/visualChangeProjectWorkflowService.js';
import { activateProjectVisualChangeWorkflow, createProjectVisualChangeWorkflow, restoreProjectVisualChangeWorkflowAcceptance, runProjectVisualChangeCheck } from '../application/visualChangeProjectWorkflowService.js';
import { decodeArtifactHandle } from './evidence/handles.js';
import { loadArtifactByHandle } from './evidence/index.js';
import { resolveContainedDir } from './evidence/pathSafety.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';

export const VISUAL_CHANGE_FAILURE_STATUS: Record<VisualChangeProjectWorkflowFailureCode, number> = {
  'activation-not-configured': 409, 'activation-already-restored': 409, 'baseline-drift': 409, 'acceptance-drift': 409,
  'check-scope-mismatch': 409, 'candidate-not-produced': 409, 'duplicate-attempt': 409, 'attempt-limit-reached': 409, 'project-config-invalid': 409,
  'workflow-invalid': 422, 'workflow-reference-invalid': 422,
  'project-config-write-failure': 500, 'workflow-persistence-failure': 500, 'partial-state-failure': 500,
  'review-required': 409, 'workflow-accepted': 409, 'workflow-abandoned': 409,
};

export type ResolveVisualChangeTargetResult = { ok: true; workflowManifestPath: string } | { ok: false; status: 404 | 409; error: string };
export async function resolveVisualChangeTarget(root: string, handle: string): Promise<ResolveVisualChangeTargetResult> {
  const loaded = await loadArtifactByHandle(root, handle);
  if (!loaded.ok) return loaded.reason === 'unknown-handle' ? { ok: false, status: 404, error: 'unknown viewer artifact handle' } : { ok: false, status: 409, error: 'workflow target is not currently supported' };
  if (loaded.detail.family !== 'visual-change-workflow') return { ok: false, status: 409, error: 'handle does not name a visual-change workflow' };
  const decoded = decodeArtifactHandle(handle); const directory = decoded.ok ? resolveContainedDir(root, decoded.relativeDir) : undefined;
  return directory === undefined ? { ok: false, status: 404, error: 'unknown viewer artifact handle' } : { ok: true, workflowManifestPath: path.join(directory, 'manifest.json') };
}

export function parseCreateVisualChangeRequest(value: unknown): { ok: true; scope: VisualChangeScope } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'request body must be a JSON object' };
  const record = value as Record<string, unknown>; const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'scope') return { ok: false, error: 'request body must contain exactly scope' };
  const candidate: VisualChangeWorkflowArtifact = { artifactKind: VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND, schemaVersion: VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION, visualChangeRequestId: 'request', visualChangeWorkflowId: 'workflow', producer: getProducerInfo(), scope: record.scope as VisualChangeScope, attempts: [], ...((record.scope as { entryMode?: unknown })?.entryMode === 'reference' ? { bindings: { path: 'bindings.json', sha256: '0'.repeat(64), declarationCount: Array.isArray((record.scope as { bindings?: unknown }).bindings) ? (record.scope as { bindings: unknown[] }).bindings.length : 0 } } : {}), provenance: { createdAt: 'validation' } };
  const valid = isValidVisualChangeWorkflowArtifact(candidate); return valid.valid ? { ok: true, scope: candidate.scope } : { ok: false, error: `scope is invalid: ${valid.reason}` };
}
export function parseEmptyVisualChangeRequest(value: unknown): { ok: true } | { ok: false; error: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0 ? { ok: true } : { ok: false, error: 'request body must be an empty JSON object' };
}

export type VisualChangeViewerResult = { ok: true; status: 200 | 201; body: Record<string, unknown> } | { ok: false; status: number; body: { ok: false; code: VisualChangeProjectWorkflowFailureCode; error: string; check?: unknown } };
function applicationFailure(result: VisualChangeProjectWorkflowFailure): VisualChangeViewerResult { return { ok: false, status: VISUAL_CHANGE_FAILURE_STATUS[result.code], body: { ok: false, code: result.code, error: result.reason, ...(result.check === undefined ? {} : { check: result.check }) } }; }
const success = (status: 200 | 201, result: { visualChangeRequestId: string; visualChangeWorkflowId: string }, extra: Record<string, unknown> = {}): VisualChangeViewerResult => ({ ok: true, status, body: { ok: true, visualChangeRequestId: result.visualChangeRequestId, visualChangeWorkflowId: result.visualChangeWorkflowId, ...extra } });

export async function createVisualChangeFromViewer(session: ViewerAuthoringSession, scope: VisualChangeScope): Promise<VisualChangeViewerResult> {
  const result = await createProjectVisualChangeWorkflow({ projectRoot: session.projectRoot, scope });
  if (result.ok) return success(201, result);
  return 'code' in result ? applicationFailure(result) : { ok: false, status: 500, body: { ok: false, code: 'workflow-persistence-failure', error: 'visual-change workflow could not be persisted' } };
}
export async function mutateVisualChangeFromViewer(root: string, session: ViewerAuthoringSession, handle: string, operation: 'activate'|'check'|'restore'): Promise<VisualChangeViewerResult | { ok: false; status: 404 | 409; error: string }> {
  const target = await resolveVisualChangeTarget(root, handle); if (!target.ok) return { ok: false, status: target.status, error: target.error };
  const workflowManifestPath = path.relative(session.projectRoot, target.workflowManifestPath).split(path.sep).join('/');
  if (operation === 'activate') { const result = await activateProjectVisualChangeWorkflow({ projectRoot: session.projectRoot, workflowManifestPath }); return result.ok ? success(200, result) : applicationFailure(result); }
  if (operation === 'restore') { const result = await restoreProjectVisualChangeWorkflowAcceptance({ projectRoot: session.projectRoot, workflowManifestPath }); return result.ok ? success(200, result) : applicationFailure(result); }
  const result = await runProjectVisualChangeCheck({ projectRoot: session.projectRoot, workflowManifestPath }); return result.ok ? success(200, result, { attempt: result.attempt, check: result.check }) : applicationFailure(result);
}
