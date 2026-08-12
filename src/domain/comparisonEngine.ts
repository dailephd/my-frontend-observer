/**
 * v0.4 Batch 3 pure before/after comparison engine. Composes the frozen
 * Batch 1 contracts (domain/comparison.ts) and the Batch 2 canonical
 * relationship engine (domain/relationships.ts#deriveLayoutRelationships)
 * into one canonical `compareObservations(before, after, config?)` - the
 * only public comparison entry point. Pure and synchronous: no Chromium, no
 * filesystem, no network, no target re-resolution. The only intentionally
 * nondeterministic value produced is the fresh `comparisonId` (via the
 * existing domain/comparisonIdentity.ts#buildComparisonIdentity); everything
 * else is a deterministic function of `(before, after, config)`.
 */
import type { EvidenceField } from './evidence.js';
import { evidenceValue } from './evidence.js';
import type {
  ObservationArtifact,
  TargetEvidenceRecord,
  TargetGeometry,
  ScrollOwnerInterpretation,
} from './schema.js';
import { isValidObservationArtifact, getProducerInfo } from './schema.js';
import { deriveOverflowEvidence } from './scrollEvidence.js';
import type { OverflowEvidence } from './schema.js';
import type { NamedTarget, ScrollScenario } from '../request/request.js';
import { deriveLayoutRelationships, deriveTargetClipping, isValidGeometryTolerancePx, GEOMETRY_TOLERANCE_DEFAULT_PX } from './relationships.js';
import type {
  LayoutRelationshipGraph,
  PairwiseLayoutRelationship,
  PairwiseRelationshipKind,
  EvidenceReference,
} from './relationships.js';
import {
  COMPARISON_ARTIFACT_KIND,
  COMPARISON_SCHEMA_VERSION,
  COMPARABILITY_REASON_SEVERITY,
  COMPARABILITY_REASON_CODES,
  isValidComparisonConfig,
  isValidComparisonArtifact,
} from './comparison.js';
import type {
  ComparisonConfig,
  ComparabilityResult,
  ComparabilityReason,
  ComparabilityReasonCode,
  ComparabilityState,
  TargetConfigurationChange,
  ComparisonDifference,
  ComparisonDifferenceSubject,
  RelationshipChangeRecord,
  ExpectedDependencyDeclaration,
  ExpectedDependencyEvidence,
  DependencyEvidenceOutcome,
  DependencyDirection,
  ComparisonSourceObservationReference,
  ComparisonArtifact,
  DifferenceKind,
} from './comparison.js';
import { buildComparisonRequestIdentity, buildComparisonIdentity } from './comparisonIdentity.js';
import type { Diagnostic } from './diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from './diagnostics.js';

// --- small local helpers -----------------------------------------------------

/** `evidenceValue` for a field that may itself be absent from a dictionary lookup (e.g. `pageEvidence['someKey']`, an optional `containment` cast) - never fabricates a value for a missing field. */
function fieldValue<T>(field: EvidenceField<T> | undefined): T | undefined {
  return field ? evidenceValue(field) : undefined;
}

function normalizedTargetMap(targets: readonly NamedTarget[]): Map<string, NamedTarget> {
  const map = new Map<string, NamedTarget>();
  for (const target of targets) map.set(target.name.toLowerCase(), target);
  return map;
}

/** One target present in both configurations (matched case-insensitively, per the existing normalizeRequest target-name policy), keeping each side's own exact casing for its own evidence lookups. */
interface CommonTarget {
  canonicalName: string;
  beforeName: string;
  afterName: string;
}

/** Deterministic order: before's configured order, restricted to names also configured after (see domain/comparisonEngine.ts#compareTargetConfiguration for the matching addition/removal ordering). */
function commonTargets(before: ObservationArtifact, after: ObservationArtifact): CommonTarget[] {
  const afterMap = normalizedTargetMap(after.requestConfig.targets);
  const results: CommonTarget[] = [];
  for (const target of before.requestConfig.targets) {
    const afterTarget = afterMap.get(target.name.toLowerCase());
    if (afterTarget) results.push({ canonicalName: target.name, beforeName: target.name, afterName: afterTarget.name });
  }
  return results;
}

/**
 * Configuration-change evidence: `removed`/`locator-changed` in before's
 * configured order, then `added` in after's configured order (Batch 1's
 * frozen ordering guidance) - never a source of appeared/disappeared
 * rendered-state differences by itself.
 */
export function compareTargetConfiguration(before: ObservationArtifact, after: ObservationArtifact): TargetConfigurationChange[] {
  const changes: TargetConfigurationChange[] = [];
  const beforeMap = normalizedTargetMap(before.requestConfig.targets);
  const afterMap = normalizedTargetMap(after.requestConfig.targets);

  for (const target of before.requestConfig.targets) {
    const key = target.name.toLowerCase();
    const afterTarget = afterMap.get(key);
    if (!afterTarget) {
      changes.push({ kind: 'removed', target: target.name });
    } else if (JSON.stringify(target.locators) !== JSON.stringify(afterTarget.locators)) {
      changes.push({ kind: 'locator-changed', target: target.name });
    }
  }
  for (const target of after.requestConfig.targets) {
    if (!beforeMap.has(target.name.toLowerCase())) changes.push({ kind: 'added', target: target.name });
  }
  return changes;
}

function isSameScrollScenario(before: ScrollScenario | undefined, after: ScrollScenario | undefined): boolean {
  if (before === undefined && after === undefined) return true;
  if (before === undefined || after === undefined) return false;
  const a = before.action;
  const b = after.action;
  if (a.kind !== b.kind) return false;
  if (a.deltaX !== b.deltaX || a.deltaY !== b.deltaY) return false;
  if (a.kind === 'target-scroll-by' && b.kind === 'target-scroll-by') {
    return a.target.toLowerCase() === b.target.toLowerCase();
  }
  return true;
}

// --- comparability -----------------------------------------------------------

/**
 * Evaluates comparability before any rendered difference is calculated
 * (Batch 1's frozen `ComparabilityResult`/reason vocabulary). Hard
 * incompatibilities (`blocking`) force `incomparable`; producer/browser
 * version and target-configuration mismatches are `warning`-only; the three
 * state dimensions the observer never models (theme, authenticated-state,
 * application-state) are always recorded as `unassessed` - never silently
 * claimed identical.
 */
export function evaluateComparability(before: ObservationArtifact, after: ObservationArtifact): ComparabilityResult {
  const reasons: ComparabilityReason[] = [];
  const add = (code: ComparabilityReasonCode, message: string): void => {
    reasons.push({ code, severity: COMPARABILITY_REASON_SEVERITY[code], message });
  };

  if (before.artifactKind !== after.artifactKind) {
    add('artifact-kind-mismatch', `before artifactKind "${before.artifactKind}" differs from after artifactKind "${after.artifactKind}"`);
  }
  if (before.schemaVersion !== after.schemaVersion) {
    add('schema-version-mismatch', `before schemaVersion "${before.schemaVersion}" differs from after schemaVersion "${after.schemaVersion}"`);
  }
  if (before.requestConfig.targetUrl !== after.requestConfig.targetUrl) {
    add('page-url-mismatch', `before targetUrl "${before.requestConfig.targetUrl}" differs from after targetUrl "${after.requestConfig.targetUrl}"`);
  }
  if (before.requestConfig.viewport.width !== after.requestConfig.viewport.width || before.requestConfig.viewport.height !== after.requestConfig.viewport.height) {
    add(
      'viewport-mismatch',
      `before viewport ${before.requestConfig.viewport.width}x${before.requestConfig.viewport.height} differs from after viewport ${after.requestConfig.viewport.width}x${after.requestConfig.viewport.height}`,
    );
  }

  const beforeBrowser = evidenceValue(before.browser);
  const afterBrowser = evidenceValue(after.browser);
  if (beforeBrowser && afterBrowser && beforeBrowser.engine !== afterBrowser.engine) {
    add('browser-engine-mismatch', `before browser engine "${beforeBrowser.engine}" differs from after browser engine "${afterBrowser.engine}"`);
  }
  if (beforeBrowser && afterBrowser && beforeBrowser.version !== afterBrowser.version) {
    add('browser-version-mismatch', `before browser version "${beforeBrowser.version}" differs from after browser version "${afterBrowser.version}"`);
  }

  if (!isSameScrollScenario(before.requestConfig.scrollScenario, after.requestConfig.scrollScenario)) {
    add('scroll-scenario-mismatch', 'before and after requestConfig.scrollScenario are not the same semantic scroll scenario');
  }

  if (before.producer.version !== after.producer.version) {
    add('producer-version-mismatch', `before producer version "${before.producer.version}" differs from after producer version "${after.producer.version}"`);
  }

  const configurationChanges = compareTargetConfiguration(before, after);
  if (configurationChanges.some((change) => change.kind === 'added' || change.kind === 'removed')) {
    add('target-set-mismatch', 'configured target sets differ between before and after');
  }
  if (configurationChanges.some((change) => change.kind === 'locator-changed')) {
    add('target-locator-mismatch', 'a stable target name has a changed locator configuration between before and after');
  }

  add('theme-unassessed', 'theme identity is not modeled by the observer');
  add('authenticated-state-unassessed', 'authenticated-state identity is not modeled by the observer');
  add('application-state-unassessed', 'application-state identity is not modeled by the observer');

  reasons.sort((a, b) => COMPARABILITY_REASON_CODES.indexOf(a.code) - COMPARABILITY_REASON_CODES.indexOf(b.code));

  const hasBlocking = reasons.some((reason) => reason.severity === 'blocking');
  const hasWarning = reasons.some((reason) => reason.severity === 'warning');
  const state: ComparabilityState = hasBlocking ? 'incomparable' : hasWarning ? 'comparable-with-warnings' : 'comparable';

  return { state, reasons };
}

// --- direct target/page differences ------------------------------------------

type TargetPresence = 'matched' | 'not-found' | 'ambiguous' | 'unavailable';

function targetPresence(record: TargetEvidenceRecord | undefined): TargetPresence {
  if (!record) return 'unavailable';
  const resolution = evidenceValue(record.resolution);
  if (!resolution) return 'unavailable';
  if (resolution.selectionStatus === 'matched') return 'matched';
  if (resolution.selectionStatus === 'not-found') return 'not-found';
  if (resolution.selectionStatus === 'ambiguous') return 'ambiguous';
  return 'unavailable';
}

function geometryEvidenceRef(name: string): EvidenceReference[] {
  return [{ path: `targetEvidence.${name}.geometry` }];
}

function targetOverflow(record: TargetEvidenceRecord): OverflowEvidence | undefined {
  const layout = evidenceValue(record.layout);
  const style = evidenceValue(record.style);
  if (!layout || !style) return undefined;
  return deriveOverflowEvidence(layout, style.overflowX, style.overflowY);
}

/**
 * Direct per-target rendered differences (moved/resized/visibility/clipping/
 * actual-overflow) plus appeared/disappeared, for one common (same stable
 * name both sides) target. `diagnostics` records an honest inability to
 * assess rendered state (ambiguous/unavailable on either side) rather than
 * fabricating absence - see Batch 1's frozen "ambiguous/unavailable is not
 * definitely absent" rule.
 */
function compareOneTarget(
  before: ObservationArtifact,
  after: ObservationArtifact,
  target: CommonTarget,
  tolerance: number,
  diagnostics: Diagnostic[],
): ComparisonDifference[] {
  const differences: ComparisonDifference[] = [];
  const beforeRecord = before.targetEvidence[target.beforeName];
  const afterRecord = after.targetEvidence[target.afterName];
  const beforeStatus = targetPresence(beforeRecord);
  const afterStatus = targetPresence(afterRecord);
  const subject: ComparisonDifferenceSubject = { type: 'target', target: target.canonicalName };

  if (beforeStatus === 'not-found' && afterStatus === 'matched') {
    differences.push({
      kind: 'appeared',
      subject,
      before: 'not-found',
      after: 'matched',
      classification: 'presence',
      beforeObservationId: before.observationId,
      afterObservationId: after.observationId,
      evidence: geometryEvidenceRef(target.afterName),
    });
    return differences;
  }

  if (beforeStatus === 'matched' && afterStatus === 'not-found') {
    differences.push({
      kind: 'disappeared',
      subject,
      before: 'matched',
      after: 'not-found',
      classification: 'presence',
      beforeObservationId: before.observationId,
      afterObservationId: after.observationId,
      evidence: geometryEvidenceRef(target.beforeName),
    });
    return differences;
  }

  if (beforeStatus === 'not-found' && afterStatus === 'not-found') {
    return differences;
  }

  if (beforeStatus !== 'matched' || afterStatus !== 'matched') {
    const code = beforeStatus === 'ambiguous' || afterStatus === 'ambiguous' ? 'target-ambiguous' : 'browser-evidence-unavailable';
    diagnostics.push({
      code,
      severity: DIAGNOSTIC_SEVERITY[code],
      message: `target "${target.canonicalName}" rendered-state comparison unavailable (before: ${beforeStatus}, after: ${afterStatus})`,
      targetName: target.canonicalName,
    });
    return differences;
  }

  // Both sides matched: compare rendered state directly.
  const beforeGeometry = beforeRecord ? evidenceValue(beforeRecord.geometry) : undefined;
  const afterGeometry = afterRecord ? evidenceValue(afterRecord.geometry) : undefined;
  if (beforeGeometry && afterGeometry) {
    const dx = afterGeometry.x - beforeGeometry.x;
    const dy = afterGeometry.y - beforeGeometry.y;
    if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
      differences.push({
        kind: 'moved',
        subject,
        before: { x: beforeGeometry.x, y: beforeGeometry.y },
        after: { x: afterGeometry.x, y: afterGeometry.y },
        delta: { x: dx, y: dy },
        classification: 'position',
        beforeObservationId: before.observationId,
        afterObservationId: after.observationId,
        evidence: [...geometryEvidenceRef(target.beforeName), ...geometryEvidenceRef(target.afterName)],
      });
    }
    const dw = afterGeometry.width - beforeGeometry.width;
    const dh = afterGeometry.height - beforeGeometry.height;
    if (Math.abs(dw) > tolerance || Math.abs(dh) > tolerance) {
      differences.push({
        kind: 'resized',
        subject,
        before: { width: beforeGeometry.width, height: beforeGeometry.height },
        after: { width: afterGeometry.width, height: afterGeometry.height },
        delta: { width: dw, height: dh },
        classification: 'size',
        beforeObservationId: before.observationId,
        afterObservationId: after.observationId,
        evidence: [...geometryEvidenceRef(target.beforeName), ...geometryEvidenceRef(target.afterName)],
      });
    }
  }

  const beforeVisible = beforeRecord ? evidenceValue(beforeRecord.visibility)?.visible : undefined;
  const afterVisible = afterRecord ? evidenceValue(afterRecord.visibility)?.visible : undefined;
  if (beforeVisible !== undefined && afterVisible !== undefined && beforeVisible !== afterVisible) {
    differences.push({
      kind: 'visibility-changed',
      subject,
      before: beforeVisible,
      after: afterVisible,
      classification: 'visibility',
      beforeObservationId: before.observationId,
      afterObservationId: after.observationId,
      evidence: [{ path: `targetEvidence.${target.beforeName}.visibility` }, { path: `targetEvidence.${target.afterName}.visibility` }],
    });
  }

  if (beforeRecord && afterRecord) {
    const beforeClip = deriveTargetClipping(beforeRecord);
    const afterClip = deriveTargetClipping(afterRecord);
    const clipEvidence = [{ path: `targetEvidence.${target.beforeName}.layout` }, { path: `targetEvidence.${target.afterName}.layout` }];
    if (beforeClip.horizontal !== 'unavailable' && afterClip.horizontal !== 'unavailable' && beforeClip.horizontal !== afterClip.horizontal) {
      differences.push({
        kind: 'clipping-changed',
        subject,
        before: beforeClip.horizontal,
        after: afterClip.horizontal,
        classification: 'horizontal',
        beforeObservationId: before.observationId,
        afterObservationId: after.observationId,
        evidence: clipEvidence,
      });
    }
    if (beforeClip.vertical !== 'unavailable' && afterClip.vertical !== 'unavailable' && beforeClip.vertical !== afterClip.vertical) {
      differences.push({
        kind: 'clipping-changed',
        subject,
        before: beforeClip.vertical,
        after: afterClip.vertical,
        classification: 'vertical',
        beforeObservationId: before.observationId,
        afterObservationId: after.observationId,
        evidence: clipEvidence,
      });
    }

    const beforeOverflow = targetOverflow(beforeRecord);
    const afterOverflow = targetOverflow(afterRecord);
    if (beforeOverflow && afterOverflow) {
      if (beforeOverflow.horizontalOverflow !== afterOverflow.horizontalOverflow) {
        differences.push({
          kind: 'horizontal-overflow-changed',
          subject,
          before: beforeOverflow.horizontalOverflow,
          after: afterOverflow.horizontalOverflow,
          classification: 'horizontal',
          beforeObservationId: before.observationId,
          afterObservationId: after.observationId,
          evidence: clipEvidence,
        });
      }
      if (beforeOverflow.verticalOverflow !== afterOverflow.verticalOverflow) {
        differences.push({
          kind: 'vertical-overflow-changed',
          subject,
          before: beforeOverflow.verticalOverflow,
          after: afterOverflow.verticalOverflow,
          classification: 'vertical',
          beforeObservationId: before.observationId,
          afterObservationId: after.observationId,
          evidence: clipEvidence,
        });
      }
    }
  }

  return differences;
}

/** Pairwise DOM-containment comparison among matched-both-sides common targets - reuses existing `TargetContainment` evidence directly, never re-derived from geometry (Batch 2's frozen distinction). Only evaluated when the specific pair was actually evaluated on both sides. */
function compareContainment(before: ObservationArtifact, after: ObservationArtifact, matched: CommonTarget[]): ComparisonDifference[] {
  const differences: ComparisonDifference[] = [];
  for (let i = 0; i < matched.length; i += 1) {
    for (let j = 0; j < matched.length; j += 1) {
      if (i === j) continue;
      const subjectTarget = matched[i] as CommonTarget;
      const otherTarget = matched[j] as CommonTarget;
      const beforeContainment = fieldValue(before.targetEvidence[subjectTarget.beforeName]?.containment);
      const afterContainment = fieldValue(after.targetEvidence[subjectTarget.afterName]?.containment);
      if (!beforeContainment || !afterContainment) continue;
      const beforeEvaluated = beforeContainment.evaluatedTargetIds.includes(otherTarget.beforeName);
      const afterEvaluated = afterContainment.evaluatedTargetIds.includes(otherTarget.afterName);
      if (!beforeEvaluated || !afterEvaluated) continue;
      const beforeContained = beforeContainment.containedByTargetIds.includes(otherTarget.beforeName);
      const afterContained = afterContainment.containedByTargetIds.includes(otherTarget.afterName);
      if (beforeContained === afterContained) continue;
      differences.push({
        kind: 'containment-changed',
        subject: { type: 'target', target: subjectTarget.canonicalName },
        before: beforeContained,
        after: afterContained,
        classification: `contained-by:${otherTarget.canonicalName}`,
        beforeObservationId: before.observationId,
        afterObservationId: after.observationId,
        evidence: [
          { path: `targetEvidence.${subjectTarget.beforeName}.containment` },
          { path: `targetEvidence.${subjectTarget.afterName}.containment` },
        ],
      });
    }
  }
  return differences;
}

function comparePageSize(before: ObservationArtifact, after: ObservationArtifact, tolerance: number): ComparisonDifference[] {
  const beforeWidth = fieldValue(before.pageEvidence.documentWidth) as number | undefined;
  const afterWidth = fieldValue(after.pageEvidence.documentWidth) as number | undefined;
  const beforeHeight = fieldValue(before.pageEvidence.documentHeight) as number | undefined;
  const afterHeight = fieldValue(after.pageEvidence.documentHeight) as number | undefined;
  if (typeof beforeWidth !== 'number' || typeof afterWidth !== 'number' || typeof beforeHeight !== 'number' || typeof afterHeight !== 'number') {
    return [];
  }
  const dw = afterWidth - beforeWidth;
  const dh = afterHeight - beforeHeight;
  if (Math.abs(dw) <= tolerance && Math.abs(dh) <= tolerance) return [];
  return [
    {
      kind: 'page-size-changed',
      subject: { type: 'page' },
      before: { width: beforeWidth, height: beforeHeight },
      after: { width: afterWidth, height: afterHeight },
      delta: { width: dw, height: dh },
      classification: 'document-size',
      beforeObservationId: before.observationId,
      afterObservationId: after.observationId,
      evidence: [{ path: 'pageEvidence.documentWidth' }, { path: 'pageEvidence.documentHeight' }],
    },
  ];
}

function scrollOwnerEqual(a: ScrollOwnerInterpretation, b: ScrollOwnerInterpretation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'target' && b.kind === 'target') return a.target === b.target;
  return true;
}

/** Only meaningful when both sides have actually-derived scroll-owner evidence (comparability already ensures the scenario *configuration* matches; this compares the *runtime result*). Never fabricated when either side's evidence is unavailable. */
function compareScrollOwner(before: ObservationArtifact, after: ObservationArtifact): ComparisonDifference[] {
  const beforeOwner = before.scrollScenarioEvidence ? evidenceValue(before.scrollScenarioEvidence.scrollOwner) : undefined;
  const afterOwner = after.scrollScenarioEvidence ? evidenceValue(after.scrollScenarioEvidence.scrollOwner) : undefined;
  if (!beforeOwner || !afterOwner || scrollOwnerEqual(beforeOwner, afterOwner)) return [];
  return [
    {
      kind: 'scroll-owner-changed',
      subject: { type: 'page' },
      before: beforeOwner,
      after: afterOwner,
      classification: 'scroll-owner',
      beforeObservationId: before.observationId,
      afterObservationId: after.observationId,
      evidence: [{ path: 'scrollScenarioEvidence.scrollOwner' }],
    },
  ];
}

// --- relationship-change derivation -------------------------------------------

const RELATIVE_POSITION_KINDS: readonly PairwiseRelationshipKind[] = [
  'left-of',
  'right-of',
  'horizontally-overlapping',
  'above',
  'below',
  'vertically-overlapping',
  'overlaps',
  'does-not-overlap',
];

function isRelativePositionFamily(kind: PairwiseRelationshipKind): boolean {
  return RELATIVE_POSITION_KINDS.includes(kind);
}

/**
 * A pair carries up to one record *per family* (see
 * `deriveLayoutRelationships`), so looking up "the" record for
 * (subjectTarget, relatedTarget) is ambiguous without also naming the
 * family - matching by subject/related alone would silently return
 * whichever family's record happens to appear first in the array.
 */
function findPairwiseInFamily(
  graph: LayoutRelationshipGraph,
  subjectTarget: string,
  relatedTarget: string,
  family: readonly PairwiseRelationshipKind[],
): PairwiseLayoutRelationship | undefined {
  return graph.pairwiseRelationships.find((r) => r.subjectTarget === subjectTarget && r.relatedTarget === relatedTarget && family.includes(r.kind));
}

const RELATIONSHIP_FAMILY_GROUPS: readonly (readonly PairwiseRelationshipKind[])[] = [
  ['left-of', 'right-of', 'horizontally-overlapping'],
  ['above', 'below', 'vertically-overlapping'],
  ['overlaps', 'does-not-overlap'],
  ['wider-than', 'narrower-than', 'equal-width-within-tolerance'],
  ['fits-inside', 'does-not-fit-inside'],
  ['follows-vertically'],
];

/**
 * Matches relationship records by structural identity (family + subject +
 * related target), never by array position. Direction is taken from
 * `before`'s own configured order for each pair; if `after`'s graph placed
 * the same pair in the reversed direction (or the pair became unresolved),
 * the `after` side of the family is honestly reported `'unavailable'`
 * (the frozen escape hatch) rather than guessed/inverted - relationship
 * direction inversion under target-order changes is a known, documented
 * scope limitation, not a fabricated result.
 */
function deriveRelationshipChanges(
  relationshipsBefore: LayoutRelationshipGraph,
  relationshipsAfter: LayoutRelationshipGraph,
  matched: CommonTarget[],
): RelationshipChangeRecord[] {
  const changes: RelationshipChangeRecord[] = [];

  for (let i = 0; i < matched.length; i += 1) {
    for (let j = i + 1; j < matched.length; j += 1) {
      const x = matched[i] as CommonTarget;
      const y = matched[j] as CommonTarget;
      for (const family of RELATIONSHIP_FAMILY_GROUPS) {
        const beforeKind = findPairwiseInFamily(relationshipsBefore, x.beforeName, y.beforeName, family)?.kind;
        const afterKind = findPairwiseInFamily(relationshipsAfter, x.afterName, y.afterName, family)?.kind;
        if (beforeKind === afterKind) continue;
        if (beforeKind === undefined && afterKind === undefined) continue;
        changes.push({
          scope: 'pairwise',
          kind: (beforeKind ?? afterKind) as PairwiseRelationshipKind,
          subjectTarget: x.canonicalName,
          relatedTarget: y.canonicalName,
          before: beforeKind ?? 'unavailable',
          after: afterKind ?? 'unavailable',
          beforeObservationId: relationshipsBefore.observationId,
          afterObservationId: relationshipsAfter.observationId,
        });
      }
    }
  }

  const beforePage = relationshipsBefore.pageRelationships[0];
  const afterPage = relationshipsAfter.pageRelationships[0];
  if (beforePage || afterPage) {
    if (beforePage?.kind !== afterPage?.kind) {
      changes.push({
        scope: 'page',
        kind: (beforePage?.kind ?? afterPage?.kind) as RelationshipChangeRecord['kind'],
        before: beforePage?.kind ?? 'unavailable',
        after: afterPage?.kind ?? 'unavailable',
        beforeObservationId: relationshipsBefore.observationId,
        afterObservationId: relationshipsAfter.observationId,
      });
    }
  }

  return changes;
}

/**
 * One user-facing `ComparisonDifference` per relationship change -
 * `relative-position-changed` for the horizontal-order/vertical-order/
 * area-overlap families, `relationship-changed` for the rest (Batch 1's
 * frozen distinction between absolute target movement and a relative
 * relationship transition). Evidence is built directly from the change's own
 * target/page identity - every family's supporting evidence for a given
 * pair is the same two geometry references (see
 * `deriveLayoutRelationships#geometryEvidence`), so no graph lookup (and no
 * risk of picking a different family's record) is needed here.
 */
function relationshipChangesToDifferences(
  changes: readonly RelationshipChangeRecord[],
  beforeObservationId: string,
  afterObservationId: string,
): ComparisonDifference[] {
  return changes.map((change): ComparisonDifference => {
    const kind: DifferenceKind =
      change.scope === 'pairwise' && isRelativePositionFamily(change.kind as PairwiseRelationshipKind) ? 'relative-position-changed' : 'relationship-changed';
    const subject: ComparisonDifferenceSubject =
      change.scope === 'page' || !change.subjectTarget || !change.relatedTarget
        ? { type: 'relationship', kind: change.kind }
        : { type: 'relationship', kind: change.kind, subjectTarget: change.subjectTarget, relatedTarget: change.relatedTarget };
    const evidence: EvidenceReference[] =
      change.scope === 'pairwise' && change.subjectTarget && change.relatedTarget
        ? [{ path: `targetEvidence.${change.subjectTarget}.geometry` }, { path: `targetEvidence.${change.relatedTarget}.geometry` }]
        : [{ path: 'pageEvidence.documentWidth' }, { path: 'pageEvidence.viewportWidth' }];
    return {
      kind,
      subject,
      before: change.before,
      after: change.after,
      classification: change.scope,
      beforeObservationId,
      afterObservationId,
      evidence,
    };
  });
}

// --- explicit dependency evaluation -------------------------------------------

function extractTargetProperty(observation: ObservationArtifact, targetName: string, property: 'x' | 'y' | 'width' | 'height'): number | undefined {
  const record = observation.targetEvidence[targetName];
  if (!record) return undefined;
  const geometry = evidenceValue(record.geometry) as TargetGeometry | undefined;
  return geometry ? geometry[property] : undefined;
}

interface TermEvaluation {
  matches: boolean;
  contradicts: boolean;
}

function evaluateTerm(before: number, after: number, direction: DependencyDirection, tolerance: number): TermEvaluation {
  const delta = after - before;
  switch (direction) {
    case 'increase':
      return { matches: delta > tolerance, contradicts: delta < -tolerance };
    case 'decrease':
      return { matches: delta < -tolerance, contradicts: delta > tolerance };
    case 'change':
      return { matches: Math.abs(delta) > tolerance, contradicts: Math.abs(delta) <= tolerance };
    case 'unchanged':
      return { matches: Math.abs(delta) <= tolerance, contradicts: Math.abs(delta) > tolerance };
  }
}

/**
 * Evaluates only explicitly-declared dependencies (`config.expectedDependencies`,
 * in declared order) - never synthesizes a declaration from observed
 * co-change (Batch 1's hard non-causal boundary). Each declared side is
 * evaluated independently from the target's own before/after geometry;
 * `unavailable` when either side's required property evidence cannot be
 * read, `contradictory-to-declaration` when either side's actual direction
 * is the strict opposite of what was declared, `consistent` when both sides
 * match their declared direction, `not-observed` otherwise. No causal claim
 * is ever produced.
 */
export function evaluateExpectedDependencies(
  before: ObservationArtifact,
  after: ObservationArtifact,
  declarations: readonly ExpectedDependencyDeclaration[],
  tolerance: number,
): ExpectedDependencyEvidence[] {
  return declarations.map((declaration): ExpectedDependencyEvidence => {
    const causeBefore = extractTargetProperty(before, declaration.cause.target, declaration.cause.property);
    const causeAfter = extractTargetProperty(after, declaration.cause.target, declaration.cause.property);
    const effectBefore = extractTargetProperty(before, declaration.effect.target, declaration.effect.property);
    const effectAfter = extractTargetProperty(after, declaration.effect.target, declaration.effect.property);

    const supportingEvidence: EvidenceReference[] = [
      { path: `targetEvidence.${declaration.cause.target}.geometry` },
      { path: `targetEvidence.${declaration.effect.target}.geometry` },
    ];

    if (causeBefore === undefined || causeAfter === undefined || effectBefore === undefined || effectAfter === undefined) {
      return { declaration, outcome: 'unavailable', supportingEvidence };
    }

    const causeEval = evaluateTerm(causeBefore, causeAfter, declaration.cause.direction, tolerance);
    const effectEval = evaluateTerm(effectBefore, effectAfter, declaration.effect.direction, tolerance);

    let outcome: DependencyEvidenceOutcome;
    if (causeEval.contradicts || effectEval.contradicts) {
      outcome = 'contradictory-to-declaration';
    } else if (causeEval.matches && effectEval.matches) {
      outcome = 'consistent';
    } else {
      outcome = 'not-observed';
    }

    return { declaration, outcome, supportingEvidence };
  });
}

// --- comparison identity / source references ----------------------------------

function sourceReference(observation: ObservationArtifact): ComparisonSourceObservationReference | undefined {
  const screenshot = evidenceValue(observation.screenshot);
  if (!screenshot) return undefined;
  return {
    observationId: observation.observationId,
    requestId: observation.requestId,
    producer: observation.producer,
    observationSchemaVersion: observation.schemaVersion,
    screenshot: { path: screenshot.path },
  };
}

function normalizeConfig(config: Partial<ComparisonConfig>): ComparisonConfig {
  return {
    geometryTolerancePx: config.geometryTolerancePx ?? GEOMETRY_TOLERANCE_DEFAULT_PX,
    ...(config.expectedDependencies !== undefined ? { expectedDependencies: config.expectedDependencies } : {}),
  };
}

export type CompareObservationsResult = { ok: true; artifact: ComparisonArtifact } | { ok: false; reason: string };

/**
 * The one canonical pure comparison entry point (real Chromium ->
 * ObservationArtifact -> relationship derivation -> **comparability ->
 * comparison** -> ComparisonArtifact, see docs/ARCHITECTURE.md). Comparison
 * is ordered: `compareObservations(a, b)` and `compareObservations(b, a)`
 * produce different `comparisonRequestId`s and reversed-sign
 * moved/resized deltas - `before`/`after` are never treated as an
 * unordered pair.
 */
export function compareObservations(before: ObservationArtifact, after: ObservationArtifact, configInput: Partial<ComparisonConfig> = {}): CompareObservationsResult {
  const beforeValidation = isValidObservationArtifact(before);
  if (!beforeValidation.valid) return { ok: false, reason: `before ObservationArtifact is invalid: ${beforeValidation.reason}` };
  const afterValidation = isValidObservationArtifact(after);
  if (!afterValidation.valid) return { ok: false, reason: `after ObservationArtifact is invalid: ${afterValidation.reason}` };

  const config = normalizeConfig(configInput);
  if (!isValidComparisonConfig(config)) return { ok: false, reason: 'ComparisonConfig is invalid' };
  if (!isValidGeometryTolerancePx(config.geometryTolerancePx)) return { ok: false, reason: 'ComparisonConfig.geometryTolerancePx is out of range' };

  const beforeRef = sourceReference(before);
  const afterRef = sourceReference(after);
  if (!beforeRef) return { ok: false, reason: 'before ObservationArtifact has no available screenshot evidence; cannot build a comparison source reference' };
  if (!afterRef) return { ok: false, reason: 'after ObservationArtifact has no available screenshot evidence; cannot build a comparison source reference' };

  const tolerance = config.geometryTolerancePx;

  const beforeRelResult = deriveLayoutRelationships(before, { geometryTolerancePx: tolerance });
  if (!beforeRelResult.ok) return { ok: false, reason: `relationship derivation failed for the before observation: ${beforeRelResult.reason}` };
  const afterRelResult = deriveLayoutRelationships(after, { geometryTolerancePx: tolerance });
  if (!afterRelResult.ok) return { ok: false, reason: `relationship derivation failed for the after observation: ${afterRelResult.reason}` };
  const relationshipsBefore = beforeRelResult.graph;
  const relationshipsAfter = afterRelResult.graph;

  const comparability = evaluateComparability(before, after);
  const configurationChanges = compareTargetConfiguration(before, after);

  const comparisonRequestId = buildComparisonRequestIdentity(before.observationId, after.observationId, config);
  const comparisonId = buildComparisonIdentity(comparisonRequestId);

  const shared = {
    artifactKind: COMPARISON_ARTIFACT_KIND,
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    comparisonId,
    comparisonRequestId,
    producer: getProducerInfo(),
    provenance: { comparedAt: new Date().toISOString() },
    before: beforeRef,
    after: afterRef,
    config,
    comparability,
    configurationChanges,
    relationshipsBefore,
    relationshipsAfter,
    limits: { truncated: false, omittedFields: [] as string[], omittedTargetPairs: [] as string[] },
  };

  if (comparability.state === 'incomparable') {
    const artifact: ComparisonArtifact = {
      ...shared,
      differences: [],
      relationshipChanges: [],
      expectedDependencyEvidence: [],
      diagnostics: [],
    };
    const validation = isValidComparisonArtifact(artifact);
    if (!validation.valid) return { ok: false, reason: `assembled incomparable ComparisonArtifact failed structural validation: ${validation.reason}` };
    return { ok: true, artifact };
  }

  const diagnostics: Diagnostic[] = [];
  const common = commonTargets(before, after);
  const differences: ComparisonDifference[] = [];
  for (const target of common) {
    differences.push(...compareOneTarget(before, after, target, tolerance, diagnostics));
  }

  const matched = common.filter((target) => targetPresence(before.targetEvidence[target.beforeName]) === 'matched' && targetPresence(after.targetEvidence[target.afterName]) === 'matched');
  differences.push(...compareContainment(before, after, matched));
  differences.push(...comparePageSize(before, after, tolerance));
  differences.push(...compareScrollOwner(before, after));

  const relationshipChanges = deriveRelationshipChanges(relationshipsBefore, relationshipsAfter, matched);
  differences.push(...relationshipChangesToDifferences(relationshipChanges, before.observationId, after.observationId));

  const expectedDependencyEvidence = evaluateExpectedDependencies(before, after, config.expectedDependencies ?? [], tolerance);

  const artifact: ComparisonArtifact = {
    ...shared,
    differences,
    relationshipChanges,
    expectedDependencyEvidence,
    diagnostics,
  };

  const validation = isValidComparisonArtifact(artifact);
  if (!validation.valid) return { ok: false, reason: `assembled ComparisonArtifact failed structural validation: ${validation.reason}` };
  return { ok: true, artifact };
}
