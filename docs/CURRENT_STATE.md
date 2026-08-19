# Current State

The project is published at package version `0.6.0` (roadmap v0.6, Bounded
Agent Context and Native my-dev-kit Ecosystem Integration; observation
schema `1.2.0`; comparison schema `1.0.0`; frontend contract schema
`1.0.0`; evaluation artifact schema `1.0.0`; bounded-agent-context schema
`1.0.0`) - see "v0.6 status" below.

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
surface described below (`observe`, `compare`, `approve-baseline`,
`save-change-contract`, `evaluate-contract`), while remaining a thin
parsing/dispatch/presentation boundary; it is no longer the not-implemented
placeholder.

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

## Not implemented

- v0.5 baseline-selection/discovery policy (the caller must supply which
  baseline to approve/evaluate against; there is no "find the current
  baseline" command), source ownership, orchestrator/lab product
  integration, viewer, and annotation all remain unimplemented in this
  repository. (v0.6's bounded runtime projection and runtime/static
  correlation *are* now implemented - see "v0.6 status" above.)

## Next target

v0.1-v0.6 are implemented, validated, and released (`0.1.0`, `0.2.0`,
`0.3.0`, `0.4.0`, `0.5.0`, `0.6.0`). v0.7 (End-to-End Coding-Agent Frontend
Change Review) is next.
