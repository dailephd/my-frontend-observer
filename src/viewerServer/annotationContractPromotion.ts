import path from 'node:path';
import type { ObservationArtifact } from '../domain/schema.js';
import { readProjectConfig } from '../projectWorkflow/projectConfig.js';
import { contractOutputLocation, projectConfigPath } from '../projectWorkflow/projectPaths.js';
import { resolveContainedAcceptancePath } from '../projectWorkflow/checkAcceptance.js';
import { readPersistentBaselineContract } from '../artifacts/frontendContractArtifactReader.js';
import { promoteVisualAnnotationContract } from '../application/visualAnnotationContractPromotionService.js';
import type { PromoteVisualAnnotationContractFailureCode } from '../application/visualAnnotationContractPromotionService.js';
import { activateProjectChangeContract } from '../application/projectWorkflowService.js';
import { getAnnotationView } from './evidence/annotationView.js';
import { loadArtifactByHandle } from './evidence/index.js';
import { encodeArtifactHandle } from './evidence/handles.js';
import { parseAuthoringItemIds, runSerializedAuthoringWrite } from './annotationAuthoring.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';

/** v0.9 Batch 5 closed promotion request. The browser supplies only annotation item ids and the explicit activation choice. */
export interface PromoteAnnotationContractRequest {
  itemIds: string[];
  activateForCheck: boolean;
}

const PROMOTE_REQUEST_KEYS = ['itemIds', 'activateForCheck'] as const;

export type ParsePromoteAnnotationContractRequestResult = { ok: true; request: PromoteAnnotationContractRequest } | { ok: false; error: string };

export function parsePromoteAnnotationContractRequest(value: unknown): ParsePromoteAnnotationContractRequestResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'request body must be a JSON object' };
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !(PROMOTE_REQUEST_KEYS as readonly string[]).includes(key));
  if (unknownKeys.length > 0) return { ok: false, error: `unsupported request field(s): ${unknownKeys.slice(0, 10).join(', ')}` };
  const itemIds = parseAuthoringItemIds(record.itemIds);
  if (!itemIds.ok) return itemIds;
  if (typeof record.activateForCheck !== 'boolean') return { ok: false, error: 'activateForCheck must be a boolean' };
  return { ok: true, request: { itemIds: itemIds.itemIds, activateForCheck: record.activateForCheck } };
}

export type ContractActivation = { state: 'not-requested' } | { state: 'activated' } | { state: 'not-configured'; reason: string } | { state: 'failed'; reason: string };

export type PromoteAnnotationContractFailureReason =
  | 'unknown-annotation-handle'
  | 'not-an-annotation'
  | 'reference-annotation'
  | 'source-unavailable'
  | 'project-config-invalid'
  | 'configured-baseline-invalid'
  | PromoteVisualAnnotationContractFailureCode;

export type PromoteAnnotationContractFromViewerResult =
  | { ok: true; contractId: string; contractRequestId: string; handle: string; clauseCount: number; activation: ContractActivation }
  | { ok: false; reason: PromoteAnnotationContractFailureReason; error: string };

const MAX_ACTIVATION_REASON_LENGTH = 300;

/**
 * v0.9 Batch 5 viewer promotion use case (`POST
 * /api/annotations/:handle/promote-contract`). Resolves the saved annotation
 * and its exact canonical source observation, derives `activeBaselineIds`
 * only from an explicitly configured and valid baseline contract, then calls
 * the canonical `promoteVisualAnnotationContract` exactly once. Activation for
 * project `check` happens only when requested, and only through
 * `activateProjectChangeContract`; an activation failure never undoes the
 * persisted contract. Runs through the session's single authoring write
 * queue. Never returns filesystem paths.
 */
export function promoteAnnotationContractFromViewer(root: string, session: ViewerAuthoringSession, annotationHandle: string, request: PromoteAnnotationContractRequest): Promise<PromoteAnnotationContractFromViewerResult> {
  return runSerializedAuthoringWrite(session, () => performPromotion(root, session, annotationHandle, request));
}

async function performPromotion(root: string, session: ViewerAuthoringSession, annotationHandle: string, request: PromoteAnnotationContractRequest): Promise<PromoteAnnotationContractFromViewerResult> {
  const view = await getAnnotationView(root, annotationHandle);
  if (!view.ok) {
    return view.reason === 'unknown-handle'
      ? { ok: false, reason: 'unknown-annotation-handle', error: 'unknown annotation handle' }
      : { ok: false, reason: 'not-an-annotation', error: 'the handle does not name loadable visual-annotation evidence' };
  }
  const { annotation, source } = view;
  if (annotation.source.kind !== 'runtime-observation') {
    return { ok: false, reason: 'reference-annotation', error: 'external-reference annotations are not promoted into frontend change contracts' };
  }
  if (source.status !== 'available' || source.family !== 'observation') {
    return { ok: false, reason: 'source-unavailable', error: 'the annotation source observation is not uniquely available in this evidence root' };
  }
  const sourceLoaded = await loadArtifactByHandle(root, source.handle);
  if (!sourceLoaded.ok || sourceLoaded.detail.family !== 'observation') {
    return { ok: false, reason: 'source-unavailable', error: 'the annotation source observation is no longer loadable' };
  }
  const sourceObservation = sourceLoaded.detail.artifact as ObservationArtifact;

  const config = await readProjectConfig(projectConfigPath(session.projectRoot));
  if (!config.ok) return { ok: false, reason: 'project-config-invalid', error: 'the project configuration is invalid' };

  const contractAcceptance = config.config.acceptance?.contract;
  let activeBaselineIds: string[] = [];
  if (contractAcceptance !== undefined) {
    const baselineRoot = resolveContainedAcceptancePath(session.projectRoot, contractAcceptance.baselineArtifact);
    if (!baselineRoot.ok) return { ok: false, reason: 'configured-baseline-invalid', error: 'the configured baseline contract path is missing or outside the project' };
    const baseline = await readPersistentBaselineContract(path.join(baselineRoot.path, 'manifest.json'));
    if (!baseline.ok) return { ok: false, reason: 'configured-baseline-invalid', error: 'the configured baseline contract is missing or invalid' };
    activeBaselineIds = [baseline.contract.baselineId];
  }

  const promoted = await promoteVisualAnnotationContract({
    annotation,
    sourceObservation,
    selectedItemIds: request.itemIds,
    activeBaselineIds,
    outputLocation: contractOutputLocation(),
    cwd: session.projectRoot,
  });
  if (!promoted.ok) {
    return { ok: false, reason: promoted.code, error: promoted.code === 'persistence-failed' ? 'the change contract could not be persisted' : promoted.reason };
  }

  let activation: ContractActivation = { state: 'not-requested' };
  if (request.activateForCheck) {
    const activated = await activateProjectChangeContract(session.projectRoot, `${contractOutputLocation()}/${promoted.contractId}`);
    if (activated.ok) activation = { state: 'activated' };
    else if (activated.code === 'not-configured') activation = { state: 'not-configured', reason: activated.reason };
    else activation = { state: 'failed', reason: `The change contract was persisted, but project activation failed (${activated.code}).`.slice(0, MAX_ACTIVATION_REASON_LENGTH) };
  }

  return {
    ok: true,
    contractId: promoted.contractId,
    contractRequestId: promoted.contractRequestId,
    handle: encodeArtifactHandle('change-contract', `contracts/${promoted.contractId}`),
    clauseCount: promoted.clauseCount,
    activation,
  };
}
