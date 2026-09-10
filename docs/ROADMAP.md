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

Current status: released as `0.3.0`, published to npm and validated as a
packed npm tarball in a clean consumer environment on Windows, Linux, and
macOS (observation schema `1.2.0`). See `docs/CURRENT_STATE.md` for the
implementation summary.

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

Current status: released as `0.4.0`, published to npm and validated as a
packed npm tarball in a clean consumer environment on Windows, Linux, and
macOS. See `docs/CURRENT_STATE.md` for the implementation summary.

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

Current status: released as `0.5.0`, published to npm and validated as a
packed npm tarball in a clean consumer environment on Windows, Linux, and
macOS (observation schema `1.2.0`, comparison schema `1.0.0`, frontend
contract schema `1.0.0`, evaluation artifact schema `1.0.0`). See
`docs/CURRENT_STATE.md` for the implementation summary.

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

Current status: released as `0.6.0`, from the `canonicalization/v0.6`
lineage. See `docs/CURRENT_STATE.md` for the implementation summary.

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

Current status: released as `0.7.0`. See `docs/CURRENT_STATE.md`,
`docs/reports/v0.7-implementation-completeness-documentation-reconciliation.md`
for the completeness audit, and
`docs/reports/v0.7-pre-release-readiness.md` for the cross-platform
readiness validation that preceded release. The required capabilities,
constraints, and acceptance criteria below are preserved as originally
planned and describe what the implementation actually satisfies.

Objective/problem: prove the core practical outcome before graphical work: a
text/config-driven coding-agent correction loop that cannot call a local
requested mutation successful while protected behavior regresses, and establish
the non-graphical evidence foundation required when the desired frontend is
supplied as an external visual reference rather than an earlier runtime state.

Required capabilities:

```text
capture approved baseline
→ preserve baseline contracts
→ human expresses requested change in text/config
  and may supply an external visual reference
→ construct requested/dependent/protected/preserved scope
→ when a reference is supplied, establish explicit reference identity,
  applicable viewport/theme/application-state identity, reference regions,
  authored design intent, tolerances, and reference-to-runtime target binding
→ generate bounded runtime evidence
→ evaluate reference design vs candidate where applicable
→ obtain relevant bounded static evidence
→ assemble coding-agent context
→ external coding agent modifies target source
→ observer captures new state
→ compare before/after
→ reevaluate reference design vs candidate where applicable
→ evaluate requested changes
→ evaluate expected dependent changes
→ verify protected properties
→ rerun baseline contracts
→ PASS or actionable regression/fidelity failure
```

The external reference is evidence, not source code and not an earlier
`ObservationArtifact`. Reference design vs candidate is therefore a distinct
comparison category from before vs after and contract vs candidate. The first
reference model must preserve deterministic reference identity and provenance,
image dimensions/format, explicit bounded reference regions, coordinate
semantics, reusable layout relationships where appropriate, authored design
requirements, tolerances, applicability state, approval/supersession history,
and explicit reference-region to runtime-target bindings whose status may be
explicit, ambiguous, unavailable, or otherwise conservatively represented.
Exact artifact/type names are selected during version-start architecture work;
this roadmap does not freeze a schema name.

Reference applicability must be evaluated before fidelity differences are
interpreted. A dark-theme active-state reference compared with a light-theme
idle candidate must become an explicit incompatible/incomparable result rather
than a meaningless list of visual failures. Planning must extend or reuse the
canonical comparability/state-identity model instead of creating a
reference-only state system.

Reference-derived executable intent must feed the existing v0.5 canonical
requested/expected-dependent/protected/preserved contract semantics. Visible
reference details may remain informational or unassessed until a human or
explicit configuration promotes them into requirements. Do not create a second
reference-only PASS/FAIL taxonomy.

Structured evidence is primary: geometry, spacing, selected style evidence,
relationships, applicability, and contract intent must remain inspectable and
traceable. Bounded screenshot-region or asset-similarity evidence may supplement
structured evidence where reliable, but pixel/image similarity alone must not
determine success. Text rendering, antialiasing, glow, shadows, gradients, and
platform/font differences require property-specific or evidence-specific
tolerance semantics rather than one global pixel-perfect threshold.

The coding-agent handoff must be actionable and bounded. Instead of only saying
"match the reference," it should be able to report the relevant target,
reference measurement, candidate measurement, delta, failed relationship or
style requirement, active protected/preserved constraints, provenance, and
bounded static/source context. Heavy image bytes and unrelated regions must not
be embedded into every agent packet when references suffice.

Unexpected changes remain explicit. Existing approved baseline contracts and
the new per-change contract both remain active unless explicitly superseded. A
reference-fidelity pass never authorizes a protected regression or silently
replaces an approved baseline/reference.

Architectural/evidence constraints: the observer does not edit target source; an
external coding agent or implementation tool does. All runtime, reference,
static, workflow, implementation, and verification identities remain separate
and traceable to their owners. One canonical observer, relationship,
comparison/evaluation, contract, change-scope, reference, and bounded-context
model must serve later UI consumers. Reference regions are not runtime targets,
and neither identity silently becomes source ownership.

Dependencies/ecosystem/compatibility: depends on v0.6 bounded integrated agent
context and v0.1–v0.5 evidence/contract foundations. Use compatible exact
observer, `my-dev-kit`, orchestrator, and lab contract versions established by
v0.6; the lab remains optional for ordinary edits once compatibility is proven.
The new reference evidence must be project-local and portable, with heavy image
content referenced rather than duplicated throughout downstream artifacts.

Exclusions: graphical inspection as a prerequisite, graphical annotation
authoring, observer source editing, autonomous approval, hidden baseline or
reference supersession, automatic image-to-code generation, raster-to-HTML or
raster-to-SVG reconstruction, a general computer-vision framework, a Figma or
Canva replacement, and pixel-diff-only acceptance.

Acceptance: controlled successful and failing changes complete end-to-end. The
required baseline failure case has a requested change succeed while a protected
property or preserved invariant fails, producing overall failure and actionable
evidence. A reference-driven proof case additionally supplies an approved
external reference, binds selected reference regions to runtime targets,
produces measurable structured reference/candidate mismatches, sends only
relevant correction evidence plus bounded static context to the external coding
agent, rerenders, and reevaluates. A reference-fidelity success must still fail
overall when an active baseline/per-change contract fails. Version-start
planning must decide the text/config request format, reference artifact and
lifecycle contract, supported image formats and size bounds, coordinate model,
region/relationship representation, applicability/theme/application-state
identity, tolerance and selected style-evidence model, optional image-similarity
boundaries, coding-agent handoff boundary, controlled target/change mechanism,
approval/baseline/reference history, failure reporting, and exact workflow entry
points.

## v0.8 — Interactive Local Observation Viewer

Current status: released as `v0.8.0` (all eight implementation batches
passed, followed by the hardened documentation/implementation-completeness
audit and formal cross-platform/security pre-release readiness - see
`docs/CURRENT_STATE.md`). The required capabilities, constraints, and
acceptance criteria below are preserved as originally planned and describe
what the implementation actually satisfies.

Objective/problem: let developers inspect and understand the same canonical
evidence already used by the operational coding-agent workflow without opening
raw artifact files manually, including external design references and their
candidate-fidelity evidence when present.

Required capabilities: local artifact/context/reference readers; screenshot and
stable target inspection; external-reference image and reference-region
inspection; geometry, semantics, scrolling/overflow, visibility, relationships,
and before/after views; reference/candidate views; diagnostics and honest
evidence states; requested/dependent/protected/preserved/unexpected
classifications; baseline and per-change contract results; reference
applicability and fidelity results; reference-region/runtime-target binding and
ambiguity; source-correlation evidence with uncertainty; and navigation between
relevant raw evidence and bounded agent-context references.

The viewer should support a clear reference/candidate inspection mode with, as
appropriate, side-by-side images, overlays, synchronized region selection and
zoom, reference and candidate measurements, difference highlighting,
provenance, binding status, and contract/reference evaluation results. It must
show unsupported, partial, unavailable, derived, ambiguous, and incomparable
states honestly rather than converting them into apparent fidelity scores.

Architectural/evidence constraints: the viewer consumes existing observation,
relationship, comparison, contract, change-scope, correlation, bounded-context,
and v0.7 reference/evaluation engines/contracts. It must not create a second
observer, relationship engine, comparison engine, contract engine, reference
model, reference-evaluation engine, correlation implementation, or context
builder. CLI/programmatic paths remain first-class, viewer state does not mutate
targets, and merely opening/importing a reference in the viewer does not
silently approve or supersede it.

Dependencies/ecosystem/compatibility: depends on the proven v0.7 workflow and
stable v0.1–v0.7 artifacts/contracts. It may display ecosystem correlation but
does not redefine it. Viewer readers must declare supported artifact/context/
reference versions and show unsupported, missing, partial, derived, ambiguous,
and incomparable evidence honestly.

Exclusions: annotation authoring, source editing, a second workflow engine,
automatic design generation, cloud hosting, and making the viewer mandatory for
observation or coding-agent review.

Acceptance: a developer can inspect screenshots, targets, runtime behavior,
relationships, changes, contracts, diagnostics, change scope, correlation, and
reference/candidate evidence through the UI, and the displayed evidence is
demonstrably the same canonical evidence used by CLI/programmatic and
coding-agent workflows. A developer can select a reference region and see the
bound runtime target and measured mismatch where available without the viewer
recomputing a second result.

Version-start planning decisions are now resolved for v0.8:

- UI: React + TypeScript + Vite;
- application boundary: normal browser + Node-backed local server + installable
  Progressive Web App using the same viewer application;
- reader architecture: existing canonical readers feed an ephemeral viewer
  adapter/projection rather than a new persisted viewer artifact;
- reference/candidate display: side-by-side by default with independently
  toggleable structured overlays;
- geometry rendering: SVG using each source artifact/image's original coordinate
  domain;
- interaction: explicit-binding cross-selection, independent zoom/pan, and
  synchronized/locked viewing only when existing compatibility evidence permits
  it;
- loading: metadata/index first, with full artifacts and images loaded on demand.

The frozen concrete batch plan and implementation sequencing live in
`docs/plans/v0.8-implementation-plan.md`; this roadmap intentionally does not
copy those batches.

## v0.9 — Human Visual Annotation and Design-Intent Capture

Objective/problem: add structured visual human intent to the already working
v0.7 coding-agent workflow through the v0.8 viewer without inventing a separate
change-semantics system, and allow that intent to be authored against either a
runtime observation or an external visual reference.

Required capabilities: a bounded annotation set chosen during planning, such as
point/select, rectangle/area, arrow, line/boundary, textual note, preserve,
resize, move, remove, and inspect; structured annotation artifacts preserving
their annotation context (runtime observation or external reference), source
observation/screenshot or reference identity, geometry, type, text, provenance,
and reliable target/relationship/reference-region association; save/reload;
annotated image references; and explicit interpretation/confirmation state.

Runtime-screenshot annotations and external-reference annotations are separate
coordinate/identity domains. The annotation model must never assume that a
reference-region identity is a runtime-target identity. Coordinate transforms,
selection, overlays, persistence, and provenance must preserve which source
image the annotation belongs to.

Canonical intent flow:

```text
runtime screenshot annotation OR external reference annotation
→ target/relationship/reference-region binding
→ candidate requested/dependent/protected/preserved intent
→ explicit confirmation/interpretation where necessary
→ canonical change contract
```

For external references, annotation may also define or refine meaningful
reference regions and relationships, mark an asset-sensitive region, identify
which visual details are informational, and promote selected geometry/style/
relationship requirements into the canonical contract. A visible pixel never
becomes a hard requirement merely because it exists in the image.

Architectural/evidence constraints: annotation feeds the existing canonical
reference, change-scope, contract, bounded-context, and coding-agent workflow. It
must not create annotation-only or reference-only requested/protected semantics
or different PASS/FAIL rules. Ambiguous drawings never silently become strong
requirements. Original raw observations and imported reference images remain
immutable evidence; annotation and approval/supersession state are separate.

Dependencies/ecosystem/compatibility: depends on stable runtime identity,
reference identity, contracts, v0.7 coding-agent review/reference evaluation,
and v0.8 viewer/coordinate mapping. Structured annotation/context/reference
versions must be explicit and remain traceable to supported observation,
screenshot, and external-reference identities.

Exclusions: flattening intent into pixels only, bypassing confirmation,
replacing text/config requests, image-to-code generation, source editing, or
making annotation mandatory for ordinary coding-agent changes.

Acceptance: a user can annotate either an existing observation or an external
reference in the viewer; annotations survive save/reload; their source context
remains explicit; target/relationship/reference-region associations remain
available where reliable; preserve/resize/move/remove/inspect intent can be
represented where supported; reference regions and selected design requirements
can be authored without turning every pixel into a contract; ambiguous intent
requires explicit interpretation or confirmation; and annotations can drive the
existing coding-agent change-review workflow through the canonical contract and
reference models. Version-start planning must select the first annotation set,
coordinate transforms for both source contexts, persistence/versioning,
interpretation/confirmation workflow, conflicts, region-authoring behavior, and
annotated-image derivation.

## v0.10 — Full Visual Human–LLM Frontend Change Workflow

Objective/problem: complete the visual communication branch by combining the
already operational coding-agent loop with graphical inspection, external design
references, and structured annotation.

Two visual entry modes must coexist:

```text
actual-frontend-driven
human views actual captured frontend
→ points/draws/annotates requested design change
```

and:

```text
reference-driven
human supplies/selects an approved external visual reference
→ views reference beside the actual captured frontend
→ identifies/annotates relevant reference regions and intent
→ binds confirmed reference intent to stable runtime regions
```

Both then converge on the same canonical workflow:

```text
confirmed requested/dependent/protected/preserved scope
→ bounded runtime + relevant reference evidence is produced
→ bounded static evidence is obtained
→ coding-agent context is assembled
→ external coding agent modifies source
→ observer rerenders
→ before/after comparison runs
→ reference design vs candidate evaluation runs when applicable
→ requested/dependent/protected/preserved behavior and baseline contracts run
→ unexpected changes remain explicit
→ viewer shows PASS or actionable failure evidence
→ human approves or requests correction
→ successful state may become the new approved baseline and/or explicitly
  supersede an approved reference according to project policy
```

Architectural/evidence constraints: a visual request or reference does not
erase existing baseline contracts. Unless explicitly superseded, existing
approved contracts plus the new visual/per-change contract must both pass.
Reference fidelity is an additional evidence/evaluation dimension, not blanket
authorization for unrelated change. Runtime, reference, static, annotation,
workflow, implementation, approval, baseline, and supersession evidence remain
separate and traceable. The observer stays non-mutating; the orchestrator
coordinates bounded evidence; the lab is not required for every normal edit.

A mature result may therefore combine before/after results, reference/candidate
results, persistent-baseline evaluation, per-change evaluation, and unexpected
changes. A reference-fidelity pass with a protected or preserved contract
failure is overall failure. A raw imported image never silently becomes an
approved reference, and an approved reference never silently supersedes an
existing baseline or another approved reference.

Dependencies/ecosystem/compatibility: depends on all prior versions, especially
the v0.7 core/reference loop, v0.8 viewer, and v0.9 dual-context annotation
intent model. Use exact compatible observer/static/orchestrator/context/
reference/annotation/viewer contracts and retain the four-project responsibility
split.

Exclusions: replacing the external coding agent with observer source editing,
visual/reference intent silently overriding baseline contracts, autonomous
image-to-code generation, automatic raster-to-vector reconstruction, opaque
AI-only verdicts, untraceable baseline/reference replacement, and making lab
evaluation part of every edit.

Acceptance: demonstrate a successful actual-frontend-driven visual change; a
successful reference-driven design-replication change; measurable actionable
reference/candidate failure evidence; a requested visual/reference change that
introduces a protected-property or preserved-invariant regression; a correction
cycle; human approval and explicit baseline/reference history; and compatible
integrated ecosystem evidence. A protected/invariant failure must fail overall
even when the requested local visual change or reference-fidelity requirement
succeeds. Version-start planning must settle visual workflow entry points,
approval identity and authority, reference selection/applicability, baseline and
reference governance, correction iteration history, artifact retention, and
cross-version compatibility.
