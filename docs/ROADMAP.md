# Roadmap

v0.8.1 status: released as v0.8.1 and published to npm as
`@dailephd/my-frontend-observer@0.8.1`. v0.9 version-start planning is frozen
but implementation has not started. v0.10 remains future work.

This is a version-level specification, not an implementation checklist.
Concrete steps and sequencing are designed only when a version begins, after
the planner reads that version, inspects current repository state, and performs
needed my-dev-kit retrieval and architecture work. Once those version-start
decisions are frozen, this roadmap records the durable version-level design so
a later planner can reconstruct the intended implementation without stitching
critical architecture decisions across reports, chats, or batch prompts. Exact
files, interfaces, tests, batch gates, and prompt sequencing belong in the
version implementation plan.

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

## v0.8.1 — Project Workflow CLI and Human-Readable Evidence Aliases

Current status: released as `v0.8.1` and published to npm as
`@dailephd/my-frontend-observer@0.8.1`. The frozen
concrete implementation plan is
`docs/plans/v0.8.1-cli-usability-patch-plan.md`.

Objective/problem: preserve the canonical v0.1-v0.8 evidence engines while
removing artifact-plumbing friction from ordinary human and coding-agent use.
The released low-level CLI still requires users to repeat observation
configuration, choose output paths, pass exact artifact roots between commands,
and may expose long immutable artifact identifiers during routine navigation.
Those identities remain valuable provenance, but they should not be the normal
workflow interface.

Required capabilities: project-local versioned configuration; upward project
discovery; managed project-local Observer state; a versioned alias catalog that
maps human-readable names to canonical immutable artifacts; `init` for one-time
project configuration; `capture <name>` for project-configured observation;
`check [<baseline>]` for high-level capture plus canonical comparison and
applicable contract/reference evaluation; bounded `check --json` output for
coding agents; project-aware `view` without a required `--root`; alias-first
viewer navigation with canonical IDs retained as provenance; and reorganized
help that distinguishes the common workflow from advanced artifact-level
commands.

The normal workflow should become:

```text
my-frontend-observer init
my-frontend-observer capture baseline
my-frontend-observer check baseline
my-frontend-observer view
```

Existing low-level commands remain supported unchanged for automation,
compatibility, debugging, and advanced workflows:

```text
observe
compare
approve-baseline
save-change-contract
evaluate-contract
import-reference
approve-reference
evaluate-reference-fidelity
```

Acceptance semantics: `check` may report PASS only when every configured
executable acceptance dimension required by the project passes. It reports FAIL
when a configured executable criterion fails, REVIEW_REQUIRED when useful
comparison evidence exists but executable criteria are insufficient to declare
success or failure, and BLOCKED when required evidence cannot be obtained or
evaluated reliably. A raw comparison or apparent lack of differences must never
be promoted to PASS by itself. Reference-fidelity PASS must not override an
active frontend-contract FAIL.

Architectural/evidence constraints: this patch is a thin project/workflow layer
over the existing canonical observation, comparison, contract, reference,
binding, compatibility, fidelity, context, and viewer owners. Project
configuration and aliases are workflow metadata, not replacement artifact
identities. Alias replacement never deletes canonical evidence or silently
approves/supersedes a baseline or reference. Existing artifact/evaluation schema
versions stay unchanged. Existing CLI/programmatic paths remain first-class and
do not require project initialization.

Dependencies/ecosystem/compatibility: depends on released v0.8.0 and must remain
compatible with the existing v0.7 coding-agent/reference workflow. The patch is
specifically designed so v0.9 annotation can extend the existing viewer without
another top-level workflow command architecture, while v0.10 coding-agent
correction can repeatedly consume `check <baseline> --json` after external
source edits.

Exclusions: annotation authoring, source editing, automatic frontend correction,
coding-agent orchestration inside Observer, automatic binding, image-to-code
generation, deleting historical canonical evidence, implicit baseline/reference
approval or supersession, new evidence/evaluation engines, cloud hosting,
authentication, collaboration, and databases.

Acceptance: a new user can initialize a project once, capture a named baseline,
change the frontend, run one high-level check, and inspect the result without
typing an output path, evidence root, or canonical artifact hash. A coding agent
can consume the same acceptance operation through bounded JSON. Real Chromium
and a clean packed-consumer installation must prove the workflow, and all
existing low-level commands must remain backward compatible.

## v0.9 — Human Visual Annotation and Design-Intent Capture

Current status: version-start architecture is frozen; implementation has not
started. The source-grounding report is
`docs/reports/v0.9-architecture-retrieval.md`, and the concrete file-level,
test-level, and seven-prompt implementation plan is
`docs/plans/v0.9-implementation-plan.md`. The version-level decisions below are
the durable design authority. A future planner should be able to derive an
implementation plan from this section plus current repository state without
recovering critical choices from old chats or implementation reports.

Objective/problem: add structured visual human intent to the already working
v0.7 coding-agent/reference workflow through the v0.8 viewer without inventing
a separate change-semantics system. Intent may be authored against either an
existing runtime observation screenshot or an existing external visual
reference. The v0.8.1 project workflow and alias layer remain the normal project
discovery and human-selection surface. v0.9 extends `view`; it does not create a
new top-level annotation workflow architecture.

### Frozen annotation evidence model

v0.9 introduces one distinct persisted observer-owned annotation evidence
family, `VisualAnnotationArtifact`, with initial schema version `1.0.0`.
Annotations are not mutable fields added to observations, external references,
comparisons, contracts, or evaluation artifacts. Original runtime observations,
screenshots, imported/approved external references, and reference images remain
immutable source evidence.

Every explicit annotation save creates a new immutable annotation artifact
instance. A later edit creates another artifact and may explicitly point
forward to the previous instance through `supersedesAnnotationId`; the old
artifact is never rewritten or deleted. Annotation logical/request identity is
deterministic from canonical semantic content, while annotation instance
identity is fresh for each persisted instance, following the repository's
existing request-identity versus instance-identity pattern.

Persisted annotation provenance must use canonical source identity. Human aliases
such as `baseline` and `current`, viewer handles, viewer URLs, ports, absolute
paths, and other session-local selectors must never become annotation identity.
Aliases remain conveniences for selecting canonical artifacts before authoring.

### Frozen source contexts and coordinate domains

Each annotation has exactly one source context:

```text
runtime-observation
external-reference
```

Runtime annotations are tied to one canonical observation/screenshot identity
and use the existing runtime screenshot coordinate domain: viewport CSS pixels.
They do not multiply geometry by device pixel ratio, round to screenshot-device
pixels, or invent a second transform.

External-reference annotations are tied to one canonical reference/image
identity and use reference-image pixels. Reference-image pixels are never
silently treated as runtime CSS pixels.

The existing runtime and reference SVG workspaces remain separate coordinate
and identity domains. The same zoom/pan interaction machinery may be reused,
but each workspace supplies its own frame. Annotation rendering should be a
layer inside the existing source SVG coordinate frame rather than an
independently transformed canvas.

A reference-region ID is not a runtime-target identity. Runtime-target,
reference-region, annotation-item, artifact, filesystem, source-symbol, and
project-alias identities remain distinct even when explicit relationships link
them.

### Frozen first annotation set

The first persisted visual mark vocabulary is deliberately bounded to:

```text
point
rectangle
line
arrow
note
```

`select` and `pan` are viewer interaction modes, not persisted annotation
marks. v0.9 does not add freehand drawing, polygons, Bezier paths, paint
strokes, masks, arbitrary SVG input, OCR-driven regions, or computer-vision
segmentation.

The first human-facing intent operations are:

```text
inspect
move
resize
remove
preserve
```

External-reference annotation additionally supports candidate intent for:

```text
reference-region
reference-requirement
asset-sensitive
```

`asset-sensitive` and `inspect` may remain informational. Their existence must
not silently add an acceptance rule.

### Explicit association, interpretation, and confirmation

Drawing geometry alone does not establish semantic ownership or executable
intent. Runtime annotation may associate with an existing runtime target or
existing runtime relationship only through explicit structured selection.
Reference annotation may associate with an existing reference region or
existing reference relationship only through explicit structured selection.

The following must never silently create association or binding:

```text
name similarity
rectangle overlap
nearest element
visual proximity
drawing containment
same textual identifier across runtime/reference domains
```

An unbound drawing remains valid visual/narrative evidence but cannot be
promoted into a canonical requirement that needs a structured target or region.

Each annotation interpretation has an explicit state:

```text
uninterpreted
candidate
confirmed
```

The viewer may suggest a bounded candidate interpretation from explicit user
choices and known canonical evidence, but ambiguous geometry never silently
becomes a strong requirement. Only a `confirmed` interpretation may be selected
for canonical promotion. Before confirmation, the viewer must show the exact
candidate structured meaning that would be persisted/promoted.

### Canonical change-scope and contract reuse

v0.9 reuses exactly the existing authored change-scope categories:

```text
requested
expected-dependent
protected
preserved
```

For `expected-dependent`, the existing `required`/`permitted` mode remains
mandatory. `unexpected` remains evaluator output and is never authorable through
annotation.

Runtime annotation does not introduce a second contract language. Confirmed
runtime visual intent may promote only into the existing bounded
`ContractPrimitive` vocabulary. High-value mappings include move/resize intent
through existing `x`, `y`, `width`, and `height` property increase/decrease
primitives and preserve intent through existing property-with-tolerance or
relationship-unchanged primitives. Existing visibility, clipping, width-bound,
overlap, relative-width, vertical-sequence, containment, page-width, and
scroll-owner primitives remain available when they accurately represent the
confirmed intent.

The drawing is not itself the contract. Promotion produces an ordinary
canonical `PerChangeContract`, using the existing contract identity,
persistence, validation, conflict, evaluation, and PASS/FAIL semantics.
Annotation does not evaluate contracts.

The first version must preserve unsupported human intent honestly. In
particular, `remove` can be represented and explicitly confirmed as annotation
intent, but the current canonical contract vocabulary has no target-absent
primitive. v0.9 therefore must not fabricate an approximate clause or expand the
contract language merely to make `remove` executable. It remains confirmed but
not canonically promotable until a future version deliberately extends the
contract model.

### External-reference region and requirement authoring

External-reference annotation may explicitly create or refine meaningful
reference regions and may promote selected design requirements, but a drawn
rectangle never turns every enclosed pixel into a requirement.

A confirmed new region uses its annotation rectangle directly in the existing
reference-image pixel domain. A confirmed refinement explicitly selects an
existing region ID; the resulting new reference revision may retain that region
identity while changing its rectangle. Relationship choices must come from the
existing canonical reference-region relationship derivation rather than a
viewer-only relationship engine.

Confirmed reference requirements reuse the existing
`RawReferenceRequirement` / `ReferenceRequirementSubject` model and the same
authored change-scope categories. Supported subjects remain the existing
bounded region-property, region-relationship, and region-measurement forms with
existing reference tolerance semantics (`exact`, `absolute-reference-px`, or
`percent` where applicable). Visible geometry that the user did not explicitly
promote remains informational reference evidence.

Materializing confirmed reference annotation creates a new immutable imported
`ExternalReferenceArtifact` revision through the existing canonical reference
persistence model. The new artifact carries forward unchanged image content,
applicability, regions, and requirements except where selected confirmed intent
explicitly adds or refines them; it explicitly supersedes the selected source
reference. The prior reference remains unchanged. The new revision is not
automatically approved and does not automatically replace the project's active
approved reference. Approval and project reference selection remain separate,
explicit governance actions.

### Annotation persistence and annotated rendering

The structured annotation manifest is authoritative. v0.9 also derives one
bounded system-generated annotation overlay, `annotation-overlay.svg`, for each
saved annotation artifact. The overlay uses the same source-native coordinate
frame recorded by the artifact, contains only validated system-generated SVG,
and has an integrity digest. It does not embed arbitrary user SVG/HTML and does
not copy the underlying screenshot or external-reference image.

The annotated visual is reconstructed as:

```text
canonical source image
+
structured annotation overlay
```

The derived overlay is not a second evidence or interpretation model. If any
presentation bug causes disagreement, structured annotation data remains the
authority.

### Viewer authoring and security boundary

Normal annotation authoring is available through project-aware:

```text
my-frontend-observer view
```

inside a valid initialized project. Existing advanced
`my-frontend-observer view --root <evidence-root>` remains a supported
inspection surface and stays read-only when it is not operating with the normal
initialized-project authoring context.

Because v0.8 intentionally exposed only GET/HEAD inspection routes, v0.9 may add
POST only for the narrow annotation-authoring and confirmed-promotion operations
required by this version. It must not add arbitrary filesystem writes, target
source writes, PUT/PATCH/DELETE mutation APIs, permissive CORS, or a generic
local RPC endpoint.

The project-aware viewer authoring session must use a short-lived in-memory
capability token plus strict loopback same-origin/Host enforcement, bounded JSON
bodies, and canonical server-side resolution of evidence handles to source
artifacts. The browser must never supply arbitrary output paths. The token is
session-only, is not persisted as project/evidence identity, and must not become
service-worker cached authority.

Annotation persistence follows the repository's established immutable artifact
pattern: structural validation before write, fresh final instance directory,
sibling temporary directory, deterministic owned-media generation, manifest
write, atomic rename, no overwrite, and cleanup on failure.

Project-managed annotation evidence belongs under the managed Observer evidence
root using canonical IDs. v0.9 does not introduce an annotation alias catalog.

### Conflict and revision rules

Annotation revision conflict is handled by explicit lineage, not last-write-wins.
A revision save identifies the canonical parent annotation. A stale edit must be
rejected rather than silently overwrite newer evidence. If malformed/historical
evidence presents multiple lineage heads, the viewer must expose that ambiguity
and require an explicit choice rather than select a winner by timestamp.

Semantic contract conflicts remain owned by the existing contract validators and
evaluator. Reference requirement validity/adequacy remains owned by the existing
reference model. Annotation must not add a second conflict-resolution engine.
Unsupported confirmed intent is reported as unsupported for canonical promotion,
not silently converted to PASS, FAIL, or another requirement.

### Canonical intent flow

The version-level flow is:

```text
runtime screenshot annotation OR external-reference annotation
→ explicit source-domain association where reliable
→ candidate requested/dependent/protected/preserved or informational intent
→ explicit interpretation/confirmation
→ save immutable structured annotation evidence
→ selected confirmed runtime intent may become a canonical per-change contract
  OR
  selected confirmed reference intent may become a new imported reference revision
→ existing contract/reference approval and evaluation workflows remain authoritative
```

This version stops before the full post-edit human/LLM correction loop. v0.10
owns automatic workflow coordination around external coding-agent source edits,
rerendering, repeated `check <baseline> --json`, final human approval, and
baseline/reference governance across correction iterations.

### Dependencies/ecosystem/compatibility

v0.9 depends on:

- stable runtime observation and target identity;
- existing relationship and comparison evidence;
- existing baseline/per-change contract vocabulary and evaluator;
- v0.7 external-reference identity, region, requirement, applicability,
  binding, compatibility, fidelity, and bounded-context integration;
- v0.8 viewer server, runtime/reference SVG workspaces, source-domain coordinate
  rendering, zoom/pan, metadata-first discovery, safe media resolution, and
  explicit binding cross-selection;
- v0.8.1 project discovery, managed evidence root, human-readable aliases,
  project-aware viewer startup, and canonical identity resolution beneath
  aliases.

Existing observation, comparison, frontend-contract, evaluation,
bounded-agent-context, and external-reference schema semantics remain
independently authoritative. Annotation may reference and promote into them but
must not redefine them.

The existing bounded agent-context system may later include relevant annotation
references/structured annotation evidence as part of the proven coding-agent
workflow, but heavy source images or unrelated annotation history should not be
embedded by default. v0.9 does not require changes to my-dev-kit,
orchestrator, or lab unless an actual compatibility need is demonstrated during
implementation.

### Exclusions

v0.9 explicitly excludes:

```text
application source editing
automatic coding-agent execution
full correction-loop orchestration
image-to-code or raster-to-HTML/CSS/SVG generation
automatic target discovery
automatic reference/runtime binding
automatic reference-region detection
OCR-driven requirements
computer-vision segmentation
freehand drawing or arbitrary SVG authoring
a second contract/change-scope taxonomy
a second reference-requirement taxonomy
a second PASS/FAIL evaluator
automatic reference approval
automatic baseline approval or replacement
automatic approved-reference replacement
cloud synchronization
accounts/authentication/collaboration/comment threads
database storage
making annotation mandatory for ordinary capture/check/coding-agent workflows
```

### Acceptance

v0.9 is complete only when all of the following are true:

- a user can annotate an existing runtime observation in the project-aware
  viewer and save/reload it without coordinate drift;
- a user can annotate an imported or approved external reference and save/reload
  it in reference-image coordinates;
- saved annotations remain tied to exact canonical source identities even when a
  human alias later points somewhere else;
- runtime-target, runtime-relationship, reference-region, and
  reference-relationship associations occur only when explicitly and reliably
  selected;
- zoomed/panned drawing maps back to the same source-native coordinates used by
  the existing SVG workspace;
- point/rectangle/line/arrow/note marks persist as structured evidence, not only
  flattened pixels;
- preserve/resize/move/remove/inspect intent can be represented, with unsupported
  executable mappings reported honestly;
- ambiguous or unbound drawings cannot silently become strong requirements;
- a supported confirmed runtime move/resize/preserve intent can produce a normal
  canonical per-change contract without a second contract evaluator;
- selected confirmed external-reference region/requirement intent can produce a
  new immutable imported reference revision without modifying or approving the
  source reference;
- informational notes/asset-sensitive regions remain informational unless
  explicitly promoted through a supported canonical model;
- annotation revision conflicts fail explicitly instead of overwriting history;
- original observation artifacts, screenshots, external-reference artifacts,
  and reference images remain unchanged;
- the bounded local write surface rejects unauthorized origins, missing/invalid
  session capability, unsafe paths, unsupported methods, and malformed/oversized
  requests;
- existing v0.8 viewer inspection and v0.8.1 `init`/`capture`/`check`/`view`
  workflows remain backward compatible;
- a clean packed npm candidate proves annotation save/reload and canonical
  promotion behavior, with the existing cross-platform/security validation
  expectations preserved.

The frozen concrete module contracts, validation rules, test responsibilities,
seven implementation prompts, and batch gates live in
`docs/plans/v0.9-implementation-plan.md`. That plan must be derivable from the
version-level decisions above plus current repository inspection; this roadmap
intentionally does not duplicate batch-by-batch instructions.

## v0.10 — Full Visual Human–LLM Frontend Change Workflow

Objective/problem: complete the visual communication branch by combining the
already operational coding-agent loop with graphical inspection, external design
references, structured annotation, and the v0.8.1 project-level acceptance
surface so ordinary correction iterations do not require direct artifact-path
plumbing.

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

The ordinary machine-facing post-edit correction loop must reuse the canonical
`check <baseline> --json` surface. v0.10 must not reconstruct before/after
comparison, frontend-contract verdicts, reference fidelity, or workflow
PASS/FAIL/BLOCKED precedence when v0.8.1 already provides them.

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
the v0.7 core/reference loop, v0.8 viewer, v0.8.1 project workflow/acceptance
surface, and v0.9 dual-context annotation intent model. Use exact compatible
observer/static/orchestrator/context/reference/annotation/viewer contracts and
retain the four-project responsibility split.

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
