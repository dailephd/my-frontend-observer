# Project Overview

`my-frontend-observer` is the rendered browser/runtime evidence producer in
the my-dev-kit ecosystem. It addresses the gap between source-level evidence
and what a browser actually renders and supports three durable jobs: human-to-LLM
design communication, safer LLM-assisted frontend changes, and runtime evidence
for coordinated ecosystem work. Human-to-LLM design communication may begin
from the currently rendered frontend or, in later versions, from an approved
external visual reference that describes the desired design.

The responsibility split is stable:

- `my-dev-kit` produces static repository/source evidence.
- `my-frontend-observer` produces rendered browser/runtime evidence and owns the
  future structured external-reference evidence needed to compare desired visual
  intent with an actual browser-rendered candidate.
- `my-dev-kit-orchestrator` coordinates workflows and bounded evidence use.
- `my-dev-kit-lab` owns compatibility, fixtures, experiments, and evaluation.

## Current repository state

v0.1, Runtime Observation Foundation; v0.2, Stable Semantic Targets and
Region Identity; v0.3, Runtime Scrolling, Overflow, and Visibility Behavior;
v0.4, Layout Relationships, Dependency Evidence, and Before/After
Comparison; v0.5, Executable Frontend Contracts and Explicit Change Scope;
and v0.6, Bounded Agent Context and Native my-dev-kit Ecosystem Integration,
are released, published to npm (current version `0.6.0`, observation
schema `1.2.0`, comparison schema `1.0.0`, frontend contract schema `1.0.0`,
evaluation artifact schema `1.0.0`, bounded-agent-context schema `1.0.0`)
and validated as a packed npm tarball in
a clean consumer environment across Windows, Linux, and macOS: a real
`observe` CLI command launches Chromium, enforces loopback-only safety,
captures bounded page/target evidence via legacy CSS-shorthand targets,
structured semantic `--targets-file` targets, or a bounded
`--scroll-scenario-file` runtime scroll scenario (`window-scroll-by` or
`target-scroll-by`), and persists one portable local artifact; a real
`compare` CLI command reads two already-persisted observation artifacts and
derives before/after layout-relationship and difference evidence without
launching a browser; and the public `approve-baseline`/`save-change-contract`/
`evaluate-contract` commands turn a persistent baseline contract plus a
per-change contract (requested/expected-dependent/protected/preserved scope,
plus the derived-only `unexpected` classification) into one canonical
`PASS`/`FAIL` evaluation, proven against real Chromium observations - see
`docs/CURRENT_STATE.md` for the implementation summary.

v0.6 adds a programmatic bounded runtime projection plus an explicit
runtime/static correlation boundary (`correlated`/`ambiguous`/
`unavailable`), exported from `src/index.ts` with no new CLI command.
External visual-reference artifacts, reference-region modeling,
reference-vs-candidate fidelity evaluation, viewer support for references, and
reference annotation are not implemented in the published `0.6.0` package.

In the current, unreleased development state on top of `0.6.0`, the
complete v0.7 (End-to-End Coding-Agent Frontend Change Review) scope is now
implemented: the external-reference artifact foundation and explicit
approval lifecycle, explicit reference regions and reusable geometry
relationships, selected design requirements/tolerances/reference-evidence
adequacy, reference applicability and candidate-state compatibility,
explicit reference-region-to-runtime-target binding, structured
reference-vs-candidate fidelity evaluation, its integration into the
existing v0.6 bounded-agent-context, and a controlled, programmatic
end-to-end correction workflow proven against real Chromium (success,
protected-regression, and multi-attempt correction-iteration cases). See
`docs/CURRENT_STATE.md` for the full Prompt-by-Prompt record and
`docs/reports/v0.7-implementation-completeness-documentation-reconciliation.md`
for the completeness audit. This work has not been released - the published
package version remains `0.6.0` pending a separate pre-release readiness
stage. v0.8–v0.10 (interactive viewer, structured visual annotation, and
the full graphical human–LLM workflow) remain future and unimplemented.

The revised dependency path reaches practical coding-agent use before graphical
interaction and establishes the non-UI external-reference model before the
viewer consumes it:

```text
runtime observation and stable identity
→ bounded behavior, relationships, comparison, and safe-change contracts
→ bounded agent context plus native ecosystem integration (released as
  `0.6.0` - see above)
→ text/config-driven coding-agent change review
  + external visual-reference evidence foundation
  + reference-vs-candidate structured fidelity evaluation
  + controlled end-to-end correction workflow (v0.7, implemented,
    unreleased - see docs/CURRENT_STATE.md)
→ interactive viewer with reference/candidate inspection
→ structured visual annotation on runtime screenshots and external references
→ full visual human–LLM workflow with actual-frontend-driven and
  reference-driven entry modes
```

The implemented reference model is not a second observer or a
screenshot-cloning system. An external reference is desired-design evidence, not an earlier runtime
observation, and reference design vs candidate remains distinct from before vs
after comparison and contract vs candidate evaluation. Structured geometry,
relationships, explicit design intent, applicability state, provenance, and
bounded tolerances remain primary; image similarity may only supplement them
where reliable. Reference-derived executable intent must reuse the existing
requested/expected-dependent/protected/preserved contract semantics rather than
create a second PASS/FAIL taxonomy.

Viewer and annotation enhance the proven coding-agent workflow; they are not
prerequisites for proving it. The viewer must consume the reference model and
fidelity evidence established before it rather than inventing a UI-only
comparison engine.

Repository-local authorities and navigation:

- [PROJECT_DESCRIPTION.md](PROJECT_DESCRIPTION.md) contains complete durable
  product intent and responsibility boundaries.
- [PROJECT_MILESTONES.md](PROJECT_MILESTONES.md) contains the complete ordered
  capability plan and cross-milestone rules.
- [ROADMAP.md](ROADMAP.md) owns version-level direction without prewritten
  implementation batches.
- [CURRENT_STATE.md](CURRENT_STATE.md) records current implementation and
  release state.

Historical greenfield artifacts and reports are retained as evidence that an
earlier run overreached into v0.1; they are not current-state authority.
