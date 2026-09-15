import { describe, expect, it } from 'vitest';
import {
  CHECK_MAX_ITEMS_PER_COLLECTION,
  CHECK_MAX_SUPPORTING_EVIDENCE_PER_ITEM,
  CHECK_RESULT_SCHEMA_VERSION,
  emptyCheckResult,
  finalizeCheckStatus,
  projectContractResult,
  projectReferenceResult,
} from '../../src/projectWorkflow/checkResult.js';
import type { FrontendContractEvaluationArtifact } from '../../src/domain/frontendContractEvaluationArtifact.js';
import type { ReferenceCandidateFidelityEvaluation, ReferenceRequirementFidelityResult } from '../../src/domain/externalReferenceFidelity.js';

const evidence = (count: number) => Array.from({ length: count }, (_, index) => ({ path: `targetEvidence.item${index}.geometry` }));

describe('bounded check projection', () => {
  it('preserves canonical failed clause semantics and enforces both bounds', () => {
    const clauses = Array.from({ length: 52 }, (_, index) => ({
      clauseId: `protected-${index}`,
      category: 'protected' as const,
      primitive: { kind: 'target-visible' as const, target: `target-${index}` },
      supportingEvidence: [],
    }));
    const artifact = {
      overallVerdict: 'FAIL', evaluationId: 'evaluation',
      clauseResults: clauses.map((clause) => ({ clauseId: clause.clauseId, status: 'fail' as const, supportingEvidence: evidence(12) })),
      unexpectedChanges: [],
    } as unknown as FrontendContractEvaluationArtifact;
    const result = projectContractResult(artifact, [], clauses, '.frontend-observer/evidence/evaluations/a');
    expect(result.state).toBe('FAIL');
    expect(result.failedClauses).toHaveLength(CHECK_MAX_ITEMS_PER_COLLECTION);
    expect(result.failedClauses[0]).toMatchObject({ clauseId: 'protected-0', source: 'change', category: 'protected', primitive: { kind: 'target-visible' }, status: 'fail' });
    expect(result.failedClauses[0]?.supportingEvidence).toHaveLength(CHECK_MAX_SUPPORTING_EVIDENCE_PER_ITEM);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain('screenshot.png');
  });

  it('projects unavailable/conflicting contract evidence as BLOCKED with reasons', () => {
    const clauses = [{ clauseId: 'preserved-nav', primitive: { kind: 'target-not-clipped' as const, target: 'nav' }, supportingEvidence: [] }];
    const artifact = {
      overallVerdict: 'FAIL', evaluationId: 'evaluation', unexpectedChanges: [],
      clauseResults: [{ clauseId: 'preserved-nav', status: 'unavailable', reason: 'geometry unavailable', supportingEvidence: evidence(1) }],
    } as unknown as FrontendContractEvaluationArtifact;
    const result = projectContractResult(artifact, clauses, [], 'relative/evaluation');
    expect(result.state).toBe('BLOCKED');
    expect(result.unavailableClauses[0]).toMatchObject({ source: 'baseline', status: 'unavailable', reason: 'geometry unavailable' });
  });

  it('bounds canonical failed and unavailable reference requirements', () => {
    const requirement = (index: number, status: 'fail' | 'unavailable'): ReferenceRequirementFidelityResult => ({
      requirementId: `requirement-${index}`,
      category: 'protected',
      subject: { kind: 'region-property', regionId: 'header', property: 'width' },
      boundRuntimeTargets: ['header'],
      status,
      ...(status === 'unavailable' ? { reasonCode: 'candidate-evidence-unavailable', detail: 'candidate width unavailable' } : {}),
    });
    const evaluation = {
      referenceId: 'reference', referenceRequestId: 'request', candidateObservationId: 'candidate', candidateRequestId: 'candidate-request',
      adequacy: { state: 'adequate', requirementResults: [] }, state: 'fail',
      requirementResults: [...Array.from({ length: 52 }, (_, index) => requirement(index, 'fail')), ...Array.from({ length: 51 }, (_, index) => requirement(index + 100, 'unavailable'))],
    } as unknown as ReferenceCandidateFidelityEvaluation;
    const result = projectReferenceResult(evaluation);
    expect(result.state).toBe('BLOCKED');
    expect(result.failedRequirements).toHaveLength(50);
    expect(result.unavailableRequirements).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it('applies BLOCKED, FAIL, PASS, REVIEW_REQUIRED precedence exactly', () => {
    const review = emptyCheckResult(); review.status = 'PASS'; expect(finalizeCheckStatus(review).status).toBe('REVIEW_REQUIRED');
    const pass = emptyCheckResult(); pass.contract = { ...pass.contract, configured: true, state: 'PASS' }; expect(finalizeCheckStatus(pass).status).toBe('PASS');
    const fail = emptyCheckResult(); fail.contract = { ...fail.contract, configured: true, state: 'FAIL' }; expect(finalizeCheckStatus(fail).status).toBe('FAIL');
    const blocked = emptyCheckResult(); blocked.contract = { ...blocked.contract, configured: true, state: 'FAIL' }; blocked.blockers.push({ code: 'comparison-incomparable', message: 'blocked' }); expect(finalizeCheckStatus(blocked).status).toBe('BLOCKED');
    expect(blocked.schemaVersion).toBe(CHECK_RESULT_SCHEMA_VERSION);
  });
});
