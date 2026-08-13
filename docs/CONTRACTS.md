# Contracts

## Current contracts

The observation artifact contract is published as `my-frontend-observer@0.4.0`
and proven both from the source checkout and from the packed npm tarball,
on Windows, Linux, and macOS. The observation schema is `1.2.0` (see "v0.2
target contract" and "v0.3 scroll scenario contract" below):

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
compatibility promise has been made.

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
the current v0.4 package emits schema `1.2.0` for both target-input modes
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
package.** Observation schema remains `1.2.0`. Comparison is a distinct
artifact kind and schema, never a bump to the observation schema:

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

## v0.5 frontend contract and evaluation (implemented so far)

Downstream of the v0.4 observation/comparison/relationship evidence above,
`src/domain/frontendContracts.ts` freezes the v0.5 contract/change-scope
model, `src/domain/frontendContractIdentity.ts` freezes deterministic
contract/baseline/clause identity, and `src/domain/frontendContractEvaluation.ts`
implements the one canonical pure evaluation engine. Baseline/per-change
contract persistence and evaluation-artifact persistence are implemented (see
"v0.5 contract and evaluation persistence" below); baseline approval and CLI
exposure do not exist yet.

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

## v0.5 contract and evaluation persistence (implemented so far)

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
to `evaluateAndPersist` exactly once. No CLI command exists yet.

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
change-scope contracts belong to v0.5 (contract model, identity, and
evaluation engine implemented so far - see "v0.5 frontend contract and
evaluation" above; persistence, baseline approval, and CLI exposure remain).
Bounded agent-context plus ecosystem integration contracts move to v0.6,
followed by the text/config-driven
coding-agent review contract in v0.7. Viewer and annotation contracts follow in
v0.8 and v0.9 and converge with the existing workflow in v0.10.
