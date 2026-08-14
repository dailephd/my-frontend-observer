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
import { MAX_RUNTIME_TARGETS, MAX_RELATIONSHIP_EVIDENCE_PER_TARGET } from '../../src/domain/boundedAgentContext.js';
import { projectBoundedAgentContext, type ProjectBoundedAgentContextInput } from '../../src/domain/boundedAgentContextProjection.js';

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

function observation(names: readonly NamedTarget[], targetEvidence: Record<string, TargetEvidenceRecord>, observationId = 'obs-1'): ObservationArtifact {
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
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
}

function requireComparisonOk(result: ReturnType<typeof compareObservations>): ComparisonArtifact {
  if (!result.ok) throw new Error(`expected ok comparison, got: ${result.reason}`);
  return result.artifact;
}

function baselineContract(clauses: BaselineClause[]): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: { observationId: 'obs-before', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.5.0' }, observationSchemaVersion: SCHEMA_VERSION },
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
    contextId: 'ctx-1',
    contextRequestId: 'ctx-req-1',
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

  it('is deterministic for repeated calls on equivalent input', () => {
    const input = baseInput({ focusTargetIds: ['navigation', 'workspace'] });
    const a = projectBoundedAgentContext(input);
    const b = projectBoundedAgentContext(input);
    expect(a).toEqual(b);
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
    const baseline = baselineContract([bc('b1', { kind: 'target-visible', target: 'workspace' })]);
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
