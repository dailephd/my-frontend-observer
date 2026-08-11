# Contracts

## Current contracts

The v0.1 observation artifact contract is published as `my-frontend-observer@0.1.0`
and proven both from the source checkout and from the packed npm tarball. On the
active v0.2 implementation branch, the observation schema has advanced to `1.1.0`
(see "Active v0.2 target-contract evolution" below); the published `0.1.0` package
still ships schema `1.0.0`:

- artifact kind `my-frontend-observer/observation`, schema version `1.1.0` on the
  v0.2 implementation branch (`1.0.0` in the published `0.1.0` package;
  independent of the package version either way);
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

## Active v0.2 target-contract evolution

v0.2 (implementation branch only, not yet published) introduces a canonical
target-configuration model: each configured target has a stable
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
resulting target evidence shape. This section will be superseded by the full
v0.2 documentation reconciliation once all v0.2 batches are complete.

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
