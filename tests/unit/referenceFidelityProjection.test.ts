import { describe, expect, it } from 'vitest';
import { projectReferenceFidelity } from '../../src/domain/referenceFidelityProjection.js';
import { MAX_FIDELITY_MISMATCHES, MAX_FIDELITY_PROTECTED_CONTEXT } from '../../src/domain/boundedAgentContext.js';
import type { ReferenceCandidateFidelityEvaluation, ReferenceRequirementFidelityResult } from '../../src/domain/externalReferenceFidelity.js';
import type { AuthoredChangeScopeCategory, ExpectedDependentMode } from '../../src/domain/externalReferenceRequirements.js';

function requirementResult(overrides: Partial<ReferenceRequirementFidelityResult> & { requirementId: string }): ReferenceRequirementFidelityResult {
  return {
    category: 'requested',
    subject: { kind: 'region-property', region: 'card', property: 'width' },
    boundRuntimeTargets: ['popup-card'],
    status: 'pass',
    ...overrides,
  };
}

function fidelity(requirementResults: ReferenceRequirementFidelityResult[], state: 'pass' | 'fail' = requirementResults.every((r) => r.status === 'pass') ? 'pass' : 'fail'): ReferenceCandidateFidelityEvaluation {
  return {
    referenceId: 'ref-1',
    referenceRequestId: 'ref-req-1',
    candidateObservationId: 'obs-1',
    candidateRequestId: 'req-1',
    adequacy: { status: 'adequate', totalRequirements: requirementResults.length, evaluableRequirements: requirementResults.length, unavailableRequirements: 0, reasons: [] },
    compatibility: { state: 'comparable', reasons: [] },
    state,
    requirementResults,
  };
}

function notEvaluatedFidelity(blockedBy: 'reference-inadequate' | 'incompatible'): ReferenceCandidateFidelityEvaluation {
  return {
    referenceId: 'ref-1',
    referenceRequestId: 'ref-req-1',
    candidateObservationId: 'obs-1',
    candidateRequestId: 'req-1',
    adequacy: { status: 'inadequate', totalRequirements: 0, evaluableRequirements: 0, unavailableRequirements: 0, reasons: [{ code: 'no-selected-requirements' }] },
    state: 'not-evaluated',
    blockedBy,
    requirementResults: [],
  };
}

function fail(requirementId: string, category: AuthoredChangeScopeCategory = 'requested', expectedDependentMode?: ExpectedDependentMode, targets: string[] = ['t']): ReferenceRequirementFidelityResult {
  return requirementResult({
    requirementId,
    category,
    ...(expectedDependentMode !== undefined ? { expectedDependentMode } : {}),
    boundRuntimeTargets: targets,
    status: 'fail',
    referenceValue: 100,
    candidateValue: 120,
    delta: 20,
    tolerance: { kind: 'absolute-reference-px', amount: 4 },
  });
}

function unavailable(requirementId: string, category: AuthoredChangeScopeCategory = 'requested', targets: string[] = []): ReferenceRequirementFidelityResult {
  return requirementResult({ requirementId, category, boundRuntimeTargets: targets, status: 'unavailable', reasonCode: 'binding-unavailable', detail: 'no binding' });
}

function pass(requirementId: string, category: AuthoredChangeScopeCategory = 'requested', targets: string[] = ['t']): ReferenceRequirementFidelityResult {
  return requirementResult({ requirementId, category, boundRuntimeTargets: targets, status: 'pass' });
}

describe('projectReferenceFidelity', () => {
  // A: one failure.
  it('A: one failed requirement produces one bounded actionable mismatch', () => {
    const output = projectReferenceFidelity(fidelity([fail('r1', 'protected')]));
    expect(output.projection.mismatches).toHaveLength(1);
    expect(output.projection.mismatches[0]?.requirementId).toBe('r1');
    expect(output.projection.state).toBe('fail');
    expect(output.requiredTargetIds).toEqual(['t']);
  });

  // B: many failures under the limit.
  it('B: several failures under the cap are all retained in deterministic order', () => {
    const results = [fail('r1', 'protected'), fail('r2', 'protected'), pass('r3')];
    const output = projectReferenceFidelity(fidelity(results));
    expect(output.projection.mismatches.map((m) => m.requirementId)).toEqual(['r1', 'r2']);
  });

  // C: failures over the limit - required prioritized, truncation explicit.
  it('C: failures over the cap prioritize required-tier ones and record explicit truncation', () => {
    const requiredFails = Array.from({ length: MAX_FIDELITY_MISMATCHES }, (_, i) => fail(`req-${i}`, 'protected'));
    const optionalFail = fail('optional-fail', 'requested');
    const output = projectReferenceFidelity(fidelity([optionalFail, ...requiredFails]));
    expect(output.projection.mismatches).toHaveLength(MAX_FIDELITY_MISMATCHES);
    // All required (protected) fails survive; the optional one is dropped.
    expect(output.projection.mismatches.every((m) => m.category === 'protected')).toBe(true);
    expect(output.projection.mismatches.some((m) => m.requirementId === 'optional-fail')).toBe(false);
    const truncation = output.truncations.find((t) => t.subject === 'fidelity-mismatches');
    expect(truncation).toBeDefined();
    expect(truncation).toMatchObject({ limit: MAX_FIDELITY_MISMATCHES, actualCount: MAX_FIDELITY_MISMATCHES + 1, required: false });
  });

  it('failed-before-unavailable priority: required fails outrank required unavailable, which outrank optional non-pass', () => {
    const results = [unavailable('u1', 'protected', ['t1']), fail('f1', 'requested', undefined, ['t2']), fail('f2', 'protected', undefined, ['t3'])];
    const output = projectReferenceFidelity(fidelity(results));
    expect(output.projection.mismatches.map((m) => m.requirementId)).toEqual(['f2', 'u1', 'f1']);
  });

  it('a required omission is recorded for each required-tier mismatch dropped by the cap', () => {
    const requiredFails = Array.from({ length: MAX_FIDELITY_MISMATCHES + 2 }, (_, i) => fail(`req-${i}`, 'protected'));
    const output = projectReferenceFidelity(fidelity(requiredFails));
    const droppedOmissions = output.omissions.filter((o) => o.subject.startsWith('fidelity-mismatch:'));
    expect(droppedOmissions).toHaveLength(2);
    expect(droppedOmissions.every((o) => o.required)).toBe(true);
    const truncation = output.truncations.find((t) => t.subject === 'fidelity-mismatches');
    expect(truncation?.required).toBe(true);
  });

  // D: passing requirements not dumped by default.
  it('D: passing requested requirements are omitted from mismatches entirely', () => {
    const output = projectReferenceFidelity(fidelity([pass('p1'), pass('p2')]));
    expect(output.projection.mismatches).toEqual([]);
  });

  // E: fidelity pass - compact, no mismatch list.
  it('E: an overall passing fidelity produces an empty mismatch list', () => {
    const output = projectReferenceFidelity(fidelity([pass('p1'), pass('p2', 'protected')]));
    expect(output.projection.state).toBe('pass');
    expect(output.projection.mismatches).toEqual([]);
    // Passing protected requirement surfaces as context, not a mismatch.
    expect(output.projection.protectedContext.map((r) => r.requirementId)).toEqual(['p2']);
  });

  // F: fidelity not-evaluated - blocker preserved, adequacy not falsely reported.
  it('F: a not-evaluated fidelity preserves the blocker and records a required omission by default', () => {
    const output = projectReferenceFidelity(notEvaluatedFidelity('incompatible'));
    expect(output.projection.state).toBe('not-evaluated');
    expect(output.projection.blockedBy).toBe('incompatible');
    expect(output.projection.mismatches).toEqual([]);
    expect(output.projection.protectedContext).toEqual([]);
    expect(output.omissions).toEqual([{ subject: 'fidelity', reason: 'unsupported-or-unavailable', required: true, detail: 'reference fidelity could not be evaluated (blockedBy: incompatible)' }]);
  });

  it('a not-evaluated fidelity with required:false records only an optional omission', () => {
    const output = projectReferenceFidelity(notEvaluatedFidelity('reference-inadequate'), { required: false });
    expect(output.omissions[0]?.required).toBe(false);
  });

  // G: failed requirement + bound runtime target - identity preserved.
  it('G: a failed requirement preserves its bound runtime target identity', () => {
    const output = projectReferenceFidelity(fidelity([fail('r1', 'protected', undefined, ['popup-card'])]));
    expect(output.projection.mismatches[0]?.boundRuntimeTargets).toEqual(['popup-card']);
    expect(output.requiredTargetIds).toEqual(['popup-card']);
  });

  // H: relationship failure with two targets - both runtime identities preserved.
  it('H: a relationship failure with two bound targets preserves both runtime target identities', () => {
    const relationshipFail = requirementResult({
      requirementId: 'rel-1',
      category: 'protected',
      subject: { kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'card', relationship: 'above' },
      boundRuntimeTargets: ['popup-header', 'popup-card'],
      status: 'fail',
      expectedRelationship: 'above',
      actualRelationship: 'below',
    });
    const output = projectReferenceFidelity(fidelity([relationshipFail]));
    expect(output.projection.mismatches[0]?.boundRuntimeTargets).toEqual(['popup-header', 'popup-card']);
    expect(output.requiredTargetIds).toEqual(['popup-header', 'popup-card']);
  });

  // Protected/preserved context: passing constraints surfaced separately, disjoint from mismatches.
  it('protected/preserved passing requirements are surfaced as context, disjoint from mismatches', () => {
    const output = projectReferenceFidelity(fidelity([pass('p1', 'protected'), pass('p2', 'preserved'), fail('f1', 'protected')]));
    expect(output.projection.mismatches.map((m) => m.requirementId)).toEqual(['f1']);
    expect(output.projection.protectedContext.map((r) => r.requirementId)).toEqual(['p1', 'p2']);
  });

  it('protectedContext is bounded and truncation is recorded, but never marked required', () => {
    const passes = Array.from({ length: MAX_FIDELITY_PROTECTED_CONTEXT + 3 }, (_, i) => pass(`p${i}`, 'protected'));
    const output = projectReferenceFidelity(fidelity(passes));
    expect(output.projection.protectedContext).toHaveLength(MAX_FIDELITY_PROTECTED_CONTEXT);
    const truncation = output.truncations.find((t) => t.subject === 'fidelity-protected-context');
    expect(truncation).toMatchObject({ limit: MAX_FIDELITY_PROTECTED_CONTEXT, actualCount: MAX_FIDELITY_PROTECTED_CONTEXT + 3, required: false });
  });

  // expected-dependent required/permitted tiering, reused from v0.6's own clauseTier rule.
  it('expected-dependent/required is treated as required tier; expected-dependent/permitted is optional tier', () => {
    const requiredDependent = fail('r1', 'expected-dependent', 'required', ['t1']);
    const permittedDependent = fail('r2', 'expected-dependent', 'permitted', ['t2']);
    const output = projectReferenceFidelity(fidelity([requiredDependent, permittedDependent]));
    expect(output.requiredTargetIds).toEqual(['t1']);
    expect(output.permittedTargetIds).toEqual(['t2']);
  });

  it('O: deterministic output - same input produces the same result', () => {
    const input = fidelity([fail('r1', 'protected'), unavailable('r2'), pass('r3')]);
    const first = projectReferenceFidelity(input);
    const second = projectReferenceFidelity(input);
    expect(first).toEqual(second);
  });

  it('N: never mutates its input fidelity evaluation', () => {
    const input = fidelity([fail('r1', 'protected'), pass('r2', 'preserved')]);
    const snapshot = JSON.parse(JSON.stringify(input));
    projectReferenceFidelity(input);
    expect(input).toEqual(snapshot);
  });

});
