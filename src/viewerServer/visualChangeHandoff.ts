import path from 'node:path';
import { getProducerInfo } from '../domain/schema.js';
import type { VisualChangeAgentHandoff, VisualChangeExternalCoordination } from '../domain/visualChangeAgentHandoff.js';
import { isValidVisualChangeExternalCoordination } from '../domain/visualChangeAgentHandoff.js';
import { prepareVisualChangeAgentHandoff, type PrepareVisualChangeAgentHandoffFailureCode } from '../application/visualChangeAgentHandoffService.js';
import type { ContextSessionState } from './context.js';
import { decodeArtifactHandle } from './evidence/handles.js';
import { loadArtifactByHandle } from './evidence/index.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';

export interface PrepareVisualChangeHandoffRequest { coordination?: VisualChangeExternalCoordination }
export function parsePrepareVisualChangeHandoffRequest(value: unknown): { ok: true; request: PrepareVisualChangeHandoffRequest } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'request body must be a JSON object' };
  const record = value as Record<string, unknown>; if (Object.keys(record).some((key) => key !== 'coordination')) return { ok: false, error: 'request body may contain only coordination' };
  if (record.coordination !== undefined && !isValidVisualChangeExternalCoordination(record.coordination)) return { ok: false, error: 'coordination must be a valid my-dev-kit-orchestrator run reference' };
  return { ok: true, request: record.coordination === undefined ? {} : { coordination: record.coordination } };
}

export type PrepareVisualChangeHandoffFromViewerResult = { ok: true; handoff: VisualChangeAgentHandoff } | { ok: false; code: 'unknown-handle'|'wrong-family'|PrepareVisualChangeAgentHandoffFailureCode; error: string };
export async function prepareVisualChangeHandoffFromViewer(root: string, session: ViewerAuthoringSession, context: ContextSessionState, handle: string, request: PrepareVisualChangeHandoffRequest): Promise<PrepareVisualChangeHandoffFromViewerResult> {
  const loaded = await loadArtifactByHandle(root, handle); if (!loaded.ok) return { ok: false, code: 'unknown-handle', error: 'unknown workflow handle' };
  if (loaded.detail.family !== 'visual-change-workflow') return { ok: false, code: 'wrong-family', error: 'prepare-handoff is only available for visual-change workflows' };
  const decoded = decodeArtifactHandle(handle); if (!decoded.ok) return { ok: false, code: 'unknown-handle', error: 'unknown workflow handle' };
  const workflowManifestPath = path.relative(session.projectRoot, path.join(root, ...decoded.relativeDir.split('/'), 'manifest.json')).split(path.sep).join('/');
  const producer = getProducerInfo();
  const result = await prepareVisualChangeAgentHandoff({ projectRoot: session.projectRoot, workflowManifestPath, context, generatedAt: new Date().toISOString(), producerVersion: producer.version, ...request });
  return result.ok ? result : { ok: false, code: result.code, error: result.reason };
}
