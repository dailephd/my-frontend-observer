/**
 * v0.6 Batch 2 canonical pure runtime projection engine (rescue). Consumes
 * already-loaded evidence (a runtime ObservationArtifact, optionally a prior
 * "before" ObservationArtifact, a ComparisonArtifact, a PersistentBaselineContract,
 * a PerChangeContract, and a FrontendContractEvaluationArtifact - all frozen by
 * v0.4/v0.5/v0.6 Batch 1) and derives one bounded, deterministic
 * BoundedAgentContextArtifact (frozen by v0.6 Batch 1, src/domain/boundedAgentContext.ts).
 *
 * Pure and synchronous: no Chromium, no my-dev-kit invocation, no
 * re-observation, no recomputation of comparison/relationship/contract
 * evaluation logic - those remain owned by their existing v0.4/v0.5 engines.
 * Mutates none of its inputs. Implements no persistence, no CLI, and no
 * static source correlation - correlation records remain an optional,
 * caller-supplied pass-through (see `RuntimeStaticCorrelationRecord`).
 *
 * Rescue note (v0.6 Batch 2 Arm B rescue, corrects IMP-SHARED-001..004 and
 * IMP-B-001..006 against the frozen measurement at
 * 0df4807acdf258c44525ea7e922a2cddabe27c9f): unlike that measurement, this
 * version (1) computes `contextId`/`contextRequestId` itself from the
 * canonical identity helpers instead of accepting them as caller-supplied
 * input, (2) consumes the supplied `evaluationArtifact.clauseResults` for
 * evidence tiering, (3) bounds every output collection (including
 * omissions/truncations themselves) to its frozen aggregate cap, (4) never
 * copies raw diagnostic message text into output, and (5) validates
 * `focusTargetIds` at the public boundary.
 */
import type {
  ProjectionProfile,
  BoundedAgentContextSourceReferences,
  BoundedRuntimeTargetProjection,
  BoundedAgentContextArtifact,
  OmissionRecord,
  TruncationRecord,
  Adequacy,
} from './boundedAgentContext.js';
import {
  MAX_RUNTIME_TARGETS,
  MAX_RELATIONSHIP_EVIDENCE_PER_TARGET,
  MAX_OMISSIONS,
  MAX_TRUNCATIONS,
  BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
  BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
} from './boundedAgentContext.js';
import { buildBoundedAgentContextRequestIdentity, buildBoundedAgentContextInstanceIdentity } from './boundedAgentContextIdentity.js';
import { evidenceValue } from './evidence.js';
import type { EvidenceReference } from './relationships.js';
import { isValidEvidenceReference } from './relationships.js';
import type { ObservationArtifact } from './schema.js';
import { PRODUCER_NAME, isValidObservationArtifact } from './schema.js';
import type { ComparisonArtifact } from './comparison.js';
import { isValidComparisonArtifact } from './comparison.js';
import type { PersistentBaselineContract, PerChangeContract, ContractPrimitive, ClauseResultStatus } from './frontendContracts.js';
import { isValidPersistentBaselineContract, isValidPerChangeContract } from './frontendContracts.js';
import type { FrontendContractEvaluationArtifact } from './frontendContractEvaluationArtifact.js';
import { isValidFrontendContractEvaluationArtifact } from './frontendContractEvaluationArtifact.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidFocusTargetIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

// --- public input/output contract -----------------------------------------

export interface ProjectBoundedAgentContextInput {
  generatedAt: string;
  producerVersion: string;
  projectionProfile: ProjectionProfile;
  /** Explicit caller-requested focus target identities (may be empty). Validated at the boundary - see IMP-B-006. */
  focusTargetIds: readonly string[];
  /** The runtime snapshot the projection samples geometry/visibility/overflow/scroll evidence from. */
  observation: ObservationArtifact;
  /** Optional prior ("before") snapshot, included only for provenance and comparison coherence. */
  baselineObservation?: ObservationArtifact;
  comparison?: ComparisonArtifact;
  baseline?: PersistentBaselineContract;
  change?: PerChangeContract;
  evaluationArtifact?: FrontendContractEvaluationArtifact;
}

export type ProjectBoundedAgentContextResult = { ok: true; artifact: BoundedAgentContextArtifact } | { ok: false; reason: string };

// --- boundary validation -----------------------------------------------------

function validateInput(input: ProjectBoundedAgentContextInput): string | undefined {
  const observationValidation = isValidObservationArtifact(input.observation);
  if (!observationValidation.valid) return `observation is invalid: ${observationValidation.reason}`;

  if (input.baselineObservation !== undefined) {
    const baselineObservationValidation = isValidObservationArtifact(input.baselineObservation);
    if (!baselineObservationValidation.valid) return `baselineObservation is invalid: ${baselineObservationValidation.reason}`;
  }

  if (input.comparison !== undefined) {
    const comparisonValidation = isValidComparisonArtifact(input.comparison);
    if (!comparisonValidation.valid) return `comparison is invalid: ${comparisonValidation.reason}`;
    if (input.comparison.after.observationId !== input.observation.observationId) {
      return 'comparison.after.observationId does not match the supplied observation';
    }
    if (input.baselineObservation === undefined) {
      return 'comparison requires a matching baselineObservation';
    }
    if (input.comparison.before.observationId !== input.baselineObservation.observationId) {
      return 'comparison.before.observationId does not match the supplied baselineObservation';
    }
  }

  // Known authoritative observation identities this request actually carries (IMP-SHARED-004 coherence anchor).
  const knownObservationIds = new Set<string>([input.observation.observationId, ...(input.baselineObservation ? [input.baselineObservation.observationId] : [])]);

  if (input.baseline !== undefined) {
    const baselineValidation = isValidPersistentBaselineContract(input.baseline);
    if (!baselineValidation.valid) return `baseline is invalid: ${baselineValidation.reason}`;
    if (!knownObservationIds.has(input.baseline.sourceObservation.observationId)) {
      return 'baseline.sourceObservation.observationId does not identify the supplied observation or baselineObservation';
    }
  }

  if (input.change !== undefined) {
    const changeValidation = isValidPerChangeContract(input.change);
    if (!changeValidation.valid) return `change is invalid: ${changeValidation.reason}`;
  }

  if (input.evaluationArtifact !== undefined) {
    const evaluationValidation = isValidFrontendContractEvaluationArtifact(input.evaluationArtifact);
    if (!evaluationValidation.valid) return `evaluationArtifact is invalid: ${evaluationValidation.reason}`;
    if (input.comparison === undefined || input.baseline === undefined || input.change === undefined) {
      return 'evaluationArtifact requires comparison, baseline, and change to all be supplied';
    }
    const ea = input.evaluationArtifact;
    if (ea.contracts.baselineId !== input.baseline.baselineId) return 'evaluationArtifact.contracts.baselineId does not match the supplied baseline';
    if (ea.contracts.contractId !== input.change.contractId) return 'evaluationArtifact.contracts.contractId does not match the supplied change contract';
    if (ea.comparisonId !== input.comparison.comparisonId) return 'evaluationArtifact.comparisonId does not match the supplied comparison';
    if (ea.after.observationId !== input.observation.observationId) return 'evaluationArtifact.after does not match the supplied observation';
    if (input.baselineObservation === undefined || ea.before.observationId !== input.baselineObservation.observationId) {
      return 'evaluationArtifact.before does not match the supplied baselineObservation';
    }
  }

  if (!isValidFocusTargetIds(input.focusTargetIds)) return 'focusTargetIds must be an array of non-empty strings';
  if (!isNonEmptyString(input.generatedAt)) return 'generatedAt must be a non-empty string';
  if (!isNonEmptyString(input.producerVersion)) return 'producerVersion must be a non-empty string';

  return undefined;
}

// --- target-id extraction from authored contract primitives -----------------

function primitiveTargetIds(primitive: ContractPrimitive): string[] {
  switch (primitive.kind) {
    case 'target-visible':
    case 'target-not-clipped':
    case 'target-width-within-bound':
    case 'target-does-not-own-scroll':
    case 'target-begins-below-initial-viewport':
      return [primitive.target];
    case 'targets-do-not-overlap':
    case 'target-wider-than':
    case 'target-follows-vertically':
      return [primitive.targetA, primitive.targetB];
    case 'target-fits-inside':
      return [primitive.target, primitive.container];
    case 'property-unchanged-within-tolerance':
    case 'property-increases':
    case 'property-decreases':
      return [primitive.target];
    case 'relationship-unchanged':
      return [primitive.subjectTarget, primitive.relatedTarget].filter(isNonEmptyString);
    case 'document-width-fits-viewport':
    case 'scroll-owner-is-document':
      return [];
    default:
      return [];
  }
}

type EvidenceTier = 'required' | 'optional' | 'context';

interface CollectedEvidence {
  ref: EvidenceReference;
  tier: EvidenceTier;
}

function clauseTier(category: 'requested' | 'expected-dependent' | 'protected' | 'preserved', mode: 'required' | 'permitted' | undefined): EvidenceTier {
  if (category === 'protected' || category === 'preserved') return 'required';
  if (category === 'expected-dependent') return mode === 'permitted' ? 'optional' : 'required';
  return 'optional'; // 'requested'
}

/**
 * Whether an authored change clause belongs to the *required* target-set
 * membership tier (rescue fix for IMP-SHARED-002: previously every change
 * clause target - including 'expected-dependent'/'permitted' ones - was
 * unconditionally added to the required target set, letting a permitted
 * target displace a genuinely required one at the MAX_RUNTIME_TARGETS bound).
 * Only 'protected', 'preserved', 'requested', and 'expected-dependent'/
 * 'required' clauses make their targets required; 'expected-dependent'/
 * 'permitted' clauses make their targets permitted (bound-competing after
 * required allocation, same as relationship-adjacent optional targets).
 */
function isRequiredMembershipClause(category: 'requested' | 'expected-dependent' | 'protected' | 'preserved', mode: 'required' | 'permitted' | undefined): boolean {
  if (category === 'expected-dependent') return mode === 'required';
  return true;
}

/** A non-'pass' clause result must never be silently dropped or displaced (IMP-B-001 / B2-P009-011): its contributed evidence is always required-tier regardless of the clause's own authored category/mode. */
function evidenceTierForClauseResult(status: ClauseResultStatus | undefined, fallback: EvidenceTier): EvidenceTier {
  if (status === 'fail' || status === 'unavailable' || status === 'conflict') return 'required';
  return fallback;
}

/** Aggregate-cap enforcement for the frozen `omissions` collection (IMP-SHARED-001): required-loss records are preserved preferentially, and a single truthful summary record replaces whatever had to be dropped rather than silently vanishing. */
function capOmissions(records: readonly OmissionRecord[], max: number): OmissionRecord[] {
  if (records.length <= max) return [...records];
  const ranked = [...records].sort((a, b) => Number(b.required) - Number(a.required));
  const kept = ranked.slice(0, max - 1);
  const dropped = ranked.slice(max - 1);
  const anyRequired = dropped.some((d) => d.required);
  const summary: OmissionRecord = {
    subject: 'omissions-summary',
    reason: 'omitted-by-bound',
    required: anyRequired,
    detail: `${dropped.length} additional omission record(s) omitted by the aggregate ${max}-omission cap; see the 'targets' truncation record for the true total`,
  };
  return [...kept, summary];
}

/** Aggregate-cap enforcement for the frozen `truncations` collection (IMP-SHARED-001), same policy as `capOmissions`. */
function capTruncations(records: readonly TruncationRecord[], max: number): TruncationRecord[] {
  if (records.length <= max) return [...records];
  const ranked = [...records].sort((a, b) => Number(b.required) - Number(a.required));
  const kept = ranked.slice(0, max - 1);
  const dropped = ranked.slice(max - 1);
  const anyRequired = dropped.some((d) => d.required);
  const summary: TruncationRecord = {
    subject: 'truncations-summary',
    limit: max,
    actualCount: records.length,
    required: anyRequired,
  };
  return [...kept, summary];
}

// --- canonical entry point ---------------------------------------------------

/**
 * The one canonical pure v0.6 bounded runtime projection entry point:
 * already-authoritative v0.1-v0.5 evidence + the frozen Batch 1 bounded-agent-
 * context contract -> one deterministic, bounded `BoundedAgentContextArtifact`.
 * Deterministic given identical semantic input; never mutates its inputs.
 */
export function projectBoundedAgentContext(input: ProjectBoundedAgentContextInput): ProjectBoundedAgentContextResult {
  const validationError = validateInput(input);
  if (validationError) return { ok: false, reason: validationError };

  const { observation, baselineObservation, comparison, baseline, change, evaluationArtifact } = input;

  const sources: BoundedAgentContextSourceReferences = {
    observationIds: baselineObservation ? [baselineObservation.observationId, observation.observationId].sort() : [observation.observationId],
    ...(comparison !== undefined ? { comparisonId: comparison.comparisonId, comparisonRequestId: comparison.comparisonRequestId } : {}),
    ...(baseline !== undefined ? { baselineContractId: baseline.baselineId } : {}),
    ...(change !== undefined ? { changeContractId: change.contractId } : {}),
    ...(evaluationArtifact !== undefined ? { evaluationId: evaluationArtifact.evaluationId, evaluationRequestId: evaluationArtifact.evaluationRequestId } : {}),
  };

  const clauseResultByClauseId = new Map((evaluationArtifact?.clauseResults ?? []).map((r) => [r.clauseId, r] as const));

  // --- relevance: required target ids (explicit focus + authored required-tier clause targets + unexpected-change subjects) --
  const requiredTargetIds = new Set<string>(input.focusTargetIds);
  // --- relevance: permitted target ids (expected-dependent/permitted clause targets - compete for capacity after required allocation, same as relationship-adjacent targets) --
  const permittedTargetIds = new Set<string>();
  const evidenceByTarget = new Map<string, CollectedEvidence[]>();

  function addEvidence(targetId: string, refs: readonly EvidenceReference[], tier: EvidenceTier): void {
    const bucket = evidenceByTarget.get(targetId) ?? [];
    for (const ref of refs) {
      if (isValidEvidenceReference(ref)) bucket.push({ ref, tier });
    }
    evidenceByTarget.set(targetId, bucket);
  }

  for (const clause of baseline?.clauses ?? []) {
    // Baseline clauses have no authored category - they are the frozen 'preserved' invariant and are always required-tier for both membership and evidence.
    const targets = primitiveTargetIds(clause.primitive);
    const clauseResult = clauseResultByClauseId.get(clause.clauseId);
    const evidenceTier = evidenceTierForClauseResult(clauseResult?.status, 'required');
    const evidence = [...clause.supportingEvidence, ...(clauseResult ? clauseResult.supportingEvidence : [])];
    for (const t of targets) {
      requiredTargetIds.add(t);
      addEvidence(t, evidence, evidenceTier);
    }
  }

  for (const clause of change?.clauses ?? []) {
    const targets = primitiveTargetIds(clause.primitive);
    const membershipRequired = isRequiredMembershipClause(clause.category, clause.expectedDependentMode);
    const fallbackEvidenceTier = clauseTier(clause.category, clause.expectedDependentMode);
    const clauseResult = clauseResultByClauseId.get(clause.clauseId);
    const evidenceTier = evidenceTierForClauseResult(clauseResult?.status, fallbackEvidenceTier);
    const evidence = [...clause.supportingEvidence, ...(clauseResult ? clauseResult.supportingEvidence : [])];
    for (const t of targets) {
      if (membershipRequired || evidenceTier === 'required') {
        // A non-'pass' authoritative result always promotes membership to required too - IMP-B-001 requires failed/unavailable/conflict evidence to survive cap pressure, which a merely-permitted target-set membership could still lose entirely.
        requiredTargetIds.add(t);
      } else {
        permittedTargetIds.add(t);
      }
      addEvidence(t, evidence, evidenceTier);
    }
  }

  for (const unexpected of evaluationArtifact?.unexpectedChanges ?? []) {
    const subject = unexpected.subject;
    const targets = subject.type === 'target' ? [subject.target] : subject.type === 'relationship' ? [subject.subjectTarget, subject.relatedTarget].filter(isNonEmptyString) : [];
    for (const t of targets) {
      requiredTargetIds.add(t);
      addEvidence(t, unexpected.supportingEvidence, 'required');
    }
  }
  for (const permitted of permittedTargetIds) {
    if (requiredTargetIds.has(permitted)) permittedTargetIds.delete(permitted);
  }

  // --- relevance: context target ids (one relationship hop from a required OR permitted target) --
  const contextTargetIds = new Set<string>();
  const relationshipGraph = comparison?.relationshipsAfter;
  if (relationshipGraph) {
    const priorityTargetIds = new Set<string>([...requiredTargetIds, ...permittedTargetIds]);
    for (const rel of relationshipGraph.pairwiseRelationships) {
      const subjectPriority = priorityTargetIds.has(rel.subjectTarget);
      const relatedPriority = priorityTargetIds.has(rel.relatedTarget);
      if (subjectPriority && !relatedPriority) {
        contextTargetIds.add(rel.relatedTarget);
        addEvidence(rel.relatedTarget, rel.evidence, 'context');
      }
      if (relatedPriority && !subjectPriority) {
        contextTargetIds.add(rel.subjectTarget);
        addEvidence(rel.subjectTarget, rel.evidence, 'context');
      }
      if (subjectPriority || relatedPriority) {
        addEvidence(rel.subjectTarget, rel.evidence, 'context');
        addEvidence(rel.relatedTarget, rel.evidence, 'context');
      }
    }
  }
  for (const contextId of [...contextTargetIds]) {
    if (requiredTargetIds.has(contextId) || permittedTargetIds.has(contextId)) contextTargetIds.delete(contextId);
  }

  // --- required-first bounded allocation of the `targets` collection (required > permitted > context) --
  const orderedRequired = [...requiredTargetIds].sort();
  const orderedPermitted = [...permittedTargetIds].sort();
  const orderedContext = [...contextTargetIds].sort();
  const allowedRequired = orderedRequired.slice(0, MAX_RUNTIME_TARGETS);
  const droppedRequired = orderedRequired.slice(MAX_RUNTIME_TARGETS);
  let remainingSlots = Math.max(0, MAX_RUNTIME_TARGETS - allowedRequired.length);
  const allowedPermitted = orderedPermitted.slice(0, remainingSlots);
  const droppedPermitted = orderedPermitted.slice(remainingSlots);
  remainingSlots = Math.max(0, remainingSlots - allowedPermitted.length);
  const allowedContext = orderedContext.slice(0, remainingSlots);
  const droppedContext = orderedContext.slice(remainingSlots);

  const omissions: OmissionRecord[] = [];
  const truncations: TruncationRecord[] = [];

  for (const targetId of droppedRequired) {
    omissions.push({ subject: `target:${targetId}`, reason: 'required-evidence-lost-by-bound', required: true });
  }
  for (const targetId of droppedPermitted) {
    omissions.push({ subject: `target:${targetId}`, reason: 'omitted-by-bound', required: false });
  }
  for (const targetId of droppedContext) {
    omissions.push({ subject: `target:${targetId}`, reason: 'omitted-by-bound', required: false });
  }
  const totalCandidateTargets = orderedRequired.length + orderedPermitted.length + orderedContext.length;
  const anyTargetsDropped = droppedRequired.length > 0 || droppedPermitted.length > 0 || droppedContext.length > 0;
  if (anyTargetsDropped) {
    truncations.push({
      subject: 'targets',
      limit: MAX_RUNTIME_TARGETS,
      actualCount: totalCandidateTargets,
      required: droppedRequired.length > 0,
    });
  }

  // --- target-scoped diagnostics -> omissions (frozen contract has no diagnostics field; only the closed diagnostic code is ever propagated - IMP-B-005) --
  const includedTargetIds = new Set<string>([...allowedRequired, ...allowedPermitted, ...allowedContext]);
  for (const diagnostic of observation.diagnostics) {
    if (!diagnostic.targetName || !includedTargetIds.has(diagnostic.targetName)) continue;
    if (diagnostic.code === 'target-missing' || diagnostic.code === 'target-hidden' || diagnostic.code === 'target-ambiguous') {
      omissions.push({
        subject: `target:${diagnostic.targetName}`,
        reason: 'unsupported-or-unavailable',
        required: requiredTargetIds.has(diagnostic.targetName),
        detail: `diagnostic code: ${diagnostic.code}`,
      });
    } else if (diagnostic.code === 'browser-evidence-unavailable' || diagnostic.code === 'partial-evidence') {
      omissions.push({
        subject: `target:${diagnostic.targetName}`,
        reason: 'not-observed',
        required: requiredTargetIds.has(diagnostic.targetName),
        detail: `diagnostic code: ${diagnostic.code}`,
      });
    }
  }

  // --- per-target projection assembly --
  const evidenceTierRank: Record<EvidenceTier, number> = { required: 0, optional: 1, context: 2 };

  function boundedEvidenceForTarget(targetId: string): EvidenceReference[] {
    const collected = evidenceByTarget.get(targetId) ?? [];
    const seen = new Set<string>();
    const deduped: CollectedEvidence[] = [];
    // Rescue fix for IMP-B-003: equal-tier entries are ordered by the stable
    // semantic key `ref.path`, never by caller-supplied array insertion
    // order, so permuting a caller's clause/relationship arrays cannot change
    // which evidence is retained or its output order.
    for (const entry of [...collected].sort((a, b) => {
      const tierDiff = evidenceTierRank[a.tier] - evidenceTierRank[b.tier];
      if (tierDiff !== 0) return tierDiff;
      return a.ref.path < b.ref.path ? -1 : a.ref.path > b.ref.path ? 1 : 0;
    })) {
      if (seen.has(entry.ref.path)) continue;
      seen.add(entry.ref.path);
      deduped.push(entry);
    }
    if (deduped.length > MAX_RELATIONSHIP_EVIDENCE_PER_TARGET) {
      const dropped = deduped.slice(MAX_RELATIONSHIP_EVIDENCE_PER_TARGET);
      const requiredLost = dropped.some((d) => d.tier === 'required');
      truncations.push({
        subject: `target:${targetId}.relationshipEvidence`,
        limit: MAX_RELATIONSHIP_EVIDENCE_PER_TARGET,
        actualCount: deduped.length,
        required: requiredLost,
      });
      if (requiredLost) {
        omissions.push({ subject: `target:${targetId}.relationshipEvidence`, reason: 'required-evidence-lost-by-bound', required: true });
      }
    }
    return deduped.slice(0, MAX_RELATIONSHIP_EVIDENCE_PER_TARGET).map((d) => d.ref);
  }

  const screenshotRef = evidenceValue(observation.screenshot);

  const targets: BoundedRuntimeTargetProjection[] = [...allowedRequired, ...allowedPermitted, ...allowedContext].sort().map((targetId) => {
    const record = observation.targetEvidence[targetId];
    const geometry = record ? evidenceValue(record.geometry) : undefined;
    const visibility = record ? evidenceValue(record.visibility) : undefined;
    const scrollOwner = observation.scrollScenarioEvidence ? evidenceValue(observation.scrollScenarioEvidence.scrollOwner) : undefined;
    const overflowField = observation.scrollScenarioEvidence?.final.targets[targetId]?.overflow;
    const overflow = overflowField ? evidenceValue(overflowField) : undefined;
    const relationshipEvidence = boundedEvidenceForTarget(targetId);

    const projection: BoundedRuntimeTargetProjection = { targetId };
    if (geometry !== undefined) projection.geometry = geometry;
    if (visibility !== undefined) projection.visibility = visibility;
    if (overflow !== undefined) projection.overflow = overflow;
    if (scrollOwner !== undefined) projection.scrollOwner = scrollOwner;
    if (relationshipEvidence.length > 0) projection.relationshipEvidence = relationshipEvidence;
    if (screenshotRef !== undefined) projection.screenshotRef = { path: screenshotRef.path, kind: 'screenshot' };

    if (!record || geometry === undefined) {
      omissions.push({
        subject: `target:${targetId}.geometry`,
        reason: 'unsupported-or-unavailable',
        required: requiredTargetIds.has(targetId),
      });
    }

    return projection;
  });

  // --- aggregate cap enforcement (IMP-SHARED-001): every output collection stays within its frozen cap, with a truthful summary record for whatever had to be dropped --
  const boundedOmissions = capOmissions(omissions, MAX_OMISSIONS);
  const boundedTruncations = capTruncations(truncations, MAX_TRUNCATIONS);

  // --- adequacy (IMP-SHARED-003 / IMP-B-002): derived directly from the full,
  // pre-cap omission/truncation `required` flags so capping the reported
  // collections above can never hide required loss from adequacy, and any
  // known optional-only loss is reported as non-'adequate' truthfully.
  // CONTRACT-002 (partial vs. inadequate threshold) is deliberately left
  // unresolved beyond this: required loss must never report 'adequate';
  // optional-only loss is conservatively reported 'partial'. --
  const anyRequiredLoss = omissions.some((o) => o.required) || truncations.some((t) => t.required);
  const anyOptionalLoss = omissions.some((o) => !o.required) || truncations.some((t) => !t.required);
  const requiredUnavailableCount = allowedRequired.filter((targetId) => {
    const record = observation.targetEvidence[targetId];
    return !record || evidenceValue(record.geometry) === undefined;
  }).length;

  const adequacy: Adequacy = { state: 'adequate', reasons: [] };
  if (droppedRequired.length > 0) {
    adequacy.reasons.push({ code: 'required-evidence-omitted-by-bound', detail: `${droppedRequired.length} required target(s) omitted by the ${MAX_RUNTIME_TARGETS}-target bound` });
  }
  if (requiredUnavailableCount > 0) {
    adequacy.reasons.push({ code: 'required-runtime-target-unavailable', detail: `${requiredUnavailableCount} required target(s) have no available runtime geometry` });
  }
  if (anyRequiredLoss && adequacy.reasons.length === 0) {
    adequacy.reasons.push({ code: 'required-source-evidence-truncated', detail: 'required source evidence was lost to a per-target or aggregate bound' });
  }
  if (adequacy.reasons.length > 0) {
    adequacy.state = orderedRequired.length > 0 && requiredUnavailableCount + droppedRequired.length >= orderedRequired.length ? 'inadequate' : 'partial';
  } else if (anyOptionalLoss) {
    adequacy.state = 'partial';
    adequacy.reasons.push({ code: 'required-source-evidence-truncated', detail: 'optional evidence was truncated by a bound; no required evidence was lost' });
  }

  // --- identity (IMP-B-004): computed here from semantic input via the
  // canonical identity helpers - never accepted as caller-supplied input, so
  // caller/path noise cannot influence logical identity, and fresh instance
  // identity remains a separate concept from the deterministic logical one. --
  const allCandidateTargetIds = [...new Set([...orderedRequired, ...orderedPermitted, ...orderedContext])].sort();
  const contextRequestId = buildBoundedAgentContextRequestIdentity(sources, allCandidateTargetIds, input.projectionProfile);
  const contextId = buildBoundedAgentContextInstanceIdentity(contextRequestId);

  const artifact: BoundedAgentContextArtifact = {
    artifactKind: BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
    schemaVersion: BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
    contextId,
    contextRequestId,
    producer: { name: PRODUCER_NAME, version: input.producerVersion },
    provenance: { generatedAt: input.generatedAt },
    projectionProfile: input.projectionProfile,
    sources,
    targets,
    adequacy,
    omissions: boundedOmissions,
    truncations: boundedTruncations,
  };

  return { ok: true, artifact };
}
