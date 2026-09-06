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

## Current observation workflow (published and current in 0.6.0)

The real `observe` workflow remains part of the published
`my-frontend-observer@0.6.0` package. Its browser-observation behavior was
established in earlier releases and remains unchanged by v0.6. It accepts target
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

## Current comparison workflow (published and current in 0.6.0)

**Current status: shipped originally as part of
`my-frontend-observer@0.4.0` and unchanged through `0.6.0`.** This is a
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

## Current frontend contract workflow (published and current in 0.6.0)

This text/config-driven workflow shipped in `0.5.0` and remains current in
`0.6.0`. It is layered downstream of the two workflows above - it does not
replace them, and it is not yet the complete v0.7 coding-agent workflow (no
coding-agent correction loop or external-reference evidence foundation lives in
this repository yet; baseline selection remains caller-supplied):

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

## Current external-reference foundation workflow (implemented, unreleased - v0.7 Prompts 1-4)

This is the foundation layer only - identity, provenance, bounded image
metadata, a two-state lifecycle, (Prompt 2) explicit reference regions plus
reusable geometry relationships, (Prompt 3) selected design requirements,
tolerance semantics, and reference-evidence adequacy, and (Prompt 4)
explicit reference applicability (viewport/theme/application-state/
authenticated-state) for one externally supplied design-reference image. It
implements no runtime binding or fidelity-evaluation behavior yet (see
"Planned v0.7 reference-driven correction flow" below), and it never
launches a browser or reads/writes any observation, comparison, or contract
artifact:

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

This is exercised by unit tests covering the pure image-format/dimension
boundary, region geometry/validation, reference-region relationship
derivation, requirement validation/measurement derivation/reference-
expectation derivation/adequacy, identity (including region- and
requirement-content/order sensitivity), the domain validator, writer/reader
round-trip symmetry, the application-level import/approve use cases, and
`runCli()`-level CLI coverage (no Chromium involved - see
`tests/unit/externalReference*.test.ts` and
`tests/unit/cliExternalReference.test.ts`).

## Future workflows

The future sequence preserves the current engines and adds external-reference
evidence before the viewer so that later graphical interfaces consume rather
than invent the reference model:

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
→ v0.8 interactive viewer with reference/candidate inspection
→ v0.9 structured visual annotation on runtime screenshots and references
→ v0.10 full visual human–LLM workflow with both actual-frontend-driven and
  reference-driven entry modes
```

### Planned v0.7 reference-driven correction flow

The planned non-graphical reference path is conceptually:

```text
external visual reference
→ explicit reference identity/provenance
  + bounded reference regions and reusable geometry relationships
  + selected design requirements, tolerance semantics, and reference-
  evidence adequacy
  (all implemented - see "Current external-reference foundation workflow"
  above; applicability/theme/viewport compatibility is not yet implemented)
→ explicit reference-region ↔ runtime-target binding (not yet implemented)
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
Executable reference requirements must reuse the existing canonical requested/
expected-dependent/protected/preserved semantics. Informational reference detail
may remain non-executable. Pixel/image similarity can supplement structured
geometry/relationship/style evidence where reliable, but it must never become
the only success criterion.

Theme, application state, viewport, and other applicability dimensions must be
checked before reference fidelity is interpreted. A mismatched reference and
candidate state must yield an explicit incompatible/incomparable outcome rather
than fabricated visual failures.

The v0.7 coding-agent workflow and reference foundation remain unimplemented in
this repository. v0.7 must work without the v0.8 viewer or v0.9 annotation
system. v0.8 must consume the v0.7 reference/evaluation model rather than create
a second UI-only one.
