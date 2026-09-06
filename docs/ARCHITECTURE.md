# Architecture

## Current package architecture

The current repository is one published TypeScript ESM package
(`my-frontend-observer@0.6.0`):

- `src/cli.ts` is the real, thin public CLI parsing/dispatch/presentation
  boundary for the current command surface (`observe`, `compare`,
  `approve-baseline`, `save-change-contract`, `evaluate-contract`); argument
  parsing and output formatting only, per command - the commands do not share
  domain semantics in the CLI. v0.6 adds no new CLI command.
- `src/index.ts` is the library entry point re-exporting the observer-owned
  contracts/functions from every layer below, including the v0.6 bounded-agent-
  context projection and runtime/static correlation surface.
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

## Planned v0.7–v0.10 reference-evidence architecture constraints

The external visual-reference capability is future work. It must extend the
current v0.1-v0.6 evidence architecture rather than becoming a UI-only feature
or a parallel visual-comparison stack.

The planned evidence domains remain distinct:

```text
runtime observation A ↔ runtime observation B
→ existing before/after comparison

approved baseline/per-change contract ↔ candidate runtime evidence
→ existing canonical contract evaluation

external visual reference ↔ candidate runtime evidence
→ future reference applicability + structured fidelity evaluation
```

An external reference is not an `ObservationArtifact`, and a reference region
is not a runtime target. The future implementation must preserve explicit
identity and provenance for the reference image/version, reference regions,
applicable viewport/theme/application state, authored requirements, tolerances,
approval/supersession state, and reference-region/runtime-target bindings.
Bindings may be explicit, ambiguous, unavailable, or another conservatively
defined state selected during planning; they must never silently become source
ownership.

The non-UI reference model and structured reference-vs-candidate evaluation
must be established in v0.7 before v0.8 consumes them. v0.8 may render
side-by-side images, overlays, measurements, bindings, provenance, and fidelity
results, but it must not invent a second reference model or evaluation engine.
v0.9 may author annotations against either runtime screenshots or external
references, but both coordinate/identity domains remain explicit and feed the
same canonical contract/change-scope semantics. v0.10 combines both visual
entry modes with the existing correction loop.

Where a reference requirement is executable, it must map into the existing
v0.5 requested/expected-dependent/protected/preserved semantics. Informational
or unassessed reference evidence remains non-executable until explicitly
promoted. Do not create reference-only PASS/FAIL semantics.

The reference evaluation should reuse existing relationship/value conventions
where they mean the same thing, and extend them only when evidence from a static
image or approved design intent genuinely requires a distinct type. Pixel or
image-region similarity may supplement structured evidence, especially for
asset-sensitive regions, but it must not replace browser-authoritative runtime
geometry, canonical contract evaluation, or explicit relationship evidence.

Candidate rendering still uses the one existing Chromium observation engine.
The observer remains non-mutating. `my-dev-kit` remains the static/source
evidence owner, and the v0.6 correlation/bounded-context boundary remains the
route for attaching relevant source evidence to reference-driven correction
packets. Heavy reference image bytes should be referenced rather than copied
into every downstream context/evaluation record.

Theme, application-state, viewport, and other applicability dimensions must be
checked before reference fidelity is interpreted. If reference and candidate do
not represent compatible intended states, the result must be explicitly
incompatible/incomparable rather than a fabricated visual difference set.
Planning should extend or reuse the canonical comparability/state model rather
than create unrelated reference-only state semantics.

The exact public artifact names, schema versions, persistence layout, supported
image formats, style-evidence vocabulary, tolerance primitives, and image-
similarity mechanisms are not frozen by this architecture document. They must be
designed from the current repository through the v0.7 planning workflow and
must follow existing identity, provenance, validation, boundedness, and portable-
artifact precedents.

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
evidence foundation must be operational before the viewer and annotation layers
are added. Those interfaces consume the same canonical observation,
relationship, comparison, contract, change-scope, reference, correlation, and
context boundaries rather than creating parallel engines. The concrete
implementation plan and module layout must be designed only after the relevant
version planning workflow inspects the current repositories.

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
resolves to overall `'fail'`. Review and attempt identity are both
deterministic hashes of stable semantic inputs (never a timestamp, never an
operational path), and `reviewReferenceCorrectionAttempt` rejects any call
whose supplied `reviewRequestId` does not match what its own
baseline/contract/reference/binding inputs recompute - the mechanism that
makes "every attempt evaluates against the same approved baseline" an
enforced invariant, not just a documented one. No new persisted artifact
family, no CLI surface, and - most importantly - no code path anywhere in
this module (or anything it calls) that opens, parses, or writes a target
source file: real candidate capture remains the caller's own responsibility
through the existing, unmodified real-Chromium observation pipeline.
