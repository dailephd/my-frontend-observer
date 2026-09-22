import { createHash, randomBytes } from 'node:crypto';
import type { VisualChangeScope } from './visualChangeWorkflow.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k, canonicalize(v)]));
  return value;
}
export function canonicalVisualChangeJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
export function buildVisualChangeRequestIdentity(scope: VisualChangeScope): string {
  const semantic = {
    entryMode: scope.entryMode,
    annotationId: scope.annotationId,
    baselineObservation: { observationId: scope.baselineObservation.observationId, requestId: scope.baselineObservation.requestId },
    ...(scope.baselineContract === undefined ? {} : { baselineContractId: scope.baselineContract.baselineId }),
    ...(scope.entryMode === 'actual-frontend'
      ? { changeContract: { contractId: scope.changeContract.contractId, contractRequestId: scope.changeContract.contractRequestId } }
      : { approvedReference: { referenceId: scope.approvedReference.referenceId, referenceRequestId: scope.approvedReference.referenceRequestId }, bindings: scope.bindings }),
  };
  return createHash('sha256').update(canonicalVisualChangeJson(semantic)).digest('hex');
}
export function buildVisualChangeWorkflowInstanceIdentity(requestId: string): string { return `${requestId}-${randomBytes(16).toString('hex')}`; }
export function buildVisualChangeAttemptIdentity(requestId: string, candidateObservationId: string): string { return createHash('sha256').update(canonicalVisualChangeJson({ visualChangeRequestId: requestId, candidateObservationId })).digest('hex'); }
