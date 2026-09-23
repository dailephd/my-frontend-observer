import path from 'node:path';
import type { ObservationArtifact } from '../domain/schema.js';
import type { VisualChangeActualScope } from '../domain/visualChangeWorkflow.js';
import { readProjectConfig } from '../projectWorkflow/projectConfig.js';
import { aliasCatalogPath, contractOutputLocation, projectConfigPath, projectEvidenceRoot } from '../projectWorkflow/projectPaths.js';
import { readAliasCatalog } from '../projectWorkflow/aliasCatalog.js';
import { resolveContainedAcceptancePath } from '../projectWorkflow/checkAcceptance.js';
import { readPersistentBaselineContract } from '../artifacts/frontendContractArtifactReader.js';
import { promoteVisualAnnotationContract } from '../application/visualAnnotationContractPromotionService.js';
import { createProjectVisualChangeWorkflow } from '../application/visualChangeProjectWorkflowService.js';
import { getAnnotationView } from './evidence/annotationView.js';
import { loadArtifactByHandle } from './evidence/index.js';
import { decodeArtifactHandle } from './evidence/handles.js';
import { resolveContainedDir } from './evidence/pathSafety.js';
import { parseAuthoringItemIds, runSerializedAuthoringWrite } from './annotationAuthoring.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';

export interface StartRuntimeVisualChangeRequest { itemIds: string[] }
export type StartRuntimeVisualChangeFailureReason = 'unknown-annotation-handle'|'not-an-annotation'|'reference-annotation'|'source-unavailable'|'source-mismatch'|'project-config-invalid'|'contract-not-configured'|'configured-baseline-invalid'|'baseline-alias-missing'|'invalid-selection'|'contract-persistence-failed'|'workflow-persistence-failed';
export type StartRuntimeVisualChangeResult =
  | { ok: true; contractId: string; contractRequestId: string; clauseCount: number; visualChangeRequestId: string; visualChangeWorkflowId: string }
  | { ok: false; reason: StartRuntimeVisualChangeFailureReason; error: string; contractId?: string; contractRequestId?: string };
export interface RuntimeVisualChangeDependencies { promote: typeof promoteVisualAnnotationContract; create: typeof createProjectVisualChangeWorkflow }
const DEFAULT_DEPENDENCIES: RuntimeVisualChangeDependencies = { promote: promoteVisualAnnotationContract, create: createProjectVisualChangeWorkflow };

export function parseStartRuntimeVisualChangeRequest(value: unknown): { ok: true; request: StartRuntimeVisualChangeRequest } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'request body must be a JSON object' };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'itemIds')) return { ok: false, error: 'request body must contain only itemIds' };
  const parsed = parseAuthoringItemIds(record.itemIds);
  return parsed.ok ? { ok: true, request: { itemIds: parsed.itemIds } } : parsed;
}

function portableRelative(projectRoot: string, absoluteDir: string): string | undefined {
  const relative = path.relative(projectRoot, absoluteDir).split(path.sep).join('/');
  return relative.length > 0 && !relative.startsWith('../') && !path.posix.isAbsolute(relative) ? relative : undefined;
}

export function startRuntimeVisualChangeFromViewer(root: string, session: ViewerAuthoringSession, annotationHandle: string, request: StartRuntimeVisualChangeRequest, dependencies: RuntimeVisualChangeDependencies = DEFAULT_DEPENDENCIES): Promise<StartRuntimeVisualChangeResult> {
  return runSerializedAuthoringWrite(session, () => performStart(root, session, annotationHandle, request, dependencies));
}

async function performStart(root: string, session: ViewerAuthoringSession, annotationHandle: string, request: StartRuntimeVisualChangeRequest, dependencies: RuntimeVisualChangeDependencies): Promise<StartRuntimeVisualChangeResult> {
  const view = await getAnnotationView(root, annotationHandle);
  if (!view.ok) return { ok: false, reason: view.reason === 'unknown-handle' ? 'unknown-annotation-handle' : 'not-an-annotation', error: view.reason === 'unknown-handle' ? 'unknown annotation handle' : 'the handle does not name a supported visual annotation' };
  const { annotation, source } = view;
  if (annotation.source.kind !== 'runtime-observation') return { ok: false, reason: 'reference-annotation', error: 'actual-frontend visual changes require a runtime-observation annotation' };
  if (source.status !== 'available' || source.family !== 'observation') return { ok: false, reason: 'source-unavailable', error: 'the exact annotation source observation is unavailable' };
  const loaded = await loadArtifactByHandle(root, source.handle);
  if (!loaded.ok || loaded.detail.family !== 'observation') return { ok: false, reason: 'source-unavailable', error: 'the exact annotation source observation is no longer loadable' };
  const observation = loaded.detail.artifact as ObservationArtifact;
  const annotationDecoded = decodeArtifactHandle(annotationHandle); const sourceDecoded = decodeArtifactHandle(source.handle);
  const annotationDir = annotationDecoded.ok ? resolveContainedDir(root, annotationDecoded.relativeDir) : undefined;
  const observationDir = sourceDecoded.ok ? resolveContainedDir(root, sourceDecoded.relativeDir) : undefined;
  const annotationPath = annotationDir === undefined ? undefined : portableRelative(session.projectRoot, annotationDir);
  const observationPath = observationDir === undefined ? undefined : portableRelative(session.projectRoot, observationDir);
  if (annotationPath === undefined || observationPath === undefined || observationDir === undefined) return { ok: false, reason: 'source-mismatch', error: 'annotation or source observation is outside the project' };
  const config = await readProjectConfig(projectConfigPath(session.projectRoot));
  if (!config.ok) return { ok: false, reason: 'project-config-invalid', error: 'the project configuration is invalid' };
  const acceptance = config.config.acceptance?.contract;
  if (acceptance === undefined) return { ok: false, reason: 'contract-not-configured', error: 'project contract acceptance must be configured' };
  const baselineRoot = resolveContainedAcceptancePath(session.projectRoot, acceptance.baselineArtifact);
  if (!baselineRoot.ok) return { ok: false, reason: 'configured-baseline-invalid', error: 'the configured baseline contract path is missing or outside the project' };
  const baseline = await readPersistentBaselineContract(path.join(baselineRoot.path, 'manifest.json'));
  if (!baseline.ok) return { ok: false, reason: 'configured-baseline-invalid', error: 'the configured baseline contract is missing or invalid' };
  const catalog = await readAliasCatalog(aliasCatalogPath(session.projectRoot));
  const expectedRelative = path.relative(projectEvidenceRoot(session.projectRoot), observationDir).split(path.sep).join('/');
  const exactAlias = catalog.ok && Object.values(catalog.catalog.observations).some((record) => record.observationId === observation.observationId && record.requestId === observation.requestId && record.relativeArtifactDir === expectedRelative);
  if (!exactAlias) return { ok: false, reason: 'baseline-alias-missing', error: 'the source observation has no exact current project alias' };
  const promoted = await dependencies.promote({ annotation, sourceObservation: observation, selectedItemIds: request.itemIds, activeBaselineIds: [baseline.contract.baselineId], outputLocation: contractOutputLocation(), cwd: session.projectRoot });
  if (!promoted.ok) return { ok: false, reason: promoted.code === 'persistence-failed' ? 'contract-persistence-failed' : promoted.code === 'invalid-selection' ? 'invalid-selection' : 'source-mismatch', error: promoted.reason };
  const changePath = portableRelative(session.projectRoot, promoted.artifactRoot);
  if (changePath === undefined) return { ok: false, reason: 'workflow-persistence-failed', error: 'the change contract was persisted, but its project-relative location could not be established', contractId: promoted.contractId, contractRequestId: promoted.contractRequestId };
  const scope: VisualChangeActualScope = { entryMode: 'actual-frontend', annotationId: annotation.annotationId, annotationArtifactPath: annotationPath, baselineObservation: { artifactId: observation.observationId, observationId: observation.observationId, requestId: observation.requestId, artifactPath: observationPath }, baselineContract: { artifactId: baseline.contract.baselineId, baselineId: baseline.contract.baselineId, artifactPath: acceptance.baselineArtifact }, changeContract: { artifactId: promoted.contractId, contractId: promoted.contractId, contractRequestId: promoted.contractRequestId, artifactPath: changePath } };
  const workflow = await dependencies.create({ projectRoot: session.projectRoot, scope });
  if (!workflow.ok) return { ok: false, reason: 'workflow-persistence-failed', error: 'the change contract was persisted, but the visual-change workflow was not created', contractId: promoted.contractId, contractRequestId: promoted.contractRequestId };
  return { ok: true, contractId: promoted.contractId, contractRequestId: promoted.contractRequestId, clauseCount: promoted.clauseCount, visualChangeRequestId: workflow.visualChangeRequestId, visualChangeWorkflowId: workflow.visualChangeWorkflowId };
}
