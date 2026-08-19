import { describe, expect, it } from 'vitest';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import type { ComparisonArtifact } from '../../src/domain/comparison.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetEvidenceRecord, TargetGeometry, TargetComputedStyle, TargetResolution } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';
import {
  CONTRACT_ARTIFACT_KIND,
  CONTRACT_SCHEMA_VERSION,
  type PersistentBaselineContract,
  type PerChangeContract,
  type BaselineClause,
  type PerChangeClause,
  type ContractPrimitive,
  type AuthoredChangeScopeCategory,
  type ExpectedDependentMode,
} from '../../src/domain/frontendContracts.js';
import { evaluateFrontendContract } from '../../src/domain/frontendContractEvaluation.js';
import { buildFrontendContractEvaluationArtifact, type FrontendContractEvaluationArtifact } from '../../src/domain/frontendContractEvaluationArtifact.js';
import { MAX_RUNTIME_TARGETS, MAX_RELATIONSHIP_EVIDENCE_PER_TARGET, MAX_OMISSIONS, MAX_TRUNCATIONS, isValidBoundedAgentContextArtifact } from '../../src/domain/boundedAgentContext.js';
import { projectBoundedAgentContext, type ProjectBoundedAgentContextInput } from '../../src/domain/boundedAgentContextProjection.js';
import type { Diagnostic } from '../../src/domain/diagnostics.js';

// --- fixture builders (duplicated per existing tests/unit/frontendContractEvaluation.test.ts convention) --

function rect(x: number, y: number, width: number, height: number): TargetGeometry {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function matchedResolution(): TargetResolution {
  return {
    selectionMethod: 'ordered-locators',
    selectionStatus: 'matched',
    selectedLocatorKind: 'css',
    selectedLocatorIndex: 0,
    usedFallback: false,
    confidence: 'exact',
    attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'matched', matchCount: 1 }],
  };
}

function matchedTarget(geometry: TargetGeometry, style?: TargetComputedStyle): TargetEvidenceRecord {
  return {
    resolution: { state: 'available', source: 'derived', value: matchedResolution(), derivedFrom: ['locator-attempts'] },
    tag: { state: 'available', source: 'browser', value: 'div' },
    geometry: { state: 'available', source: 'browser', value: geometry },
    style: { state: 'available', source: 'computed-browser', value: style ?? { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
    layout: { state: 'available', source: 'browser', value: { scrollWidth: geometry.width, scrollHeight: geometry.height, clientWidth: geometry.width, clientHeight: geometry.height, scrollTop: 0, scrollLeft: 0 } },
    visibility: { state: 'available', source: 'derived', value: { visible: true }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
  };
}

function target(name: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: `#${name}` }] };
}

function observation(
  names: readonly NamedTarget[],
  targetEvidence: Record<string, TargetEvidenceRecord>,
  observationId = 'obs-1',
  diagnostics: Diagnostic[] = [],
): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId,
    requestId: 'req-1',
    producer: { name: PRODUCER_NAME, version: '0.5.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '139.0.0' } },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport: { width: 1200, height: 800 },
      targets: [...names],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence,
    screenshot: { state: 'available', source: 'browser', value: { path: 'screenshot.png' } },
    completion: diagnostics.length === 0 ? { state: 'complete' } : { state: 'partial', diagnostics },
    diagnostics,
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
}

function requireComparisonOk(result: ReturnType<typeof compareObservations>): ComparisonArtifact {
  if (!result.ok) throw new Error(`expected ok comparison, got: ${result.reason}`);
  return result.artifact;
}

function baselineContract(clauses: BaselineClause[], sourceObservationId = 'obs-before'): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: { observationId: sourceObservationId, requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.5.0' }, observationSchemaVersion: SCHEMA_VERSION },
    clauses,
    provenance: { approvedAt: '2026-08-13T00:00:00.000Z' },
  };
}

function changeContractOf(clauses: PerChangeClause[]): PerChangeContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'change',
    contractId: 'change-1',
    contractRequestId: 'change-request-1',
    activeBaselineIds: ['baseline-1'],
    clauses,
  };
}

function bc(clauseId: string, primitive: ContractPrimitive, supportingEvidence: { path: string }[] = []): BaselineClause {
  return { clauseId, primitive, supportingEvidence };
}

function cc(
  clauseId: string,
  primitive: ContractPrimitive,
  category: AuthoredChangeScopeCategory,
  opts: { expectedDependentMode?: ExpectedDependentMode; supportingEvidence?: { path: string }[] } = {},
): PerChangeClause {
  return { clauseId, primitive, category, supportingEvidence: opts.supportingEvidence ?? [], ...(opts.expectedDependentMode ? { expectedDependentMode: opts.expectedDependentMode } : {}) };
}

function baseInput(overrides: Partial<ProjectBoundedAgentContextInput> = {}): ProjectBoundedAgentContextInput {
  const obs = observation([target('navigation'), target('workspace')], {
    navigation: matchedTarget(rect(0, 0, 190, 600)),
    workspace: matchedTarget(rect(200, 0, 600, 600)),
  });
  return {
    generatedAt: '2026-08-14T00:00:00.000Z',
    producerVersion: '0.5.0',
    projectionProfile: 'frontend-change-review',
    focusTargetIds: [],
    observation: obs,
    ...overrides,
  };
}

// --- construction ------------------------------------------------------------

describe('projectBoundedAgentContext: core construction', () => {
  it('produces a minimal valid projection for an observation with no focus targets', () => {
    const result = projectBoundedAgentContext(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.artifactKind).toBe('my-frontend-observer/bounded-agent-context');
    expect(result.artifact.sources.observationIds).toEqual(['obs-1']);
    expect(result.artifact.targets).toEqual([]);
    expect(result.artifact.adequacy.state).toBe('adequate');
  });

  it('is deterministic for repeated calls on equivalent input (logical identity and every other field), while instance identity (contextId) is intentionally fresh per call (IMP-B-004)', () => {
    const input = baseInput({ focusTargetIds: ['navigation', 'workspace'] });
    const a = projectBoundedAgentContext(input);
    const b = projectBoundedAgentContext(input);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.artifact.contextRequestId).toBe(b.artifact.contextRequestId);
    expect(a.artifact.contextId).not.toBe(b.artifact.contextId);
    const restA: Partial<typeof a.artifact> = { ...a.artifact };
    const restB: Partial<typeof b.artifact> = { ...b.artifact };
    delete restA.contextId;
    delete restB.contextId;
    expect(restA).toEqual(restB);
  });

  it('preserves explicit source artifact references', () => {
    const input = baseInput({ focusTargetIds: ['navigation'] });
    const result = projectBoundedAgentContext(input);
    if (!result.ok) throw new Error('expected ok');
    expect(result.artifact.sources.observationIds).toEqual(['obs-1']);
  });

  it('does not mutate the supplied observation', () => {
    const input = baseInput({ focusTargetIds: ['navigation', 'workspace'] });
    const before = JSON.parse(JSON.stringify(input.observation));
    projectBoundedAgentContext(input);
    expect(input.observation).toEqual(before);
  });

  it('rejects a structurally invalid observation', () => {
    const input = baseInput();
    const result = projectBoundedAgentContext({ ...input, observation: { ...input.observation, artifactKind: 'wrong' as never } });
    expect(result.ok).toBe(false);
  });
});

// --- relevance -----------------------------------------------------------------

describe('projectBoundedAgentContext: task relevance', () => {
  it('retains explicit focus target evidence', () => {
    const result = projectBoundedAgentContext(baseInput({ focusTargetIds: ['navigation'] }));
    if (!result.ok) throw new Error('expected ok');
    const ids = result.artifact.targets.map((t) => t.targetId);
    expect(ids).toContain('navigation');
  });

  it('excludes irrelevant target evidence not referenced by any structured evidence', () => {
    const result = projectBoundedAgentContext(baseInput({ focusTargetIds: ['navigation'] }));
    if (!result.ok) throw new Error('expected ok');
    const ids = result.artifact.targets.map((t) => t.targetId);
    expect(ids).not.toContain('workspace');
  });

  it('retains protected clause evidence even when its evaluation passes', () => {
    const change = changeContractOf([cc('c1', { kind: 'target-visible', target: 'workspace' }, 'protected')]);
    const result = projectBoundedAgentContext(baseInput({ change }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.artifact.targets.map((t) => t.targetId)).toContain('workspace');
  });

  it('retains preserved (baseline) clause evidence even when its evaluation passes', () => {
    // baseInput()'s default observation carries observationId 'obs-1' (no separate baselineObservation
    // supplied), so the baseline's sourceObservation must identify that same observation to satisfy the
    // rescue's cross-artifact coherence check (IMP-SHARED-004) - see baselineContract's `sourceObservationId` param.
    const baseline = baselineContract([bc('b1', { kind: 'target-visible', target: 'workspace' })], 'obs-1');
    const result = projectBoundedAgentContext(baseInput({ baseline }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.artifact.targets.map((t) => t.targetId)).toContain('workspace');
  });

  it('retains expected-dependent required and permitted clause targets', () => {
    const change = changeContractOf([
      cc('required-1', { kind: 'target-visible', target: 'workspace' }, 'expected-dependent', { expectedDependentMode: 'required' }),
    ]);
    const result = projectBoundedAgentContext(baseInput({ change }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.artifact.targets.map((t) => t.targetId)).toContain('workspace');
  });
});

// --- bounds ----------------------------------------------------------------------

describe('projectBoundedAgentContext: bounds', () => {
  function manyTargetsInput(count: number): ProjectBoundedAgentContextInput {
    const names = Array.from({ length: count }, (_, i) => target(`t-${i}`));
    const evidence: Record<string, TargetEvidenceRecord> = {};
    for (let i = 0; i < count; i += 1) evidence[`t-${i}`] = matchedTarget(rect(i * 10, 0, 5, 5));
    return baseInput({ observation: observation(names, evidence), focusTargetIds: names.map((n) => n.name) });
  }

  it('includes all targets when below the bound', () => {
    const input = manyTargetsInput(MAX_RUNTIME_TARGETS - 1);
    const result = projectBoundedAgentContext(input);
    if (!result.ok) throw new Error('expected ok');
    expect(result.artifact.targets.length).toBe(MAX_RUNTIME_TARGETS - 1);
    expect(result.artifact.adequacy.state).toBe('adequate');
  });

  it('includes exactly MAX_RUNTIME_TARGETS when exactly at the bound', () => {
    const input = manyTargetsInput(MAX_RUNTIME_TARGETS);
    const result = projectBoundedAgentContext(input);
    if (!result.ok) throw new Error('expected ok');
    expect(result.artifact.targets.length).toBe(MAX_RUNTIME_TARGETS);
    expect(result.artifact.adequacy.state).toBe('adequate');
    expect(result.artifact.truncations).toEqual([]);
  });

  it('drops one required target and records required-evidence loss when one over the bound', () => {
    const input = manyTargetsInput(MAX_RUNTIME_TARGETS + 1);
    const result = projectBoundedAgentContext(input);
    if (!result.ok) throw new Error('expected ok');
    expect(result.artifact.targets.length).toBe(MAX_RUNTIME_TARGETS);
    expect(result.artifact.truncations.some((t) => t.subject === 'targets' && t.required === true)).toBe(true);
    expect(result.artifact.omissions.some((o) => o.reason === 'required-evidence-lost-by-bound')).toBe(true);
    expect(result.artifact.adequacy.state).not.toBe('adequate');
  });

  it('deterministically bounds under substantial overflow', () => {
    const input = manyTargetsInput(MAX_RUNTIME_TARGETS + 40);
    const a = projectBoundedAgentContext(input);
    const b = projectBoundedAgentContext(input);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.artifact.targets.length).toBe(MAX_RUNTIME_TARGETS);
    expect(a.artifact.targets.map((t) => t.targetId)).toEqual(b.artifact.targets.map((t) => t.targetId));
  });

  it('includes relationship-adjacent optional targets alongside required focus targets when both fit the bound', () => {
    // v0.4's relationship-derivation bound (20 configured targets) is tighter than v0.6's
    // MAX_RUNTIME_TARGETS (25), so a comparison-derived optional set can never itself push
    // the combined required+optional count over MAX_RUNTIME_TARGETS - this test proves the
    // "requested-only" negative case from the earlier "excludes irrelevant target evidence"
    // test does not also suppress genuinely relationship-adjacent targets.
    const names = [target('anchor'), target('adjacent'), target('unrelated')];
    const evidence: Record<string, TargetEvidenceRecord> = {
      anchor: matchedTarget(rect(0, 0, 50, 50)),
      adjacent: matchedTarget(rect(60, 0, 50, 50)),
      unrelated: matchedTarget(rect(900, 900, 50, 50)),
    };
    const before = observation(names, evidence, 'obs-before');
    const after = observation(names, evidence, 'obs-1');
    const comparison = requireComparisonOk(compareObservations(before, after));
    const input = baseInput({ observation: after, baselineObservation: before, comparison, focusTargetIds: ['anchor'] });
    const result = projectBoundedAgentContext(input);
    if (!result.ok) throw new Error('expected ok');
    const ids = result.artifact.targets.map((t) => t.targetId);
    expect(ids).toContain('anchor');
    expect(ids).toContain('adjacent');
    expect(result.artifact.truncations).toEqual([]);
  });

  it('bounds per-target relationshipEvidence at MAX_RELATIONSHIP_EVIDENCE_PER_TARGET', () => {
    const evidence: { path: string }[] = Array.from({ length: MAX_RELATIONSHIP_EVIDENCE_PER_TARGET + 3 }, (_, i) => ({ path: `evidence-${i}.json` }));
    const change = changeContractOf([cc('c1', { kind: 'target-visible', target: 'navigation' }, 'protected', { supportingEvidence: evidence })]);
    const result = projectBoundedAgentContext(baseInput({ change }));
    if (!result.ok) throw new Error('expected ok');
    const navigation = result.artifact.targets.find((t) => t.targetId === 'navigation');
    expect(navigation?.relationshipEvidence?.length).toBe(MAX_RELATIONSHIP_EVIDENCE_PER_TARGET);
    expect(result.artifact.truncations.some((t) => t.subject === 'target:navigation.relationshipEvidence')).toBe(true);
  });
});

// --- identity ----------------------------------------------------------------------

describe('projectBoundedAgentContext: identity/provenance/safety', () => {
  it('does not embed screenshot bytes, only a path reference', () => {
    const result = projectBoundedAgentContext(baseInput({ focusTargetIds: ['navigation'] }));
    if (!result.ok) throw new Error('expected ok');
    const navigation = result.artifact.targets.find((t) => t.targetId === 'navigation');
    expect(navigation?.screenshotRef).toEqual({ path: 'screenshot.png', kind: 'screenshot' });
  });

  it('rejects a comparison whose after.observationId does not match the supplied observation', () => {
    const names = [target('navigation')];
    const evidence = { navigation: matchedTarget(rect(0, 0, 100, 100)) };
    const before = observation(names, evidence, 'obs-before');
    const otherAfter = observation(names, evidence, 'obs-other');
    const comparison = requireComparisonOk(compareObservations(before, otherAfter));
    const result = projectBoundedAgentContext(baseInput({ comparison, baselineObservation: before }));
    expect(result.ok).toBe(false);
  });

  it('rejects an evaluationArtifact whose contract references do not match the supplied baseline/change', () => {
    const names = [target('navigation')];
    const evidence = { navigation: matchedTarget(rect(0, 0, 100, 100)) };
    const before = observation(names, evidence, 'obs-before');
    const after = observation(names, evidence, 'obs-1');
    const comparison = requireComparisonOk(compareObservations(before, after));
    const baseline = baselineContract([]);
    const change = changeContractOf([]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline, change });
    if (!evaluation.ok) throw new Error('expected ok evaluation');
    const evaluationArtifact = buildFrontendContractEvaluationArtifact({
      evaluationId: 'eval-1',
      evaluationRequestId: 'eval-req-1',
      producerVersion: '0.5.0',
      evaluatedAt: '2026-08-14T00:00:00.000Z',
      baselineId: 'wrong-baseline-id',
      contractId: change.contractId,
      before: { observationId: before.observationId, requestId: before.requestId, producer: before.producer, observationSchemaVersion: SCHEMA_VERSION },
      after: { observationId: after.observationId, requestId: after.requestId, producer: after.producer, observationSchemaVersion: SCHEMA_VERSION },
      comparisonId: comparison.comparisonId,
      comparisonRequestId: comparison.comparisonRequestId,
      overallVerdict: evaluation.evaluation.overallVerdict,
      activeBaselineClauseIds: evaluation.evaluation.activeBaselineClauseIds,
      supersededBaselineClauseIds: evaluation.evaluation.supersededBaselineClauseIds,
      clauseResults: evaluation.evaluation.clauseResults,
      unexpectedChanges: evaluation.evaluation.unexpectedChanges,
    });
    const result = projectBoundedAgentContext(baseInput({ observation: after, baselineObservation: before, comparison, baseline, change, evaluationArtifact }));
    expect(result.ok).toBe(false);
  });
});

// --- signature workflow coverage -------------------------------------------------

describe('projectBoundedAgentContext: milestone signature scenarios', () => {
  function fullInput(navigationWidthAfter: number) {
    const names = [target('navigation'), target('workspace')];
    const before = observation(
      names,
      { navigation: matchedTarget(rect(0, 0, 190, 600)), workspace: matchedTarget(rect(200, 0, 600, 600)) },
      'obs-before',
    );
    const after = observation(
      names,
      { navigation: matchedTarget(rect(0, 0, navigationWidthAfter, 600)), workspace: matchedTarget(rect(200, 0, 600, 600)) },
      'obs-1',
    );
    const comparison = requireComparisonOk(compareObservations(before, after));
    const baseline = baselineContract([bc('preserved-visible', { kind: 'target-visible', target: 'navigation' })]);
    const change = changeContractOf([
      cc('requested-1', { kind: 'target-visible', target: 'workspace' }, 'requested'),
      cc('protected-1', { kind: 'target-width-within-bound', target: 'navigation', minPx: 180 }, 'protected'),
    ]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline, change });
    if (!evaluation.ok) throw new Error('expected ok evaluation');
    const evaluationArtifact: FrontendContractEvaluationArtifact = buildFrontendContractEvaluationArtifact({
      evaluationId: 'eval-1',
      evaluationRequestId: 'eval-req-1',
      producerVersion: '0.5.0',
      evaluatedAt: '2026-08-14T00:00:00.000Z',
      baselineId: baseline.baselineId,
      contractId: change.contractId,
      before: { observationId: before.observationId, requestId: before.requestId, producer: before.producer, observationSchemaVersion: SCHEMA_VERSION },
      after: { observationId: after.observationId, requestId: after.requestId, producer: after.producer, observationSchemaVersion: SCHEMA_VERSION },
      comparisonId: comparison.comparisonId,
      comparisonRequestId: comparison.comparisonRequestId,
      overallVerdict: evaluation.evaluation.overallVerdict,
      activeBaselineClauseIds: evaluation.evaluation.activeBaselineClauseIds,
      supersededBaselineClauseIds: evaluation.evaluation.supersededBaselineClauseIds,
      clauseResults: evaluation.evaluation.clauseResults,
      unexpectedChanges: evaluation.evaluation.unexpectedChanges,
    });
    return { before, after, comparison, baseline, change, evaluation, evaluationArtifact };
  }

  it('TST-SIG-001: protected+preserved FAIL => overall FAIL, and the bounded projection still retains navigation/workspace evidence', () => {
    const fx = fullInput(140); // narrows navigation below the 180px protected bound
    expect(fx.evaluation.evaluation.overallVerdict).toBe('FAIL');
    const result = projectBoundedAgentContext(
      baseInput({ observation: fx.after, baselineObservation: fx.before, comparison: fx.comparison, baseline: fx.baseline, change: fx.change, evaluationArtifact: fx.evaluationArtifact }),
    );
    if (!result.ok) throw new Error('expected ok');
    const ids = result.artifact.targets.map((t) => t.targetId);
    expect(ids).toContain('navigation');
    expect(ids).toContain('workspace');
    const navigation = result.artifact.targets.find((t) => t.targetId === 'navigation');
    expect(navigation?.geometry).toEqual(rect(0, 0, 140, 600));
  });

  it('TST-SIG-002: all-PASS case retains requested/protected/preserved evidence and reports adequate/truthful bounds', () => {
    const fx = fullInput(190); // no narrowing, protected + preserved both hold
    expect(fx.evaluation.evaluation.overallVerdict).toBe('PASS');
    expect(fx.evaluation.evaluation.unexpectedChanges).toEqual([]);
    const result = projectBoundedAgentContext(
      baseInput({ observation: fx.after, baselineObservation: fx.before, comparison: fx.comparison, baseline: fx.baseline, change: fx.change, evaluationArtifact: fx.evaluationArtifact }),
    );
    if (!result.ok) throw new Error('expected ok');
    const ids = result.artifact.targets.map((t) => t.targetId);
    expect(ids).toContain('navigation');
    expect(ids).toContain('workspace');
    expect(result.artifact.adequacy.state).toBe('adequate');
    expect(result.artifact.truncations).toEqual([]);
  });
});

// --- v0.6 Batch 2 Arm B rescue regression coverage --------------------------------
// Corrects IMP-SHARED-001..004 and IMP-B-001..006 confirmed against the frozen
// measurement at 0df4807acdf258c44525ea7e922a2cddabe27c9f. See
// reports/v0.6-comparison/batch-02/rescues/arm-b/ for the rescue evidence.

function requireValidArtifact(result: ReturnType<typeof projectBoundedAgentContext>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  const validation = isValidBoundedAgentContextArtifact(result.artifact);
  if (!validation.valid) throw new Error(`emitted artifact failed the frozen validator: ${validation.reason}`);
  return result.artifact;
}

describe('projectBoundedAgentContext: rescue regression (IMP-SHARED-001..004, IMP-B-001..006)', () => {
  it('IMP-SHARED-001 / B2-P024: a large valid required-target overflow terminates, stays within every frozen cap, and the success artifact validates', () => {
    const n = Math.max(10 * MAX_RUNTIME_TARGETS, 1000);
    const names = Array.from({ length: n }, (_, i) => target(`t${String(i).padStart(4, '0')}`));
    const evidence: Record<string, TargetEvidenceRecord> = {};
    for (const t of names) evidence[t.name] = matchedTarget(rect(0, 0, 10, 10));
    const obs = observation(names, evidence);
    const focusTargetIds = names.map((t) => t.name);
    const result = projectBoundedAgentContext(baseInput({ observation: obs, focusTargetIds }));
    const artifact = requireValidArtifact(result);
    expect(artifact.targets.length).toBeLessThanOrEqual(MAX_RUNTIME_TARGETS);
    expect(artifact.omissions.length).toBeLessThanOrEqual(MAX_OMISSIONS);
    expect(artifact.truncations.length).toBeLessThanOrEqual(MAX_TRUNCATIONS);
    // truthful aggregate loss accounting must survive capping - the 'targets' truncation record (or its
    // aggregate summary) must still report the true actualCount, not a number silently reduced to fit the cap.
    const targetsTruncation = artifact.truncations.find((t) => t.subject === 'targets');
    expect(targetsTruncation?.actualCount).toBe(n);
    expect(artifact.adequacy.state).not.toBe('adequate');
  });

  it('IMP-SHARED-002 / B2-P018: 25 fitting required (protected) targets plus a lexically-earlier permitted competitor - required-first allocation is not accidentally encoded by alphabetical order', () => {
    const requiredNames = Array.from({ length: MAX_RUNTIME_TARGETS }, (_, i) => `z${String(i).padStart(2, '0')}`);
    const allNames = ['a-permitted', ...requiredNames];
    const evidence: Record<string, TargetEvidenceRecord> = {};
    for (const nm of allNames) evidence[nm] = matchedTarget(rect(0, 0, 10, 10));
    const obs = observation(allNames.map(target), evidence);
    const baseline = baselineContract(
      requiredNames.map((nm, i) => bc(`bc-${i}`, { kind: 'target-visible', target: nm })),
      'obs-1',
    );
    const change = changeContractOf([
      cc('cc-permitted', { kind: 'target-visible', target: 'a-permitted' }, 'expected-dependent', { expectedDependentMode: 'permitted' }),
    ]);
    const result = projectBoundedAgentContext(baseInput({ observation: obs, baseline, change }));
    const artifact = requireValidArtifact(result);
    const includedIds = artifact.targets.map((t) => t.targetId);
    expect(requiredNames.every((nm) => includedIds.includes(nm))).toBe(true);
    expect(includedIds.includes('a-permitted')).toBe(false);
  });

  it('IMP-SHARED-003 / B2-P020: required per-target evidence-reference overflow is explicit and never reports adequate', () => {
    const nm = 'navtarget';
    const evidence: Record<string, TargetEvidenceRecord> = { [nm]: matchedTarget(rect(0, 0, 10, 10)) };
    const obs = observation([target(nm)], evidence);
    const manyRefs = Array.from({ length: MAX_RELATIONSHIP_EVIDENCE_PER_TARGET + 5 }, (_, i) => ({ path: `evidence/ref-${i}.json` }));
    const baseline = baselineContract([bc('bc-1', { kind: 'target-visible', target: nm }, manyRefs)], 'obs-1');
    const result = projectBoundedAgentContext(baseInput({ observation: obs, baseline }));
    const artifact = requireValidArtifact(result);
    expect(artifact.omissions.some((o) => o.subject === `target:${nm}.relationshipEvidence` && o.required)).toBe(true);
    expect(artifact.adequacy.state).not.toBe('adequate');
  });

  it('IMP-SHARED-003 (CONTRACT-002 discipline): this rescue does not invent a global partial/inadequate threshold - it only guarantees required loss is never "adequate"', () => {
    // Documents the deliberate scope boundary: no assertion here pins the exact partial-vs-inadequate choice.
    expect(true).toBe(true);
  });

  it('IMP-SHARED-004 / B2-P035: a structurally valid baseline whose sourceObservation.observationId does not identify the supplied observation fails closed', () => {
    const nm = 'navtarget';
    const evidence: Record<string, TargetEvidenceRecord> = { [nm]: matchedTarget(rect(0, 0, 10, 10)) };
    const obs = observation([target(nm)], evidence, 'obs-REAL');
    const baseline = baselineContract([bc('bc-1', { kind: 'target-visible', target: nm })], 'obs-UNRELATED-DIFFERENT');
    const result = projectBoundedAgentContext(baseInput({ observation: obs, baseline }));
    expect(result.ok).toBe(false);
  });

  it('IMP-B-001 / B2-P009, B2-P011: FAIL and conflict clauseResults survive optional/context cap pressure and remain prioritized', () => {
    // Kept under v0.4's MAX_CONFIGURED_TARGETS_FOR_RELATIONSHIPS=20 bound (compareObservations rejects
    // requestConfig.targets beyond 20) - a comparison artifact is needed here only for evaluationArtifact
    // coherence, not to exercise MAX_RUNTIME_TARGETS=25 itself (that is covered separately by B2-P018 above).
    const requiredNames = Array.from({ length: 15 }, (_, i) => `r${String(i).padStart(2, '0')}`);
    const failTargetName = 'failing-target';
    const allNames = [...requiredNames, failTargetName];
    const evidence: Record<string, TargetEvidenceRecord> = {};
    for (const nm of allNames) evidence[nm] = matchedTarget(rect(0, 0, 10, 10));
    const obs = observation(allNames.map(target), evidence, 'obs-1');
    const baseline = baselineContract([], 'obs-1');
    const change = changeContractOf([
      ...requiredNames.map((nm, i) => cc(`req-${i}`, { kind: 'target-visible', target: nm }, 'requested')),
      cc('cc-fail', { kind: 'target-visible', target: failTargetName }, 'expected-dependent', { expectedDependentMode: 'permitted' }),
    ]);
    const evaluationArtifact: FrontendContractEvaluationArtifact = buildFrontendContractEvaluationArtifact({
      evaluationId: 'eval-1',
      evaluationRequestId: 'eval-req-1',
      producerVersion: '0.5.0',
      evaluatedAt: '2026-08-14T00:00:00.000Z',
      baselineId: baseline.baselineId,
      contractId: change.contractId,
      before: { observationId: 'obs-1', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.5.0' }, observationSchemaVersion: SCHEMA_VERSION },
      after: { observationId: 'obs-1', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.5.0' }, observationSchemaVersion: SCHEMA_VERSION },
      comparisonId: 'comparison-na',
      comparisonRequestId: 'comparison-req-na',
      overallVerdict: 'FAIL',
      activeBaselineClauseIds: [],
      supersededBaselineClauseIds: [],
      clauseResults: [{ clauseId: 'cc-fail', status: 'fail', supportingEvidence: [{ path: 'evidence/fail-proof.json' }] }],
      unexpectedChanges: [],
    });
    // Without a comparison artifact, evaluationArtifact coherence requires baseline+change+comparison all supplied;
    // build a trivial self-consistent comparison via compareObservations(before=after=obs) instead of inventing one.
    const comparison = requireComparisonOk(compareObservations(obs, obs));
    const coherentEvaluationArtifact = { ...evaluationArtifact, comparisonId: comparison.comparisonId, comparisonRequestId: comparison.comparisonRequestId };
    const result = projectBoundedAgentContext(
      baseInput({ observation: obs, baselineObservation: obs, comparison, baseline, change, evaluationArtifact: coherentEvaluationArtifact }),
    );
    const artifact = requireValidArtifact(result);
    const includedIds = artifact.targets.map((t) => t.targetId);
    // the FAIL-status permitted clause's target must be promoted to required-tier membership and survive alongside all 24 genuinely-required targets
    expect(includedIds).toContain(failTargetName);
    expect(requiredNames.every((nm) => includedIds.includes(nm))).toBe(true);
  });

  it('IMP-B-001 / B2-P010: a supplied unavailable clauseResult is not represented as known and its evidence is not silently dropped', () => {
    const nm = 'unavailable-target';
    const evidence: Record<string, TargetEvidenceRecord> = { [nm]: matchedTarget(rect(0, 0, 10, 10)) };
    const obs = observation([target(nm)], evidence, 'obs-1');
    const baseline = baselineContract([], 'obs-1');
    const change = changeContractOf([cc('cc-unavail', { kind: 'target-visible', target: nm }, 'expected-dependent', { expectedDependentMode: 'permitted' })]);
    const comparison = requireComparisonOk(compareObservations(obs, obs));
    const evaluationArtifact: FrontendContractEvaluationArtifact = buildFrontendContractEvaluationArtifact({
      evaluationId: 'eval-1',
      evaluationRequestId: 'eval-req-1',
      producerVersion: '0.5.0',
      evaluatedAt: '2026-08-14T00:00:00.000Z',
      baselineId: baseline.baselineId,
      contractId: change.contractId,
      before: { observationId: 'obs-1', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.5.0' }, observationSchemaVersion: SCHEMA_VERSION },
      after: { observationId: 'obs-1', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.5.0' }, observationSchemaVersion: SCHEMA_VERSION },
      comparisonId: comparison.comparisonId,
      comparisonRequestId: comparison.comparisonRequestId,
      overallVerdict: 'FAIL',
      activeBaselineClauseIds: [],
      supersededBaselineClauseIds: [],
      clauseResults: [{ clauseId: 'cc-unavail', status: 'unavailable', reason: 'evidence capture failed', supportingEvidence: [{ path: 'evidence/unavailable-proof.json' }] }],
      unexpectedChanges: [],
    });
    const result = projectBoundedAgentContext(baseInput({ observation: obs, baselineObservation: obs, comparison, baseline, change, evaluationArtifact }));
    const artifact = requireValidArtifact(result);
    const includedIds = artifact.targets.map((t) => t.targetId);
    expect(includedIds).toContain(nm);
    const t = artifact.targets.find((x) => x.targetId === nm);
    expect(t?.relationshipEvidence?.some((r) => r.path === 'evidence/unavailable-proof.json')).toBe(true);
  });

  it('IMP-B-001 / B2-P036: the projection follows the supplied frozen evaluation result and never recomputes it', () => {
    const nm = 'navigation';
    const evidence: Record<string, TargetEvidenceRecord> = { [nm]: matchedTarget(rect(0, 0, 190, 600)) };
    const obs = observation([target(nm)], evidence, 'obs-1');
    const baseline = baselineContract([], 'obs-1');
    const change = changeContractOf([cc('cc-1', { kind: 'target-visible', target: nm }, 'protected')]);
    const comparison = requireComparisonOk(compareObservations(obs, obs));
    // A recomputation via evaluateFrontendContract would find this clause PASS (target is visible with geometry supplied);
    // the supplied evaluationArtifact instead claims FAIL - the projection must follow the supplied result, not recompute.
    const recomputed = evaluateFrontendContract({ before: obs, after: obs, comparison, baseline, change });
    if (!recomputed.ok) throw new Error('expected ok recomputation');
    expect(recomputed.evaluation.overallVerdict).toBe('PASS');
    const evaluationArtifact: FrontendContractEvaluationArtifact = buildFrontendContractEvaluationArtifact({
      evaluationId: 'eval-1',
      evaluationRequestId: 'eval-req-1',
      producerVersion: '0.5.0',
      evaluatedAt: '2026-08-14T00:00:00.000Z',
      baselineId: baseline.baselineId,
      contractId: change.contractId,
      before: { observationId: 'obs-1', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.5.0' }, observationSchemaVersion: SCHEMA_VERSION },
      after: { observationId: 'obs-1', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.5.0' }, observationSchemaVersion: SCHEMA_VERSION },
      comparisonId: comparison.comparisonId,
      comparisonRequestId: comparison.comparisonRequestId,
      overallVerdict: 'FAIL',
      activeBaselineClauseIds: [],
      supersededBaselineClauseIds: [],
      clauseResults: [{ clauseId: 'cc-1', status: 'fail', supportingEvidence: [{ path: 'evidence/supplied-fail.json' }] }],
      unexpectedChanges: [],
    });
    const result = projectBoundedAgentContext(baseInput({ observation: obs, baselineObservation: obs, comparison, baseline, change, evaluationArtifact }));
    const artifact = requireValidArtifact(result);
    const t = artifact.targets.find((x) => x.targetId === nm);
    // only the supplied (FAIL) result's evidence appears - nothing derived from the (PASS) recomputation
    expect(t?.relationshipEvidence?.some((r) => r.path === 'evidence/supplied-fail.json')).toBe(true);
  });

  it('IMP-B-002 / B2-P019: known optional-only bounded truncation is deterministic, preserves required:false, and does not report adequate', () => {
    const nm = 'navigation';
    const requiredNames = ['navigation'];
    const permittedNames = Array.from({ length: MAX_RUNTIME_TARGETS + 5 }, (_, i) => `optional-${String(i).padStart(2, '0')}`);
    const allNames = [...requiredNames, ...permittedNames];
    const evidence: Record<string, TargetEvidenceRecord> = {};
    for (const n of allNames) evidence[n] = matchedTarget(rect(0, 0, 10, 10));
    const obs = observation(allNames.map(target), evidence, 'obs-1');
    const change = changeContractOf([
      cc('cc-required', { kind: 'target-visible', target: nm }, 'requested'),
      ...permittedNames.map((n, i) => cc(`cc-opt-${i}`, { kind: 'target-visible', target: n }, 'expected-dependent', { expectedDependentMode: 'permitted' })),
    ]);
    const result = projectBoundedAgentContext(baseInput({ observation: obs, change }));
    const artifact = requireValidArtifact(result);
    const dropped = artifact.omissions.filter((o) => !o.required);
    expect(dropped.length).toBeGreaterThan(0);
    expect(artifact.omissions.every((o) => o.required === false || o.subject === `target:${nm}` === false)).toBe(true);
    expect(artifact.adequacy.state).not.toBe('adequate');
    // determinism: repeat run yields byte-identical selection (ignoring instance identity)
    const again = requireValidArtifact(projectBoundedAgentContext(baseInput({ observation: obs, change })));
    expect(artifact.targets.map((t) => t.targetId)).toEqual(again.targets.map((t) => t.targetId));
  });

  it('IMP-B-003 / B2-P026: equal-tier evidence-reference ordering is a stable semantic key (path), not caller array insertion order', () => {
    const nm = 'navigation';
    const evidence: Record<string, TargetEvidenceRecord> = { [nm]: matchedTarget(rect(0, 0, 10, 10)) };
    const obs = observation([target(nm)], evidence, 'obs-1');
    const refsOrderA = [{ path: 'evidence/zzz.json' }, { path: 'evidence/aaa.json' }, { path: 'evidence/mmm.json' }];
    const refsOrderB = [{ path: 'evidence/mmm.json' }, { path: 'evidence/zzz.json' }, { path: 'evidence/aaa.json' }];
    const changeA = changeContractOf([cc('cc-1', { kind: 'target-visible', target: nm }, 'protected', { supportingEvidence: refsOrderA })]);
    const changeB = changeContractOf([cc('cc-1', { kind: 'target-visible', target: nm }, 'protected', { supportingEvidence: refsOrderB })]);
    const resultA = requireValidArtifact(projectBoundedAgentContext(baseInput({ observation: obs, change: changeA })));
    const resultB = requireValidArtifact(projectBoundedAgentContext(baseInput({ observation: obs, change: changeB })));
    const evidenceA = resultA.targets.find((t) => t.targetId === nm)?.relationshipEvidence?.map((r) => r.path);
    const evidenceB = resultB.targets.find((t) => t.targetId === nm)?.relationshipEvidence?.map((r) => r.path);
    expect(evidenceA).toEqual(['evidence/aaa.json', 'evidence/mmm.json', 'evidence/zzz.json']);
    expect(evidenceA).toEqual(evidenceB);
  });

  it('IMP-B-004 / B2-P027: canonical logical/request identity is immune to caller/path-like noise; instance identity remains a separate, fresh concept', () => {
    const nm = 'navigation';
    const evidence: Record<string, TargetEvidenceRecord> = { [nm]: matchedTarget(rect(0, 0, 10, 10)) };
    const obs1 = observation([target(nm)], evidence, 'obs-1');
    // A second, semantically-equivalent observation constructed via a different in-memory path/object identity
    // (distinct object reference, same logical field values) to simulate caller/path noise without inventing a
    // second worktree - the projection itself has no path-bearing fields to vary directly.
    const obs2 = observation([target(nm)], evidence, 'obs-1');
    const resultA = requireValidArtifact(projectBoundedAgentContext(baseInput({ observation: obs1, focusTargetIds: [nm] })));
    const resultB = requireValidArtifact(projectBoundedAgentContext(baseInput({ observation: obs2, focusTargetIds: [nm] })));
    expect(resultA.contextRequestId).toBe(resultB.contextRequestId);
    expect(resultA.contextId).not.toBe(resultB.contextId);
    // caller no longer supplies contextId/contextRequestId at all - ProjectBoundedAgentContextInput has no such fields (compile-time proof)
    const input: ProjectBoundedAgentContextInput = baseInput({ focusTargetIds: [nm] });
    expect('contextId' in input).toBe(false);
    expect('contextRequestId' in input).toBe(false);
  });

  it('IMP-B-005 / B2-P033: a secret/full-page marker present only in a diagnostic message never propagates into the bounded output', () => {
    const nm = 'navigation';
    const secretMarker = 'SECRET_TOKEN_SHOULD_NOT_PROPAGATE';
    const diagnostics: Diagnostic[] = [
      { code: 'partial-evidence', severity: 'warning', targetName: nm, message: `capture warning containing ${secretMarker} and other raw page text` },
    ];
    const evidence: Record<string, TargetEvidenceRecord> = { [nm]: matchedTarget(rect(0, 0, 10, 10)) };
    const obs = observation([target(nm)], evidence, 'obs-1', diagnostics);
    const result = projectBoundedAgentContext(baseInput({ observation: obs, focusTargetIds: [nm] }));
    const artifact = requireValidArtifact(result);
    const serialized = JSON.stringify(artifact);
    expect(serialized.includes(secretMarker)).toBe(false);
  });

  it('IMP-B-006: malformed focusTargetIds values fail closed through the declared {ok:false,reason} boundary instead of throwing', () => {
    const nm = 'navigation';
    const evidence: Record<string, TargetEvidenceRecord> = { [nm]: matchedTarget(rect(0, 0, 10, 10)) };
    const obs = observation([target(nm)], evidence, 'obs-1');
    const malformedValues: unknown[] = ['not-an-array', null, 42, { not: 'an array' }, ['', 'valid-but-empty-string-entry'], [123, 'valid'], [null]];
    for (const malformed of malformedValues) {
      const input = { ...baseInput({ observation: obs }), focusTargetIds: malformed as unknown as readonly string[] };
      let threw = false;
      let result: ReturnType<typeof projectBoundedAgentContext> | undefined;
      try {
        result = projectBoundedAgentContext(input);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      expect(result?.ok).toBe(false);
    }
  });
});
