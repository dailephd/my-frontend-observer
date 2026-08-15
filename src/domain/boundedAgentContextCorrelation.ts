/**
 * v0.6 Batch 3: runtime/static correlation derivation + attachment/export
 * against the existing frozen contract in `boundedAgentContext.ts`
 * (`RuntimeStaticCorrelationRecord`, `StaticCandidateReference`,
 * `StaticEvidenceProducerIdentity`, `BoundedAgentContextArtifact.correlations`).
 *
 * This module does not invent a new correlation schema, does not rename or
 * redefine any frozen type/constant, and does not bump the package or
 * `BoundedAgentContextArtifact` schema version. It implements the bounded,
 * deterministic, pure derivation behavior the frozen contract already
 * anticipated but never had an implementation for.
 *
 * Pure and synchronous: no my-dev-kit invocation, no repository indexing, no
 * filesystem access, no re-observation, no recomputation of unrelated
 * artifacts. Consumes only authoritative supplied evidence (runtime target
 * identity/evidence and externally supplied static candidate evidence +
 * static producer/index identity). Mutates none of its inputs.
 *
 * my-dev-kit product boundary: this module has no dependency on, import of,
 * or awareness of `@dailephd/my-dev-kit` at runtime. It accepts neutral,
 * already-retrieved static evidence through `StaticCandidateEvidenceInput`
 * and `DeriveRuntimeStaticCorrelationsInput.staticProducer` - both plain
 * data shapes, never a live my-dev-kit client/process. Static
 * retrieval/indexing remains my-dev-kit's responsibility outside this
 * package; this module never re-derives it.
 *
 * No source-owner/causality/edit-authorization fabrication: `evidenceBasis`
 * is passed through (bounded/truncated) from caller-supplied text only,
 * never synthesized from candidate identity, and candidate/record shape
 * carries no owner/causedBy-style field (the frozen contract already
 * excludes one - see the doc comment on `RuntimeStaticCorrelationRecord`).
 */
import {
  STATIC_CANDIDATE_KINDS,
  MAX_STATIC_CANDIDATES_PER_TARGET,
  MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD,
  MAX_TEXT_SUMMARY_CHARS,
  MAX_CORRELATION_RECORDS,
  MAX_OMISSIONS,
  MAX_TRUNCATIONS,
  isValidStaticEvidenceProducerIdentity,
  isValidStaticCandidateReference,
  isValidRuntimeStaticCorrelationRecord,
  isValidOmissionRecord,
  isValidTruncationRecord,
  isValidAdequacy,
  isValidBoundedAgentContextArtifact,
} from './boundedAgentContext.js';
import type {
  StaticCandidateKind,
  StaticCandidateReference,
  StaticEvidenceProducerIdentity,
  RuntimeStaticCorrelationRecord,
  OmissionRecord,
  TruncationRecord,
  Adequacy,
  AdequacyReasonCode,
  BoundedAgentContextArtifact,
} from './boundedAgentContext.js';
import { isValidEvidenceReference } from './relationships.js';
import type { EvidenceReference } from './relationships.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isEvidenceReferenceArray(value: unknown): value is EvidenceReference[] {
  return Array.isArray(value) && value.every((entry) => isValidEvidenceReference(entry));
}

// ---------------------------------------------------------------------------
// Public input contract (observer-owned; deliberately does not accept a live
// my-dev-kit client/process - only plain, already-retrieved static evidence)
// ---------------------------------------------------------------------------

/** One authoritative static candidate as supplied by the caller (e.g. an application-layer adapter that already ran my-dev-kit retrieval). `candidateId`/`kind` are preserved exactly - never re-minted here. */
export interface StaticCandidateEvidenceInput {
  candidateId: string;
  kind: StaticCandidateKind;
  evidenceRefs: EvidenceReference[];
}

/**
 * One runtime target's correlation input. `required` mirrors the same
 * required/optional/context classification the rest of the bounded-context
 * artifact family already uses (see `boundedAgentContextProjection.ts`) -
 * it drives required-before-optional allocation and CONTRACT-002 adequacy
 * consequences, but is not itself part of the frozen public
 * `RuntimeStaticCorrelationRecord` shape.
 */
export interface CorrelationTargetInput {
  runtimeTargetId: string;
  required: boolean;
  runtimeEvidenceRefs: EvidenceReference[];
  /** Authoritative static candidates already selected/ranked by caller criteria. Empty means "correlation attempted, no responsible candidate available" (=> `unavailable`), which is distinct from omitting this target from `targets` entirely (=> not attempted, no record at all). */
  candidates: StaticCandidateEvidenceInput[];
  evidenceBasis?: string;
}

export interface DeriveRuntimeStaticCorrelationsInput {
  /** Authoritative static producer/index identity, preserved exactly. Never derived from a local path, worktree, output directory, or timestamp. */
  staticProducer: StaticEvidenceProducerIdentity;
  /** Provenance timestamp for every derived record's `provenance.correlatedAt`. Supplied by the caller (pure function - no internal `Date.now()`), matching the existing `generatedAt`-as-input convention in `boundedAgentContextProjection.ts`. */
  correlatedAt: string;
  targets: CorrelationTargetInput[];
}

export interface DeriveRuntimeStaticCorrelationsOutput {
  records: RuntimeStaticCorrelationRecord[];
  omissions: OmissionRecord[];
  truncations: TruncationRecord[];
}

export type DeriveRuntimeStaticCorrelationsResult = ({ ok: true } & DeriveRuntimeStaticCorrelationsOutput) | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Boundary validation (fail closed on malformed input rather than silently
// producing a plausible-looking artifact)
// ---------------------------------------------------------------------------

function isValidStaticCandidateEvidenceInput(value: unknown): value is StaticCandidateEvidenceInput {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.candidateId)) return false;
  if (typeof value.kind !== 'string' || !(STATIC_CANDIDATE_KINDS as readonly string[]).includes(value.kind)) return false;
  if (value.kind === 'file' && !value.candidateId.startsWith('file:')) return false;
  if (value.kind === 'symbol' && !value.candidateId.startsWith('symbol:')) return false;
  return isEvidenceReferenceArray(value.evidenceRefs);
}

function isValidCorrelationTargetInput(value: unknown): value is CorrelationTargetInput {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.runtimeTargetId)) return false;
  if (typeof value.required !== 'boolean') return false;
  if (!isEvidenceReferenceArray(value.runtimeEvidenceRefs)) return false;
  if (!Array.isArray(value.candidates) || !value.candidates.every(isValidStaticCandidateEvidenceInput)) return false;
  if (value.evidenceBasis !== undefined && typeof value.evidenceBasis !== 'string') return false;
  return true;
}

function validateDeriveInput(input: DeriveRuntimeStaticCorrelationsInput): string | undefined {
  if (!isPlainObject(input)) return 'input must be an object';
  if (!isValidStaticEvidenceProducerIdentity(input.staticProducer)) return 'staticProducer must be a valid StaticEvidenceProducerIdentity { name, version, indexId }';
  if (!isNonEmptyString(input.correlatedAt)) return 'correlatedAt must be a non-empty string';
  if (!Array.isArray(input.targets) || !input.targets.every(isValidCorrelationTargetInput)) {
    return 'targets must be an array of valid correlation target inputs';
  }
  const seen = new Set<string>();
  for (const target of input.targets) {
    if (seen.has(target.runtimeTargetId)) return `duplicate runtimeTargetId in correlation input: ${target.runtimeTargetId}`;
    seen.add(target.runtimeTargetId);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Deterministic ordering / bounded-collection helpers (duplicated per the
// established per-module convention - see `canonicalize` in
// `boundedAgentContextIdentity.ts` and `capOmissions`/`capTruncations` in
// `boundedAgentContextProjection.ts` - rather than importing private
// module-internal helpers cross-file)
// ---------------------------------------------------------------------------

function byPathAscending(a: EvidenceReference, b: EvidenceReference): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Dedupe by `path` and sort ascending so evidence-ref order never depends on retrieval/input order (order is not semantically significant here). */
function canonicalEvidenceRefs(refs: readonly EvidenceReference[]): EvidenceReference[] {
  const byPath = new Map<string, EvidenceReference>();
  for (const ref of refs) byPath.set(ref.path, ref);
  return [...byPath.values()].sort(byPathAscending);
}

/** Aggregate-cap enforcement for the merged `omissions` collection, same policy as `boundedAgentContextProjection.ts#capOmissions`: required-loss records are preserved preferentially and a single truthful summary record replaces whatever had to be dropped. */
function capOmissions(records: readonly OmissionRecord[], max: number): OmissionRecord[] {
  if (records.length <= max) return [...records];
  const ranked = [...records].sort((a, b) => Number(b.required) - Number(a.required));
  const kept = ranked.slice(0, max - 1);
  const dropped = ranked.slice(max - 1);
  const anyRequired = dropped.some((d) => d.required);
  const summary: OmissionRecord = {
    subject: 'correlation-omissions-summary',
    reason: 'omitted-by-bound',
    required: anyRequired,
    detail: `${dropped.length} additional omission record(s) omitted by the aggregate ${max}-omission cap`,
  };
  return [...kept, summary];
}

/** Aggregate-cap enforcement for the merged `truncations` collection, same policy as `capOmissions`. */
function capTruncations(records: readonly TruncationRecord[], max: number): TruncationRecord[] {
  if (records.length <= max) return [...records];
  const ranked = [...records].sort((a, b) => Number(b.required) - Number(a.required));
  const kept = ranked.slice(0, max - 1);
  const dropped = ranked.slice(max - 1);
  const anyRequired = dropped.some((d) => d.required);
  const summary: TruncationRecord = {
    subject: 'correlation-truncations-summary',
    limit: max,
    actualCount: records.length,
    required: anyRequired,
  };
  return [...kept, summary];
}

// ---------------------------------------------------------------------------
// Per-target derivation
// ---------------------------------------------------------------------------

interface DerivedEntry {
  record: RuntimeStaticCorrelationRecord;
  required: boolean;
}

function deriveOneTarget(
  target: CorrelationTargetInput,
  staticProducer: StaticEvidenceProducerIdentity,
  correlatedAt: string,
  omissions: OmissionRecord[],
  truncations: TruncationRecord[],
): RuntimeStaticCorrelationRecord {
  // Canonical deterministic candidate ordering: sort by candidateId, never
  // by input/retrieval order, so ambiguity never picks a "first" winner.
  const orderedCandidates = [...target.candidates].sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));

  let boundedCandidateInputs = orderedCandidates;
  if (orderedCandidates.length > MAX_STATIC_CANDIDATES_PER_TARGET) {
    boundedCandidateInputs = orderedCandidates.slice(0, MAX_STATIC_CANDIDATES_PER_TARGET);
    truncations.push({
      subject: `correlation:${target.runtimeTargetId}.candidates`,
      limit: MAX_STATIC_CANDIDATES_PER_TARGET,
      actualCount: orderedCandidates.length,
      required: target.required,
    });
  }

  const candidates: StaticCandidateReference[] = boundedCandidateInputs.map((candidate) => {
    const canonicalRefs = canonicalEvidenceRefs(candidate.evidenceRefs);
    let boundedRefs = canonicalRefs;
    if (canonicalRefs.length > MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD) {
      boundedRefs = canonicalRefs.slice(0, MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD);
      truncations.push({
        subject: `correlation:${target.runtimeTargetId}.candidate:${candidate.candidateId}.evidenceRefs`,
        limit: MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD,
        actualCount: canonicalRefs.length,
        required: target.required,
      });
    }
    return { candidateId: candidate.candidateId, kind: candidate.kind, evidenceRefs: boundedRefs };
  });

  // Status/candidate-count invariant, computed here (never accepted from the
  // caller as a separate field) so it can never drift from the actual
  // candidate count the frozen validator enforces.
  const status = candidates.length === 0 ? 'unavailable' : candidates.length === 1 ? 'correlated' : 'ambiguous';

  if (status === 'unavailable' && target.required) {
    omissions.push({
      subject: `correlation:${target.runtimeTargetId}`,
      reason: 'unsupported-or-unavailable',
      required: true,
      detail: 'required runtime target had no responsible static candidate available for correlation',
    });
  }

  const canonicalRuntimeRefs = canonicalEvidenceRefs(target.runtimeEvidenceRefs);
  let runtimeEvidenceRefs = canonicalRuntimeRefs;
  if (canonicalRuntimeRefs.length > MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD) {
    runtimeEvidenceRefs = canonicalRuntimeRefs.slice(0, MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD);
    truncations.push({
      subject: `correlation:${target.runtimeTargetId}.runtimeEvidenceRefs`,
      limit: MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD,
      actualCount: canonicalRuntimeRefs.length,
      required: target.required,
    });
  }

  let evidenceBasis: string | undefined;
  if (target.evidenceBasis !== undefined) {
    if (target.evidenceBasis.length > MAX_TEXT_SUMMARY_CHARS) {
      evidenceBasis = target.evidenceBasis.slice(0, MAX_TEXT_SUMMARY_CHARS);
      truncations.push({
        subject: `correlation:${target.runtimeTargetId}.evidenceBasis`,
        limit: MAX_TEXT_SUMMARY_CHARS,
        actualCount: target.evidenceBasis.length,
        required: target.required,
      });
    } else {
      evidenceBasis = target.evidenceBasis;
    }
  }

  const record: RuntimeStaticCorrelationRecord = {
    runtimeTargetId: target.runtimeTargetId,
    runtimeEvidenceRefs,
    staticProducer,
    status,
    candidates,
    ...(evidenceBasis !== undefined ? { evidenceBasis } : {}),
    provenance: { correlatedAt },
  };
  return record;
}

// ---------------------------------------------------------------------------
// Public derivation entry point
// ---------------------------------------------------------------------------

/**
 * Derives zero or more bounded `RuntimeStaticCorrelationRecord`s (one per
 * supplied target) from authoritative runtime + static evidence. Pure,
 * deterministic, immutable over its inputs, and terminating for arbitrarily
 * large valid input (bounded by `MAX_CORRELATION_RECORDS`,
 * `MAX_STATIC_CANDIDATES_PER_TARGET`, `MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD`).
 *
 * Does not itself attach the result to a `BoundedAgentContextArtifact` - see
 * `attachRuntimeStaticCorrelations` for that (separate, explicit step, so
 * this function stays usable standalone and testable in isolation).
 */
export function deriveRuntimeStaticCorrelations(input: DeriveRuntimeStaticCorrelationsInput): DeriveRuntimeStaticCorrelationsResult {
  const invalidReason = validateDeriveInput(input);
  if (invalidReason !== undefined) return { ok: false, reason: invalidReason };

  const omissions: OmissionRecord[] = [];
  const truncations: TruncationRecord[] = [];

  // Canonical deterministic target ordering: sort by runtimeTargetId, never
  // by input order, so equivalent input sets always produce the same
  // logical record ordering regardless of how the caller assembled `targets`.
  const orderedTargets = [...input.targets].sort((a, b) => (a.runtimeTargetId < b.runtimeTargetId ? -1 : a.runtimeTargetId > b.runtimeTargetId ? 1 : 0));

  const entries: DerivedEntry[] = orderedTargets.map((target) => ({
    record: deriveOneTarget(target, input.staticProducer, input.correlatedAt, omissions, truncations),
    required: target.required,
  }));

  // Required-before-optional allocation at the MAX_CORRELATION_RECORDS
  // aggregate bound: required entries are kept first, then optional ones,
  // in each case ordered by runtimeTargetId for determinism. Overflow beyond
  // the cap becomes an explicit omission rather than a silently-dropped
  // record; overflow of a *required* entry is a known required loss.
  const requiredEntries = entries.filter((e) => e.required);
  const optionalEntries = entries.filter((e) => !e.required);
  const orderedEntries = [...requiredEntries, ...optionalEntries];
  const allowedEntries = orderedEntries.slice(0, MAX_CORRELATION_RECORDS);
  const droppedEntries = orderedEntries.slice(MAX_CORRELATION_RECORDS);

  for (const dropped of droppedEntries) {
    omissions.push({
      subject: `correlation-record:${dropped.record.runtimeTargetId}`,
      reason: dropped.required ? 'required-evidence-lost-by-bound' : 'omitted-by-bound',
      required: dropped.required,
      detail: `dropped by the aggregate ${MAX_CORRELATION_RECORDS}-correlation-record cap`,
    });
  }

  const records = allowedEntries.map((e) => e.record).sort((a, b) => (a.runtimeTargetId < b.runtimeTargetId ? -1 : a.runtimeTargetId > b.runtimeTargetId ? 1 : 0));

  // Self-check against the frozen structural validator before returning -
  // fail closed rather than emit a record this module itself would reject.
  for (const record of records) {
    const targetId = record.runtimeTargetId;
    for (const candidate of record.candidates) {
      if (!isValidStaticCandidateReference(candidate)) {
        return { ok: false, reason: `internal derivation produced an invalid StaticCandidateReference for target ${targetId}` };
      }
    }
    if (!isValidRuntimeStaticCorrelationRecord(record)) {
      return { ok: false, reason: `internal derivation produced an invalid RuntimeStaticCorrelationRecord for target ${targetId}` };
    }
  }
  for (const omission of omissions) {
    if (!isValidOmissionRecord(omission)) return { ok: false, reason: 'internal derivation produced an invalid OmissionRecord' };
  }
  for (const truncation of truncations) {
    if (!isValidTruncationRecord(truncation)) return { ok: false, reason: 'internal derivation produced an invalid TruncationRecord' };
  }

  return { ok: true, records, omissions, truncations };
}

// ---------------------------------------------------------------------------
// Attachment / export boundary (extends the existing
// BoundedAgentContextArtifact family in place - no new persistence family)
// ---------------------------------------------------------------------------

const REQUIRED_CANDIDATE_TRUNCATION_ADEQUACY_REASON: AdequacyReasonCode = 'static-correlation-ambiguous';
const REQUIRED_UNAVAILABLE_ADEQUACY_REASON: AdequacyReasonCode = 'static-evidence-unavailable';
const REQUIRED_EVIDENCE_TRUNCATION_ADEQUACY_REASON: AdequacyReasonCode = 'required-source-evidence-truncated';
const REQUIRED_RECORD_BOUND_LOSS_ADEQUACY_REASON: AdequacyReasonCode = 'required-evidence-omitted-by-bound';

export type AttachRuntimeStaticCorrelationsResult = { ok: true; artifact: BoundedAgentContextArtifact } | { ok: false; reason: string };

function classifyRequiredAdequacyReason(subject: string, isOmission: boolean): AdequacyReasonCode {
  if (subject.startsWith('correlation-record:')) return REQUIRED_RECORD_BOUND_LOSS_ADEQUACY_REASON;
  if (subject.includes('.candidates')) return REQUIRED_CANDIDATE_TRUNCATION_ADEQUACY_REASON;
  if (isOmission) return REQUIRED_UNAVAILABLE_ADEQUACY_REASON;
  return REQUIRED_EVIDENCE_TRUNCATION_ADEQUACY_REASON;
}

/**
 * Attaches a previously-derived correlation result to an existing
 * `BoundedAgentContextArtifact`, immutably (returns a new artifact; never
 * mutates the input). Enforces cross-artifact coherence (every correlation
 * record's `runtimeTargetId` must reference a target already present in
 * `artifact.targets`), re-applies the aggregate `MAX_CORRELATION_RECORDS`/
 * `MAX_OMISSIONS`/`MAX_TRUNCATIONS` caps to the merged collections, and
 * recomputes `adequacy` per the frozen CONTRACT-002 rule: any known required
 * correlation loss or required correlation unavailability forces
 * `inadequate`; optional-only correlation loss may downgrade an otherwise
 * `adequate` artifact to `partial`, never to `inadequate`.
 */
export function attachRuntimeStaticCorrelations(
  artifact: BoundedAgentContextArtifact,
  correlation: DeriveRuntimeStaticCorrelationsOutput,
): AttachRuntimeStaticCorrelationsResult {
  const artifactValidation = isValidBoundedAgentContextArtifact(artifact);
  if (!artifactValidation.valid) return { ok: false, reason: `artifact is invalid: ${artifactValidation.reason}` };
  if (!Array.isArray(correlation.records) || !correlation.records.every(isValidRuntimeStaticCorrelationRecord)) {
    return { ok: false, reason: 'correlation.records must be an array of valid runtime/static correlation records' };
  }
  if (!Array.isArray(correlation.omissions) || !correlation.omissions.every(isValidOmissionRecord)) {
    return { ok: false, reason: 'correlation.omissions must be an array of valid omission records' };
  }
  if (!Array.isArray(correlation.truncations) || !correlation.truncations.every(isValidTruncationRecord)) {
    return { ok: false, reason: 'correlation.truncations must be an array of valid truncation records' };
  }
  if (artifact.correlations !== undefined && artifact.correlations.length > 0) {
    return { ok: false, reason: 'artifact already carries correlations; attaching twice is not supported (avoids silent overwrite/merge ambiguity)' };
  }

  const knownTargetIds = new Set(artifact.targets.map((t) => t.targetId));
  for (const record of correlation.records) {
    if (!knownTargetIds.has(record.runtimeTargetId)) {
      return { ok: false, reason: `correlation record runtimeTargetId "${record.runtimeTargetId}" does not reference any target in artifact.targets (cross-artifact coherence violation)` };
    }
  }

  const mergedOmissionsRaw = [...artifact.omissions, ...correlation.omissions];
  const mergedTruncationsRaw = [...artifact.truncations, ...correlation.truncations];
  const mergedOmissions = capOmissions(mergedOmissionsRaw, MAX_OMISSIONS);
  const mergedTruncations = capTruncations(mergedTruncationsRaw, MAX_TRUNCATIONS);

  const records = [...correlation.records].sort((a, b) => (a.runtimeTargetId < b.runtimeTargetId ? -1 : a.runtimeTargetId > b.runtimeTargetId ? 1 : 0));
  if (records.length > MAX_CORRELATION_RECORDS) {
    return { ok: false, reason: `correlation.records exceeds MAX_CORRELATION_RECORDS (${MAX_CORRELATION_RECORDS}); caller must bound before attaching` };
  }

  // CONTRACT-002: any known required loss introduced by this attach step
  // (from correlation.omissions/correlation.truncations only - pre-existing
  // artifact-level loss is left exactly as the artifact already represented
  // it) forces inadequate; optional-only loss may downgrade adequate to
  // partial; no loss leaves adequacy untouched.
  const newRequiredOmissions = correlation.omissions.filter((o) => o.required);
  const newRequiredTruncations = correlation.truncations.filter((t) => t.required);
  const hasNewRequiredLoss = newRequiredOmissions.length > 0 || newRequiredTruncations.length > 0;
  const hasNewOptionalLoss = correlation.omissions.some((o) => !o.required) || correlation.truncations.some((t) => !t.required);

  let adequacy: Adequacy = artifact.adequacy;
  if (hasNewRequiredLoss) {
    const newReasonCodes = new Set<AdequacyReasonCode>([
      ...newRequiredOmissions.map((o) => classifyRequiredAdequacyReason(o.subject, true)),
      ...newRequiredTruncations.map((t) => classifyRequiredAdequacyReason(t.subject, false)),
    ]);
    const existingCodes = new Set(artifact.adequacy.reasons.map((r) => r.code));
    const addedReasons = [...newReasonCodes].filter((code) => !existingCodes.has(code)).map((code) => ({ code }));
    adequacy = { state: 'inadequate', reasons: [...artifact.adequacy.reasons, ...addedReasons] };
  } else if (artifact.adequacy.state === 'adequate' && hasNewOptionalLoss) {
    // No ADEQUACY_REASON_CODE exists specifically for "optional correlation
    // evidence truncated" (every truncation-specific code is required-loss
    // scoped by name: `required-source-evidence-truncated`). Per
    // CONTRACT-002/CONTRACT-001 (no new diagnostic field/code), the closest
    // truthful existing non-required-scoped correlation code is reused, with
    // the free-text `detail` field (already part of the frozen
    // `AdequacyReason` shape) carrying the honest specifics.
    adequacy = {
      state: 'partial',
      reasons: [
        ...artifact.adequacy.reasons,
        { code: REQUIRED_CANDIDATE_TRUNCATION_ADEQUACY_REASON, detail: 'optional-only correlation evidence was truncated by a bound; no required correlation evidence was lost' },
      ],
    };
  }
  if (!isValidAdequacy(adequacy)) return { ok: false, reason: 'internal adequacy recomputation produced an invalid Adequacy value' };

  const nextArtifact: BoundedAgentContextArtifact = {
    ...artifact,
    omissions: mergedOmissions,
    truncations: mergedTruncations,
    adequacy,
    ...(records.length > 0 ? { correlations: records } : {}),
  };

  const finalValidation = isValidBoundedAgentContextArtifact(nextArtifact);
  if (!finalValidation.valid) return { ok: false, reason: `internal attach produced an invalid artifact: ${finalValidation.reason}` };

  return { ok: true, artifact: nextArtifact };
}
