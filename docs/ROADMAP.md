# Roadmap

This is a version-level specification, not an implementation checklist.
Concrete steps and sequencing are designed only when a version begins, after
the planner reads that version, inspects current repository state, and performs
needed my-dev-kit retrieval and architecture work.

## v0.1 — Runtime Observation Foundation

Current status: released as `0.1.0`, published to npm and validated as a
packed npm tarball in a clean consumer environment on Windows, Linux, and
macOS. See `docs/CURRENT_STATE.md` for the implementation summary.

Objective and user problem: establish trustworthy evidence of what a local
frontend actually rendered, rather than relying on source inference.

Required capabilities: Node.js 24+ TypeScript CLI; explicit loopback URL,
viewport, CSS targets, and output; real Playwright Chromium capture; viewport
PNG; bounded page/target evidence; versioned portable artifact; provenance,
diagnostics, completion state, and explicit available/unavailable/not-applicable/
partial semantics.

Constraints and contracts: one reusable application service behind a thin CLI,
one Chromium adapter, external non-destructive targets, loopback-only request/
redirect/subresource policy, no full DOM/style dump, observer-owned schema
`1.0.0` independent of package version. Direct browser, computed-browser, and
derived evidence remain distinguishable.

Dependencies/ecosystem/compatibility: greenfield foundation only; no runtime
dependency or modification of my-dev-kit, orchestrator, or lab. Windows and
portable structured evidence matter; screenshot bytes need not match across OS.

Exclusions: semantic identity expansion, scrolling actions, relationships,
comparison, contracts, LLM packets, viewer, annotation, integrations, remote
browsing, credentials, cloud browsers, additional engines, databases, Docker,
plugins, and static analysis.

Acceptance: deterministic loopback fixture drives real Chromium; screenshot is
a valid nonempty PNG; page and explicit targets expose required measurements;
missing targets are honest; all validation commands pass. Planning must confirm
capture-readiness semantics, exact diagnostics, public compatibility boundaries,
and the concrete dependency/version set before implementation.

## v0.2 — Stable Semantic Targets and Region Identity

Current status: released as `0.2.0`, published to npm and validated as a
packed npm tarball in a clean consumer environment on Windows, Linux, and
macOS. See `docs/CURRENT_STATE.md` for the implementation summary.

Objective/problem: let humans and consumers refer reliably to conceptual
rendered regions across observations without brittle selector-only identity.
Required capabilities include semantic HTML, accessibility role/name, stable
id/data attributes, bounded fallbacks, resolution confidence/status, ambiguity,
and missing evidence. Runtime identity remains observer-owned and distinct from
source symbols. Depends on v0.1 artifacts and adapter boundaries; schema changes
must be additive where compatible. No scrolling, comparison, contracts, source
ownership, or viewer. Acceptance requires repeatable semantic resolution across
fixtures and explicit ambiguity. Planning must decide selector precedence and
identity persistence rules from current evidence.

## v0.3 — Runtime Scrolling, Overflow, and Visibility Behavior

Current status: implemented on the current feature branch (observation
schema `1.2.0`); not yet released or published to npm. See
`docs/CURRENT_STATE.md` for the implementation summary.

Objective/problem: show which container actually scrolls and what becomes
visible, clipped, or overflowing after controlled actions. Required capabilities
are bounded action scenarios, before/after window and target scroll positions,
viewport intersection/visibility, document/element overflow, and supported
derived scroll-owner interpretation. Depends on stable targets. Browser actions
are authoritative; derived claims cite facts. No general interaction recorder,
comparison engine, or contract semantics. Acceptance requires real-browser
fixtures for document and nested scroll owners. Planning must settle action
syntax, stabilization, and visibility thresholds.

## v0.4 — Layout Relationships, Dependency Evidence, and Before/After Comparison

Objective/problem: explain whole-layout consequences rather than isolated
numbers. Required capabilities are containment/order/overlap/fit relationships,
comparable observation identity, before/after differences, appearance and
disappearance, geometry/visibility/overflow/relationship changes, screenshot
references, and explicit expected dependency evidence. Depends on v0.1–v0.3.
One canonical relationship and comparison layer serves all consumers;
co-change does not prove causation; causation requires explicit intent, a
contract, or another supported dependency source. No executable contracts or UI. Acceptance
requires bounded deterministic comparison with underlying evidence references.
Planning must settle comparability and tolerance semantics.

## v0.5 — Executable Frontend Contracts and Explicit Change Scope

Objective/problem: prevent a requested local fix from silently breaking an
approved region or invariant. Required capabilities are baseline invariants,
requested/expected-dependent/protected/preserved classifications, explicit
unexpected-change results, responsive tolerances, one canonical evaluation
engine, actionable verdicts, and baseline supersession history. Both persistent
baseline contracts and per-change contracts are required. Depends on v0.4
comparison and explicit intent evidence.
Existing approved contracts remain active unless the user supersedes them.
No LLM packaging, viewer, or annotation UI. Acceptance requires fixtures where
the requested change passes but a protected property fails. Planning must settle
contract storage, approval, tolerance, and conflict resolution.

## v0.6 — Bounded Agent Context and Native my-dev-kit Ecosystem Integration

Objective/problem: make the observer useful to an actual coding-agent workflow
by answering the smallest trustworthy runtime-plus-static context question. A
coding agent needs task-relevant rendered facts, change-scope and contract
evidence, and relevant bounded source evidence without consuming the full
repository or an unbounded browser dump.

Required capabilities: bounded runtime projections containing page/viewport
identity, stable targets, important geometry and runtime behavior,
relationships, before/after differences, contract results,
requested/dependent/protected/preserved scope, diagnostics, artifact/screenshot
references, provenance, and truncation/omission metadata; adequacy reporting;
explicit runtime/static correlation to current `my-dev-kit` identities and
bounded retrieval where reliable; observer correlation/export boundary;
orchestrator bounded runtime-evidence consumption; and exact lab
readers/fixtures/evaluation needed to prove compatibility.

Architectural/evidence constraints: runtime identity never silently becomes
source ownership; ambiguity and competing candidates remain explicit. The
observer owns runtime evidence, bounded runtime projection, and
correlation/export. `my-dev-kit` owns static indexing, architecture,
dependencies, probable ownership evidence, and retrieval. The orchestrator
coordinates bounded runtime plus static evidence but does not run the browser,
redefine observer semantics, embed huge raw artifacts, or duplicate retrieval.
The lab evaluates exact supported contracts and is not required for every
normal frontend edit. Do not introduce a shared schema package without a
demonstrated ownership/release need.

Dependency direction:

```text
freeze bounded-agent-context and integration contract
→ determine whether my-dev-kit requires a static-side change
→ implement observer bounded projection/correlation/export
→ implement orchestrator bounded runtime-evidence consumption
→ add lab exact readers/fixtures/evaluation needed for compatibility
→ run individual repository readiness
→ run coordinated exact-version validation
```

This is cross-repository dependency direction, not an implementation batch
plan. Modify `my-dev-kit` only if current identities/retrieval lack a generic
static-side capability actually required by the frozen contract.

Dependencies/ecosystem/compatibility: depends on v0.1–v0.5 stable observation,
identity, behavior, comparison, relationship, contract, and change-scope
semantics. Potentially affected repositories are observer, orchestrator, lab,
and only when proven necessary, `my-dev-kit`. Pin package/candidate identities,
schema/artifact/context versions, consumer expectations, and fixture hashes;
validate downstream consumers against intended candidates rather than stale
published packages.

Exclusions: viewer, visual annotation, source editing, a new static analyzer,
browser execution in the orchestrator, broad lab product work, external LLM
APIs, full DOM/style/accessibility dumps, unrelated observations, and embedded
heavy assets where references suffice.

Acceptance: a coding agent or LLM receives bounded traceable runtime problem
evidence plus change scope/contracts plus relevant static/source evidence;
adequacy/omission/truncation and correlation ambiguity remain visible; producer
responsibilities stay distinct; exact lab consumers pass; each affected
repository passes readiness; and coordinated exact-version validation passes.
Version-start planning must decide projection profiles, redaction/text limits,
correlation ownership/evidence, the orchestrator evidence-kind representation,
whether `my-dev-kit` changes are necessary, and whether any shared contract
package is justified.

## v0.7 — End-to-End Coding-Agent Frontend Change Review

Objective/problem: prove the core practical outcome before graphical work—a
text/config-driven coding-agent correction loop that cannot call a local
requested mutation successful while protected behavior regresses.

Required capabilities:

```text
capture approved baseline
→ preserve baseline contracts
→ human expresses requested change in text/config
→ construct requested/dependent/protected/preserved scope
→ generate bounded runtime evidence
→ obtain relevant bounded static evidence
→ assemble coding-agent context
→ external coding agent modifies target source
→ observer captures new state
→ compare before/after
→ evaluate requested changes
→ evaluate expected dependent changes
→ verify protected properties
→ rerun baseline contracts
→ PASS or actionable regression failure
```

Unexpected changes remain explicit. Existing approved baseline contracts and
the new per-change contract both remain active unless explicitly superseded.

Architectural/evidence constraints: the observer does not edit target source; an
external coding agent or implementation tool does. All runtime, static,
workflow, implementation, and verification identities remain traceable to their
owners. One canonical observer, relationship, comparison, contract, and
change-scope implementation serves CLI/programmatic and later UI consumers. The
workflow must not require an interactive viewer, visual drawing, or annotation
authoring.

Dependencies/ecosystem/compatibility: depends on v0.6 bounded integrated agent
context and v0.1–v0.5 evidence/contract foundations. Use compatible exact
observer, `my-dev-kit`, orchestrator, and lab contract versions established by
v0.6; the lab remains optional for ordinary edits once compatibility is proven.

Exclusions: graphical inspection as a prerequisite, visual annotation, observer
source editing, autonomous approval, hidden contract supersession, and treating
all differences as failures.

Acceptance: controlled successful and failing changes complete end-to-end. The
required failure case has a requested change succeed while a protected property
or preserved invariant fails, producing overall failure and actionable
evidence. The agent receives bounded runtime/static context, edits externally,
the observer rerenders, all active contracts rerun, and the result is traceable.
Version-start planning must decide the text/config request format, coding-agent
handoff boundary, controlled target/change mechanism, approval/baseline history,
failure reporting, and exact workflow entry points.

## v0.8 — Interactive Local Observation Viewer

Objective/problem: let developers inspect and understand the same canonical
evidence already used by the operational coding-agent workflow without opening
raw artifact files manually.

Required capabilities: local artifact/context readers; screenshot and stable
target inspection; geometry, semantics, scrolling/overflow, visibility,
relationships, and before/after views; diagnostics and honest evidence states;
requested/dependent/protected/preserved/unexpected classifications; baseline and
per-change contract results; source-correlation evidence with uncertainty; and
navigation between relevant raw evidence and bounded agent-context references.

Architectural/evidence constraints: the viewer consumes existing observation,
relationship, comparison, contract, change-scope, correlation, and bounded
context engines/contracts. It must not create a second observer, relationship
engine, comparison engine, contract engine, correlation implementation, or
context builder. CLI/programmatic paths remain first-class, and viewer state
does not mutate targets.

Dependencies/ecosystem/compatibility: depends on the proven v0.7 workflow and
stable v0.1–v0.6 artifacts/contracts. It may display ecosystem correlation but
does not redefine it. Viewer readers must declare supported artifact/context
versions and show unsupported, missing, partial, derived, and ambiguous evidence
honestly.

Exclusions: annotation authoring, source editing, a second workflow engine,
cloud hosting, and making the viewer mandatory for observation or coding-agent
review.

Acceptance: a developer can inspect screenshots, targets, runtime behavior,
relationships, changes, contracts, diagnostics, change scope, and correlation
evidence through the UI, and the displayed evidence is demonstrably the same
canonical evidence used by CLI/programmatic and coding-agent workflows.
Version-start planning must choose UI technology, local process boundary,
reader/version strategy, coordinate/overlay behavior, and large-artifact loading
policy from the then-current repository.

## v0.9 — Human Visual Annotation and Design-Intent Capture

Objective/problem: add structured visual human intent to the already working
v0.7 coding-agent workflow through the v0.8 viewer without inventing a separate
change-semantics system.

Required capabilities: a bounded annotation set chosen during planning, such as
point/select, rectangle/area, arrow, line/boundary, textual note, preserve,
resize, move, remove, and inspect; structured annotation artifacts preserving
observation/screenshot identity, geometry, type, text, provenance, and reliable
target/relationship association; save/reload; annotated screenshot references;
and explicit interpretation/confirmation state.

Canonical intent flow:

```text
visual annotation
→ target/relationship binding
→ candidate requested/dependent/protected/preserved intent
→ explicit confirmation/interpretation where necessary
→ canonical change contract
```

Architectural/evidence constraints: annotation feeds the existing canonical
change-scope, contract, bounded-context, and coding-agent workflow. It must not
create annotation-only requested/protected semantics or different PASS/FAIL
rules. Ambiguous drawings never silently become strong requirements. Original
raw observations remain immutable.

Dependencies/ecosystem/compatibility: depends on stable identity, contracts,
v0.7 coding-agent review, and v0.8 viewer/coordinate mapping. Structured
annotation/context versions must be explicit and remain traceable to supported
observation and screenshot identities.

Exclusions: flattening intent into pixels only, bypassing confirmation,
replacing text/config requests, source editing, or making annotation mandatory
for ordinary coding-agent changes.

Acceptance: annotations remain structured and traceable, survive save/reload,
bind to stable targets/relationships where reliable, require confirmation when
ambiguous, and can drive the existing coding-agent review through the canonical
contract model. Version-start planning must select the first annotation set,
coordinate transforms, persistence/versioning, interpretation/confirmation
workflow, conflicts, and annotated-image derivation.

## v0.10 — Full Visual Human–LLM Frontend Change Workflow

Objective/problem: complete the visual communication branch by combining the
already operational coding-agent loop with graphical inspection and structured
annotation.

Required workflow:

```text
human views actual captured frontend
→ points/draws/annotates requested design change
→ observer binds intent to stable runtime regions
→ change scope is constructed/confirmed
→ bounded runtime evidence is produced
→ bounded static evidence is obtained
→ coding-agent context is assembled
→ external coding agent modifies source
→ observer rerenders
→ requested/dependent/protected/preserved behavior is evaluated
→ viewer shows PASS/failure evidence
→ human approves or requests correction
→ successful state may become the new approved baseline
```

Architectural/evidence constraints: a visual request does not erase existing
baseline contracts. Unless explicitly superseded, existing approved contracts
plus the new visual/per-change contract must both pass. Unexpected changes
remain visible. Runtime, static, annotation, workflow, implementation, and
approval evidence remain separate and traceable. The observer stays
non-mutating; the orchestrator coordinates bounded evidence; the lab is not
required for every normal edit.

Dependencies/ecosystem/compatibility: depends on all prior versions, especially
the v0.7 core loop, v0.8 viewer, and v0.9 annotation intent model. Use exact
compatible observer/static/orchestrator/context/annotation/viewer contracts and
retain the four-project responsibility split.

Exclusions: replacing the external coding agent with observer source editing,
visual intent silently overriding baseline contracts, opaque AI-only verdicts,
untraceable baseline replacement, and making lab evaluation part of every edit.

Acceptance: demonstrate a successful visual change; a requested visual change
that introduces a protected/invariant regression; actionable viewer failure
evidence; a correction cycle; human approval/new-baseline history; and compatible
integrated ecosystem evidence. A protected/invariant failure must fail overall
even when the requested local visual change succeeds. Version-start planning
must settle visual workflow entry points, approval identity and authority,
baseline governance, correction iteration history, artifact retention, and
cross-version compatibility.


