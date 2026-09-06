import { describe, expect, it } from 'vitest';
import {
  BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
  BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
  MAX_RUNTIME_TARGETS,
  MAX_RELATIONSHIP_EVIDENCE_PER_TARGET,
  MAX_OMISSIONS,
  MAX_TRUNCATIONS,
  MAX_CORRELATION_RECORDS,
  MAX_STATIC_CANDIDATES_PER_TARGET,
  MAX_TEXT_SUMMARY_CHARS,
  MAX_FIDELITY_MISMATCHES,
  MAX_FIDELITY_PROTECTED_CONTEXT,
  isValidBoundedAgentContextArtifact,
  isValidBoundedReferenceFidelityProjection,
  type BoundedAgentContextArtifact,
  type BoundedRuntimeTargetProjection,
  type RuntimeStaticCorrelationRecord,
  type BoundedReferenceFidelityProjection,
} from '../../src/domain/boundedAgentContext.js';
import type { ReferenceRequirementFidelityResult } from '../../src/domain/externalReferenceFidelity.js';
import { PRODUCER_NAME } from '../../src/domain/schema.js';

function baseArtifact(overrides: Partial<BoundedAgentContextArtifact> = {}): BoundedAgentContextArtifact {
  return {
    artifactKind: BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
    schemaVersion: BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
    contextId: 'ctx-1',
    contextRequestId: 'ctx-req-1',
    producer: { name: PRODUCER_NAME, version: '0.5.0' },
    provenance: { generatedAt: '2026-08-14T00:00:00.000Z' },
    projectionProfile: 'frontend-change-review',
    sources: { observationIds: ['obs-1'] },
    targets: [],
    adequacy: { state: 'inadequate', reasons: [{ code: 'required-runtime-target-unavailable' }] },
    omissions: [],
    truncations: [],
    ...overrides,
  };
}

function targetProjection(overrides: Partial<BoundedRuntimeTargetProjection> = {}): BoundedRuntimeTargetProjection {
  return { targetId: 'target-1', ...overrides };
}

function correlationRecord(overrides: Partial<RuntimeStaticCorrelationRecord> = {}): RuntimeStaticCorrelationRecord {
  return {
    runtimeTargetId: 'target-1',
    runtimeEvidenceRefs: [],
    staticProducer: { name: 'my-dev-kit', version: '1.12.2', indexId: 'idx-1' },
    status: 'unavailable',
    candidates: [],
    provenance: { correlatedAt: '2026-08-14T00:00:00.000Z' },
    ...overrides,
  };
}

describe('isValidBoundedAgentContextArtifact', () => {
  it('accepts a minimal structurally-valid artifact (TST-001)', () => {
    expect(isValidBoundedAgentContextArtifact(baseArtifact())).toEqual({ valid: true });
  });

  it('rejects a wrong artifactKind (TST-002)', () => {
    const result = isValidBoundedAgentContextArtifact({ ...baseArtifact(), artifactKind: 'wrong-kind' });
    expect(result.valid).toBe(false);
  });

  it('rejects a mismatched schemaVersion, including a plausible-looking one (TST-003)', () => {
    const result = isValidBoundedAgentContextArtifact({ ...baseArtifact(), schemaVersion: '1.0.1' });
    expect(result.valid).toBe(false);
  });

  it('accepts runtimeTargets exactly at MAX_RUNTIME_TARGETS and rejects one over (TST-004)', () => {
    const atLimit = Array.from({ length: MAX_RUNTIME_TARGETS }, (_, i) => targetProjection({ targetId: `t-${i}` }));
    expect(isValidBoundedAgentContextArtifact(baseArtifact({ targets: atLimit })).valid).toBe(true);

    const overLimit = Array.from({ length: MAX_RUNTIME_TARGETS + 1 }, (_, i) => targetProjection({ targetId: `t-${i}` }));
    expect(isValidBoundedAgentContextArtifact(baseArtifact({ targets: overLimit })).valid).toBe(false);
  });

  it('rejects relationshipEvidence exceeding MAX_RELATIONSHIP_EVIDENCE_PER_TARGET (TST-005)', () => {
    const evidence = Array.from({ length: MAX_RELATIONSHIP_EVIDENCE_PER_TARGET + 1 }, (_, i) => ({ path: `evidence-${i}` }));
    const artifact = baseArtifact({ targets: [targetProjection({ relationshipEvidence: evidence })] });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });

  it('rejects omissions exceeding MAX_OMISSIONS (TST-006)', () => {
    const omissions = Array.from({ length: MAX_OMISSIONS + 1 }, () => ({ subject: 's', reason: 'not-observed' as const, required: false }));
    expect(isValidBoundedAgentContextArtifact(baseArtifact({ omissions })).valid).toBe(false);
  });

  it('rejects truncations exceeding MAX_TRUNCATIONS (TST-007)', () => {
    const truncations = Array.from({ length: MAX_TRUNCATIONS + 1 }, () => ({ subject: 's', limit: 1, actualCount: 2, required: false }));
    expect(isValidBoundedAgentContextArtifact(baseArtifact({ truncations })).valid).toBe(false);
  });

  it('rejects correlations exceeding MAX_CORRELATION_RECORDS (TST-008)', () => {
    const correlations = Array.from({ length: MAX_CORRELATION_RECORDS + 1 }, (_, i) => correlationRecord({ runtimeTargetId: `t-${i}` }));
    expect(isValidBoundedAgentContextArtifact(baseArtifact({ correlations })).valid).toBe(false);
  });

  it('rejects staticCandidates would exceed MAX_STATIC_CANDIDATES_PER_TARGET on a correlation record (TST-009)', () => {
    const candidates = Array.from({ length: MAX_STATIC_CANDIDATES_PER_TARGET + 2 }, (_, i) => ({
      candidateId: `file:src/x${i}.ts`,
      kind: 'file' as const,
      evidenceRefs: [],
    }));
    const artifact = baseArtifact({ correlations: [correlationRecord({ status: 'ambiguous', candidates })] });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });

  it('accepts evidenceBasis exactly at MAX_TEXT_SUMMARY_CHARS and rejects one over (TST-010)', () => {
    const atLimit = 'a'.repeat(MAX_TEXT_SUMMARY_CHARS);
    const overLimit = 'a'.repeat(MAX_TEXT_SUMMARY_CHARS + 1);
    expect(isValidBoundedAgentContextArtifact(baseArtifact({ correlations: [correlationRecord({ evidenceBasis: atLimit })] })).valid).toBe(true);
    expect(isValidBoundedAgentContextArtifact(baseArtifact({ correlations: [correlationRecord({ evidenceBasis: overLimit })] })).valid).toBe(false);
  });

  it('rejects a non-adequate adequacy state with zero reasons (TST-011)', () => {
    const artifact = baseArtifact({ adequacy: { state: 'partial', reasons: [] } });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });

  it('rejects an unknown adequacy reason code (TST-012)', () => {
    const artifact = baseArtifact({ adequacy: { state: 'partial', reasons: [{ code: 'not-a-real-code' as never }] } });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });

  it('rejects correlated status with 0 or 2 candidates (TST-013)', () => {
    const zero = baseArtifact({ correlations: [correlationRecord({ status: 'correlated', candidates: [] })] });
    expect(isValidBoundedAgentContextArtifact(zero).valid).toBe(false);

    const two = baseArtifact({
      correlations: [
        correlationRecord({
          status: 'correlated',
          candidates: [
            { candidateId: 'file:a.ts', kind: 'file', evidenceRefs: [] },
            { candidateId: 'file:b.ts', kind: 'file', evidenceRefs: [] },
          ],
        }),
      ],
    });
    expect(isValidBoundedAgentContextArtifact(two).valid).toBe(false);
  });

  it('rejects ambiguous status with fewer than 2 candidates (TST-014)', () => {
    const artifact = baseArtifact({
      correlations: [correlationRecord({ status: 'ambiguous', candidates: [{ candidateId: 'file:a.ts', kind: 'file', evidenceRefs: [] }] })],
    });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });

  it('rejects unavailable status with a nonzero candidate count (TST-015)', () => {
    const artifact = baseArtifact({
      correlations: [correlationRecord({ status: 'unavailable', candidates: [{ candidateId: 'file:a.ts', kind: 'file', evidenceRefs: [] }] })],
    });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });

  it('accepts correlated/ambiguous/unavailable when candidate counts correctly match (TST-016)', () => {
    const artifact = baseArtifact({
      correlations: [
        correlationRecord({ runtimeTargetId: 't-a', status: 'correlated', candidates: [{ candidateId: 'file:a.ts', kind: 'file', evidenceRefs: [] }] }),
        correlationRecord({
          runtimeTargetId: 't-b',
          status: 'ambiguous',
          candidates: [
            { candidateId: 'file:b.ts', kind: 'file', evidenceRefs: [] },
            { candidateId: 'symbol:b.ts#B', kind: 'symbol', evidenceRefs: [] },
          ],
        }),
        correlationRecord({ runtimeTargetId: 't-c', status: 'unavailable', candidates: [] }),
      ],
    });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(true);
  });

  it('accepts an artifact with an ad-hoc extra owner-like property (structurally ignored) (TST-017)', () => {
    const record = { ...correlationRecord(), owner: 'someModule' } as RuntimeStaticCorrelationRecord & { owner: string };
    const artifact = baseArtifact({ correlations: [record] });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(true);
    // Type-level: RuntimeStaticCorrelationRecord has no declared `owner` field.
    // @ts-expect-error -- owner is not part of the declared type
    const _typeCheck: RuntimeStaticCorrelationRecord = { ...correlationRecord(), owner: 'x' };
    void _typeCheck;
  });

  it('rejects a raw string screenshotRef instead of an ArtifactReference object (TST-018)', () => {
    const artifact = baseArtifact({ targets: [targetProjection({ screenshotRef: 'data:image/png;base64,AAAA' as never })] });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });

  it('rejects a candidateId prefix mismatched with kind (TST-019)', () => {
    const artifact = baseArtifact({
      correlations: [correlationRecord({ status: 'correlated', candidates: [{ candidateId: 'symbol:foo.ts#bar', kind: 'file', evidenceRefs: [] }] })],
    });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });

  it('preserves a well-formed candidateId verbatim (TST-020)', () => {
    const candidateId = 'file:src/domain/foo.ts';
    const artifact = baseArtifact({
      correlations: [correlationRecord({ status: 'correlated', candidates: [{ candidateId, kind: 'file', evidenceRefs: [] }] })],
    });
    const result = isValidBoundedAgentContextArtifact(artifact);
    expect(result.valid).toBe(true);
    expect(artifact.correlations?.[0]?.candidates[0]?.candidateId).toBe(candidateId);
  });

  it('is not affected by an unrelated operational path (identity has no path field to accept one) (TST-021)', () => {
    const a = isValidBoundedAgentContextArtifact(baseArtifact());
    const b = isValidBoundedAgentContextArtifact(baseArtifact());
    expect(a).toEqual(b);
  });

  it('accepts the artifact when correlations is entirely absent (TST-025)', () => {
    const withCorrelations = baseArtifact({
      targets: [targetProjection()],
      adequacy: { state: 'adequate', reasons: [] },
    });
    const withoutCorrelations: Record<string, unknown> = { ...withCorrelations };
    delete withoutCorrelations.correlations;
    expect(isValidBoundedAgentContextArtifact(withoutCorrelations).valid).toBe(true);
  });

  it('allows an empty runtimeTargets array combined with adequacy.state="adequate" (TST-026)', () => {
    const artifact = baseArtifact({ targets: [], adequacy: { state: 'adequate', reasons: [] } });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(true);
  });

  it('returns a descriptive reason string (never throws) for several malformed inputs (TST-027)', () => {
    const cases: unknown[] = [
      { ...baseArtifact(), producer: undefined },
      { ...baseArtifact(), provenance: undefined },
      { ...baseArtifact(), producer: { name: 'someone-else', version: '1' } },
    ];
    for (const candidate of cases) {
      const result = isValidBoundedAgentContextArtifact(candidate);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });

  // v0.7 Prompt 7 additions --------------------------------------------------

  function fidelityProjection(overrides: Partial<BoundedReferenceFidelityProjection> = {}): BoundedReferenceFidelityProjection {
    return {
      referenceId: 'ref-1',
      referenceRequestId: 'ref-req-1',
      candidateObservationId: 'obs-1',
      candidateRequestId: 'req-1',
      adequacy: { status: 'adequate', totalRequirements: 1, evaluableRequirements: 1, unavailableRequirements: 0, reasons: [] },
      state: 'pass',
      mismatches: [],
      protectedContext: [],
      ...overrides,
    };
  }

  it('accepts an artifact without a fidelity field at all (backward compatible)', () => {
    expect('fidelity' in baseArtifact()).toBe(false);
    expect(isValidBoundedAgentContextArtifact(baseArtifact())).toEqual({ valid: true });
  });

  it('accepts an artifact with a valid fidelity field', () => {
    const artifact = baseArtifact({ adequacy: { state: 'adequate', reasons: [] }, fidelity: fidelityProjection() });
    expect(isValidBoundedAgentContextArtifact(artifact)).toEqual({ valid: true });
  });

  it('accepts sources.referenceId/referenceRequestId', () => {
    const artifact = baseArtifact({
      adequacy: { state: 'adequate', reasons: [] },
      sources: { observationIds: ['obs-1'], referenceId: 'ref-1', referenceRequestId: 'ref-req-1' },
    });
    expect(isValidBoundedAgentContextArtifact(artifact)).toEqual({ valid: true });
  });

  it('rejects an invalid fidelity field', () => {
    const artifact = baseArtifact({ adequacy: { state: 'adequate', reasons: [] }, fidelity: { not: 'valid' } as unknown as BoundedReferenceFidelityProjection });
    expect(isValidBoundedAgentContextArtifact(artifact).valid).toBe(false);
  });
});

describe('isValidBoundedReferenceFidelityProjection', () => {
  function fidelityRequirementResult(overrides: Partial<ReferenceRequirementFidelityResult> & { requirementId: string }): ReferenceRequirementFidelityResult {
    return {
      category: 'requested',
      subject: { kind: 'region-property', region: 'card', property: 'width' },
      boundRuntimeTargets: ['t-1'],
      status: 'pass',
      ...overrides,
    };
  }

  function fidelityProjection(overrides: Partial<BoundedReferenceFidelityProjection> = {}): BoundedReferenceFidelityProjection {
    return {
      referenceId: 'ref-1',
      referenceRequestId: 'ref-req-1',
      candidateObservationId: 'obs-1',
      candidateRequestId: 'req-1',
      adequacy: { status: 'adequate', totalRequirements: 1, evaluableRequirements: 1, unavailableRequirements: 0, reasons: [] },
      state: 'pass',
      mismatches: [],
      protectedContext: [],
      ...overrides,
    };
  }

  it('accepts a minimal valid projection', () => {
    expect(isValidBoundedReferenceFidelityProjection(fidelityProjection())).toBe(true);
  });

  it('accepts a not-evaluated projection with blockedBy set', () => {
    const projection = fidelityProjection({
      state: 'not-evaluated',
      blockedBy: 'incompatible',
      compatibility: { state: 'incomparable', reasons: [{ code: 'viewport-mismatch', severity: 'blocking', message: 'viewport mismatch' }] },
    });
    expect(isValidBoundedReferenceFidelityProjection(projection)).toBe(true);
  });

  it('accepts mismatches exactly at MAX_FIDELITY_MISMATCHES and rejects one over', () => {
    const atLimit = Array.from({ length: MAX_FIDELITY_MISMATCHES }, (_, i) => fidelityRequirementResult({ requirementId: `r-${i}`, status: 'fail' }));
    expect(isValidBoundedReferenceFidelityProjection(fidelityProjection({ mismatches: atLimit }))).toBe(true);

    const overLimit = [...atLimit, fidelityRequirementResult({ requirementId: 'r-over', status: 'fail' })];
    expect(isValidBoundedReferenceFidelityProjection(fidelityProjection({ mismatches: overLimit }))).toBe(false);
  });

  it('accepts protectedContext exactly at MAX_FIDELITY_PROTECTED_CONTEXT and rejects one over', () => {
    const atLimit = Array.from({ length: MAX_FIDELITY_PROTECTED_CONTEXT }, (_, i) => fidelityRequirementResult({ requirementId: `p-${i}`, category: 'protected' }));
    expect(isValidBoundedReferenceFidelityProjection(fidelityProjection({ protectedContext: atLimit }))).toBe(true);

    const overLimit = [...atLimit, fidelityRequirementResult({ requirementId: 'p-over', category: 'protected' })];
    expect(isValidBoundedReferenceFidelityProjection(fidelityProjection({ protectedContext: overLimit }))).toBe(false);
  });

  it('rejects a malformed mismatch entry', () => {
    const projection = fidelityProjection({ mismatches: [{ requirementId: 'bad' } as unknown as ReferenceRequirementFidelityResult] });
    expect(isValidBoundedReferenceFidelityProjection(projection)).toBe(false);
  });

  it('rejects an unavailable mismatch missing reasonCode/detail', () => {
    const projection = fidelityProjection({ mismatches: [fidelityRequirementResult({ requirementId: 'r1', status: 'unavailable' })] });
    expect(isValidBoundedReferenceFidelityProjection(projection)).toBe(false);
  });

  it('rejects a non-object value', () => {
    expect(isValidBoundedReferenceFidelityProjection(null)).toBe(false);
    expect(isValidBoundedReferenceFidelityProjection('x')).toBe(false);
  });
});
