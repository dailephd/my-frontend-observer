import { describe, expect, it } from 'vitest';
import { prepareReferenceCorrection, reviewReferenceCorrectionAttempt } from '../../src/domain/referenceCorrectionWorkflow.js';
import type { PrepareReferenceCorrectionInput, ReviewReferenceCorrectionAttemptInput } from '../../src/domain/referenceCorrectionWorkflow.js';
import { EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import type { ApprovedExternalReferenceArtifact, ImportedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import type { ReferenceRegion } from '../../src/domain/externalReferenceRegions.js';
import type { ExternalReferenceApplicability } from '../../src/domain/externalReferenceApplicability.js';
import type { ExternalReferenceRequirement } from '../../src/domain/externalReferenceRequirements.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetEvidenceRecord, TargetGeometry, TargetResolution, TargetSelectionStatus } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';
import type { ReferenceRuntimeBindingDeclaration } from '../../src/domain/externalReferenceRuntimeBinding.js';
import { CONTRACT_ARTIFACT_KIND, CONTRACT_SCHEMA_VERSION } from '../../src/domain/frontendContracts.js';
import type { PersistentBaselineContract, PerChangeContract, BaselineClause, PerChangeClause, ContractPrimitive, AuthoredChangeScopeCategory, ExpectedDependentMode } from '../../src/domain/frontendContracts.js';

function region(id: string, x: number, y: number, width: number, height: number): ReferenceRegion {
  return { id, rectangle: { x, y, width, height } };
}

function widthRequirement(regionId: string, amount: number): ExternalReferenceRequirement {
  return {
    requirementId: `req-${regionId}-width`,
    category: 'requested',
    subject: { kind: 'region-property', region: regionId, property: 'width' },
    tolerance: { kind: 'absolute-reference-px', amount },
  };
}

const fullApplicability: ExternalReferenceApplicability = { viewport: { width: 480, height: 620 } };

function approvedReference(
  regions: ReferenceRegion[],
  requirements: ExternalReferenceRequirement[] = [],
  applicability: ExternalReferenceApplicability | undefined = fullApplicability,
): ApprovedExternalReferenceArtifact {
  const imported: ImportedExternalReferenceArtifact = {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: 'ref-req-1',
    referenceId: 'ref-req-1-instance-1',
    producer: { name: 'my-frontend-observer', version: '0.7.0' },
    provenance: { importedAt: '2026-01-01T00:00:00.000Z' },
    image: { path: 'reference.png', format: 'png', width: 960, height: 1240, byteLength: 41, sha256: 'a'.repeat(64) },
    lifecycle: { state: 'imported' },
    diagnostics: [],
    completion: { state: 'complete' },
    ...(regions.length > 0 ? { regions } : {}),
    ...(requirements.length > 0 ? { requirements } : {}),
    ...(applicability !== undefined ? { applicability } : {}),
  };
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: imported.referenceRequestId,
    referenceId: 'ref-req-1-instance-2',
    producer: imported.producer,
    provenance: imported.provenance,
    sourceReference: { referenceId: imported.referenceId, referenceRequestId: imported.referenceRequestId, producer: imported.producer, schemaVersion: imported.schemaVersion, image: imported.image },
    lifecycle: { state: 'approved', approvedAt: '2026-01-02T00:00:00.000Z' },
    diagnostics: [],
    completion: { state: 'complete' },
    ...(regions.length > 0 ? { regions } : {}),
    ...(requirements.length > 0 ? { requirements } : {}),
    ...(applicability !== undefined ? { applicability } : {}),
  };
}

function importedReference(regions: ReferenceRegion[], requirements: ExternalReferenceRequirement[] = []): ImportedExternalReferenceArtifact {
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: 'ref-req-2',
    referenceId: 'ref-req-2-instance-1',
    producer: { name: 'my-frontend-observer', version: '0.7.0' },
    provenance: { importedAt: '2026-01-01T00:00:00.000Z' },
    image: { path: 'reference2.png', format: 'png', width: 960, height: 1240, byteLength: 41, sha256: 'b'.repeat(64) },
    lifecycle: { state: 'imported' },
    diagnostics: [],
    completion: { state: 'complete' },
    ...(regions.length > 0 ? { regions } : {}),
    ...(requirements.length > 0 ? { requirements } : {}),
    applicability: fullApplicability,
  };
}

function target(name: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: `#${name}` }] };
}

function resolution(status: TargetSelectionStatus): TargetResolution {
  return {
    selectionMethod: 'ordered-locators',
    selectionStatus: status,
    ...(status === 'matched' ? { selectedLocatorKind: 'css' as const, selectedLocatorIndex: 0 } : {}),
    usedFallback: false,
    confidence: status === 'matched' ? 'exact' : 'none',
    attempts: [{ locatorIndex: 0, locatorKind: 'css', status, matchCount: status === 'matched' ? 1 : status === 'ambiguous' ? 2 : 0 }],
  };
}

function geometry(x: number, y: number, width: number, height: number): TargetGeometry {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function matchedTargetRecord(geom: TargetGeometry, visible = true): TargetEvidenceRecord {
  return {
    resolution: { state: 'available', source: 'derived', value: resolution('matched'), derivedFrom: ['locator-attempts'] },
    tag: { state: 'available', source: 'browser', value: 'div' },
    geometry: { state: 'available', source: 'browser', value: geom },
    style: { state: 'available', source: 'computed-browser', value: { display: visible ? 'block' : 'none', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
    layout: { state: 'available', source: 'browser', value: { scrollWidth: geom.width, scrollHeight: geom.height, clientWidth: geom.width, clientHeight: geom.height, scrollTop: 0, scrollLeft: 0 } },
    visibility: { state: 'available', source: 'derived', value: { visible }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
  };
}

function unresolvedTargetRecord(status: 'not-found' | 'ambiguous' | 'unavailable'): TargetEvidenceRecord {
  const reason = `target ${status}`;
  return {
    resolution: { state: 'available', source: 'derived', value: resolution(status), derivedFrom: ['locator-attempts'] },
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

function observation(
  targets: NamedTarget[],
  targetEvidence: Record<string, TargetEvidenceRecord>,
  observationId: string,
  viewport: { width: number; height: number } = { width: 480, height: 620 },
): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId,
    requestId: 'req-1',
    producer: { name: PRODUCER_NAME, version: '0.7.0' },
    browser: { state: 'not-applicable' },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport,
      targets,
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence,
    screenshot: { state: 'available', source: 'browser', value: { path: `${observationId}-screenshot.png` } },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: `${observationId}-screenshot.png`, kind: 'screenshot' }],
  };
}

function baselineContract(clauses: BaselineClause[], sourceObservationId: string): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: { observationId: sourceObservationId, requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.7.0' }, observationSchemaVersion: SCHEMA_VERSION },
    clauses,
    provenance: { approvedAt: '2026-08-13T00:00:00.000Z' },
  };
}

/**
 * Authors the intended `popup-current-page` width correction as an explicit
 * 'expected-dependent'/'permitted' change clause, so v0.4's honest
 * "unexpected change" detector never flags the very geometry edit this
 * whole workflow exists to make - matching v0.5's own architecture rather
 * than a test-only shortcut. 'permitted' (not 'requested'/mandatory) lets
 * an as-yet-uncorrected candidate (width unchanged from baseline) still
 * pass this clause honestly - only a width *increase* (the wrong direction)
 * would fail it.
 */
function changeContract(): PerChangeContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'change',
    contractId: 'change-1',
    contractRequestId: 'change-request-1',
    activeBaselineIds: ['baseline-1'],
    clauses: [cc('popup-current-page-width-decreases', { kind: 'property-decreases', target: 'popup-current-page', property: 'width' }, 'expected-dependent', 'permitted')],
  };
}

function bc(clauseId: string, primitive: ContractPrimitive): BaselineClause {
  return { clauseId, primitive, supportingEvidence: [] };
}

function cc(clauseId: string, primitive: ContractPrimitive, category: AuthoredChangeScopeCategory, expectedDependentMode?: ExpectedDependentMode): PerChangeClause {
  return { clauseId, primitive, category, supportingEvidence: [], ...(expectedDependentMode !== undefined ? { expectedDependentMode } : {}) };
}

function binding(referenceRegion: string, runtimeTarget: string): ReferenceRuntimeBindingDeclaration {
  return { referenceRegion, runtimeTarget };
}

const cardRegion = region('current-page-card', 0, 0, 424, 100);

function prepareInput(overrides: Partial<PrepareReferenceCorrectionInput> = {}): PrepareReferenceCorrectionInput {
  const baseline = observation([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 223, 50)) }, 'obs-baseline');
  return {
    reference: approvedReference([cardRegion], [widthRequirement('current-page-card', 4)]),
    baselineObservation: baseline,
    baselineContract: baselineContract([], baseline.observationId),
    changeContract: changeContract(),
    bindingDeclarations: [binding('current-page-card', 'popup-current-page')],
    currentObservation: baseline,
    generatedAt: '2026-08-20T00:00:00.000Z',
    producerVersion: '0.7.0',
    projectionProfile: 'frontend-change-review',
    ...overrides,
  };
}

describe('prepareReferenceCorrection', () => {
  it('produces a handoff-ready result with the initial design mismatch (baseline width 223 CSS px -> 446 reference px vs 424 authored)', () => {
    const result = prepareReferenceCorrection(prepareInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.status).toBe('handoff-ready');
    expect(result.fidelity.state).toBe('fail');
    if (result.status !== 'handoff-ready') throw new Error('expected handoff-ready');
    expect(result.handoff.boundedContext.fidelity?.mismatches).toHaveLength(1);
    expect(result.handoff.boundedContext.fidelity?.mismatches[0]).toMatchObject({ referenceValue: 424, candidateValue: 446, delta: 22 });
    expect(result.handoff.verificationPlan.length).toBeGreaterThan(0);
    expect(result.handoff.referenceId).toBe(prepareInput().reference.referenceId);
  });

  it('rejects an unapproved (imported) reference', () => {
    const result = prepareReferenceCorrection(prepareInput({ reference: importedReference([cardRegion], [widthRequirement('current-page-card', 4)]) }));
    expect(result.ok).toBe(false);
  });

  it('reports blocked-not-evaluated for an inadequate reference (zero selected requirements), never a fabricated handoff', () => {
    const result = prepareReferenceCorrection(prepareInput({ reference: approvedReference([cardRegion], []) }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.status).toBe('blocked-not-evaluated');
    expect(result.fidelity.state).toBe('not-evaluated');
    expect(result.fidelity.blockedBy).toBe('reference-inadequate');
  });

  it('reports blocked-not-evaluated for an incompatible reference/candidate viewport, never a fabricated handoff', () => {
    const incompatibleCurrent = observation([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 223, 50)) }, 'obs-baseline', { width: 375, height: 812 });
    const result = prepareReferenceCorrection(prepareInput({ currentObservation: incompatibleCurrent, baselineObservation: incompatibleCurrent, baselineContract: baselineContract([], 'obs-baseline') }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.status).toBe('blocked-not-evaluated');
    expect(result.fidelity.blockedBy).toBe('incompatible');
  });

  it('an ambiguous required binding still produces a handoff, with the ambiguity visible in the mismatch', () => {
    const ambiguousBaseline = observation([target('popup-current-page')], { 'popup-current-page': unresolvedTargetRecord('ambiguous') }, 'obs-baseline');
    const result = prepareReferenceCorrection(
      prepareInput({ currentObservation: ambiguousBaseline, baselineObservation: ambiguousBaseline, baselineContract: baselineContract([], 'obs-baseline') }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.status).toBe('handoff-ready');
    if (result.status !== 'handoff-ready') throw new Error('expected handoff-ready');
    expect(result.handoff.boundedContext.fidelity?.mismatches[0]).toMatchObject({ status: 'unavailable', reasonCode: 'binding-unavailable' });
  });

  it('review identity is deterministic for equivalent semantic input', () => {
    const a = prepareReferenceCorrection(prepareInput());
    const b = prepareReferenceCorrection(prepareInput());
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.reviewRequestId).toBe(b.reviewRequestId);
  });

  it('review identity changes when the active per-change contract differs', () => {
    const a = prepareReferenceCorrection(prepareInput());
    const differentChange = { ...changeContract(), contractId: 'change-2' };
    const b = prepareReferenceCorrection(prepareInput({ changeContract: differentChange }));
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.reviewRequestId).not.toBe(b.reviewRequestId);
  });

  it('review identity changes when contract clause content differs even under the same contract id (baseline/change ids are caller-authored labels, not content-derived)', () => {
    const a = prepareReferenceCorrection(prepareInput());
    if (!a.ok) throw new Error('expected ok');

    const sameIdDifferentClauses = { ...changeContract(), clauses: [] };
    const b = prepareReferenceCorrection(prepareInput({ changeContract: sameIdDifferentClauses }));
    if (!b.ok) throw new Error('expected ok');
    expect(sameIdDifferentClauses.contractId).toBe(prepareInput().changeContract.contractId);
    expect(a.reviewRequestId).not.toBe(b.reviewRequestId);

    const baselineWithClause = baselineContract([bc('destination-control-visible', { kind: 'target-visible', target: 'destination-control' })], prepareInput().baselineObservation.observationId);
    const c = prepareReferenceCorrection(prepareInput({ baselineContract: baselineWithClause }));
    if (!c.ok) throw new Error('expected ok');
    expect(baselineWithClause.baselineId).toBe(prepareInput().baselineContract.baselineId);
    expect(a.reviewRequestId).not.toBe(c.reviewRequestId);
  });

  it('reviewReferenceCorrectionAttempt rejects a reviewRequestId computed before a same-id contract\'s clauses were silently changed', () => {
    const originalChange = changeContract();
    const prep = prepareReferenceCorrection(prepareInput({ changeContract: originalChange }));
    if (!prep.ok) throw new Error('expected ok');

    const tamperedChange = { ...originalChange, clauses: [] };
    const candidate = observation([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 212, 50)) }, 'obs-candidate-tampered');
    const result = reviewReferenceCorrectionAttempt({
      reference: prepareInput().reference,
      baselineObservation: prepareInput().baselineObservation,
      baselineContract: prepareInput().baselineContract,
      changeContract: tamperedChange,
      bindingDeclarations: prepareInput().bindingDeclarations,
      reviewRequestId: prep.reviewRequestId,
      candidateObservation: candidate,
    });
    expect(result.ok).toBe(false);
  });

  it('never mutates its inputs', () => {
    const input = prepareInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    prepareReferenceCorrection(input);
    expect(input).toEqual(snapshot);
  });
});

function reviewInput(overrides: Partial<ReviewReferenceCorrectionAttemptInput> = {}): ReviewReferenceCorrectionAttemptInput {
  const prep = prepareReferenceCorrection(prepareInput());
  if (!prep.ok) throw new Error('expected ok preparation');
  const candidate = observation([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 212, 50)) }, 'obs-candidate-1');
  return {
    reference: prepareInput().reference,
    baselineObservation: prepareInput().baselineObservation,
    baselineContract: prepareInput().baselineContract,
    changeContract: prepareInput().changeContract,
    bindingDeclarations: prepareInput().bindingDeclarations,
    reviewRequestId: prep.reviewRequestId,
    candidateObservation: candidate,
    ...overrides,
  };
}

describe('reviewReferenceCorrectionAttempt', () => {
  it('both PASS: reference fidelity PASS + contract evaluation PASS => overall PASS', () => {
    const result = reviewReferenceCorrectionAttempt(reviewInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.attempt.fidelity.state).toBe('pass');
    expect(result.attempt.contractEvaluation.overallVerdict).toBe('PASS');
    expect(result.attempt.overallState).toBe('pass');
    expect(result.attempt.approvalEligible).toBe(true);
  });

  it('reference FAIL + contract PASS => overall FAIL', () => {
    const badCandidate = observation([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 223, 50)) }, 'obs-candidate-bad');
    const result = reviewReferenceCorrectionAttempt(reviewInput({ candidateObservation: badCandidate }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.attempt.fidelity.state).toBe('fail');
    expect(result.attempt.contractEvaluation.overallVerdict).toBe('PASS');
    expect(result.attempt.overallState).toBe('fail');
    expect(result.attempt.approvalEligible).toBe(false);
  });

  it('reference PASS + protected contract FAIL => overall FAIL (matching the reference is necessary but not sufficient)', () => {
    const baseline = observation(
      [target('popup-current-page'), target('destination-control')],
      { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 223, 50)), 'destination-control': matchedTargetRecord(geometry(0, 60, 50, 20)) },
      'obs-baseline',
    );
    const destinationControlHidden = observation(
      [target('popup-current-page'), target('destination-control')],
      { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 212, 50)), 'destination-control': matchedTargetRecord(geometry(0, 60, 50, 20), false) },
      'obs-candidate-regressed',
    );
    const contract = baselineContract([bc('destination-control-visible', { kind: 'target-visible', target: 'destination-control' })], baseline.observationId);

    const prep = prepareReferenceCorrection(prepareInput({ baselineObservation: baseline, baselineContract: contract, currentObservation: baseline }));
    if (!prep.ok) throw new Error('expected ok preparation');

    const result = reviewReferenceCorrectionAttempt(
      reviewInput({ baselineObservation: baseline, baselineContract: contract, reviewRequestId: prep.reviewRequestId, candidateObservation: destinationControlHidden }),
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.attempt.fidelity.state).toBe('pass');
    expect(result.attempt.contractEvaluation.overallVerdict).toBe('FAIL');
    expect(result.attempt.overallState).toBe('fail');
    expect(result.attempt.approvalEligible).toBe(false);
  });

  it('not-evaluated fidelity never becomes overall PASS', () => {
    const incompatibleCandidate = observation([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 212, 50)) }, 'obs-candidate-incompatible', {
      width: 375,
      height: 812,
    });
    const result = reviewReferenceCorrectionAttempt(reviewInput({ candidateObservation: incompatibleCandidate }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.attempt.fidelity.state).toBe('not-evaluated');
    expect(result.attempt.overallState).toBe('not-evaluated');
    expect(result.attempt.approvalEligible).toBe(false);
  });

  it('rejects a reviewRequestId that does not match the supplied baseline/reference/contracts/bindings (baseline cannot be silently swapped)', () => {
    const result = reviewReferenceCorrectionAttempt(reviewInput({ reviewRequestId: 'not-the-real-id' }));
    expect(result.ok).toBe(false);
  });

  it('attempt identity is distinct per candidate observation and deterministic for the same candidate', () => {
    const candidateA = observation([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 212, 50)) }, 'obs-candidate-a');
    const candidateB = observation([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 212, 50)) }, 'obs-candidate-b');
    const a1 = reviewReferenceCorrectionAttempt(reviewInput({ candidateObservation: candidateA }));
    const a2 = reviewReferenceCorrectionAttempt(reviewInput({ candidateObservation: candidateA }));
    const b1 = reviewReferenceCorrectionAttempt(reviewInput({ candidateObservation: candidateB }));
    if (!a1.ok || !a2.ok || !b1.ok) throw new Error('expected ok');
    expect(a1.attempt.attemptId).toBe(a2.attempt.attemptId);
    expect(a1.attempt.attemptId).not.toBe(b1.attempt.attemptId);
  });

  it('preserves priorAttemptId for traceability without altering evaluation', () => {
    const result = reviewReferenceCorrectionAttempt(reviewInput({ priorAttemptId: 'attempt-1-id' }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.attempt.priorAttemptId).toBe('attempt-1-id');
  });

  it('never mutates its inputs', () => {
    const input = reviewInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    reviewReferenceCorrectionAttempt(input);
    expect(input).toEqual(snapshot);
  });

  it('does not automatically approve anything - approvalEligible is a plain flag, never a side effect', () => {
    const result = reviewReferenceCorrectionAttempt(reviewInput());
    if (!result.ok) throw new Error('expected ok');
    expect(typeof result.attempt.approvalEligible).toBe('boolean');
    expect(result.attempt).not.toHaveProperty('approved');
    expect(result.attempt).not.toHaveProperty('supersedesBaselineId');
  });
});
