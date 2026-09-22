import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readObservationArtifact } from '../artifacts/artifactReader.js';
import { readExternalReferenceArtifact } from '../artifacts/externalReferenceArtifactReader.js';
import { readPerChangeContract, readPersistentBaselineContract } from '../artifacts/frontendContractArtifactReader.js';
import { readVisualAnnotationArtifact } from '../artifacts/visualAnnotationArtifactReader.js';
import { readVisualChangeWorkflowArtifact } from '../artifacts/visualChangeWorkflowArtifactReader.js';
import type { VisualChangeAcceptanceSelection, VisualChangeAttemptRecord, VisualChangeCheckSnapshot, VisualChangeScope, VisualChangeWorkflowArtifact } from '../domain/visualChangeWorkflow.js';
import { MAX_VISUAL_CHANGE_ATTEMPTS } from '../domain/visualChangeWorkflow.js';
import { buildVisualChangeAttemptIdentity } from '../domain/visualChangeWorkflowIdentity.js';
import { readAliasCatalog } from '../projectWorkflow/aliasCatalog.js';
import type { CheckWorkflowResult } from '../projectWorkflow/checkResult.js';
import { resolveContainedAcceptancePath } from '../projectWorkflow/checkAcceptance.js';
import type { FrontendObserverProjectConfig } from '../projectWorkflow/projectConfig.js';
import { validateProjectConfig } from '../projectWorkflow/projectConfig.js';
import { aliasCatalogPath, projectConfigPath, visualChangeOutputLocation } from '../projectWorkflow/projectPaths.js';
import { checkProject } from './projectCheckService.js';
import { persistVisualChangeWorkflow, type PersistVisualChangeWorkflowOptions } from './visualChangeWorkflowPersistenceService.js';

export type VisualChangeProjectWorkflowFailureCode =
  | 'project-config-invalid' | 'workflow-invalid' | 'workflow-reference-invalid'
  | 'activation-not-configured' | 'activation-already-restored' | 'baseline-drift'
  | 'acceptance-drift' | 'check-scope-mismatch' | 'candidate-not-produced'
  | 'duplicate-attempt' | 'attempt-limit-reached' | 'project-config-write-failure'
  | 'workflow-persistence-failure' | 'partial-state-failure';
export interface VisualChangeProjectWorkflowFailure { ok: false; code: VisualChangeProjectWorkflowFailureCode; reason: string; check?: CheckWorkflowResult }

type Persist = typeof persistVisualChangeWorkflow;
type Check = typeof checkProject;
export interface VisualChangeProjectWorkflowDependencies {
  persist: Persist;
  check: Check;
  atomicWrite(file: string, text: string): Promise<void>;
  now(): string;
}

const nativeAtomicWrite = async (file: string, text: string): Promise<void> => {
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try { await writeFile(temporary, text, 'utf8'); await rename(temporary, file); }
  catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
};
const defaults: VisualChangeProjectWorkflowDependencies = { persist: persistVisualChangeWorkflow, check: checkProject, atomicWrite: nativeAtomicWrite, now: () => new Date().toISOString() };
const dependencies = (overrides?: Partial<VisualChangeProjectWorkflowDependencies>): VisualChangeProjectWorkflowDependencies => ({ ...defaults, ...overrides });

function selection(config: FrontendObserverProjectConfig): VisualChangeAcceptanceSelection {
  return {
    ...(config.acceptance?.contract?.changeArtifact === undefined ? {} : { changeContractArtifact: config.acceptance.contract.changeArtifact }),
    ...(config.acceptance?.reference?.approvedArtifact === undefined ? {} : { approvedReferenceArtifact: config.acceptance.reference.approvedArtifact }),
    ...(config.acceptance?.reference?.bindingsFile === undefined ? {} : { bindingsFile: config.acceptance.reference.bindingsFile }),
  };
}
function sameSelection(left: VisualChangeAcceptanceSelection, right: VisualChangeAcceptanceSelection): boolean {
  return left.changeContractArtifact === right.changeContractArtifact && left.approvedReferenceArtifact === right.approvedReferenceArtifact && left.bindingsFile === right.bindingsFile;
}
function failure(code: VisualChangeProjectWorkflowFailureCode, reason: string, check?: CheckWorkflowResult): VisualChangeProjectWorkflowFailure {
  return { ok: false, code, reason, ...(check === undefined ? {} : { check }) };
}
function projectRelative(projectRoot: string, absolute: string): string | undefined {
  const relative = path.relative(projectRoot, absolute).split(path.sep).join('/');
  return relative.length > 0 && !relative.startsWith('../') && !path.posix.isAbsolute(relative) ? relative : undefined;
}
function resolveProjectPath(projectRoot: string, portable: string): string | undefined {
  const resolved = resolveContainedAcceptancePath(projectRoot, portable);
  return resolved.ok ? resolved.path : undefined;
}
async function readConfigState(projectRoot: string): Promise<{ ok: true; rawText: string; raw: Record<string, unknown>; config: FrontendObserverProjectConfig } | VisualChangeProjectWorkflowFailure> {
  try {
    const rawText = await readFile(projectConfigPath(projectRoot), 'utf8');
    const raw = JSON.parse(rawText) as unknown;
    const validated = validateProjectConfig(raw);
    if (!validated.ok || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return failure('project-config-invalid', validated.ok ? 'project configuration root is invalid' : validated.reason);
    return { ok: true, rawText, raw: raw as Record<string, unknown>, config: validated.config };
  } catch (error) { return failure('project-config-invalid', `project configuration could not be read: ${error instanceof Error ? error.message : String(error)}`); }
}
function manifestAt(projectRoot: string, artifactPath: string): string | undefined {
  const root = resolveProjectPath(projectRoot, artifactPath);
  return root === undefined ? undefined : path.join(root, 'manifest.json');
}

async function verifyScope(projectRoot: string, scope: VisualChangeScope): Promise<VisualChangeProjectWorkflowFailure | undefined> {
  const baselineManifest = manifestAt(projectRoot, scope.baselineObservation.artifactPath);
  if (baselineManifest === undefined) return failure('workflow-reference-invalid', 'baseline observation path is unsafe or outside the project');
  const baseline = await readObservationArtifact(baselineManifest);
  if (!baseline.ok || baseline.artifact.observationId !== scope.baselineObservation.observationId || baseline.artifact.requestId !== scope.baselineObservation.requestId || scope.baselineObservation.artifactId !== scope.baselineObservation.observationId) return failure('workflow-reference-invalid', 'frozen baseline observation identity/path does not match canonical evidence');
  const annotationManifest = manifestAt(projectRoot, scope.annotationArtifactPath);
  if (annotationManifest === undefined) return failure('workflow-reference-invalid', 'annotation path is unsafe or outside the project');
  const annotation = await readVisualAnnotationArtifact(annotationManifest);
  if (!annotation.ok || annotation.artifact.annotationId !== scope.annotationId) return failure('workflow-reference-invalid', 'annotation identity/path does not match canonical evidence');
  if (scope.baselineContract !== undefined) {
    const manifest = manifestAt(projectRoot, scope.baselineContract.artifactPath);
    const contract = manifest === undefined ? undefined : await readPersistentBaselineContract(manifest);
    if (contract === undefined || !contract.ok || contract.contract.baselineId !== scope.baselineContract.baselineId) return failure('workflow-reference-invalid', 'baseline contract identity/path does not match canonical evidence');
  }
  if (scope.entryMode === 'actual-frontend') {
    const manifest = manifestAt(projectRoot, scope.changeContract.artifactPath);
    const contract = manifest === undefined ? undefined : await readPerChangeContract(manifest);
    if (contract === undefined || !contract.ok || contract.contract.contractId !== scope.changeContract.contractId || contract.contract.contractRequestId !== scope.changeContract.contractRequestId) return failure('workflow-reference-invalid', 'change contract identity/path does not match canonical evidence');
  } else {
    const manifest = manifestAt(projectRoot, scope.approvedReference.artifactPath);
    const reference = manifest === undefined ? undefined : await readExternalReferenceArtifact(manifest);
    if (reference === undefined || !reference.ok || reference.artifact.referenceId !== scope.approvedReference.referenceId || reference.artifact.referenceRequestId !== scope.approvedReference.referenceRequestId) return failure('workflow-reference-invalid', 'external reference identity/path does not match canonical evidence');
  }
  return undefined;
}

export interface CreateProjectVisualChangeWorkflowInput { projectRoot: string; scope: VisualChangeScope; createdAt?: string; dependencies?: Partial<VisualChangeProjectWorkflowDependencies> }
export type CreateProjectVisualChangeWorkflowResult = Awaited<ReturnType<Persist>> | VisualChangeProjectWorkflowFailure;
export async function createProjectVisualChangeWorkflow(input: CreateProjectVisualChangeWorkflowInput): Promise<CreateProjectVisualChangeWorkflowResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const config = await readConfigState(projectRoot); if (!config.ok) return config;
  const invalid = verifyScope(projectRoot, input.scope); const scopeFailure = await invalid; if (scopeFailure !== undefined) return scopeFailure;
  const persisted = await dependencies(input.dependencies).persist({ scope: input.scope, outputLocation: visualChangeOutputLocation(), cwd: projectRoot, ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }) });
  return persisted.ok ? persisted : failure('workflow-persistence-failure', 'visual-change workflow could not be persisted');
}

async function loadWorkflow(projectRoot: string, workflowManifestPath: string): Promise<{ ok: true; artifact: VisualChangeWorkflowArtifact; manifestPath: string } | VisualChangeProjectWorkflowFailure> {
  const resolved = resolveProjectPath(projectRoot, workflowManifestPath);
  if (resolved === undefined) return failure('workflow-invalid', 'workflow manifest path is unsafe or outside the project');
  const read = await readVisualChangeWorkflowArtifact(resolved);
  return read.ok ? { ok: true, artifact: read.artifact, manifestPath: resolved } : failure('workflow-invalid', read.reason);
}
function updatedConfig(raw: Record<string, unknown>, scope: VisualChangeScope, workflowManifestPath: string, restore?: VisualChangeAcceptanceSelection): Record<string, unknown> {
  const acceptance = { ...(raw.acceptance as Record<string, unknown>) };
  if (scope.entryMode === 'actual-frontend') {
    const contract = { ...(acceptance.contract as Record<string, unknown>) };
    contract.changeArtifact = restore === undefined ? scope.changeContract.artifactPath : restore.changeContractArtifact;
    acceptance.contract = contract;
  } else {
    const reference = { ...(acceptance.reference as Record<string, unknown>) };
    if (restore === undefined) {
      reference.approvedArtifact = scope.approvedReference.artifactPath;
      reference.bindingsFile = `${path.posix.dirname(workflowManifestPath)}/bindings.json`;
    } else {
      reference.approvedArtifact = restore.approvedReferenceArtifact;
      if (restore.bindingsFile === undefined) delete reference.bindingsFile; else reference.bindingsFile = restore.bindingsFile;
    }
    acceptance.reference = reference;
  }
  return { ...raw, acceptance };
}
async function verifiedContractIds(projectRoot: string, config: FrontendObserverProjectConfig): Promise<{ ok: true; baselineId?: string; changeId?: string } | VisualChangeProjectWorkflowFailure> {
  if (config.acceptance?.contract === undefined) return { ok: true };
  const baselineManifest = manifestAt(projectRoot, config.acceptance.contract.baselineArtifact); const changeManifest = manifestAt(projectRoot, config.acceptance.contract.changeArtifact);
  const baseline = baselineManifest === undefined ? undefined : await readPersistentBaselineContract(baselineManifest); const change = changeManifest === undefined ? undefined : await readPerChangeContract(changeManifest);
  if (baseline === undefined || change === undefined || !baseline.ok || !change.ok) return failure('acceptance-drift', 'active contract acceptance is invalid');
  return { ok: true, baselineId: baseline.contract.baselineId, changeId: change.contract.contractId };
}
async function persistRevision(projectRoot: string, source: VisualChangeWorkflowArtifact, options: Omit<PersistVisualChangeWorkflowOptions, 'scope'|'outputLocation'|'cwd'|'supersedesVisualChangeWorkflowId'>, deps: VisualChangeProjectWorkflowDependencies) {
  return deps.persist({ scope: source.scope, attempts: source.attempts, ...(source.activation === undefined ? {} : { activation: source.activation }), ...(source.governanceResults === undefined ? {} : { governanceResults: source.governanceResults }), ...options, supersedesVisualChangeWorkflowId: source.visualChangeWorkflowId, outputLocation: visualChangeOutputLocation(), cwd: projectRoot });
}

export interface ProjectVisualChangeMutationInput { projectRoot: string; workflowManifestPath: string; dependencies?: Partial<VisualChangeProjectWorkflowDependencies> }
export async function activateProjectVisualChangeWorkflow(input: ProjectVisualChangeMutationInput) {
  const projectRoot = path.resolve(input.projectRoot); const deps = dependencies(input.dependencies); const state = await readConfigState(projectRoot); if (!state.ok) return state;
  const loaded = await loadWorkflow(projectRoot, input.workflowManifestPath); if (!loaded.ok) return loaded; const source = loaded.artifact;
  if (source.activation !== undefined) return failure('acceptance-drift', 'workflow already has an activation record');
  const scopeFailure = await verifyScope(projectRoot, source.scope); if (scopeFailure !== undefined) return scopeFailure;
  const acceptance = state.config.acceptance;
  if (source.scope.entryMode === 'actual-frontend') {
    if (acceptance?.contract === undefined) return failure('activation-not-configured', 'project contract acceptance is not configured');
    if (source.scope.baselineContract === undefined || acceptance.contract.baselineArtifact !== source.scope.baselineContract.artifactPath) return failure('acceptance-drift', 'configured baseline contract does not match frozen workflow scope');
  } else {
    if (acceptance?.reference === undefined) return failure('activation-not-configured', 'project reference acceptance is not configured');
    const referenceManifest = manifestAt(projectRoot, source.scope.approvedReference.artifactPath); const reference = referenceManifest === undefined ? undefined : await readExternalReferenceArtifact(referenceManifest);
    if (reference === undefined || !reference.ok || reference.artifact.lifecycle.state !== 'approved') return failure('workflow-reference-invalid', 'workflow reference is not approved');
    if (acceptance.contract === undefined ? source.scope.baselineContract !== undefined : source.scope.baselineContract === undefined || acceptance.contract.baselineArtifact !== source.scope.baselineContract.artifactPath) return failure('acceptance-drift', 'project contract acceptance does not match frozen reference workflow scope');
  }
  const before = selection(state.config); const workflowRelative = projectRelative(projectRoot, loaded.manifestPath); if (workflowRelative === undefined) return failure('workflow-invalid', 'workflow path is outside the project');
  const nextRaw = updatedConfig(state.raw, source.scope, workflowRelative); const validated = validateProjectConfig(nextRaw); if (!validated.ok) return failure('project-config-invalid', validated.reason);
  const nextText = `${JSON.stringify(nextRaw, null, 2)}\n`; const after = selection(validated.config);
  try { await deps.atomicWrite(projectConfigPath(projectRoot), nextText); } catch (error) { return failure('project-config-write-failure', `project configuration could not be written: ${error instanceof Error ? error.message : String(error)}`); }
  const persisted = await persistRevision(projectRoot, source, { activation: { before, after, activatedAt: deps.now() } }, deps);
  if (persisted.ok) return persisted;
  try { await deps.atomicWrite(projectConfigPath(projectRoot), state.rawText); }
  catch (error) { return failure('partial-state-failure', `workflow persistence failed and project acceptance may require manual repair because rollback failed: ${error instanceof Error ? error.message : String(error)}`); }
  return failure('workflow-persistence-failure', 'workflow activation revision could not be persisted; original project configuration was restored');
}

export async function restoreProjectVisualChangeWorkflowAcceptance(input: ProjectVisualChangeMutationInput) {
  const projectRoot = path.resolve(input.projectRoot); const deps = dependencies(input.dependencies); const state = await readConfigState(projectRoot); if (!state.ok) return state;
  const loaded = await loadWorkflow(projectRoot, input.workflowManifestPath); if (!loaded.ok) return loaded; const source = loaded.artifact;
  if (source.activation === undefined) return failure('activation-not-configured', 'workflow has no activation record');
  if (source.activation.restoredAt !== undefined) return failure('activation-already-restored', 'workflow activation has already been restored');
  if (!sameSelection(selection(state.config), source.activation.after)) return failure('acceptance-drift', 'current project acceptance differs from the activated selection');
  const nextRaw = updatedConfig(state.raw, source.scope, input.workflowManifestPath, source.activation.before); const validated = validateProjectConfig(nextRaw); if (!validated.ok) return failure('project-config-invalid', validated.reason);
  const nextText = `${JSON.stringify(nextRaw, null, 2)}\n`;
  try { await deps.atomicWrite(projectConfigPath(projectRoot), nextText); } catch (error) { return failure('project-config-write-failure', `project configuration could not be restored: ${error instanceof Error ? error.message : String(error)}`); }
  const persisted = await persistRevision(projectRoot, source, { activation: { ...source.activation, restoredAt: deps.now() } }, deps);
  if (persisted.ok) return persisted;
  try { await deps.atomicWrite(projectConfigPath(projectRoot), state.rawText); }
  catch (error) { return failure('partial-state-failure', `restore revision persistence failed and project acceptance may require manual repair because compensation failed: ${error instanceof Error ? error.message : String(error)}`); }
  return failure('workflow-persistence-failure', 'restore revision could not be persisted; activated project configuration was reinstated');
}

async function exactBaselineAlias(projectRoot: string, config: FrontendObserverProjectConfig, workflow: VisualChangeWorkflowArtifact): Promise<string | undefined> {
  const catalog = await readAliasCatalog(aliasCatalogPath(projectRoot)); if (!catalog.ok) return undefined;
  const frozen = workflow.scope.baselineObservation;
  const exact = ([, value]: [string, { observationId: string; requestId: string; relativeArtifactDir: string }]) => value.observationId === frozen.observationId && value.requestId === frozen.requestId && `.frontend-observer/evidence/${value.relativeArtifactDir}` === frozen.artifactPath;
  const preferred = catalog.catalog.observations[config.defaultBaseline]; if (preferred !== undefined && exact([config.defaultBaseline, preferred])) return config.defaultBaseline;
  return Object.entries(catalog.catalog.observations).filter(exact).map(([alias]) => alias).sort()[0];
}
export interface VerifiedVisualChangeAcceptance { activeBaselineContractId?: string; activeChangeContractId?: string }
export function projectVisualChangeCheckSnapshot(result: CheckWorkflowResult & { baseline: NonNullable<CheckWorkflowResult['baseline']>; candidate: NonNullable<CheckWorkflowResult['candidate']> }, verified: VerifiedVisualChangeAcceptance): VisualChangeCheckSnapshot {
  const blockerTruncated = result.blockers.length > 50;
  return {
    status: result.status, baselineObservationId: result.baseline.observationId, candidateObservationId: result.candidate.observationId,
    ...(result.comparison.comparisonId === undefined || result.comparison.artifactPath === undefined ? {} : { comparison: { artifactId: result.comparison.comparisonId, artifactPath: result.comparison.artifactPath } }),
    ...(result.contract.evaluationId === undefined || result.contract.artifactPath === undefined ? {} : { contractEvaluation: { artifactId: result.contract.evaluationId, artifactPath: result.contract.artifactPath } }),
    ...(verified.activeBaselineContractId === undefined ? {} : { activeBaselineContractId: verified.activeBaselineContractId }), ...(verified.activeChangeContractId === undefined ? {} : { activeChangeContractId: verified.activeChangeContractId }),
    ...(result.reference.referenceId === undefined ? {} : { externalReferenceId: result.reference.referenceId }), ...(result.reference.fidelityState === undefined ? {} : { referenceFidelityState: result.reference.fidelityState }),
    failedClauseIds: result.contract.failedClauses.map((item) => item.clauseId), unavailableClauseIds: result.contract.unavailableClauses.map((item) => item.clauseId),
    failedReferenceRequirementIds: result.reference.failedRequirements.map((item) => item.requirementId), unavailableReferenceRequirementIds: result.reference.unavailableRequirements.map((item) => item.requirementId),
    unexpectedChangeCount: result.contract.unexpectedChanges.length, blockerCodes: result.blockers.slice(0, 50).map((item) => item.code), blockerReasons: result.blockers.slice(0, 50).map((item) => item.message),
    truncated: result.limits.truncated || result.contract.truncated || result.reference.truncated || blockerTruncated,
  };
}

export interface RunProjectVisualChangeCheckInput extends ProjectVisualChangeMutationInput { coordination?: VisualChangeAttemptRecord['coordination']; referenceCorrectionAttemptId?: string }
export async function runProjectVisualChangeCheck(input: RunProjectVisualChangeCheckInput) {
  const projectRoot = path.resolve(input.projectRoot); const deps = dependencies(input.dependencies); const state = await readConfigState(projectRoot); if (!state.ok) return state;
  const loaded = await loadWorkflow(projectRoot, input.workflowManifestPath); if (!loaded.ok) return loaded; const workflow = loaded.artifact;
  if (workflow.activation === undefined) return failure('activation-not-configured', 'workflow has not been activated');
  if (workflow.activation.restoredAt !== undefined) return failure('activation-already-restored', 'workflow activation has been restored');
  if (!sameSelection(selection(state.config), workflow.activation.after)) return failure('acceptance-drift', 'current project acceptance differs from the activated workflow');
  const scopeFailure = await verifyScope(projectRoot, workflow.scope); if (scopeFailure !== undefined) return failure('acceptance-drift', scopeFailure.reason);
  const alias = await exactBaselineAlias(projectRoot, state.config, workflow); if (alias === undefined) return failure('baseline-drift', 'no catalog alias resolves to the exact frozen baseline observation');
  const ids = await verifiedContractIds(projectRoot, state.config); if (!ids.ok) return ids;
  if (workflow.scope.baselineContract !== undefined && ids.baselineId !== workflow.scope.baselineContract.baselineId) return failure('acceptance-drift', 'active baseline contract identity differs from frozen workflow scope');
  if (workflow.scope.entryMode === 'actual-frontend' && ids.changeId !== workflow.scope.changeContract.contractId) return failure('acceptance-drift', 'active change contract identity differs from frozen workflow scope');
  if (workflow.scope.entryMode === 'reference') {
    const active = state.config.acceptance?.reference;
    const expectedBindings = workflow.activation.after.bindingsFile;
    if (active?.approvedArtifact !== workflow.scope.approvedReference.artifactPath || active.bindingsFile !== expectedBindings) return failure('acceptance-drift', 'active reference or bindings path differs from frozen workflow scope');
    const reread = await readVisualChangeWorkflowArtifact(loaded.manifestPath); if (!reread.ok) return failure('acceptance-drift', 'workflow-owned bindings no longer match frozen declarations');
  }
  const result = await deps.check(projectRoot, alias);
  if (result.baseline === undefined || result.candidate === undefined) return failure('candidate-not-produced', 'canonical check did not produce both baseline and candidate observations; no attempt was recorded', result);
  if (result.baseline.observationId !== workflow.scope.baselineObservation.observationId || result.baseline.requestId !== workflow.scope.baselineObservation.requestId) return failure('check-scope-mismatch', 'canonical check baseline identity differs from frozen workflow scope', result);
  if (workflow.scope.entryMode === 'reference' && result.reference.referenceId !== undefined && result.reference.referenceId !== workflow.scope.approvedReference.referenceId) return failure('check-scope-mismatch', 'canonical reference result identity differs from frozen workflow scope', result);
  const candidatePath = resolveProjectPath(projectRoot, result.candidate.artifactPath); if (candidatePath === undefined) return failure('check-scope-mismatch', 'canonical candidate path is unsafe or outside the project', result);
  const attemptId = buildVisualChangeAttemptIdentity(workflow.visualChangeRequestId, result.candidate.observationId);
  if (workflow.attempts.some((attempt) => attempt.visualChangeAttemptId === attemptId)) return failure('duplicate-attempt', 'this candidate observation is already recorded in workflow history', result);
  if (workflow.attempts.length >= MAX_VISUAL_CHANGE_ATTEMPTS) return failure('attempt-limit-reached', `workflow already contains ${MAX_VISUAL_CHANGE_ATTEMPTS} attempts`, result);
  const attempt: VisualChangeAttemptRecord = {
    visualChangeAttemptId: attemptId, ...(workflow.attempts.length === 0 ? {} : { priorVisualChangeAttemptId: workflow.attempts[workflow.attempts.length - 1]!.visualChangeAttemptId }),
    candidateObservation: { artifactId: result.candidate.observationId, observationId: result.candidate.observationId, requestId: result.candidate.requestId, artifactPath: result.candidate.artifactPath },
    check: projectVisualChangeCheckSnapshot(result as CheckWorkflowResult & { baseline: NonNullable<CheckWorkflowResult['baseline']>; candidate: NonNullable<CheckWorkflowResult['candidate']> }, { ...(ids.baselineId === undefined ? {} : { activeBaselineContractId: ids.baselineId }), ...(ids.changeId === undefined ? {} : { activeChangeContractId: ids.changeId }) }),
    ...(input.coordination === undefined ? {} : { coordination: input.coordination }), ...(input.referenceCorrectionAttemptId === undefined ? {} : { referenceCorrectionAttemptId: input.referenceCorrectionAttemptId }), review: { state: 'pending' }, recordedAt: deps.now(),
  };
  const persisted = await deps.persist({ scope: workflow.scope, attempts: [...workflow.attempts, attempt], activation: workflow.activation, ...(workflow.governanceResults === undefined ? {} : { governanceResults: workflow.governanceResults }), supersedesVisualChangeWorkflowId: workflow.visualChangeWorkflowId, outputLocation: visualChangeOutputLocation(), cwd: projectRoot });
  return persisted.ok ? { ...persisted, check: result, attempt } : failure('workflow-persistence-failure', 'canonical check evidence exists, but visual-change attempt history was not updated', result);
}
