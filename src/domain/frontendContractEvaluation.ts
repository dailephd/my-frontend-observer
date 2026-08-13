/**
 * v0.5 Batch 2 canonical pure frontend contract evaluation engine. Consumes
 * already-loaded evidence (before/after ObservationArtifact, ComparisonArtifact,
 * PersistentBaselineContract, PerChangeContract - all frozen by v0.4/Batch 1) and
 * derives per-clause results plus one overall PASS/FAIL verdict. Pure and
 * synchronous: no Chromium, no filesystem, no target re-resolution, no
 * reimplementation of v0.4 comparison/relationship/clipping/scroll-owner logic.
 * Mutates none of its inputs. This module owns no persistence, no CLI, and no
 * unexpected-change *authoring* semantics - `unexpected` remains a derived
 * classification only, never an authored category (see domain/frontendContracts.ts).
 */
import type { EvidenceReference, LayoutRelationshipGraph, PairwiseRelationshipKind, PageLevelRelationshipKind } from './relationships.js';
import {
  HORIZONTAL_ORDER_RELATIONSHIPS,
  VERTICAL_ORDER_RELATIONSHIPS,
  AREA_OVERLAP_RELATIONSHIPS,
  RELATIVE_WIDTH_RELATIONSHIPS,
  GEOMETRIC_FIT_RELATIONSHIPS,
  VERTICAL_SEQUENCE_RELATIONSHIPS,
  PAGE_WIDTH_RELATIONSHIPS,
  PAGE_LEVEL_RELATIONSHIP_KINDS,
  deriveTargetClipping,
} from './relationships.js';
import type { TargetClippingEvidence } from './relationships.js';
import type { ObservationArtifact, TargetGeometry, ScrollOwnerInterpretation, VerticalViewportRelation } from './schema.js';
import { isValidObservationArtifact } from './schema.js';
import { evidenceValue } from './evidence.js';
import type { ComparisonArtifact, ComparisonDifference, ComparisonDifferenceSubject, DifferenceKind, DependencyProperty } from './comparison.js';
import { isValidComparisonArtifact } from './comparison.js';
import type {
  PersistentBaselineContract,
  PerChangeContract,
  BaselineClause,
  ContractPrimitive,
  ContractTolerance,
  ClauseEvaluationResult,
  OverallVerdict,
  AuthoredChangeScopeCategory,
  ExpectedDependentMode,
} from './frontendContracts.js';
import { isValidPersistentBaselineContract, isValidPerChangeContract } from './frontendContracts.js';

// --- public input/output contract ---------------------------------------------

export interface FrontendContractEvaluationInput {
  before: ObservationArtifact;
  after: ObservationArtifact;
  comparison: ComparisonArtifact;
  baseline: PersistentBaselineContract;
  change: PerChangeContract;
}

/** A meaningful rendered difference not accounted for by any active authored clause - derived only, never authorable. */
export interface UnexpectedChangeResult {
  classification: 'unexpected';
  subject: ComparisonDifferenceSubject;
  differenceKind: DifferenceKind;
  supportingEvidence: EvidenceReference[];
}

export interface FrontendContractEvaluationResult {
  overallVerdict: OverallVerdict;
  activeBaselineClauseIds: string[];
  supersededBaselineClauseIds: string[];
  clauseResults: ClauseEvaluationResult[];
  unexpectedChanges: UnexpectedChangeResult[];
}

export type EvaluateFrontendContractResult = { ok: true; evaluation: FrontendContractEvaluationResult } | { ok: false; reason: string };

// --- small local helpers --------------------------------------------------------

interface EvalContext {
  before: ObservationArtifact;
  after: ObservationArtifact;
  comparison: ComparisonArtifact;
}

type PrimitiveStatus = 'pass' | 'fail' | 'unavailable';
type EvalMode = 'default' | 'required' | 'permitted' | 'preserved';

function targetGeometry(observation: ObservationArtifact, target: string): TargetGeometry | undefined {
  const record = observation.targetEvidence[target];
  return record ? evidenceValue(record.geometry) : undefined;
}

function targetVisible(observation: ObservationArtifact, target: string): boolean | undefined {
  const record = observation.targetEvidence[target];
  const visibility = record ? evidenceValue(record.visibility) : undefined;
  return visibility?.visible;
}

function targetClipping(observation: ObservationArtifact, target: string): TargetClippingEvidence {
  const record = observation.targetEvidence[target];
  return record ? deriveTargetClipping(record) : { horizontal: 'unavailable', vertical: 'unavailable' };
}

function findPairwiseKind(
  graph: LayoutRelationshipGraph,
  subjectTarget: string,
  relatedTarget: string,
  family: readonly (PairwiseRelationshipKind | PageLevelRelationshipKind)[],
): PairwiseRelationshipKind | undefined {
  return graph.pairwiseRelationships.find(
    (r) => r.subjectTarget === subjectTarget && r.relatedTarget === relatedTarget && (family as readonly string[]).includes(r.kind),
  )?.kind;
}

function scrollOwnerOf(observation: ObservationArtifact): ScrollOwnerInterpretation | undefined {
  return observation.scrollScenarioEvidence ? evidenceValue(observation.scrollScenarioEvidence.scrollOwner) : undefined;
}

function initialViewportRelation(observation: ObservationArtifact, target: string): VerticalViewportRelation | undefined {
  const state = observation.scrollScenarioEvidence?.initial.targets[target];
  const relation = state ? evidenceValue(state.viewportRelation) : undefined;
  return relation?.vertical;
}

function readProperty(observation: ObservationArtifact, target: string, property: DependencyProperty): number | undefined {
  const geometry = targetGeometry(observation, target);
  return geometry ? geometry[property] : undefined;
}

/** Contract tolerance is independent of v0.4's comparison geometry noise tolerance (never reused as authorization). Percent denominator is the absolute before-value, the standard "may vary by up to N%" reading. */
function toleranceToPx(tolerance: ContractTolerance, beforeValue: number): number {
  switch (tolerance.kind) {
    case 'exact':
      return 0;
    case 'absolute-px':
      return tolerance.amount;
    case 'percent':
      return (tolerance.amount / 100) * Math.abs(beforeValue);
  }
}

const RELATIONSHIP_FAMILY_GROUPS: readonly (readonly (PairwiseRelationshipKind | PageLevelRelationshipKind)[])[] = [
  HORIZONTAL_ORDER_RELATIONSHIPS,
  VERTICAL_ORDER_RELATIONSHIPS,
  AREA_OVERLAP_RELATIONSHIPS,
  RELATIVE_WIDTH_RELATIONSHIPS,
  GEOMETRIC_FIT_RELATIONSHIPS,
  VERTICAL_SEQUENCE_RELATIONSHIPS,
  PAGE_WIDTH_RELATIONSHIPS,
];

function familyOf(kind: string): readonly (PairwiseRelationshipKind | PageLevelRelationshipKind)[] | undefined {
  return RELATIONSHIP_FAMILY_GROUPS.find((family) => (family as readonly string[]).includes(kind));
}

function sameFamily(a: string, b: string): boolean {
  const family = familyOf(a);
  return family ? (family as readonly string[]).includes(b) : false;
}

// --- state-checkable primitive evaluation (evaluated against one observation + its relationship graph) --

const STATE_PRIMITIVE_KINDS = new Set([
  'target-visible',
  'target-not-clipped',
  'target-width-within-bound',
  'targets-do-not-overlap',
  'target-wider-than',
  'target-follows-vertically',
  'target-fits-inside',
  'document-width-fits-viewport',
  'scroll-owner-is-document',
  'target-does-not-own-scroll',
  'target-begins-below-initial-viewport',
]);

function isStatePrimitiveKind(kind: ContractPrimitive['kind']): boolean {
  return STATE_PRIMITIVE_KINDS.has(kind);
}

function evaluateStatePrimitive(primitive: ContractPrimitive, observation: ObservationArtifact, graph: LayoutRelationshipGraph): PrimitiveStatus {
  switch (primitive.kind) {
    case 'target-visible': {
      const visible = targetVisible(observation, primitive.target);
      return visible === undefined ? 'unavailable' : visible ? 'pass' : 'fail';
    }
    case 'target-not-clipped': {
      const clip = targetClipping(observation, primitive.target);
      const axis = primitive.axis ?? 'both';
      const checkHorizontal = axis === 'horizontal' || axis === 'both';
      const checkVertical = axis === 'vertical' || axis === 'both';
      if ((checkHorizontal && clip.horizontal === 'unavailable') || (checkVertical && clip.vertical === 'unavailable')) return 'unavailable';
      const clipped = (checkHorizontal && clip.horizontal === 'clipped') || (checkVertical && clip.vertical === 'clipped');
      return clipped ? 'fail' : 'pass';
    }
    case 'target-width-within-bound': {
      const geometry = targetGeometry(observation, primitive.target);
      if (!geometry) return 'unavailable';
      if (primitive.minPx !== undefined && geometry.width < primitive.minPx) return 'fail';
      if (primitive.maxPx !== undefined && geometry.width > primitive.maxPx) return 'fail';
      return 'pass';
    }
    case 'targets-do-not-overlap': {
      const kind = findPairwiseKind(graph, primitive.targetA, primitive.targetB, AREA_OVERLAP_RELATIONSHIPS) ??
        findPairwiseKind(graph, primitive.targetB, primitive.targetA, AREA_OVERLAP_RELATIONSHIPS);
      if (!kind) return 'unavailable';
      return kind === 'does-not-overlap' ? 'pass' : 'fail';
    }
    case 'target-wider-than': {
      const direct = findPairwiseKind(graph, primitive.targetA, primitive.targetB, RELATIVE_WIDTH_RELATIONSHIPS);
      if (direct) return direct === 'wider-than' ? 'pass' : 'fail';
      const reversed = findPairwiseKind(graph, primitive.targetB, primitive.targetA, RELATIVE_WIDTH_RELATIONSHIPS);
      if (reversed) return reversed === 'narrower-than' ? 'pass' : 'fail';
      return 'unavailable';
    }
    case 'target-follows-vertically': {
      const kind = findPairwiseKind(graph, primitive.targetA, primitive.targetB, VERTICAL_SEQUENCE_RELATIONSHIPS);
      if (kind) return 'pass';
      const bothResolvable = targetGeometry(observation, primitive.targetA) !== undefined && targetGeometry(observation, primitive.targetB) !== undefined;
      return bothResolvable ? 'fail' : 'unavailable';
    }
    case 'target-fits-inside': {
      const kind = findPairwiseKind(graph, primitive.target, primitive.container, GEOMETRIC_FIT_RELATIONSHIPS);
      if (!kind) return 'unavailable';
      return kind === 'fits-inside' ? 'pass' : 'fail';
    }
    case 'document-width-fits-viewport': {
      const kind = graph.pageRelationships[0]?.kind;
      if (!kind) return 'unavailable';
      return kind === 'document-width-fits-viewport' ? 'pass' : 'fail';
    }
    case 'scroll-owner-is-document': {
      const owner = scrollOwnerOf(observation);
      if (!owner) return 'unavailable';
      return owner.kind === 'document' ? 'pass' : 'fail';
    }
    case 'target-does-not-own-scroll': {
      const owner = scrollOwnerOf(observation);
      if (!owner) return 'unavailable';
      return owner.kind === 'target' && owner.target === primitive.target ? 'fail' : 'pass';
    }
    case 'target-begins-below-initial-viewport': {
      const relation = initialViewportRelation(observation, primitive.target);
      if (!relation) return 'unavailable';
      return relation === 'below' ? 'pass' : 'fail';
    }
    default:
      return 'unavailable';
  }
}

// --- diff-based primitive evaluation (compares before vs after) -----------------

function evaluateRelationshipUnchanged(primitive: Extract<ContractPrimitive, { kind: 'relationship-unchanged' }>, ctx: EvalContext): PrimitiveStatus {
  const { relationshipKind, subjectTarget, relatedTarget } = primitive;
  const isPageLevel = (PAGE_LEVEL_RELATIONSHIP_KINDS as readonly string[]).includes(relationshipKind);
  if (isPageLevel) {
    const changed = ctx.comparison.relationshipChanges.some((r) => r.scope === 'page');
    if (changed) return 'fail';
    const afterKind = ctx.comparison.relationshipsAfter.pageRelationships[0]?.kind;
    return afterKind === relationshipKind ? 'pass' : 'unavailable';
  }
  if (!subjectTarget || !relatedTarget) return 'unavailable';
  const changed = ctx.comparison.relationshipChanges.some(
    (r) => r.scope === 'pairwise' && r.subjectTarget === subjectTarget && r.relatedTarget === relatedTarget && sameFamily(r.kind, relationshipKind),
  );
  if (changed) return 'fail';
  const family = familyOf(relationshipKind);
  if (!family) return 'unavailable';
  const afterKind = findPairwiseKind(ctx.comparison.relationshipsAfter, subjectTarget, relatedTarget, family);
  return afterKind === relationshipKind ? 'pass' : 'unavailable';
}

function evaluatePropertyUnchanged(primitive: Extract<ContractPrimitive, { kind: 'property-unchanged-within-tolerance' }>, ctx: EvalContext): PrimitiveStatus {
  const before = readProperty(ctx.before, primitive.target, primitive.property);
  const after = readProperty(ctx.after, primitive.target, primitive.property);
  if (before === undefined || after === undefined) return 'unavailable';
  const toleranceAmount = toleranceToPx(primitive.tolerance, before);
  return Math.abs(after - before) <= toleranceAmount ? 'pass' : 'fail';
}

/** `permitted` relaxes "must occur" to "may occur": no change and compliant change both pass; only the strictly-opposite direction fails. */
function evaluatePropertyDirectional(
  primitive: Extract<ContractPrimitive, { kind: 'property-increases' | 'property-decreases' }>,
  ctx: EvalContext,
  permitted: boolean,
): PrimitiveStatus {
  const before = readProperty(ctx.before, primitive.target, primitive.property);
  const after = readProperty(ctx.after, primitive.target, primitive.property);
  if (before === undefined || after === undefined) return 'unavailable';
  const delta = after - before;
  const magnitude = primitive.minimumDeltaPx ?? 0;
  const increases = primitive.kind === 'property-increases';
  const compliant = increases ? delta > magnitude : delta < -magnitude;
  if (compliant) return 'pass';
  if (!permitted) return 'fail';
  const contradictory = increases ? delta < 0 : delta > 0;
  return contradictory ? 'fail' : 'pass';
}

function evaluatePrimitiveResult(primitive: ContractPrimitive, mode: EvalMode, ctx: EvalContext): PrimitiveStatus {
  switch (primitive.kind) {
    case 'relationship-unchanged':
      return evaluateRelationshipUnchanged(primitive, ctx);
    case 'property-unchanged-within-tolerance':
      return evaluatePropertyUnchanged(primitive, ctx);
    case 'property-increases':
    case 'property-decreases':
      return evaluatePropertyDirectional(primitive, ctx, mode === 'permitted');
    default:
      return evaluateStatePrimitive(primitive, ctx.after, ctx.comparison.relationshipsAfter);
  }
}

// --- clause-level evaluation (adds the preserved baseline-truth pre-check) ------

function clauseMode(category: AuthoredChangeScopeCategory, dependentMode: ExpectedDependentMode | undefined): EvalMode {
  if (category === 'expected-dependent') return dependentMode === 'permitted' ? 'permitted' : 'required';
  if (category === 'preserved') return 'preserved';
  return 'default';
}

function toClauseResult(clauseId: string, status: PrimitiveStatus, supportingEvidence: EvidenceReference[]): ClauseEvaluationResult {
  if (status === 'unavailable') {
    return { clauseId, status: 'unavailable', reason: 'required evidence to evaluate this contract clause is unavailable', supportingEvidence };
  }
  return { clauseId, status, supportingEvidence };
}

/**
 * `mode === 'preserved'` additionally proves the invariant already held in
 * `before` (using the same before-evidence + `comparison.relationshipsBefore`
 * the v0.4 comparison engine already derived - never re-derived here). An
 * invariant that never held in the baseline cannot be truthfully evaluated as
 * "preserved" or silently redefined as a new regression, per the frozen
 * Batch 1 honesty requirement - reported `unavailable`, never `pass`/`fail`.
 */
function evaluateClause(clauseId: string, primitive: ContractPrimitive, mode: EvalMode, ctx: EvalContext, supportingEvidence: EvidenceReference[]): ClauseEvaluationResult {
  if (mode === 'preserved' && isStatePrimitiveKind(primitive.kind)) {
    const baselineStatus = evaluateStatePrimitive(primitive, ctx.before, ctx.comparison.relationshipsBefore);
    if (baselineStatus === 'fail') {
      return {
        clauseId,
        status: 'unavailable',
        reason: 'asserted preserved invariant does not hold in the baseline (before) evidence, so preservation cannot be truthfully evaluated',
        supportingEvidence,
      };
    }
  }
  const status = evaluatePrimitiveResult(primitive, mode, ctx);
  return toClauseResult(clauseId, status, supportingEvidence);
}

// --- bounded, deterministic conflict detection -----------------------------------

function primitiveTargetProperty(p: ContractPrimitive): { target: string; property: DependencyProperty } | undefined {
  if (p.kind === 'property-unchanged-within-tolerance' || p.kind === 'property-increases' || p.kind === 'property-decreases') {
    return { target: p.target, property: p.property };
  }
  return undefined;
}

function directionOf(p: ContractPrimitive): 'unchanged' | 'increase' | 'decrease' | undefined {
  if (p.kind === 'property-unchanged-within-tolerance') return 'unchanged';
  if (p.kind === 'property-increases') return 'increase';
  if (p.kind === 'property-decreases') return 'decrease';
  return undefined;
}

/**
 * Bounded to structurally-provable contradictions on the same (target, property)
 * pair (e.g. "unchanged" vs "increases", or "increases" vs "decreases") - never a
 * general constraint solver. Two clauses whose contradiction cannot be established
 * this way from their structured form are evaluated independently, per governing
 * scope (Section 8).
 */
function primitivesConflict(a: ContractPrimitive, b: ContractPrimitive): boolean {
  const at = primitiveTargetProperty(a);
  const bt = primitiveTargetProperty(b);
  if (!at || !bt) return false;
  if (at.target !== bt.target || at.property !== bt.property) return false;
  const ad = directionOf(a);
  const bd = directionOf(b);
  return ad !== undefined && bd !== undefined && ad !== bd;
}

// --- difference-to-scope matching (deterministic, structural identity only) -----

function relationshipDiffMatchesPair(diff: ComparisonDifference, family: readonly (PairwiseRelationshipKind | PageLevelRelationshipKind)[], a: string, b: string): boolean {
  if (diff.subject.type !== 'relationship') return false;
  if (!(family as readonly string[]).includes(diff.subject.kind)) return false;
  const { subjectTarget, relatedTarget } = diff.subject;
  return (subjectTarget === a && relatedTarget === b) || (subjectTarget === b && relatedTarget === a);
}

/**
 * One authored clause "accounts for" a raw `ComparisonDifference` only when
 * their structural subject/kind identity matches (never array position, prose,
 * or fuzzy name matching). `target-begins-below-initial-viewport` is
 * state-only and never accounts for any before/after difference. DOM
 * containment (`containment-changed`) is deliberately never accounted for by
 * any frozen primitive - the vocabulary only models geometric fit
 * (`target-fits-inside`), a distinct concept - so a containment change is
 * always `unexpected`, by design.
 */
function primitiveAccountsForDifference(primitive: ContractPrimitive, diff: ComparisonDifference): boolean {
  switch (primitive.kind) {
    case 'target-visible':
      return diff.subject.type === 'target' && diff.subject.target === primitive.target && (diff.kind === 'visibility-changed' || diff.kind === 'appeared' || diff.kind === 'disappeared');
    case 'target-not-clipped':
      return (
        diff.subject.type === 'target' &&
        diff.subject.target === primitive.target &&
        (diff.kind === 'clipping-changed' || diff.kind === 'horizontal-overflow-changed' || diff.kind === 'vertical-overflow-changed')
      );
    case 'target-width-within-bound':
      return diff.subject.type === 'target' && diff.subject.target === primitive.target && diff.kind === 'resized';
    case 'property-unchanged-within-tolerance':
    case 'property-increases':
    case 'property-decreases': {
      if (diff.subject.type !== 'target' || diff.subject.target !== primitive.target) return false;
      const isPositionProperty = primitive.property === 'x' || primitive.property === 'y';
      return isPositionProperty ? diff.kind === 'moved' : diff.kind === 'resized';
    }
    case 'targets-do-not-overlap':
      return relationshipDiffMatchesPair(diff, AREA_OVERLAP_RELATIONSHIPS, primitive.targetA, primitive.targetB);
    case 'target-wider-than':
      return relationshipDiffMatchesPair(diff, RELATIVE_WIDTH_RELATIONSHIPS, primitive.targetA, primitive.targetB);
    case 'target-follows-vertically':
      return relationshipDiffMatchesPair(diff, VERTICAL_SEQUENCE_RELATIONSHIPS, primitive.targetA, primitive.targetB);
    case 'target-fits-inside':
      return relationshipDiffMatchesPair(diff, GEOMETRIC_FIT_RELATIONSHIPS, primitive.target, primitive.container);
    case 'relationship-unchanged': {
      if (diff.subject.type !== 'relationship') return false;
      if (!sameFamily(diff.subject.kind, primitive.relationshipKind)) return false;
      if (primitive.subjectTarget && diff.subject.subjectTarget !== primitive.subjectTarget) return false;
      if (primitive.relatedTarget && diff.subject.relatedTarget !== primitive.relatedTarget) return false;
      return true;
    }
    case 'document-width-fits-viewport':
      return diff.kind === 'page-size-changed' || (diff.subject.type === 'relationship' && (PAGE_WIDTH_RELATIONSHIPS as readonly string[]).includes(diff.subject.kind));
    case 'scroll-owner-is-document':
    case 'target-does-not-own-scroll':
      return diff.kind === 'scroll-owner-changed';
    case 'target-begins-below-initial-viewport':
      return false;
    default:
      return false;
  }
}

function toUnexpectedChangeResult(diff: ComparisonDifference): UnexpectedChangeResult {
  return { classification: 'unexpected', subject: diff.subject, differenceKind: diff.kind, supportingEvidence: diff.evidence };
}

// --- canonical entry point --------------------------------------------------------

/**
 * The one canonical pure v0.5 contract-evaluation entry point:
 * `active persistent baseline contracts + current per-change contract + actual
 * before/after runtime evidence -> PASS | FAIL` with full clause-level
 * evidence. Deterministic given identical inputs; never mutates
 * before/after/comparison/baseline/change.
 *
 * NOTE: `comparison.differences` already includes one `ComparisonDifference`
 * per `RelationshipChangeRecord` (see `comparisonEngine.ts#relationshipChangesToDifferences`),
 * so unexpected-change derivation consumes `differences` only - iterating
 * `relationshipChanges` separately would double-count the same logical
 * transition.
 */
export function evaluateFrontendContract(input: FrontendContractEvaluationInput): EvaluateFrontendContractResult {
  const { before, after, comparison, baseline, change } = input;

  const beforeValidation = isValidObservationArtifact(before);
  if (!beforeValidation.valid) return { ok: false, reason: `before ObservationArtifact is invalid: ${beforeValidation.reason}` };
  const afterValidation = isValidObservationArtifact(after);
  if (!afterValidation.valid) return { ok: false, reason: `after ObservationArtifact is invalid: ${afterValidation.reason}` };
  const comparisonValidation = isValidComparisonArtifact(comparison);
  if (!comparisonValidation.valid) return { ok: false, reason: `ComparisonArtifact is invalid: ${comparisonValidation.reason}` };
  const baselineValidation = isValidPersistentBaselineContract(baseline);
  if (!baselineValidation.valid) return { ok: false, reason: `PersistentBaselineContract is invalid: ${baselineValidation.reason}` };
  const changeValidation = isValidPerChangeContract(change);
  if (!changeValidation.valid) return { ok: false, reason: `PerChangeContract is invalid: ${changeValidation.reason}` };

  if (comparison.before.observationId !== before.observationId) {
    return { ok: false, reason: 'comparison.before.observationId does not match the supplied before observation' };
  }
  if (comparison.after.observationId !== after.observationId) {
    return { ok: false, reason: 'comparison.after.observationId does not match the supplied after observation' };
  }

  const baselineClauseIds = new Set(baseline.clauses.map((c) => c.clauseId));
  const supersededIds = new Set<string>();
  for (const c of change.clauses) {
    for (const id of c.supersedesBaselineClauseIds ?? []) {
      if (baselineClauseIds.has(id)) supersededIds.add(id);
    }
  }
  const activeBaseline: BaselineClause[] = baseline.clauses.filter((c) => !supersededIds.has(c.clauseId));
  const activeBaselineClauseIds = activeBaseline.map((c) => c.clauseId);

  if (comparison.comparability.state === 'incomparable') {
    const clauseResults: ClauseEvaluationResult[] = [
      ...activeBaseline.map((c) => toClauseResult(c.clauseId, 'unavailable', c.supportingEvidence)),
      ...change.clauses.map((c) => toClauseResult(c.clauseId, 'unavailable', c.supportingEvidence)),
    ].map((r) => (r.status === 'unavailable' ? { ...r, reason: 'comparison is incomparable; frontend contract clauses cannot be evaluated' } : r));
    return {
      ok: true,
      evaluation: { overallVerdict: 'FAIL', activeBaselineClauseIds, supersededBaselineClauseIds: [...supersededIds], clauseResults, unexpectedChanges: [] },
    };
  }

  const ctx: EvalContext = { before, after, comparison };
  const clauseResults: ClauseEvaluationResult[] = [];

  for (const c of activeBaseline) {
    const conflictingChange = change.clauses.find((cc) => !(cc.supersedesBaselineClauseIds ?? []).includes(c.clauseId) && primitivesConflict(c.primitive, cc.primitive));
    if (conflictingChange) {
      const reason = `baseline clause "${c.clauseId}" and per-change clause "${conflictingChange.clauseId}" impose contradictory requirements on the same property without explicit supersession`;
      clauseResults.push({ clauseId: c.clauseId, status: 'conflict', reason, conflictingClauseIds: [c.clauseId, conflictingChange.clauseId], supportingEvidence: c.supportingEvidence });
      continue;
    }
    clauseResults.push(evaluateClause(c.clauseId, c.primitive, 'preserved', ctx, c.supportingEvidence));
  }

  for (const c of change.clauses) {
    const unknownRefs = (c.supersedesBaselineClauseIds ?? []).filter((id) => !baselineClauseIds.has(id));
    if (unknownRefs.length > 0) {
      const reason = `per-change clause "${c.clauseId}" supersedesBaselineClauseIds references unknown baseline clause id(s): ${unknownRefs.join(', ')}`;
      clauseResults.push({ clauseId: c.clauseId, status: 'conflict', reason, conflictingClauseIds: [c.clauseId, ...unknownRefs], supportingEvidence: c.supportingEvidence });
      continue;
    }
    const conflictingBaseline = activeBaseline.find((b) => !(c.supersedesBaselineClauseIds ?? []).includes(b.clauseId) && primitivesConflict(b.primitive, c.primitive));
    if (conflictingBaseline) {
      const reason = `per-change clause "${c.clauseId}" and baseline clause "${conflictingBaseline.clauseId}" impose contradictory requirements on the same property without explicit supersession`;
      clauseResults.push({ clauseId: c.clauseId, status: 'conflict', reason, conflictingClauseIds: [conflictingBaseline.clauseId, c.clauseId], supportingEvidence: c.supportingEvidence });
      continue;
    }
    const mode = clauseMode(c.category, c.expectedDependentMode);
    clauseResults.push(evaluateClause(c.clauseId, c.primitive, mode, ctx, c.supportingEvidence));
  }

  const authoredPrimitives = [...activeBaseline.map((c) => c.primitive), ...change.clauses.map((c) => c.primitive)];
  const unexpectedChanges = comparison.differences.filter((d) => !authoredPrimitives.some((p) => primitiveAccountsForDifference(p, d))).map(toUnexpectedChangeResult);

  const overallVerdict: OverallVerdict = clauseResults.every((r) => r.status === 'pass') && unexpectedChanges.length === 0 ? 'PASS' : 'FAIL';

  return {
    ok: true,
    evaluation: { overallVerdict, activeBaselineClauseIds, supersededBaselineClauseIds: [...supersededIds], clauseResults, unexpectedChanges },
  };
}
