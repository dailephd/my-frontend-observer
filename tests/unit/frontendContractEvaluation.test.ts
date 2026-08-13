import { describe, expect, it } from 'vitest';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import type { ComparisonArtifact } from '../../src/domain/comparison.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetEvidenceRecord, TargetGeometry, TargetLayoutMetrics, TargetComputedStyle, TargetResolution } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';
import type { EvidenceField } from '../../src/domain/evidence.js';
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
import { evaluateFrontendContract, type FrontendContractEvaluationInput } from '../../src/domain/frontendContractEvaluation.js';

// --- fixture builders (duplicated per existing tests/unit/comparisonEngine.test.ts convention) --

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

interface MatchedTargetOptions {
  visible?: boolean;
  layout?: TargetLayoutMetrics;
  style?: TargetComputedStyle;
}

function matchedTarget(geometry: TargetGeometry, options: MatchedTargetOptions = {}): TargetEvidenceRecord {
  const visible = options.visible ?? true;
  return {
    resolution: { state: 'available', source: 'derived', value: matchedResolution(), derivedFrom: ['locator-attempts'] },
    tag: { state: 'available', source: 'browser', value: 'div' },
    geometry: { state: 'available', source: 'browser', value: geometry },
    style: { state: 'available', source: 'computed-browser', value: options.style ?? { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
    layout: {
      state: 'available',
      source: 'browser',
      value: options.layout ?? { scrollWidth: geometry.width, scrollHeight: geometry.height, clientWidth: geometry.width, clientHeight: geometry.height, scrollTop: 0, scrollLeft: 0 },
    },
    visibility: { state: 'available', source: 'derived', value: { visible }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
  };
}

function unresolvedTarget(status: 'not-found' | 'ambiguous' | 'unavailable'): TargetEvidenceRecord {
  const reason = `target ${status}`;
  return {
    resolution: { state: 'available', source: 'derived', value: { selectionMethod: 'ordered-locators', selectionStatus: status, usedFallback: false, confidence: 'none', attempts: [] }, derivedFrom: ['locator-attempts'] },
    tag: { state: 'unavailable', reason },
    geometry: { state: 'unavailable', reason },
    style: { state: 'unavailable', reason },
    layout: { state: 'unavailable', reason },
    visibility: { state: 'unavailable', reason },
    semantics: { state: 'unavailable', reason },
    semanticState: { state: 'unavailable', reason },
    landmark: { state: 'unavailable', reason },
    containment: { state: 'unavailable', reason },
  };
}

function target(name: string, selector?: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: selector ?? `#${name}` }] };
}

interface ObservationOptions {
  observationId?: string;
  scrollScenario?: ObservationArtifact['requestConfig']['scrollScenario'];
  scrollOwner?: { kind: 'document' } | { kind: 'target'; target: string } | { kind: 'none' } | { kind: 'indeterminate' };
  initialViewportRelation?: Record<string, 'above' | 'intersecting' | 'below'>;
}

function observation(
  names: readonly NamedTarget[],
  targetEvidence: Record<string, TargetEvidenceRecord>,
  pageEvidence: Record<string, EvidenceField<unknown>> = {},
  options: ObservationOptions = {},
): ObservationArtifact {
  const artifact: ObservationArtifact = {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: options.observationId ?? 'obs-1',
    requestId: 'req-1',
    producer: { name: PRODUCER_NAME, version: '0.4.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '139.0.0' } },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport: { width: 1200, height: 800 },
      targets: [...names],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
      ...(options.scrollScenario ? { scrollScenario: options.scrollScenario } : {}),
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence,
    targetEvidence,
    screenshot: { state: 'available', source: 'browser', value: { path: 'screenshot.png' } },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
  if (options.scrollScenario || options.scrollOwner || options.initialViewportRelation) {
    const targetsRuntime: Record<string, ObservationArtifact['scrollScenarioEvidence'] extends { initial: { targets: infer T } } ? T[string] : never> = {};
    for (const [name, vertical] of Object.entries(options.initialViewportRelation ?? {})) {
      targetsRuntime[name] = {
        metrics: { state: 'not-applicable' },
        overflow: { state: 'not-applicable' },
        boundingRect: { state: 'not-applicable' },
        viewportRelation: { state: 'available', source: 'derived', value: { vertical, intersectsViewport: vertical === 'intersecting', fullyWithinViewport: vertical === 'intersecting' }, derivedFrom: ['boundingRect'] },
      };
    }
    artifact.scrollScenarioEvidence = {
      initial: {
        window: { scrollX: 0, scrollY: 0 },
        document: { root: { scrollTop: 0, scrollLeft: 0, scrollWidth: 1200, scrollHeight: 800, clientWidth: 1200, clientHeight: 800 }, rootOverflow: { horizontalOverflow: false, verticalOverflow: false, overflowX: 'visible', overflowY: 'visible' } },
        targets: targetsRuntime,
      },
      final: {
        window: { scrollX: 0, scrollY: 0 },
        document: { root: { scrollTop: 0, scrollLeft: 0, scrollWidth: 1200, scrollHeight: 800, clientWidth: 1200, clientHeight: 800 }, rootOverflow: { horizontalOverflow: false, verticalOverflow: false, overflowX: 'visible', overflowY: 'visible' } },
        targets: targetsRuntime,
      },
      transition: { windowScrollX: { before: 0, after: 0, changed: false }, windowScrollY: { before: 0, after: 0, changed: false }, targets: {} },
      scrollOwner: { state: 'available', source: 'derived', value: options.scrollOwner ?? { kind: 'none' }, derivedFrom: ['window.scrollX'] },
    };
  }
  return artifact;
}

function requireOk(result: ReturnType<typeof compareObservations>): ComparisonArtifact {
  if (!result.ok) throw new Error(`expected ok comparison, got: ${result.reason}`);
  return result.artifact;
}

function baselineContract(clauses: BaselineClause[], overrides: Partial<PersistentBaselineContract> = {}): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: { observationId: 'obs-1', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: SCHEMA_VERSION },
    clauses,
    provenance: { approvedAt: '2026-08-13T00:00:00.000Z' },
    ...overrides,
  };
}

function changeContractOf(clauses: PerChangeClause[], overrides: Partial<PerChangeContract> = {}): PerChangeContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'change',
    contractId: 'change-1',
    contractRequestId: 'change-request-1',
    activeBaselineIds: ['baseline-1'],
    clauses,
    ...overrides,
  };
}

function bc(clauseId: string, primitive: ContractPrimitive): BaselineClause {
  return { clauseId, primitive, supportingEvidence: [] };
}

function cc(
  clauseId: string,
  primitive: ContractPrimitive,
  category: AuthoredChangeScopeCategory,
  opts: { expectedDependentMode?: ExpectedDependentMode; supersedesBaselineClauseIds?: string[] } = {},
): PerChangeClause {
  return { clauseId, primitive, category, supportingEvidence: [], ...opts };
}

function findResult(evaluation: ReturnType<typeof evaluateFrontendContract>, clauseId: string) {
  if (!evaluation.ok) throw new Error(`expected ok evaluation, got: ${evaluation.reason}`);
  const result = evaluation.evaluation.clauseResults.find((r) => r.clauseId === clauseId);
  if (!result) throw new Error(`no clause result for "${clauseId}"`);
  return result;
}

// --- TST-234: mandatory signature test ------------------------------------------

describe('evaluateFrontendContract: milestone signature (TST-234)', () => {
  it('requested PASS + expected-dependent PASS + protected FAIL + preserved FAIL => overall FAIL', () => {
    const before = observation(
      [target('navigation'), target('workspace'), target('rightAd'), target('footer')],
      {
        navigation: matchedTarget(rect(0, 0, 190, 600), { style: { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } }),
        workspace: matchedTarget(rect(200, 0, 600, 600)),
        rightAd: matchedTarget(rect(900, 0, 200, 600)),
        footer: matchedTarget(rect(0, 600, 1100, 50)),
      },
    );
    const after = observation(
      [target('navigation'), target('workspace'), target('rightAd'), target('footer')],
      {
        navigation: matchedTarget(rect(0, 0, 140, 600), {
          style: { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' },
          layout: { scrollWidth: 160, scrollHeight: 600, clientWidth: 140, clientHeight: 600, scrollTop: 0, scrollLeft: 0 },
        }),
        workspace: matchedTarget(rect(200, 0, 650, 600)),
        rightAd: matchedTarget(rect(900, 0, 180, 600)),
        footer: matchedTarget(rect(0, 600, 1100, 50)),
      },
      {},
      { observationId: 'obs-2' },
    );
    const comparison = requireOk(compareObservations(before, after));

    const baseline = baselineContract([]);
    const change = changeContractOf([
      cc('requested-nav-shrink', { kind: 'property-decreases', target: 'navigation', property: 'width' }, 'requested'),
      cc('expected-workspace-grow', { kind: 'property-increases', target: 'workspace', property: 'width' }, 'expected-dependent', { expectedDependentMode: 'required' }),
      cc('protected-rightad-width', { kind: 'property-unchanged-within-tolerance', target: 'rightAd', property: 'width', tolerance: { kind: 'exact' } }, 'protected'),
      cc('preserved-nav-unclipped', { kind: 'target-not-clipped', target: 'navigation' }, 'preserved'),
    ]);

    const input: FrontendContractEvaluationInput = { before, after, comparison, baseline, change };
    const result = evaluateFrontendContract(input);
    if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);

    expect(findResult(result, 'requested-nav-shrink').status).toBe('pass');
    expect(findResult(result, 'expected-workspace-grow').status).toBe('pass');
    expect(findResult(result, 'protected-rightad-width').status).toBe('fail');
    expect(findResult(result, 'preserved-nav-unclipped').status).toBe('fail');
    expect(result.evaluation.overallVerdict).toBe('FAIL');
  });
});

// --- TST-201..203: requested ------------------------------------------------------

describe('requested clause semantics (TST-201, TST-202, TST-203)', () => {
  function scene(navWidthAfter: number) {
    const before = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation([target('nav')], { nav: matchedTarget(rect(0, 0, navWidthAfter, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    return { before, after, comparison };
  }

  it('TST-201: clean all-pass evaluation with no clauses and no differences yields overall PASS', () => {
    const { before, after, comparison } = scene(200);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change: changeContractOf([]) });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(evaluation.evaluation.overallVerdict).toBe('PASS');
    expect(evaluation.evaluation.unexpectedChanges).toEqual([]);
  });

  it('TST-202: requested change absent fails', () => {
    const { before, after, comparison } = scene(200);
    const change = changeContractOf([cc('req-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'req-1').status).toBe('fail');
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });

  it('TST-203: requested change succeeds passes', () => {
    const { before, after, comparison } = scene(150);
    const change = changeContractOf([cc('req-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'req-1').status).toBe('pass');
    expect(evaluation.evaluation.overallVerdict).toBe('PASS');
  });
});

// --- TST-204..208: expected-dependent ---------------------------------------------

describe('expected-dependent semantics (TST-204..208)', () => {
  function scene(workspaceXAfter: number) {
    const before = observation([target('workspace')], { workspace: matchedTarget(rect(200, 0, 600, 600)) });
    const after = observation([target('workspace')], { workspace: matchedTarget(rect(workspaceXAfter, 0, 600, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    return { before, after, comparison };
  }

  it('TST-204/205: required expected-dependent absent fails, occurs passes', () => {
    const absent = scene(200);
    const changeAbsent = changeContractOf([cc('dep-1', { kind: 'property-decreases', target: 'workspace', property: 'x' }, 'expected-dependent', { expectedDependentMode: 'required' })]);
    const evalAbsent = evaluateFrontendContract({ ...absent, baseline: baselineContract([]), change: changeAbsent });
    if (!evalAbsent.ok) throw new Error(evalAbsent.reason);
    expect(findResult(evalAbsent, 'dep-1').status).toBe('fail');
    expect(evalAbsent.evaluation.overallVerdict).toBe('FAIL');

    const occurs = scene(150);
    const changeOccurs = changeContractOf([cc('dep-1', { kind: 'property-decreases', target: 'workspace', property: 'x' }, 'expected-dependent', { expectedDependentMode: 'required' })]);
    const evalOccurs = evaluateFrontendContract({ ...occurs, baseline: baselineContract([]), change: changeOccurs });
    if (!evalOccurs.ok) throw new Error(evalOccurs.reason);
    expect(findResult(evalOccurs, 'dep-1').status).toBe('pass');
    expect(evalOccurs.evaluation.overallVerdict).toBe('PASS');
  });

  it('TST-206/207/208: permitted dependent - no change passes, compliant change passes, contradictory change fails', () => {
    const noChange = scene(200);
    const changeNo = changeContractOf([cc('dep-1', { kind: 'property-decreases', target: 'workspace', property: 'x' }, 'expected-dependent', { expectedDependentMode: 'permitted' })]);
    const evalNo = evaluateFrontendContract({ ...noChange, baseline: baselineContract([]), change: changeNo });
    if (!evalNo.ok) throw new Error(evalNo.reason);
    expect(findResult(evalNo, 'dep-1').status).toBe('pass');

    const compliant = scene(150);
    const changeCompliant = changeContractOf([cc('dep-1', { kind: 'property-decreases', target: 'workspace', property: 'x' }, 'expected-dependent', { expectedDependentMode: 'permitted' })]);
    const evalCompliant = evaluateFrontendContract({ ...compliant, baseline: baselineContract([]), change: changeCompliant });
    if (!evalCompliant.ok) throw new Error(evalCompliant.reason);
    expect(findResult(evalCompliant, 'dep-1').status).toBe('pass');

    const contradictory = scene(250);
    const changeContra = changeContractOf([cc('dep-1', { kind: 'property-decreases', target: 'workspace', property: 'x' }, 'expected-dependent', { expectedDependentMode: 'permitted' })]);
    const evalContra = evaluateFrontendContract({ ...contradictory, baseline: baselineContract([]), change: changeContra });
    if (!evalContra.ok) throw new Error(evalContra.reason);
    expect(findResult(evalContra, 'dep-1').status).toBe('fail');
    expect(evalContra.evaluation.overallVerdict).toBe('FAIL');
  });
});

// --- TST-209/210: protected ------------------------------------------------------

describe('protected semantics (TST-209, TST-210)', () => {
  it('TST-209: unchanged within tolerance passes', () => {
    const before = observation([target('rightAd')], { rightAd: matchedTarget(rect(900, 0, 200, 600)) });
    const after = observation([target('rightAd')], { rightAd: matchedTarget(rect(900, 0, 200.3, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const change = changeContractOf([cc('prot-1', { kind: 'property-unchanged-within-tolerance', target: 'rightAd', property: 'width', tolerance: { kind: 'absolute-px', amount: 1 } }, 'protected')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'prot-1').status).toBe('pass');
  });

  it('TST-210: changed beyond tolerance fails and is not duplicated as unexpected', () => {
    const before = observation([target('rightAd')], { rightAd: matchedTarget(rect(900, 0, 200, 600)) });
    const after = observation([target('rightAd')], { rightAd: matchedTarget(rect(900, 0, 180, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const change = changeContractOf([cc('prot-1', { kind: 'property-unchanged-within-tolerance', target: 'rightAd', property: 'width', tolerance: { kind: 'exact' } }, 'protected')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'prot-1').status).toBe('fail');
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
    expect(evaluation.evaluation.unexpectedChanges).toEqual([]);
  });
});

// --- TST-211..216: preserved -------------------------------------------------------

describe('preserved semantics (TST-211..216)', () => {
  it('TST-211/212: clipping invariant passes when unclipped, fails when it becomes clipped', () => {
    const notClippedStyle: TargetComputedStyle = { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' };
    const beforeOk = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600), { style: notClippedStyle }) });
    const afterOk = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600), { style: notClippedStyle }) }, {}, { observationId: 'obs-2' });
    const comparisonOk = requireOk(compareObservations(beforeOk, afterOk));
    const changeOk = changeContractOf([cc('preserved-1', { kind: 'target-not-clipped', target: 'nav' }, 'preserved')]);
    const evalOk = evaluateFrontendContract({ before: beforeOk, after: afterOk, comparison: comparisonOk, baseline: baselineContract([]), change: changeOk });
    if (!evalOk.ok) throw new Error(evalOk.reason);
    expect(findResult(evalOk, 'preserved-1').status).toBe('pass');

    const beforeFail = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600), { style: notClippedStyle }) });
    const afterFail = observation(
      [target('nav')],
      {
        nav: matchedTarget(rect(0, 0, 150, 600), {
          style: { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' },
          layout: { scrollWidth: 160, scrollHeight: 600, clientWidth: 150, clientHeight: 600, scrollTop: 0, scrollLeft: 0 },
        }),
      },
      {},
      { observationId: 'obs-2' },
    );
    const comparisonFail = requireOk(compareObservations(beforeFail, afterFail));
    const changeFail = changeContractOf([
      cc('requested-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested'),
      cc('preserved-1', { kind: 'target-not-clipped', target: 'nav' }, 'preserved'),
    ]);
    const evalFail = evaluateFrontendContract({ before: beforeFail, after: afterFail, comparison: comparisonFail, baseline: baselineContract([]), change: changeFail });
    if (!evalFail.ok) throw new Error(evalFail.reason);
    expect(findResult(evalFail, 'requested-1').status).toBe('pass');
    expect(findResult(evalFail, 'preserved-1').status).toBe('fail');
    expect(evalFail.evaluation.overallVerdict).toBe('FAIL');
  });

  it('TST-213: overlap invariant fails when overlap begins', () => {
    const before = observation([target('a'), target('b')], { a: matchedTarget(rect(0, 0, 100, 100)), b: matchedTarget(rect(200, 0, 100, 100)) });
    const after = observation([target('a'), target('b')], { a: matchedTarget(rect(0, 0, 100, 100)), b: matchedTarget(rect(50, 0, 100, 100)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const change = changeContractOf([cc('preserved-1', { kind: 'targets-do-not-overlap', targetA: 'a', targetB: 'b' }, 'preserved')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'preserved-1').status).toBe('fail');
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });

  it('TST-214: horizontal page-overflow invariant fails when document exceeds viewport', () => {
    const before = observation([], {}, { documentWidth: { state: 'available', source: 'derived', value: 1200, derivedFrom: ['x'] }, viewportWidth: { state: 'available', source: 'browser', value: 1200 } });
    const after = observation(
      [],
      {},
      { documentWidth: { state: 'available', source: 'derived', value: 1400, derivedFrom: ['x'] }, viewportWidth: { state: 'available', source: 'browser', value: 1200 } },
      { observationId: 'obs-2' },
    );
    const comparison = requireOk(compareObservations(before, after));
    const change = changeContractOf([cc('preserved-1', { kind: 'document-width-fits-viewport' }, 'preserved')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'preserved-1').status).toBe('fail');
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });

  it('TST-215/216: scroll-owner preservation passes when unchanged, fails on regression', () => {
    const scenario = { action: { kind: 'window-scroll-by' as const, deltaX: 0, deltaY: 200 } };
    const beforeOk = observation([], {}, {}, { scrollScenario: scenario, scrollOwner: { kind: 'document' } });
    const afterOk = observation([], {}, {}, { scrollScenario: scenario, scrollOwner: { kind: 'document' }, observationId: 'obs-2' });
    const comparisonOk = requireOk(compareObservations(beforeOk, afterOk));
    const changeOk = changeContractOf([cc('preserved-1', { kind: 'scroll-owner-is-document' }, 'preserved')]);
    const evalOk = evaluateFrontendContract({ before: beforeOk, after: afterOk, comparison: comparisonOk, baseline: baselineContract([]), change: changeOk });
    if (!evalOk.ok) throw new Error(evalOk.reason);
    expect(findResult(evalOk, 'preserved-1').status).toBe('pass');

    const beforeFail = observation([target('panel')], {}, {}, { scrollScenario: scenario, scrollOwner: { kind: 'document' } });
    const afterFail = observation([target('panel')], {}, {}, { scrollScenario: scenario, scrollOwner: { kind: 'target', target: 'panel' }, observationId: 'obs-2' });
    const comparisonFail = requireOk(compareObservations(beforeFail, afterFail));
    const changeFail = changeContractOf([cc('preserved-1', { kind: 'scroll-owner-is-document' }, 'preserved')]);
    const evalFail = evaluateFrontendContract({ before: beforeFail, after: afterFail, comparison: comparisonFail, baseline: baselineContract([]), change: changeFail });
    if (!evalFail.ok) throw new Error(evalFail.reason);
    expect(findResult(evalFail, 'preserved-1').status).toBe('fail');
    expect(evalFail.evaluation.overallVerdict).toBe('FAIL');
  });
});

// --- TST-217..219: supersession / conflict ----------------------------------------

describe('explicit supersession and conflict (TST-217..219)', () => {
  function scene() {
    const before = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 150, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    return { before, after, comparison };
  }

  it('TST-217: explicit supersession removes the baseline clause and evaluates the per-change clause cleanly', () => {
    const { before, after, comparison } = scene();
    const baseline = baselineContract([bc('baseline-nav-unchanged', { kind: 'property-unchanged-within-tolerance', target: 'nav', property: 'width', tolerance: { kind: 'exact' } })]);
    const change = changeContractOf([
      cc('req-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested', { supersedesBaselineClauseIds: ['baseline-nav-unchanged'] }),
    ]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline, change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(evaluation.evaluation.activeBaselineClauseIds).toEqual([]);
    expect(evaluation.evaluation.supersededBaselineClauseIds).toEqual(['baseline-nav-unchanged']);
    expect(findResult(evaluation, 'req-1').status).toBe('pass');
    expect(evaluation.evaluation.clauseResults.some((r) => r.status === 'conflict')).toBe(false);
    expect(evaluation.evaluation.overallVerdict).toBe('PASS');
  });

  it('TST-218: missing supersession produces conflict and overall FAIL', () => {
    const { before, after, comparison } = scene();
    const baseline = baselineContract([bc('baseline-nav-unchanged', { kind: 'property-unchanged-within-tolerance', target: 'nav', property: 'width', tolerance: { kind: 'exact' } })]);
    const change = changeContractOf([cc('req-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline, change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'baseline-nav-unchanged').status).toBe('conflict');
    expect(findResult(evaluation, 'req-1').status).toBe('conflict');
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });

  it('TST-219: unknown superseded baseline clause id produces conflict and overall FAIL', () => {
    const { before, after, comparison } = scene();
    const baseline = baselineContract([bc('baseline-nav-unchanged', { kind: 'property-unchanged-within-tolerance', target: 'nav', property: 'width', tolerance: { kind: 'exact' } })]);
    const change = changeContractOf([
      cc('req-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested', { supersedesBaselineClauseIds: ['does-not-exist'] }),
    ]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline, change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'req-1').status).toBe('conflict');
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });
});

// --- TST-220/221/222: tolerance ----------------------------------------------------

describe('contract tolerance behavior (TST-220, TST-221, TST-222)', () => {
  function widthScene(before: number, after: number) {
    const b = observation([target('t')], { t: matchedTarget(rect(0, 0, before, 100)) });
    const a = observation([target('t')], { t: matchedTarget(rect(0, 0, after, 100)) }, {}, { observationId: 'obs-2' });
    return { before: b, after: a, comparison: requireOk(compareObservations(b, a)) };
  }

  it('TST-220: absolute-pixel tolerance boundary (inside, exactly on, just outside)', () => {
    const inside = widthScene(100, 104);
    const evalInside = evaluateFrontendContract({
      ...inside,
      baseline: baselineContract([]),
      change: changeContractOf([cc('t-1', { kind: 'property-unchanged-within-tolerance', target: 't', property: 'width', tolerance: { kind: 'absolute-px', amount: 5 } }, 'protected')]),
    });
    if (!evalInside.ok) throw new Error(evalInside.reason);
    expect(findResult(evalInside, 't-1').status).toBe('pass');

    const boundary = widthScene(100, 105);
    const evalBoundary = evaluateFrontendContract({
      ...boundary,
      baseline: baselineContract([]),
      change: changeContractOf([cc('t-1', { kind: 'property-unchanged-within-tolerance', target: 't', property: 'width', tolerance: { kind: 'absolute-px', amount: 5 } }, 'protected')]),
    });
    if (!evalBoundary.ok) throw new Error(evalBoundary.reason);
    expect(findResult(evalBoundary, 't-1').status).toBe('pass');

    const outside = widthScene(100, 106);
    const evalOutside = evaluateFrontendContract({
      ...outside,
      baseline: baselineContract([]),
      change: changeContractOf([cc('t-1', { kind: 'property-unchanged-within-tolerance', target: 't', property: 'width', tolerance: { kind: 'absolute-px', amount: 5 } }, 'protected')]),
    });
    if (!evalOutside.ok) throw new Error(evalOutside.reason);
    expect(findResult(evalOutside, 't-1').status).toBe('fail');
  });

  it('TST-221: percent tolerance boundary (denominator is the before value)', () => {
    const inside = widthScene(200, 209); // 4.5% < 5%
    const evalInside = evaluateFrontendContract({
      ...inside,
      baseline: baselineContract([]),
      change: changeContractOf([cc('t-1', { kind: 'property-unchanged-within-tolerance', target: 't', property: 'width', tolerance: { kind: 'percent', amount: 5 } }, 'protected')]),
    });
    if (!evalInside.ok) throw new Error(evalInside.reason);
    expect(findResult(evalInside, 't-1').status).toBe('pass');

    const outside = widthScene(200, 211); // 5.5% > 5%
    const evalOutside = evaluateFrontendContract({
      ...outside,
      baseline: baselineContract([]),
      change: changeContractOf([cc('t-1', { kind: 'property-unchanged-within-tolerance', target: 't', property: 'width', tolerance: { kind: 'percent', amount: 5 } }, 'protected')]),
    });
    if (!evalOutside.ok) throw new Error(evalOutside.reason);
    expect(findResult(evalOutside, 't-1').status).toBe('fail');
  });

  it('TST-222: comparison geometryTolerancePx does not widen contract tolerance', () => {
    const b = observation([target('t')], { t: matchedTarget(rect(0, 0, 100, 100)) });
    const a = observation([target('t')], { t: matchedTarget(rect(0, 0, 106, 100)) }, {}, { observationId: 'obs-2' });
    const comparisonWideGeometryTolerance = requireOk(compareObservations(b, a, { geometryTolerancePx: 10 }));
    const evaluation = evaluateFrontendContract({
      before: b,
      after: a,
      comparison: comparisonWideGeometryTolerance,
      baseline: baselineContract([]),
      change: changeContractOf([cc('t-1', { kind: 'property-unchanged-within-tolerance', target: 't', property: 'width', tolerance: { kind: 'exact' } }, 'protected')]),
    });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 't-1').status).toBe('fail');
  });
});

// --- TST-223/224/225: evidence coherence -------------------------------------------

describe('evidence coherence (TST-223, TST-224, TST-225)', () => {
  it('TST-223: required evidence unavailable produces unavailable, never a fabricated pass', () => {
    const before = observation([target('ghost')], { ghost: unresolvedTarget('not-found') });
    const after = observation([target('ghost')], { ghost: unresolvedTarget('not-found') }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const change = changeContractOf([cc('req-1', { kind: 'target-visible', target: 'ghost' }, 'requested')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    const result = findResult(evaluation, 'req-1');
    expect(result.status).toBe('unavailable');
    expect(result.status === 'unavailable' && result.reason.length > 0).toBe(true);
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });

  it('TST-224: incomparable source evidence never fabricates a normal PASS', () => {
    const before = observation([], {}, {}, {});
    const beforeIncomparable = { ...before, requestConfig: { ...before.requestConfig, targetUrl: 'http://localhost/a' } };
    const afterIncomparable = observation([], {}, {}, { observationId: 'obs-2' });
    const afterFixed = { ...afterIncomparable, requestConfig: { ...afterIncomparable.requestConfig, targetUrl: 'http://localhost/b' } };
    const comparison = requireOk(compareObservations(beforeIncomparable, afterFixed));
    expect(comparison.comparability.state).toBe('incomparable');
    const baseline = baselineContract([bc('b-1', { kind: 'document-width-fits-viewport' })]);
    const change = changeContractOf([cc('c-1', { kind: 'document-width-fits-viewport' }, 'preserved')]);
    const evaluation = evaluateFrontendContract({ before: beforeIncomparable, after: afterFixed, comparison, baseline, change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'b-1').status).toBe('unavailable');
    expect(findResult(evaluation, 'c-1').status).toBe('unavailable');
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });

  it('TST-225: evidence identity mismatch fails closed', () => {
    const before = observation([], {}, {}, { observationId: 'obs-a' });
    const after = observation([], {}, {}, { observationId: 'obs-b' });
    const comparison = requireOk(compareObservations(before, after));
    const wrongBefore = observation([], {}, {}, { observationId: 'obs-other' });
    const evaluation = evaluateFrontendContract({ before: wrongBefore, after, comparison, baseline: baselineContract([]), change: changeContractOf([]) });
    expect(evaluation.ok).toBe(false);
  });
});

// --- TST-226..229: unexpected classification ---------------------------------------

describe('unexpected-change classification (TST-226..229)', () => {
  it('TST-226: unrelated target change becomes unexpected and forces overall FAIL', () => {
    const before = observation([target('nav'), target('footer')], { nav: matchedTarget(rect(0, 0, 200, 600)), footer: matchedTarget(rect(0, 600, 1000, 50)) });
    const after = observation(
      [target('nav'), target('footer')],
      { nav: matchedTarget(rect(0, 0, 150, 600)), footer: matchedTarget(rect(0, 650, 1000, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const comparison = requireOk(compareObservations(before, after));
    const change = changeContractOf([cc('req-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'req-1').status).toBe('pass');
    expect(evaluation.evaluation.unexpectedChanges.some((u) => u.subject.type === 'target' && u.subject.target === 'footer')).toBe(true);
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });

  it('TST-227: protected failure is not duplicated as unexpected', () => {
    const before = observation([target('rightAd')], { rightAd: matchedTarget(rect(900, 0, 200, 600)) });
    const after = observation([target('rightAd')], { rightAd: matchedTarget(rect(900, 0, 180, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const change = changeContractOf([cc('prot-1', { kind: 'property-unchanged-within-tolerance', target: 'rightAd', property: 'width', tolerance: { kind: 'exact' } }, 'protected')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'prot-1').status).toBe('fail');
    expect(evaluation.evaluation.unexpectedChanges).toEqual([]);
  });

  it('TST-228: preserved failure is not duplicated as unexpected', () => {
    const before = observation([target('panel')], { panel: matchedTarget(rect(0, 0, 100, 100), { visible: true }) });
    const after = observation([target('panel')], { panel: matchedTarget(rect(0, 0, 100, 100), { visible: false }) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const change = changeContractOf([cc('preserved-1', { kind: 'target-visible', target: 'panel' }, 'preserved')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(findResult(evaluation, 'preserved-1').status).toBe('fail');
    expect(evaluation.evaluation.unexpectedChanges).toEqual([]);
  });

  it('TST-229: multiple unrelated changes remain individually visible, not collapsed', () => {
    const before = observation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(0, 0, 100, 100)), b: matchedTarget(rect(300, 0, 100, 100)) },
    );
    const after = observation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(10, 0, 100, 100)), b: matchedTarget(rect(320, 0, 100, 100)) },
      {},
      { observationId: 'obs-2' },
    );
    const comparison = requireOk(compareObservations(before, after));
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change: changeContractOf([]) });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    expect(evaluation.evaluation.unexpectedChanges.length).toBe(2);
    expect(evaluation.evaluation.overallVerdict).toBe('FAIL');
  });
});

// --- TST-230: relationship-change deduplication -------------------------------------

describe('relationship-change deduplication (TST-230)', () => {
  it('no single logical relationship transition (same kind/subjectTarget/relatedTarget) appears twice in unexpected scope', () => {
    const before = observation([target('a'), target('b')], { a: matchedTarget(rect(0, 0, 100, 100)), b: matchedTarget(rect(200, 0, 100, 100)) });
    const after = observation([target('a'), target('b')], { a: matchedTarget(rect(0, 0, 100, 100)), b: matchedTarget(rect(50, 0, 100, 100)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change: changeContractOf([]) });
    if (!evaluation.ok) throw new Error(evaluation.reason);
    const relationshipUnexpected = evaluation.evaluation.unexpectedChanges.filter((u) => u.subject.type === 'relationship');
    expect(relationshipUnexpected.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const u of relationshipUnexpected) {
      if (u.subject.type !== 'relationship') continue;
      const key = `${u.subject.kind}|${u.subject.subjectTarget ?? ''}|${u.subject.relatedTarget ?? ''}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// --- TST-231/232: immutability and determinism --------------------------------------

describe('immutability and determinism (TST-231, TST-232)', () => {
  it('TST-231: inputs remain unchanged after evaluation', () => {
    const before = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 150, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const baseline = baselineContract([bc('b-1', { kind: 'target-visible', target: 'nav' })]);
    const change = changeContractOf([cc('req-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested')]);
    const beforeSnapshot = JSON.parse(JSON.stringify(before));
    const afterSnapshot = JSON.parse(JSON.stringify(after));
    const comparisonSnapshot = JSON.parse(JSON.stringify(comparison));
    const baselineSnapshot = JSON.parse(JSON.stringify(baseline));
    const changeSnapshot = JSON.parse(JSON.stringify(change));
    evaluateFrontendContract({ before, after, comparison, baseline, change });
    expect(before).toEqual(beforeSnapshot);
    expect(after).toEqual(afterSnapshot);
    expect(comparison).toEqual(comparisonSnapshot);
    expect(baseline).toEqual(baselineSnapshot);
    expect(change).toEqual(changeSnapshot);
  });

  it('TST-232: repeated evaluation of identical inputs is deterministic', () => {
    const before = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 150, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const baseline = baselineContract([bc('b-1', { kind: 'target-visible', target: 'nav' })]);
    const change = changeContractOf([cc('req-1', { kind: 'property-decreases', target: 'nav', property: 'width' }, 'requested')]);
    const first = evaluateFrontendContract({ before, after, comparison, baseline, change });
    const second = evaluateFrontendContract({ before, after, comparison, baseline, change });
    expect(first).toEqual(second);
  });
});

// --- TST-233: unknown/unsupported primitive fails closed -----------------------------

describe('unsupported primitive fails closed (TST-233)', () => {
  it('an unrecognized primitive kind is rejected at the structural boundary, never guessed as pass', () => {
    const before = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation([target('nav')], { nav: matchedTarget(rect(0, 0, 150, 600)) }, {}, { observationId: 'obs-2' });
    const comparison = requireOk(compareObservations(before, after));
    const bogusPrimitive = { kind: 'bogus-primitive', target: 'nav' } as unknown as ContractPrimitive;
    const change = changeContractOf([cc('c-1', bogusPrimitive, 'requested')]);
    const evaluation = evaluateFrontendContract({ before, after, comparison, baseline: baselineContract([]), change });
    expect(evaluation.ok).toBe(false);
  });
});
