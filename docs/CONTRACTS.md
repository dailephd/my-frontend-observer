# Contracts

## Current contracts

No product observation artifact, runtime evidence, diagnostic, browser, or
public programmatic API contract is implemented or released. The package is
private at `0.0.0`; the current bin is only a transparent not-implemented
starter placeholder.

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

These are planning inputs, not current behavior. Because the historical
greenfield prompt overreached into v0.1, the authorized v0.1 planner must verify
them against Project Description, Project Milestones, ROADMAP, and current
repository evidence before treating them as implementation commitments.

Comparison and relationship contracts belong to v0.4, and canonical
change-scope contracts belong to v0.5. Bounded agent-context plus ecosystem
integration contracts move to v0.6, followed by the text/config-driven
coding-agent review contract in v0.7. Viewer and annotation contracts follow in
v0.8 and v0.9 and converge with the existing workflow in v0.10.
