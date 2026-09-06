import { createHash } from 'node:crypto';

/**
 * Deliberately duplicated from domain/identity.ts#canonicalize (itself
 * duplicated across comparisonIdentity.ts/frontendContractIdentity.ts/
 * externalReferenceIdentity.ts) rather than imported - each identity module
 * owns its own private canonicalize per existing repository convention.
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

/**
 * Deterministic identity of a single reference requirement's own semantic
 * content - independent of authoring order or which reference it belongs to.
 * Mirrors domain/frontendContractIdentity.ts#buildClauseIdentity exactly
 * (same canonicalize+sha256 shape over {subject, tolerance}), extended with
 * `category`/`expectedDependentMode` because - unlike a v0.5 baseline
 * clause, whose identity is deliberately category-independent - two
 * reference requirements with the same subject/tolerance but different
 * authored category are semantically distinct authored intents (see
 * docs/CONTRACTS.md "v0.7 Prompt 3").
 */
export function buildReferenceRequirementIdentity(
  subject: unknown,
  category: string,
  tolerance: unknown,
  expectedDependentMode?: string,
): string {
  const semanticView = { subject, category, expectedDependentMode: expectedDependentMode ?? null, tolerance: tolerance ?? null };
  const serialized = JSON.stringify(canonicalize(semanticView));
  return createHash('sha256').update(serialized).digest('hex');
}
