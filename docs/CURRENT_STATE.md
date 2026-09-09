# Current State

The project is published at package version `0.7.0` (roadmap v0.7,
End-to-End Coding-Agent Frontend Change Review; observation schema `1.2.0`;
comparison schema `1.0.0`; frontend contract schema `1.0.0`; evaluation
artifact schema `1.0.0`; bounded-agent-context schema `1.0.0`;
external-reference schema `1.0.0`) - see "v0.7 Prompt 8 status" below for
the final, complete v0.7 state.

**v0.8 (Interactive Local Observation Viewer) is implemented and tested in
the current repository - see "v0.8 status" below - but is not yet released.**
All eight v0.8 implementation batches, plus the hardened documentation/
implementation-completeness audit, have passed. Package metadata (this
repository's `package.json`/`package-lock.json`) still reports `0.7.0`;
`v0.8.0` has not been version-bumped, formally cross-platform/security
validated, release-prepared, tagged, or published to npm. The next workflow
stage is v0.8 pre-release readiness (cross-platform and security
validation) - not release preparation or publication.

## Greenfield foundation established

The retained repository contains:

- Node.js 24+ and TypeScript ESM package configuration;
- TypeScript build and typecheck configuration;
- ESLint configuration;
- a Vitest runner configured to report honestly when no tests exist;
- a safe `dist/` clean script;
- documentation validation;
- package allowlisting;
- `src/cli.ts` and `src/index.ts`, the package/library entry points originally
  established by the selected TypeScript CLI starter profile;
- complete repository-local Project Description, Project Milestones, ROADMAP,
  and standardized documentation.

The package bin (`src/cli.ts`) now exposes the real current public CLI
surface described below - the five commands released through `0.6.0`
(`observe`, `compare`, `approve-baseline`, `save-change-contract`,
`evaluate-contract`) plus three additional commands released as part of
`0.7.0` (`import-reference`, `approve-reference`,
`evaluate-reference-fidelity` - see "v0.7 Prompt 1/6 status" below) - while
remaining a thin parsing/dispatch/presentation boundary; it is no longer the
not-implemented placeholder.

## v0.1 progress (Batch 1–6; implemented and released as 0.1.0)

- Batch 1 froze and implemented the observation request contract, evidence
  states/sources, schema 1.0.0, observation/request identity, bounded
  readiness semantics, diagnostic/completion semantics, browser/network
  safety policy, and portable path normalization, with 40 passing unit tests.
- Batch 2 added a Playwright Chromium browser boundary (`src/browser/`) and a
  minimal application seam (`src/application/`) that launches a real
  Chromium browser, enforces the Batch 1 loopback/redirect/subresource
  safety policy at runtime, applies the requested viewport, waits for the
  approved bounded readiness condition, captures a real viewport PNG
  screenshot, returns observer-owned browser provenance, and reliably closes
  the browser on every exit path. Deterministic local HTTP fixtures live
  under `tests/fixtures/`; the real-Chromium integration tests live under
  `tests/browser/` and run via `npm run test:browser` (kept separate from
  `npm test`, which continues to run only the fast unit suite).
- Batch 3 extended the same single browser observation (no second Chromium
  lifecycle) to also capture the v0.1 minimum page evidence (requested/final
  URL, title, viewport, device pixel ratio, document scroll/client
  dimensions plus a derived overall document width/height, window scroll
  position) and explicit-target evidence (tag, geometry, computed
  display/position/overflow, scroll/client metrics, initial visibility, and
  role/name where the browser reliably exposes them) for every configured
  CSS target, honoring missing/ambiguous-target semantics honestly. This
  additively extended `src/domain/schema.ts`'s `TargetEvidenceRecord` (new
  `tag`/`layout`/`visibility`/`semantics` categories, and concrete shapes for
  `geometry`/`style`) and `BrowserCaptureResult`; schema version stays
  `1.0.0`.
- Batch 4 added a portable, atomic observation-artifact writer
  (`src/artifacts/artifactWriter.ts`) and a minimal application persistence
  seam (`src/application/observationPersistence.ts`) that assembles the
  frozen `ObservationArtifact` shape from a Batch 2/3 browser capture (using
  the existing Batch 1 identity/completion functions verbatim, no new logic
  invented) and writes it to `<outputLocation>/<observationId>/manifest.json`
  plus `screenshot.png`. Writing happens in a sibling temporary directory
  first (screenshot before manifest), finalized only via one atomic
  directory rename, so a consumer can never observe a partially-written
  artifact under its real name; a filesystem failure anywhere in that
  sequence reports the existing `artifact-write-failure` diagnostic and
  leaves no completed artifact behind. Internal artifact references
  (`screenshot.png`) are relative/portable; the observation's logical
  identity is the existing Batch 1 `observationId`, not its filesystem
  location. The writer has no Playwright dependency and does not modify the
  observed target. Schema stays `1.0.0`.
- Batch 5 wired the existing owners into the real user-facing workflow:
  `src/cli.ts` implements a real `observe` command (thin argument
  parsing/output only - no Chromium, safety, evidence, or filesystem logic
  of its own), and `src/application/observationPersistence.ts` gained one
  `observe()` use case that runs the existing browser capture exactly once
  and, only on success, persists it exactly once through the existing
  artifact writer. CLI syntax errors (malformed `WIDTHxHEIGHT`, malformed
  `id=selector`) are rejected before any browser launches; all domain bounds
  and safety decisions still come from the existing Batch 1 request
  validator and safety policy, not CLI-local logic. A successfully
  persisted observation - including one whose completion state honestly
  reports `partial` - exits `0`; invalid syntax/request, an unpersistable
  browser failure, or a failed artifact write exits nonzero. Package version
  is `0.1.0`; schema stays `1.0.0`.

So: `my-frontend-observer observe --url ... --viewport ... --target ...
--output ...` is a real, working, source-checkout command that launches
Chromium, produces bounded runtime evidence, and writes a portable local
artifact - proven both via `runCli()`-level tests and a built
`node dist/cli.js observe ...` smoke run against the deterministic fixture.

Batch 6 closed the remaining v0.1 coverage gap (a genuine real-Chromium
navigation failure - connection reset mid-navigation - distinct from a
readiness timeout or a pre-launch safety rejection) and proved the packaged
form of the implementation works independent of the source checkout: the
real `npm pack` tarball, installed fresh in a clean temporary consumer
directory outside the repository, exposes its `my-frontend-observer` bin,
reports the correct version/help text, installs its own Chromium binary via
the consumer-local Playwright toolchain, and performs a real observation
against a disposable local HTTP target - producing a `manifest.json` +
`screenshot.png` artifact identical in shape to the source-checkout result,
without modifying the observed target, and with the temporary consumer/
tarball/output fully cleaned up afterward. Documentation across the
repository was reconciled to this implemented state as part of the same
batch.

## v0.1 status

`v0.1.0` was the first published release (see `CHANGELOG.md` and
`docs/RELEASE.md`). Everything above this section describes that released
state, still present unchanged in `v0.2.0`.

## v0.2 status (Stable Semantic Targets and Region Identity) - released as 0.2.0

v0.2 is implemented and released as package version `0.2.0`, observation
schema `1.1.0`.

- **Canonical target/locator model.** Each configured target has a stable
  observer-owned `name` plus an ordered, bounded `locators` array
  (`src/request/request.ts#TargetLocator`, `NamedTarget`). This identity is
  distinct from both the browser locator that resolves it and any
  source-code symbol. The legacy `{name, selector}` shape remains accepted
  and normalizes to a one-item `css` locator, so every v0.1 CLI invocation
  continues to work unchanged. Bounds: 20 targets max, 5 locators per
  target max (unchanged/new respectively from v0.1's target count bound).
- **Six frozen locator kinds, all resolved against real Chromium**: `role`
  (Playwright's accessibility role/name locator, exact name matching),
  `id` and `data-attribute` (exact CSS attribute-equals matching that never
  reinterprets the configured value as selector syntax), `semantic-element`
  (a frozen structural tag set: `header`, `nav`, `main`, `footer`,
  `article`, `section`, `aside`, `form`, `dialog`), `css` (unchanged v0.1
  behavior), and `text` (exact match only, no substring/fuzzy matching).
  Locator order is the fallback order: 0 matches tries the next locator; 1
  match selects and stops; more than 1 match is ambiguous and stops (never
  falls through); an unevaluable locator is unavailable and stops (never
  falls through). All six kinds converge on one measurement path
  (`src/browser/evidenceCapture.ts#captureResolvedTargetRecord`) - locator
  strategy never changes the resulting evidence shape.
- **Semantic region evidence**, added to every resolved target alongside
  the existing v0.1 role/name capture: `semanticState` (a first bounded
  family of `disabled`/`expanded`/`checked`/`selected`/`pressed`/`current`,
  read from the element's own native/ARIA properties so an explicit `false`
  is always distinguishable from "not applicable"; `checked`/`pressed` also
  support the browser's `'mixed'` value); `landmark` (derived only from the
  already-captured browser-exposed role - never from locator kind or HTML
  tag - against the standard landmark role set `banner`/`navigation`/
  `main`/`complementary`/`contentinfo`/`form`/`region`/`search`); and
  `containment` (bounded DOM containment checked only among the other
  explicitly configured targets in the same observation, in configured
  order - `available`/`partial`/`unavailable`, never a layout/spatial-
  relationship graph).
- **Proven identity stability**: the same target configuration produces the
  same `requestId` across repeated observations (with a fresh
  `observationId` every time); changing a target's locator strategy while
  keeping its stable name changes `requestId` but not the `targetEvidence`
  key; actual runtime disappearance of a still-configured target changes
  only its resolution status, never the `requestId`.
- **Public CLI**: `my-frontend-observer observe --targets-file <json-file>`
  supplies a structured `{ "targets": [...] }` collection as an alternative
  to one or more `--target id=css-selector` flags; the two are mutually
  exclusive per invocation. `--targets-file` only validates its own root
  wrapper (readable file, valid JSON, object root with exactly a `targets`
  field); all target/locator-internal validation stays owned by the
  existing `normalizeRequest()`. The file path is operational input only -
  never part of request identity, never persisted into `manifest.json`.
- **Observation schema `1.1.0`** (`src/domain/schema.ts#SCHEMA_VERSION`):
  additive over the published `1.0.0` - extends `TargetEvidenceRecord` with
  `semanticState`/`landmark`/`containment` and extends `TargetResolution`
  with `selectedLocatorKind`/`selectedLocatorIndex`/`usedFallback`/
  `confidence`/`attempts`. Artifact kind, directory structure, atomic
  persistence, and evidence-state/source vocabularies are unchanged.
- **Validation on this branch**: `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run test:browser`, `npm run build`, and
  `npm run check:docs` all pass (106 unit tests, 69 real-Chromium tests as
  of this reconciliation; see `docs/DEVELOPMENT.md` for how to reproduce).
  `scripts/dev/builtCliTargetsFileSmoke.mjs` additionally proves the built
  `dist/cli.js` (not just the imported `runCli()` function) performs a real
  semantic `--targets-file` observation end to end.

## v0.3 status (Runtime Scrolling, Overflow, and Visibility Behavior) - released as 0.3.0

v0.3 is implemented and released as package version `0.3.0`, observation
schema `1.2.0`. It was validated as a packed npm tarball in a clean
consumer environment on Windows, Linux, and macOS before release.

- **Batch 1** froze the `scrollScenario` request/identity/schema contract:
  `ScrollScenario { action }` with exactly two action kinds
  (`window-scroll-by`, `target-scroll-by`), signed-integer deltas bounded to
  `[-20000, 20000]`, `target-scroll-by.target` referencing an existing stable
  configured target name, scenario configuration participating in
  `requestId` (runtime results never do), and the full bounded runtime
  evidence model (`ScrollRuntimeSnapshot`, `ViewportRelationEvidence`,
  `OverflowEvidence`, scenario transitions, `ScrollOwnerInterpretation`) in
  schema `1.2.0` (up from `1.1.0`).
- **Batch 2** implemented real `window-scroll-by` execution
  (`src/browser/scrollCapture.ts`, `src/domain/scrollEvidence.ts`): initial/
  final runtime snapshots around an immediate `window.scrollBy({behavior:
  'instant'})` and exactly two `requestAnimationFrame` cycles, real vertical/
  horizontal document scrolling, actual-vs-computed overflow, real viewport
  relation, `enteredViewport`/`leftViewport`, and `document`/`none`
  scroll-owner evidence - with ordinary final `pageEvidence`/`targetEvidence`
  and the screenshot always describing the same final post-action state.
- **Batch 3** implemented real `target-scroll-by` execution against the same
  canonical `resolveConfiguredTargets` resolution already used by every v0.2
  locator kind: real nested vertical/horizontal element scrolling, boundary
  clamping, non-scrollable/no-movement targets, and the completed
  `document`/`target:<name>`/`none`/`indeterminate` scroll-owner derivation
  (`src/domain/scrollEvidence.ts#deriveScrollOwner`) - proven never to
  attribute ownership from bounding-rectangle movement alone in either
  direction. An unresolved/ambiguous/hidden action target is never scrolled
  and never fabricated as moved; the existing target diagnostics explain it
  honestly and the observation still persists.
- **Batch 4** exposed the existing contract through the real public CLI:
  `my-frontend-observer observe --scroll-scenario-file <json-file>` (see
  `docs/COMMANDS.md`). The file supplies the `scrollScenario` value directly
  (no wrapper field); the CLI/input layer only validates file readability,
  JSON validity, and a non-array object root - every scenario/action rule
  stays owned by the existing `normalizeRequest()`. Usable with either
  `--target` or `--targets-file` (independent of target configuration, never
  a third mutually-exclusive mode); the scenario-file path is operational
  input only, never persisted and never part of request identity, exactly
  like `--targets-file`'s path. CLI output/exit-code semantics are
  unchanged. Proven via real Chromium (`tests/browser/cliObserve.test.ts`)
  and the built `dist/cli.js` (`scripts/dev/builtCliScrollScenarioSmoke.mjs`).

## v0.4 status (Layout Relationships, Dependency Evidence, and Before/After Comparison) - released as 0.4.0

v0.4 is implemented and released as package version `0.4.0`; observation
schema remains `1.2.0`; comparison schema is `1.0.0`. It was validated as a
packed npm tarball in a clean consumer environment on Windows, Linux, and
macOS - covering the legacy CSS-shorthand `--target` path, the structured
`--targets-file` path, both `--scroll-scenario-file` action kinds, and the
installed `compare` command (comparable and incomparable cases) - before
release.

- **Batch 1** froze the `my-frontend-observer/comparison` artifact contract
  (schema `1.0.0`, independent of and never reused for the observation
  schema): `ComparisonConfig` (geometry tolerance, default `0.5`px, bounded
  `[0, 10]`px), the bounded layout-relationship vocabulary (horizontal/
  vertical order, area overlap, relative width, geometric fit, vertical
  sequencing, page-width fit, clipping), comparability states, the
  before/after difference vocabulary, and the non-causal explicit
  dependency-evidence contract, plus `comparisonRequestId`/`comparisonId`
  identity (`src/domain/relationships.ts`, `src/domain/comparison.ts`,
  `src/domain/comparisonIdentity.ts`). No derivation, comparison, or
  persistence.
- **Batch 2** implemented the one canonical pure derivation engine,
  `deriveLayoutRelationships(observation, options?)`
  (`src/domain/relationships.ts`): consumes an existing `ObservationArtifact`
  only (no Chromium, no re-resolution, no DOM access) and derives a bounded,
  traceable `LayoutRelationshipGraph` among configured targets - stable
  target identity, deterministic configured-target ordering, honest
  unresolved-target handling (not-found/ambiguous/unavailable/hidden, never
  a fabricated zero-sized region), and evidence-reference provenance for
  every derived relationship. DOM containment is read directly from the
  existing `TargetContainment` evidence rather than re-derived, and stays
  distinct from geometric fit. A standalone `deriveTargetClipping(record)`
  derives the frozen clipping concept per target from existing layout/style
  evidence.
- **Batch 3** implemented the pure before/after comparison engine,
  `compareObservations(before, after, config?)`
  (`src/domain/comparisonEngine.ts`): validates both source observations,
  evaluates comparability before any rendered difference is calculated
  (hard page-URL/viewport/browser-engine/scroll-scenario mismatches;
  producer/browser-version and target-configuration warnings), reuses
  `deriveLayoutRelationships` unchanged for both sides, and derives target/
  page differences (appeared/disappeared, moved, resized, visibility,
  clipping, actual overflow, DOM containment, page size, scroll-owner) and
  relationship changes (matched by family + subject/related target, never
  array position) - all without launching Chromium, re-resolving targets, or
  mutating either input observation. Explicit `ComparisonConfig.
  expectedDependencies` are evaluated into non-causal
  consistent/not-observed/contradictory-to-declaration/unavailable outcomes
  only; the observer never infers a dependency from co-change. Comparison
  identity reuses the existing Batch 1 `buildComparisonRequestIdentity`/
  `buildComparisonIdentity` verbatim. Persistence
  (`src/artifacts/comparisonArtifactWriter.ts#writeComparisonArtifact`,
  atomic, `<outputLocation>/<comparisonId>/manifest.json` only, no copied
  screenshots) and the application-level `compareAndPersist` use case
  (`src/application/comparisonService.ts`) are implemented; a narrow
  `readObservationArtifact` reader
  (`src/artifacts/artifactReader.ts`) is established ahead of the Batch 4
  CLI.
- **Batch 4** exposed the existing comparison workflow through the real
  public CLI: `my-frontend-observer compare --before <observation-artifact-
  root> --after <observation-artifact-root> --output <directory>
  [--config-file <json-file>]` (see `docs/COMMANDS.md`). The CLI stays thin
  - `src/cli.ts` parses arguments, optionally loads a config file (file
  readability/JSON validity/object-root only, exactly like
  `--targets-file`/`--scroll-scenario-file`), and delegates to one new
  thin application-layer orchestration function,
  `compareAndPersistFromArtifactRoots`
  (`src/application/comparisonService.ts`), which reads both observation
  roots through the existing `readObservationArtifact` reader and calls the
  existing `compareAndPersist` exactly once - no comparability/geometry/
  relationship/dependency logic lives in the CLI, and comparison itself
  never launches Chromium (`src/cli.ts` still imports nothing from
  `src/artifacts/` or `src/browser/`, matching the pre-existing observe-CLI
  import-boundary test). `comparable`, `comparable-with-warnings`, and
  `incomparable` all exit `0` - each is a successful comparison outcome;
  only a genuine parse/read/domain/persistence failure exits nonzero.
  Operational paths (`--before`/`--after`/`--config-file`/`--output`) never
  affect `comparisonRequestId` and are never written into the persisted
  manifest. Proven end-to-end via real Chromium
  (`tests/browser/cliCompare.test.ts`) and the built `dist/cli.js`
  (`scripts/dev/builtCliCompareSmoke.mjs`): unchanged/moved/resized/
  appeared/disappeared/configuration-only-change/overlap/geometric-fit/
  page-overflow/clipping/scroll-owner cases, plus an explicit
  `--config-file` dependency-evidence case, all through the public command
  surface.

v0.4's canonical relationship derivation, before/after comparison,
comparability, differences, relationship changes, explicit dependency
evidence, comparison persistence, and public `compare` CLI are all
implemented, exercised end-to-end, packed-validated cross-platform, and
released.

v0.5 frontend contract model, identity, and evaluation engine are released
as part of `0.5.0`: `src/domain/frontendContracts.ts` (persistent baseline /
per-change contract types, the four authored change-scope categories plus
the derived `unexpected` classification, the 15-primitive bounded
vocabulary, contract tolerance, and the clause-result/overall-verdict
vocabulary), `src/domain/frontendContractIdentity.ts` (deterministic
contract/baseline/clause identity), and
`src/domain/frontendContractEvaluation.ts#evaluateFrontendContract`
(the one canonical pure evaluator: active-baseline/supersession calculation,
bounded conflict detection, per-category clause evaluation, difference-to-
scope matching, unexpected-change derivation, and overall PASS/FAIL) - all
covered by focused unit tests. Observation schema stays `1.2.0`, comparison
schema stays `1.0.0`.

v0.5 contract and evaluation persistence are also released as part of
`0.5.0`: `src/artifacts/frontendContractArtifactWriter.ts`/`frontendContractArtifactReader.ts`
(symmetric baseline/per-change contract persistence, atomic write, no
overwrite of existing history), `src/artifacts/comparisonArtifactReader.ts`
(new - no comparison reader existed before this batch; comparison schema
still `1.0.0`), `src/domain/frontendContractEvaluationArtifact.ts` (minimal
additive persisted envelope around the frozen evaluation-result vocabulary,
its own independent schema family `1.0.0`) with
`src/artifacts/frontendContractEvaluationArtifactWriter.ts`/`...Reader.ts`,
and `src/application/frontendContractEvaluationService.ts#evaluateAndPersist`/
`evaluateAndPersistFromArtifactRoots` (calls `evaluateFrontendContract`
exactly once, persists exactly one evaluation artifact for both `PASS` and
`FAIL` verdicts, never persists a fabricated artifact when evaluation
construction itself fails). `evaluateFrontendContract` itself is unmodified.

v0.5 public contract/baseline-approval/evaluation CLI is also released as
part of `0.5.0`:
`approve-baseline` (the only baseline-approval act - explicit only, never
inferred from `compare` or a `PASS` evaluation; verifies the contract's
`sourceObservation` matches the supplied observation before persisting),
`save-change-contract` (persistence only), and `evaluate-contract`
(evaluates already-persisted before/after/comparison/baseline/change
evidence exactly once and persists exactly one evaluation artifact;
`--enforce` makes a `FAIL` verdict exit nonzero without changing the
verdict, its identity, or its persisted content - a `FAIL` without
`--enforce` still exits `0`). `src/application/frontendContractPersistenceService.ts`
adds the two new thin application seams (`approveAndPersistBaseline`,
`persistPerChangeContract`); `src/cli.ts` gained no browser or artifact-
writer import. Covered by `tests/unit/cliFrontendContracts.test.ts` and the
Chromium-free `scripts/dev/builtCliFrontendContractsSmoke.mjs` dev smoke.
Observation schema `1.2.0`; comparison schema `1.0.0`; frontend contract
schema `1.0.0`; evaluation artifact schema `1.0.0` - no schema was bumped
to add this CLI.

v0.5 proved the complete public contract workflow (`observe` →
`approve-baseline` → `save-change-contract` → `observe` → `compare` →
`evaluate-contract`) against real Chromium observations, not hand-constructed
artifacts: a fully successful contract change (all clauses `pass`, overall
`PASS`), and the "milestone signature" case - a locally successful requested
change (navigation shrinks, workspace expands, both real and both `pass`)
coexisting with a genuine protected-property regression (real right-rail
`resized` difference) and a genuine preserved-invariant regression (real
`clipping-changed` difference, `not-clipped` → `clipped`) - producing overall
`FAIL`. Both scenarios are covered by `tests/browser/cliFrontendContracts.test.ts`
(real Chromium, via `tests/fixtures/server.ts`'s new `/contract` route) and by
the built-CLI dev smoke `scripts/dev/builtCliFrontendContractsBrowserSmoke.mjs`
(the built `dist/cli.js`, not the imported `runCli()`, against its own
disposable local HTTP fixture). Both confirm `--enforce` behavior (`FAIL`
persists and exits `0` without it, exits nonzero with it, identical
`evaluationRequestId` and `clauseResults` in both cases), full source
observation/comparison immutability, no screenshot copied into the
evaluation artifact, and no operational filesystem path leaked into any
persisted manifest.

The packed-readiness coverage gap this left (`V0_5_READINESS_VALIDATION_GAP_EXISTS`)
was corrected and proven cross-platform before release:
`scripts/ci/runPackedObservationSmoke.mjs` also exercises the installed
packed candidate's `approve-baseline`/`save-change-contract`/
`evaluate-contract` commands against real installed-candidate `observe`/
`compare` evidence, proving the same successful-change and milestone-
signature scenarios through the installed tarball rather than the source
checkout. v0.5 pre-release readiness passed on the validation branch
`validation/v0.5-pre-release` (GitHub Actions run `31727856546`, one shared
hash-verified candidate tarball on Windows, Linux, and macOS - see
`docs/CI_CD.md` for full evidence) before the version `0.5.0` release below.

## v0.6 status (Bounded Agent Context and Native my-dev-kit Ecosystem Integration) - released as `0.6.0`

v0.6 is published as package version `0.6.0`, tagged `v0.6.0`, from the
canonical `canonicalization/v0.6` lineage (product commit
`514bf3bb513764815a0a5b9e508d5836aa7d7fd8`). Observation schema stays
`1.2.0`; comparison schema `1.0.0`; frontend contract schema `1.0.0`;
evaluation artifact schema `1.0.0`; new bounded-agent-context schema
`1.0.0` (artifact kind `my-frontend-observer/bounded-agent-context`).

- **Bounded runtime projection** (`src/domain/boundedAgentContext.ts`,
  `src/domain/boundedAgentContextProjection.ts#projectBoundedAgentContext`):
  page/viewport identity, stable target identities, geometry, runtime
  behavior, relationships, before/after differences, contract results, and
  requested/expected-dependent/protected/preserved scope - reusing the
  existing v0.5 `frontendContracts.ts` types directly rather than
  reimplementing them - plus diagnostics, screenshot/artifact references,
  provenance, and explicit truncation/omission metadata.
- **Adequacy, omission, and truncation** (`Adequacy`/`ADEQUACY_REASON_CODES`,
  `OmissionRecord`/`TruncationRecord`, bounded aggregate-cap summarization):
  distinguishes required from optional loss and reports whether captured
  evidence is adequate for the task rather than merely present.
- **Runtime/static correlation**
  (`src/domain/boundedAgentContextCorrelation.ts#deriveRuntimeStaticCorrelations`/
  `attachRuntimeStaticCorrelations`): correlation outcomes are exactly
  `correlated`/`ambiguous`/`unavailable`; competing candidate identities
  remain visible; a stable runtime target identity is never silently
  reported as source ownership. This module has no dependency on
  `@dailephd/my-dev-kit` - it accepts only plain, already-retrieved
  candidate evidence, since no generic static-side retrieval capability was
  found missing.
- **Deterministic identity** (`src/domain/boundedAgentContextIdentity.ts`):
  a logical identity distinct from a fresh per-execution instance identity.
- **Export/public boundary**: `src/index.ts` exports the complete
  bounded-agent-context and correlation type/function surface as a
  programmatic library contract. There is no new CLI command and no disk
  artifact writer/reader for this artifact family - it is a pure contract-
  and-derivation layer, consistent with the frozen module documentation
  describing it as a foundation for orchestrator/lab consumption rather than
  a persisted artifact kind.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (32 files, 627 tests), `npm run test:browser` (9 files,
  120 tests), `npm run test:security`, `npm run build`, and `npm run
  check:docs` all pass. Cross-repository neutral verification (observer
  `514bf3b`, orchestrator `9473e4c`, lab `271e72c`) passed with 6/6
  requirement coverage and no known product blockers.
- **Not Observer-owned / correctly out of scope for this repository**: no
  `my-dev-kit` static-side change was made (none was proven necessary); no
  orchestrator bounded-evidence consumption or lab reader/fixture/evaluation
  code lives in this repository - those are separate sibling-repository
  deliverables, not part of `my-frontend-observer`'s v0.6 surface.

## v0.7 Prompt 1 status (External Visual Reference Foundation) - released as `0.7.0`

Only the foundation layer of the v0.7 external-reference architecture is
implemented: an observer-owned `ExternalReferenceArtifact` family
representing one externally supplied design-reference image plus
deterministic identity, provenance, bounded image metadata, and an explicit
two-state lifecycle. This is not the full v0.7 coding-agent workflow.

- **Domain** (`src/domain/externalReferenceImage.ts`): pure, dependency-free
  PNG/JPEG/WebP header-byte format detection and dimension parsing (no
  decode, no OCR, no computer vision), bounded to
  `EXTERNAL_REFERENCE_MAX_IMAGE_BYTES` (20,000,000 bytes) and
  `[EXTERNAL_REFERENCE_MIN_DIMENSION_PX, EXTERNAL_REFERENCE_MAX_DIMENSION_PX]`
  (`[1, 8192]`) pixels per side.
- **Domain** (`src/domain/externalReference.ts`): `ExternalReferenceArtifact`
  is a discriminated union of `ImportedExternalReferenceArtifact` (owns its
  image file) and `ApprovedExternalReferenceArtifact` (carries a
  `sourceReference` back to the imported artifact's image instead of copying
  it) under `EXTERNAL_REFERENCE_ARTIFACT_KIND` /
  `EXTERNAL_REFERENCE_SCHEMA_VERSION` (`'1.0.0'`, independent of the
  observation/comparison/contract schema versions). Lifecycle has exactly two
  persisted states, `'imported'` and `'approved'` - there is no literal
  `'superseded'` state; supersession is represented only as a forward
  pointer (`supersedesReferenceId` on the newer artifact), so an existing
  persisted artifact's own manifest is never rewritten.
- **Identity** (`src/domain/externalReferenceIdentity.ts`): the same
  canonicalize-then-sha256 request identity plus nonce-based fresh instance
  identity pattern used by every other artifact family, duplicated per-family
  per existing convention. `referenceRequestId` is a pure function of
  `{imageSha256, format, width, height, supersedesReferenceId}` only - never
  a filesystem path, output location, label, or timestamp.
- **Persistence** (`src/artifacts/externalReferenceArtifactWriter.ts` /
  `externalReferenceArtifactReader.ts`): same atomic temp-dir-then-rename
  discipline as the observation/comparison writers; an `'imported'`
  artifact's directory contains `manifest.json` plus its owned image file;
  an `'approved'` artifact's directory contains only `manifest.json`.
- **Application** (`src/application/externalReferencePersistenceService.ts`):
  `importExternalReference()` (never approves; fails closed on an
  unsupported/undetectable format, invalid or out-of-bound dimensions, an
  over-limit file, or an unresolvable `--supersedes` target) and
  `approveExternalReference()` (the only explicit approval act; refuses to
  approve anything not currently in the `'imported'` state; never mutates the
  imported artifact it approves).
- **CLI**: `import-reference <image-file> --output <dir> [--label] [--supersedes]`
  and `approve-reference --reference <root> --output <dir> [--supersedes]`.
- **Export/public boundary**: `src/index.ts` exports the complete new type,
  constant, validator, identity, writer, reader, and application-service
  surface, following the same grouping order as every existing family.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (38 files, 668 tests), `npm run test:browser` (9 files,
  120 tests), `npm run test:security`, `npm run build`, `npm run check:docs`,
  `git diff --check`, and `npm pack --dry-run` all pass with zero changes to
  any pre-existing test.
- **Not implemented in this stage** (explicitly deferred to later v0.7
  prompts): reference regions, geometry, relationships, design requirements,
  tolerances, reference-region/runtime-target binding, reference-vs-candidate
  fidelity evaluation, theme/application-state compatibility evaluation,
  viewer, and annotation.

## v0.7 Prompt 2 status (Explicit Reference Regions, Geometry, and Reusable Reference Relationships) - released as `0.7.0`

Additive extension of the Prompt 1 foundation above. Still not the full v0.7
coding-agent workflow - no design requirements, tolerances, adequacy,
binding, or fidelity evaluation yet.

- **Domain** (`src/domain/externalReferenceRegions.ts`): explicit,
  user/configuration-authored reference-image rectangles
  (`ReferenceRegion { id, rectangle: {x, y, width, height} }`), origin at the
  reference image's top-left corner, unit reference-image pixels. Pure
  derived geometry (`right`/`bottom`/`centerX`/`centerY`) is always
  recomputed from the canonical rectangle, never separately stored. Bounded
  at `MAX_REFERENCE_REGIONS` (20, matching `request/request.ts`'s
  `MAX_TARGETS`), region ids validated against the same
  `^[A-Za-z0-9_-]{1,64}$` pattern as target names, unique
  case-insensitively, and rejected outright (never clamped) if any rectangle
  extends outside the owning image's bounds.
- **Domain** (`src/domain/externalReferenceRegionRelationships.ts`): reuses
  the exact pure geometry predicates `deriveLayoutRelationships` uses for
  runtime targets (now exported additively from `relationships.ts`, formulas
  unchanged) to derive the six geometry-only relationship families
  (horizontal order, vertical order, area overlap, relative width, geometric
  fit, vertical sequencing) between reference regions. Not persisted -
  `deriveReferenceRegionRelationships()` is a pure function callers invoke
  on demand against an artifact's own `regions`, bounded at
  `MAX_REFERENCE_REGION_RELATIONSHIP_RECORDS`.
- **Schema**: `ExternalReferenceArtifact` gained one additive, optional
  `regions?: ReferenceRegion[]` field. No schema version bump
  (`EXTERNAL_REFERENCE_SCHEMA_VERSION` remains `'1.0.0'`) - every Prompt 1
  artifact remains valid with no `regions` key at all.
- **Identity**: `buildExternalReferenceRequestIdentity` gained an additive,
  optional trailing `regions` parameter, omitted from the hashed view
  entirely (not defaulted to `null`) when absent, so every Prompt 1 call
  site keeps producing byte-identical identity. Region content (including
  authored order) is identity-bearing when present.
- **Application**: `importExternalReference()` validates an optional
  `regions` option and fails closed with the new `invalid-reference-region`
  diagnostic; `approveExternalReference()` carries an imported artifact's
  `regions` forward verbatim, never re-validating or re-deriving them.
- **CLI**: `import-reference` gained an optional
  `--regions-file <json-file>` (`{ "regions": [...] }`, same object-root-
  wrapper convention as `--targets-file`); legacy invocations without it are
  unchanged from Prompt 1. Both commands now print a `Regions: <count>` line.
- **Export/public boundary**: `src/index.ts` exports the complete new region
  and relationship type/constant/validator/function surface, following the
  same grouping order as every existing family.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (40 files, 719 tests), `npm run test:browser` (9 files,
  120 tests, unchanged), `npm run test:security`, `npm run build`, `npm run
  check:docs`, `git diff --check`, and `npm pack --dry-run` all pass with
  zero changes to any pre-existing test.
- **Not implemented in this stage** (explicitly deferred to later v0.7
  prompts): selected design requirements, design tolerance semantics,
  reference-evidence adequacy, theme/application-state compatibility
  evaluation, reference-region/runtime-target binding, reference-vs-candidate
  fidelity evaluation, viewer, and annotation.

## v0.7 Prompt 3 status (Selected Design Requirements, Tolerance Semantics, and Reference-Evidence Adequacy) - released as `0.7.0`

Additive extension of the Prompt 1/2 foundation above. Still not the full
v0.7 coding-agent workflow - no runtime binding or fidelity evaluation yet.

- **Domain** (`src/domain/externalReferenceRequirements.ts`): explicit,
  user/configuration-selected design intent over Prompt 2's `regions` -
  never inferred merely because a region property or relationship exists.
  Requirement category reuses v0.5's `AuthoredChangeScopeCategory`
  (`requested`/`expected-dependent`/`protected`/`preserved`) directly;
  `'unexpected'` remains impossible to author. Three subject kinds:
  `region-property` (one region + a `ReferenceRegionGeometry` field),
  `region-relationship` (two regions + a reused `PairwiseRelationshipKind`,
  geometry-only families only, no tolerance), `region-measurement` (two
  regions + one of six pure derived measurements - `vertical-gap`,
  `horizontal-gap`, `center-x-delta`, `center-y-delta`, `left-edge-delta`,
  `right-edge-delta` - with a required tolerance). Tolerance is a new,
  reference-owned type (`exact` | `absolute-reference-px` | `percent`),
  deliberately not a reuse of v0.5's `ContractTolerance` (whose
  `absolute-px` is implicitly runtime/CSS pixels). Bounded at
  `MAX_REFERENCE_REQUIREMENTS` (50). A requirement's `requirementId` is
  always system-computed from its content, never authored.
- **Reference-evidence adequacy**: `deriveReferenceRequirementAdequacy()`
  asks only whether the reference definition itself supports every selected
  requirement - never whether a runtime target/candidate exists. Its own
  small vocabulary (`adequate`/`partial`/`inadequate`, two reason codes)
  deliberately does not reuse `boundedAgentContext.ts`'s `Adequacy`, which
  describes an unrelated runtime/static-correlation domain. Zero selected
  requirements is explicitly `inadequate`. Never a numeric score; reasons
  ordered deterministically by authored requirement position.
- **Validation**: a requirement referencing an unknown region id is a
  construction-time failure (`invalid-reference-requirement`), never
  "unavailable" evidence. Two requirements sharing the exact same structural
  subject (regardless of category) are rejected as duplicates/conflicts -
  v0.5's runtime-evaluation-time conflict detector
  (`evaluateFrontendContract#primitivesConflict`) needs before/after
  observation evidence that does not exist at this stage and could not be
  reused safely.
- **Schema**: `ExternalReferenceArtifact` gained one additive, optional
  `requirements?: ExternalReferenceRequirement[]` field. No schema version
  bump - every Prompt 1/2 artifact remains valid with no `requirements` key.
- **Identity**: `buildExternalReferenceRequestIdentity` gained an additive,
  optional trailing `requirements` parameter, omitted from the hashed view
  entirely when absent, so every Prompt 1/2 call site keeps producing
  byte-identical identity. Requirement content (category, subject,
  tolerance, mode, authored order) is identity-bearing when present.
- **Application**: `importExternalReference()` validates an optional
  `requirements` option (computing each requirement's identity from its raw
  authored content) and fails closed on any invalid requirement;
  `approveExternalReference()` carries `requirements` forward verbatim.
  Both now also compute and return reference-evidence adequacy.
- **CLI**: `import-reference` gained an optional
  `--requirements-file <json-file>` (`{ "requirements": [...] }`, same
  object-root-wrapper convention as `--regions-file`); legacy invocations
  without it are unchanged. Both commands now also print
  `Requirements: <count>` and `Adequacy: <status>` lines.
- **Export/public boundary**: `src/index.ts` exports the complete new
  requirement/tolerance/adequacy type/constant/validator/function surface,
  following the same grouping order as every existing family.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (42 files, 779 tests), `npm run test:browser` (9 files,
  120 tests, unchanged), `npm run test:security`, `npm run build`, `npm run
  check:docs`, `git diff --check`, and `npm pack --dry-run` all pass with
  zero changes to any pre-existing test.
- **Not implemented in this stage** (explicitly deferred to later v0.7
  prompts): theme/application-state compatibility evaluation,
  reference-region/runtime-target binding, reference-vs-candidate fidelity
  evaluation, viewer, and annotation.

## v0.7 Prompt 4 status (Reference Applicability and Candidate-State Compatibility) - released as `0.7.0`

Additive extension of the Prompt 1/2/3 foundation above. Still not the full
v0.7 coding-agent workflow - no runtime binding or fidelity evaluation yet.

- **Domain** (`src/domain/explicitState.ts`): a small, closed, caller/
  configuration-supplied state model (`theme`, `applicationState`,
  `authenticatedState`) shared by both `ObservationArtifact.requestConfig.explicitState`
  and `ExternalReferenceArtifact.applicability` - never inferred from
  screenshot pixels, CSS, DOM, URLs, or any other runtime signal. Labels are
  bounded opaque identities (`^[A-Za-z0-9_-]{1,64}$`) compared by exact,
  case-sensitive equality only. `authenticatedState` is a closed
  `'authenticated' | 'unauthenticated'` vocabulary with no field capable of
  holding a credential, token, or cookie.
- **Domain** (`src/domain/externalReferenceApplicability.ts`): adds an
  optional CSS-pixel `viewport` to the shared state model - deliberately
  distinct from the reference image's own pixel dimensions (`image.width`/
  `height`), which a reference image may be captured at any resolution/DPI
  relative to.
- **Domain** (`src/domain/externalReferenceCompatibility.ts`):
  `evaluateReferenceCandidateCompatibility(reference, candidate)` answers
  "does this reference describe the same frontend state as this candidate
  observation?" by reusing v0.4's own `ComparabilityResult`/`ComparabilityReason`
  vocabulary and a newly-extracted, shared pure helper
  (`assessOptionalComparabilityDimension`, exported from
  `comparisonEngine.ts`) rather than a parallel model. The same helper now
  also drives v0.4's own `evaluateComparability`, which additionally assesses
  theme/authenticated-state/application-state when both observations declare
  `explicitState` - every historical observation pair without it keeps its
  exact prior unassessed-only behavior (a frozen regression vector proves
  this). A dimension the reference constrains but the candidate omits (or
  vice versa) is `unassessed`, never fabricated as a match or a mismatch.
- **Schema**: `ExternalReferenceArtifact` gained one additive, optional
  `applicability?: ExternalReferenceApplicability` field; `ObservationArtifact.requestConfig`
  gained one additive, optional `explicitState?: ExplicitStateDimensions`
  field. No schema version bump on either family.
- **Identity**: `buildExternalReferenceRequestIdentity` gained an additive,
  optional trailing `applicability` parameter; `buildRequestIdentity` gained
  an additive, optional trailing `explicitState` parameter - both omitted
  from their hashed views (never `null`) when absent, so every earlier call
  site keeps producing byte-identical identity.
- **CLI**: `import-reference` gained an optional `--applicability-file <json-file>`;
  `observe` gained an optional `--state-file <json-file>` (both unwrapped
  raw-object files, following `--scroll-scenario-file`'s exact convention).
  `import-reference`/`approve-reference` now also print an
  `Applicability: declared|none` line.
- **Export/public boundary**: `src/index.ts` exports the complete new
  explicit-state/applicability/compatibility type/constant/validator/function
  surface, following the same grouping order as every existing family.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (45 files, 857 tests), `npm run test:browser` (9 files,
  120 tests, unchanged), `npm run test:security`, `npm run build`, `npm run
  check:docs`, `git diff --check`, and `npm pack --dry-run` all pass with
  zero changes to any pre-existing test.
- **Not implemented in this stage** (explicitly deferred to later v0.7
  prompts): reference-region/runtime-target binding, reference-vs-candidate
  fidelity evaluation, bounded fidelity context, the end-to-end correction
  workflow, viewer, and annotation.

## v0.7 Prompt 5 status (Explicit Reference-Region <-> Runtime-Target Binding) - released as `0.7.0`

Additive extension of the Prompt 1-4 foundation above. Still not the full
v0.7 coding-agent workflow - no fidelity evaluation yet.

- **Domain** (`src/domain/externalReferenceRuntimeBinding.ts`):
  `evaluateReferenceRuntimeBindings(reference, candidate, declarations)`
  answers "which stable v0.2 runtime target does this candidate resolve for
  each explicitly declared reference region?" A binding declaration
  (`{referenceRegion, runtimeTarget}`) is explicit user/configuration input
  - never inferred from geometry, matching names, or source code; two
  strings with the same textual value in the reference-region and
  runtime-target identity domains never bind to each other merely because
  they match. Reuses `evaluateReferenceCandidateCompatibility` (Prompt 4) as
  a hard gate and `targetPresence` (v0.4, exported additively) as the sole
  "how do I read a `TargetEvidenceRecord`'s resolution" rule - no second
  target resolver, no browser launch. Status vocabulary: `bound` / `ambiguous`
  / `unavailable`, each with closed reason codes. An unknown reference
  region fails the whole evaluation closed (structural, candidate-independent);
  an unknown/ambiguous/unavailable runtime target produces a per-declaration
  `unavailable`/`ambiguous` result, never a guessed target. Bounded at
  `MAX_REFERENCE_RUNTIME_BINDINGS` (20).
- **Persistence**: none - a pure, on-demand function over already-persisted/
  in-memory evidence, no new artifact family.
- **CLI**: none added - deliberately deferred to Prompt 6, the capability's
  first concrete consumer.
- **Export/public boundary**: `src/index.ts` exports the complete new
  binding type/constant/validator/function surface.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (46 files, 889 tests), `npm run test:browser` (9 files,
  120 tests, unchanged), `npm run test:security`, `npm run build`, `npm run
  check:docs`, `git diff --check`, and `npm pack --dry-run` all pass with
  zero changes to any pre-existing test.
- **Not implemented in this stage** (explicitly deferred to later v0.7
  prompts): reference-vs-candidate fidelity evaluation, bounded fidelity
  context, the end-to-end correction workflow, viewer, and annotation.

## v0.7 Prompt 6 status (Structured Reference-vs-Candidate Fidelity Evaluation) - released as `0.7.0`

Additive extension of the Prompt 1-5 foundation above. The first point in
the v0.7 stack where a reference's authored expectation is actually
compared against live candidate evidence.

- **Domain** (`src/domain/externalReferenceFidelity.ts`):
  `evaluateReferenceCandidateFidelity(reference, candidate, bindings)`
  evaluates in a frozen order - reference/candidate structural validation ->
  Prompt 3 adequacy -> Prompt 4 compatibility -> Prompt 5 binding ->
  per-requirement evaluation - and never fabricates an ordinary PASS/FAIL
  past an earlier blocking gate: overall `state` is `'not-evaluated'` /
  `'pass'` / `'fail'`, with `blockedBy` preserved for the first two gates.
  Establishes one explicit, deterministic reference-image-pixel <->
  CSS-pixel coordinate scale from `reference.applicability.viewport` and the
  image's own dimensions, gated by an independent (never a design-tolerance)
  aspect-ratio coherence check. Reuses Prompt 3 tolerances
  (`exact`/`absolute-reference-px`/`percent`) and v0.4's
  `deriveLayoutRelationships` (family-scoped lookup, the same bug class
  Prompt 3 already fixed) unchanged - no duplicated geometry or
  comparability logic.
- **Persistence**: none - a pure, on-demand function; the CLI-facing
  `evaluateReferenceCandidateFidelityFromArtifactRoots` application-service
  wrapper only reads already-persisted artifacts, it does not write one.
- **CLI**: `evaluate-reference-fidelity --reference --candidate
  [--bindings-file] [--enforce]` - the CLI surface Prompt 5 deferred,
  following `evaluate-contract`'s exact `--enforce`/exit-code precedent.
  Persists nothing; there is no `--output` flag.
- **Export/public boundary**: `src/index.ts` exports the complete new
  fidelity-result type/constant/validator/function surface plus the
  application-service wrapper.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (48 files, 927 tests), `npm run test:browser` (9 files,
  120 tests, unchanged), `npm run test:security`, `npm run build`, `npm run
  check:docs`, `git diff --check`, and `npm pack --dry-run` all pass with
  zero changes to any pre-existing test.
- **Not implemented in this stage** (explicitly deferred to later v0.7
  prompts): bounded fidelity context integration, the end-to-end correction
  workflow, viewer, and annotation.

## v0.7 Prompt 7 status (Bounded Reference-Fidelity Projection and v0.6 Bounded-Agent-Context Integration) - released as `0.7.0`

Additive extension of the v0.6 bounded-agent-context architecture and the
Prompt 1-6 foundation above.

- **Domain** (`src/domain/referenceFidelityProjection.ts`):
  `projectReferenceFidelity()` selects, prioritizes (failed-required, then
  unavailable-required, then other non-pass), and bounds Prompt 6's
  non-passing requirement results (`MAX_FIDELITY_MISMATCHES`, 15) and
  passing protected/preserved context (`MAX_FIDELITY_PROTECTED_CONTEXT`, 10)
  for a coding agent's bounded context - passing requirements are never
  dumped by default.
- **Integration**: `projectBoundedAgentContext` (v0.6) itself, not a second
  context system, gained one new optional input (`fidelity`,
  `fidelityRequired?`): fidelity-relevant runtime targets fold into the
  exact same required/permitted-target allocation and omission/truncation/
  adequacy machinery v0.5 contract clauses already compete in, so a
  `not-evaluated` fidelity always degrades adequacy away from `'adequate'`,
  never silently reported as "no problems". A new `fidelity?:
  BoundedReferenceFidelityProjection` field on `BoundedAgentContextArtifact`
  mirrors `correlations?`'s own additive precedent - no schema version bump.
  v0.6's own runtime/static correlation is reused entirely unchanged.
- **Identity**: `buildBoundedAgentContextRequestIdentity` gained a final
  optional `fidelity` parameter (omit-when-absent; verified byte-identical
  for every pre-Prompt-7 call site).
- **Persistence / CLI**: none - bounded agent context remains
  library-only, exactly as v0.6 established it.
- **Export/public boundary**: `src/index.ts` exports the complete new
  fidelity-projection type/constant/function surface.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (49 files, 981 tests), `npm run test:browser` (9 files,
  120 tests, unchanged), `npm run test:security`, `npm run build`, `npm run
  check:docs`, `git diff --check`, and `npm pack --dry-run` all pass with
  zero changes to any pre-existing test.
- **Not implemented in this stage** (explicitly deferred to Prompt 8):
  the end-to-end coding-agent correction workflow, viewer, and annotation.

## v0.7 Prompt 8 status (Controlled End-to-End External-Reference Coding-Agent Correction Workflow) - released as `0.7.0`

The first complete v0.7 correction cycle, composing every Prompt 1-7 and
v0.1/v0.4/v0.5/v0.6 owner - this completes the v0.7 (End-to-End Coding-Agent
Frontend Change Review) milestone's core workflow.

- **Domain** (`src/domain/referenceCorrectionWorkflow.ts`,
  `referenceCorrectionIdentity.ts`): `prepareReferenceCorrection()`
  evaluates the approved reference against the current (pre-change)
  observation (Prompt 6) and, when evaluable, projects a bounded
  coding-agent handoff (Prompt 7/v0.6) - a `not-evaluated` fidelity is
  reported as `status: 'blocked-not-evaluated'`, never a fabricated
  handoff. `reviewReferenceCorrectionAttempt()` composes one overall result
  from a fresh post-edit candidate: `compareObservations` (v0.4) ->
  `evaluateReferenceCandidateFidelity` (Prompt 6) -> `evaluateFrontendContract`
  (v0.5) -> overall `'not-evaluated'`/`'pass'`/`'fail'`, where `'pass'`
  requires *both* reference fidelity `'pass'` *and* v0.5 contract evaluation
  `'PASS'` - matching the design reference is necessary but never
  sufficient. Review identity is a deterministic hash of
  `{referenceRequestId, baselineObservationId, baselineContractId,
  baselineContractClauses, changeContractId, changeContractClauses,
  bindingDeclarations}` (including actual contract *clause content*, not
  merely the caller-authored contract id labels) - `reviewReferenceCorrectionAttempt`
  recomputes and rejects any call whose supplied review id does not match,
  enforcing "no hidden baseline change" structurally. Attempt identity is a
  deterministic hash of `{reviewRequestId, candidateObservationId}`. Both
  functions are pure, so no prior attempt can ever be overwritten.
- **External implementation boundary**: absolute - neither this module nor
  anything it calls opens, parses, or writes any target source file; real
  candidate capture remains the caller's own responsibility through the
  existing, unmodified `runBrowserCapture`/`buildObservationArtifact`
  pipeline. No automatic baseline/reference approval ever occurs.
- **Persistence / CLI**: none - both operations remain pure, in-memory,
  programmatic functions; no `--output` flag, no new command.
- **Real-Chromium proof** (`tests/browser/referenceCorrectionWorkflow.test.ts`):
  a deterministic, test-only "controlled external actor" (living entirely
  outside `src/`) edits a disposable, repository-local copy of a tracked
  HTML fixture template, proving a full success correction, a protected-
  regression case (candidate visually matches the reference but a real
  Chromium-observed element becomes hidden - still overall `FAIL`), a
  two-attempt correction iteration (both attempts traceable to the same
  baseline), and an incompatible-viewport blocking case that never produces
  a handoff. The tracked template remains byte-identical before and after.
- **Export/public boundary**: `src/index.ts` exports the complete new
  workflow/identity type/constant/function surface.
- **Validated on the canonical worktree**: `npm run typecheck`, `npm run
  lint`, `npm test` (50 files, 1000 tests), `npm run test:browser` (10
  files, 124 tests), `npm run test:security`, `npm run build`, `npm run
  check:docs`, `git diff --check`, `npm pack --dry-run`, and a real
  installed-packed-candidate smoke all pass with zero regressions to any
  pre-existing test.
- **Not implemented in this stage** (remain future, v0.8+): interactive
  viewer, structured visual annotation, and automatic baseline/reference
  approval (approval remains an explicit, separate action through the
  existing `approve-baseline`/`approve-reference` commands).

## v0.8 status (Interactive Local Observation Viewer) - implemented in current repository, **not yet released**

All eight v0.8 implementation batches have passed
(`IMPLEMENTATION_BATCHES_STATUS: ALL_8_IMPLEMENTATION_BATCHES_PASS`), followed
by a hardened documentation/implementation-completeness audit (this
reconciliation). Package metadata remains `0.7.0` throughout - no schema
version changed, and no CLI command from v0.1-v0.7 was altered. The next
workflow stage is v0.8 pre-release readiness (cross-platform + security
validation), not release preparation.

- **Batch 1** (`docs/reports/v0.8-viewer-runtime-pwa-batch1.md`) froze the
  version-start architecture decisions (React + TypeScript + Vite; normal
  browser + Node-backed loopback server + installable PWA using the same
  application; ephemeral viewer adapters over existing canonical readers,
  never a new persisted viewer artifact) and implemented the `view` CLI
  command (`--root`, `--port`, `--no-open`), the loopback-only (`127.0.0.1`)
  Node viewer server, the built React/Vite/PWA shell (service worker,
  manifest, app-shell precache with an `/api/` cache-boundary denylist), and
  one minimal read-only status endpoint. `npm run build` gained the
  `dist/viewer` build step.
- **Batch 2** (`v0.8-evidence-index-readers-batch2.md`) added bounded,
  metadata-first evidence discovery (`GET /api/index`) across every existing
  artifact family, honest support-state classification
  (supported/unsupported-version/invalid-structure/unrecognized-kind/
  malformed-json/unreadable), and on-demand full-artifact/media loading
  (`GET /api/artifacts/<handle>`, `GET /api/media/<handle>/<role>`) with
  path-containment/traversal safety.
- **Batch 3** (`v0.8-observation-svg-inspection-batch3.md`) added the
  observation screenshot/SVG-overlay workspace: runtime target geometry,
  semantics, visibility, overflow, scroll evidence, and on-demand layout
  relationships (`GET /api/observations/<handle>/relationships`, reusing the
  existing canonical `deriveLayoutRelationships` at its one sanctioned
  viewer-server call site).
- **Batch 4** (`v0.8-comparison-contract-inspection-batch4.md`) added
  before/after comparison and contract/change-scope inspection
  (`GET /api/comparisons/<handle>/view`, `GET /api/evaluations/<handle>/view`),
  exact-identity linked-evidence resolution (never fuzzy matching), and the
  required protected/preserved-failure safety case (a locally successful
  requested change alongside a genuine protected/preserved regression,
  shown as overall `FAIL`, never masked).
- **Batch 5** (`v0.8-reference-candidate-inspection-batch5.md`) added
  external-reference and reference/candidate inspection: reference image and
  region overlays in the reference's own pixel coordinate domain, explicit
  (never auto-selected) candidate selection, reference/candidate
  compatibility, adequacy, and applicability display.
- **Batch 6** (`v0.8-binding-fidelity-interaction-batch6.md`) added
  explicit-binding cross-selection (reference region ↔ runtime target, only
  through an explicit `--bindings-file` declaration, never inferred from
  matching names), independent bounded (`1x`-`8x`) zoom/pan per pane,
  conditional view lock (enabled only when compatibility/coordinate-mapping
  genuinely permit it), and on-demand reference-fidelity evaluation
  (`not-evaluated`/`pass`/`fail`) shown alongside, never merged into, any
  selected contract evaluation's own verdict.
- **Batch 7** (`v0.8-bounded-context-correlation-batch7.md`) added the
  `--context-file` input and a dedicated "Bounded context" mode: session-only
  bounded-agent-context display (identity, adequacy, omissions/truncations
  with required loss visually distinguished from optional loss,
  runtime/static correlation - `correlated`/`ambiguous`/`unavailable`,
  never "owner" language), safe raw-evidence navigation, and explicit
  non-ownership/non-rebuild language. The viewer never calls
  `projectBoundedAgentContext`, `deriveRuntimeStaticCorrelations`, or
  `attachRuntimeStaticCorrelations` - it only displays the exact context it
  was started with.
- **Batch 8** (`v0.8-integrated-viewer-acceptance-batch8.md`, the final
  implementation batch) integrated and hardened the above rather than adding
  new features: closed three named real-browser coverage gaps (many
  reference regions bound to one runtime target must all cross-highlight;
  reference-fidelity FAIL alongside a genuine frontend-contract PASS for the
  same candidate must display independently with no hidden precedence; a
  bounded context whose sources include two observations sharing a stable
  target id must list every matching source observation, never one); fixed a
  real accessibility gap (a cross-highlighted, non-selected region/target
  rect now exposes `data-highlighted` plus an `aria-label` suffix to
  assistive technology, without disturbing `aria-pressed`'s existing
  single-selection semantics); added the first live-browser PWA proof suite
  (real service-worker registration, zero `/api/` cache-storage entries, and
  a hard server-down "stale evidence must never be presented as current"
  gate, which held); and proved the actual packed-and-installed npm
  candidate (not just the source checkout) works end-to-end through a real
  browser, with read-only evidence-root integrity confirmed via before/after
  content hashing. Standalone/installed-PWA proof did not exceed CDP
  command-acceptance (the emulated display-mode feature was not observed to
  take effect) - recorded honestly as a residual gap, not overstated as
  actual OS-level installation verification.

**Architectural invariants proven across all eight batches** (re-audited in
this documentation/completeness stage): no second observer, relationship
engine, comparison engine, contract engine, reference model,
reference-evaluation engine, correlation implementation, or bounded-context
builder exists anywhere in `src/viewerServer` or `viewer/src` - every
canonical engine function the viewer displays results from is called from at
most one designated server-side call site, and several (`compareObservations`,
`evaluateFrontendContract`, `projectBoundedAgentContext`,
`deriveRuntimeStaticCorrelations`, `attachRuntimeStaticCorrelations`) are
never called by the viewer at all. The viewer never runs
`@dailephd/my-dev-kit`, never mutates target source or any Observer
artifact, never persists a new viewer-owned evidence family, and every route
rejects non-`GET`/`HEAD` methods.

**Validated on the canonical worktree** (this documentation/completeness
audit stage): `npm run typecheck`, `npm run lint`, `npm test`, `npm run
build`, `npm run check:docs`, and `npm run test:browser` all pass - see
"Post-edit validation" in
`docs/reports/v0.8-implementation-completeness-documentation-reconciliation.md`
for exact counts.

**Not yet performed** (belongs to the next workflow stage, not this one):
formal Windows/Linux/macOS cross-platform pre-release validation of the
viewer/PWA surface through `.github/workflows/pre-release-readiness.yml`
(that workflow currently covers v0.1-v0.7 only - see `docs/CI_CD.md`);
formal pre-release security review of the viewer surface (Batch 8's security
audit was local/manual, not the formal stage); version bump to `0.8.0`;
release preparation; npm publication; and git tagging.

## Not implemented

- v0.5 baseline-selection/discovery policy (the caller must supply which
  baseline to approve/evaluate against; there is no "find the current
  baseline" command), source ownership, orchestrator/lab product
  integration, and annotation all remain unimplemented in this repository.
  (v0.6's bounded runtime projection and runtime/static correlation, the
  complete v0.7 external-reference correction workflow described above, and
  the v0.8 interactive viewer described in "v0.8 status" above, *are* now
  implemented.) A CLI surface for Prompt 8's correction workflow specifically
  remains unimplemented by design (programmatic-only, library-level use is
  the current supported entry point) - see "v0.7 Prompt 8 status" above.
  Structured visual annotation (v0.9) and the full graphical human-LLM
  workflow (v0.10) remain future and unimplemented.

## Next target

v0.1-v0.7 are implemented, validated, and released (`0.1.0`, `0.2.0`,
`0.3.0`, `0.4.0`, `0.5.0`, `0.6.0`, `0.7.0`). v0.7 (End-to-End Coding-Agent
Frontend Change Review) is fully implemented and released: the
external-reference artifact foundation, explicit reference
regions/relationships, selected design requirements/tolerance
semantics/reference-evidence adequacy, reference applicability
and candidate-state compatibility, explicit reference-region/
runtime-target binding, structured reference-vs-candidate
fidelity evaluation, bounded reference-fidelity projection into
the existing v0.6 bounded-agent-context, and the controlled
end-to-end correction workflow with real-Chromium proof are all
implemented and released as package version `0.7.0`, following a completed
pre-release readiness, cross-platform, and security validation stage - see
`docs/ROADMAP.md` for v0.7's full scope,
`docs/reports/v0.7-implementation-completeness-documentation-reconciliation.md`
for the completeness audit, and
`docs/reports/v0.7-pre-release-readiness.md` for the cross-platform
readiness validation that preceded this release.

v0.8 (Interactive Local Observation Viewer) is fully implemented and tested
in the current repository - see "v0.8 status" above - but **not released**:
package metadata remains `0.7.0`. All eight implementation batches and this
hardened documentation/implementation-completeness audit have passed. The
next workflow stage is v0.8 pre-release readiness (formal cross-platform and
security validation), followed by release preparation (version bump to
`0.8.0`, package hygiene) and, only after explicit user approval,
publication - none of which have occurred yet. v0.9 (structured visual
annotation) and v0.10 (full graphical human-LLM workflow) remain future -
see `docs/ROADMAP.md`.
