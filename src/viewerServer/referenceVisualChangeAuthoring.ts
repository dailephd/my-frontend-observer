import path from 'node:path';
import type { ApprovedExternalReferenceArtifact } from '../domain/externalReference.js';
import type { ObservationArtifact } from '../domain/schema.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem } from '../domain/visualAnnotation.js';
import type { ReferenceRuntimeBindingDeclaration } from '../domain/externalReferenceRuntimeBinding.js';
import { evaluateReferenceRuntimeBindings, isValidReferenceRuntimeBindingDeclarations } from '../domain/externalReferenceRuntimeBinding.js';
import { buildReferenceRequirement, deriveReferenceRequirementAdequacy } from '../domain/externalReferenceRequirements.js';
import type { VisualChangeReferenceScope } from '../domain/visualChangeWorkflow.js';
import { createProjectVisualChangeWorkflow } from '../application/visualChangeProjectWorkflowService.js';
import { readProjectConfig } from '../projectWorkflow/projectConfig.js';
import { aliasCatalogPath, projectConfigPath, projectEvidenceRoot } from '../projectWorkflow/projectPaths.js';
import { readAliasCatalog } from '../projectWorkflow/aliasCatalog.js';
import { resolveContainedAcceptancePath } from '../projectWorkflow/checkAcceptance.js';
import { readPersistentBaselineContract } from '../artifacts/frontendContractArtifactReader.js';
import { getAnnotationView } from './evidence/annotationView.js';
import { loadArtifactByHandle } from './evidence/index.js';
import { decodeArtifactHandle } from './evidence/handles.js';
import { resolveContainedDir } from './evidence/pathSafety.js';
import { parseAuthoringItemIds, runSerializedAuthoringWrite } from './annotationAuthoring.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';

export interface StartReferenceVisualChangeRequest { annotationHandle: string; itemIds: string[]; baselineObservationHandle: string; bindings: ReferenceRuntimeBindingDeclaration[] }
export function parseStartReferenceVisualChangeRequest(value: unknown): { ok: true; request: StartReferenceVisualChangeRequest } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'request body must be a JSON object' };
  const record = value as Record<string, unknown>; const allowed = ['annotationHandle','itemIds','baselineObservationHandle','bindings'];
  const extra = Object.keys(record).filter((key) => !allowed.includes(key)); if (extra.length > 0 || Object.keys(record).length !== 4) return { ok: false, error: `request body must contain only ${allowed.join(', ')}` };
  if (typeof record.annotationHandle !== 'string' || record.annotationHandle.length === 0 || typeof record.baselineObservationHandle !== 'string' || record.baselineObservationHandle.length === 0) return { ok: false, error: 'annotationHandle and baselineObservationHandle must be non-empty strings' };
  const ids = parseAuthoringItemIds(record.itemIds); if (!ids.ok) return ids;
  if (!Array.isArray(record.bindings)) return { ok: false, error: 'bindings must be an array' };
  return { ok: true, request: { annotationHandle: record.annotationHandle, itemIds: ids.itemIds, baselineObservationHandle: record.baselineObservationHandle, bindings: record.bindings as ReferenceRuntimeBindingDeclaration[] } };
}

export type StartReferenceVisualChangeResult = { ok: true; visualChangeRequestId: string; visualChangeWorkflowId: string; referenceId: string; referenceRequestId: string; bindingCount: number } | { ok: false; reason: string; error: string };
const relative = (root: string, dir: string) => { const result = path.relative(root, dir).split(path.sep).join('/'); return result && !result.startsWith('../') && !path.posix.isAbsolute(result) ? result : undefined; };
const requiredRegions = (reference: ApprovedExternalReferenceArtifact) => new Set((reference.requirements ?? []).flatMap((requirement) => requirement.subject.kind === 'region-property' ? [requirement.subject.region] : [requirement.subject.subjectRegion, requirement.subject.relatedRegion]));
function selectedIntent(annotation: VisualAnnotationArtifact, ids: readonly string[]): { ok: true; items: VisualAnnotationItem[] } | { ok: false; error: string } {
  const byId = new Map(annotation.items.map((item) => [item.annotationItemId, item])); const items: VisualAnnotationItem[] = [];
  for (const id of ids) { const item = byId.get(id); if (item === undefined || item.interpretation.state !== 'confirmed' || !['reference-region','reference-requirement'].includes(item.interpretation.intent.kind)) return { ok: false, error: `annotation item "${id}" is not confirmed executable reference intent` }; items.push(item); }
  return { ok: true, items };
}

export function startReferenceVisualChangeFromViewer(root: string, session: ViewerAuthoringSession, referenceHandle: string, request: StartReferenceVisualChangeRequest): Promise<StartReferenceVisualChangeResult> {
  return runSerializedAuthoringWrite(session, async () => {
    const loaded = await loadArtifactByHandle(root, referenceHandle);
    if (!loaded.ok) return { ok: false, reason: 'unknown-handle', error: 'unknown reference handle' };
    if (loaded.detail.family !== 'external-reference-approved') return { ok: false, reason: 'reference-not-approved', error: 'only an approved reference can start a visual change' };
    const reference = loaded.detail.artifact as ApprovedExternalReferenceArtifact;
    const annotationView = await getAnnotationView(root, request.annotationHandle);
    if (!annotationView.ok || annotationView.annotation.source.kind !== 'external-reference' || annotationView.source.status !== 'available' || annotationView.source.family !== 'external-reference-approved' || annotationView.source.handle !== referenceHandle) return { ok: false, reason: 'annotation-source-mismatch', error: 'annotation must belong to the exact approved reference' };
    const selected = selectedIntent(annotationView.annotation, request.itemIds); if (!selected.ok) return { ok: false, reason: 'invalid-selection', error: selected.error };
    for (const item of selected.items) {
      const intent = (item.interpretation as Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>).intent;
      if (intent.kind === 'reference-region') { const match = (reference.regions ?? []).find((region) => region.id.toLowerCase() === intent.region.id.toLowerCase()); if (match === undefined || JSON.stringify(match.rectangle) !== JSON.stringify(intent.region.rectangle)) return { ok: false, reason: 'intent-not-represented', error: 'reference intent must first be materialized and explicitly approved' }; }
      if (intent.kind === 'reference-requirement') { const id = buildReferenceRequirement(intent.requirement).requirementId; if (!(reference.requirements ?? []).some((requirement) => requirement.requirementId === id)) return { ok: false, reason: 'intent-not-represented', error: 'reference intent must first be materialized and explicitly approved' }; }
    }
    const adequacy = deriveReferenceRequirementAdequacy(reference.regions ?? [], reference.requirements ?? []); if (adequacy.status !== 'adequate') return { ok: false, reason: 'reference-inadequate', error: 'approved reference requirement evidence must be adequate' };
    const baselineLoaded = await loadArtifactByHandle(root, request.baselineObservationHandle); if (!baselineLoaded.ok || baselineLoaded.detail.family !== 'observation') return { ok: false, reason: 'baseline-invalid', error: 'baselineObservationHandle must identify a supported observation' };
    const baseline = baselineLoaded.detail.artifact as ObservationArtifact;
    const baselineDecoded = decodeArtifactHandle(request.baselineObservationHandle); const baselineRoot = baselineDecoded.ok ? resolveContainedDir(root, baselineDecoded.relativeDir) : undefined;
    const baselinePath = baselineRoot === undefined ? undefined : relative(session.projectRoot, baselineRoot); if (baselinePath === undefined) return { ok: false, reason: 'baseline-invalid', error: 'baseline observation is outside the project' };
    const catalog = await readAliasCatalog(aliasCatalogPath(session.projectRoot)); const evidenceRelative = baselineRoot === undefined ? '' : path.relative(projectEvidenceRoot(session.projectRoot), baselineRoot).split(path.sep).join('/');
    if (!catalog.ok || !Object.values(catalog.catalog.observations).some((entry) => entry.observationId === baseline.observationId && entry.requestId === baseline.requestId && entry.relativeArtifactDir === evidenceRelative)) return { ok: false, reason: 'baseline-alias-missing', error: 'baseline observation has no exact current alias' };
    const config = await readProjectConfig(projectConfigPath(session.projectRoot)); if (!config.ok) return { ok: false, reason: 'project-config-invalid', error: 'project configuration is invalid' }; if (config.config.acceptance?.reference === undefined) return { ok: false, reason: 'reference-not-configured', error: 'project reference acceptance must be configured' };
    const validation = isValidReferenceRuntimeBindingDeclarations(request.bindings, reference); if (!validation.valid) return { ok: false, reason: 'bindings-invalid', error: validation.reason };
    const evaluated = evaluateReferenceRuntimeBindings(reference, baseline, request.bindings); if (!evaluated.ok) return { ok: false, reason: 'bindings-invalid', error: evaluated.reason }; const evaluation = evaluated.evaluation; if (evaluation.compatibility.state === 'incomparable') return { ok: false, reason: 'incomparable', error: 'approved reference and baseline observation are incomparable' };
    const byRegion = new Map(evaluation.bindings.map((binding) => [binding.referenceRegion.toLowerCase(), binding])); for (const region of requiredRegions(reference)) { const binding = byRegion.get(region.toLowerCase()); if (binding === undefined) return { ok: false, reason: 'binding-coverage-incomplete', error: `required reference region "${region}" has no workflow binding` }; if (binding.status !== 'bound') return { ok: false, reason: 'binding-not-bound', error: `required reference region "${region}" is ${binding.status}` }; }
    const annotationDecoded = decodeArtifactHandle(request.annotationHandle); const referenceDecoded = decodeArtifactHandle(referenceHandle); const annotationRoot = annotationDecoded.ok ? resolveContainedDir(root, annotationDecoded.relativeDir) : undefined; const referenceRoot = referenceDecoded.ok ? resolveContainedDir(root, referenceDecoded.relativeDir) : undefined;
    const annotationPath = annotationRoot === undefined ? undefined : relative(session.projectRoot, annotationRoot); const referencePath = referenceRoot === undefined ? undefined : relative(session.projectRoot, referenceRoot); if (annotationPath === undefined || referencePath === undefined) return { ok: false, reason: 'scope-invalid', error: 'workflow evidence is outside the project' };
    let baselineContract: VisualChangeReferenceScope['baselineContract']; if (config.config.acceptance.contract !== undefined) { const configured = config.config.acceptance.contract.baselineArtifact; const resolved = resolveContainedAcceptancePath(session.projectRoot, configured); const read = resolved.ok ? await readPersistentBaselineContract(path.join(resolved.path, 'manifest.json')) : undefined; if (read === undefined || !read.ok) return { ok: false, reason: 'baseline-contract-invalid', error: 'configured baseline contract is invalid' }; baselineContract = { artifactId: read.contract.baselineId, baselineId: read.contract.baselineId, artifactPath: configured }; }
    const scope: VisualChangeReferenceScope = { entryMode: 'reference', annotationId: annotationView.annotation.annotationId, annotationArtifactPath: annotationPath, baselineObservation: { artifactId: baseline.observationId, observationId: baseline.observationId, requestId: baseline.requestId, artifactPath: baselinePath }, ...(baselineContract === undefined ? {} : { baselineContract }), approvedReference: { artifactId: reference.referenceId, referenceId: reference.referenceId, referenceRequestId: reference.referenceRequestId, artifactPath: referencePath }, bindings: request.bindings };
    const workflow = await createProjectVisualChangeWorkflow({ projectRoot: session.projectRoot, scope }); if (!workflow.ok) return { ok: false, reason: 'workflow-persistence-failed', error: 'reason' in workflow ? workflow.reason : workflow.diagnostics.map((item) => item.message).join('; ') };
    return { ok: true, visualChangeRequestId: workflow.visualChangeRequestId, visualChangeWorkflowId: workflow.visualChangeWorkflowId, referenceId: reference.referenceId, referenceRequestId: reference.referenceRequestId, bindingCount: request.bindings.length };
  });
}
