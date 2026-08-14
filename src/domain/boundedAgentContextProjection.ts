/**
 * v0.6 Batch 2 canonical pure runtime projection engine. Consumes
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
  BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
  BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
} from './boundedAgentContext.js';
import { evidenceValue } from './evidence.js';
import type { EvidenceReference } from './relationships.js';
import { isValidEvidenceReference } from './relationships.js';
import type { ObservationArtifact } from './schema.js';
import { PRODUCER_NAME, isValidObservationArtifact } from './schema.js';
import type { ComparisonArtifact } from './comparison.js';
import { isValidComparisonArtifact } from './comparison.js';
import type { PersistentBaselineContract, PerChangeContract, ContractPrimitive } from './frontendContracts.js';
import { isValidPersistentBaselineContract, isValidPerChangeContract } from './frontendContracts.js';
import type { FrontendContractEvaluationArtifact } from './frontendContractEvaluationArtifact.js';
import { isValidFrontendContractEvaluationArtifact } from './frontendContractEvaluationArtifact.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// --- public input/output contract -----------------------------------------

export interface ProjectBoundedAgentContextInput {
  contextId: string;
  contextRequestId: string;
  generatedAt: string;
  producerVersion: string;
  projectionProfile: ProjectionProfile;
  /** Explicit caller-requested focus target identities (may be empty). */
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

  if (input.baseline !== undefined) {
    const baselineValidation = isValidPersistentBaselineContract(input.baseline);
    if (!baselineValidation.valid) return `baseline is invalid: ${baselineValidation.reason}`;
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

  if (!isNonEmptyString(input.contextId)) return 'contextId must be a non-empty string';
  if (!isNonEmptyString(input.contextRequestId)) return 'contextRequestId must be a non-empty string';
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
    observationIds: baselineObservation ? [baselineObservation.observationId, observation.observationId] : [observation.observationId],
    ...(comparison !== undefined ? { comparisonId: comparison.comparisonId, comparisonRequestId: comparison.comparisonRequestId } : {}),
    ...(baseline !== undefined ? { baselineContractId: baseline.baselineId } : {}),
    ...(change !== undefined ? { changeContractId: change.contractId } : {}),
    ...(evaluationArtifact !== undefined ? { evaluationId: evaluationArtifact.evaluationId, evaluationRequestId: evaluationArtifact.evaluationRequestId } : {}),
  };

  // --- relevance: required target ids (explicit focus + all authored clause targets + unexpected-change subjects) --
  const requiredTargetIds = new Set<string>(input.focusTargetIds);
  const evidenceByTarget = new Map<string, CollectedEvidence[]>();

  function addEvidence(targetId: string, refs: readonly EvidenceReference[], tier: EvidenceTier): void {
    const bucket = evidenceByTarget.get(targetId) ?? [];
    for (const ref of refs) {
      if (isValidEvidenceReference(ref)) bucket.push({ ref, tier });
    }
    evidenceByTarget.set(targetId, bucket);
  }

  for (const clause of baseline?.clauses ?? []) {
    const targets = primitiveTargetIds(clause.primitive);
    for (const t of targets) {
      requiredTargetIds.add(t);
      addEvidence(t, clause.supportingEvidence, 'required'); // baseline clauses are always the 'preserved' invariant
    }
  }

  for (const clause of change?.clauses ?? []) {
    const targets = primitiveTargetIds(clause.primitive);
    const tier = clauseTier(clause.category, clause.expectedDependentMode);
    for (const t of targets) {
      requiredTargetIds.add(t);
      addEvidence(t, clause.supportingEvidence, tier);
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

  // --- relevance: optional target ids (one relationship hop from a required target) --
  const optionalTargetIds = new Set<string>();
  const relationshipGraph = comparison?.relationshipsAfter;
  if (relationshipGraph) {
    for (const rel of relationshipGraph.pairwiseRelationships) {
      const subjectRequired = requiredTargetIds.has(rel.subjectTarget);
      const relatedRequired = requiredTargetIds.has(rel.relatedTarget);
      if (subjectRequired && !relatedRequired) {
        optionalTargetIds.add(rel.relatedTarget);
        addEvidence(rel.relatedTarget, rel.evidence, 'context');
      }
      if (relatedRequired && !subjectRequired) {
        optionalTargetIds.add(rel.subjectTarget);
        addEvidence(rel.subjectTarget, rel.evidence, 'context');
      }
      if (subjectRequired || relatedRequired) {
        addEvidence(rel.subjectTarget, rel.evidence, 'context');
        addEvidence(rel.relatedTarget, rel.evidence, 'context');
      }
    }
  }
  for (const optional of [...optionalTargetIds]) {
    if (requiredTargetIds.has(optional)) optionalTargetIds.delete(optional);
  }

  // --- required-first bounded allocation of the `targets` collection --
  const orderedRequired = [...requiredTargetIds].sort();
  const orderedOptional = [...optionalTargetIds].sort();
  const allowedRequired = orderedRequired.slice(0, MAX_RUNTIME_TARGETS);
  const droppedRequired = orderedRequired.slice(MAX_RUNTIME_TARGETS);
  const remainingSlots = Math.max(0, MAX_RUNTIME_TARGETS - allowedRequired.length);
  const allowedOptional = orderedOptional.slice(0, remainingSlots);
  const droppedOptional = orderedOptional.slice(remainingSlots);

  const omissions: OmissionRecord[] = [];
  const truncations: TruncationRecord[] = [];

  for (const targetId of droppedRequired) {
    omissions.push({ subject: `target:${targetId}`, reason: 'required-evidence-lost-by-bound', required: true });
  }
  const totalCandidateTargets = orderedRequired.length + orderedOptional.length;
  if (droppedRequired.length > 0 || droppedOptional.length > 0) {
    truncations.push({
      subject: 'targets',
      limit: MAX_RUNTIME_TARGETS,
      actualCount: totalCandidateTargets,
      required: droppedRequired.length > 0,
    });
  }

  // --- target-scoped diagnostics -> omissions (frozen contract has no diagnostics field) --
  const includedTargetIds = new Set<string>([...allowedRequired, ...allowedOptional]);
  for (const diagnostic of observation.diagnostics) {
    if (!diagnostic.targetName || !includedTargetIds.has(diagnostic.targetName)) continue;
    if (diagnostic.code === 'target-missing' || diagnostic.code === 'target-hidden' || diagnostic.code === 'target-ambiguous') {
      omissions.push({
        subject: `target:${diagnostic.targetName}`,
        reason: 'unsupported-or-unavailable',
        required: requiredTargetIds.has(diagnostic.targetName),
        detail: diagnostic.message,
      });
    } else if (diagnostic.code === 'browser-evidence-unavailable' || diagnostic.code === 'partial-evidence') {
      omissions.push({
        subject: `target:${diagnostic.targetName}`,
        reason: 'not-observed',
        required: requiredTargetIds.has(diagnostic.targetName),
        detail: diagnostic.message,
      });
    }
  }

  // --- per-target projection assembly --
  const evidenceTierRank: Record<EvidenceTier, number> = { required: 0, optional: 1, context: 2 };

  function boundedEvidenceForTarget(targetId: string): EvidenceReference[] {
    const collected = evidenceByTarget.get(targetId) ?? [];
    const seen = new Set<string>();
    const deduped: CollectedEvidence[] = [];
    for (const entry of [...collected].sort((a, b) => evidenceTierRank[a.tier] - evidenceTierRank[b.tier])) {
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

  const targets: BoundedRuntimeTargetProjection[] = [...allowedRequired, ...allowedOptional].sort().map((targetId) => {
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

  // --- adequacy --
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
  if (adequacy.reasons.length === 0) {
    adequacy.state = 'adequate';
  } else if (orderedRequired.length > 0 && requiredUnavailableCount + droppedRequired.length >= orderedRequired.length) {
    adequacy.state = 'inadequate';
  } else {
    adequacy.state = 'partial';
  }

  const artifact: BoundedAgentContextArtifact = {
    artifactKind: BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
    schemaVersion: BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
    contextId: input.contextId,
    contextRequestId: input.contextRequestId,
    producer: { name: PRODUCER_NAME, version: input.producerVersion },
    provenance: { generatedAt: input.generatedAt },
    projectionProfile: input.projectionProfile,
    sources,
    targets,
    adequacy,
    omissions,
    truncations,
  };

  return { ok: true, artifact };
}
