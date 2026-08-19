# Batch 3 Arm B Rescue — Final Adversarial Invariant Review

Rescue branch: `experiment/v0.6-batch3-arm-b-rescue`
Fix location: `src/domain/boundedAgentContextCorrelation.ts` (`canonicalCandidates` +
one-line call site change in `deriveOneTarget`); tests in
`tests/unit/boundedAgentContextCorrelation.test.ts`.
Full suite at time of review: `npm test` → 627/627 passed (32 files);
`npm run typecheck` / `npm run lint` / `npm run build` / `npm run check:docs` / `git diff --check` all clean.

| # | Invariant | Verdict | Evidence |
|---|---|---|---|
| 1 | Duplicate identity | PASS | TST-C033: `candidate('src/a.ts')` supplied twice → `status='correlated'`, `candidates.length===1`. |
| 2 | Distinct-candidate ambiguity | PASS | TST-C002 (unmodified, still passes): 2 distinct candidates → `ambiguous`. TST-C035: 1 duplicate pair + 1 distinct → `ambiguous` with exactly 2 surviving candidates (`file:src/a.ts`, `file:src/b.ts`), not 3. |
| 3 | Candidate/status coherence | PASS | Frozen validator `isValidRuntimeStaticCorrelationRecord` (`boundedAgentContext.ts:315-321`) still runs as a post-derivation self-check in `deriveRuntimeStaticCorrelations` (lines 365-375, unchanged) — every emitted record is re-validated against `correlated⇔1`, `ambiguous⇔>=2`, `unavailable⇔0` before return. |
| 4 | Exact bound | PASS | TST-C007 (unmodified): exactly `MAX_STATIC_CANDIDATES_PER_TARGET` distinct candidates → no truncation. |
| 5 | One-over-bound | PASS | TST-C008 (unmodified) for the no-duplicate case; TST-C038 (new) for the duplicate-inflated case: 6 distinct candidates each supplied twice (12 raw entries) → truncation `actualCount` reports the distinct count (6), not the raw count (12), and exactly 5 candidates survive. |
| 6 | Large overflow | PASS | TST-C020 (unmodified, 500 targets × 12 candidates each, no duplicates) still terminates, bounded, deterministic under reversal. No duplicate-specific stress case was required by the spec beyond TST-C038; large overflow behavior for the pre-existing (non-duplicate) path is unchanged since `canonicalCandidates` is a no-op when there are no duplicate `candidateId`s (Map size equals input size). |
| 7 | Permutation determinism | PASS | TST-C036: candidate array `[a,a,b]` vs `[b,a,a]` → identical `candidates` output. TST-C037: duplicate's `evidenceRefs` supplied in reversed order across two separate calls → identical merged/sorted output (`[x,y,z]` both times). TST-C010/C011/C012 (unmodified) still pass for the non-duplicate permutation cases. |
| 8 | Evidence-ref bounds | PASS | TST-C015 (unmodified): per-candidate evidenceRefs cap still enforced at `MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD`, now applied post-merge (merged evidenceRefs count exceeding the cap would still truncate — mechanism untouched, only its input changed). |
| 9 | Malformed public input | PASS | TST-C021/C022/C023/C024/C025 (unmodified, all still fail closed): invalid `staticProducer`, kind/prefix mismatch, duplicate `runtimeTargetId`, empty `runtimeTargetId`, malformed evidence reference. Dedup only merges *structurally valid* candidates (validation runs in `validateDeriveInput` before `deriveOneTarget` is ever reached). |
| 10 | Required-before-optional allocation | PASS | TST-C018/C019/C027 (unmodified): required-record survival and required-loss-by-bound behavior at `MAX_CORRELATION_RECORDS` unaffected — allocation logic in `deriveRuntimeStaticCorrelations` is untouched; the fix is fully contained inside `deriveOneTarget`. |
| 11 | Optional-only adequacy | PASS | TST-C028 (unmodified): optional-only correlation loss still downgrades `adequate`→`partial`, never `inadequate`. |
| 12 | Required-loss adequacy | PASS | TST-C026/C027 (unmodified): known required loss still forces `inadequate`. |
| 13 | Input immutability | PASS | TST-C039 (new): candidate array and both duplicate entries' `evidenceRefs` arrays are unchanged (deep-equal to pre-call snapshot) after a duplicate-triggering call. Existing "immutability" describe blocks (unmodified) still pass. |
| 14 | Output validation | PASS | `deriveRuntimeStaticCorrelations`'s existing self-check against `isValidStaticCandidateReference`/`isValidRuntimeStaticCorrelationRecord` (lines 365-375, unchanged) still runs on every record, including deduped ones — fails closed (`ok:false`) if derivation ever produced something the frozen validator would reject. |
| 15 | No recomputation/fabrication | PASS | `canonicalCandidates` performs a pure value merge only (Map keyed by caller-supplied `candidateId`); it invents no new candidateId, no owner/causedBy/edit-authorization field, and does not re-derive `kind` (taken from whichever entry populated the Map, which is guaranteed identical across duplicates by `isValidStaticCandidateEvidenceInput`'s prefix/kind agreement check). |
| 16 | Public built export | PASS | `dist/index.js:31` and `dist/index.d.ts:56-57` (rebuilt via `npm run build`) still export `deriveRuntimeStaticCorrelations`/`attachRuntimeStaticCorrelations` and their types from `./domain/boundedAgentContextCorrelation.js`, unchanged signature. |

No PENDING entries remain.
