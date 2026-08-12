# Contracts

## Current contracts

The observation artifact contract is published as `my-frontend-observer@0.3.0`
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
the current v0.3 package emits schema `1.2.0` for both target-input modes
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
change-scope contracts belong to v0.5. Bounded agent-context plus ecosystem
integration contracts move to v0.6, followed by the text/config-driven
coding-agent review contract in v0.7. Viewer and annotation contracts follow in
v0.8 and v0.9 and converge with the existing workflow in v0.10.
