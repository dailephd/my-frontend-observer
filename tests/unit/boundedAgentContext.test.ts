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
  isValidBoundedAgentContextArtifact,
  type BoundedAgentContextArtifact,
  type BoundedRuntimeTargetProjection,
  type RuntimeStaticCorrelationRecord,
} from '../../src/domain/boundedAgentContext.js';
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
});
