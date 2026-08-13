# Architecture

## Current scaffold architecture

The current repository is one published TypeScript ESM package
(`my-frontend-observer@0.4.0`):

- `src/cli.ts` is the real, thin `observe` command entry point (argument
  parsing/output only).
- `src/index.ts` is the library entry point re-exporting the observer-owned
  contracts/functions from every layer below.
- `scripts/clean.mjs` safely removes only the project `dist/` directory.
- `scripts/check-docs.mjs` validates the canonical documentation foundation,
  roadmap version presence, and the no-batches rule.
- TypeScript, ESLint, Vitest, and package configuration provide foundation
  validation, now exercised by real product tests (`tests/unit/`,
  `tests/browser/`).

Batch 1 added the observation domain/schema and safety-policy layer
(`src/domain/`, `src/request/`, `src/safety/`). Batch 2 added a real
Playwright Chromium browser adapter (`src/browser/`), a minimal application
seam invoking it (`src/application/`), and a deterministic browser
fixture/test boundary (`tests/fixtures/`, `tests/browser/`, run via
`npm run test:browser`). Batch 3 extended that single browser adapter with an
internal page/target measurement module (`src/browser/evidenceCapture.ts`)
that reads page and explicit-CSS-target evidence from the same live,
already-ready page used for the screenshot - no second browser/page is ever
opened, and Playwright objects still never leave `src/browser/`. Batch 4
added the artifact ownership boundary itself: `src/artifacts/artifactWriter.ts`
is the one canonical place that writes an observation to disk (temp
directory, then one atomic rename into `<outputLocation>/<observationId>/`),
and `src/application/observationPersistence.ts` assembles the frozen
`ObservationArtifact` from a browser-capture result before handing it to the
writer. The artifact layer has no Playwright dependency and is testable
without launching Chromium. Batch 5 completed the boundary chain: `src/cli.ts`
parses `observe` arguments (CLI-syntax errors only - e.g. malformed
`WIDTHxHEIGHT`), constructs a raw request, and hands it to the existing
Batch 1 `normalizeRequest`; on success it calls one new application-level use
case, `observe()` in `src/application/observationPersistence.ts`, which runs
the existing `runBrowserCapture` exactly once and, only on success, the
existing artifact writer exactly once, then returns a small observer-owned
`ApplicationObservationResult` (observation id, completion state, artifact
path, target/diagnostic counts) for the CLI to print. The CLI never imports
Playwright or the filesystem-write path directly. Batch 6 closed the
remaining real-Chromium coverage gap (a genuine navigation failure, distinct
from a readiness timeout or a pre-launch safety rejection) and validated the
packed npm tarball end to end in a clean consumer environment, independent
of the source checkout. At the end of the v0.1 implementation there was no
controlled-scroll or comparison behavior.

## Current v0.2 architecture (released/current architecture)

v0.2 extends the same architecture rather than adding a parallel one.
`src/request/request.ts` now owns a canonical `{name, locators}` target
model (`TargetLocator`, six frozen kinds) in place of the old CSS-only
shape; the legacy `{name, selector}` input still normalizes into it. The one
existing browser-side target resolver/measurement module,
`src/browser/evidenceCapture.ts`, was extended - not replaced - to resolve
all six locator kinds against the live page through a single Playwright
`Locator` per attempt, honor the frozen ordered-fallback/ambiguity/
unavailable-no-fallback contract, and converge every kind on the same
measurement path (`captureResolvedTargetRecord`); it additionally computes
bounded semantic state, derived landmark identity, and configured-target-
only DOM containment from the same already-resolved elements in the same
capture pass - no second browser/page, no second resolution algorithm.
`src/domain/schema.ts` extends `TargetEvidenceRecord`/`TargetResolution`
additively for schema `1.1.0`, with matching structural validation in
`isValidObservationArtifact`. `src/cli.ts` gained one CLI/input-boundary-
only addition, `--targets-file`: it reads and validates only the JSON root
wrapper (via the already-imported `node:fs`, never `node:fs/promises`) and
hands the parsed `targets` value into the existing `RawObservationRequest`/
`normalizeRequest()` path unchanged - there is no second application
observation use case, and Playwright objects still never leave
`src/browser/`. The artifact writer, application observation use case, and
overall boundary chain (`CLI → normalizeRequest → observe() →
runBrowserCapture → artifact writer`) are unchanged from v0.1.

## Current v0.3 architecture (released/current architecture)

v0.3 extends the same single-observation architecture again; it does not add
a second browser lifecycle, target resolver, or artifact path.
`src/request/request.ts` adds one optional `scrollScenario` field to
`NormalizedObservationRequest` (`ScrollScenario { action }`, exactly
`window-scroll-by` or `target-scroll-by`); `src/domain/schema.ts` adds the
matching bounded runtime evidence types (`ScrollRuntimeSnapshot`,
`ViewportRelationEvidence`, `OverflowEvidence`, `ScrollScenarioTransition`,
`ScrollOwnerInterpretation`) and structural validation for schema `1.2.0`
(additive over `1.1.0`). `src/domain/scrollEvidence.ts` holds the pure,
browser-independent derivations (viewport relation, actual overflow,
transitions, and `deriveScrollOwner`) so they are unit-testable without
Chromium. `src/browser/scrollCapture.ts` holds the one browser-side scenario
capture module: it reuses `evidenceCapture.ts#resolveConfiguredTargets` (now
exported) to resolve configured targets exactly once, captures an initial
`ScrollRuntimeSnapshot`, performs the one immediate scroll
(`window.scrollBy`/`element.scrollBy`, both `behavior: 'instant'`), waits
exactly two `requestAnimationFrame` cycles, and captures a final snapshot -
all inside `chromiumAdapter.ts#captureViewportInternal`'s existing single
navigate → ready → capture flow, strictly before the unchanged
screenshot/`capturePageEvidence`/`captureTargetEvidence` calls, so every
downstream capture (including a no-scenario request, which skips this block
entirely) describes only the final state. `src/cli.ts` gained one CLI/input-
boundary-only addition, `--scroll-scenario-file`: mirroring
`--targets-file`, it reads and validates only the file readability/JSON-
validity/non-array-object-root shape and hands the parsed value straight
into `RawObservationRequest.scrollScenario` - every scenario/action rule
(kind, deltas, target reference) stays owned by `normalizeRequest()`. There
is still one canonical `observe()` application use case and one artifact
writer; `scrollScenarioEvidence` is simply one more optional field on the
same `ObservationArtifact`.

## Current v0.4 architecture (released/current architecture)

v0.4 adds one new downstream pipeline that consumes `ObservationArtifact`
values rather than producing them - it never adds a second browser lifecycle,
target resolver, or observation engine:

```text
ObservationArtifact before  ObservationArtifact after
        \                          /
         `--------.       .-------'
                    \     /
              artifact reader (src/artifacts/artifactReader.ts)
                       ↓
              comparability evaluation (src/domain/comparisonEngine.ts)
                       ↓
    canonical relationship derivation, called for each side independently
              (src/domain/relationships.ts#deriveLayoutRelationships)
                       ↓
              canonical comparison derivation
              (src/domain/comparisonEngine.ts#compareObservations)
                       ↓
                ComparisonArtifact
                       ↓
    atomic comparison writer (src/artifacts/comparisonArtifactWriter.ts)

CLI `compare`
        ↓
application service only (src/application/comparisonService.ts)
        ↓
[reader → domain comparison → writer, as above]
```

`src/domain/relationships.ts` froze the layout-relationship contract and
implements the one canonical pure derivation,
`deriveLayoutRelationships(observation, options?)`: horizontal/vertical
order, area overlap, relative width, geometric fit, vertical sequencing,
page-width fit/exceeds, and a standalone `deriveTargetClipping(record)` -
all computed only from an already-captured `ObservationArtifact`'s own
`targetEvidence`/`pageEvidence`, never from a second browser query. DOM
containment is read directly from the existing v0.2 `TargetContainment`
evidence rather than re-derived, and stays a distinct concept from
geometric fit.

`src/domain/comparisonEngine.ts` implements the one canonical pure
before/after engine, `compareObservations(before, after, config?)`:
validates both source artifacts, evaluates comparability *before* any
rendered difference is calculated, calls `deriveLayoutRelationships` once
per side with the same tolerance, and derives target/page differences and
relationship changes. `src/artifacts/comparisonArtifactWriter.ts` persists
the result atomically (sibling temp directory, then one rename) as
`<outputLocation>/<comparisonId>/manifest.json` only - no screenshot is
copied; the manifest's `before`/`after` references point back to the
source observations' own `screenshot.path`. `src/application/
comparisonService.ts` is the one application-layer seam: `compareAndPersist`
takes two in-memory `ObservationArtifact`s and does exactly one comparison
plus exactly one persist; `compareAndPersistFromArtifactRoots` is a thin
wrapper that additionally reads both sides from disk via the existing
`src/artifacts/artifactReader.ts#readObservationArtifact` reader (itself
just a `manifest.json` parse plus the same `isValidObservationArtifact`
structural gate the writer uses).

`src/cli.ts` gained one new top-level command, `compare`
(`--before`/`--after`/`--output`/`--config-file`), implemented with the same
thin-CLI-boundary discipline as `observe`: `parseCompareArgs` handles only
argument shape/duplication, an optional `loadComparisonConfigFile` reads and
validates only file readability/JSON-validity/non-array-object-root (exactly
like `--targets-file`/`--scroll-scenario-file`), and the command body calls
`compareAndPersistFromArtifactRoots` exactly once. **The CLI's comparison
path never launches Chromium** - `src/cli.ts` imports nothing from
`src/browser/` or `src/artifacts/` (it only reaches persistence and artifact
reading indirectly, through the application-layer seam above), matching the
same import-boundary discipline already enforced for `observe`.

## Current v0.5 architecture (implemented so far)

v0.5 adds one new downstream layer that consumes `ComparisonArtifact` values
(plus the source `ObservationArtifact` pair) rather than producing them - no
new browser lifecycle, target resolver, or comparison engine is added:

```text
ObservationArtifact before + after
              ↓
existing v0.4 comparison/relationship pipeline (unchanged)
              ↓
        ComparisonArtifact
              ↓                                PersistentBaselineContract
              |                                          +
              `------------------------→   PerChangeContract
                                                          ↓
                        canonical contract evaluation
                        (src/domain/frontendContractEvaluation.ts#evaluateFrontendContract)
                                                          ↓
                        clause results + unexpected changes + overall PASS/FAIL
```

`src/domain/frontendContracts.ts` froze the contract/change-scope type,
constant, and structural-validator vocabulary (Batch 1); `src/domain/
frontendContractIdentity.ts` froze deterministic contract/baseline/clause
identity in the same canonicalize+sha256(+opaque-nonce) style as `src/domain/
comparisonIdentity.ts`. `src/domain/frontendContractEvaluation.ts#evaluateFrontendContract`
(Batch 2) is the one canonical pure evaluation entry point: it validates its
five inputs (before/after `ObservationArtifact`, `ComparisonArtifact`,
`PersistentBaselineContract`, `PerChangeContract`) are structurally coherent
and mutually consistent, calculates the active baseline clause set after
explicit supersession, detects bounded structural conflicts, evaluates every
active clause via the frozen 15-primitive vocabulary against the existing
`ComparisonArtifact`/`ObservationArtifact` evidence (never re-deriving
clipping/relationship/scroll-owner facts), classifies unaccounted-for
`ComparisonArtifact.differences` entries as `unexpected`, and derives one
overall `PASS`/`FAIL` verdict. It performs no I/O, launches no browser, and
persists nothing - `src/domain/frontendContractEvaluation.ts` itself remains
untouched by the persistence layer below (Batch 3).

Batch 3 adds the persistence/application boundary around this frozen domain,
without redefining it:

```text
        ComparisonArtifact (read via new src/artifacts/comparisonArtifactReader.ts)
              +
PersistentBaselineContract / PerChangeContract
(read/written via src/artifacts/frontendContractArtifactReader.ts / ...Writer.ts)
              ↓
src/application/frontendContractEvaluationService.ts#evaluateAndPersist
              ↓
    evaluateFrontendContract()  [called exactly once, unmodified]
              ↓
src/domain/frontendContractEvaluationArtifact.ts
    (minimal additive persisted envelope around the frozen result)
              ↓
src/artifacts/frontendContractEvaluationArtifactWriter.ts
    (atomic write, exactly once on a structurally constructible result)
```

`evaluateAndPersistFromArtifactRoots` is the CLI-facing wrapper, reading
before/after observations through the existing `readObservationArtifact` (no
second observation reader), the comparison and both contract classes
through the new readers, then delegating to `evaluateAndPersist` exactly
once - mirroring `application/comparisonService.ts#compareAndPersistFromArtifactRoots`'s
own thin-wrapper shape.

Batch 4 exposes this through the same thin-CLI boundary already established
by `observe`/`compare`:

```text
src/cli.ts (argument parsing, JSON-file-shape checks, help/output formatting,
            exit-code selection only)
        ↓
src/application/frontendContractPersistenceService.ts#approveAndPersistBaseline
src/application/frontendContractPersistenceService.ts#persistPerChangeContract
src/application/frontendContractEvaluationService.ts#evaluateAndPersistFromArtifactRoots
        ↓
domain validators (isValidPersistentBaselineContract / isValidPerChangeContract)
+ artifact readers/writers (Batch 3)
+ evaluateFrontendContract() (Batch 2, unmodified)
```

Three new top-level commands - `approve-baseline`, `save-change-contract`,
`evaluate-contract` - each parse only CLI-syntax concerns (duplicate/missing
flags, JSON-file readability/parseability/object-root shape) and delegate to
exactly one application-layer call; `src/cli.ts` imports no artifact writer/
reader module and no browser code, matching the existing `observe`/`compare`
import-boundary discipline exactly. `approveAndPersistBaseline` adds the one
new coherence check Batch 3 did not need: verifying a baseline contract's
frozen `sourceObservation` reference actually matches the supplied
observation artifact before persisting - explicit approval only, never
inferred from a `compare` or `evaluate-contract` result. `--enforce` on
`evaluate-contract` is applied only after evaluation and persistence have
already completed; it selects the process exit status for an already-final
`FAIL` result and is never part of any identity or persisted field.

## Planned v0.1 architecture constraints

v0.1 planning must preserve these approved boundaries without treating module
names from the historical run as mandatory:

```text
thin command-line boundary
        ↓
reusable observation engine/application layer
        ↓
browser automation boundary
        ↓
observer-owned runtime evidence

observer-owned domain/schema
        ↓
artifact ownership boundary

deterministic fixture/test boundary
        ↓
browser-level validation
```

Use one browser engine implementation, keep browser logic out of presentation,
avoid speculative plugin/multi-browser abstractions, and keep observed
applications external. Before v0.6, versions must not add runtime coupling to
sibling ecosystem projects. v0.6 may add only explicit bounded context,
correlation/export, orchestrator-consumption, and lab-compatibility contracts
while preserving independent ownership.

The text/config-driven coding-agent workflow must be operational before the
viewer and annotation layers are added. Those interfaces consume the same
canonical observation, relationship, comparison, contract, change-scope,
correlation, and context boundaries rather than creating parallel engines.
The concrete implementation plan and module layout must be designed only after
the relevant version planning workflow inspects the current repositories.
