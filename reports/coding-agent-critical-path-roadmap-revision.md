# Executive Verdict

`PLANNING_REVISION_COMPLETE`

The forward-looking plan now prioritizes proving a safe, text/config-driven
coding-agent frontend correction workflow by v0.7. Graphical inspection and
visual annotation follow as enhancements to that proven workflow in v0.8–v0.10.
No product code or current-state implementation claim changed.

# Reason for Revision

The previous plan was technically coherent but put the interactive viewer and
visual annotation before native runtime/static integration and a real
coding-agent change-review proof. Viewer and annotation are valuable human
interfaces, but they are not technical prerequisites for combining bounded
runtime evidence, safe-change contracts, relevant source evidence, and an
external coding agent.

The revised critical path first proves that the observer can help a coding agent
modify a frontend and reject protected/invariant regressions. UI investment then
improves inspection and visual intent authoring without becoming a dependency
of the core workflow.

# Old Sequence

Previous Milestone/version 6–10 order:

```text
6. Bounded LLM Runtime Context
7. Interactive Local Observation Viewer
8. Human Visual Annotation and Design-Intent Capture
9. Native my-dev-kit Ecosystem Integration
10. End-to-End Human–LLM Frontend Change Review Workflow
```

# New Sequence

Authoritative Milestone/version 6–10 order:

```text
6. Bounded Agent Context and Native my-dev-kit Ecosystem Integration
7. End-to-End Coding-Agent Frontend Change Review
8. Interactive Local Observation Viewer
9. Human Visual Annotation and Design-Intent Capture
10. Full Visual Human–LLM Frontend Change Workflow
```

# Dependency Rationale

The core product problem is safe frontend modification, so the shortest useful
dependency chain is:

```text
contracts
→ bounded agent + ecosystem context
→ coding-agent review
```

v0.5 establishes the canonical requested, expected-dependent, protected,
preserved, and unexpected change model through persistent baseline plus
per-change contracts. v0.6 then combines task-relevant bounded runtime evidence
with relevant bounded static/source evidence through explicit observer,
`my-dev-kit`, orchestrator, and lab contracts. v0.7 proves that an external
coding agent can consume that context, change the target separately, trigger a
rerender/comparison, and receive actionable PASS or regression evidence.

The viewer and annotation branch can safely follow:

```text
viewer
→ annotation
→ full visual workflow
```

Neither graphical inspection nor drawing is required to express a change in
text/configuration, correlate runtime/static evidence, run contracts, or reject
a regression. v0.8 displays the already canonical evidence; v0.9 maps visual
intent into the already canonical change-scope model; v0.10 combines both with
the already operational coding-agent loop.

# Documents Updated

- `docs/PROJECT_DESCRIPTION.md`: renamed and expanded bounded context into the
  core bounded-agent/static-runtime path; placed coding-agent review before
  viewer/annotation; reordered architecture, testing, and long-term strategy;
  preserved all three durable product jobs.
- `docs/PROJECT_MILESTONES.md`: rewrote the core evidence flow and four-phase
  development model; preserved Milestones 1–5 and added required clarifications
  for bounded Milestone 3 behavior and explicit unexpected-change semantics;
  completely replaced Milestones 6–10; updated architecture/evidence/testing
  progression, milestone ordering, and bootstrap-versus-v0.1 boundary.
- `docs/ROADMAP.md`: retained v0.1–v0.5; replaced v0.6–v0.10 with self-contained
  version specifications following the revised critical path.
- `docs/PROJECT_OVERVIEW.md`: added the concise agent-first dependency sequence.
- `docs/WORKFLOWS.md`: replaced the stale future workflow ordering and made the
  no-viewer dependency of v0.7 explicit.
- `docs/ARCHITECTURE.md`: moved explicit ecosystem boundaries to v0.6 and stated
  that viewer/annotation consume the canonical core engines.
- `docs/CONTRACTS.md`: aligned future contract ownership with v0.4–v0.10.
- `reports/greenfield-bootstrap-reconnaissance.md`: added a historical notice so
  its old milestone references are not mistaken for current authority.
- `reports/coding-agent-critical-path-roadmap-revision.md`: created this report.

README and `docs/CURRENT_STATE.md` were audited but did not need changes: both
already state that the project is post-greenfield, pre-v0.1, and that v0.1 is
the next implementation target. Historical run/state reports retain their
existing notices and were not rewritten.

# Project Description Fidelity

The complete Product Description still preserves:

1. Human-to-LLM design and layout communication.
2. Safe LLM-assisted frontend changes.
3. Runtime evidence for the my-dev-kit ecosystem.

It remains durable product intent rather than a version checklist. Its revised
narrative now exposes two dependent later paths after safe-change contracts:

- core coding-agent path: bounded context plus ecosystem integration, then
  coding-agent review;
- human visual path: viewer, then annotation;

both converge in the final visual workflow. Stable runtime identity remains
distinct from source ownership, geometry remains observation rather than a
fixed design constant, evidence remains observed-versus-derived, targets remain
external/non-destructive, and local-first boundaries remain intact.

# Milestone Fidelity

Milestones 1–5 retain their original detailed objectives, capabilities,
architecture, evidence rules, exclusions, and acceptance criteria. A normalized
comparison confirmed the original Milestones 1–5 text is retained after removing
the two explicitly requested additive clarifications:

- Milestone 3 now states directly that bounded runtime behavior evidence is not
  a generic browser interaction or automation framework.
- Milestone 5 now names `unexpected change` as the fifth canonical change-scope
  category alongside requested, expected-dependent, protected, and preserved.

Milestones 6–10 now implement the revised dependency model:

- Milestone 6 combines bounded agent context, runtime/static correlation,
  observer export, orchestrator bounded consumption, and exact lab compatibility
  while preserving producer boundaries.
- Milestone 7 proves successful and failing text/config-driven external
  coding-agent corrections without viewer/annotation dependencies.
- Milestone 8 adds the viewer over existing canonical evidence and engines.
- Milestone 9 adds structured annotation that feeds canonical change scope and
  contracts with explicit ambiguity handling.
- Milestone 10 completes the visual human–LLM workflow, correction cycle,
  protected/invariant failure case, approval, and new-baseline handling.

# ROADMAP Fidelity

ROADMAP contains v0.1 through v0.10 in the new authoritative order. v0.1–v0.5
remain the observation, identity, runtime behavior, relationship/comparison, and
safe-change foundations. v0.6–v0.10 each include objective/problem, required
capabilities, architectural/evidence constraints, dependencies, ecosystem and
compatibility implications, exclusions, acceptance, and decisions deferred to
version-start planning.

The v0.6 cross-repository direction is explicitly labeled dependency direction,
not an implementation batch plan. No `Batch N` heading or prewritten
implementation sequencing exists in Project Milestones or ROADMAP.

# Ecosystem Boundary

The four-project responsibility model is unchanged:

```text
my-dev-kit
→ static repository/source evidence

my-frontend-observer
→ browser/runtime evidence, bounded runtime projection, correlation/export

my-dev-kit-orchestrator
→ workflow coordination and bounded evidence consumption

my-dev-kit-lab
→ compatibility, fixtures, experiments, and evaluation
```

The observer remains independently executable and does not duplicate static
indexing/retrieval. Runtime target identity does not imply source ownership.
The orchestrator does not become the browser engine or duplicate retrieval. The
lab adds only exact readers/fixtures/evaluation required for compatibility and
is not required for every ordinary frontend edit. One canonical observer,
relationship, comparison, contract, change-scope, correlation, and bounded
context implementation serves CLI, agent, viewer, and annotation consumers.

# Current State

No product implementation occurred during this task. Only Markdown planning and
historical-notice files changed. The repository remains post-greenfield and
pre-v0.1:

- v0.1 is not implemented or verified;
- v0.1 remains the next implementation target;
- v0.2–v0.10 remain future;
- no sibling ecosystem repository was modified.

# Validation

- Heading/order audit across `PROJECT_MILESTONES.md` and `ROADMAP.md`: passed;
  all ten titles are present in the new order.
- Stale-title search across README and current `docs/**/*.md`: passed; no old
  Milestone/v0.6–v0.10 title assignment remains.
- Phase audit: passed; A=1–3, B=4–5, C=6–7, D=8–10.
- Milestones 1–5 normalized preservation comparison: passed after excluding the
  two requested additive clarifications.
- Product Description three-primary-job checks: passed.
- Requested/dependent/protected/preserved/unexpected and persistent/per-change
  contract checks: passed.
- Ecosystem responsibility/boundary term audit: passed.
- No-batch-heading search in Project Milestones and ROADMAP: passed.
- First custom order assertion: failed because the validator searched for one
  no-viewer sentence while the document expresses it as a heading plus bullet
  list across lines; no document defect was found.
- Corrected semantic no-viewer assertion and full custom order/critical-path
  validation: passed.
- `npm run check:docs`: passed; 17 required files.
- v0.1 current-status assertion: passed; ROADMAP still says not implemented.
- No Markdown-lint command exists in the current package, so no separate
  Markdown lint was run and no tooling was added.

# Next Action

Proceed with the already-designed v0.1 implementation plan. The later roadmap now prioritizes reaching a usable coding-agent frontend correction workflow by v0.7 before implementing viewer and annotation work.

FINAL_STATUS: PLANNING_REVISION_COMPLETE
