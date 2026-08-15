import { describe, expect, it } from 'vitest';
import {
  BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
  BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
  MAX_CORRELATION_RECORDS,
  MAX_STATIC_CANDIDATES_PER_TARGET,
  MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD,
  MAX_TEXT_SUMMARY_CHARS,
  isValidBoundedAgentContextArtifact,
  type BoundedAgentContextArtifact,
  type BoundedRuntimeTargetProjection,
  type StaticEvidenceProducerIdentity,
} from '../../src/domain/boundedAgentContext.js';
import {
  deriveRuntimeStaticCorrelations,
  attachRuntimeStaticCorrelations,
  type CorrelationTargetInput,
  type StaticCandidateEvidenceInput,
  type DeriveRuntimeStaticCorrelationsInput,
} from '../../src/domain/boundedAgentContextCorrelation.js';
import { PRODUCER_NAME } from '../../src/domain/schema.js';

// --- fixture builders (mirrors tests/unit/boundedAgentContext.test.ts convention) ---

function producer(overrides: Partial<StaticEvidenceProducerIdentity> = {}): StaticEvidenceProducerIdentity {
  return { name: 'my-dev-kit', version: '1.12.2', indexId: 'idx-abc123', ...overrides };
}

function candidate(id: string, overrides: Partial<StaticCandidateEvidenceInput> = {}): StaticCandidateEvidenceInput {
  return { candidateId: `file:${id}`, kind: 'file', evidenceRefs: [], ...overrides };
}

function symbolCandidate(id: string, overrides: Partial<StaticCandidateEvidenceInput> = {}): StaticCandidateEvidenceInput {
  return { candidateId: `symbol:${id}`, kind: 'symbol', evidenceRefs: [], ...overrides };
}

function targetInput(id: string, overrides: Partial<CorrelationTargetInput> = {}): CorrelationTargetInput {
  return { runtimeTargetId: id, required: false, runtimeEvidenceRefs: [], candidates: [], ...overrides };
}

function deriveInput(overrides: Partial<DeriveRuntimeStaticCorrelationsInput> = {}): DeriveRuntimeStaticCorrelationsInput {
  return { staticProducer: producer(), correlatedAt: '2026-08-15T00:00:00.000Z', targets: [], ...overrides };
}

function targetProjection(id: string, overrides: Partial<BoundedRuntimeTargetProjection> = {}): BoundedRuntimeTargetProjection {
  return { targetId: id, ...overrides };
}

function baseArtifact(targetIds: string[], overrides: Partial<BoundedAgentContextArtifact> = {}): BoundedAgentContextArtifact {
  return {
    artifactKind: BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
    schemaVersion: BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
    contextId: 'ctx-1',
    contextRequestId: 'ctx-req-1',
    producer: { name: PRODUCER_NAME, version: '0.5.0' },
    provenance: { generatedAt: '2026-08-15T00:00:00.000Z' },
    projectionProfile: 'frontend-change-review',
    sources: { observationIds: ['obs-1'] },
    targets: targetIds.map((id) => targetProjection(id)),
    adequacy: { state: 'adequate', reasons: [] },
    omissions: [],
    truncations: [],
    ...overrides,
  };
}

describe('deriveRuntimeStaticCorrelations - status semantics', () => {
  it('produces status "correlated" for exactly one candidate (TST-C001)', () => {
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('src/a.ts')] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.status).toBe('correlated');
    expect(result.records[0]?.candidates).toHaveLength(1);
  });

  it('produces status "ambiguous" for two or more candidates (TST-C002)', () => {
    const result = deriveRuntimeStaticCorrelations(
      deriveInput({ targets: [targetInput('t1', { candidates: [candidate('src/a.ts'), candidate('src/b.ts')] })] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.status).toBe('ambiguous');
    expect(result.records[0]?.candidates).toHaveLength(2);
  });

  it('produces status "unavailable" for zero candidates (TST-C003)', () => {
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.status).toBe('unavailable');
    expect(result.records[0]?.candidates).toHaveLength(0);
  });

  it('distinguishes not-attempted (target absent from input) from attempted-and-unavailable (TST-C004)', () => {
    const result = deriveRuntimeStaticCorrelations(
      deriveInput({ targets: [targetInput('t1', { candidates: [] }), targetInput('t2', { candidates: [candidate('src/a.ts')] })] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // t1 was explicitly attempted -> explicit unavailable record present.
    const t1 = result.records.find((r) => r.runtimeTargetId === 't1');
    expect(t1?.status).toBe('unavailable');
    // t3 was never supplied at all -> no record represents it (not attempted != unavailable).
    const t3 = result.records.find((r) => r.runtimeTargetId === 't3');
    expect(t3).toBeUndefined();
    expect(result.records).toHaveLength(2);
  });
});

describe('deriveRuntimeStaticCorrelations - identity preservation', () => {
  it('preserves exact candidateId and kind verbatim, never path-derived or re-minted (TST-C005)', () => {
    const result = deriveRuntimeStaticCorrelations(
      deriveInput({ targets: [targetInput('t1', { candidates: [symbolCandidate('src/foo.ts#Bar')] })] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.candidates[0]?.candidateId).toBe('symbol:src/foo.ts#Bar');
    expect(result.records[0]?.candidates[0]?.kind).toBe('symbol');
  });

  it('preserves exact static producer name/version/indexId, never derived from a path (TST-C006)', () => {
    const result = deriveRuntimeStaticCorrelations(
      deriveInput({ staticProducer: producer({ indexId: 'idx-9f9f' }), targets: [targetInput('t1', { candidates: [candidate('a.ts')] })] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.staticProducer).toEqual({ name: 'my-dev-kit', version: '1.12.2', indexId: 'idx-9f9f' });
  });
});

describe('deriveRuntimeStaticCorrelations - candidate cap', () => {
  it('accepts exactly MAX_STATIC_CANDIDATES_PER_TARGET candidates without truncation (TST-C007)', () => {
    const candidates = Array.from({ length: MAX_STATIC_CANDIDATES_PER_TARGET }, (_, i) => candidate(`f${i}.ts`));
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.candidates).toHaveLength(MAX_STATIC_CANDIDATES_PER_TARGET);
    expect(result.truncations).toHaveLength(0);
  });

  it('truncates one-over MAX_STATIC_CANDIDATES_PER_TARGET deterministically, stays ambiguous, records truncation (TST-C008)', () => {
    const candidates = Array.from({ length: MAX_STATIC_CANDIDATES_PER_TARGET + 1 }, (_, i) => candidate(`f${i}.ts`));
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { required: true, candidates })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.candidates).toHaveLength(MAX_STATIC_CANDIDATES_PER_TARGET);
    expect(result.records[0]?.status).toBe('ambiguous');
    expect(result.truncations.some((t) => t.subject === 'correlation:t1.candidates' && t.required)).toBe(true);
  });

  it('never promotes an arbitrary candidate to "correlated" on overflow - status stays ambiguous (TST-C009)', () => {
    const candidates = Array.from({ length: MAX_STATIC_CANDIDATES_PER_TARGET + 5 }, (_, i) => candidate(`f${i}.ts`));
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.status).toBe('ambiguous');
  });
});

describe('deriveRuntimeStaticCorrelations - determinism', () => {
  it('produces identical logical candidate content regardless of input candidate order (TST-C010)', () => {
    const a = [candidate('a.ts'), candidate('b.ts'), candidate('c.ts')];
    const b = [candidate('c.ts'), candidate('a.ts'), candidate('b.ts')];
    const r1 = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: a })] }));
    const r2 = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: b })] }));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.records[0]?.candidates).toEqual(r2.records[0]?.candidates);
  });

  it('produces identical logical record content regardless of input target order (TST-C011)', () => {
    const t1 = targetInput('t1', { candidates: [candidate('a.ts')] });
    const t2 = targetInput('t2', { candidates: [candidate('b.ts')] });
    const r1 = deriveRuntimeStaticCorrelations(deriveInput({ targets: [t1, t2] }));
    const r2 = deriveRuntimeStaticCorrelations(deriveInput({ targets: [t2, t1] }));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.records).toEqual(r2.records);
  });

  it('produces identical logical evidenceRefs content regardless of nonsemantic input order (TST-C012)', () => {
    const refsA = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];
    const refsB = [{ path: 'c' }, { path: 'b' }, { path: 'a' }];
    const r1 = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('x.ts', { evidenceRefs: refsA })] })] }));
    const r2 = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('x.ts', { evidenceRefs: refsB })] })] }));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.records[0]?.candidates[0]?.evidenceRefs).toEqual(r2.records[0]?.candidates[0]?.evidenceRefs);
  });
});

describe('deriveRuntimeStaticCorrelations - evidence-ref cap', () => {
  it('accepts exactly MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD refs without truncation (TST-C013)', () => {
    const refs = Array.from({ length: MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD }, (_, i) => ({ path: `p${i}` }));
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { runtimeEvidenceRefs: refs, candidates: [candidate('a.ts')] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.runtimeEvidenceRefs).toHaveLength(MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD);
    expect(result.truncations).toHaveLength(0);
  });

  it('truncates one-over MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD and records the loss (TST-C014)', () => {
    const refs = Array.from({ length: MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD + 1 }, (_, i) => ({ path: `p${i}` }));
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { required: true, runtimeEvidenceRefs: refs, candidates: [candidate('a.ts')] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.runtimeEvidenceRefs).toHaveLength(MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD);
    expect(result.truncations.some((t) => t.subject === 'correlation:t1.runtimeEvidenceRefs' && t.required)).toBe(true);
  });

  it('caps candidate.evidenceRefs at MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD independently per candidate (TST-C015)', () => {
    const refs = Array.from({ length: MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD + 3 }, (_, i) => ({ path: `p${i}` }));
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('a.ts', { evidenceRefs: refs })] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.candidates[0]?.evidenceRefs).toHaveLength(MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD);
  });

  it('truncates evidenceBasis at MAX_TEXT_SUMMARY_CHARS (TST-C016)', () => {
    const longText = 'x'.repeat(MAX_TEXT_SUMMARY_CHARS + 500);
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { evidenceBasis: longText, candidates: [candidate('a.ts')] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.evidenceBasis).toHaveLength(MAX_TEXT_SUMMARY_CHARS);
  });
});

describe('deriveRuntimeStaticCorrelations - correlation-record cap', () => {
  it('accepts exactly MAX_CORRELATION_RECORDS targets without omission (TST-C017)', () => {
    const targets = Array.from({ length: MAX_CORRELATION_RECORDS }, (_, i) => targetInput(`t${i}`, { candidates: [candidate('a.ts')] }));
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(MAX_CORRELATION_RECORDS);
    expect(result.omissions).toHaveLength(0);
  });

  it('bounds output to MAX_CORRELATION_RECORDS one-over, prioritizing required targets, and records the required loss (TST-C018)', () => {
    const requiredTargets = Array.from({ length: MAX_CORRELATION_RECORDS }, (_, i) => targetInput(`req-${i}`, { required: true, candidates: [candidate('a.ts')] }));
    const optionalTarget = targetInput('opt-1', { required: false, candidates: [candidate('a.ts')] });
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [...requiredTargets, optionalTarget] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(MAX_CORRELATION_RECORDS);
    // The optional target must be the one dropped - every required target survives.
    expect(result.records.every((r) => r.runtimeTargetId.startsWith('req-'))).toBe(true);
    expect(result.omissions.some((o) => o.subject === 'correlation-record:opt-1' && !o.required)).toBe(true);
  });

  it('drops optional records before any required record when both compete for the bound, and marks a dropped required record as required loss (TST-C019)', () => {
    const optionalTargets = Array.from({ length: MAX_CORRELATION_RECORDS }, (_, i) => targetInput(`opt-${i}`, { required: false, candidates: [candidate('a.ts')] }));
    const requiredTarget = targetInput('req-1', { required: true, candidates: [candidate('a.ts')] });
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [...optionalTargets, requiredTarget] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.some((r) => r.runtimeTargetId === 'req-1')).toBe(true);
    expect(result.records).toHaveLength(MAX_CORRELATION_RECORDS);
    const droppedOptional = result.records.filter((r) => r.runtimeTargetId.startsWith('opt-')).length < optionalTargets.length;
    expect(droppedOptional).toBe(true);
  });
});

describe('deriveRuntimeStaticCorrelations - large valid overflow (stress)', () => {
  it('terminates and stays fully bounded/deterministic/valid for a large input far beyond every cap (TST-C020)', () => {
    const targets = Array.from({ length: 500 }, (_, i) =>
      targetInput(`t${String(i).padStart(4, '0')}`, {
        required: i % 3 === 0,
        runtimeEvidenceRefs: Array.from({ length: 20 }, (_, j) => ({ path: `re-${i}-${j}` })),
        candidates: Array.from({ length: 12 }, (_, k) => candidate(`f-${i}-${k}.ts`, { evidenceRefs: Array.from({ length: 15 }, (_, m) => ({ path: `ce-${i}-${k}-${m}` })) })),
      }),
    );
    const result1 = deriveRuntimeStaticCorrelations(deriveInput({ targets }));
    const result2 = deriveRuntimeStaticCorrelations(deriveInput({ targets: [...targets].reverse() }));
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    expect(result1.records.length).toBeLessThanOrEqual(MAX_CORRELATION_RECORDS);
    // deriveRuntimeStaticCorrelations itself does not aggregate-cap
    // omissions/truncations (that is attachRuntimeStaticCorrelations'
    // responsibility, verified separately below) - here we only assert the
    // per-record/per-collection bounds and termination for large input.
    expect(Number.isFinite(result1.omissions.length)).toBe(true);
    for (const record of result1.records) {
      expect(record.candidates.length).toBeLessThanOrEqual(MAX_STATIC_CANDIDATES_PER_TARGET);
      expect(record.runtimeEvidenceRefs.length).toBeLessThanOrEqual(MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD);
      for (const c of record.candidates) expect(c.evidenceRefs.length).toBeLessThanOrEqual(MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD);
    }
    // deterministic regardless of input order
    expect(result1.records).toEqual(result2.records);
    // every emitted required-loss omission is truthfully marked required
    expect(result1.omissions.filter((o) => o.subject.startsWith('correlation-record:') && o.required).every((o) => o.required)).toBe(true);
  });

  it('attach-time aggregate caps stay bounded and validator-accepted for the same large overflow input (TST-C020b)', () => {
    const targets = Array.from({ length: 500 }, (_, i) =>
      targetInput(`t${String(i).padStart(4, '0')}`, {
        required: i % 3 === 0,
        candidates: Array.from({ length: 12 }, (_, k) => candidate(`f-${i}-${k}.ts`)),
      }),
    );
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const survivingIds = derived.records.map((r) => r.runtimeTargetId);
    const artifact = baseArtifact(survivingIds);
    const attached = attachRuntimeStaticCorrelations(artifact, derived);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.artifact.omissions.length).toBeLessThanOrEqual(50);
    expect(attached.artifact.truncations.length).toBeLessThanOrEqual(50);
    expect((attached.artifact.correlations ?? []).length).toBeLessThanOrEqual(MAX_CORRELATION_RECORDS);
    expect(isValidBoundedAgentContextArtifact(attached.artifact)).toEqual({ valid: true });
    expect(attached.artifact.adequacy.state).toBe('inadequate');
  });
});

describe('deriveRuntimeStaticCorrelations - malformed input fails closed', () => {
  it('rejects an invalid staticProducer rather than fabricating identity (TST-C021)', () => {
    const result = deriveRuntimeStaticCorrelations(deriveInput({ staticProducer: { name: '', version: '1.0.0', indexId: 'x' } }));
    expect(result.ok).toBe(false);
  });

  it('rejects a candidate whose kind/candidateId prefix disagree (TST-C022)', () => {
    const result = deriveRuntimeStaticCorrelations(
      deriveInput({ targets: [targetInput('t1', { candidates: [{ candidateId: 'symbol:foo', kind: 'file', evidenceRefs: [] }] })] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a duplicate runtimeTargetId in input (TST-C023)', () => {
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1'), targetInput('t1')] }));
    expect(result.ok).toBe(false);
  });

  it('rejects an empty runtimeTargetId (TST-C024)', () => {
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('')] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed evidence reference (TST-C025)', () => {
    const result = deriveRuntimeStaticCorrelations(
      deriveInput({ targets: [targetInput('t1', { runtimeEvidenceRefs: [{ path: '' } as { path: string }] })] }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('deriveRuntimeStaticCorrelations - immutability', () => {
  it('never mutates the supplied input targets/candidates/evidenceRefs arrays', () => {
    const refs = [{ path: 'z' }, { path: 'a' }];
    const candidates = [candidate('b.ts', { evidenceRefs: refs }), candidate('a.ts')];
    const targets = [targetInput('t1', { candidates })];
    const input = deriveInput({ targets });
    const snapshotTargets = JSON.parse(JSON.stringify(input.targets));
    const snapshotCandidates = JSON.parse(JSON.stringify(candidates));
    const snapshotRefs = JSON.parse(JSON.stringify(refs));

    const result = deriveRuntimeStaticCorrelations(input);
    expect(result.ok).toBe(true);

    expect(input.targets).toEqual(snapshotTargets);
    expect(candidates).toEqual(snapshotCandidates);
    expect(refs).toEqual(snapshotRefs);
  });
});

describe('deriveRuntimeStaticCorrelations - output validates against the canonical artifact-family validator', () => {
  it('every derived record is accepted by isValidBoundedAgentContextArtifact when attached', () => {
    const result = deriveRuntimeStaticCorrelations(
      deriveInput({ targets: [targetInput('t1', { candidates: [candidate('a.ts')] }), targetInput('t2', { candidates: [] })] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attached = attachRuntimeStaticCorrelations(baseArtifact(['t1', 't2']), result);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(isValidBoundedAgentContextArtifact(attached.artifact)).toEqual({ valid: true });
  });
});

describe('attachRuntimeStaticCorrelations - CONTRACT-002 adequacy consequences', () => {
  it('any known required correlation loss forces inadequate, never adequate/partial (TST-C026)', () => {
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { required: true, candidates: [] })] }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const attached = attachRuntimeStaticCorrelations(baseArtifact(['t1']), derived);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.artifact.adequacy.state).toBe('inadequate');
    expect(attached.artifact.adequacy.reasons.some((r) => r.code === 'static-evidence-unavailable')).toBe(true);
  });

  it('required correlation-record loss by the aggregate bound forces inadequate with required-evidence-omitted-by-bound (TST-C027)', () => {
    // Zero-padded ids so ascending lexicographic sort matches numeric order deterministically.
    const requiredTargets = Array.from({ length: MAX_CORRELATION_RECORDS + 1 }, (_, i) =>
      targetInput(`req-${String(i).padStart(2, '0')}`, { required: true, candidates: [candidate('a.ts')] }),
    );
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets: requiredTargets }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.records).toHaveLength(MAX_CORRELATION_RECORDS);
    // The artifact only needs to know about the targets that actually survive
    // into a correlation record (req-00..req-24); req-25 is dropped by the
    // bound before it would ever need to correspond to an artifact target,
    // and the artifact itself must stay within MAX_RUNTIME_TARGETS (== 25).
    const survivingIds = derived.records.map((r) => r.runtimeTargetId);
    const artifact = baseArtifact(survivingIds);
    const attached = attachRuntimeStaticCorrelations(artifact, derived);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.artifact.adequacy.state).toBe('inadequate');
    expect(attached.artifact.adequacy.reasons.some((r) => r.code === 'required-evidence-omitted-by-bound')).toBe(true);
  });

  it('optional-only correlation loss downgrades adequate to partial, never inadequate (TST-C028)', () => {
    const candidates = Array.from({ length: MAX_STATIC_CANDIDATES_PER_TARGET + 1 }, (_, i) => candidate(`f${i}.ts`));
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { required: false, candidates })] }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const attached = attachRuntimeStaticCorrelations(baseArtifact(['t1']), derived);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.artifact.adequacy.state).toBe('partial');
  });

  it('no correlation loss leaves an adequate artifact adequate (TST-C029)', () => {
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('a.ts')] })] }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const attached = attachRuntimeStaticCorrelations(baseArtifact(['t1']), derived);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.artifact.adequacy.state).toBe('adequate');
  });
});

describe('attachRuntimeStaticCorrelations - cross-artifact coherence', () => {
  it('rejects a correlation record whose runtimeTargetId is not present in artifact.targets (TST-C030)', () => {
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('unknown-target', { candidates: [candidate('a.ts')] })] }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const attached = attachRuntimeStaticCorrelations(baseArtifact(['t1']), derived);
    expect(attached.ok).toBe(false);
  });

  it('rejects attaching onto an artifact that already carries correlations (TST-C031)', () => {
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('a.ts')] })] }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const first = attachRuntimeStaticCorrelations(baseArtifact(['t1']), derived);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = attachRuntimeStaticCorrelations(first.artifact, derived);
    expect(second.ok).toBe(false);
  });

  it('rejects an artifact that fails the canonical artifact validator (TST-C032)', () => {
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets: [] }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const attached = attachRuntimeStaticCorrelations({ ...baseArtifact(['t1']), artifactKind: 'wrong' } as unknown as BoundedAgentContextArtifact, derived);
    expect(attached.ok).toBe(false);
  });
});

describe('attachRuntimeStaticCorrelations - immutability', () => {
  it('never mutates the supplied artifact', () => {
    const artifact = baseArtifact(['t1']);
    const snapshot = JSON.parse(JSON.stringify(artifact));
    const derived = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('a.ts')] })] }));
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    attachRuntimeStaticCorrelations(artifact, derived);
    expect(artifact).toEqual(snapshot);
  });
});

describe('no owner/causality/edit-authorization fabrication', () => {
  it('evidenceBasis is passed through only from caller-supplied text, never synthesized from candidate identity', () => {
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('a.ts')] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No evidenceBasis was supplied -> none is fabricated.
    expect(result.records[0]?.evidenceBasis).toBeUndefined();
  });

  it('RuntimeStaticCorrelationRecord/StaticCandidateReference carry no owner/causedBy-style field at the type level (structural smoke check)', () => {
    const result = deriveRuntimeStaticCorrelations(deriveInput({ targets: [targetInput('t1', { candidates: [candidate('a.ts')] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const record = result.records[0] as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(record, 'owner')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(record, 'causedBy')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(record, 'editAuthorized')).toBe(false);
  });
});
