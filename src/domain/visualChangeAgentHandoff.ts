import type { BoundedAgentContextArtifact } from './boundedAgentContext.js';
import { serializeVisualChangeAgentHandoffCanonical } from './visualChangeAgentHandoffSerialization.js';
import { isValidBoundedAgentContextArtifact } from './boundedAgentContext.js';
import type { BaselineClause, PerChangeClause } from './frontendContracts.js';
import { isValidBaselineClause, isValidPerChangeClause } from './frontendContracts.js';
import type { ExternalReferenceRequirement } from './externalReferenceRequirements.js';
import { isValidReferenceRequirementShape } from './externalReferenceRequirements.js';
import type { ReferenceRuntimeBindingDeclaration } from './externalReferenceRuntimeBinding.js';

export const VISUAL_CHANGE_AGENT_HANDOFF_KIND = 'my-frontend-observer/visual-change-agent-handoff' as const;
export const VISUAL_CHANGE_AGENT_HANDOFF_VERSION = '1.0.0' as const;
export const MAX_HANDOFF_TEXT_LENGTH = 1_000;
export const MAX_HANDOFF_VERIFICATION_STEPS = 8;

export interface VisualChangeAgentActualScope {
  entryMode: 'actual-frontend';
  annotationId: string;
  baselineObservation: { observationId: string; requestId: string };
  baselineContract: { baselineId: string; clauses: BaselineClause[] };
  changeContract: { contractId: string; contractRequestId: string; clauses: PerChangeClause[] };
}

export interface VisualChangeAgentReferenceScope {
  entryMode: 'reference';
  annotationId: string;
  baselineObservation: { observationId: string; requestId: string };
  approvedReference: { referenceId: string; referenceRequestId: string; requirements: ExternalReferenceRequirement[] };
  bindings: ReferenceRuntimeBindingDeclaration[];
  baselineContract?: { baselineId: string; clauses: BaselineClause[] };
  activeChangeContract?: { contractId: string; contractRequestId: string; clauses: PerChangeClause[] };
}

export type VisualChangeAgentConfirmedScope = VisualChangeAgentActualScope | VisualChangeAgentReferenceScope;
export type VisualChangeReferenceCorrectionTrace = { status: 'available'; reviewRequestId: string } | { status: 'not-applicable'; reason: 'project-contract-context-not-configured' | 'baseline-contract-source-mismatch' };
export interface VisualChangeExternalCoordination { provider: 'my-dev-kit-orchestrator'; runId: string; packageVersion?: string }

export interface VisualChangeAgentHandoff {
  handoffKind: typeof VISUAL_CHANGE_AGENT_HANDOFF_KIND;
  handoffVersion: typeof VISUAL_CHANGE_AGENT_HANDOFF_VERSION;
  visualChangeRequestId: string;
  visualChangeWorkflowId: string;
  entryMode: 'actual-frontend' | 'reference';
  confirmedScope: VisualChangeAgentConfirmedScope;
  boundedAgentContext: BoundedAgentContextArtifact;
  supplementalContext?: BoundedAgentContextArtifact;
  referenceCorrection?: VisualChangeReferenceCorrectionTrace;
  verificationPlan: string[];
  expectedPostEditCheck: { command: 'check'; baselineAlias: string; json: true };
  externalCoordination?: VisualChangeExternalCoordination;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_HANDOFF_TEXT_LENGTH;
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));

export function isValidVisualChangeExternalCoordination(value: unknown): value is VisualChangeExternalCoordination {
  if (!object(value) || !keys(value, ['provider', 'runId', 'packageVersion']) || value.provider !== 'my-dev-kit-orchestrator' || !text(value.runId) || /[\\/]/.test(value.runId) || /^[A-Za-z]:/.test(value.runId)) return false;
  return value.packageVersion === undefined || (text(value.packageVersion) && !/[\\/]/.test(value.packageVersion) && !/^[A-Za-z]:/.test(value.packageVersion));
}

function validObservationIdentity(value: unknown): boolean { return object(value) && keys(value, ['observationId', 'requestId']) && text(value.observationId) && text(value.requestId); }
function validScope(value: unknown): value is VisualChangeAgentConfirmedScope {
  if (!object(value) || !text(value.annotationId) || !validObservationIdentity(value.baselineObservation)) return false;
  if (value.entryMode === 'actual-frontend') {
    if (!keys(value, ['entryMode', 'annotationId', 'baselineObservation', 'baselineContract', 'changeContract'])) return false;
    const baseline = value.baselineContract; const change = value.changeContract;
    return object(baseline) && keys(baseline, ['baselineId', 'clauses']) && text(baseline.baselineId) && Array.isArray(baseline.clauses) && baseline.clauses.every(isValidBaselineClause)
      && object(change) && keys(change, ['contractId', 'contractRequestId', 'clauses']) && text(change.contractId) && text(change.contractRequestId) && Array.isArray(change.clauses) && change.clauses.every(isValidPerChangeClause);
  }
  if (value.entryMode !== 'reference' || !keys(value, ['entryMode', 'annotationId', 'baselineObservation', 'approvedReference', 'bindings', 'baselineContract', 'activeChangeContract'])) return false;
  const reference = value.approvedReference;
  if (!object(reference) || !keys(reference, ['referenceId', 'referenceRequestId', 'requirements']) || !text(reference.referenceId) || !text(reference.referenceRequestId) || !Array.isArray(reference.requirements) || !reference.requirements.every((item) => isValidReferenceRequirementShape(item).valid)) return false;
  if (!Array.isArray(value.bindings) || !value.bindings.every((binding) => object(binding) && keys(binding, ['referenceRegion', 'runtimeTarget']) && text(binding.referenceRegion) && text(binding.runtimeTarget))) return false;
  const baseline = value.baselineContract; if (baseline !== undefined && (!object(baseline) || !keys(baseline, ['baselineId', 'clauses']) || !text(baseline.baselineId) || !Array.isArray(baseline.clauses) || !baseline.clauses.every(isValidBaselineClause))) return false;
  const change = value.activeChangeContract; return change === undefined || (object(change) && keys(change, ['contractId', 'contractRequestId', 'clauses']) && text(change.contractId) && text(change.contractRequestId) && Array.isArray(change.clauses) && change.clauses.every(isValidPerChangeClause));
}

export function isValidVisualChangeAgentHandoff(value: unknown): value is VisualChangeAgentHandoff {
  if (!object(value) || !keys(value, ['handoffKind','handoffVersion','visualChangeRequestId','visualChangeWorkflowId','entryMode','confirmedScope','boundedAgentContext','supplementalContext','referenceCorrection','verificationPlan','expectedPostEditCheck','externalCoordination'])) return false;
  if (value.handoffKind !== VISUAL_CHANGE_AGENT_HANDOFF_KIND || value.handoffVersion !== VISUAL_CHANGE_AGENT_HANDOFF_VERSION || !text(value.visualChangeRequestId) || !text(value.visualChangeWorkflowId) || !validScope(value.confirmedScope) || value.entryMode !== value.confirmedScope.entryMode || !isValidBoundedAgentContextArtifact(value.boundedAgentContext).valid) return false;
  if (value.supplementalContext !== undefined && !isValidBoundedAgentContextArtifact(value.supplementalContext).valid) return false;
  if (!Array.isArray(value.verificationPlan) || value.verificationPlan.length === 0 || value.verificationPlan.length > MAX_HANDOFF_VERIFICATION_STEPS || !value.verificationPlan.every(text)) return false;
  const check = value.expectedPostEditCheck; if (!object(check) || !keys(check, ['command','baselineAlias','json']) || check.command !== 'check' || !text(check.baselineAlias) || check.json !== true) return false;
  if (value.externalCoordination !== undefined && !isValidVisualChangeExternalCoordination(value.externalCoordination)) return false;
  const trace = value.referenceCorrection;
  if (value.entryMode === 'reference') {
    if (!object(trace) || !keys(trace, ['status','reviewRequestId','reason'])) return false;
    if (trace.status === 'available') { if (!text(trace.reviewRequestId) || trace.reason !== undefined) return false; }
    else if (trace.status === 'not-applicable') { if (!['project-contract-context-not-configured','baseline-contract-source-mismatch'].includes(String(trace.reason)) || trace.reviewRequestId !== undefined) return false; }
    else return false;
  } else if (trace !== undefined) return false;
  return true;
}

export function serializeVisualChangeAgentHandoff(handoff: VisualChangeAgentHandoff): string {
  if (!isValidVisualChangeAgentHandoff(handoff)) throw new Error('visual-change agent handoff is invalid');
  return serializeVisualChangeAgentHandoffCanonical(handoff);
}
