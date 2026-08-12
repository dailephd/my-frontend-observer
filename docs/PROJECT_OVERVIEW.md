# Project Overview

`my-frontend-observer` is the rendered browser/runtime evidence producer in
the my-dev-kit ecosystem. It addresses the gap between source-level evidence
and what a browser actually renders and supports three durable jobs: human-to-LLM
design communication, safer LLM-assisted frontend changes, and runtime evidence
for coordinated ecosystem work.

The responsibility split is stable:

- `my-dev-kit` produces static repository/source evidence.
- `my-frontend-observer` produces rendered browser/runtime evidence.
- `my-dev-kit-orchestrator` coordinates workflows and bounded evidence use.
- `my-dev-kit-lab` owns compatibility, fixtures, experiments, and evaluation.

## Current repository state

v0.1, Runtime Observation Foundation; v0.2, Stable Semantic Targets and
Region Identity; and v0.3, Runtime Scrolling, Overflow, and Visibility
Behavior, are released, published to npm (current version `0.3.0`,
observation schema `1.2.0`) and validated as a packed npm tarball in a
clean consumer environment across Windows, Linux, and macOS: a real
`observe` CLI command launches Chromium, enforces loopback-only safety,
captures bounded page/target evidence via legacy CSS-shorthand targets,
structured semantic `--targets-file` targets, or a bounded
`--scroll-scenario-file` runtime scroll scenario (`window-scroll-by` or
`target-scroll-by`), and persists one portable local artifact - see
`docs/CURRENT_STATE.md` for the implementation summary. v0.4, Layout
Relationships, Dependency Evidence, and Before/After Comparison, is
implementation feature-complete on `feature/v0.4-layout-comparison` but not
yet released - the published npm package remains `0.3.0` and does not
include `compare`. v0.5–v0.10 remain future and unimplemented.

The revised dependency path reaches practical coding-agent use before graphical
interaction:

```text
runtime observation and stable identity
→ bounded behavior, relationships, comparison, and safe-change contracts
→ bounded agent context plus native ecosystem integration
→ text/config-driven coding-agent change review
→ interactive viewer
→ structured visual annotation
→ full visual human–LLM workflow
```

Viewer and annotation enhance the proven coding-agent workflow; they are not
prerequisites for proving it.

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
