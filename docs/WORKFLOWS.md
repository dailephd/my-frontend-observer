# Workflows

## Current validation workflow

```text
install dependencies (npm install; npx playwright install chromium)
→ validate types and lint
→ run the fast unit suite (npm test)
→ run the real-Chromium integration suite (npm run test:browser)
→ build the CLI/library entries (npm run build)
→ validate documentation (npm run check:docs)
```

## Current observation workflow (published and current in 0.7.0)

The real `observe` workflow remains part of the published
`my-frontend-observer@0.7.0` package. Its browser-observation behavior was
established in earlier releases and remains unchanged by v0.6/v0.7. It accepts target
configuration through either of two input paths, plus one optional runtime
scroll scenario:

```text
CLI arguments (--url, --viewport, --output, --timeout, exactly one of:
  one-or-more --target <id=css-selector>
  or --targets-file <json-file>,
  plus optionally --scroll-scenario-file <json-file>)
→ (--targets-file only: read + validate the local JSON root wrapper)
→ (--scroll-scenario-file only: read + validate the local JSON root shape -
  a non-array object; the file supplies RawObservationRequest.scrollScenario
  directly, with no wrapper field)
→ request construction (same RawObservationRequest either way)
→ normalizeRequest() - producing canonical {name, locators} targets and
  validating the optional scrollScenario (supported action kind, delta
  bounds/both-zero rule, stable target-name reference)
→ application observation use case (src/application/observationPersistence.ts#observe)
→ Chromium capture: launch, safe navigation, readiness, then - only if a
  scenario was configured - resolve configured targets once, capture an
  initial ScrollRuntimeSnapshot, perform the one immediate scroll
  (window.scrollBy/element.scrollBy, behavior: "instant"), wait exactly two
  requestAnimationFrame cycles, capture a final ScrollRuntimeSnapshot and
  derive transition/scroll-owner evidence; then screenshot and page/target
  evidence (resolving all six locator kinds through the single canonical
  resolver, plus semantic state/landmark/containment evidence), from the
  same live page - exactly once, always describing the final state
→ atomic artifact persistence (manifest.json + screenshot.png), schema
  1.2.0 - exactly once, only on a successful capture; scrollScenarioEvidence
  is simply one more optional manifest field, never a separate file
→ concise CLI result (Observation/State/Artifact/Targets/Diagnostics)
→ process exit status (0 for a persisted observation, including one whose
  state honestly reports "partial"; nonzero otherwise)
```

A request with no scroll scenario is unaffected: no extra snapshots, no
scroll, no extra animation-frame wait, unchanged request identity.

This is exercised by `runCli()`-level tests, real-Chromium end-to-end tests
(`tests/browser/cliObserve.test.ts`, `tests/browser/windowScrollScenario.test.ts`,
`tests/browser/targetScrollScenario.test.ts`), built `node dist/cli.js
observe ...` runs against the deterministic local fixture
(`scripts/dev/builtCliTargetsFileSmoke.mjs` for the semantic `--targets-file`
path, `scripts/dev/builtCliScrollScenarioSmoke.mjs` for the scroll-scenario
path), and the real `npm pack` tarball installed and run from a clean
temporary consumer directory outside the repository, on Windows, Linux, and
macOS (`scripts/ci/runPackedObservationSmoke.mjs`) - the same workflow,
independent of the source checkout.

## Current comparison workflow (published and current in 0.7.0)

**Current status: shipped originally as part of
`my-frontend-observer@0.4.0` and unchanged through `0.7.0`.** This is a
separate workflow from the observation workflow above - it consumes two
already-persisted observation artifacts rather than producing one, and it
never launches a browser:

```text
two prior real "observe" invocations, each producing its own persisted
  ObservationArtifact (before, after) - unrelated to this workflow itself
→ CLI arguments (--before <root>, --after <root>, --output <directory>,
  optionally --config-file <json-file>)
→ (--config-file only: read + validate the local JSON root shape - a
  non-array object; the file supplies ComparisonConfig directly, with no
  wrapper field)
→ read + validate both observation artifacts (src/artifacts/artifactReader.ts,
  the same isValidObservationArtifact structural gate the writer uses)
→ application comparison use case
  (src/application/comparisonService.ts#compareAndPersistFromArtifactRoots
  → compareAndPersist)
→ pure comparison derivation (src/domain/comparisonEngine.ts#compareObservations):
  comparability first, then - only if comparable/comparable-with-warnings -
  deriveLayoutRelationships for each side plus target/page differences,
  relationship changes, and explicit non-causal dependency evidence
→ atomic comparison-artifact persistence (manifest.json only, no copied
  screenshots), schema 1.0.0 - exactly once, for every comparability
  outcome including "incomparable"
→ concise CLI result (Comparison/State/Artifact/Differences/Relationship
  changes/Diagnostics)
→ process exit status (0 for any successfully computed and persisted
  comparison, including "incomparable"; nonzero only for invalid
  syntax/unreadable or invalid source artifacts/invalid configuration/a
  failed write)
```

Source observations are never modified by this workflow. Operational paths
(`--before`/`--after`/`--config-file`/`--output`) never affect
`comparisonRequestId` and are never written into the persisted manifest.

This is exercised by `runCli()`-level tests
(`tests/unit/cli.test.ts`, `tests/unit/cliCompareOrchestration.test.ts`,
`tests/unit/cliCompareEndToEnd.test.ts`), a real-Chromium end-to-end test
(`tests/browser/cliCompare.test.ts`), built `node dist/cli.js compare ...`
runs against real persisted observations from the deterministic local
fixture (`scripts/dev/builtCliCompareSmoke.mjs`), and packed-tarball
validation of the installed `compare` command
(`scripts/ci/runPackedObservationSmoke.mjs` - see `docs/CI_CD.md`).

## Current frontend contract workflow (published and current in 0.7.0)

This text/config-driven workflow shipped in `0.5.0` and remains current in
`0.7.0`. It is layered downstream of the two workflows above - it does not
replace them. The complete v0.7 coding-agent workflow (the external-reference
evidence foundation and end-to-end correction loop) is layered on top of
it - see "Current external-reference foundation workflow" and "Current
reference correction workflow" below; baseline selection here remains
caller-supplied:

```text
observe before
observe after
compare
        ↓
approve baseline (approve-baseline --observation <before-root>
  --contract-file <PersistentBaselineContract.json> --output <dir>)
        ↓
save per-change contract (save-change-contract
  --contract-file <PerChangeContract.json> --output <dir>)
        ↓
evaluate contract (evaluate-contract --before <root> --after <root>
  --comparison <root> --baseline <root> --change <root> --output <dir>
  [--enforce])
        ↓
persisted evaluation artifact (schema 1.0.0, its own independent family):
  clause results (pass/fail/unavailable/conflict), unexpected changes,
  overall PASS/FAIL
```

`approve-baseline` is the only baseline-approval act; a successful `compare`
or a `PASS` evaluation never approves or supersedes a baseline
automatically. `evaluate-contract` never launches a browser and never
recomputes comparison/relationship evidence - it calls the canonical
`evaluateFrontendContract` exactly once against the supplied evidence and
persists exactly one evaluation artifact, whether the verdict is `PASS` or
`FAIL`. `--enforce` affects only the process exit status for a `FAIL`
verdict, never the persisted evidence itself.

This is exercised by `runCli()`-level tests
(`tests/unit/cliFrontendContracts.test.ts`), a built `node dist/cli.js`
smoke that needs no Chromium
(`scripts/dev/builtCliFrontendContractsSmoke.mjs`), a real-Chromium
end-to-end test (`tests/browser/cliFrontendContracts.test.ts`), and a
real-Chromium built-CLI smoke
(`scripts/dev/builtCliFrontendContractsBrowserSmoke.mjs` - see
`docs/DEVELOPMENT.md`). The real-browser coverage proves both a fully
successful contract change and the "milestone signature" failure (a locally
successful requested change coexisting with a genuine protected-property
regression and a genuine preserved-invariant regression) against actual
rendered geometry, not hand-constructed artifacts. It is also part of
packed-tarball validation: `scripts/ci/runPackedObservationSmoke.mjs`
exercises the installed candidate's `approve-baseline`/`save-change-contract`/
`evaluate-contract` commands against real installed-candidate `observe`/
`compare` evidence, proven on Windows, Linux, and macOS (see
`docs/CI_CD.md`).

## Current bounded agent context workflow (released as `0.6.0`)

This is a programmatic (library-only) workflow, not a CLI command - it
consumes already-persisted v0.1-v0.5 evidence in-process rather than reading
artifact roots from disk:

```text
already-captured evidence (ObservationArtifact(s), ComparisonArtifact,
  PersistentBaselineContract/PerChangeContract, evaluation results)
→ projectBoundedAgentContext(...)
  (src/domain/boundedAgentContextProjection.ts)
→ BoundedRuntimeTargetProjection: bounded geometry/behavior/relationships/
  differences/contract-scope evidence, adequacy, omission, truncation
→ deriveRuntimeStaticCorrelations(...) / attachRuntimeStaticCorrelations(...)
  (src/domain/boundedAgentContextCorrelation.ts), given caller-supplied
  candidate static evidence
→ RuntimeStaticCorrelation[] (correlated / ambiguous / unavailable -
  competing candidates remain visible, never collapsed to one owner)
→ consumed programmatically via the public export surface (src/index.ts) -
  by an external orchestrator or coding-agent workflow outside this
  repository, not by a new my-frontend-observer CLI command
```

This is exercised by unit tests covering the projection and correlation
modules (happy path, boundedness at exact/one-over/large-overflow limits,
immutability, malformed-input fail-closed behavior, adequacy/omission/
truncation reporting, and correlation status invariants/determinism/
deduplication). See `docs/CONTRACTS.md` "v0.6 bounded agent context and
correlation contract" for the exact shape.

**v0.7 Prompt 7 addition (released as `0.7.0`):** `projectBoundedAgentContext`
now optionally accepts an already-computed v0.7 Prompt 6
`ReferenceCandidateFidelityEvaluation` (`fidelity`) alongside its existing
v0.1-v0.5 evidence inputs - never recomputed, never a second fidelity
engine:

```text
already-computed evaluateReferenceCandidateFidelity(...) result
→ projectBoundedAgentContext({ ..., fidelity, fidelityRequired? })
→ projectReferenceFidelity(...) (src/domain/referenceFidelityProjection.ts):
  selects/prioritizes/bounds Prompt 6's non-passing requirement results
  (failed-required, then unavailable-required, then other non-pass) plus
  passing protected/preserved context, and contributes their bound v0.2
  runtime target ids to the exact same required/permitted-target
  allocation contract clauses already compete in
→ BoundedAgentContextArtifact.fidelity: bounded mismatches/protectedContext
  + adequacy/compatibility/state pass-through from Prompt 6, folded into
  the same omissions/truncations/adequacy computation as every other
  evidence source (a blocked "not-evaluated" fidelity is never silently
  reported as "no problems")
→ still consumed programmatically only, unchanged - no CLI surface
```

Absent `fidelity`, output is unaffected - identical to the pre-Prompt-7
behavior described above, including logical identity. See
`docs/CONTRACTS.md` "v0.7 Prompt 7 bounded reference-fidelity projection and
v0.6 bounded-agent-context integration" for the full contract.

## Current external-reference foundation workflow (released as `0.7.0`)

This is the foundation layer only - identity, provenance, bounded image
metadata, a two-state lifecycle, (Prompt 2) explicit reference regions plus
reusable geometry relationships, (Prompt 3) selected design requirements,
tolerance semantics, and reference-evidence adequacy, (Prompt 4) explicit
reference applicability (viewport/theme/application-state/authenticated-
state) and reference/candidate compatibility, and (Prompt 5) explicit
reference-region <-> runtime-target binding, for one externally supplied
design-reference image. Structured fidelity-evaluation behavior (Prompt 6)
follows further below in this section, and it never launches a browser or
reads/writes any observation, comparison, or contract artifact:

```text
import-reference <image-file> --output <dir> [--label] [--supersedes <root>] [--regions-file <json-file>] [--requirements-file <json-file>] [--applicability-file <json-file>]
→ format detection from header/magic bytes only (png/jpeg/webp; never a
  caller-declared extension), dimension parsing from the same bounded header
  bytes (never a pixel decode), byte-length and dimension bounds checked
→ (--regions-file only: read + validate the local JSON root shape - an
  object with exactly a "regions" property - then validate each region's id/
  rectangle and the collection's bounds/uniqueness/image-boundary rules)
→ (--requirements-file only: read + validate the local JSON root shape - an
  object with exactly a "requirements" property - then validate each
  requirement's category/subject/tolerance shape, compute its
  content-derived requirementId, and validate the collection's bounds/
  region-existence/duplicate-subject rules against the regions above)
→ (--applicability-file only: read + validate the local JSON root shape -
  the raw, unwrapped applicability object, no wrapper property - then
  validate its optional viewport/theme/applicationState/authenticatedState
  fields; caller-declared only, never inferred from the image)
→ (--supersedes only: read + validate the referenced prior external-reference
  artifact through the same reader the writer's counterpart uses)
→ deterministic referenceRequestId (pure function of {imageSha256, format,
  width, height, supersedesReferenceId, regions?, requirements?,
  applicability?} only) + fresh referenceId
→ atomic persistence of one "imported" ExternalReferenceArtifact:
  manifest.json (+ regions/requirements/applicability, when supplied) + its
  own copy of the reference image, schema 1.0.0 - lifecycle.state is always
  "imported"; import never approves
        ↓
approve-reference --reference <imported-artifact-root> --output <dir> [--supersedes <root>]
→ read + validate the target through the existing reader; refuse anything
  not currently in the "imported" lifecycle state
→ persist a brand-new "approved" ExternalReferenceArtifact instance (same
  referenceRequestId, fresh referenceId) carrying a sourceReference back to
  the imported artifact's image - no image bytes are copied again, any
  regions/requirements/applicability are carried forward verbatim (never
  re-validated/re-derived), and the imported artifact's own manifest is
  never modified
```

`approve-reference` is the only explicit reference-approval act - it is never
inferred from a successful import. Supersession (`--supersedes`) is
represented only as a forward pointer on the newer artifact; the artifact it
supersedes is never rewritten, so prior reference evidence remains immutable
regardless of how many later references supersede it. Region/requirement/
applicability content (added/removed/moved/resized/renamed regions;
added/removed/changed requirements or tolerances; a changed applicability
declaration) is identity-bearing, so a differently-structured reference is
always a distinct logical reference, never a silent rewrite of an existing
one.

Separately, `observe` gained an optional `--state-file <json-file>` (the
raw, unwrapped `{theme?, applicationState?, authenticatedState?}` object -
caller-declared only, never inferred), persisted as
`requestConfig.explicitState` on the resulting `ObservationArtifact` and
folded into that observation's own request identity. A pure, synchronous
domain function, `evaluateReferenceCandidateCompatibility(reference,
candidate)`, then answers "does this reference describe the same frontend
state as this candidate observation?" by comparing
`reference.applicability` against `candidate.requestConfig`
(viewport/explicitState) - reusing v0.4's own comparability result/reason
vocabulary and its underlying per-dimension comparison rule rather than
inventing a parallel model. This produces no persisted artifact of its own;
it is a pure function callers invoke on two already-persisted artifacts. See
`docs/CONTRACTS.md` "v0.7 Prompt 4 reference applicability and
candidate-state compatibility" for the full contract.

Building on that gate, a second pure, synchronous domain function,
`evaluateReferenceRuntimeBindings(reference, candidate, declarations)`,
answers "which stable v0.2 runtime target does this candidate resolve for
each explicitly declared reference region?" `declarations` is explicit
user/configuration input (`{referenceRegion, runtimeTarget}` pairs) - never
inferred from geometry, matching names, or source code. It runs the Prompt
4 compatibility gate first (reused, never duplicated): an `incomparable`
reference/candidate pair produces zero evaluated bindings, the blocker
visible only through the embedded `compatibility` field. Otherwise each
declaration is resolved against the candidate's own already-captured
`requestConfig.targets`/`targetEvidence` only - no browser, no second
target resolver - using the same `targetPresence` classification v0.4's own
`evaluateComparability` already relies on, yielding `bound`/`ambiguous`/
`unavailable` per declaration. Like compatibility, this produces no
persisted artifact of its own and mutates neither the reference nor the
candidate. See `docs/CONTRACTS.md` "v0.7 Prompt 5 explicit reference-region
<-> runtime-target binding" for the full contract.

Reference-region relationships (`deriveReferenceRegionRelationships()`) are
a separate, pure, on-demand derivation over an artifact's own `regions` -
not part of the persisted manifest - reusing the same geometry-only
relationship families (`left-of`/`above`/`overlaps`/`wider-than`/
`fits-inside`/`follows-vertically`, etc.) that
`deriveLayoutRelationships` derives for runtime targets. A reference
relationship is a fact about the reference image's geometry only, never a
design requirement or a pass/fail verdict.

Selected design requirements (`ExternalReferenceRequirement`) are the
explicit user/configuration layer on top of that reference evidence - a
region property, a region-to-region relationship, or a derived two-region
measurement, tagged with one of v0.5's four authored categories
(`requested`/`expected-dependent`/`protected`/`preserved`) and (except for
relationship subjects) a reference-image-pixel or percent tolerance. Nothing
promotes a property or relationship to a requirement automatically.
Reference-evidence adequacy (`deriveReferenceRequirementAdequacy()`) reports
only whether the reference side itself supports every selected requirement -
`adequate`/`partial`/`inadequate`, never a numeric score, never a claim
about runtime/candidate availability.

Finally, `evaluate-reference-fidelity --reference <root> --candidate <root>
[--bindings-file <json-file>] [--enforce]` is the first command in this
stack that actually compares a reference's selected requirements against
live candidate evidence:

```text
evaluate-reference-fidelity --reference <root> --candidate <root> [--bindings-file <json-file>] [--enforce]
→ (--bindings-file only: read + validate the local JSON root shape - an
  object with exactly a "bindings" property - the still-unvalidated
  declarations are handed straight through)
→ read the reference and candidate artifacts through their existing readers
→ evaluateReferenceCandidateFidelity(reference, candidate, bindings):
  reference/candidate/binding-declaration structural validation
  → Prompt 3 reference adequacy (inadequate -> "not-evaluated", no
    ordinary result fabricated)
  → Prompt 4 compatibility (incomparable -> "not-evaluated")
  → Prompt 5 binding evaluation (ambiguous/unavailable/undeclared binding ->
    the dependent requirement is "unavailable", never guessed)
  → per requirement: reference-image-pixel <-> CSS-pixel coordinate mapping
    (from reference.applicability.viewport and the image's own dimensions;
    no viewport or an incoherent aspect ratio -> numeric requirements
    "unavailable", never a fabricated result) then a Prompt-3-tolerance
    comparison (region-property/region-measurement subjects) or a
    family-scoped v0.4 relationship comparison (region-relationship
    subjects)
→ overall state: "pass" only when every requirement result is "pass";
  any "fail"/"unavailable" forces "fail"
```

This produces no persisted artifact - the structured result exists only for
this invocation, printed as a concise summary (reference adequacy,
compatibility state, overall fidelity state, and a pass/fail/unavailable
requirement breakdown). `--enforce` mirrors `evaluate-contract`'s exact
precedent: it changes only the process exit status for an already-computed
`fail` result, never its content, and never affects a `not-evaluated`
result (always exits 0 - a blocked evaluation is a successful, honest
outcome, not a design mismatch). See `docs/CONTRACTS.md` "v0.7 Prompt 6
structured reference-vs-candidate fidelity evaluation" for the full
contract.

This is exercised by unit tests covering the pure image-format/dimension
boundary, region geometry/validation, reference-region relationship
derivation, requirement validation/measurement derivation/reference-
expectation derivation/adequacy, identity (including region- and
requirement-content/order sensitivity), the domain validator, writer/reader
round-trip symmetry, the application-level import/approve use cases,
coordinate-mapping/tolerance/relationship fidelity evaluation (every
behavior in the Prompt 6 report's behavior model, including the exact
worked 2x-scale example from the task specification), and `runCli()`-level
CLI coverage (no Chromium involved - see `tests/unit/externalReference*.test.ts`,
`tests/unit/cliExternalReference.test.ts`, and
`tests/unit/cliEvaluateReferenceFidelity.test.ts`).

## Current reference correction workflow (released as `0.7.0`)

The first complete, controlled correction cycle - a programmatic (library-
only) workflow, exactly like the v0.6 bounded-context workflow above, with
one explicit, un-automatable seam where an external implementation actor
edits target source:

```text
approved ExternalReferenceArtifact + approved baseline ObservationArtifact
  + active PersistentBaselineContract + PerChangeContract + binding
  declarations + current (pre-change) ObservationArtifact
→ prepareReferenceCorrection(...) (src/domain/referenceCorrectionWorkflow.ts)
  → evaluateReferenceCandidateFidelity(...) (v0.7 Prompt 6, reused)
  → not-evaluated (inadequate reference / incompatible state)?
      → { status: 'blocked-not-evaluated' } - no fabricated handoff
  → otherwise: projectBoundedAgentContext({ ..., fidelity }) (v0.7 Prompt 7/v0.6, reused)
      → { status: 'handoff-ready', handoff: ReferenceCorrectionHandoff }
        ↓
EXTERNAL implementation actor edits target source (never observer code)
        ↓
fresh real-Chromium candidate ObservationArtifact
  (existing observe()/runBrowserCapture pipeline, reused unchanged)
        ↓
reviewReferenceCorrectionAttempt(...)
  → compareObservations(baseline, candidate) (v0.4, reused)
  → evaluateReferenceCandidateFidelity(reference, candidate, bindings) (Prompt 6, reused)
  → evaluateFrontendContract({ before: baseline, after: candidate, comparison, baseline: baselineContract, change: changeContract }) (v0.5, reused)
  → overall: 'not-evaluated' iff fidelity not-evaluated; else 'pass' iff
    fidelity PASS AND contract evaluation PASS; else 'fail'
        ↓
FAIL? → prepareReferenceCorrection(..., currentObservation: <this failed candidate>)
        derives a FRESH bounded handoff from the newest failed evidence
        ↓
        external correction → fresh candidate → review again (caller-controlled, never automatic)
        ↓
PASS? → approvalEligible: true (a plain flag) - explicit
        approve-baseline/approve-reference remain the caller's own,
        separate, unautomated actions
```

Every attempt (`reviewReferenceCorrectionAttempt` call) evaluates against
the *same* supplied approved baseline - there is no attempt-to-attempt
comparison path - and `reviewRequestId` (a deterministic hash of
`{referenceRequestId, baselineObservationId, baselineContractId,
changeContractId, bindingDeclarations}`) is recomputed and checked on every
review call, so a caller cannot silently swap in a different baseline
between attempts of the same logical review. Attempt identity
(`attemptId`, a deterministic hash of `{reviewRequestId,
candidateObservationId}`) distinguishes every candidate execution without
ever using a timestamp; because both workflow functions are pure, a
returned attempt result can never be overwritten by a later call - callers
that keep every result they receive have a complete, immutable attempt
history for free.

This is exercised by unit tests covering preparation (valid handoff,
unapproved-reference rejection, inadequate-reference and incompatible-state
blocking, ambiguous-binding handling, review-identity determinism),
attempt review (all four overall-composition cases - both PASS, reference
FAIL, contract FAIL including a protected regression, and not-evaluated -
plus reviewRequestId coherence, attempt-identity determinism/distinctness,
`priorAttemptId` traceability, and input immutability), and a real-Chromium
end-to-end suite (`tests/browser/referenceCorrectionWorkflow.test.ts`)
proving: an initial genuine design mismatch measured against real rendered
geometry; a controlled, deterministic, test-only "external actor" (living
entirely outside `src/`) editing a disposable copy of a tracked HTML
fixture template and the observer capturing the change through the
unmodified real browser pipeline; a full success correction; a protected-
regression case where the candidate visually satisfies the reference but a
real Chromium-observed element becomes hidden, still producing overall
`FAIL`; a two-attempt correction iteration with both attempts remaining
distinct and traceable to the same baseline; and a blocking case
(incompatible reference/candidate viewport) that never produces a handoff.
The tracked fixture template is verified byte-identical before and after
the proof - only its disposable, repository-local copy is ever edited. See
`docs/CONTRACTS.md` "v0.7 Prompt 8 controlled end-to-end external-reference
coding-agent correction workflow" for the full contract.

## Future workflows (v0.8–v0.10)

v0.7 (text/config-driven coding-agent change review, the external
visual-reference evidence foundation, structured reference-vs-candidate
fidelity evaluation, and the end-to-end correction workflow) is released as
package version `0.7.0` - see "Current external-reference foundation
workflow" and "Current reference correction workflow" above, and
`docs/CURRENT_STATE.md` for release state. The still-future sequence on top
of it preserves the current engines and lets later graphical interfaces
consume rather than invent the reference model:

```text
stable targets and bounded runtime behavior
→ relationships and before/after comparison (released - see above)
→ safe-change contracts (contract model, evaluation, persistence, and CLI
  released as 0.5.0 - see above; baseline approval remains a single explicit
  command, not a policy engine)
→ bounded agent context plus runtime/static correlation (released as
  `0.6.0` - see above; orchestrator/lab-side ecosystem integration is
  separate sibling-repository work, not part of this repository)
→ v0.7 text/config-driven coding-agent change review
  + external visual-reference evidence foundation
  + structured reference-vs-candidate fidelity evaluation
  + end-to-end correction workflow (released as `0.7.0` - see above)
→ v0.8 interactive viewer with reference/candidate inspection
→ v0.9 structured visual annotation on runtime screenshots and references
→ v0.10 full visual human–LLM workflow with both actual-frontend-driven and
  reference-driven entry modes
```

### v0.7 reference-driven correction flow (released as `0.7.0`)

The non-graphical reference path, now released exactly as originally
planned, is:

```text
external visual reference
→ explicit reference identity/provenance
  + bounded reference regions and reusable geometry relationships
  + selected design requirements, tolerance semantics, and reference-
  evidence adequacy
  + explicit applicability/theme/viewport compatibility
  (all implemented - see "Current external-reference foundation workflow"
  above)
→ explicit reference-region ↔ runtime-target binding (implemented - v0.7
  Prompt 5)
→ candidate rendered through the existing Chromium observation engine
→ structured reference-vs-candidate evaluation
→ bounded measurable fidelity mismatches
→ relevant bounded runtime/static context
→ external coding agent modifies source
→ rerender
→ reevaluate reference fidelity
+ rerun before/after comparison
+ rerun per-change and persistent baseline contracts
→ PASS or actionable fidelity/regression failure
```

This does not turn an imported image into an observation or approved baseline.
Reference design vs candidate remains distinct from before vs after comparison.
Executable reference requirements reuse the existing canonical requested/
expected-dependent/protected/preserved semantics. Informational reference detail
may remain non-executable. Pixel/image similarity can supplement structured
geometry/relationship/style evidence where reliable, but it never becomes
the only success criterion.

Theme, application state, viewport, and other applicability dimensions are
checked before reference fidelity is interpreted. A mismatched reference and
candidate state yields an explicit incompatible/incomparable outcome rather
than fabricated visual failures.

The v0.7 coding-agent workflow and reference foundation are released as
part of this repository and work without the v0.8 viewer or v0.9
annotation system. v0.8 must consume the v0.7 reference/evaluation model
rather than create a second UI-only one.
