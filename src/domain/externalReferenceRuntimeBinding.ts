/**
 * v0.7 Prompt 5 explicit reference-region <-> runtime-target binding.
 * Answers only "which stable observer runtime target, if any, does this
 * candidate observation resolve for each explicitly declared reference
 * region?" - never automatic image-based matching, never geometry-based
 * matching, never fuzzy name matching, never source-file/component
 * ownership. A binding declaration is explicit user/configuration input: it
 * asserts a conceptual correspondence between a Prompt 2 reference region
 * and a v0.2 stable runtime target `name`, which this module then validates
 * against an actual `ExternalReferenceArtifact` and a specific
 * `ObservationArtifact` - it never discovers that correspondence itself.
 *
 * Two identity domains are deliberately kept separate throughout:
 * `referenceRegion` (a Prompt 2 `ReferenceRegion.id`) and `runtimeTarget` (a
 * v0.2 `NamedTarget.name`, resolved through the existing v0.2
 * resolver/evidence only - this module never launches a browser, queries
 * Chromium, resolves a CSS selector, or inspects a live DOM). Two strings
 * with the same textual value in the two domains (e.g. a region id "header"
 * and a target name "header") never bind to each other merely because they
 * match - only an explicit declaration does that.
 *
 * Reuses, rather than duplicates:
 * - `evaluateReferenceCandidateCompatibility` (v0.7 Prompt 4) as the
 *   compatibility gate - this module never re-implements viewport/theme/
 *   application-state/authenticated-state comparison.
 * - `targetPresence` (v0.4 `comparisonEngine.ts`, exported additively by
 *   this prompt) as the single canonical "how do I read a
 *   TargetEvidenceRecord's resolution" rule - the same rule v0.4's own
 *   before/after target-presence comparison already uses.
 * - `REFERENCE_REGION_ID_PATTERN` (v0.7 Prompt 2) for the reference-region
 *   half of a binding declaration.
 *
 * No new persisted artifact family is introduced. `evaluateReferenceRuntimeBindings`
 * is a pure, synchronous function of an already-persisted
 * `ExternalReferenceArtifact`, an already-persisted `ObservationArtifact`,
 * and an in-memory binding-declaration collection; it mutates none of its
 * inputs and produces no artifact of its own kind (see the Prompt 5 report
 * for the persistence-decision rationale).
 */
import type { ExternalReferenceArtifact } from './externalReference.js';
import { isValidExternalReferenceArtifact } from './externalReference.js';
import { REFERENCE_REGION_ID_PATTERN } from './externalReferenceRegions.js';
import type { ObservationArtifact, TargetSelectionStatus } from './schema.js';
import { isValidObservationArtifact } from './schema.js';
import type { ComparabilityResult } from './comparison.js';
import { evaluateReferenceCandidateCompatibility } from './externalReferenceCompatibility.js';
import { targetPresence } from './comparisonEngine.js';
import { evidenceValue } from './evidence.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Independently-owned duplicate of request/request.ts's private
 * `TARGET_NAME_RE` (`^[A-Za-z0-9_-]{1,64}$`) - same "stable, portable,
 * log-safe identifier" convention already duplicated by
 * `externalReferenceRegions.ts#REFERENCE_REGION_ID_PATTERN` and
 * `explicitState.ts#STATE_LABEL_PATTERN`. Never imported cross-module, per
 * the established per-module pattern-ownership convention.
 */
export const RUNTIME_TARGET_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Mirrors `MAX_REFERENCE_REGIONS` (20) - a binding declaration collection is authoring input over the same region set, so the same bound applies; independently owned, not imported, since the two constants describe different collections that merely happen to share a value. */
export const MAX_REFERENCE_RUNTIME_BINDINGS = 20;

export const REFERENCE_RUNTIME_BINDING_STATUSES = ['bound', 'ambiguous', 'unavailable'] as const;
export type ReferenceRuntimeBindingStatus = (typeof REFERENCE_RUNTIME_BINDING_STATUSES)[number];

/**
 * Closed, bounded reason vocabulary - one code per distinct evidence
 * situation the evaluator can actually observe, mirroring the
 * "one diagnostic code per validation domain" convention already used by
 * `DIAGNOSTIC_CODES`. Never a place for a free-form or source-derived
 * explanation; `detail` (free text) carries the human-readable specifics.
 */
export const REFERENCE_RUNTIME_BINDING_REASON_CODES = [
  'runtime-target-not-configured',
  'runtime-target-not-found',
  'runtime-target-ambiguous',
  'runtime-target-evidence-unavailable',
] as const;
export type ReferenceRuntimeBindingReasonCode = (typeof REFERENCE_RUNTIME_BINDING_REASON_CODES)[number];

/** One explicit, user/configuration-authored correspondence declaration. Both fields are always exact-match identifiers - never a selector, never a fuzzy label. */
export interface ReferenceRuntimeBindingDeclaration {
  referenceRegion: string;
  runtimeTarget: string;
}

export type ReferenceRuntimeBindingValidationResult = { valid: true } | { valid: false; reason: string };

function isValidBindingDeclarationShape(value: unknown): value is ReferenceRuntimeBindingDeclaration {
  if (!isPlainObject(value)) return false;
  if (typeof value.referenceRegion !== 'string' || !REFERENCE_REGION_ID_PATTERN.test(value.referenceRegion)) return false;
  if (typeof value.runtimeTarget !== 'string' || !RUNTIME_TARGET_NAME_PATTERN.test(value.runtimeTarget)) return false;
  const knownKeys = new Set(['referenceRegion', 'runtimeTarget']);
  return Object.keys(value).every((key) => knownKeys.has(key));
}

/**
 * Structural, candidate-independent validation: shape, bounds, uniqueness,
 * and reference-region existence against the supplied
 * `ExternalReferenceArtifact` only - this never touches a candidate
 * observation (runtime-target availability is inherently per-candidate; see
 * `evaluateReferenceRuntimeBindings`). A reference with no `regions` at all
 * (Prompt 1/2-era artifact, or one that simply declared none) makes every
 * binding declaration fail closed - there is nothing to bind against.
 *
 * Duplicate/conflicting-subject rule (mirrors Prompt 3's requirement-subject
 * uniqueness rule exactly): no two declarations may name the same
 * `referenceRegion` (case-insensitively), regardless of whether their
 * `runtimeTarget` values agree (an exact duplicate) or disagree (a
 * conflict) - both are rejected identically, fail-closed, never resolved by
 * silently keeping the first. The reverse - several distinct reference
 * regions naming the same `runtimeTarget` - is deliberately allowed: two
 * design sub-regions may legitimately correspond to one runtime container
 * element, whereas one region needing several runtime targets would be
 * inherently ambiguous about which target represents it (the "one region,
 * one explicit primary target" rule).
 */
export function isValidReferenceRuntimeBindingDeclarations(value: unknown, reference: ExternalReferenceArtifact): ReferenceRuntimeBindingValidationResult {
  if (!Array.isArray(value)) return { valid: false, reason: 'bindings must be an array' };
  if (value.length > MAX_REFERENCE_RUNTIME_BINDINGS) {
    return { valid: false, reason: `bindings must contain at most ${MAX_REFERENCE_RUNTIME_BINDINGS} entries` };
  }

  const referenceValidation = isValidExternalReferenceArtifact(reference);
  if (!referenceValidation.valid) return { valid: false, reason: `reference is invalid: ${referenceValidation.reason}` };

  const knownRegionIds = new Set((reference.regions ?? []).map((r) => r.id.toLowerCase()));

  const seenRegions = new Set<string>();
  for (const entry of value) {
    if (!isValidBindingDeclarationShape(entry)) {
      return { valid: false, reason: 'each binding must be { referenceRegion, runtimeTarget }, both matching ^[A-Za-z0-9_-]{1,64}$' };
    }
    const lowerRegion = entry.referenceRegion.toLowerCase();
    if (!knownRegionIds.has(lowerRegion)) {
      return { valid: false, reason: `binding refers to unknown reference region id "${entry.referenceRegion}"` };
    }
    if (seenRegions.has(lowerRegion)) {
      return { valid: false, reason: `duplicate or conflicting binding declaration for reference region "${entry.referenceRegion}"` };
    }
    seenRegions.add(lowerRegion);
  }
  return { valid: true };
}

/** Provenance-rich per-declaration outcome. `reasonCode`/`detail` are always present when `status !== 'bound'`; `targetResolutionStatus`/`targetVisible` are populated only when the underlying v0.2 evidence actually carries them (never fabricated). */
export interface ReferenceRuntimeBindingResult {
  referenceRegion: string;
  runtimeTarget: string;
  status: ReferenceRuntimeBindingStatus;
  reasonCode?: ReferenceRuntimeBindingReasonCode;
  detail: string;
  targetResolutionStatus?: TargetSelectionStatus;
  /**
   * Provenance only - visibility never changes `status`. A uniquely
   * resolved (`matched`) target that happens to be hidden still has a
   * stable identity and is reported `bound`; whether a hidden target's
   * evidence is *usable for later fidelity evaluation* is a distinct
   * question this prompt does not answer (see the Prompt 5 report's
   * "hidden-target decision").
   */
  targetVisible?: boolean;
}

export interface ReferenceRuntimeBindingEvaluation {
  referenceId: string;
  referenceRequestId: string;
  candidateObservationId: string;
  candidateRequestId: string;
  /** Reused verbatim from v0.7 Prompt 4 - never recomputed or duplicated here. */
  compatibility: ComparabilityResult;
  /**
   * Empty exactly when `compatibility.state === 'incomparable'` - Prompt 4's
   * compatibility blocker is represented solely through the `compatibility`
   * field above, never through a binding-local "incompatible" status or a
   * fabricated per-declaration result.
   */
  bindings: ReferenceRuntimeBindingResult[];
}

export type EvaluateReferenceRuntimeBindingsResult = { ok: true; evaluation: ReferenceRuntimeBindingEvaluation } | { ok: false; reason: string };

function findConfiguredTargetName(candidate: ObservationArtifact, runtimeTarget: string): string | undefined {
  const lower = runtimeTarget.toLowerCase();
  return candidate.requestConfig.targets.find((t) => t.name.toLowerCase() === lower)?.name;
}

function evaluateOneBinding(candidate: ObservationArtifact, declaration: ReferenceRuntimeBindingDeclaration): ReferenceRuntimeBindingResult {
  const configuredName = findConfiguredTargetName(candidate, declaration.runtimeTarget);
  if (configuredName === undefined) {
    return {
      referenceRegion: declaration.referenceRegion,
      runtimeTarget: declaration.runtimeTarget,
      status: 'unavailable',
      reasonCode: 'runtime-target-not-configured',
      detail: `runtime target "${declaration.runtimeTarget}" was not part of this candidate observation's configured target set`,
    };
  }

  const record = candidate.targetEvidence[configuredName];
  const presence = targetPresence(record);
  const resolution = record ? evidenceValue(record.resolution) : undefined;
  const visibility = record ? evidenceValue(record.visibility) : undefined;
  const targetResolutionStatus = resolution?.selectionStatus;

  if (presence === 'matched') {
    return {
      referenceRegion: declaration.referenceRegion,
      runtimeTarget: declaration.runtimeTarget,
      status: 'bound',
      detail: `runtime target "${declaration.runtimeTarget}" resolved uniquely for this candidate observation`,
      ...(targetResolutionStatus !== undefined ? { targetResolutionStatus } : {}),
      ...(visibility !== undefined ? { targetVisible: visibility.visible } : {}),
    };
  }

  if (presence === 'ambiguous') {
    return {
      referenceRegion: declaration.referenceRegion,
      runtimeTarget: declaration.runtimeTarget,
      status: 'ambiguous',
      reasonCode: 'runtime-target-ambiguous',
      detail: `runtime target "${declaration.runtimeTarget}" resolved ambiguously (more than one match) for this candidate observation`,
      ...(targetResolutionStatus !== undefined ? { targetResolutionStatus } : {}),
    };
  }

  if (presence === 'not-found') {
    return {
      referenceRegion: declaration.referenceRegion,
      runtimeTarget: declaration.runtimeTarget,
      status: 'unavailable',
      reasonCode: 'runtime-target-not-found',
      detail: `runtime target "${declaration.runtimeTarget}" was configured but not found on the candidate observation's page`,
      ...(targetResolutionStatus !== undefined ? { targetResolutionStatus } : {}),
    };
  }

  return {
    referenceRegion: declaration.referenceRegion,
    runtimeTarget: declaration.runtimeTarget,
    status: 'unavailable',
    reasonCode: 'runtime-target-evidence-unavailable',
    detail: `runtime target "${declaration.runtimeTarget}" has no usable resolution evidence in this candidate observation`,
    ...(targetResolutionStatus !== undefined ? { targetResolutionStatus } : {}),
  };
}

/**
 * Pure and synchronous: no browser, no filesystem, no network, no second
 * target resolver. Validates both artifacts and the declaration collection,
 * runs the Prompt 4 compatibility gate exactly once, and - only when the
 * candidate is not `incomparable` with the reference - evaluates each
 * declaration in authored order against the candidate's own already-
 * captured `requestConfig.targets`/`targetEvidence`. Mutates neither input.
 */
export function evaluateReferenceRuntimeBindings(
  reference: ExternalReferenceArtifact,
  candidate: ObservationArtifact,
  declarations: readonly ReferenceRuntimeBindingDeclaration[],
): EvaluateReferenceRuntimeBindingsResult {
  const referenceValidation = isValidExternalReferenceArtifact(reference);
  if (!referenceValidation.valid) return { ok: false, reason: `reference is invalid: ${referenceValidation.reason}` };

  const candidateValidation = isValidObservationArtifact(candidate);
  if (!candidateValidation.valid) return { ok: false, reason: `candidate is invalid: ${candidateValidation.reason}` };

  const declarationsValidation = isValidReferenceRuntimeBindingDeclarations(declarations, reference);
  if (!declarationsValidation.valid) return { ok: false, reason: declarationsValidation.reason };

  const compatibilityResult = evaluateReferenceCandidateCompatibility(reference, candidate);

  const bindings =
    compatibilityResult.compatibility.state === 'incomparable' ? [] : declarations.map((declaration) => evaluateOneBinding(candidate, declaration));

  return {
    ok: true,
    evaluation: {
      referenceId: compatibilityResult.referenceId,
      referenceRequestId: compatibilityResult.referenceRequestId,
      candidateObservationId: compatibilityResult.candidateObservationId,
      candidateRequestId: compatibilityResult.candidateRequestId,
      compatibility: compatibilityResult.compatibility,
      bindings,
    },
  };
}
