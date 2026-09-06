import { describe, expect, it } from 'vitest';
import { evaluateReferenceCandidateFidelity } from '../../src/domain/externalReferenceFidelity.js';
import { EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import type { ImportedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import type { ReferenceRegion } from '../../src/domain/externalReferenceRegions.js';
import type { ExternalReferenceApplicability } from '../../src/domain/externalReferenceApplicability.js';
import type { ExternalReferenceRequirement } from '../../src/domain/externalReferenceRequirements.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetEvidenceRecord, TargetGeometry, TargetResolution, TargetSelectionStatus } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';
import type { ReferenceRuntimeBindingDeclaration } from '../../src/domain/externalReferenceRuntimeBinding.js';

function region(id: string, x: number, y: number, width: number, height: number): ReferenceRegion {
  return { id, rectangle: { x, y, width, height } };
}

function reference(
  regions: ReferenceRegion[],
  requirements: ExternalReferenceRequirement[] = [],
  applicability?: ExternalReferenceApplicability,
  imageWidth = 960,
  imageHeight = 1240,
): ImportedExternalReferenceArtifact {
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: 'ref-req-1',
    referenceId: 'ref-req-1-instance-1',
    producer: { name: 'my-frontend-observer', version: '0.6.0' },
    provenance: { importedAt: '2026-01-01T00:00:00.000Z' },
    image: { path: 'reference.png', format: 'png', width: imageWidth, height: imageHeight, byteLength: 41, sha256: 'a'.repeat(64) },
    lifecycle: { state: 'imported' },
    diagnostics: [],
    completion: { state: 'complete' },
    ...(regions.length > 0 ? { regions } : {}),
    ...(requirements.length > 0 ? { requirements } : {}),
    ...(applicability !== undefined ? { applicability } : {}),
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
    style: { state: 'available', source: 'computed-browser', value: { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
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

function candidate(
  targets: NamedTarget[],
  targetEvidence: Record<string, TargetEvidenceRecord>,
  viewport: { width: number; height: number } = { width: 480, height: 620 },
): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: 'obs-1',
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
    screenshot: { state: 'not-applicable' },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [],
  };
}

function binding(referenceRegion: string, runtimeTarget: string): ReferenceRuntimeBindingDeclaration {
  return { referenceRegion, runtimeTarget };
}

function widthRequirement(region: string, amount: number): ExternalReferenceRequirement {
  return {
    requirementId: `req-${region}-width`,
    category: 'requested',
    subject: { kind: 'region-property', region, property: 'width' },
    tolerance: { kind: 'absolute-reference-px', amount },
  };
}

const fullViewport = { viewport: { width: 480, height: 620 } };

describe('evaluateReferenceCandidateFidelity', () => {
  // Behavior A: numeric width pass, with the exact worked example's 2x scale.
  it('A: a mapped candidate width within tolerance passes (2x reference scale)', () => {
    const cardRegion = region('current-page-card', 0, 0, 424, 100);
    const ref = reference([cardRegion], [widthRequirement('current-page-card', 4)], fullViewport);
    // 214 CSS px * scaleX(2) = 428 reference px; delta = 428 - 424 = 4 <= tolerance 4.
    const cand = candidate([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 214, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('current-page-card', 'popup-current-page')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.state).toBe('pass');
    expect(result.evaluation.requirementResults).toHaveLength(1);
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'pass', referenceValue: 424, candidateRawValue: 214, candidateValue: 428, delta: 4 });
  });

  // Behavior B: the exact worked example from the task spec - width mismatch fails with full structured evidence.
  it('B: a mapped candidate width outside tolerance fails, with reference/candidate/delta/tolerance exposed', () => {
    const cardRegion = region('current-page-card', 0, 0, 424, 100);
    const ref = reference([cardRegion], [widthRequirement('current-page-card', 4)], fullViewport);
    const cand = candidate([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord(geometry(0, 0, 223, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('current-page-card', 'popup-current-page')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.state).toBe('fail');
    expect(result.evaluation.requirementResults[0]).toMatchObject({
      status: 'fail',
      referenceValue: 424,
      candidateRawValue: 223,
      candidateValue: 446,
      delta: 22,
      tolerance: { kind: 'absolute-reference-px', amount: 4 },
    });
  });

  // Behavior C: exact tolerance boundary passes; one unit over fails.
  it('C: passes exactly at the tolerance boundary and fails just over it', () => {
    const cardRegion = region('card', 0, 0, 424, 100);
    const ref = reference([cardRegion], [widthRequirement('card', 4)], fullViewport);

    const atBoundary = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50)) }); // 214*2=428, delta=4
    const atResult = evaluateReferenceCandidateFidelity(ref, atBoundary, [binding('card', 't')]);
    if (!atResult.ok) throw new Error('expected ok');
    expect(atResult.evaluation.requirementResults[0]?.status).toBe('pass');

    const overBoundary = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214.00005, 50)) }); // 214.00005*2=428.0001
    const overResult = evaluateReferenceCandidateFidelity(ref, overBoundary, [binding('card', 't')]);
    if (!overResult.ok) throw new Error('expected ok');
    expect(overResult.evaluation.requirementResults[0]?.status).toBe('fail');
  });

  it('exact tolerance requires zero delta', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [{ requirementId: 'r1', category: 'requested', subject: { kind: 'region-property', region: 'card', property: 'width' }, tolerance: { kind: 'exact' } }], fullViewport);
    const exact = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 212, 50)) }); // 212*2=424
    const exactResult = evaluateReferenceCandidateFidelity(ref, exact, [binding('card', 't')]);
    if (!exactResult.ok) throw new Error('expected ok');
    expect(exactResult.evaluation.requirementResults[0]?.status).toBe('pass');

    const off = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 212.001, 50)) });
    const offResult = evaluateReferenceCandidateFidelity(ref, off, [binding('card', 't')]);
    if (!offResult.ok) throw new Error('expected ok');
    expect(offResult.evaluation.requirementResults[0]?.status).toBe('fail');
  });

  it('percent tolerance uses the reference value as its denominator', () => {
    // referenceValue=400, percent 5% => allowed 20 reference px.
    const ref = reference(
      [region('card', 0, 0, 400, 100)],
      [{ requirementId: 'r1', category: 'requested', subject: { kind: 'region-property', region: 'card', property: 'width' }, tolerance: { kind: 'percent', amount: 5 } }],
      fullViewport,
    );
    const within = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 210, 50)) }); // 210*2=420, delta=20 <= 20
    const withinResult = evaluateReferenceCandidateFidelity(ref, within, [binding('card', 't')]);
    if (!withinResult.ok) throw new Error('expected ok');
    expect(withinResult.evaluation.requirementResults[0]?.status).toBe('pass');

    const outside = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 210.001, 50)) });
    const outsideResult = evaluateReferenceCandidateFidelity(ref, outside, [binding('card', 't')]);
    if (!outsideResult.ok) throw new Error('expected ok');
    expect(outsideResult.evaluation.requirementResults[0]?.status).toBe('fail');
  });

  // Behavior D: 2x reference image scale mapping (the exact worked example numbers).
  it('D: correctly maps candidate CSS geometry into 2x reference-image coordinate space', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 100)], fullViewport, 960, 1240);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 223, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ candidateRawValue: 223, candidateValue: 446 });
  });

  // Behavior E: aspect-ratio mismatch between image and applicable viewport makes numeric requirements unavailable.
  it('E: an incoherent image/viewport aspect ratio makes numeric requirements unavailable, never a fabricated result', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 4)], { viewport: { width: 480, height: 600 } }, 960, 1240);
    // Candidate viewport must match the declared applicable viewport exactly, or Prompt 4 compatibility
    // (a separate concern from this coordinate-mapping validity check) blocks evaluation first.
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50)) }, { width: 480, height: 600 });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.state).not.toBe('not-evaluated');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'unavailable', reasonCode: 'coordinate-mapping-unavailable' });
  });

  // Behavior F: missing applicable viewport makes numeric requirements unavailable.
  it('F: a reference with no applicable viewport makes numeric requirements unavailable', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 4)]);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'unavailable', reasonCode: 'coordinate-mapping-unavailable' });
  });

  // Behavior G: compatibility blocker prevents any ordinary requirement result.
  it('G: an incompatible reference/candidate viewport blocks evaluation entirely - no ordinary requirement results', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 4)], fullViewport);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50)) }, { width: 375, height: 812 });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.state).toBe('not-evaluated');
    expect(result.evaluation.blockedBy).toBe('incompatible');
    expect(result.evaluation.requirementResults).toEqual([]);
    expect(result.evaluation.compatibility?.state).toBe('incomparable');
  });

  // Behavior H: reference-adequacy blocker (inadequate) prevents any ordinary fidelity result.
  it('H: an inadequate reference (zero selected requirements) never fabricates an ordinary fidelity result', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [], fullViewport);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.state).toBe('not-evaluated');
    expect(result.evaluation.blockedBy).toBe('reference-inadequate');
    expect(result.evaluation.requirementResults).toEqual([]);
    expect(result.evaluation.compatibility).toBeUndefined();
  });

  // U: zero requirements is the same inadequacy path, never a meaningless PASS.
  it('U: zero requirements never produces a meaningless PASS', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], []);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, []);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.state).not.toBe('pass');
    expect(result.evaluation.state).toBe('not-evaluated');
  });

  // Behavior I: a bound target with successful evaluation.
  it('I: a bound target participates in ordinary requirement evaluation', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 4)], fullViewport);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]?.status).toBe('pass');
    expect(result.evaluation.requirementResults[0]?.boundRuntimeTargets).toEqual(['t']);
  });

  // Behavior J: ambiguous binding makes the dependent requirement unavailable.
  it('J: an ambiguously resolved bound target makes the dependent requirement unavailable', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 4)], fullViewport);
    const cand = candidate([target('t')], { t: unresolvedTargetRecord('ambiguous') });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'unavailable', reasonCode: 'binding-unavailable' });
  });

  // Behavior K: unavailable binding makes the dependent requirement unavailable.
  it('K: an unresolved (not-found) bound target makes the dependent requirement unavailable', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 4)], fullViewport);
    const cand = candidate([target('t')], { t: unresolvedTargetRecord('not-found') });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'unavailable', reasonCode: 'binding-unavailable' });
  });

  it('a reference region with no declared binding at all is unavailable', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 4)], fullViewport);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, []);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'unavailable', reasonCode: 'binding-unavailable' });
  });

  // Behavior L: hidden bound target with no usable geometry.
  it('L: a hidden bound target (matched but not visible) makes the geometry requirement unavailable', () => {
    const ref = reference([region('card', 0, 0, 424, 100)], [widthRequirement('card', 4)], fullViewport);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 214, 50), false) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('card', 't')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'unavailable', reasonCode: 'candidate-evidence-unavailable' });
  });

  // Behaviors M/N/O: relationship pass, fail, and correct family-scoped lookup.
  const leftBox = region('left-box', 0, 0, 50, 50);
  const rightBox = region('right-box', 100, 0, 50, 50);
  function leftOfRequirement(): ExternalReferenceRequirement {
    return {
      requirementId: 'req-rel',
      category: 'requested',
      subject: { kind: 'region-relationship', subjectRegion: 'left-box', relatedRegion: 'right-box', relationship: 'left-of' },
    };
  }

  it('M: a relationship requirement passes when the candidate exhibits the same requested family member', () => {
    const ref = reference([leftBox, rightBox], [leftOfRequirement()], fullViewport);
    const cand = candidate(
      [target('t-left'), target('t-right')],
      { 't-left': matchedTargetRecord(geometry(0, 0, 50, 50)), 't-right': matchedTargetRecord(geometry(200, 0, 50, 50)) },
    );
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'pass', expectedRelationship: 'left-of', actualRelationship: 'left-of' });
  });

  it('N: a relationship requirement fails when the candidate exhibits a different member of the same family', () => {
    const ref = reference([leftBox, rightBox], [leftOfRequirement()], fullViewport);
    // Candidate reverses horizontal order: t-left is now to the right of t-right.
    const cand = candidate(
      [target('t-left'), target('t-right')],
      { 't-left': matchedTargetRecord(geometry(200, 0, 50, 50)), 't-right': matchedTargetRecord(geometry(0, 0, 50, 50)) },
    );
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'fail', expectedRelationship: 'left-of', actualRelationship: 'right-of' });
  });

  it('O: relationship lookup is scoped to the requested family, never the first arbitrary pair record', () => {
    // Two regions that are BOTH left-of AND do-not-overlap AND equal-width - multiple families produce records
    // for the same pair; the evaluator must pick the 'horizontal-order' family record for a 'left-of' requirement.
    const a = region('a', 0, 0, 50, 50);
    const b = region('b', 100, 0, 50, 50);
    const requirement: ExternalReferenceRequirement = {
      requirementId: 'req-rel-2',
      category: 'requested',
      subject: { kind: 'region-relationship', subjectRegion: 'a', relatedRegion: 'b', relationship: 'left-of' },
    };
    const ref = reference([a, b], [requirement], fullViewport);
    const cand = candidate([target('ta'), target('tb')], { ta: matchedTargetRecord(geometry(0, 0, 50, 50)), tb: matchedTargetRecord(geometry(200, 0, 50, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('a', 'ta'), binding('b', 'tb')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults[0]?.status).toBe('pass');
    expect(result.evaluation.requirementResults[0]?.actualRelationship).toBe('left-of');
  });

  it('a relationship the reference itself does not exhibit is unavailable, never fail', () => {
    // The reference geometry actually shows left-of, but the requirement (invalidly, for this test)
    // claims right-of - the reference does not exhibit its own selected relationship. A second,
    // evaluable requirement keeps reference adequacy 'partial' rather than 'inadequate' so this
    // requirement's own per-requirement result is reachable (an all-unavailable requirement set
    // would otherwise legitimately block the whole evaluation at the adequacy gate - see behavior H).
    const requirement: ExternalReferenceRequirement = {
      requirementId: 'req-rel-3',
      category: 'requested',
      subject: { kind: 'region-relationship', subjectRegion: 'left-box', relatedRegion: 'right-box', relationship: 'right-of' },
    };
    const ref = reference([leftBox, rightBox], [requirement, widthRequirement('left-box', 4)], fullViewport);
    const cand = candidate(
      [target('t-left'), target('t-right')],
      { 't-left': matchedTargetRecord(geometry(0, 0, 25, 50)), 't-right': matchedTargetRecord(geometry(200, 0, 50, 50)) },
    );
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.adequacy.status).toBe('partial');
    expect(result.evaluation.requirementResults[0]).toMatchObject({ status: 'unavailable', reasonCode: 'reference-relationship-not-exhibited' });
  });

  // Behavior P: numeric gap requirement (supported Prompt 3 measurement).
  it('P: a horizontal-gap measurement requirement passes/fails using the same coordinate mapping', () => {
    // reference gap: right-box.x(100) - left-box.right(50) = 50 reference px.
    const requirement: ExternalReferenceRequirement = {
      requirementId: 'req-gap',
      category: 'requested',
      subject: { kind: 'region-measurement', subjectRegion: 'left-box', relatedRegion: 'right-box', measurement: 'horizontal-gap' },
      tolerance: { kind: 'absolute-reference-px', amount: 2 },
    };
    const ref = reference([leftBox, rightBox], [requirement], fullViewport);
    // Candidate gap: 175 - 50 = 25 CSS px * scaleX(2) = 50 reference px -> pass.
    const passCand = candidate([target('t-left'), target('t-right')], { 't-left': matchedTargetRecord(geometry(0, 0, 50, 50)), 't-right': matchedTargetRecord(geometry(75, 0, 50, 50)) });
    const passResult = evaluateReferenceCandidateFidelity(ref, passCand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    if (!passResult.ok) throw new Error('expected ok');
    expect(passResult.evaluation.requirementResults[0]).toMatchObject({ status: 'pass', referenceValue: 50, candidateValue: 50 });

    // Candidate gap: 100 CSS px * 2 = 200 reference px -> fails (delta 150 > tolerance 2).
    const failCand = candidate([target('t-left'), target('t-right')], { 't-left': matchedTargetRecord(geometry(0, 0, 50, 50)), 't-right': matchedTargetRecord(geometry(150, 0, 50, 50)) });
    const failResult = evaluateReferenceCandidateFidelity(ref, failCand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    if (!failResult.ok) throw new Error('expected ok');
    expect(failResult.evaluation.requirementResults[0]?.status).toBe('fail');
  });

  // Behavior Q/R/T: multiple requirements, deterministic ordering, one-fail overall, all-pass overall.
  it('Q/T: multiple requirements produce deterministic individual results and an overall PASS when all pass', () => {
    const ref = reference([leftBox, rightBox], [widthRequirement('left-box', 4), widthRequirement('right-box', 4)], fullViewport);
    const cand = candidate([target('t-left'), target('t-right')], { 't-left': matchedTargetRecord(geometry(0, 0, 25, 50)), 't-right': matchedTargetRecord(geometry(100, 0, 25, 50)) });
    const first = evaluateReferenceCandidateFidelity(ref, cand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    const second = evaluateReferenceCandidateFidelity(ref, cand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    if (!first.ok || !second.ok) throw new Error('expected ok');
    expect(first).toEqual(second);
    expect(first.evaluation.state).toBe('pass');
    expect(first.evaluation.requirementResults.map((r) => r.requirementId)).toEqual(['req-left-box-width', 'req-right-box-width']);
  });

  it('R: one failing requirement forces overall reference-fidelity FAIL', () => {
    const ref = reference([leftBox, rightBox], [widthRequirement('left-box', 4), widthRequirement('right-box', 4)], fullViewport);
    const cand = candidate([target('t-left'), target('t-right')], { 't-left': matchedTargetRecord(geometry(0, 0, 25, 50)), 't-right': matchedTargetRecord(geometry(100, 0, 999, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.state).toBe('fail');
  });

  // S: one unavailable requirement prevents overall PASS.
  it('S: one unavailable requirement prevents overall PASS', () => {
    const ref = reference([leftBox, rightBox], [widthRequirement('left-box', 4), widthRequirement('right-box', 4)], fullViewport);
    const cand = candidate([target('t-left')], { 't-left': matchedTargetRecord(geometry(0, 0, 25, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('left-box', 't-left')]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.requirementResults.some((r) => r.status === 'unavailable')).toBe(true);
    expect(result.evaluation.state).not.toBe('pass');
  });

  // V: input immutability.
  it('V: never mutates the reference, candidate, or binding-declaration inputs', () => {
    const ref = reference([leftBox, rightBox], [widthRequirement('left-box', 4)], fullViewport);
    const cand = candidate([target('t-left')], { 't-left': matchedTargetRecord(geometry(0, 0, 25, 50)) });
    const declarations = [binding('left-box', 't-left')];
    const refSnapshot = JSON.parse(JSON.stringify(ref));
    const candSnapshot = JSON.parse(JSON.stringify(cand));
    const declSnapshot = JSON.parse(JSON.stringify(declarations));

    evaluateReferenceCandidateFidelity(ref, cand, declarations);

    expect(ref).toEqual(refSnapshot);
    expect(cand).toEqual(candSnapshot);
    expect(declarations).toEqual(declSnapshot);
  });

  it('fails closed for a structurally invalid reference or candidate artifact', () => {
    const ref = reference([leftBox], [widthRequirement('left-box', 4)], fullViewport);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 25, 50)) });

    const badRef = { ...ref, schemaVersion: '2.0.0' } as unknown as ImportedExternalReferenceArtifact;
    expect(evaluateReferenceCandidateFidelity(badRef, cand, [binding('left-box', 't')]).ok).toBe(false);

    const badCand = { ...cand, schemaVersion: '9.9.9' } as unknown as ObservationArtifact;
    expect(evaluateReferenceCandidateFidelity(ref, badCand, [binding('left-box', 't')]).ok).toBe(false);
  });

  it('fails closed for a structurally invalid binding declaration collection', () => {
    const ref = reference([leftBox], [widthRequirement('left-box', 4)], fullViewport);
    const cand = candidate([target('t')], { t: matchedTargetRecord(geometry(0, 0, 25, 50)) });
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('does-not-exist', 't')]);
    expect(result.ok).toBe(false);
  });

  it('does not produce any source-ownership field on its result', () => {
    const ref = reference([leftBox, rightBox], [widthRequirement('left-box', 4), leftOfRequirement()], fullViewport);
    const cand = candidate(
      [target('t-left'), target('t-right')],
      { 't-left': matchedTargetRecord(geometry(0, 0, 25, 50)), 't-right': matchedTargetRecord(geometry(200, 0, 50, 50)) },
    );
    const result = evaluateReferenceCandidateFidelity(ref, cand, [binding('left-box', 't-left'), binding('right-box', 't-right')]);
    if (!result.ok) throw new Error('expected ok');
    const serialized = JSON.stringify(result.evaluation);
    for (const forbidden of ['sourceOwner', 'sourceFile', 'component', 'symbol', 'causedBy']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('W: performs no browser/filesystem import - domain module source contains none', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../src/domain/externalReferenceFidelity.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]playwright['"]/);
    expect(source).not.toMatch(/from ['"]node:fs/);
  });
});
