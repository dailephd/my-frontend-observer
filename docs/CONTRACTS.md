# Contracts

## Current contracts

The v0.1 observation artifact contract is implemented (`src/domain/schema.ts`)
and proven both from the source checkout and from the packed npm tarball:

- artifact kind `my-frontend-observer/observation`, schema version `1.0.0`
  (independent of the package version, currently `0.1.0`);
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

This contract is implemented; it is not yet published as a package, and no
public programmatic-API compatibility promise has been made.

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
