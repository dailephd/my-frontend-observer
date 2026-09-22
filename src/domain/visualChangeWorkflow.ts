import type { ReferenceRuntimeBindingDeclaration } from './externalReferenceRuntimeBinding.js';
import { PRODUCER_NAME } from './schema.js';
import { CHECK_WORKFLOW_STATUSES, type CheckWorkflowStatus } from '../projectWorkflow/checkResult.js';

export const VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND = 'my-frontend-observer/visual-change-workflow' as const;
export const VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION = '1.0.0' as const;
export const MAX_VISUAL_CHANGE_ATTEMPTS = 20;
export const VISUAL_CHANGE_REVIEW_STATES = ['pending', 'correction-requested', 'accepted', 'abandoned'] as const;
export type VisualChangeReviewState = (typeof VISUAL_CHANGE_REVIEW_STATES)[number];

export interface VisualChangeArtifactReference { artifactId: string; artifactPath: string }
export interface VisualChangeObservationReference extends VisualChangeArtifactReference { observationId: string; requestId: string }
export interface VisualChangeContractReference extends VisualChangeArtifactReference { contractId: string; contractRequestId: string }
export interface VisualChangeBaselineContractReference extends VisualChangeArtifactReference { baselineId: string }

interface VisualChangeScopeBase {
  annotationId: string;
  annotationArtifactPath: string;
  baselineObservation: VisualChangeObservationReference;
  baselineContract?: VisualChangeBaselineContractReference;
}
export interface VisualChangeActualScope extends VisualChangeScopeBase {
  entryMode: 'actual-frontend';
  changeContract: VisualChangeContractReference;
}
export interface VisualChangeReferenceScope extends VisualChangeScopeBase {
  entryMode: 'reference';
  approvedReference: VisualChangeArtifactReference & { referenceId: string; referenceRequestId: string };
  bindings: ReferenceRuntimeBindingDeclaration[];
}
export type VisualChangeScope = VisualChangeActualScope | VisualChangeReferenceScope;

export interface VisualChangeCheckSnapshot {
  status: CheckWorkflowStatus;
  baselineObservationId: string;
  candidateObservationId: string;
  comparison?: VisualChangeArtifactReference;
  contractEvaluation?: VisualChangeArtifactReference;
  activeBaselineContractId?: string;
  activeChangeContractId?: string;
  externalReferenceId?: string;
  referenceFidelityState?: 'not-evaluated' | 'pass' | 'fail';
  failedClauseIds: string[];
  unavailableClauseIds: string[];
  failedReferenceRequirementIds: string[];
  unavailableReferenceRequirementIds: string[];
  unexpectedChangeCount: number;
  blockerCodes: string[];
  blockerReasons: string[];
  truncated: boolean;
}
export interface VisualChangeAttemptRecord {
  visualChangeAttemptId: string;
  priorVisualChangeAttemptId?: string;
  candidateObservation: VisualChangeObservationReference;
  check: VisualChangeCheckSnapshot;
  referenceCorrectionAttemptId?: string;
  coordination?: { provider: 'my-dev-kit-orchestrator'; runId: string; packageVersion?: string };
  review: { state: VisualChangeReviewState; decidedAt?: string };
  recordedAt: string;
}
export interface VisualChangeAcceptanceSelection { changeContractArtifact?: string; approvedReferenceArtifact?: string; bindingsFile?: string }
export interface VisualChangeActivationRecord { before: VisualChangeAcceptanceSelection; after: VisualChangeAcceptanceSelection; activatedAt: string; restoredAt?: string }
export interface VisualChangeGovernanceResults { baselineApproval?: VisualChangeArtifactReference; externalReferenceApproval?: VisualChangeArtifactReference }
export interface VisualChangeBindingsMetadata { path: 'bindings.json'; sha256: string; declarationCount: number }
export interface VisualChangeWorkflowArtifact {
  artifactKind: typeof VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND;
  schemaVersion: typeof VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION;
  visualChangeRequestId: string;
  visualChangeWorkflowId: string;
  supersedesVisualChangeWorkflowId?: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  scope: VisualChangeScope;
  attempts: VisualChangeAttemptRecord[];
  bindings?: VisualChangeBindingsMetadata;
  activation?: VisualChangeActivationRecord;
  governanceResults?: VisualChangeGovernanceResults;
  provenance: { createdAt: string };
}

export type VisualChangeWorkflowValidationResult = { valid: true } | { valid: false; reason: string };
const ok: VisualChangeWorkflowValidationResult = { valid: true };
const bad = (reason: string): VisualChangeWorkflowValidationResult => ({ valid: false, reason });
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every((key) => keys.includes(key));
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const safePath = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512 && !v.includes('\\') && !v.startsWith('/') && !/^[A-Za-z]:/.test(v) && v.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const stringArray = (v: unknown, max = 50): v is string[] => Array.isArray(v) && v.length <= max && v.every(text) && new Set(v).size === v.length;

function artifactRef(v: unknown, extra: readonly string[] = []): boolean {
  return object(v) && only(v, ['artifactId', 'artifactPath', ...extra]) && text(v.artifactId) && safePath(v.artifactPath);
}
function observationRef(v: unknown): boolean {
  return artifactRef(v, ['observationId', 'requestId']) && object(v) && text(v.observationId) && text(v.requestId) && v.artifactId === v.observationId;
}
function bindings(v: unknown): v is ReferenceRuntimeBindingDeclaration[] {
  if (!Array.isArray(v) || v.length > 20) return false;
  const seen = new Set<string>();
  for (const item of v) {
    if (!object(item) || !only(item, ['referenceRegion', 'runtimeTarget']) || typeof item.referenceRegion !== 'string' || typeof item.runtimeTarget !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.referenceRegion) || !/^[A-Za-z0-9_-]{1,64}$/.test(item.runtimeTarget)) return false;
    const key = item.referenceRegion.toLowerCase(); if (seen.has(key)) return false; seen.add(key);
  }
  return true;
}
function scope(v: unknown): v is VisualChangeScope {
  if (!object(v)) return false;
  const common = ['entryMode','annotationId','annotationArtifactPath','baselineObservation','baselineContract'];
  if (!text(v.annotationId) || !safePath(v.annotationArtifactPath) || !observationRef(v.baselineObservation)) return false;
  if (v.baselineContract !== undefined && !(artifactRef(v.baselineContract, ['baselineId']) && object(v.baselineContract) && text(v.baselineContract.baselineId) && v.baselineContract.artifactId === v.baselineContract.baselineId)) return false;
  if (v.entryMode === 'actual-frontend') return only(v, [...common,'changeContract']) && artifactRef(v.changeContract, ['contractId','contractRequestId']) && object(v.changeContract) && text(v.changeContract.contractId) && text(v.changeContract.contractRequestId) && v.changeContract.artifactId === v.changeContract.contractId;
  if (v.entryMode === 'reference') return only(v, [...common,'approvedReference','bindings']) && artifactRef(v.approvedReference, ['referenceId','referenceRequestId']) && object(v.approvedReference) && text(v.approvedReference.referenceId) && text(v.approvedReference.referenceRequestId) && v.approvedReference.artifactId === v.approvedReference.referenceId && bindings(v.bindings);
  return false;
}
function check(v: unknown): boolean {
  if (!object(v) || !only(v, ['status','baselineObservationId','candidateObservationId','comparison','contractEvaluation','activeBaselineContractId','activeChangeContractId','externalReferenceId','referenceFidelityState','failedClauseIds','unavailableClauseIds','failedReferenceRequirementIds','unavailableReferenceRequirementIds','unexpectedChangeCount','blockerCodes','blockerReasons','truncated'])) return false;
  if (!CHECK_WORKFLOW_STATUSES.includes(v.status as CheckWorkflowStatus) || !text(v.baselineObservationId) || !text(v.candidateObservationId)) return false;
  if (v.comparison !== undefined && !artifactRef(v.comparison)) return false; if (v.contractEvaluation !== undefined && !artifactRef(v.contractEvaluation)) return false;
  for (const key of ['activeBaselineContractId','activeChangeContractId','externalReferenceId'] as const) if (v[key] !== undefined && !text(v[key])) return false;
  if (v.referenceFidelityState !== undefined && !['not-evaluated','pass','fail'].includes(v.referenceFidelityState as string)) return false;
  return stringArray(v.failedClauseIds) && stringArray(v.unavailableClauseIds) && stringArray(v.failedReferenceRequirementIds) && stringArray(v.unavailableReferenceRequirementIds) && Number.isInteger(v.unexpectedChangeCount) && (v.unexpectedChangeCount as number) >= 0 && stringArray(v.blockerCodes) && stringArray(v.blockerReasons) && typeof v.truncated === 'boolean';
}
function attempt(v: unknown): boolean {
  if (!object(v) || !only(v, ['visualChangeAttemptId','priorVisualChangeAttemptId','candidateObservation','check','referenceCorrectionAttemptId','coordination','review','recordedAt']) || !text(v.visualChangeAttemptId) || !observationRef(v.candidateObservation) || !check(v.check) || !text(v.recordedAt)) return false;
  if (v.priorVisualChangeAttemptId !== undefined && !text(v.priorVisualChangeAttemptId)) return false; if (v.referenceCorrectionAttemptId !== undefined && !text(v.referenceCorrectionAttemptId)) return false;
  if (v.coordination !== undefined && (!object(v.coordination) || !only(v.coordination, ['provider','runId','packageVersion']) || v.coordination.provider !== 'my-dev-kit-orchestrator' || !text(v.coordination.runId) || (v.coordination.packageVersion !== undefined && !text(v.coordination.packageVersion)))) return false;
  return object(v.review) && only(v.review, ['state','decidedAt']) && VISUAL_CHANGE_REVIEW_STATES.includes(v.review.state as VisualChangeReviewState) && (v.review.decidedAt === undefined || text(v.review.decidedAt));
}
function selection(v: unknown): boolean { return object(v) && only(v, ['changeContractArtifact','approvedReferenceArtifact','bindingsFile']) && ['changeContractArtifact','approvedReferenceArtifact','bindingsFile'].every((k) => v[k] === undefined || safePath(v[k])); }

export function isValidVisualChangeWorkflowArtifact(value: unknown): VisualChangeWorkflowValidationResult {
  if (!object(value)) return bad('artifact must be an object');
  if (value.artifactKind !== VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND) return bad('artifactKind mismatch');
  if (value.schemaVersion !== VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION) return bad('schemaVersion mismatch');
  if (!only(value, ['artifactKind','schemaVersion','visualChangeRequestId','visualChangeWorkflowId','supersedesVisualChangeWorkflowId','producer','scope','attempts','bindings','activation','governanceResults','provenance'])) return bad('artifact contains unsupported fields');
  if (!text(value.visualChangeRequestId) || !text(value.visualChangeWorkflowId) || /[\\/]/.test(value.visualChangeWorkflowId)) return bad('workflow identities are invalid');
  if (value.supersedesVisualChangeWorkflowId !== undefined && (!text(value.supersedesVisualChangeWorkflowId) || value.supersedesVisualChangeWorkflowId === value.visualChangeWorkflowId)) return bad('supersedesVisualChangeWorkflowId is invalid');
  if (!object(value.producer) || !only(value.producer, ['name','version']) || value.producer.name !== PRODUCER_NAME || !text(value.producer.version)) return bad('producer is invalid');
  if (!scope(value.scope)) return bad('scope is invalid');
  if (!Array.isArray(value.attempts) || value.attempts.length > MAX_VISUAL_CHANGE_ATTEMPTS || !value.attempts.every(attempt)) return bad(`attempts must contain at most ${MAX_VISUAL_CHANGE_ATTEMPTS} valid entries`);
  const expectedBindingCount = (value.scope as VisualChangeScope).entryMode === 'reference' ? (value.scope as VisualChangeReferenceScope).bindings.length : 0;
  if (value.bindings !== undefined && (!object(value.bindings) || !only(value.bindings, ['path','sha256','declarationCount']) || value.bindings.path !== 'bindings.json' || !sha(value.bindings.sha256) || !Number.isInteger(value.bindings.declarationCount) || value.bindings.declarationCount !== expectedBindingCount)) return bad('bindings metadata is invalid');
  if ((value.scope as VisualChangeScope).entryMode === 'reference' ? value.bindings === undefined : value.bindings !== undefined) return bad('bindings metadata must exist exactly for reference mode');
  if (value.activation !== undefined && (!object(value.activation) || !only(value.activation, ['before','after','activatedAt','restoredAt']) || !selection(value.activation.before) || !selection(value.activation.after) || !text(value.activation.activatedAt) || (value.activation.restoredAt !== undefined && !text(value.activation.restoredAt)))) return bad('activation is invalid');
  if (value.governanceResults !== undefined && (!object(value.governanceResults) || !only(value.governanceResults, ['baselineApproval','externalReferenceApproval']) || (value.governanceResults.baselineApproval !== undefined && !artifactRef(value.governanceResults.baselineApproval)) || (value.governanceResults.externalReferenceApproval !== undefined && !artifactRef(value.governanceResults.externalReferenceApproval)))) return bad('governanceResults is invalid');
  if (!object(value.provenance) || !only(value.provenance, ['createdAt']) || !text(value.provenance.createdAt)) return bad('provenance is invalid');
  return ok;
}
