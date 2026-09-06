import { createHash } from 'node:crypto';
import type { ReferenceRuntimeBindingDeclaration } from './externalReferenceRuntimeBinding.js';
import type { BaselineClause, PerChangeClause } from './frontendContracts.js';

/**
 * Deliberately duplicated from domain/identity.ts#canonicalize (and its
 * other per-module duplicates) rather than imported - each identity module
 * owns its own private canonicalize per existing repository convention.
 * Same algorithm (sorted object keys, order-preserving arrays).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => [key, canonicalize(entryValue)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/** Authored binding order is semantic (mirrors every other identity function in this repository's treatment of authored collections) - never sorted away. */
function bindingSemanticView(declarations: readonly ReferenceRuntimeBindingDeclaration[]): { referenceRegion: string; runtimeTarget: string }[] {
  return declarations.map((d) => ({ referenceRegion: d.referenceRegion, runtimeTarget: d.runtimeTarget }));
}

/**
 * Pure function of {referenceRequestId, baselineObservationId,
 * baselineContractId, baselineContractClauses, changeContractId,
 * changeContractClauses, bindingDeclarations} only - never a timestamp,
 * never an operational file path.
 *
 * Includes each contract's own authored `clauses` content, not merely its
 * caller-authored `baselineId`/`contractId` label: unlike this repository's
 * content-derived identities elsewhere (e.g. `ObservationArtifact.observationId`),
 * `PersistentBaselineContract.baselineId`/`PerChangeContract.contractId` are
 * plain author-supplied strings (see `frontendContractPersistenceService.ts`
 * - `approveAndPersistBaseline` persists `contract.baselineId` verbatim,
 * never recomputing it from `clauses`), so two structurally valid contracts
 * could in principle share the same id while authoring different clauses.
 * Hashing clause content directly closes that gap: a caller cannot silently
 * swap in a same-id baseline/per-change contract with different clauses
 * between attempts of the same logical review without `reviewRequestId`
 * changing, which `reviewReferenceCorrectionAttempt`'s own coherence check
 * (recomputing this same hash and rejecting a mismatch) then catches.
 *
 * Two preparation calls over the same approved reference, the same approved
 * baseline observation, the same active baseline/per-change contracts
 * (id *and* clause content), and the same binding declarations always
 * identify the same logical correction review, regardless of which
 * filesystem locations those artifacts were read from.
 */
export function buildReferenceCorrectionReviewIdentity(
  referenceRequestId: string,
  baselineObservationId: string,
  baselineContractId: string,
  baselineContractClauses: readonly BaselineClause[],
  changeContractId: string,
  changeContractClauses: readonly PerChangeClause[],
  bindingDeclarations: readonly ReferenceRuntimeBindingDeclaration[],
): string {
  const semanticView = {
    referenceRequestId,
    baselineObservationId,
    baselineContractId,
    baselineContractClauses,
    changeContractId,
    changeContractClauses,
    bindings: bindingSemanticView(bindingDeclarations),
  };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Pure, deterministic function of {reviewRequestId, candidateObservationId}
 * only - deliberately never a fresh random nonce. Every candidate
 * observation already carries its own fresh, collision-resistant instance
 * identity (see domain/identity.ts#buildObservationIdentity), so hashing it
 * together with the review it was captured for gives an attempt identity
 * that is both stable/reproducible (the same review+candidate pair always
 * yields the same attemptId) and guaranteed distinct per real capture
 * (never a timestamp, never reused across two different candidates).
 */
export function buildReferenceCorrectionAttemptIdentity(reviewRequestId: string, candidateObservationId: string): string {
  const semanticView = { reviewRequestId, candidateObservationId };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}
