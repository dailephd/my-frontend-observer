# Project Overview

The repository contains the complete v0.9.0 release, published as
`@dailephd/my-frontend-observer@0.9.0` under the MIT license. It adds
structured visual annotation to the v0.8.1 project workflow (`init`,
`capture`, `check`, project-aware `view`).

`my-frontend-observer` is the rendered browser/runtime evidence producer in
the my-dev-kit ecosystem. It addresses the gap between source-level evidence
and what a browser actually renders and supports three durable jobs: human-to-LLM
design communication, safer LLM-assisted frontend changes, and runtime evidence
for coordinated ecosystem work. Human-to-LLM design communication can begin
from the currently rendered frontend or from an approved external visual
reference that describes the desired design.

The responsibility split is stable:

- `my-dev-kit` produces static repository/source evidence.
- `my-frontend-observer` produces rendered browser/runtime evidence and owns the
  structured external-reference evidence used to compare approved desired-design
  intent with an actual browser-rendered candidate.
- `my-dev-kit-orchestrator` coordinates workflows and bounded evidence use.
- `my-dev-kit-lab` owns compatibility, fixtures, experiments, and evaluation.

## Current repository state

v0.1, Runtime Observation Foundation; v0.2, Stable Semantic Targets and
Region Identity; v0.3, Runtime Scrolling, Overflow, and Visibility Behavior;
v0.4, Layout Relationships, Dependency Evidence, and Before/After
Comparison; v0.5, Executable Frontend Contracts and Explicit Change Scope;
v0.6, Bounded Agent Context and Native my-dev-kit Ecosystem Integration;
v0.7, End-to-End Coding-Agent Frontend Change Review; v0.8, Interactive
Local Observation Viewer; v0.8.1, Project Workflow CLI and Human-Readable
Evidence Aliases; and v0.9, Human Visual Annotation and Design-Intent Capture,
are released and published to npm. The current package version is `0.9.0` as
`@dailephd/my-frontend-observer` (observation schema `1.2.0`, comparison schema
`1.0.0`, frontend contract schema `1.0.0`, evaluation artifact schema `1.0.0`,
bounded-agent-context schema `1.0.0`, external-reference schema `1.0.0`,
visual annotation schema `1.0.0`). The released package was validated as a
packed npm tarball in a clean consumer environment across Windows, Linux, and
macOS.

The released low-level command surface remains artifact-oriented: a real
`observe` command launches Chromium, enforces loopback-only safety, captures
bounded page/target evidence through CSS shorthand, structured semantic targets,
or a bounded scroll scenario, and persists one portable local artifact; a real
`compare` command reads two persisted observations and derives before/after
relationship and difference evidence; `approve-baseline`,
`save-change-contract`, and `evaluate-contract` provide canonical executable
change-scope evaluation; and the v0.7 reference commands import, approve, and
evaluate approved external visual references. See `docs/CURRENT_STATE.md` for
the complete implemented state and release evidence.

v0.6 adds a programmatic bounded runtime projection plus an explicit
runtime/static correlation boundary (`correlated`/`ambiguous`/
`unavailable`), exported from `src/index.ts` with no new CLI command.

v0.7 (End-to-End Coding-Agent Frontend Change Review) adds the complete
external-reference architecture: the external-reference artifact foundation
and explicit approval lifecycle (`import-reference`/`approve-reference`),
explicit reference regions and reusable geometry relationships, selected
design requirements/tolerances/reference-evidence adequacy, reference
applicability and candidate-state compatibility, explicit
reference-region-to-runtime-target binding, structured
reference-vs-candidate fidelity evaluation (`evaluate-reference-fidelity`),
its integration into the existing v0.6 bounded-agent-context, and a
controlled, programmatic end-to-end correction workflow
(`prepareReferenceCorrection`/`reviewReferenceCorrectionAttempt`) proven
against real Chromium (success, protected-regression, and multi-attempt
correction-iteration cases). See `docs/CURRENT_STATE.md` for the full
implementation record and
`docs/reports/v0.7-implementation-completeness-documentation-reconciliation.md`
for the completeness audit that preceded release.

v0.8 (Interactive Local Observation Viewer) is released as package version
`0.8.0` - `my-frontend-observer view` starts a loopback-only Node server
serving a React + TypeScript + Vite viewer (normal browser or installed PWA)
that inspects observations, comparisons, contract results, external
references/candidates with explicit binding cross-selection and on-demand
fidelity evaluation, and, when supplied, a bounded agent context's
adequacy/omissions/truncations/correlation - all through the same canonical
engines used by the CLI, never a second implementation of them. See
`docs/CURRENT_STATE.md`,
`docs/reports/v0.8-implementation-completeness-documentation-reconciliation.md`,
and `docs/reports/v0.8-prerelease-readiness-cross-platform-security-code-rot.md`
for the implementation and release evidence.

v0.8.1 was a project-workflow CLI usability patch published as
`@dailephd/my-frontend-observer@0.8.1`. It does
not introduce a new evidence model. It adds project configuration,
human-readable aliases, managed project-local Observer state, and a small
high-level `init` / `capture` / `check` / project-aware `view` workflow above
the existing canonical engines. The purpose is to stop making humans and coding
agents repeatedly manage output paths, evidence roots, and long canonical
artifact identifiers during ordinary use. Existing low-level commands remain
supported. The frozen plan is
`docs/plans/v0.8.1-cli-usability-patch-plan.md`.

The latest published release is v0.9.0. v0.9 adds structured
visual annotation to the project-aware viewer for both runtime observations and
external references. People draw marks, explicitly associate them, and confirm
structured intent. Selected confirmed runtime intent can become a normal
per-change contract, and selected confirmed reference intent can become a new
imported external-reference revision. The existing contract and reference
evaluators stay authoritative. It followed the frozen plan in
`docs/plans/v0.9-implementation-plan.md`, grounded by
`docs/reports/v0.9-architecture-retrieval.md`.
The repository-owned deterministic demo and its four tutorial scenarios
(`examples/v09-demo/`, recorded by the external
`@dailephd/my-dev-kit-lab@0.4.9` tool) passed final cross-platform readiness
with the release. They are release support and documentation, not product
behavior, and they are not shipped in the npm package.
v0.10 remains future and unimplemented and completes the visual human-LLM
workflow on top of the v0.9 annotation model and v0.8.1 high-level acceptance
surface.

The revised dependency path reaches practical coding-agent use before graphical
interaction and keeps later visual work on the same canonical evidence system:

```text
runtime observation and stable identity
→ bounded behavior, relationships, comparison, and safe-change contracts
→ bounded agent context plus native ecosystem integration (released as 0.6.0)
→ text/config-driven coding-agent change review
  + external visual-reference evidence foundation
  + reference-vs-candidate structured fidelity evaluation
  + controlled end-to-end correction workflow (released as 0.7.0)
→ interactive viewer with reference/candidate inspection (released as 0.8.0)
→ project workflow CLI + human-readable evidence aliases (released as 0.8.1)
→ structured visual annotation on runtime screenshots and external references
  (released as 0.9.0)
→ full visual human-LLM workflow with actual-frontend-driven and
  reference-driven entry modes (planned v0.10)
```

The implemented reference model is not a second observer or a
screenshot-cloning system. An external reference is desired-design evidence,
not an earlier runtime observation, and reference design vs candidate remains
distinct from before vs after comparison and contract vs candidate evaluation.
Structured geometry, relationships, explicit design intent, applicability
state, provenance, and bounded tolerances remain primary; image similarity may
only supplement them where reliable. Reference-derived executable intent must
reuse the existing requested/expected-dependent/protected/preserved contract
semantics rather than create a second PASS/FAIL taxonomy.

Viewer and annotation enhance the proven coding-agent workflow; they are not
prerequisites for proving it. The viewer must consume the reference model and
fidelity evidence established before it rather than inventing a UI-only
comparison engine. The implemented v0.8.1 workflow layer likewise resolves project
configuration and human aliases to existing canonical artifacts and services;
it does not replace artifact identity or evaluation semantics.

Repository-local authorities and navigation:

- [PROJECT_DESCRIPTION.md](PROJECT_DESCRIPTION.md) contains complete durable
  product intent and responsibility boundaries.
- [PROJECT_MILESTONES.md](PROJECT_MILESTONES.md) contains the complete ordered
  capability plan and cross-milestone rules.
- [ROADMAP.md](ROADMAP.md) owns version-level direction without prewritten
  implementation batches.
- [CURRENT_STATE.md](CURRENT_STATE.md) records current implementation and
  release state.
- [plans/v0.8.1-cli-usability-patch-plan.md](plans/v0.8.1-cli-usability-patch-plan.md)
  freezes the concrete implementation plan for the v0.8.1 patch.
- [plans/v0.9-implementation-plan.md](plans/v0.9-implementation-plan.md)
  freezes the concrete implementation architecture, seven ordered batches,
  gates, and validation expectations for v0.9. It is planning authority only;
  the v0.9 implementation state is recorded in CURRENT_STATE.md and the
  `reports/v0.9-*.md` reports.
- [reports/v0.9-architecture-retrieval.md](reports/v0.9-architecture-retrieval.md)
  preserves the bounded current-source retrieval that grounded the v0.9 plan.

Historical greenfield artifacts and reports are retained as evidence that an
earlier run overreached into v0.1; they are not current-state authority.
