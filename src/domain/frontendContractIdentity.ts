import { createHash, randomBytes } from 'node:crypto';
import type { ContractPrimitive, ContractTolerance } from './frontendContracts.js';

/**
 * Deliberately duplicated from domain/comparisonIdentity.ts#canonicalize (itself
 * duplicated from domain/identity.ts#canonicalize) rather than imported - each
 * identity module owns its own private canonicalize per existing repository
 * convention. Same algorithm (sorted object keys, order-preserving arrays).
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

interface ContractRequestIdentityClauseInput {
  primitive: ContractPrimitive;
  tolerance?: ContractTolerance;
}

/**
 * Pure function of {sourceObservationId, clause primitives/tolerances (order
 * preserved), sorted supersedes ids} only. Never includes a filesystem path,
 * output location, a captured timestamp, or clauseId (clauseId is itself
 * derived from primitive/tolerance, so including it would be redundant with -
 * and could desynchronize from - the content it names).
 */
export function buildFrontendContractRequestIdentity(
  sourceObservationId: string,
  clauses: readonly ContractRequestIdentityClauseInput[],
  supersedesIds: readonly string[],
): string {
  const semanticView = {
    sourceObservationId,
    clauses: clauses.map((clause) => ({ primitive: clause.primitive, tolerance: clause.tolerance ?? null })),
    supersedes: [...supersedesIds].sort(),
  };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Fresh, opaque per-authored-instance identity - never derived from a
 * timestamp alone, never collides even when called twice with the same
 * requestIdentity within the same millisecond.
 */
export function buildFrontendContractInstanceIdentity(requestIdentity: string): string {
  const nonce = randomBytes(16).toString('hex');
  return `${requestIdentity}-${nonce}`;
}

/** Deterministic identity of a single clause's own semantic content - independent of authoring order or the contract it belongs to. */
export function buildClauseIdentity(primitive: ContractPrimitive, tolerance?: ContractTolerance): string {
  const serialized = JSON.stringify(canonicalize({ primitive, tolerance: tolerance ?? null }));
  return createHash('sha256').update(serialized).digest('hex');
}
