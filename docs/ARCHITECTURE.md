# Architecture

## Current package architecture

The current repository is one published TypeScript ESM package
(`my-frontend-observer@0.7.0`):

- `src/cli.ts` is the real, thin public CLI parsing/dispatch/presentation
  boundary for the current command surface (`observe`, `compare`,
  `approve-baseline`, `save-change-contract`, `evaluate-contract`,
  `import-reference`, `approve-reference`, `evaluate-reference-fidelity`);
  argument parsing and output formatting only, per command - the commands do
  not share domain semantics in the CLI. v0.6 added no new CLI command; v0.7
  added the three external-reference commands.
- `src/index.ts` is the library entry point re-exporting the observer-owned
  contracts/functions from every layer below, including the v0.6 bounded-agent-
  context projection and runtime/static correlation surface, and the v0.7
  external-reference/region/requirement/applicability/compatibility/binding/
  fidelity/correction-workflow surface (`prepareReferenceCorrection`/
  `reviewReferenceCorrectionAttempt` remain programmatic-only, with no CLI
  command).
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

## Current v0.5 architecture (released/current architecture)

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

## Current v0.6 architecture (released as `0.6.0`)

v0.6 adds one new downstream, read-only layer that consumes existing v0.1-v0.5
evidence (`ObservationArtifact`, `ComparisonArtifact`,
`PersistentBaselineContract`/`PerChangeContract`, and evaluation results)
plus caller-supplied bounded static candidate evidence - it adds no new
browser lifecycle, target resolver, observation/comparison/contract engine,
or persisted artifact family:

```text
ObservationArtifact(s) + ComparisonArtifact + contract/evaluation evidence
              ↓
src/domain/boundedAgentContextProjection.ts#projectBoundedAgentContext
              ↓
    BoundedRuntimeTargetProjection
    (page/viewport identity, stable targets, geometry, runtime behavior,
     relationships, before/after differences, contract results,
     requested/expected-dependent/protected/preserved scope reused verbatim
     from src/domain/frontendContracts.ts, diagnostics, artifact/screenshot
     references, provenance, adequacy, omission, truncation)
              ↓
src/domain/boundedAgentContextCorrelation.ts
    #deriveRuntimeStaticCorrelations / #attachRuntimeStaticCorrelations
              ↓
    RuntimeStaticCorrelation[] (correlated / ambiguous / unavailable,
    competing candidates preserved verbatim - never collapsed to one owner)
              ↓
src/index.ts (public export/correlation boundary only)
```

`src/domain/boundedAgentContext.ts` freezes the bounded-projection and
correlation type/constant vocabulary (`Adequacy`, `ADEQUACY_REASON_CODES`,
`OmissionRecord`, `TruncationRecord`, `BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND`,
schema `1.0.0`). `src/domain/boundedAgentContextIdentity.ts` derives a
deterministic logical identity distinct from a fresh per-execution instance
identity, in the same canonicalize+hash style as
`comparisonIdentity.ts`/`frontendContractIdentity.ts`.
`boundedAgentContextProjection.ts` performs no browser I/O and re-derives
nothing already owned upstream - it reads already-captured artifacts and
reuses the existing v0.4 relationship/comparison evidence and v0.5
change-scope clause types directly. `boundedAgentContextCorrelation.ts`
accepts only plain, caller-supplied candidate static-evidence records; it has
**no** dependency on `@dailephd/my-dev-kit`, since the audit that preceded
implementation found no generic static-side retrieval capability actually
missing (see `docs/ROADMAP.md` v0.6 "Dependency direction" - the "determine
whether my-dev-kit requires a static-side change" step concluded no).
Runtime target identity is carried through this module verbatim; the module
never adds a `sourceOwner`/`causedBy`-shaped field, preserving the
architectural rule that runtime identity never silently becomes source
ownership.

This layer is a programmatic export/correlation boundary only: `src/index.ts`
re-exports its full type/function surface, but there is no new CLI command,
no `src/artifacts/boundedAgentContext*` writer/reader, and no orchestrator or
lab code in this repository - those remain separate sibling-repository
responsibilities per the Milestone 6 ownership split in
`docs/PROJECT_MILESTONES.md`.

## v0.7 (released as `0.7.0`), v0.8 (released as `0.8.0`), and planned v0.9–v0.10 reference-evidence architecture constraints

The external visual-reference capability (v0.7) is released as package
version `0.7.0` - see "v0.7 Prompt 1" through "v0.7 Prompt 8" below for the
actual architecture, and `docs/CURRENT_STATE.md` for release state. It
extends the existing v0.1-v0.6 evidence architecture rather than becoming a
UI-only feature or a parallel visual-comparison stack. v0.8 (interactive
viewer) is released as package version `0.8.0`. v0.9 (structured visual
annotation) and v0.10 (full graphical human-LLM workflow) remain future and
unimplemented; the constraints below apply to that still-future work.

The evidence domains remain distinct:

```text
runtime observation A ↔ runtime observation B
→ existing before/after comparison

approved baseline/per-change contract ↔ candidate runtime evidence
→ existing canonical contract evaluation

external visual reference ↔ candidate runtime evidence
→ reference applicability + structured fidelity evaluation (v0.7,
  released as `0.7.0` - see "v0.7 Prompt 4" and "v0.7 Prompt 6" below)
```

An external reference is not an `ObservationArtifact`, and a reference region
is not a runtime target. The released v0.7 implementation preserves explicit
identity and provenance for the reference image/version, reference regions,
applicable viewport/theme/application state, authored requirements, tolerances,
approval/supersession state, and reference-region/runtime-target bindings.
Bindings are explicit and evaluate to `bound`, `ambiguous`, or `unavailable`;
they never silently become source ownership.

The non-UI reference model and structured reference-vs-candidate evaluation
were established in v0.7 before v0.8. v0.8 may render side-by-side images,
overlays, measurements, bindings, provenance, and fidelity results, but it must
consume those existing engines and must not invent a second reference model or
evaluation engine. v0.9 may author annotations against either runtime
screenshots or external references, but both coordinate/identity domains remain
explicit and feed the same canonical contract/change-scope semantics. v0.10
combines both visual entry modes with the existing correction loop.

Where a reference requirement is executable, it uses the existing v0.5
requested/expected-dependent/protected/preserved semantics. Informational or
unassessed reference evidence remains non-executable until explicitly selected.
There is no reference-only PASS/FAIL taxonomy.

The released reference evaluation reuses existing relationship/value
conventions where they mean the same thing and adds distinct reference-owned
units only where the image evidence requires them. v0.7 does not use pixel or
image-region similarity as a success mechanism; a later bounded similarity
feature may supplement structured evidence if separately designed, but it must
not replace browser-authoritative runtime geometry, canonical contract
evaluation, or explicit relationship evidence.

Candidate rendering still uses the one existing Chromium observation engine.
The observer remains non-mutating. `my-dev-kit` remains the static/source
evidence owner, and the v0.6 correlation/bounded-context boundary remains the
route for attaching relevant source evidence to reference-driven correction
packets. Heavy reference image bytes are referenced rather than copied into
every downstream context/evaluation record.

Theme, application-state, viewport, and authenticated-state applicability are
checked before reference fidelity is interpreted through the released v0.7
compatibility path, which reuses v0.4 comparability conventions. If reference
and candidate do not represent compatible intended states, the result is
explicitly incompatible/incomparable rather than a fabricated visual difference
set. v0.8, released as package version `0.8.0`, displays this result exactly
as required rather than redefining the state model - see "v0.8 Batch 5"
below.

The constraints above were carried out by the actual v0.7 implementation
described in "v0.7 Prompt 1" through "v0.7 Prompt 8" below: explicit
identity/provenance, applicability/compatibility, region-to-target bindings,
requested/expected-dependent/protected/preserved reuse, and the non-mutating
Chromium/correlation boundaries all remain as constrained here. v0.8 (see
"v0.8 Batch 1" through "v0.8 Batch 8" below) applied them unchanged; they
continue to apply unchanged to the still-future v0.9-v0.10 work.

The exact public artifact names, schema versions, persistence layout, supported
image formats, coordinate model, requirement/tolerance primitives, and fidelity
behavior were frozen by the actual v0.7 implementation below, not by earlier
planning language. Style/asset-similarity mechanisms remain future unless
separately implemented.

## v0.8 Batch 1 (Viewer runtime and PWA foundation) — implemented

Batch 1 of the frozen `docs/plans/v0.8-implementation-plan.md` establishes
only the viewer runtime/build shell — no evidence indexing, artifact reading,
or evidence UI. It does not implement any of the v0.7-derived reference/
fidelity/binding display constraints above; those remain future work for
later v0.8 batches, which must consume this runtime boundary rather than
redefine it.

```text
my-frontend-observer view --root <evidence-root>
        |
        v
  thin CLI dispatch (src/cli.ts: parseViewArgs/runViewCommand)
        |
        v
  viewer application seam (src/viewerServer/viewerService.ts: startViewer)
        |
        v
  Node local server, loopback-only (src/viewerServer/httpServer.ts)
        |
        +---------------------+----------------------+
        |                                             |
        v                                             v
  built viewer assets (dist/viewer)          GET /api/status
  (React + TypeScript + Vite PWA)            (session/root identity only)
```

- **Node server boundary** (`src/viewerServer/`): binds only to `127.0.0.1`
  on one fixed default port (`4319`, `src/viewerServer/port.ts`); serves only
  the built viewer assets plus the one read-only status endpoint; resolves
  every requested path against the built assets root and fails closed on any
  path that would resolve outside it; accepts no write HTTP methods; performs
  no artifact reading, browser observation, or mutation. `--root` is
  validated operationally (exists, is a directory) and exposed only as an
  opaque status string — it is never interpreted as Observer evidence in this
  batch.
- **Browser application** (`viewer/`): a React + TypeScript + Vite app, built
  independently of `src/` via `viewer/tsconfig.json` and `viewer/vite.config.ts`,
  output to `dist/viewer` inside the existing package `dist` allowlist (no
  second npm package). Renders an honest foundation shell only — product
  identity, live session status via `/api/status`, and placeholder
  navigation/workspace/details regions — never fabricated evidence.
- **PWA**: `vite-plugin-pwa` generates a web app manifest (`standalone`
  display, stable `start_url`/`scope`, installability icons) and a service
  worker that precaches only the built application shell. It declares no
  `runtimeCaching` rules, so future evidence/media/API routes remain
  network/server-backed rather than silently served as stale cached truth
  when the local server is unavailable (enforced by
  `tests/unit/viewerPwaBuild.test.ts`, which asserts on the actual built
  `sw.js`, not a hand-written approximation). An install affordance appears
  only when the browser actually fires `beforeinstallprompt`; its absence is
  shown honestly, never as a disabled-looking fake control.
- **CLI**: `view --root <evidence-root> [--port <n>] [--no-open]` remains a
  thin dispatcher — it parses syntax, delegates once to `startViewer`, prints
  the URL/root, and optionally best-effort opens the system browser (failure
  there is never fatal to server startup). All v0.1-v0.7 commands are
  unchanged.

This batch introduces no second observer, relationship engine, comparison
engine, contract engine, reference model, or bounded-context builder — there
is nothing yet for the viewer to consume beyond its own runtime identity.

## v0.8 Batch 2 (Evidence indexing, canonical readers, and lazy data boundary) — implemented

Batch 2 adds the safe, read-only data boundary between existing on-disk
Observer evidence and the Batch 1 viewer runtime, entirely under
`src/viewerServer/evidence/`. It introduces no new persisted artifact family,
no schema migration, and no second validator — every recognized candidate is
decided exclusively by the existing canonical reader/validator for its
family (`src/artifacts/*Reader.ts`).

```text
GET /api/index                     bounded discovery + classification -> metadata only
GET /api/artifacts/<handle>        one canonical-reader read, on demand -> full projection
GET /api/media/<handle>/<role>     one resolved, contained media file, streamed on demand
```

- **Discovery** (`evidence/discovery.ts`): a bounded, deterministic walk
  beneath `--root` that opens only files literally named `manifest.json` (the
  one filename every current persisted family uses) — no other file is ever
  read or classified, so arbitrary files can never become evidence merely by
  existing under the root. Directory entries that are symlinks/junctions are
  never followed. Bounds (`evidence/limits.ts`): traversal depth 6,
  directories visited 2000, candidate manifests 1000, index records 500,
  manifest read size 2,000,000 bytes — chosen after inspecting that every
  current writer produces a shallow `<outputLocation>/<id>/manifest.json`
  shape (see `docs/CONTRACTS.md`), not a deep tree.
- **Classification is not validation** (`evidence/classify.ts`): peeks only
  `artifactKind`/`schemaVersion` (plus, where the shared kind is ambiguous,
  tries each existing reader/validator in turn — e.g. baseline vs. per-change
  contract) to decide *which* existing canonical reader to call; the reader's
  own structural validator remains the sole authority. Six honest, mutually
  exclusive states: `supported`, `unsupported-version`, `invalid-structure`,
  `unrecognized-kind`, `malformed-json`, `unreadable` — never collapsed into
  one boolean, and never conflated with an artifact's own `completion`
  state (passed through separately, only for the families that carry one:
  observation and external-reference). A manifest declaring the
  `bounded-agent-context` kind is classified `unrecognized-kind`: v0.6/v0.7
  never added a disk writer/reader for that family (confirmed via direct
  source inspection and `@dailephd/my-dev-kit` search), so Batch 2 does not
  invent persistence-shaped handling for it.
- **Viewer handles** (`evidence/handles.ts`, `evidence/pathSafety.ts`): a
  handle is a family-prefixed, percent-encoded, root-relative directory path
  — never a raw filesystem path accepted from the browser. Every route that
  accepts a handle re-decodes and re-resolves it against the evidence root,
  re-checks containment, and re-classifies that one candidate before serving
  anything; a handle whose backing directory or manifest no longer matches
  what was indexed fails closed as unknown, never stale.
- **Ephemeral projection** (`evidence/projection.ts`): `EvidenceMetadataRecord`
  (bounded, `/api/index`-shaped: handle, family, support state, logical id,
  schema version, completion where applicable, media availability summary,
  a handful of related ids) and `EvidenceArtifactDetail` (the already-
  validated domain object, wrapped with `handle`/`family` — no new evidence
  schema, no recomputation, no persistence).
- **Media resolution** (`evidence/mediaResolver.ts`): `screenshot` (observation),
  `image` (imported external reference), and `source-image` (approved
  external reference) are the only three recognized roles. An approved
  reference's image is never assumed to live in the approved artifact's own
  directory — its `sourceReference.referenceId` is looked up against the
  current index to find the actual owning imported artifact
  (`evidence/index.ts#findImportedReferenceDir`), exactly matching the v0.7
  reference-ownership contract in `docs/CONTRACTS.md`. A genuinely missing
  screenshot/image/source artifact is reported as 404, never fabricated.
- **PWA cache boundary preserved, not re-verified from scratch**: every new
  route lives under `/api/`, already covered by Batch 1's
  `denylist:[/^\/api\//]` navigation-fallback rule — no new `runtimeCaching`
  entry was needed or added (`tests/unit/viewerPwaBuild.test.ts` asserts this
  against the real built `sw.js`).
- **Minimal UI** (`viewer/src/hooks/useEvidenceIndex.ts`,
  `useArtifactDetail.ts`, `components/EvidenceList.tsx`,
  `ArtifactPreview.tsx`): a bounded evidence list (metadata-first) plus
  on-demand full-artifact loading on selection, with every support state
  shown honestly. No screenshot rendering, SVG overlay, or comparison/
  contract/reference visualization exists yet — that begins in Batch 3.

## v0.8 Batch 3 (Runtime observation inspection and SVG overlays) — implemented

Batch 3 makes one already-supported `ObservationArtifact` (Batch 2's data
boundary, unchanged) genuinely understandable: a real screenshot, SVG target
overlays in the observation's own canonical coordinate domain, target
selection/inspection, and canonical layout-relationship display. No second
relationship engine, no client-side evidence derivation, no new persisted
artifact.

**Coordinate audit (the load-bearing decision for this batch)**: target
geometry (`TargetGeometry.x/y/width/height`) is captured via
`el.getBoundingClientRect()` (`src/browser/evidenceCapture.ts`) - CSS pixels,
relative to the current viewport's top-left, at the same live page state the
screenshot is taken from. The screenshot itself is `page.screenshot({type:
'png'})` (`src/browser/chromiumAdapter.ts`), Playwright's default
(non-fullPage) mode, against a browser context created with no
`deviceScaleFactor` override (`browser.newContext({viewport})`) - so it
defaults to `1`, meaning every observation this repository can currently
produce has a screenshot whose raw PNG pixel dimensions equal
`requestConfig.viewport.width × requestConfig.viewport.height` exactly (1
CSS pixel = 1 PNG pixel). `requestConfig.viewport` (a required, strongly-typed
field on every valid `ObservationArtifact`, distinct from the loosely-typed
`pageEvidence` bag) is therefore the canonical, always-present source for the
SVG display frame.

**SVG coordinate model** (`viewer/src/components/TargetOverlaySvg.tsx`): the
`<svg>` root's `viewBox` is `0 0 {requestConfig.viewport.width}
{requestConfig.viewport.height}` - the exact frame `getBoundingClientRect()`
already used. The screenshot loads into a `<image>` element filling that same
viewBox (`preserveAspectRatio="none"`, since the two frames are already
pixel-identical). Target `<rect>` elements use `geometry.x/y/width/height`
completely unchanged - no rounding, no `devicePixelRatio` multiplication, no
clamping; geometry lying partly outside the viewBox is drawn at its real
coordinates and clipped only by the SVG root's default `overflow: hidden`
(a display-only effect, verified never to touch the underlying evidence
value - `tests/unit/observationCoordinateMapping.test.ts`). This is robust
even if a future capture path used a different `deviceScaleFactor`: the
`<image>`/viewBox scaling is presentation-only browser behavior, never a
manual pixel calculation in this codebase. `devicePixelRatio` (captured as
`pageEvidence.devicePixelRatio`) is shown as informational observation-level
evidence only and is never consulted for any geometry calculation.

**Server additions** (`src/viewerServer/evidence/observationView.ts`, one new
route `GET /api/observations/<handle>/relationships`): the only new
server-side computation this batch adds is one thin, defense-in-depth-wrapped
call to the existing canonical, pure `deriveLayoutRelationships` (`src/domain/
relationships.ts`) - never a second relationship predicate implementation.
Mirrors the exact handle-decode → contained-dir-resolve → re-classify
discipline `loadArtifactByHandle`/`resolveMedia` already established in
Batch 2; a handle for a non-`observation` family or a non-`supported`
candidate is rejected (`409`) before derivation is even attempted. The
existing `GET /api/artifacts/<handle>` (full `ObservationArtifact`) and
`GET /api/media/<handle>/screenshot` (Batch 2, unchanged) remain the only
other data sources the observation workspace uses - no new artifact
projection endpoint was needed, since the full validated domain object
already contains everything the target/observation inspector displays.

**Client-side presentation only** (`viewer/src/observation/targetOrder.ts`,
`viewer/src/components/{ObservationWorkspace,TargetList,TargetOverlaySvg,
ObservationInspector,EvidenceFieldView}.tsx`): React selects, orders
(by the observation's own authored `requestConfig.targets` order, not
incidental object-key order), and formats already-fetched canonical fields.
It never resolves targets, computes relationships, or derives
visibility/overflow/scroll-owner semantics - `deriveLayoutRelationships`
runs exclusively on the server (above). An unresolved target (`not-found`/
`ambiguous`/`unavailable`) is selectable from the target list and shown
honestly in the inspector, but never receives a fabricated `<rect>` -
`orderedTargets()`'s `hasGeometry` flag is `true` only when
`geometry.state` is `'available'` or `'partial'`.

**Selection**: viewer presentation state only (React `useState`, reset on
observation change), never persisted, synchronized in both directions
between the target list, the SVG `<rect>` (`role="button"`, keyboard-
operable), and the inspector via the target's existing stable `name`.

**Overlay toggles**: geometry, labels (disabled when geometry is off), and
relationships - each independently toggleable and purely presentational
(hiding/showing already-rendered elements), never altering the underlying
evidence or the fetched artifact/graph.

**PWA cache boundary preserved**: the new `/api/observations/*` route lives
under the same `/api/` prefix Batch 1's `navigateFallbackDenylist` already
denylists - no service-worker configuration change was needed
(`tests/unit/viewerPwaBuild.test.ts` asserts this against the real built
`sw.js`).

## v0.8 Batch 4 (Before/after comparison and contract/change-scope inspection) — implemented

Batch 4 exposes the existing v0.4 `ComparisonArtifact` and v0.5
`FrontendContractEvaluationArtifact` through the viewer, entirely under
`src/viewerServer/evidence/{linkedEvidence,comparisonView,evaluationView}.ts`
and `viewer/src/components/{ComparisonWorkspace,EvaluationWorkspace,
ComparisonObservationPane,ClauseResultRow}.tsx`. **`compareObservations` and
`evaluateFrontendContract` are never called anywhere in this batch** - every
displayed comparison/evaluation field is read unchanged from its persisted
artifact via the existing Batch 2 `GET /api/artifacts/<handle>`.

- **Exact linked-evidence resolution** (`evidence/linkedEvidence.ts`): given
  a `ComparisonSourceObservationReference`/`FrontendContractObservationReference`,
  a `comparisonId`+`comparisonRequestId` pair, or a `baselineId`/`contractId`,
  resolves the matching indexed artifact by **exact identity only**
  (`observationId`+`requestId`+`producer.version`+`observationSchemaVersion`
  for observations; the id fields themselves for comparisons/contracts) -
  never by folder name, screenshot filename, URL, target-set, or geometry
  similarity. Zero matches → `missing`; two or more exact matches →
  `ambiguous` (never silently picks one). Mirrors the exact bounded-walk
  pattern Batch 2's `findImportedReferenceDir` already established.
- **Two additive, read-only routes**: `GET /api/comparisons/<handle>/view`
  (resolves the comparison's `before`/`after`) and
  `GET /api/evaluations/<handle>/view` (resolves `comparison`, `baseline`,
  `change`, `before`, `after`) - both under `/api/`, both GET/HEAD-only, both
  returning only resolved-handle-or-missing-or-ambiguous status, never a
  duplicated copy of the linked artifact's own payload (the browser fetches
  that separately through the existing `GET /api/artifacts/<handle>`, reusing
  Batch 2's on-demand-loading contract exactly).
- **Before/after visual reuse, not reimplementation**: `ComparisonObservationPane.tsx`
  is built entirely from Batch 3's existing lower-level primitives
  (`useArtifactDetail`, `orderedTargets`, `TargetOverlaySvg`) - no second
  screenshot-loading, coordinate-transform, or geometry-rendering code
  exists. The comparison's own persisted `relationshipsBefore`/
  `relationshipsAfter` are passed directly into `TargetOverlaySvg`'s existing
  `relationships` prop - never recomputed via `deriveLayoutRelationships`.
  `TargetOverlaySvg` gained one small additive, optional `highlightNames`
  prop (alongside the existing single-select `selected`) so a
  relationship-subject difference or a two-target contract primitive
  (`targets-do-not-overlap`, `target-fits-inside`, etc.) can emphasize both
  named targets at once without changing Batch 3's existing single-select
  interaction contract.
- **Difference/relationship-change/clause presentation is evidence display,
  not re-derivation**: `ComparisonWorkspace.tsx` renders `differences`,
  `relationshipChanges`, `configurationChanges` (kept visually distinct from
  appeared/disappeared runtime differences), and `expectedDependencyEvidence`
  exactly as persisted, labeling dependency outcomes as explicit non-causal
  evidence. `comparability` (comparable/comparable-with-warnings/incomparable
  plus blocking/warning/unassessed reasons) is shown honestly; an
  `incomparable` result is visually unmistakable
  (`.comparability-banner--incomparable`).
- **Clause joining by exact `clauseId` only** (`EvaluationWorkspace.tsx`):
  baseline clauses (from the linked `PersistentBaselineContract`) and
  per-change clauses (from the linked `PerChangeContract`) are joined to the
  evaluation's `clauseResults` by exact id - never by target/primitive-shape/
  category/position. A `clauseId` absent from both loaded contracts is shown
  as an honest "unresolved clause definition", never fabricated. Baseline
  clause active/superseded status comes exclusively from the evaluation
  artifact's own `activeBaselineClauseIds`/`supersededBaselineClauseIds` -
  never recomputed from clause overlap. `pass`/`fail`/`unavailable`/
  `conflict` are preserved exactly (never collapsed to a boolean);
  `unavailable` shows its reason, `conflict` shows its reason and
  `conflictingClauseIds`.
- **Overall verdict is authoritative and unmistakable**: `overallVerdict`
  (`PASS`/`FAIL`) is rendered directly from the artifact, in a large
  `.overall-verdict--PASS`/`.overall-verdict--FAIL` banner - the UI never
  computes it from visible rows. The required safety case (a `requested`
  clause `pass` alongside a `protected`/`preserved` clause `fail` still
  producing overall `FAIL`) and the all-pass case are both proven against
  real, canonically-evaluated fixtures (`tests/support/evidenceFixtures.ts#writeFullPipelineFixture`/
  `writeAllPassPipelineFixture`) in real Chromium
  (`tests/browser/comparisonEvaluationWorkspace.test.ts`) - `overallVerdict`
  is never hand-edited to construct either demonstration.
- **Target/relationship cross-highlighting uses only explicit canonical
  identity**: `primitiveTargetNames()` (`viewer/src/contract/clauseTargets.ts`)
  extracts a contract primitive's named target field(s) (`target`, `targetA`/
  `targetB`, `target`+`container`, `subjectTarget`/`relatedTarget`) by an
  exhaustive switch over `ContractPrimitiveKind` - page-level primitives
  (`document-width-fits-viewport`, `scroll-owner-is-document`) return no
  names, so clicking them never fabricates a target highlight.
- **PWA cache boundary preserved**: both new routes live under `/api/`,
  already covered by Batch 1's `navigateFallbackDenylist`; verified against
  the real built `sw.js`.

## v0.8 Batch 5 (External reference and reference/candidate inspection) — implemented

- **Reference indexing/media already existed (Batch 2), unchanged**: the
  `external-reference-imported`/`external-reference-approved` families,
  `GET /api/media/<handle>/image` (imported), and
  `GET /api/media/<handle>/source-image` (approved, resolved through
  `findImportedReferenceDir`'s exact `referenceId` walk) were already built
  in Batch 2 and required no change here - Batch 5 only adds the visual
  workspace consuming them.
- **Two new additive, read-only routes**
  (`src/viewerServer/evidence/referenceView.ts`):
  `GET /api/references/<handle>/view` derives the selected reference's own
  region-relationship graph (`deriveReferenceRegionRelationships`) and
  requirement adequacy (`deriveReferenceRequirementAdequacy`) - both pure
  functions over the artifact's own persisted `regions`/`requirements`,
  never persisted, never a second derivation engine (mirrors Batch 3's
  `getObservationRelationships` server-side-derivation pattern).
  `GET /api/references/<handle>/candidate/<handle>/view` evaluates
  reference/candidate compatibility through the existing canonical
  `evaluateReferenceCandidateCompatibility` (never a second, viewer-owned
  compatibility model) and separately lists every existing
  `FrontendContractEvaluationArtifact` whose own persisted `after` reference
  exactly identifies the candidate, for explicit, never-auto-selected
  optional display.
- **Reference-image SVG coordinate model is a genuinely distinct domain from
  the candidate's runtime SVG** (`ReferenceRegionOverlaySvg.tsx`): `viewBox`
  is the reference image's own pixel dimensions (never the candidate's CSS
  viewport, never devicePixelRatio-multiplied); each region's canonical
  `{x, y, width, height}` is rendered unchanged. Because this is a different
  coordinate domain and data source from `TargetOverlaySvg` (runtime CSS
  pixels, `TargetGeometry`), it is a separate, sibling component rather than
  a parameterization of the existing one - reuse would have silently
  conflated the two domains. The candidate side, in contrast, reuses Batch
  3/4's exact `ComparisonObservationPane`/`TargetOverlaySvg` machinery
  unchanged (a synthetic `{status:'resolved', handle}` `LinkStatus` is
  constructed once a candidate is explicitly chosen).
- **Reference region selection and runtime target selection are two
  independent, never-synchronized selection domains**
  (`ReferenceWorkspace.tsx`): selecting a reference region never selects or
  highlights a runtime target, even when both happen to share the same
  string name (proven with a real Chromium fixture deliberately naming both
  `"header"` - `tests/browser/referenceCandidateWorkspace.test.ts`, Case E).
  No binding connector/highlight-across-panes exists in this batch - that is
  Batch 6's explicit-binding-interaction scope.
- **Compatibility vs. reference adequacy vs. candidate fidelity are kept
  strictly distinct, never conflated**: compatibility
  (`comparable`/`comparable-with-warnings`/`incomparable` plus
  blocking/warning/unassessed reasons) comes only from
  `evaluateReferenceCandidateCompatibility`; reference-side requirement
  adequacy (`adequate`/`partial`/`inadequate`) comes only from
  `deriveReferenceRequirementAdequacy`; candidate fidelity is never computed
  in this batch at all - the UI always shows an explicit "not evaluated in
  this batch" note rather than ever implying a fidelity PASS from a
  compatibility PASS or an adequate reference (task §32/§33 boundary,
  `evaluateReferenceCandidateFidelity` is never imported/called anywhere in
  Batch 5).
- **Optional contract/evaluation context is opt-in, never inferred**
  (`ReferenceWorkspace.tsx`): when the reference/candidate view lists more
  than one exactly-matching evaluation artifact, the developer must
  explicitly pick one from a `<select>` - the newest/first match is never
  silently chosen, and with zero selected the candidate's contract status
  reads "not selected/not available", never a fabricated PASS.
- **Imported vs. approved image ownership preserved exactly as Batch 2 built
  it**: an imported reference's image is fetched from its own directory; an
  approved reference's image is fetched from its exact imported source via
  `sourceReference.referenceId`, never assumed co-located, never
  duplicated - proven with a real Chromium fixture asserting the two
  `<image href>` values resolve to the `image`/`source-image` roles
  respectively (Cases A/B).
- **PWA cache boundary preserved**: both new routes live under `/api/`,
  already covered by Batch 1's `navigateFallbackDenylist`; verified against
  the real built `sw.js` (no new `registerRoute`, no `/api/references`
  precache entry).

## v0.8 Batch 6 (Explicit-binding interaction, zoom/pan, conditional lock, and on-demand reference fidelity) — implemented

- **`view --bindings-file <json-file>`**: reuses the exact same operational
  binding-file wrapper parser (`loadBindingsFile` in `src/cli.ts`) that
  `evaluate-reference-fidelity --bindings-file` already used - one shared
  parser, never a second divergent one. The file is read once at startup;
  its declarations become `ViewerServerState.bindingDeclarations` (an opaque
  `unknown[]` until validated against a specific reference); the file path
  itself is never persisted, returned, or exposed to the browser. Reference-
  specific declaration validity (region existence, shape) is deferred to the
  moment a reference is actually selected server-side, via the existing
  canonical `isValidReferenceRuntimeBindingDeclarations` - never checked at
  startup without a reference.
- **Two new additive, read-only routes**
  (`src/viewerServer/evidence/referenceView.ts`):
  `GET /api/references/<handle>/candidate/<handle>/bindings` validates the
  session's declarations against the selected reference and calls the
  existing canonical `evaluateReferenceRuntimeBindings` exactly once.
  `GET /api/references/<handle>/candidate/<handle>/fidelity` is the explicit
  on-demand fidelity trigger - calls the existing canonical
  `evaluateReferenceCandidateFidelity` exactly once, using the exact same
  session declarations, so its embedded `bindings` field and the `/bindings`
  route's own result always structurally agree for identical inputs (same
  pure function, same arguments). Neither route persists anything; both are
  `GET` (idempotent, deterministic, ephemeral over already-selected explicit
  input) - no mutation route was added.
- **`deriveCoordinateScale` exported additively** from
  `externalReferenceFidelity.ts` (previously module-private) - Batch 6's
  view-lock eligibility reuses this exact function unchanged (same formula,
  same `ASPECT_RATIO_MAPPING_TOLERANCE`, same no-applicable-viewport
  failure) rather than a second aspect-ratio/scale implementation. The
  existing `GET /api/references/<handle>/candidate/<handle>/view` route now
  additionally returns `coordinateMapping: DeriveCoordinateScaleResult` -
  purely a function of the reference, independent of the candidate.
- **Explicit-binding cross-selection uses only canonical
  `ReferenceRuntimeBindingResult.referenceRegion`/`.runtimeTarget` fields**
  (`ReferenceWorkspace.tsx`): selecting a `bound` reference region
  highlights (via `TargetOverlaySvg`'s existing Batch 4 `highlightNames`
  prop - never the primary `selected`/`aria-pressed` target) its exact
  declared runtime target; selecting a runtime target highlights every
  region whose `bound` result names it (many-to-one, via a new additive
  `highlightRegionIds` prop on `ReferenceRegionOverlaySvg`, matching
  `TargetOverlaySvg`'s established highlight pattern). `ambiguous`/
  `unavailable` results never cross-select. Proven with a real equal-name
  ("header" region + "header" target) Chromium fixture: no cross-selection
  without an explicit declaration, real cross-selection with one.
- **Zoom/pan is a repository-owned, presentation-only hook**
  (`viewer/src/hooks/useZoomPan.ts`): bounded `[1x, 8x]` scale, `×1.25`/
  `÷1.25` step, expressed as one `{scale, focalX, focalY}` triple in the
  pane's own source-coordinate frame (reference-image pixels or candidate
  CSS pixels - never rewritten). Renders via an SVG `viewBox` override
  (additive `viewBoxOverride`/`svgRef`/pointer-handler props on
  `TargetOverlaySvg`/`ReferenceRegionOverlaySvg`, defaulting to Batch 3/5's
  exact prior behavior when omitted) - image and overlay stay one
  transformed unit automatically since both live inside the same `<svg>`
  root, and native SVG hit-testing means selection keeps working correctly
  under zoom/pan with no extra coordinate math. Panning uses the SVG
  element's own `getScreenCTM()` to convert screen-space pointer deltas into
  source-space deltas - reuses the browser's native transform rather than a
  custom aspect-ratio-aware pixel calculation - and only engages (calling
  `setPointerCapture`) once the pointer has moved past a small threshold, so
  an ordinary click on a region/target rect is never hijacked into a
  phantom drag. Fit and Reset are the same fitted-1x/centered default (task
  §26 - no second presentation-only default was introduced).
- **View lock reuses one single shared state, never two independently
  synchronized states**: `ReferenceWorkspace.tsx` owns `refZoom`/`candZoom`
  directly (always-controlled `useZoomPan` calls) and each pane's zoom/pan
  action handler updates both states in one synchronous call when locked -
  no reactive effect watches one pane's state to update the other, so no
  feedback-loop risk exists. Lock is available only when a candidate is
  selected, compatibility is not `incomparable`, and `coordinateMapping.ok`
  is `true`; any change to that eligibility (including selecting a
  different reference/candidate) immediately disables lock and shows an
  actionable reason. Synchronization converts a candidate CSS-pixel focal
  point/scale into reference-image-pixel space (and back) using only
  `coordinateMapping.scale.scaleX`/`scaleY` - the exact same canonical
  factor `deriveCoordinateScale` already produces, applied as a straight
  multiply/divide (its own algebraic inverse), never a second mapping rule.
- **Contract/fidelity independence is never collapsed into one status**:
  the existing Batch 5 "Optional contract/evaluation context" section
  (unchanged) and the new on-demand `ReferenceFidelityPanel` are two
  separate sections rendering two separate canonical results
  (`FrontendContractEvaluationArtifact.overallVerdict` and
  `ReferenceCandidateFidelityEvaluation.state`) side by side; when both are
  present, an explicit note states that fidelity does not override an
  active contract failure. No new coordinator/aggregate verdict is computed
  anywhere in this batch.
- **PWA cache boundary preserved**: both new routes live under `/api/`,
  already covered by Batch 1's `navigateFallbackDenylist`.

## v0.8 Batch 7 (Bounded agent context, correlation, provenance, and raw evidence navigation) — implemented

- **Bounded agent context remains programmatic-only**: no filesystem writer
  was added for `BoundedAgentContextArtifact` (it is still not an
  Observer-evidence-root artifact family - `src/viewerServer/evidence/classify.ts`'s
  "known but unreadered kind" comment is unchanged). `view --context-file
  <json-file>` reads exactly one already-serialized
  `BoundedAgentContextArtifact` value directly (no wrapper object) as
  explicit, session-only viewer input - read once at startup
  (`src/cli.ts#loadContextFile`, mirroring `loadBindingsFile`'s exact
  read/size-bound/parse shape), classified by
  `src/viewerServer/context.ts#classifyContextFileContent` (reuses the
  existing canonical `isValidBoundedAgentContextArtifact` - never a second
  validator), and held only in `ViewerServerState.context` for the life of
  the process. The file's size is bounded by the existing Batch 2
  `MAX_MANIFEST_CANDIDATE_BYTES` (2,000,000 bytes) rather than a second
  bound, since a context artifact's own frozen numeric caps already make it
  far smaller in any realistic case.
- **Three honest session states, never coerced into one another**: `'none'`
  (no `--context-file`; every Batch 1-6 feature stays fully available),
  `'unsupported-version'` (recognized `artifactKind`, a `schemaVersion`
  other than the current one - the viewer still starts, showing this
  state explicitly rather than either failing or misinterpreting the
  fields), and `'valid'` (structurally validated current-schema context).
  Every other problem (unreadable file, wrong `artifactKind`, a
  structurally invalid *current*-schema artifact) fails viewer startup
  clearly - an explicitly supplied file is never silently ignored.
- **`GET /api/context`** (`httpServer.ts`) returns the session's exact
  classified state; for `'valid'`, it additionally returns
  `sourceResolution` - the result of resolving
  `artifact.sources` against the current evidence root by **exact
  canonical identity only**
  (`src/viewerServer/evidence/contextSourceView.ts`, reusing/extending
  Batch 4's `linkedEvidence.ts` resolver pattern with three additive
  functions: `resolveObservationById` (bare `observationId`, the only
  identity a context source reference actually carries),
  `resolveEvaluationByIdentity`, and `resolveReferenceByIdentity`). Zero
  matches → `missing`; two or more → `ambiguous` (never silently picks
  one) - the same discipline every other Batch 4/5 resolver already
  established.
- **Raw structured evidence reuses the existing Batch 2 artifact-detail
  route unchanged**: `RawEvidenceViewer.tsx` calls the existing
  `useArtifactDetail`/`GET /api/artifacts/<handle>` for any exactly-resolved
  source - no second full-artifact retrieval mechanism, no local filesystem
  read, no arbitrary path accepted from the browser.
  `EvidenceReference.path` values are always displayed as plain provenance
  text, never passed to `fs.readFile`/`path.resolve`/a static file server.
- **Bounded runtime targets, adequacy, omissions, truncations, and
  correlation are rendered exactly as the validated artifact states them** -
  never recomputed, never boolean-collapsed
  (`ContextWorkspace.tsx`): `Adequacy.state`
  (`adequate`/`partial`/`inadequate`) and reasons are shown verbatim;
  absent bounded-target fields render "not included in this bounded
  context", never a fabricated falsy/zero value; `required: true`
  omissions/truncations render in a visually distinct
  `.context-required-loss` block, separate from optional ones;
  `correlations` absent renders "Static correlation not included in this
  context" - never "unavailable" (that status is reserved for a real
  per-target `RuntimeStaticCorrelationRecord` with zero candidates).
  `correlated`/`ambiguous`/`unavailable` are preserved exactly; a
  `correlated` record's one candidate is labeled "Correlated candidate", an
  `ambiguous` record shows **every** supplied candidate with none visually
  promoted, and `unavailable` fabricates zero candidates - matching the
  frozen `CORRELATION_STATUSES` invariants
  (`domain/boundedAgentContext.ts`) the validator itself already enforces.
  All new UI text was audited against ownership/edit-authorization language
  (no "owner"/"source owner"/"owned by") - correlation is presented as
  evidence, never as edit authorization.
- **Context-target ↔ runtime-target interaction never infers source
  ownership**: selecting a bounded target or a correlation record uses only
  exact `targetId`/`runtimeTargetId` string matching; for each *exactly
  resolved* source observation, `SourceObservationTargetCheck` checks
  membership in that observation's own already-fetched `targetEvidence`
  (a plain lookup over already-loaded JSON, never a new derivation) and, if
  more than one resolved source observation contains the same target id,
  lists all of them rather than picking one.
- **Bounded reference-fidelity projection is never recomputed, and is kept
  visibly distinct from a live on-demand evaluation**: absent `fidelity`
  renders "Reference fidelity not included in this bounded context" - never
  implied as passing. When present, `mismatches` and `protectedContext` are
  rendered in separate sections from the artifact's own fields exactly as
  supplied; a `state: 'not-evaluated'` blocked projection always shows
  `blockedBy` prominently and never renders an empty mismatch list as "no
  problems". When the context's `referenceId`/`candidateObservationId`
  exactly resolve within the current evidence root, `ContextWorkspace.tsx`
  embeds the existing, unchanged Batch 6 `ReferenceFidelityPanel` (the same
  on-demand `evaluateReferenceCandidateFidelity` trigger) directly beneath
  the bounded projection, labeled "Bounded context fidelity projection"
  above and "Current on-demand fidelity evaluation" below - two separate,
  clearly labeled evidence instances, never silently merged or replaced.
- **No runtime rebuild of context or correlation, and no my-dev-kit
  execution from the shipped viewer**: grep-verified - `projectBoundedAgentContext(`,
  `deriveRuntimeStaticCorrelations(`, and `attachRuntimeStaticCorrelations(`
  appear nowhere under `src/viewerServer/` or `viewer/src/` (only in test/
  fixture-generation code, per the frozen plan's explicit test-fixture
  exception); no `child_process`/`npx @dailephd/my-dev-kit` invocation
  exists in the viewer server or browser bundle.
- **PWA cache boundary preserved**: `GET /api/context` lives under `/api/`,
  already covered by Batch 1's `navigateFallbackDenylist`.

## v0.8 Batch 8 (Integrated viewer acceptance, PWA hardening, and packaged proof) — implemented

Batch 8 is the final v0.8 implementation batch. It is integration/hardening,
not a new architecture layer: no new API route, no new CLI flag, and no new
canonical-engine call site were added. See
`docs/reports/v0.8-integrated-viewer-acceptance-batch8.md` for the full
record.

- **Closed three named real-browser coverage gaps**, each proved against the
  actual built viewer through the actual loopback server, never a hand-edited
  fixture verdict: many reference regions bound to one runtime target all
  cross-highlight together (the pre-existing target→regions loop in
  `ReferenceWorkspace.tsx` already iterated every matching binding - the gap
  was in real-browser proof, not in the derivation); reference-fidelity
  `fail` alongside a genuine frontend-contract `PASS` for the same candidate
  display independently (the pre-existing independence note in
  `ReferenceWorkspace.tsx` was already verdict-agnostic); a bounded context
  whose sources include two observations sharing a stable target id lists
  every matching source observation (the pre-existing
  `SourceObservationTargetCheck` in `ContextWorkspace.tsx` already checked
  membership per source independently, never picking one).
- **One real accessibility defect found and fixed**: a cross-highlighted,
  non-selected region/target `<rect>` (`TargetOverlaySvg.tsx`,
  `ReferenceRegionOverlaySvg.tsx`) exposed no accessible state distinguishing
  it from a plain unselected rect - `aria-pressed` correctly stayed `false`
  (it is not the primary single-selection), but nothing else communicated
  the highlight to assistive technology. Fixed by adding
  `data-highlighted="true"` and an `aria-label` suffix
  (`" (highlighted: related to current selection)"`) when highlighted and
  not selected, leaving `aria-pressed` semantics untouched.
- **First live-browser PWA proof suite** (`tests/browser/pwaHardening.test.ts`):
  real service-worker registration and activation against the built shell;
  the manifest fetched and confirmed `display: "standalone"`; zero Cache
  Storage entries under any `/api/` pathname after normal use, confirming
  the `navigateFallbackDenylist` boundary holds live, not just in the built
  `sw.js` regex; and the hard server-down gate - after the server is closed
  and the same page reloaded, the app shell still renders from the precache,
  but the evidence-dependent surface shows the explicit
  `.evidence-list__error` "Evidence index unavailable" state, with the
  previously-visible evidence asserted absent. Install-control is proven
  only via synthetic `beforeinstallprompt` dispatch (a genuine browser
  install prompt was not observed under automation). Standalone-mode CDP
  display-mode emulation was attempted but not observed to take effect -
  recorded honestly, never overstated as actual OS-level installation proof.
- **Packaged-candidate proof**: `npm pack` → clean consumer install (outside
  the repository) → the actually-installed CLI executable (not repo
  `dist/cli.js`) → the installed `view` server → real Chromium against the
  packaged/installed server, not a source-checkout dev server. Read-only
  evidence-hash proof (SHA-256 of every file in the exercised evidence root,
  taken before and after the packaged-browser session) confirmed no
  mutation and no new viewer-created artifact anywhere in the evidence root.
- **Re-confirmed the no-second-engine invariant** across all eight batches by
  re-running the exact `grep -rn` audit from earlier batches - unchanged
  findings, no duplicate evidence engine exists.

## Retained v0.1 architecture constraints

v0.1 planning preserved these approved boundaries without treating module
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
applications external. Versions before v0.6 did not add runtime coupling to
sibling ecosystem projects. v0.6 adds only explicit bounded context and
correlation/export contracts within this repository, preserving independent
ownership; orchestrator-consumption and lab-compatibility work are separate
sibling-repository deliverables, not part of this repository's architecture.

The text/config-driven coding-agent workflow and the non-UI external-reference
evidence foundation are operational as of v0.7. The viewer and annotation
layers must consume the same canonical observation, relationship, comparison,
contract, change-scope, reference, correlation, and context boundaries rather
than creating parallel engines. The concrete implementation plan and module
layout for each future version must be designed only after that version's
planning workflow inspects the current repositories.

v0.7 Prompt 1 implements only the bottom of that external-reference stack: a
new, standalone `ExternalReferenceArtifact` evidence root
(`src/domain/externalReference.ts`, `externalReferenceImage.ts`,
`externalReferenceIdentity.ts`, `src/artifacts/externalReferenceArtifact{Writer,Reader}.ts`,
`src/application/externalReferencePersistenceService.ts`) with its own
identity, provenance, bounded image metadata, and a two-state
(`imported`/`approved`) lifecycle - see `docs/CONTRACTS.md` "v0.7 Prompt 1
external-reference artifact contract" for the exact shape. It follows the
same identity/persistence/diagnostics/export conventions as every existing
artifact family (deterministic canonicalize-then-sha256 request identity,
nonce-based fresh instance identity, atomic temp-dir-then-rename persistence,
the shared `DIAGNOSTIC_CODES` vocabulary) without reusing or duplicating the
observation, comparison, or contract engines themselves - an external
reference is desired-design evidence, never an `ObservationArtifact`, an
approved baseline, or a runtime target.

v0.7 Prompt 2 adds explicit reference regions and reusable reference-region
relationships on top of that foundation (`domain/externalReferenceRegions.ts`,
`externalReferenceRegionRelationships.ts`) - see `docs/CONTRACTS.md` "v0.7
Prompt 2 explicit reference regions and relationships" for the exact shape.
The relationship-derivation predicates are reused verbatim (now exported
additively) from `domain/relationships.ts` rather than reimplemented, so
reference-region geometry and runtime-target geometry can never diverge on
the same underlying formula; only the geometry-only relationship families
apply, since a static image exposes no DOM, scroll, or viewport evidence.
v0.7 Prompt 3 adds selected design requirements, tolerance semantics, and
reference-evidence adequacy on top of that region model
(`domain/externalReferenceRequirements.ts`,
`externalReferenceRequirementIdentity.ts`) - see `docs/CONTRACTS.md` "v0.7
Prompt 3 selected design requirements, tolerance semantics, and
reference-evidence adequacy" for the exact shape. Requirement categories are
the exact v0.5 `AuthoredChangeScopeCategory` vocabulary, imported directly
rather than reinvented, since that type carries no runtime-only coupling of
its own; tolerance is a genuinely new, reference-owned type (never a reuse
of `frontendContracts.ts`'s runtime/CSS-pixel-implicit `ContractTolerance`);
and reference-evidence adequacy is a small, independently-owned vocabulary
distinct from `boundedAgentContext.ts`'s runtime/static-correlation
`Adequacy`. A region property or derived relationship is never promoted to
an executable requirement automatically - only explicit user/configuration
selection does that.

v0.7 Prompt 4 adds explicit reference applicability
(`domain/externalReferenceApplicability.ts`) and observation-side explicit
state identity (`domain/explicitState.ts`, shared by both artifact
families), plus one new pure domain module,
`domain/externalReferenceCompatibility.ts`, that evaluates whether a
candidate `ObservationArtifact` describes the same frontend state as a
given `ExternalReferenceArtifact` - see `docs/CONTRACTS.md` "v0.7 Prompt 4
reference applicability and candidate-state compatibility" for the exact
shape. This is page/state-level only, never geometry or fidelity, and
remains a wholly separate concern from Prompt 3's reference-evidence
adequacy - the two can independently disagree (an adequate reference can be
incomparable against a given candidate, and vice versa). Rather than
inventing a second comparability engine, Prompt 4 extracts one new exported
pure helper from v0.4's own `domain/comparisonEngine.ts`
(`assessOptionalComparabilityDimension`) and reuses it from both v0.4's
`evaluateComparability` (Observation-vs-Observation) and the new
`evaluateReferenceCandidateCompatibility` (Reference-vs-Observation) - the
one additive behavior change to v0.4 itself is that `evaluateComparability`
now assesses (rather than always reporting unassessed) theme/authenticated-
state/application-state whenever both observations declare
`requestConfig.explicitState`, while every historical/legacy observation
pair retains the exact prior unassessed-only behavior. No new persisted
artifact kind is introduced for the compatibility result; it is a pure,
on-demand function of two already-persisted artifacts.

v0.7 Prompt 5 adds explicit reference-region <-> runtime-target binding
(`domain/externalReferenceRuntimeBinding.ts`) - see `docs/CONTRACTS.md`
"v0.7 Prompt 5 explicit reference-region <-> runtime-target binding" for
the exact shape. It answers only "which stable v0.2 runtime target does
this candidate observation resolve for each explicitly declared reference
region", strictly downstream of Prompt 4's compatibility gate (reused
verbatim, never duplicated) and strictly upstream of v0.6's own
runtime/static correlation - the two identity domains (a Prompt 2
`ReferenceRegion.id` and a v0.2 `NamedTarget.name`) never collapse into
each other, and this stage stops at the runtime target, never reaching
source ownership. Following v0.6's uncertainty discipline
(`domain/boundedAgentContextCorrelation.ts`), binding never guesses through
ambiguity - an ambiguously or unavailably resolved v0.2 target is reported
as such, never silently treated as bound - though the actual per-status
mapping (`bound`/`ambiguous`/`unavailable`) is binding's own, independently
owned vocabulary, not a reuse of v0.6's `correlated`/`ambiguous`/
`unavailable` correlation-status semantics (a different evidence boundary:
correlation ranks *static candidates* for one runtime target, whereas
binding resolves *one runtime target's own existence* for one declared
correspondence). No second target resolver, no browser execution, and no
new persisted artifact family were introduced; neither
`ExternalReferenceArtifact` nor `ObservationArtifact` is mutated to carry a
binding result, since a reference may later be evaluated against several
candidates and an observation against several references.

v0.7 Prompt 6 adds structured reference-vs-candidate fidelity evaluation
(`domain/externalReferenceFidelity.ts`, `application/referenceFidelityEvaluationService.ts`,
and the `evaluate-reference-fidelity` CLI command) - the first point in this
stack where a reference's authored expectation is compared against live
candidate evidence. See `docs/CONTRACTS.md` "v0.7 Prompt 6 structured
reference-vs-candidate fidelity evaluation" for the exact shape. It is
downstream of every prior v0.7 prompt and reuses each verbatim: Prompt 3's
`deriveReferenceRequirementAdequacy`/`deriveReferenceRequirementExpectation`/
`deriveReferenceRequirementMeasurement` (never redefined), Prompt 4's
`evaluateReferenceCandidateCompatibility` (a hard gate, never duplicated),
and Prompt 5's `evaluateReferenceRuntimeBindings` (the sole source of
runtime-target identity - no automatic binding, no second target resolver).
It also reuses v0.4's `deriveLayoutRelationships` for runtime relationship
evidence, scoped to the exact requested relationship family (the same
Prompt 3 bug-fix precedent). The one genuinely new problem this prompt
solves is the reference-image-pixel <-> CSS-pixel coordinate mapping: a
single explicit, deterministic full-frame scale derived from
`reference.applicability.viewport` and the reference image's own
dimensions, with a tiny independent aspect-ratio-coherence check (never a
design tolerance) gating whether that mapping exists at all. No new
persisted artifact family, no browser execution, and no source-ownership
attribution - this is reference fidelity only, a separate concern from any
later v0.5 baseline/per-change contract result or v0.7 overall verdict.

v0.7 Prompt 7 adds bounded reference-fidelity projection into the existing
v0.6 bounded-agent-context architecture (`domain/referenceFidelityProjection.ts`,
plus additive extensions to `domain/boundedAgentContext.ts`,
`domain/boundedAgentContextIdentity.ts`, and
`domain/boundedAgentContextProjection.ts`) - see `docs/CONTRACTS.md` "v0.7
Prompt 7 bounded reference-fidelity projection and v0.6 bounded-agent-
context integration" for the exact shape. `projectBoundedAgentContext`
itself, not a new parallel context system, gains one new optional input (an
already-computed Prompt 6 fidelity evaluation): fidelity-relevant runtime
targets fold into the exact same required/permitted-target-allocation,
evidence-tiering, omission/truncation, and adequacy machinery v0.5 contract
clauses already compete in, and a new `fidelity?` field on
`BoundedAgentContextArtifact` (mirroring `correlations?`'s own additive,
non-version-bumping precedent from v0.6 Batch 3) carries a bounded,
priority-ordered selection of Prompt 6's non-passing requirement results
plus passing protected/preserved context. No second bounded-context
architecture, no recomputation of Prompt 2-6/v0.4/v0.5 logic, and no change
to v0.6's own runtime/static correlation (`deriveRuntimeStaticCorrelations`/
`attachRuntimeStaticCorrelations` are untouched and reused exactly as
before) - a caller joins fidelity, target, and correlation evidence by the
one stable v0.2 runtime target id all three already share. Every new field
is optional and additive; a pre-Prompt-7 caller supplying no fidelity
evidence receives byte-identical output, including logical identity.

v0.7 Prompt 8 adds the first complete, controlled end-to-end external-
reference correction workflow (`domain/referenceCorrectionWorkflow.ts`,
`domain/referenceCorrectionIdentity.ts`) - see `docs/CONTRACTS.md` "v0.7
Prompt 8 controlled end-to-end external-reference coding-agent correction
workflow" for the exact shape. This is a narrowly-scoped coordinator, not a
second workflow engine: it exposes exactly two pure operations -
`prepareReferenceCorrection` (pre-change evidence -> a bounded coding-agent
handoff, built from Prompt 1/3/4/5/6/7's existing engines) and
`reviewReferenceCorrectionAttempt` (a fresh post-edit candidate -> one
composed overall result, built from v0.4's `compareObservations`, v0.7
Prompt 6's `evaluateReferenceCandidateFidelity`, and v0.5's
`evaluateFrontendContract`) - with an explicit, un-automatable seam between
them where an external implementation actor edits target source. Overall
`'pass'` requires both reference fidelity `'pass'` and v0.5 contract
evaluation `'PASS'` - matching the selected design reference is necessary
but never sufficient, so a candidate that visually satisfies the reference
while regressing an active protected or preserved contract clause still
resolves to overall `'fail'`. Review identity is a deterministic hash of
`{referenceRequestId, baselineObservationId, baselineContractId,
baselineContractClauses, changeContractId, changeContractClauses,
bindingDeclarations}`; attempt identity is a deterministic hash of
`{reviewRequestId, candidateObservationId}`. `reviewReferenceCorrectionAttempt`
rejects any call whose supplied `reviewRequestId` does not match what its own
baseline/contract/reference/binding inputs recompute - the mechanism that
makes "every attempt evaluates against the same approved baseline" an
enforced invariant, not just a documented one. No new persisted artifact
family, no CLI surface, and - most importantly - no code path anywhere in
this module (or anything it calls) that opens, parses, or writes a target
source file: real candidate capture remains the caller's own responsibility
through the existing, unmodified real-Chromium observation pipeline.
