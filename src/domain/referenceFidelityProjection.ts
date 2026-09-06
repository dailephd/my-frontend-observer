/**
 * v0.7 Prompt 7 bounded reference-fidelity projection. Consumes an
 * already-computed `ReferenceCandidateFidelityEvaluation` (v0.7 Prompt 6)
 * and selects a small, bounded, deterministically-prioritized subset of it
 * suitable for a coding agent's bounded context - never a second fidelity-
 * evaluation engine, never a recomputation of adequacy/compatibility/
 * binding/tolerance/relationship logic (all reused verbatim from their
 * existing Prompt 3/4/5/6 owners).
 *
 * This module is pure and synchronous: no browser, no filesystem, no
 * network, no my-dev-kit invocation. It mutates none of its inputs.
 *
 * Output shape (`BoundedReferenceFidelityProjection`) is frozen by
 * `domain/boundedAgentContext.ts`; this module only derives one, plus the
 * runtime-target-id/omission/truncation side effects
 * `boundedAgentContextProjection.ts` needs to fold into its own existing
 * required/permitted-target allocation and adequacy computation - it never
 * builds a second, parallel bounded-context artifact.
 */
import type { BoundedReferenceFidelityProjection, OmissionRecord, TruncationRecord } from './boundedAgentContext.js';
import { MAX_FIDELITY_MISMATCHES, MAX_FIDELITY_PROTECTED_CONTEXT } from './boundedAgentContext.js';
import type { ReferenceCandidateFidelityEvaluation, ReferenceRequirementFidelityResult } from './externalReferenceFidelity.js';
import type { AuthoredChangeScopeCategory, ExpectedDependentMode } from './externalReferenceRequirements.js';

export interface ProjectReferenceFidelityOptions {
  /**
   * Whether this bounded-context request's coding-agent task depends on
   * reference-fidelity evidence. Defaults to `true`: supplying a fidelity
   * evaluation to be projected at all is itself the signal that the task
   * cares about it, mirroring `CorrelationTargetInput.required`'s existing
   * v0.6 convention. Set `false` only when fidelity is included purely as
   * incidental context whose unavailability must never affect adequacy.
   */
  required?: boolean;
}

export interface ProjectReferenceFidelityOutput {
  projection: BoundedReferenceFidelityProjection;
  /** Runtime target ids the caller should fold into its own required-tier target set (contributed by required-tier mismatches only). */
  requiredTargetIds: string[];
  /** Runtime target ids the caller should fold into its own permitted-tier target set (contributed by optional-tier mismatches and by protected/preserved context). */
  permittedTargetIds: string[];
  omissions: OmissionRecord[];
  truncations: TruncationRecord[];
}

/**
 * Mirrors `boundedAgentContextProjection.ts#clauseTier`'s exact rule
 * (duplicated, not imported, per this repository's established per-module
 * small-helper-ownership convention): `protected`/`preserved` are always
 * required; `expected-dependent` is required only in `'required'` mode
 * (`'permitted'` mode is optional); `requested` is always optional. Reused
 * verbatim rather than reinvented, per this prompt's explicit instruction
 * not to create reference-specific protected/preserved semantics.
 */
function fidelityRequirementTier(category: AuthoredChangeScopeCategory, mode: ExpectedDependentMode | undefined): 'required' | 'optional' {
  if (category === 'protected' || category === 'preserved') return 'required';
  if (category === 'expected-dependent') return mode === 'required' ? 'required' : 'optional';
  return 'optional'; // 'requested'
}

function dedupePreservingOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function baseProjectionFields(fidelity: ReferenceCandidateFidelityEvaluation): Pick<BoundedReferenceFidelityProjection, 'referenceId' | 'referenceRequestId' | 'candidateObservationId' | 'candidateRequestId' | 'adequacy' | 'compatibility' | 'state' | 'blockedBy'> {
  return {
    referenceId: fidelity.referenceId,
    referenceRequestId: fidelity.referenceRequestId,
    candidateObservationId: fidelity.candidateObservationId,
    candidateRequestId: fidelity.candidateRequestId,
    adequacy: fidelity.adequacy,
    ...(fidelity.compatibility !== undefined ? { compatibility: fidelity.compatibility } : {}),
    state: fidelity.state,
    ...(fidelity.blockedBy !== undefined ? { blockedBy: fidelity.blockedBy } : {}),
  };
}

/**
 * Selects, prioritizes, and bounds one fidelity evaluation's non-passing
 * requirement results plus its passing protected/preserved context, per the
 * documented selection policy (see docs/CONTRACTS.md "v0.7 Prompt 7"):
 *
 * 1. failed required-tier requirements
 * 2. unavailable required-tier requirements
 * 3. any other non-pass (optional-tier) requirement
 *
 * Within a priority class, authored/Prompt-6 order is preserved (a stable
 * sort by priority rank only, never a secondary re-sort). Passing
 * requirements are never dumped by default - only passing `protected`/
 * `preserved` results are surfaced, as bounded "do not break this" context,
 * disjoint from `mismatches` (a *failing* protected/preserved requirement
 * already appears there, at the highest priority, so it is never
 * duplicated into `protectedContext` too).
 *
 * A `not-evaluated` fidelity state never produces `mismatches`/
 * `protectedContext` content - the blocker is preserved via `blockedBy`,
 * and (when `options.required` is true, the default) an explicit
 * `required: true` omission is recorded so a caller folding this into its
 * own adequacy computation can never end up falsely `adequate`.
 */
export function projectReferenceFidelity(fidelity: ReferenceCandidateFidelityEvaluation, options: ProjectReferenceFidelityOptions = {}): ProjectReferenceFidelityOutput {
  const required = options.required ?? true;
  const base = baseProjectionFields(fidelity);

  if (fidelity.state === 'not-evaluated') {
    const omissions: OmissionRecord[] = [
      {
        subject: 'fidelity',
        reason: 'unsupported-or-unavailable',
        required,
        detail: `reference fidelity could not be evaluated (blockedBy: ${fidelity.blockedBy ?? 'unknown'})`,
      },
    ];
    return {
      projection: { ...base, mismatches: [], protectedContext: [] },
      requiredTargetIds: [],
      permittedTargetIds: [],
      omissions,
      truncations: [],
    };
  }

  const omissions: OmissionRecord[] = [];
  const truncations: TruncationRecord[] = [];

  const nonPass = fidelity.requirementResults.filter((r) => r.status !== 'pass');
  type RankedMismatch = { result: ReferenceRequirementFidelityResult; tier: 'required' | 'optional'; rank: number; index: number };
  const ranked: RankedMismatch[] = nonPass.map((result, index) => {
    const tier = fidelityRequirementTier(result.category, result.expectedDependentMode);
    const rank = result.status === 'fail' && tier === 'required' ? 0 : result.status === 'unavailable' && tier === 'required' ? 1 : 2;
    return { result, tier, rank, index };
  });
  const orderedRanked = [...ranked].sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index));
  const includedRanked = orderedRanked.slice(0, MAX_FIDELITY_MISMATCHES);
  const droppedRanked = orderedRanked.slice(MAX_FIDELITY_MISMATCHES);

  for (const dropped of droppedRanked) {
    if (dropped.tier === 'required') {
      omissions.push({ subject: `fidelity-mismatch:${dropped.result.requirementId}`, reason: 'required-evidence-lost-by-bound', required: true });
    }
  }
  if (droppedRanked.length > 0) {
    truncations.push({
      subject: 'fidelity-mismatches',
      limit: MAX_FIDELITY_MISMATCHES,
      actualCount: nonPass.length,
      required: droppedRanked.some((d) => d.tier === 'required'),
    });
  }
  // Reported order is priority-first (failed-required, then unavailable-required, then other
  // non-pass), with Prompt-6 authored order preserved only as the tie-breaker within one priority
  // class - `includedRanked` is already exactly this order (see the sort above).
  const mismatches = includedRanked.map((r) => r.result);

  const protectedCandidates = fidelity.requirementResults.filter((r) => r.status === 'pass' && (r.category === 'protected' || r.category === 'preserved'));
  const protectedContext = protectedCandidates.slice(0, MAX_FIDELITY_PROTECTED_CONTEXT);
  if (protectedCandidates.length > MAX_FIDELITY_PROTECTED_CONTEXT) {
    truncations.push({
      subject: 'fidelity-protected-context',
      limit: MAX_FIDELITY_PROTECTED_CONTEXT,
      actualCount: protectedCandidates.length,
      required: false,
    });
  }

  const requiredTargetIds = dedupePreservingOrder(mismatches.filter((m) => fidelityRequirementTier(m.category, m.expectedDependentMode) === 'required').flatMap((m) => m.boundRuntimeTargets));
  const requiredSet = new Set(requiredTargetIds);
  const permittedTargetIds = dedupePreservingOrder(
    [...mismatches.filter((m) => fidelityRequirementTier(m.category, m.expectedDependentMode) === 'optional'), ...protectedContext]
      .flatMap((m) => m.boundRuntimeTargets)
      .filter((id) => !requiredSet.has(id)),
  );

  return {
    projection: { ...base, mismatches, protectedContext },
    requiredTargetIds,
    permittedTargetIds,
    omissions,
    truncations,
  };
}
