# Contracts

## Current contracts

The observation artifact contract is published in the current
`my-frontend-observer@0.6.0` package and proven both from the source checkout
and from the packed npm tarball, on Windows, Linux, and macOS. The observation
schema is `1.2.0` (see "v0.2 target contract" and "v0.3 scroll scenario
contract" below):

- artifact kind `my-frontend-observer/observation`, schema version `1.2.0`
  (independent of the package version);
- one artifact root per observation, `<outputLocation>/<observationId>/`,
  containing exactly `manifest.json` (the full `ObservationArtifact`, with
  page/target evidence embedded inline) and `screenshot.png` - there is no
  separate `evidence.json`;
- `manifest.json` is written last, after `screenshot.png`, via one atomic
  directory rename, so a consumer never observes a partially-written
  artifact; a filesystem failure anywhere in that sequence reports the
  `artifact-write-failure` diagnostic and leaves no completed artifact;
- internal artifact references (e.g. `screenshot.png`) are relative to the
  artifact root, never an absolute machine path; the observation's logical
  identity is its `observationId`, not its filesystem location;
- evidence states `available`, `unavailable`, `not-applicable`, `partial`;
  evidence sources `browser`, `computed-browser`, `derived`;
- a stable diagnostic vocabulary (`src/domain/diagnostics.ts`) and completion
  states `complete`, `partial`, `warning`, `invalid-request`, `fatal`
  (`src/domain/completion.ts`);
- observation/request identity, producer/package identity, and browser
  provenance are all present in every persisted manifest.

This contract is implemented and published; no public programmatic-API
compatibility promise has been made for the observation engine itself. v0.6
additionally publishes the bounded-agent-context/correlation programmatic surface
described later in this document.

## v0.2 target contract (shipped as part of this release)

v0.2 introduces a canonical target-configuration model: each configured target has a stable
observer-level `name` plus an ordered array of bounded `locators`
(`role`, `id`, `data-attribute`, `semantic-element`, `css`, `text`). This
identity is distinct from both the browser locator definition that resolves
it and any source-code identity. The legacy `{name, selector}` shape remains
accepted and normalizes to a one-item `css` locator, so every published
`0.1.0` CLI invocation continues to work unchanged. Locator precedence is the
configured array order; resolution stops on the first unique match, on any
ambiguous match (never falling through to a later locator), or on an
unevaluable locator - never silently. All six frozen locator kinds are now
resolved against a real Chromium page (`role` via Playwright's accessibility-
role/name locator with exact name matching, `id`/`data-attribute` via exact
CSS attribute-equals matching that never reinterprets the configured value as
selector syntax, `semantic-element` via the frozen tag set, `css` via the
existing v0.1 behavior, `text` via exact-text matching only); every kind
converges on the same measurement path, so locator strategy never changes the
resulting target evidence shape.

Each resolved target's evidence record additionally carries three bounded
fields: `semanticState` (a first family of `disabled`/`expanded`/
`checked`/`selected`/`pressed`/`current` values read from the element's own
native form-control properties and explicit `aria-*` attributes - a key is
present only when the browser exposes that state as applicable to this
element, so an explicit `false` is always distinguishable from "not
applicable"; `not-applicable` when no supported state applies at all);
`landmark` (derived only from the already-captured browser-exposed
role - never from locator kind or HTML tag - against the standard landmark
role set `banner`/`navigation`/`main`/`complementary`/`contentinfo`/`form`/
`region`/`search`); and `containment` (bounded DOM containment checked only
among the other explicitly configured targets in the same observation, in
configured order, never a layout/relationship graph - `available` when every
other configured target was itself resolved and checked, `partial` when one
or more could not be, `unavailable` when the target itself never resolved).
Stable observer target identity is proven, not just declared: the same
target configuration produces the same `requestId` across repeated
observations (with a fresh `observationId` each time); changing a target's
locator strategy while keeping its stable name changes `requestId` but not
the `targetEvidence` key; and actual runtime disappearance of a
still-configured target changes only its resolution status, never the
`requestId`.

The full canonical semantic target model above is reachable through the
real public CLI: `my-frontend-observer observe --targets-file <json-file>`
supplies the structured `{ "targets": [...] }` collection (see
`docs/COMMANDS.md` "Structured semantic targets") as an alternative to the
existing `--target id=css-selector` shorthand - the two are mutually
exclusive per invocation, and both converge on the same
`normalizeRequest()`/browser-resolver/artifact path, so a semantic
observation produces exactly the same `manifest.json` shape as a
CSS-shorthand one. Schema `1.1.0` was the v0.2 published artifact schema;
schema `1.2.0` has been emitted since v0.3 and remains the observation schema
in the current published v0.6.0 package, for both target-input modes
(target semantics are unchanged from v0.2 - see the v0.3 scroll scenario
contract below for what schema `1.2.0` actually adds). `--targets-file`'s
local input path is never part of the persisted request identity or
artifact.

## v0.3 scroll scenario contract (shipped as part of this release)

v0.3 introduces one optional, additive request/evidence concern: a bounded
runtime scroll scenario, schema `1.2.0`.

A normalized request may carry `scrollScenario: { action }` with exactly one
of two frozen action kinds:

- `{ "kind": "window-scroll-by", "deltaX": <int>, "deltaY": <int> }`
- `{ "kind": "target-scroll-by", "target": "<stable target name>", "deltaX": <int>, "deltaY": <int> }`

`deltaX`/`deltaY` are signed integers bounded to `[-20000, 20000]`; at least
one must be non-zero. `target-scroll-by.target` refers only to an existing
stable configured target `name` (never a selector) and resolves through the
same canonical `resolveConfiguredTargets` algorithm every v0.2 locator kind
already uses - there is no second target-resolution path. A request with no
scenario normalizes and identifies exactly as it did before v0.3.

Execution (both action kinds share one code path): perform the immediate,
non-smooth scroll (`window.scrollBy`/`element.scrollBy`, `behavior:
'instant'`) on the already-navigated, already-ready page; wait exactly two
`requestAnimationFrame` cycles; capture a final runtime snapshot. No second
browser, page, or navigation is ever created. The resulting scroll position
is browser-authoritative and may be clamped by document/element boundaries;
a scenario producing no movement is still a valid, successfully persisted
observation.

The scenario evidence lives entirely inside the existing `manifest.json` as
one additional optional `scrollScenarioEvidence` field on `ObservationArtifact`
- there is no separate `scroll.json`/`scenario.json`. It contains:

- `initial`/`final`: bounded `ScrollRuntimeSnapshot`s (window `scrollX`/
  `scrollY`; the browser's own scrolling-root/`documentElement`/`body`
  metrics; per-configured-target `scrollTop`/`scrollLeft`/`scrollWidth`/
  `scrollHeight`/`clientWidth`/`clientHeight`, actual overflow, bounding
  rectangle, and viewport relation);
- `transition`: bounded before/after change evidence (window scroll deltas;
  per-target `scrollTop`/`scrollLeft`/bounding-position/viewport-relation
  changes; `enteredViewport`/`leftViewport`) - never a generic recursive
  diff, and a target is simply omitted when either side's evidence isn't
  itself usable (e.g. it never resolved);
- `scrollOwner`: one derived `EvidenceField<ScrollOwnerInterpretation>`
  (`document` | `target:<stable-name>` | `none` | `indeterminate`), always
  `source: "derived"` with non-empty `derivedFrom` naming the exact
  contributing scroll-position measurements. Ownership is derived only from
  observed `scrollTop`/`scrollLeft`/`window.scrollX`/`window.scrollY`
  changes - never from bounding-rectangle movement (which moves for every
  configured target whenever the document scrolls), computed overflow,
  `position: fixed`/`sticky`, or DOM hierarchy.

Actual dimensional overflow (`scrollWidth > clientWidth` /
`scrollHeight > clientHeight`) is always reported separately from the
computed `overflow-x`/`overflow-y` CSS declaration; a declared
`overflow: auto` container with content that fits produces
`horizontalOverflow`/`verticalOverflow: false`. Viewport relation
(`above`/`intersecting`/`below`, `intersectsViewport`, `fullyWithinViewport`)
is derived only from bounding geometry plus viewport size, relative to the
browser viewport; a hidden/non-rendered target's viewport relation is
`not-applicable`, never a fabricated geometry claim - hidden and offscreen
remain distinct evidence concepts, and the existing `target-hidden`
diagnostic is unaffected.

The ordinary, already-existing `pageEvidence`/`targetEvidence`/
`screenshot.png` for a scenario observation always describe this same final
post-action state, never the pre-action state.

The scenario request participates in `requestId`; the runtime result
(actual scroll distance, clamping, or scroll-owner outcome) never does. The
public entry point is `my-frontend-observer observe --scroll-scenario-file
<json-file>` (see `docs/COMMANDS.md`); the file supplies the scenario value
directly, and its local path is operational input only, exactly like
`--targets-file`'s path - never persisted, never part of request identity.

## v0.4 comparison contract (shipped as part of this release)

**Current status: shipped as part of the published `my-frontend-observer@0.4.0`
package and unchanged through the current `0.6.0` release.** Observation
schema remains `1.2.0`. Comparison is a distinct artifact kind and schema,
never a bump to the observation schema:

- artifact kind: `my-frontend-observer/comparison`;
- comparison schema: `1.0.0`.

**Geometry tolerance**: `ComparisonConfig.geometryTolerancePx`, default
`0.5` CSS px, bounded `[0, 10]`. Suppresses insignificant subpixel noise
only - never a design contract, never permission for a change.

**Layout relationship graph**: `deriveLayoutRelationships(observation,
options?)` derives, per observation, a bounded `LayoutRelationshipGraph`
among configured targets only (≤20 targets, ≤190 unordered pairs):
horizontal order (`left-of`/`right-of`/`horizontally-overlapping`),
vertical order (`above`/`below`/`vertically-overlapping`), area overlap
(`overlaps`/`does-not-overlap`), relative width (`wider-than`/
`narrower-than`/`equal-width-within-tolerance`), geometric fit
(`fits-inside`/`does-not-fit-inside` - geometry-only, deliberately distinct
from DOM containment), vertical sequencing (`follows-vertically`), and one
page-level relationship (`document-width-fits-viewport`/
`document-width-exceeds-viewport`). Every relationship carries explicit
evidence-path provenance back to the source observation. A configured
target lacking usable geometry is listed as honestly unresolved
(`not-found`/`ambiguous`/`unavailable`/`hidden`), never fabricated as a
zero-sized region.

**Comparability**: evaluated before any rendered difference, using exactly
three states (`comparable`/`comparable-with-warnings`/`incomparable`) with
structured reasons, never a bare boolean. Hard incompatibilities (page URL,
viewport, browser engine, scroll-scenario configuration mismatch) force
`incomparable`; producer-version, browser-version, and target-configuration
differences are warning-only; theme/authenticated-state/application-state
identity are recorded as `unassessed` dimensions the observer does not yet
model - never silently claimed identical. An `incomparable` result still
persists a structurally valid `ComparisonArtifact` with empty rendered
differences, not a fabricated comparison.

**Difference categories**: `appeared`/`disappeared` (only for a stable
target name configured on both sides, transitioning between a definite
`not-found` and `matched` resolution status - never for a target merely
added/removed from configuration, which is its own separate
`configurationChanges` entry), `moved`/`resized` (tolerance-aware, a target
may be both), `visibility-changed`, `clipping-changed` (reusing the
canonical `deriveTargetClipping` helper, never re-derived), `horizontal-
overflow-changed`/`vertical-overflow-changed` (actual dimensional overflow,
reusing the existing `deriveOverflowEvidence` helper - never inferred from
a CSS declaration alone), `containment-changed` (reusing existing v0.2
`TargetContainment` evidence), `page-size-changed`, `scroll-owner-changed`
(comparing `scrollScenarioEvidence.scrollOwner` only when scenario
*configuration* already matched), `relative-position-changed` (a relation
in the horizontal-order/vertical-order/area-overlap families changed - kept
distinct from plain absolute target movement) and `relationship-changed`
(every other relationship-family transition). Relationship changes are
matched by structural identity (family + subject/related target, or the
page-level key), never by array position.

**Explicit dependency evidence**: `ComparisonConfig.expectedDependencies`
lets a caller declare an expected relationship between two targets' numeric
properties (`x`/`y`/`width`/`height`) and directions (`increase`/
`decrease`/`change`/`unchanged`), always carrying `source:
"explicit-config"`. The observer never synthesizes a declaration from
observed co-change. Each declaration evaluates independently to exactly one
of `consistent`/`not-observed`/`contradictory-to-declaration`/
`unavailable` - never a causal claim (no `causedBy`/`causalConfidence`/
`causalScore`/`dependencyStrength`) and never a PASS/FAIL/approval verdict.
That distinction (evidence vs. contract verdict) is the boundary between
v0.4 and v0.5+.

**Comparison identity**: `comparisonRequestId` is a pure, deterministic
function of `{beforeObservationId, afterObservationId, normalized
ComparisonConfig}` - direction-sensitive (`compare(A, B) !==
compare(B, A)`), and never includes an operational filesystem path.
`comparisonId` is fresh per execution (same pattern as `observationId`).

**Source references**: the comparison artifact retains enough logical
identity to trace back to its authoritative source observations
(`observationId`, `requestId`, `producer`, `observationSchemaVersion`, and
the source `screenshot.path`) without embedding the full
`ObservationArtifact` or copying screenshot bytes. The persisted comparison
directory contains `manifest.json` only.

The public entry point is `my-frontend-observer compare --before <root>
--after <root> --output <directory> [--config-file <json-file>]` (see
`docs/COMMANDS.md`) - comparison itself never launches a browser.

## v0.5 frontend contract and evaluation (shipped as part of this release)

Downstream of the v0.4 observation/comparison/relationship evidence above,
`src/domain/frontendContracts.ts` freezes the v0.5 contract/change-scope
model, `src/domain/frontendContractIdentity.ts` freezes deterministic
contract/baseline/clause identity, and `src/domain/frontendContractEvaluation.ts`
implements the one canonical pure evaluation engine. Baseline/per-change
contract persistence, evaluation-artifact persistence, explicit baseline
approval, and public CLI exposure are all implemented and shipped (see
"v0.5 contract and evaluation persistence" and "v0.5 public contract/
evaluation commands" below).

**Contract classes**: a `PersistentBaselineContract` (append/supersession-based
history via an optional `supersedesBaselineId`) and a `PerChangeContract`
(the allowed scope of one requested change). Both share `artifactKind:
"my-frontend-observer/frontend-contract"` and `schemaVersion: "1.0.0"` - an
independent family from the observation (`1.2.0`) and comparison (`1.0.0`)
schemas; the frontend-contract schema constant happens to share the version
string `1.0.0` with comparison's by coincidence only.

**Four authored categories, one derived classification**: every per-change
clause is authored as exactly one of `requested`, `expected-dependent`,
`protected`, or `preserved`. `unexpected` is a fifth, *derived-only*
classification the evaluator produces for a meaningful rendered difference no
active clause accounts for - it can never be authored as a permission.

**Bounded contract primitives**: 15 frozen `ContractPrimitive` kinds cover
visibility, clipping, width bounds, non-overlap, relative width, vertical
sequence, geometric fit (explicitly distinct from DOM containment),
document-width-vs-viewport, scroll ownership, initial-viewport position,
relationship-unchanged, and property-unchanged/increases/decreases - a closed
vocabulary, never a generic expression language.

**Contract tolerance**: `exact` / `absolute-px` / `percent`, independent of
`ComparisonConfig.geometryTolerancePx` (which only suppresses insignificant
comparison noise and is never contract authorization). Percent tolerance's
denominator is the absolute before-value.

**Required vs. permitted expected-dependent**: `required` clauses must occur
compliantly to pass; `permitted` clauses accept no change or a compliant
change, and fail only on a strictly contradictory change.

**Evaluation result vocabulary**: each clause resolves to `pass` / `fail` /
`unavailable` (with a required non-empty reason - required evidence gaps and
an `incomparable` source comparison never fabricate a `pass`) / `conflict`
(with at least two `conflictingClauseIds` - covers both an unresolved
baseline/per-change contradiction and an unknown `supersedesBaselineClauseIds`
reference). The overall verdict is `PASS` only when every clause result is
`pass` and no unexpected change remains; otherwise `FAIL` - there is no
partial-pass scoring.

**Explicit supersession, never inferred**: a per-change clause may list
`supersedesBaselineClauseIds` to remove specific baseline clauses from active
evaluation. Two clauses that structurally contradict each other on the same
(target, property) without explicit supersession produce a `conflict`, never
a silent preference for one side.

**Reuses existing v0.4 evidence directly**: the evaluator consumes an
already-computed `ComparisonArtifact` (`differences`, `relationshipChanges`,
`relationshipsBefore`/`relationshipsAfter`, `comparability`) and the source
`ObservationArtifact` pair - it never re-launches a browser, re-resolves a
target, or reimplements clipping/relationship/scroll-owner derivation.
Unexpected-change derivation reads `ComparisonArtifact.differences` only
(which already includes one difference per relationship change), so a single
logical transition is never double-counted.

## v0.5 contract and evaluation persistence (shipped as part of this release)

Persistence consumes the frozen v0.5 domain above; it never redefines it.
`src/artifacts/frontendContractArtifactWriter.ts`/`frontendContractArtifactReader.ts`
persist and read both `PersistentBaselineContract` and `PerChangeContract`
symmetrically (both already share `CONTRACT_ARTIFACT_KIND`/`CONTRACT_SCHEMA_VERSION`,
so one writer/reader pair serves both contract classes) as
`<outputLocation>/<baselineId|contractId>/manifest.json`, following the same
atomic-write discipline as `artifacts/artifactWriter.ts`/`artifacts/comparisonArtifactWriter.ts`
(sibling temporary directory, then one atomic rename; an existing directory at
the final identity is a genuine collision and is rejected, never overwritten -
prior baseline history is never rewritten). `src/artifacts/comparisonArtifactReader.ts`
is a new Batch 3 addition (no comparison reader existed before) mirroring
`artifacts/artifactReader.ts`'s discipline exactly, changing no comparison
semantics and keeping comparison schema `1.0.0`.

**Evaluation artifact envelope**: Batch 1 froze the evaluation-result
vocabulary (`ClauseEvaluationResult`, `OverallVerdict`) but not a persistable
envelope, so `src/domain/frontendContractEvaluationArtifact.ts` adds exactly
that - `artifactKind: "my-frontend-observer/frontend-contract-evaluation"`,
`schemaVersion: "1.0.0"` (its own independent family, distinct from
observation/comparison/frontend-contract), an `evaluationId`/`evaluationRequestId`
pair, bounded `before`/`after` source-observation references, and
`comparisonId`/`comparisonRequestId` plus `contracts: {baselineId,
contractId}` references - never an embedded `ObservationArtifact` or copied
screenshot. It reuses `ClauseEvaluationResult`/`OverallVerdict`/
`UnexpectedChangeResult` unchanged and contains no evaluation logic itself.
`evaluationRequestId` is a deterministic function of `{baselineId,
contractId, beforeObservationId, afterObservationId, comparisonRequestId}`
(`frontendContractIdentity.ts#buildFrontendContractEvaluationRequestIdentity` -
deliberately `comparisonRequestId`, not the fresh-per-execution
`comparisonId`, so semantically identical evaluations share an identity);
`evaluationId` reuses the existing generic `buildFrontendContractInstanceIdentity`
unchanged. `src/artifacts/frontendContractEvaluationArtifactWriter.ts`/
`frontendContractEvaluationArtifactReader.ts` persist/read it with the same
atomic-write discipline as above.

**Application seam**: `src/application/frontendContractEvaluationService.ts#evaluateAndPersist`
calls the existing pure `evaluateFrontendContract` exactly once and - only
for a structurally constructible result, whether the verdict is `PASS` or
`FAIL` - persists exactly one evaluation artifact; an `{ok: false}` evaluator
result (evidence could not be constructed into an evaluation at all) is never
persisted as a fabricated artifact. `evaluateAndPersistFromArtifactRoots` is
the future-CLI-facing wrapper: it reads two observations through the existing
`readObservationArtifact` (never a second observation reader), the
comparison and the two contracts through the readers above, then delegates
to `evaluateAndPersist` exactly once.

## v0.5 public contract/evaluation commands (shipped as part of this release)

Three public commands expose the persistence/evaluation contract above (see
`docs/COMMANDS.md` for exact flags/output/exit behavior, not duplicated
here):

- `approve-baseline` → `frontendContractPersistenceService.ts#approveAndPersistBaseline`
  → validates a `PersistentBaselineContract` and its `sourceObservation`
  coherence against a supplied observation artifact → persists via
  `frontendContractArtifactWriter.ts`. The only baseline-approval act in the
  observer.
- `save-change-contract` → `frontendContractPersistenceService.ts#persistPerChangeContract`
  → validates a `PerChangeContract` (rejecting a baseline contract, an
  authored `unexpected` category, or any other structural violation) →
  persists via the same writer. Persistence only, never approval.
- `evaluate-contract` → `frontendContractEvaluationService.ts#evaluateAndPersistFromArtifactRoots`
  → `evaluateFrontendContract` exactly once → `frontendContractEvaluationArtifactWriter.ts`
  exactly once. `--enforce` affects only the process exit status for an
  already-persisted `FAIL` verdict.

No command infers baseline approval or supersession automatically - not
`compare`, not a `PASS` evaluation, not any artifact writer.

This full command sequence is proven against real Chromium observations (not
hand-constructed artifacts) - see "v0.5 real-browser workflow proof" below.

## v0.5 real-browser workflow proof (shipped as part of this release)

`tests/browser/cliFrontendContracts.test.ts` and
`scripts/dev/builtCliFrontendContractsBrowserSmoke.mjs` drive the complete
`observe` → `approve-baseline` → `save-change-contract` → `observe` →
`compare` → `evaluate-contract` sequence against a real disposable local HTTP
fixture and real Chromium, proving two scenarios:

- a fully successful contract change - a real observed navigation-width
  decrease and workspace-width increase, both satisfying their authored
  `requested`/`expected-dependent` clauses, an unchanged `protected` rail
  width, and an unclipped `preserved` navigation - overall `PASS`;
- the "milestone signature" failure - the same locally successful requested
  change (navigation shrinks, workspace expands, both still `pass`)
  co-occurring with a genuine `protected` right-rail width regression (a real
  `resized` comparison difference) and a genuine `preserved` navigation
  clipping regression (a real `clipping-changed` difference, `not-clipped` →
  `clipped`) - overall `FAIL`.

Both scenarios confirm: `--enforce` changes only the process exit status
(`0` without it, nonzero with it) for the identical persisted
`evaluationRequestId`/`clauseResults`; every source observation and
comparison artifact is byte-identical before and after evaluation; the
evaluation directory contains `manifest.json` only (no copied screenshot);
and no operational filesystem path is ever serialized into a persisted
manifest. This is real-browser evidence layered on top of the CLI-level
proof in `tests/unit/cliFrontendContracts.test.ts` and the Chromium-free
`scripts/dev/builtCliFrontendContractsSmoke.mjs` - it does not replace them.

## v0.6 bounded agent context and correlation contract (released as `0.6.0`)

**Current status: released as package version `0.6.0`, tag `v0.6.0`, from
the canonical `canonicalization/v0.6` lineage.** Bounded-agent-context is a new, independent
artifact-kind family, schema `1.0.0` (`BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND =
"my-frontend-observer/bounded-agent-context"`) - never a bump to
observation/comparison/frontend-contract/evaluation schemas, which remain
`1.2.0`/`1.0.0`/`1.0.0`/`1.0.0` respectively. Unlike those families, there is
**no disk artifact writer/reader** for bounded-agent-context: it is a pure
programmatic contract and derivation layer, exported from `src/index.ts`
only.

**Bounded runtime projection**
(`src/domain/boundedAgentContextProjection.ts#projectBoundedAgentContext`)
produces a `BoundedRuntimeTargetProjection` from already-captured v0.1-v0.5
evidence, containing: page/viewport identity; stable target identities;
important geometry and runtime behavior; layout/behavior relationships;
before/after differences; contract clause results; requested/expected-
dependent/protected/preserved scope - reusing `src/domain/
frontendContracts.ts`'s existing clause types verbatim, never a
reimplementation; diagnostics; screenshot/artifact references; provenance;
and explicit `OmissionRecord`/`TruncationRecord` metadata with bounded
aggregate-cap summarization once a limit is reached.

**Adequacy**: every projection carries an `Adequacy` value
(`adequate`/`partial`/`inadequate`) plus a structured, closed
`ADEQUACY_REASON_CODES` vocabulary - evidence existing is not itself
adequacy; a required omission or an `incomparable`/unavailable upstream
source is reflected honestly rather than silently reported as sufficient.

**Runtime/static correlation**
(`src/domain/boundedAgentContextCorrelation.ts#deriveRuntimeStaticCorrelations`/
`attachRuntimeStaticCorrelations`) evaluates each stable runtime target
against caller-supplied candidate static-evidence records into exactly one of
three outcomes: `correlated`, `ambiguous` (multiple competing candidates,
all preserved and visible - never silently resolved to one), or
`unavailable` (no supported candidate). The module accepts only plain,
already-retrieved candidate records and has no dependency on
`@dailephd/my-dev-kit` - the audit preceding implementation found no generic
static-side retrieval capability actually missing (see `docs/ROADMAP.md` v0.6
"Dependency direction"). A runtime target identity is carried through
verbatim; correlation never produces a `sourceOwner`/`causedBy`-shaped field,
so a stable runtime identity is never silently reported as source ownership.

**Identity**: `src/domain/boundedAgentContextIdentity.ts#buildBoundedAgentContextRequestIdentity`/
`buildBoundedAgentContextInstanceIdentity` follow the same
canonicalize+sha256(+opaque-nonce) pattern as `comparisonIdentity.ts`/
`frontendContractIdentity.ts`: a deterministic logical identity distinct from
a fresh per-execution instance identity.

**Export/public boundary**: `src/index.ts` exports the complete
bounded-agent-context/correlation type and function surface as a
programmatic library contract. There is no CLI command (`observe`/`compare`/
`approve-baseline`/`save-change-contract`/`evaluate-contract` remain the only
public commands) and no orchestrator/lab code in this repository - bounded
runtime-evidence consumption by `my-dev-kit-orchestrator` and exact
readers/fixtures/evaluation in `my-dev-kit-lab` are separate sibling-
repository deliverables outside `my-frontend-observer`'s public surface.

**Compatibility evidence**: cross-repository neutral verification (observer
`514bf3bb513764815a0a5b9e508d5836aa7d7fd8`, orchestrator `9473e4c`, lab
`271e72c`) passed with 6/6 requirement coverage and no known product
blockers; on the canonical worktree, `npm run typecheck`, `npm run lint`,
`npm test` (627 tests), `npm run test:browser` (120 tests), `npm run
test:security`, `npm run build`, and `npm run check:docs` all pass.

## Planned v0.7+ external visual-reference contract direction

External visual-reference support is future work and is not part of the
published `0.6.0` contract. The exact public type names, artifact kinds, schema
versions, persistence layout, and command/programmatic entry points must be
designed during v0.7 planning from current repository precedent. This section
freezes only the contract boundaries that later planning must preserve.

**Distinct evidence domain**: an external reference is desired-design evidence,
not an `ObservationArtifact` and not the "before" side of a v0.4
`ComparisonArtifact`. Reference design vs candidate is distinct from both
before vs after comparison and frontend-contract evaluation. The implementation
must not fake this distinction by wrapping a raster image in an observation
shape.

**Reference identity and provenance**: a future reference contract must preserve
a deterministic logical reference identity/version where appropriate, source
image reference plus dimensions/format, provenance, bounded region definitions,
applicable viewport/theme/application-state identity, authored design intent,
relationship/style evidence where supported, limits/diagnostics, and approval/
supersession history. Operational filesystem paths must not become semantic
identity. A raw imported image never silently becomes an approved active
reference.

**Reference regions and runtime targets stay distinct**: a reference region
must have its own identity and coordinate semantics. Reference-region to runtime-
target association must be explicit and capable of representing ambiguity or
unavailability. Runtime target identity and reference identity must never
silently become static source ownership; static association still goes through
the v0.6 runtime/static correlation boundary.

**Applicability before fidelity**: viewport, theme, application state, and
other selected compatibility dimensions must be evaluated before ordinary
reference/candidate differences are produced. If the reference and candidate
represent different intended states, the result must be explicitly incompatible
or incomparable rather than filled with fabricated visual failures. Planning
should reuse or extend the canonical v0.4 comparability conventions where they
mean the same thing rather than invent an unrelated reference-only state model.

**Canonical contract semantics remain authoritative**: executable reference-
derived requirements must map into the existing v0.5 authored categories
`requested`, `expected-dependent`, `protected`, or `preserved`. The derived-only
`unexpected` classification remains derived-only. Informational or unassessed
reference evidence may stay outside executable contract evaluation until
explicitly promoted. A second reference-only PASS/FAIL taxonomy is forbidden.

**Tolerance separation**: reference-fidelity tolerances are not automatically
the same as v0.4 `ComparisonConfig.geometryTolerancePx` or v0.5 contract
tolerances. Planning must define property-specific semantics for reference
geometry, spacing, selected style evidence, text/font rendering differences,
asset-sensitive regions, and optional image similarity. One global pixel-perfect
threshold is not an acceptable contract.

**Structured evidence first**: geometry, relationships, authored requirements,
applicability, provenance, and selected bounded style/asset evidence remain
inspectable primary evidence. Screenshot-region or image-similarity evidence may
supplement them where reliable, but pixel similarity alone must not determine
success and must never override active baseline/per-change contracts.

**Bounded correction evidence**: future reference/candidate results must support
a bounded projection suitable for coding-agent correction, such as reference
measurement, candidate measurement, delta, failed relationship/style condition,
relevant reference/runtime identities, provenance, and active protected/
preserved constraints. Heavy reference image bytes should be referenced, not
copied into every downstream context packet.

**Approval and supersession**: reference import, reference approval, baseline
approval, reference supersession, and baseline supersession are separate acts.
A reference-fidelity `PASS`, a frontend-contract `PASS`, or a successful
before/after comparison must not silently approve or replace any reference or
baseline.

The planned v0.8 viewer must consume this v0.7 reference/evaluation contract;
it must not create a UI-only reference model. v0.9 annotations may originate
from runtime screenshots or external references but must preserve which source
identity/coordinate system they belong to and feed the same canonical contract
semantics. v0.10 combines both entry modes into the full correction/approval
workflow.

## Approved v0.1 design inputs

The historical greenfield scaffold plan recorded these v0.1 design decisions:

- artifact kind `my-frontend-observer/observation`;
- schema version `1.0.0`, independent of package version;
- one portable directory containing `manifest.json`, `evidence.json`, and
  `screenshot.png`;
- evidence states `available`, `unavailable`, `not-applicable`, and `partial`;
- evidence sources `browser`, `computed-browser`, and `derived`;
- bounded explicitly requested targets, provenance, diagnostics, completion
  state, limits, and relative artifact references.

These were planning inputs only at the time they were recorded. As shown in
"Current contracts" above, the implemented contract matches them except for
the file layout: there is no separate `evidence.json` - page/target evidence
is embedded directly inside `manifest.json`.

Comparison and relationship contracts belong to v0.4, and canonical
change-scope contracts belong to v0.5 - see "v0.5 frontend contract and
evaluation" above for the full shipped contract model, identity, evaluation
engine, persistence, baseline approval, and CLI exposure. Bounded
agent-context and runtime/static correlation contracts are v0.6 - see "v0.6
bounded agent context and correlation contract" above for the full released
model. The text/config-driven coding-agent review plus non-graphical external
visual-reference foundation is v0.7 - see "v0.7 Prompt 1 external-reference
artifact contract" below for the foundation layer implemented so far. Viewer
consumption of that reference model follows in v0.8; dual-context annotation
follows in v0.9; both visual entry modes converge with the existing workflow
in v0.10.

## v0.7 Prompt 1 external-reference artifact contract

Implemented, unreleased. This is the foundation layer only: identity,
provenance, bounded image metadata, and a two-state lifecycle for one
externally supplied design-reference image. It implements no region,
geometry, relationship, requirement, tolerance, binding, or fidelity-
evaluation contract - those belong to later v0.7 prompts.

An external reference is a distinct evidence root, not a variant of
`ObservationArtifact`: it never reuses `ARTIFACT_KIND`/`SCHEMA_VERSION`
(observation), `COMPARISON_ARTIFACT_KIND`, or `CONTRACT_ARTIFACT_KIND`, and
those existing types gain no new field from this contract.

```ts
const EXTERNAL_REFERENCE_ARTIFACT_KIND = 'my-frontend-observer/external-reference';
const EXTERNAL_REFERENCE_SCHEMA_VERSION = '1.0.0'; // independent of package.json version and every other family's schema version

type ExternalReferenceImageFormat = 'png' | 'jpeg' | 'webp';

interface ExternalReferenceImageReference {
  path: string; // bare relative filename within the artifact's own directory
  format: ExternalReferenceImageFormat;
  width: number;
  height: number;
  byteLength: number;
  sha256: string; // identity-bearing content hash of the raw image bytes
}

// Points back to the imported artifact that owns the image, without copying its bytes - mirrors ComparisonSourceObservationReference.
interface ExternalReferenceSourceReference {
  referenceId: string;
  referenceRequestId: string;
  producer: { name: 'my-frontend-observer'; version: string };
  schemaVersion: '1.0.0';
  image: ExternalReferenceImageReference;
}

// Exactly two persisted states - no literal 'superseded' variant (see below).
type ExternalReferenceLifecycleState = { state: 'imported' } | { state: 'approved'; approvedAt: string };

interface ExternalReferenceArtifactBase {
  artifactKind: 'my-frontend-observer/external-reference';
  schemaVersion: '1.0.0';
  referenceRequestId: string; // deterministic logical identity - shared by an imported artifact and every artifact produced by approving it
  referenceId: string; // fresh per-persisted-instance identity
  producer: { name: 'my-frontend-observer'; version: string };
  provenance: { importedAt: string; label?: string };
  supersedesReferenceId?: string; // explicit, forward-only supersession of a prior reference's referenceId
  diagnostics: Diagnostic[];
  completion: CompletionState;
}

// lifecycle.state === 'imported': owns the image.
interface ImportedExternalReferenceArtifact extends ExternalReferenceArtifactBase {
  lifecycle: { state: 'imported' };
  image: ExternalReferenceImageReference;
}

// lifecycle.state === 'approved': references, never copies, the imported artifact's image.
interface ApprovedExternalReferenceArtifact extends ExternalReferenceArtifactBase {
  lifecycle: { state: 'approved'; approvedAt: string };
  sourceReference: ExternalReferenceSourceReference;
}

type ExternalReferenceArtifact = ImportedExternalReferenceArtifact | ApprovedExternalReferenceArtifact;
```

Key rules:

- `referenceRequestId` is a pure function of `{imageSha256, format, width,
  height, supersedesReferenceId}` only - never a filesystem path, output
  location, label, or timestamp. Byte-identical image content imported from a
  different operational root produces the same `referenceRequestId`;
  changing any of those fields changes it.
- `referenceId` is fresh (nonce-based) on every persisted write, including
  every approval of an already-imported reference.
- Importing an image never approves it (`lifecycle.state` is always
  `'imported'` immediately after import, regardless of a supplied label or
  supersession target). Approval is a single explicit act
  (`approveExternalReference`, mirroring `approveAndPersistBaseline`) that
  refuses anything not currently in the `'imported'` state.
- Approving persists a *new* artifact instance (same `referenceRequestId`,
  fresh `referenceId`) carrying a `sourceReference` back to the imported
  artifact - it never mutates the imported artifact's own manifest, and never
  copies the image bytes a second time.
- Supersession is represented only as a forward pointer
  (`supersedesReferenceId` on the newer artifact); there is deliberately no
  literal `'superseded'` lifecycle state, so an existing persisted artifact's
  own manifest is never rewritten - immutability holds unconditionally rather
  than depending on careful mutation discipline.
- Supported formats are frozen to exactly `png`/`jpeg`/`webp`, detected from
  header/magic bytes only (never a caller-declared file extension), bounded
  to `EXTERNAL_REFERENCE_MAX_IMAGE_BYTES` (20,000,000 bytes) and
  `[EXTERNAL_REFERENCE_MIN_DIMENSION_PX, EXTERNAL_REFERENCE_MAX_DIMENSION_PX]`
  (`[1, 8192]`) pixels per side. No OCR, no raster decode, no computer
  vision, no automatic region detection.

Persisted as `<outputLocation>/<referenceId>/manifest.json` (+
`reference.<ext>` for an `'imported'` artifact only), via the same atomic
temp-dir-then-rename discipline as every other artifact family
(`src/artifacts/externalReferenceArtifactWriter.ts` /
`externalReferenceArtifactReader.ts`). CLI: `import-reference <image-file>
--output <dir> [--label] [--supersedes <root>]` and `approve-reference
--reference <root> --output <dir> [--supersedes <root>]`.

## v0.7 Prompt 2 explicit reference regions and relationships

Implemented, unreleased. Additive extension of the Prompt 1 contract above:
one new, optional `regions?: ReferenceRegion[]` field on
`ExternalReferenceArtifact` (both lifecycle variants), plus a pure,
non-persisted relationship-derivation capability. No schema version bump -
`EXTERNAL_REFERENCE_SCHEMA_VERSION` remains `'1.0.0'`, because the field is
genuinely optional/additive and every Prompt 1 artifact (which predates this
field entirely) remains valid without it.

```ts
// domain/externalReferenceRegions.ts
interface ReferenceRegionRectangle { x: number; y: number; width: number; height: number; }
interface ReferenceRegion { id: string; rectangle: ReferenceRegionRectangle; }

// Pure derived geometry - never persisted, always recomputed, so it can never drift from the rectangle above.
interface ReferenceRegionGeometry {
  x: number; y: number; width: number; height: number;
  right: number; bottom: number; centerX: number; centerY: number;
}

const REFERENCE_REGION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/; // same convention as request/request.ts's target-name pattern
const MAX_REFERENCE_REGIONS = 20; // same bound value as request/request.ts's MAX_TARGETS - independently owned, coincidentally equal
```

Region coordinate semantics: origin at the reference image's top-left
corner, x increasing rightward, y increasing downward, unit is
reference-image pixels (explicitly not CSS pixels - a static image has no
CSS box model), coordinates may be fractional. A region's rectangle must lie
entirely within its owning image's own already-validated
width/height - out-of-bounds geometry is rejected outright, never clamped.

Key rules:

- Only `{x, y, width, height}` is canonical/authored. `right`, `bottom`,
  `centerX`, `centerY` are pure calculations over it
  (`deriveReferenceRegionGeometry`) - never a second, potentially-drifting
  stored copy of the same fact.
- Region content is identity-bearing:
  `buildExternalReferenceRequestIdentity` gained an additive, optional
  trailing `regions` parameter. Omitting it entirely (every Prompt 1 call
  site, and any Prompt 2 call that legitimately has no regions) produces the
  byte-identical hash Prompt 1 already produced - the parameter is left out
  of the hashed view rather than defaulted to `null`, unlike
  `supersedesReferenceId`. Authored region order participates in identity
  (arrays are never reordered by the shared `canonicalize()`), mirroring
  `domain/identity.ts`'s treatment of configured targets.
- Region IDs are unique case-insensitively within one artifact (mirroring
  `request/request.ts`'s target-name dedup convention exactly).
- `import-reference` gained an optional `--regions-file <json-file>` of the
  form `{ "regions": [...] }` (same object-root-wrapper convention as
  `--targets-file`); a legacy invocation without it behaves exactly as in
  Prompt 1. `approve-reference` carries an imported artifact's `regions`
  forward verbatim (never re-validated, never re-derived, never dropped) -
  approval never adds, removes, or edits regions.
- One new diagnostic code, `invalid-reference-region` (error), covers every
  region-validation failure (missing/duplicate/malformed id,
  non-finite/negative/zero geometry, out-of-image-bounds, over the bounded
  region count) - deliberately not split into several codes, per the
  "don't proliferate diagnostics" convention.

Reference-region relationships (`domain/externalReferenceRegionRelationships.ts`)
reuse the exact same pure, tolerance-aware geometry predicates that
`domain/relationships.ts#deriveLayoutRelationships` uses for runtime targets
(`horizontalOrderOf`/`verticalOrderOf`/`areaOverlapOf`/`relativeWidthOf`/
`geometricFitOf`/`verticalSequenceOf`, now exported additively from that
module with unchanged formulas) and the same `PairwiseRelationshipKind`
vocabulary and `EvidenceReference` type - never a duplicated or
reinterpreted copy. Only the six geometry-only families apply (horizontal
order, vertical order, area overlap, relative width, geometric fit, vertical
sequencing); DOM containment, scroll ownership, runtime visibility, and
page-width-vs-viewport are runtime/browser concepts with no reference-image
equivalent and are not reused. `fits-inside`/`does-not-fit-inside` is
geometry-only fit - it never claims DOM containment, which an external image
cannot expose.

```ts
interface ReferenceRegionRelationship {
  kind: PairwiseRelationshipKind;
  subjectRegion: string;   // deliberately distinct field name from PairwiseLayoutRelationship's subjectTarget
  relatedRegion: string;
  evidence: EvidenceReference[]; // e.g. { path: 'regions.header.rectangle' } - never a targetEvidence/browser path
}
```

Relationships are **not persisted** on the artifact - `deriveReferenceRegionRelationships(referenceRequestId, regions, options)`
is a pure, deterministic, synchronous function any caller (a future prompt,
a test) calls on demand against an artifact's own `regions` field, avoiding
any possibility of a persisted relationship graph drifting from the region
data it was derived from. Bounded at `MAX_REFERENCE_REGIONS` regions ->
`MAX_REFERENCE_REGION_PAIRS` pairs `x` 6 families =
`MAX_REFERENCE_REGION_RELATIONSHIP_RECORDS` records maximum - the same
bounding shape as `relationships.ts`'s `MAX_PAIRWISE_RELATIONSHIP_RECORDS`.
This is a maximum capacity, never a required minimum region count - there is
no contract requiring any specific number of authored regions.

A reference relationship is a fact about the reference image's geometry
only. It is not a design requirement, not a pass/fail verdict, and does not
claim a runtime target or source owner exists - see
`docs/WORKFLOWS.md` "Current external-reference foundation workflow" for
where those later concepts (Prompt 3+) will attach.

## v0.7 Prompt 3 selected design requirements, tolerance semantics, and reference-evidence adequacy

Implemented, unreleased. Additive extension of the Prompt 1/2 contracts
above: one new, optional `requirements?: ExternalReferenceRequirement[]`
field on `ExternalReferenceArtifact` (both lifecycle variants). No schema
version bump - same reasoning as Prompt 2's `regions` field.

**Central distinction**: a region's geometry is REFERENCE EVIDENCE -
everything visibly/measurably present in the image. A requirement is
SELECTED DESIGN INTENT - only what the user/configuration explicitly chose
as mattering for later candidate evaluation. Nothing in this repository ever
turns a region property or a derived relationship into a requirement
automatically.

```ts
// domain/externalReferenceRequirements.ts

// Reused directly from domain/frontendContracts.ts - not reinvented as a
// "reference-only" taxonomy; that type carries no runtime-only coupling.
// 'unexpected' remains impossible to author (not a member of this union).
type AuthoredChangeScopeCategory = 'requested' | 'expected-dependent' | 'protected' | 'preserved';
type ExpectedDependentMode = 'required' | 'permitted'; // required only (and exactly) when category === 'expected-dependent'

type ReferenceRequirementRegionProperty = 'x' | 'y' | 'width' | 'height' | 'right' | 'bottom' | 'centerX' | 'centerY'; // exactly ReferenceRegionGeometry's own fields
type ReferenceRequirementMeasurement = 'vertical-gap' | 'horizontal-gap' | 'center-x-delta' | 'center-y-delta' | 'left-edge-delta' | 'right-edge-delta';

type ReferenceRequirementSubject =
  | { kind: 'region-property'; region: string; property: ReferenceRequirementRegionProperty }
  | { kind: 'region-relationship'; subjectRegion: string; relatedRegion: string; relationship: PairwiseRelationshipKind } // reused from relationships.ts - geometry-only families only
  | { kind: 'region-measurement'; subjectRegion: string; relatedRegion: string; measurement: ReferenceRequirementMeasurement };

// Deliberately NOT a reuse of frontendContracts.ts's ContractTolerance: that
// type's 'absolute-px' is implicitly runtime/CSS pixels. Reference-image
// pixels are a distinct, explicitly-labeled unit - nothing here assumes
// 1 reference pixel = 1 CSS pixel (Prompt 6 will need an explicit mapping).
type ReferenceRequirementTolerance = { kind: 'exact' } | { kind: 'absolute-reference-px'; amount: number } | { kind: 'percent'; amount: number };

interface ExternalReferenceRequirement {
  requirementId: string; // system-computed from {subject, category, expectedDependentMode, tolerance} only - never authored
  category: AuthoredChangeScopeCategory;
  expectedDependentMode?: ExpectedDependentMode;
  subject: ReferenceRequirementSubject;
  tolerance?: ReferenceRequirementTolerance; // required for region-property/region-measurement; must be absent for region-relationship
}
```

Key rules:

- Requirement identity (`requirementId`) is always system-computed
  (`buildReferenceRequirementIdentity`, mirroring
  `frontendContractIdentity.ts#buildClauseIdentity`'s exact shape) - the raw
  authored input (`RawReferenceRequirement`) has no `requirementId` field at
  all, and supplying one is a validation error. Unlike v0.5's
  `BaselineClause`/`PerChangeClause` (which need an author-visible `clauseId`
  for cross-document `supersedesBaselineClauseIds` references), Prompt 3
  requirements have no cross-document reference need yet, so trusting an
  authored id would only invite drift between a user-typed id and the
  content it claims to identify.
- The reference-side expected value/relationship is never stored on the
  requirement or the artifact - `deriveReferenceRequirementExpectation()` is
  a pure function computed on demand from the artifact's own `regions`,
  eliminating the exact drift risk of persisting e.g. `width: 424` alongside
  a region whose rectangle could (in principle) later disagree with it.
- A requirement referencing a region id that does not exist in the
  artifact's own `regions` is a **structural validation failure** (rejected
  at construction/import time), never merely "unavailable" reference
  evidence - `isValidReferenceRequirements` checks this before any
  requirement reaches adequacy computation.
- **Duplicate/conflicting subject rule**: no two requirements in one
  collection may share the same structural subject (same region+property,
  or the same unordered region pair + relationship, or + measurement),
  regardless of category. This single rule covers both "duplicate
  requirement" and "conflicting categories on the same subject" (e.g. the
  same region/property authored as both `requested` and `protected`) -
  v0.5's `evaluateFrontendContract#primitivesConflict` is a *runtime-
  evaluation-time* detector (it needs before/after `ObservationArtifact`
  evidence that does not exist yet at this stage) and could not be reused
  safely; Prompt 3 restricts invalid combinations at authoring time instead,
  per the documented precedent-review outcome.
- Bounded at `MAX_REFERENCE_REQUIREMENTS` (50) requirements per artifact -
  a maximum capacity, never a required minimum (there is no contract
  requiring any specific number of authored requirements).
- One new diagnostic code, `invalid-reference-requirement` (error), covers
  every requirement-authoring validation failure - deliberately not split
  further, per the "don't proliferate diagnostics" convention already used
  for `invalid-reference-region`.
- `import-reference` gained an optional `--requirements-file <json-file>`
  (`{ "requirements": [...] }`, same object-root-wrapper convention as
  `--regions-file`/`--targets-file`); `approve-reference` carries an
  imported artifact's `requirements` forward verbatim (never re-validated,
  never re-derived, never dropped), exactly mirroring how it already
  handles `regions`.

**Reference-evidence adequacy** (`deriveReferenceRequirementAdequacy(regions, requirements)`)
answers only "does the reference definition itself contain enough evidence
to understand every selected requirement?" - never "does a runtime
target/candidate exist" (that is Prompt 4/5's responsibility). It is its own
small, reference-owned vocabulary (`REFERENCE_REQUIREMENT_ADEQUACY_STATES` =
`'adequate' | 'partial' | 'inadequate'`, and exactly two reason codes,
`no-selected-requirements` and `missing-reference-relationship-evidence`) -
deliberately **not** a reuse of
`boundedAgentContext.ts`'s `Adequacy`/`ADEQUACY_REASON_CODES`, which
describe runtime-target/static-correlation concerns that do not exist at
this stage; mislabeling reference adequacy as bounded-agent-context adequacy
would conflate two genuinely different evidence domains. Zero selected
requirements is explicitly `inadequate` (a region-rich, fully-valid
reference is still not usable for a correction task until the user has
actually selected what matters) - this is a documented product decision,
not an oversight. The result is never a numeric score, always structured
and inspectable, with reasons ordered deterministically by authored
requirement position.

```ts
interface ReferenceRequirementAdequacy {
  status: 'adequate' | 'partial' | 'inadequate';
  totalRequirements: number;
  evaluableRequirements: number;
  unavailableRequirements: number;
  reasons: { code: 'no-selected-requirements' | 'missing-reference-relationship-evidence'; requirementId?: string; detail?: string }[];
}
```
