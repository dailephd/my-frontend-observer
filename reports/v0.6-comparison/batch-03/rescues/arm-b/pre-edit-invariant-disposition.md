# Batch 3 Arm B Rescue — Pre-Edit Invariant Disposition

Rescue branch: `experiment/v0.6-batch3-arm-b-rescue`
Rescue worktree: `Z:\Users\newuser\Projects\my-frontend-observer-batch3-arm-b-rescue`
Measurement SHA: `a9c7a96fb03135176fb8a93356c2c5d67632ef09`
Defect: C-B3-001 / ARM_B_PRODUCT_DEFECT (B3-P004 duplicate candidate identity handling)
my-dev-kit: `@dailephd/my-dev-kit@1.12.2`
Index used: `.my-dev-kit-20260815T144619Z` (rebuilt — see rescue-telemetry-armB.json for lifecycle decision)

## 1. Duplicate candidate identity

Witness: `src/domain/boundedAgentContextCorrelation.ts:228` — `deriveOneTarget` sorts
`target.candidates` by `candidateId` but never deduplicates. Raw entry count (including
duplicates) flows directly into `candidates.length` at line 259, which drives `status`.

Repository precedent (retrieved via `source --contains "seen.has("` across `src/domain`):
- `boundedAgentContextCorrelation.ts:151-156` (`validateDeriveInput`): duplicate
  `runtimeTargetId` (the top-level per-record container key) is **rejected** (fail closed).
- `boundedAgentContextProjection.ts:412-443` (`boundedEvidenceForTarget`): duplicate
  `EvidenceReference.path` entries **within a single target's nested evidence collection**
  are **deterministically deduplicated** (sorted, first-in-stable-order kept), explicitly
  labelled "Rescue fix for IMP-B-003" — a prior rescue for the same class of problem
  (permutation-dependent duplicate handling).
- `boundedAgentContextCorrelation.ts:172-176` (`canonicalEvidenceRefs`): duplicate
  `EvidenceReference.path` entries within one candidate's own `evidenceRefs` are already
  deterministically deduplicated (Map keyed by `path`, sorted ascending).

`candidateId` duplicates are a **nested-collection** case (multiple candidate entries
within one target's `candidates` array), structurally analogous to the evidence-ref
precedents, not to the top-level `runtimeTargetId` container-key case. `EvidenceReference`
has only a `path: string` field (verified via `relationships.ts:64-70`), so a
content-safe union-merge of duplicate candidates' `evidenceRefs` is possible without any
divergent-field ambiguity.

Disposition: **ADOPTED** — deterministic deduplication by `candidateId`, merging
`evidenceRefs` (union), then routing through the existing `canonicalEvidenceRefs`
dedupe/sort/cap logic unchanged.

Implementation consequence: add a `canonicalCandidates` merge step (Map keyed by
`candidateId`) in `deriveOneTarget`, applied before the existing candidateId sort/cap.

Focused acceptance check: TST-C033 (duplicate ID does not produce ambiguous),
TST-C034 (dedupe merges evidence, not reject).

## 2. Distinct-candidate ambiguity

Witness: `boundedAgentContext.ts:315-321` (`isValidRuntimeStaticCorrelationRecord`) —
`ambiguous` requires `candidates.length >= 2`; `correlated` requires exactly 1. This
frozen invariant is unchanged; the fix only corrects what count reaches it (distinct
identities, not raw duplicate-inflated entries).

Disposition: **ADOPTED** (no change required — already frozen correctly; rescue makes
the upstream count truthful).

Focused acceptance check: TST-C002 (existing, unmodified), TST-C035 (dup + 1 distinct
=> ambiguous with exactly 2 candidates).

## 3. Candidate kind/ID consistency

Witness: `boundedAgentContextCorrelation.ts:125-132`
(`isValidStaticCandidateEvidenceInput`) — `kind==='file'` requires `file:` prefix,
`kind==='symbol'` requires `symbol:` prefix. Because this validation runs on every
candidate before dedup, two entries sharing the same `candidateId` string are
structurally guaranteed to carry the same `kind` (the ID prefix determines the only
valid `kind`). No additional kind-consistency check is needed at merge time.

Disposition: **ADOPTED** (no change — existing validator already guarantees
consistency; not weakened).

Focused acceptance check: TST-C022 (existing, unmodified — kind/prefix mismatch still
fails closed).

## 4. Deterministic ordering

Witness: `deriveOneTarget:228` (candidateId sort), `canonicalEvidenceRefs:172-176`
(path sort). Merge-by-`candidateId` uses a `Map`, and because `EvidenceReference`'s
only field is `path`, the union of duplicate candidates' `evidenceRefs` arrays is
order-independent going into `canonicalEvidenceRefs`. Final candidate order is
unaffected (still sorted by `candidateId` after merge).

Disposition: **ADOPTED** — merge-then-sort preserves permutation independence.

Focused acceptance check: TST-C036 (candidate array permuted with duplicates =>
identical result), TST-C037 (duplicate's evidenceRefs supplied in different order
=> identical bounded result).

## 5. Evidence-ref bounds/deduplication

Witness: `MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD` (`boundedAgentContext.ts:67`),
already enforced per-candidate in `deriveOneTarget:244-252` via `canonicalEvidenceRefs`
+ slice + truncation record. Merging duplicate candidates' `evidenceRefs` before this
step means the existing cap/truncation logic applies to the merged (post-dedup) set
with no changes to that logic.

Disposition: **ADOPTED** — no change to the cap/truncation mechanism itself, only to
what feeds it.

Focused acceptance check: TST-C015 (existing, unmodified), TST-C037.

## 6. Candidate cap (`MAX_STATIC_CANDIDATES_PER_TARGET`)

Witness: `deriveOneTarget:231-239`. The cap must apply to **distinct** candidates.
Deduplication must happen before this truncation check, otherwise `actualCount` in the
truncation record would be duplicate-inflated and untruthful, and a legitimately-sized
distinct set could be wrongly truncated.

Disposition: **ADOPTED** — dedup runs before the existing cap/truncation check;
`actualCount` reported in truncation records reflects distinct-candidate count.

Focused acceptance check: TST-C007/TST-C008/TST-C009 (existing, unmodified — still
pass unchanged since they contain no duplicates), TST-C038 (six distinct candidates
cap/truncation behavior unaffected by an unrelated duplicate elsewhere is implicitly
covered by TST-C036).

## 7. Immutability

Witness: `deriveOneTarget` already only reads `target.candidates`/`evidenceRefs`
(never mutates); `[...target.candidates].sort(...)` copies before sorting. The new
merge step must follow the same discipline: never mutate `target.candidates`, any
individual candidate object, or any `evidenceRefs` array in place.

Disposition: **ADOPTED** — `canonicalCandidates` builds new objects/arrays only,
never mutates inputs.

Focused acceptance check: existing "immutability" describe block (unmodified),
extended by TST-C039 (duplicate-input immutability).

## 8. Fail-closed malformed input

Witness: `isValidStaticCandidateEvidenceInput` (unchanged), `validateDeriveInput`
(unchanged). Deduplication is a semantic merge of otherwise-*valid* candidates; it
must not be used to paper over structurally invalid candidates (those already fail
closed before reaching `deriveOneTarget`, since validation runs in
`validateDeriveInput` prior to derivation).

Disposition: **ADOPTED** (no change — validation boundary untouched, still runs
before any derivation/dedup logic).

Focused acceptance check: TST-C021/TST-C022/TST-C023/TST-C024/TST-C025 (existing,
unmodified).

## 9. Required-before-optional record allocation

Witness: `deriveRuntimeStaticCorrelations:346-350` (per-record `required`/`optional`
partition, independent of per-target candidate contents). The candidate-level dedup
fix is fully contained inside `deriveOneTarget` and does not touch this
record-level allocation logic at all.

Disposition: **NOT_APPLICABLE to the fix itself** — must remain regression-tested
to confirm no accidental interaction.

Focused acceptance check: TST-C018/TST-C019/TST-C027 (existing, unmodified).

## 10. Public export compatibility

Witness: `src/index.ts` re-exports `deriveRuntimeStaticCorrelations` /
`attachRuntimeStaticCorrelations` from Batch 3; function signatures
(`DeriveRuntimeStaticCorrelationsInput` → `DeriveRuntimeStaticCorrelationsResult`)
are unchanged by this fix — only internal per-target candidate handling changes.

Disposition: **ADOPTED** — no export surface change.

Focused acceptance check: full `npm run build` + existing export-boundary tests
(unmodified).

## 11. No runtime my-dev-kit dependency

Witness: module header comment (`boundedAgentContextCorrelation.ts:13,19-25`)
explicitly documents pure/synchronous, no my-dev-kit runtime dependency. The fix adds
only a pure `Map`-based merge helper — no new imports, no I/O.

Disposition: **ADOPTED** (preserved).

Focused acceptance check: `npm run lint` / `npm run build` (no new dependency
introduced).

## 12. Schema/version preservation

Witness: `package.json` version `0.5.0`; `BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION`
(`boundedAgentContext.ts`) `1.0.0`. Fix touches only
`src/domain/boundedAgentContextCorrelation.ts` and its test file; no schema field,
version constant, or artifact shape changes.

Disposition: **ADOPTED** (preserved — not touched).

Focused acceptance check: `npm run check:docs`, `git diff --stat` scope review at
commit time.

---

## Reject-vs-deduplicate decision summary

**Selected: deterministic deduplication (merge evidenceRefs, keep exactly one
surviving candidate per distinct `candidateId`).**

Rationale: the repository's own nested-collection duplicate-identity precedent
(`boundedAgentContextProjection.ts` `boundedEvidenceForTarget`, itself a prior
rescue for permutation-dependent duplicate behavior — "IMP-B-003") is
deterministic-dedupe, not reject. `candidateId` duplicates within one target's
`candidates` array are structurally the same class of problem (nested per-target
collection, not the top-level per-record container key that `runtimeTargetId`
duplicate-rejection guards). Reject-on-duplicate would apply the wrong-level
precedent (container-key semantics) to a nested-collection case, and would also be
a *more* disruptive change (turning a previously `ok:true` derivation into
`ok:false` for input that is representationally redundant rather than
structurally invalid).
