# my-frontend-observer — Project Milestones

## Purpose

This document defines the ordered development milestones for `my-frontend-observer`.

`my-frontend-observer` is a separate, local-first runtime/browser evidence producer within the broader `my-dev-kit` ecosystem.

Its purpose is to observe what a browser actually renders and convert that runtime frontend state into structured evidence that humans, large language models (LLMs), coding agents, automated regression checks, and later ecosystem consumers can inspect. As the visual workflow matures, it also owns the structured evidence boundary for approved external visual references used to describe desired design intent, without treating those references as runtime observations or source code.

The milestone order is intentional.

Later capabilities must extend the observation model established by earlier milestones rather than creating parallel browser-control, artifact, comparison, contract, reference, annotation, or integration systems.

The project must preserve the core evidence flow:

```text
browser observation
→ structured runtime evidence
→ relationships and behavior
→ comparison
→ contracts and change scope
→ bounded agent context plus static/runtime integration
→ text/config-driven coding-agent change review
  + external visual-reference evidence foundation
  + reference-vs-candidate structured evaluation
→ human graphical inspection of runtime and reference evidence
→ structured visual annotation on runtime screenshots or external references
→ full visual human–LLM frontend change workflow
```

The project must not become a source-analysis replacement for `my-dev-kit`, an autonomous image-to-code generator, or a screenshot-cloning system.

## Long-term responsibility model

The intended ecosystem responsibility split is:

```text
my-dev-kit
→ static repository/source evidence
→ files
→ symbols
→ architecture
→ dependencies
→ probable source ownership evidence
→ bounded source retrieval

my-frontend-observer
→ rendered browser/runtime evidence
→ screenshots
→ stable rendered-region identities
→ geometry
→ scrolling and overflow
→ visibility
→ layout relationships
→ before/after comparisons
→ runtime contracts
→ external visual-reference evidence
→ reference-region identity and runtime binding
→ reference/candidate structured fidelity evidence
→ human visual intent

my-dev-kit-orchestrator
→ workflow coordination
→ bounded evidence consumption
→ implementation and verification flow

my-dev-kit-lab
→ compatibility
→ experiments
→ fixtures
→ ecosystem evaluation
→ evidence-quality validation
```

These responsibilities must remain distinct even when the projects become deeply integrated.

Deep integration means explicit contracts, evidence references, adapters, exact readers, and coordinated workflows.

It does not mean merging all four projects into one implementation.

## Product development model

The project develops through four broad phases.

### Phase A — Runtime evidence foundation

```text
Milestones 1–3
```

Establish trustworthy browser observation, stable runtime targets, and runtime behavior evidence.

### Phase B — Safe-change reasoning

```text
Milestones 4–5
```

Add comparison, relationship/dependency reasoning, executable contracts, and explicit requested/dependent/protected/preserved/unexpected change scope.

### Phase C — Coding-agent and ecosystem workflow

```text
Milestones 6–7
```

Combine bounded runtime and static evidence through explicit ecosystem contracts, then prove a text/config-driven coding-agent change-review workflow before graphical interaction becomes a dependency. Milestone 7 also establishes the non-graphical external-reference artifact/binding/evaluation foundation so the later viewer consumes canonical reference evidence rather than inventing it.

### Phase D — Human visual interaction

```text
Milestones 8–10
```

Add graphical inspection of runtime and reference evidence, structured visual annotation in both source contexts, and the complete visual human–LLM frontend change workflow on top of the already proven coding-agent path.

## Milestone 1 — Runtime Observation Foundation

### Objective

Establish `my-frontend-observer` as an independently executable runtime-evidence producer and prove the smallest complete browser-observation workflow against a deterministic local target.

This milestone establishes the foundational evidence model that every later capability must reuse.

### Required capability

The first vertical slice must be able to:

1. launch or connect to Chromium through the selected browser automation mechanism;
2. navigate to a supplied local URL;
3. apply a supplied viewport width and height;
4. accept one or more explicitly configured observation targets;
5. capture a screenshot;
6. capture required page-level browser evidence;
7. capture required target-level rendered evidence;
8. write one cohesive versioned observation artifact set;
9. return a concise machine-usable and human-understandable success, partial, warning, or failure result.

### Initial public interface

The initial public interface should be command-line first.

It should accept at minimum:

```text
target URL
viewport width
viewport height
observation targets
output location
```

and produce:

```text
screenshot
structured page evidence
structured target evidence
versioned observation artifact
concise execution result
```

The command-line interface must not own browser-control logic directly.

The observation engine must remain reusable independently of command-line presentation.

### Minimum page evidence

Capture at least:

```text
requested URL
final URL
document title

viewport width
viewport height
device pixel ratio where available

document width
document height
document scroll width
document scroll height
document client width
document client height

window scroll X
window scroll Y
```

### Minimum target evidence

For each explicitly observed target, capture at least:

```text
stable observer target identifier
selection method
selection result/status
tag

semantic role when available
accessible name when available

x
y
width
height
right
bottom

visibility
display
position
overflow-x
overflow-y

scroll width
scroll height
client width
client height
scroll top
scroll left where applicable
```

### Observation artifact foundation

The first milestone must establish an observer-owned artifact contract.

The exact schema and filenames must be decided during architecture/schema design, but the artifact model must include:

```text
artifact kind
schema version
observation identity
producer/package version
browser identity
request/configuration identity
provenance
page evidence
target evidence
screenshot reference
completion state
diagnostics
limits and omissions
artifact references
```

Artifact paths should be relative to the observation root where practical.

The artifact model must distinguish:

```text
direct browser observation
derived interpretation
unavailable evidence
not-applicable evidence
partial evidence
```

Package version and observation schema version must remain separate concepts.

### Evidence boundedness

The first version must not collect an unrestricted browser dump.

Observation must be explicitly scoped.

Do not capture by default:

- the entire raw Document Object Model;
- every computed style property;
- a complete accessibility tree;
- arbitrary numbers of targets;
- redundant browser evidence.

When evidence is omitted or truncated because of a limit, the artifact must make that visible.

### Completion semantics

The system must distinguish:

```text
complete observation
partial observation
observation with warnings
invalid request
fatal observation failure
```

Missing required evidence must not silently appear as a valid zero, false, empty string, or successful result.

### Diagnostics

Establish a small stable diagnostic model for cases such as:

- invalid request;
- unsupported configuration;
- navigation failure;
- target missing;
- target ambiguous;
- target hidden or unavailable;
- browser evidence unavailable;
- evidence truncated;
- artifact write failure;
- browser/runtime failure.

Diagnostic ordering should be deterministic where practical.

### Browser and network safety

Before broad navigation support is added, define the browser/network safety boundary.

The initial milestone should remain conservative and local-first.

The design must explicitly address, as appropriate:

- allowed URL schemes;
- local versus remote targets;
- redirects;
- timeouts;
- certificate failure behavior;
- downloads;
- popups;
- browser permissions;
- unexpected navigation;
- sensitive rendered data;
- secret-bearing URLs or output;
- browser-process cleanup.

### Deterministic fixture requirement

Create deterministic local fixture content for development and browser-level automated tests.

The first fixture should contain enough structure to observe at least:

```text
header
navigation
main/workspace
footer
```

The fixture exists to validate the observer, not to imitate a production product.

### Architecture requirements

The first milestone must establish clean ownership boundaries for at least:

```text
command-line interface
observation engine/application service
browser adapter
observation domain/schema
target/selector configuration
artifact writer
fixture/test infrastructure
```

Do not put browser automation directly inside future React presentation components.

Do not create speculative plugin systems, event buses, generic dependency containers, or multi-browser registries before they are justified.

### Ecosystem requirements

Milestone 1 must establish the observer as a future ecosystem evidence producer without creating cross-project runtime coupling.

The observer must not yet require:

```text
my-dev-kit
my-dev-kit-orchestrator
my-dev-kit-lab
```

as runtime dependencies.

The first artifact must nevertheless be designed so that future exact readers/adapters can consume it without scraping console text or depending on internal browser-library objects.

### Acceptance criteria

Milestone 1 is complete when:

- a clean installation can run the observation workflow;
- Chromium launches successfully;
- a supplied deterministic local page loads;
- viewport configuration is honored;
- explicitly configured targets are evaluated;
- screenshot generation succeeds;
- structured page evidence is written;
- structured target evidence is written;
- artifact identity and schema version are explicit;
- provenance is recorded;
- observed and derived evidence are distinguishable;
- missing/partial evidence is represented honestly;
- output paths are portable and bounded;
- browser/network safety rules are documented;
- deterministic fixture tests exist;
- target application files remain untouched;
- typecheck passes;
- lint passes;
- unit/integration tests pass;
- browser-level tests pass;
- applicable build/package validation passes;
- project documentation explains how the first observation works.

### Explicit exclusions

Do not include yet:

- automatic route discovery;
- comparison between observations;
- persistent regression contracts;
- requested/dependent/protected change contracts;
- rich LLM context packaging;
- external visual-reference evaluation;
- graphical observation viewer;
- visual annotation;
- static source ownership;
- `my-dev-kit` integration;
- orchestrator integration;
- lab integration;
- external LLM APIs;
- cloud browsers;
- authentication workflows;
- collaboration;
- cross-browser support beyond the selected initial Chromium implementation.

## Milestone 2 — Stable Semantic Targets and Region Identity

### Objective

Make meaningful frontend regions reliably observable and referable across repeated observations without depending entirely on brittle CSS selectors.

### Required capability

Establish an explicit observation-target model supporting appropriate forms such as:

- stable element `id`;
- accessibility role;
- accessible name;
- stable `data-*` attribute;
- semantic HTML element;
- bounded CSS selector fallback;
- text-based selection only when needed and explicitly constrained.

The exact public target configuration model must be defined before implementation.

### Stable runtime identity

Every configured observation target must have a stable observer-level identifier independent of its browser locator.

Example:

```text
target id:
primary-navigation

locator:
role=navigation
accessible name=Primary navigation
```

The stable observer identity should remain usable by:

- observations;
- comparisons;
- contracts;
- annotations;
- future reference bindings;
- future ecosystem correlation.

A stable runtime identity must not be treated as proof of source ownership or future reference identity.

### Multiple targets

One observation must support multiple explicitly configured targets.

Logical target examples may include:

```text
app-shell
header
primary-navigation
main-content
tool-workspace
left-ad-rail
right-ad-rail
footer-ad
footer
theme-control
```

These names are examples only.

The observer must not assume every target project has these regions.

### Semantic evidence

Where the browser exposes it reliably, enrich target observations with:

- accessibility role;
- accessible name;
- landmark identity;
- relevant state;
- containment relationships useful for layout reasoning.

### Cardinality and selection behavior

Target selection must define expected cardinality.

The observer must report explicitly when:

- no match exists;
- more than one element matches unexpectedly;
- the selected target is hidden;
- a target cannot be observed reliably;
- the selection mechanism is unsupported.

Do not silently choose an arbitrary match.

### Identity stability

Observation artifacts must preserve:

```text
stable target id
locator definition
selection method
actual selection status
```

so a future comparison can distinguish:

```text
target disappeared
```

from:

```text
target configuration changed
```

### Acceptance criteria

Milestone 2 is complete when:

- multiple targets can be captured in one observation;
- stable observer target IDs survive repeated observations;
- semantic selection works against deterministic fixtures;
- stable IDs/data attributes work where configured;
- CSS fallback remains available;
- ambiguous selection produces an explicit diagnostic;
- missing targets are represented explicitly;
- hidden/unavailable targets are not misrepresented as valid visible targets;
- semantic evidence is included where supported;
- observation artifacts remain bounded;
- deterministic fixtures yield deterministic semantic observations;
- Milestone 1 workflows remain valid.

### Explicit exclusions

Do not add yet:

- automatic source-file lookup;
- automatic target discovery through static analysis;
- LLM-driven target discovery;
- source ownership inference;
- external visual-reference regions;
- visual annotation;
- full accessibility auditing.

## Milestone 3 — Runtime Scrolling, Overflow, and Visibility Behavior

### Objective

Make runtime layout behavior observable instead of inferring scrolling, overflow, or viewport behavior solely from source code.

### Required capability

Capture scroll-related state for:

- document/root;
- body where relevant;
- explicitly observed targets.

Evidence should include, where applicable:

```text
scrollTop
scrollLeft
scrollWidth
scrollHeight
clientWidth
clientHeight
computed overflow-x
computed overflow-y
position
bounding rectangle
visibility relative to viewport
```

### Controlled scroll scenarios

Support a bounded observation scenario that can:

1. capture initial state;
2. request a controlled page scroll;
3. capture resulting state;
4. compare document scroll position;
5. compare observed target scroll positions;
6. identify measured values that changed;
7. identify targets entering or leaving the viewport where applicable.

This capability is bounded runtime-behavior evidence for defined observation
scenarios. It is not a generic browser interaction recorder, automation
framework, or replacement for Playwright.

### Required runtime questions

The system must be able to provide browser evidence for questions such as:

- Did `window.scrollY` change?
- Did an observed container's `scrollTop` change?
- Which observed container appears to own requested page scrolling?
- Is there horizontal document overflow?
- Is an element initially below the viewport?
- Does an element enter the viewport after scrolling?
- Is a footer region positioned after the main workspace?
- Did scroll ownership evidence change after a frontend modification?

### Claim-strength rule

The observer must preserve a strict distinction between:

```text
browser-observed fact
```

and:

```text
derived interpretation
```

Example direct evidence:

```text
window.scrollY changed from 0 to 500
main.scrollTop remained 0
```

Possible derived statement:

```text
document appears to own primary vertical scrolling
```

The interpretation must remain traceable to the measurements supporting it.

### Behavior relationships

This milestone should establish the foundation for runtime behavior relationships such as:

```text
target moves with document scroll
target remains fixed
container owns nested scrolling
element begins below viewport
element enters viewport after page scroll
```

These relationships are runtime evidence and must not be inferred from stylesheet declarations alone.

### Acceptance criteria

Milestone 3 is complete when deterministic fixtures prove:

- document scrolling;
- nested element scrolling;
- horizontal document overflow detection;
- nested overflow evidence;
- below-viewport detection;
- movement into viewport after scrolling;
- explicit reporting of changed scroll measurements;
- observed-versus-derived claim separation;
- stable artifact representation of runtime behavior;
- earlier observation artifacts remain compatible or are migrated deliberately.

## Milestone 4 — Layout Relationships, Dependency Evidence, and Before/After Comparison

### Objective

Compare two comparable observations and explain meaningful rendered-layout differences while establishing an explicit model for spatial relationships and potential layout dependencies.

### Comparison eligibility

Before comparing two observations, determine whether they are sufficiently comparable.

Relevant evidence may include:

```text
target identity
target configuration
route/page identity
viewport
browser/runtime identity
observation scenario
relevant state/theme
```

The comparison engine must not silently compare fundamentally incompatible observations as if they represented the same frontend state.

The comparability concepts established here should be extended or reused later for reference/candidate applicability where the same state dimensions apply, rather than replaced by a second unrelated state model.

### Required difference categories

The comparison engine should support, as evidence permits:

- appeared target;
- disappeared target;
- moved target;
- resized target;
- visibility change;
- clipping/containment change;
- horizontal-overflow change;
- vertical-overflow change;
- page-size change;
- scroll-owner evidence change;
- relative-position change;
- relationship change.

### Structured before/after evidence

For each difference report:

```text
target
property or relationship
before value
after value
difference
classification
supporting observation identities
```

Example:

```text
Target: primary-navigation
Property: width
Before: 176px
After: 97px
Difference: -79px
```

### Layout relationships

Support runtime relationships such as:

```text
A is left of B
A is above B
A contains B
A does not overlap B
A is wider than B
A follows B vertically
A fits inside B
document width does not exceed viewport width
footer follows main content
workspace lies between navigation and right rail
```

These relationships should be computed from browser-observed geometry where possible.

### Layout relationship graph

The system should support a structured representation of meaningful region relationships.

Conceptual example:

```text
Viewport
    ↓
AppShell
    ├── LeftAd
    ├── Navigation
    ├── Workspace
    └── RightAd
```

This representation should support later reasoning about which relationships changed and should be reusable where an external reference expresses the same geometric relationship among reference regions.

Do not require every target project to have the same graph structure.

### Dependency evidence

The system should leave room to represent expected layout dependencies such as:

```text
Navigation width decreases
        ↓
Workspace width increases
Workspace x-position changes
```

However, the observer must not infer causation merely because two values changed together.

A dependency claim must eventually come from:

- explicit user intent;
- a change contract;
- approved reference intent;
- an approved relationship specification;
- another supported evidence source.

Milestone 4 establishes the representation and comparison foundation.

Milestone 5 establishes executable change-scope semantics.

### Relationship comparison

Support comparisons such as:

```text
workspace width changed relative to navigation
advertising rail width changed
footer moved relative to workspace
navigation overlap appeared
page horizontal overflow appeared
scroll-owner relationship changed
```

### Screenshot association

Comparison must retain references to corresponding before/after screenshots and underlying observations.

### Acceptance criteria

Milestone 4 is complete when:

- comparable observations can be compared deterministically;
- incomparable observations are rejected or clearly marked;
- deterministic fixture changes produce deterministic structured differences;
- unchanged fixtures do not produce false meaningful regressions;
- moved and resized targets are detected;
- relationship changes are detected;
- overlap and overflow changes are represented;
- before/after screenshot references remain available;
- layout relationship evidence is traceable to underlying geometry;
- causation is not invented from correlation.

### Explicit exclusions

Do not yet decide automatically:

```text
looks better
looks worse
modern
ugly
```

The tool reports observable change.

Do not yet treat every difference as a failure.

Milestone 5 defines which changes are allowed, required, or protected.

External desired-design references are also not an ordinary Milestone 4 before/after comparison; that separate evidence domain arrives later.

## Milestone 5 — Executable Frontend Contracts and Explicit Change Scope

### Objective

Turn approved frontend behavior and user-requested change intent into persistent, executable runtime contracts.

This milestone establishes the mechanism that prevents:

```text
fix one frontend problem
→ accidentally break another
```

### Two contract classes

The system should distinguish two related forms of contract:

```text
persistent baseline contract
```

and:

```text
per-change contract
```

### Persistent baseline contracts

Persistent baseline contracts describe previously approved frontend behavior that should remain valid across future changes unless explicitly superseded.

Examples:

```text
navigation contents are not clipped
navigation does not overlap workspace
workspace does not overlap advertising rails
document does not horizontally overflow
document owns primary vertical scrolling
footer appears after main content
mobile workspace remains usable
```

### Per-change contract

A per-change contract describes the allowed scope of one requested frontend modification.

It should support four explicit categories.

#### Requested changes

Properties or relationships explicitly intended to change.

Example:

```text
primary-navigation.width
→ decrease significantly
```

#### Expected dependent changes

Properties expected to change as a legitimate consequence.

Example:

```text
tool-workspace.width
→ increase using released horizontal space

tool-workspace.x
→ may move left
```

#### Protected properties or regions

Properties expected to remain unchanged.

Example:

```text
left-ad-rail.width
right-ad-rail.width
header.height
```

#### Preserved invariants and behaviors

Previously correct relationships or behaviors that must remain valid.

Example:

```text
navigation remains unclipped
navigation does not overlap workspace
workspace does not overlap ads
no horizontal document overflow
scroll ownership remains unchanged
```

#### Unexpected changes

Observed properties or relationships that changed outside the requested,
expected-dependent, protected, or explicitly preserved scope must remain
visible and classified as unexpected rather than being silently ignored.

Together these five categories define the allowed frontend change scope.

Future executable reference-derived intent must reuse these same categories. A visible reference detail may remain informational or unassessed until explicitly promoted into the canonical contract. Reference evidence must not introduce a second requested/protected taxonomy.

### Relationship-first design

Prefer relational constraints when they more accurately represent the user's intent.

Example:

Prefer:

```text
workspace width increases when navigation width decreases
```

over:

```text
workspace width must equal 1039px
```

when the actual requirement is redistribution of available space rather than one fixed measurement.

Fixed-pixel constraints remain valid when explicitly required, including when an approved reference genuinely requires a particular geometry.

### Required contract primitives

The first contract model should support high-value conditions such as:

```text
target is visible
target is not clipped
target width is within a bound
target A does not overlap target B
target A is wider than target B
target A follows target B vertically
target is fully contained inside another target
document width does not exceed viewport width
window owns requested page scrolling
specified element does not own primary scrolling
element begins below initial viewport
relationship remains unchanged
property remains unchanged within an allowed tolerance
property increases/decreases as requested
```

Do not create a general-purpose programming language.

### Change evaluation

After implementation, comparison results should be evaluated against the change contract.

Conceptual result:

```text
REQUESTED CHANGE
Navigation.width
176 → 97
PASS

EXPECTED DEPENDENT CHANGE
Workspace.width
960 → 1039
PASS

PROTECTED PROPERTY
RightAd.width
112 → 154
FAIL

PRESERVED INVARIANT
Navigation content became clipped
FAIL

OVERALL
FAIL
```

A requested local success must not hide a protected-region regression.

A later reference-fidelity result must obey the same rule and cannot override this failure.

### Existing contracts remain active

A new requested change does not erase previously approved frontend contracts.

Unless the user explicitly supersedes a prior invariant:

```text
existing approved contracts
+
new per-change contract
```

must both be evaluated.

### Contract result requirements

Every contract result must explain:

```text
contract identity
contract category
PASS or FAIL
observed values
expected condition
observation identity
relevant targets
supporting evidence
```

Do not return only a score.

### Fixture coverage

Controlled fixtures should demonstrate at least:

- passing layout;
- clipped navigation content;
- overlapping regions;
- horizontal document overflow;
- document scrolling;
- nested scrolling;
- footer after workspace;
- relative-width relationship;
- requested resize;
- expected dependent resize;
- unexpected protected-region resize;
- preserved-invariant failure.

### Acceptance criteria

Milestone 5 is complete when:

- baseline contracts can be persisted;
- per-change contracts can be represented;
- requested/dependent/protected/preserved categories are explicit;
- contracts execute against fresh observations;
- previously approved contracts can be rerun after frontend changes;
- unexpected protected changes are distinguishable from legitimate dependent changes;
- contract failures return actionable evidence;
- relationship-oriented contracts work against deterministic fixtures;
- failing required contracts produce nonzero validation status where configured;
- contract evaluation does not mutate the target application.

## Milestone 6 — Bounded Agent Context and Native my-dev-kit Ecosystem Integration

### Objective

Make the runtime observer useful to an actual coding-agent workflow by combining bounded observer evidence with relevant bounded static/source evidence without merging producer responsibilities.

The core question is:

```text
What is the smallest trustworthy runtime + static context
the coding agent needs to understand and safely modify this frontend?
```

This milestone moves the minimum required ecosystem integration onto the critical path before viewer and annotation work.

### Runtime context requirements

Produce bounded runtime projections containing only task-relevant information such as:

- page identity;
- viewport;
- stable target identities;
- important geometry;
- runtime behavior;
- layout and behavior relationships;
- before/after differences;
- contract results;
- requested/dependent/protected/preserved scope;
- important diagnostics;
- screenshot and artifact references;
- provenance;
- truncation and omission metadata.

The runtime projection must remain traceable to authoritative observation, comparison, relationship, and contract evidence.

### Boundedness and adequacy

Do not dump by default:

- the full raw Document Object Model;
- every computed style property;
- complete accessibility trees;
- unrelated observations or targets;
- repeated unchanged measurements;
- unbounded diagnostics;
- embedded screenshots or other heavy assets when references are sufficient.

The context builder must report omissions, truncation, and whether evidence required for the agent task is adequate. Some evidence existing is not equivalent to adequate task context.

The same boundedness discipline must later apply when reference evidence is added: only relevant reference regions, failed requirements, and heavy-asset references belong in ordinary coding-agent context.

### Static/runtime correlation

Support explicit correlation between observer runtime identities and bounded static evidence where reliable.

Desired chain:

```text
rendered region
→ stable observer target
→ correlation evidence
→ my-dev-kit static identity / bounded evidence
→ relevant source retrieval
```

Runtime target identity must never silently become source ownership. Correlation confidence, ambiguity, competing candidates, and missing evidence must remain explicit.

A future reference-region to runtime-target binding remains a separate relationship upstream of this static correlation. Reference identity must not be passed off as a source identity either.

### my-dev-kit relationship

Determine whether current `my-dev-kit` identities and retrieval contracts already support the required correlation.

Modify `my-dev-kit` only if evidence proves that a generic static-side capability is actually missing. Do not add browser concepts, runtime observation semantics, reference-image semantics, or Playwright dependencies to `my-dev-kit`.

`my-dev-kit` remains the owner of static repository/source evidence, indexing, architecture, dependency evidence, probable ownership evidence, and bounded source retrieval.

### Observer relationship

`my-frontend-observer` owns:

- browser/runtime evidence;
- bounded runtime projection;
- stable runtime identity;
- correlation evidence it can support;
- the correlation/export boundary;
- references back to authoritative observer artifacts.

Future reference evidence remains observer-owned but distinct from runtime evidence. The observer does not become a static analyzer and must remain independently executable outside the ecosystem.

### Orchestrator relationship

Add bounded observer-evidence consumption to `my-dev-kit-orchestrator` so a workflow can coordinate or reference:

```text
bounded runtime evidence
+
bounded static evidence
```

for the coding agent.

The orchestrator must not:

- run the browser as its native responsibility;
- redefine observer evidence or artifact semantics;
- copy enormous raw browser artifacts into prompts by default;
- duplicate `my-dev-kit` retrieval;
- become the canonical owner of runtime/static correlation evidence.

Future reference-driven workflows may pass bounded reference/fidelity evidence through the same coordination boundary, but the orchestrator must not define a competing reference schema or fidelity engine.

### Lab relationship

Add only the `my-dev-kit-lab` exact readers, pinned fixtures, compatibility checks, and evidence-quality evaluation needed to prove the observer/orchestrator/static-evidence contract.

The lab remains downstream evaluation. It must not reimplement capture, retrieval, correlation, orchestration, or become part of every normal frontend edit.

Future reference compatibility/evidence-quality checks belong in the lab only when a concrete integration requires them; the lab must not become the production reference evaluator.

### Cross-repository dependency direction

When Milestone 6 implementation begins, preserve this high-level dependency direction:

```text
freeze bounded-agent-context and integration contract
→ determine whether my-dev-kit requires a static-side change
→ implement observer bounded projection/correlation/export
→ implement orchestrator bounded runtime-evidence consumption
→ add lab exact readers/fixtures/evaluation needed for compatibility
→ run individual repository readiness
→ run coordinated exact-version validation
```

This is dependency direction, not an implementation batch plan. Concrete steps and batches must be designed only when this milestone begins and the actual repository/package states can be inspected.

### Compatibility requirements

Cross-repository validation must pin and record:

- package versions or candidate identities;
- observer artifact/schema versions;
- bounded-context contract version;
- static identity/evidence contract version;
- orchestrator consumer compatibility;
- lab reader/fixture compatibility.

Do not validate downstream consumers accidentally against stale published upstream packages when coordinated candidates are intended.

Do not create a shared schema package merely for symmetry; require demonstrated cross-repository ownership and release need.

### Acceptance criteria

Milestone 6 is complete when:

- a coding agent or LLM can receive bounded, traceable runtime problem evidence;
- requested/dependent/protected/preserved scope and contract results are included where relevant;
- relevant bounded static/source evidence can be retrieved and correlated where reliable;
- ambiguous runtime/static correlation remains explicit;
- task adequacy, omission, and truncation are reported;
- the observer remains independently usable and does not duplicate static analysis;
- the orchestrator consumes bounded references/projections without becoming a browser runner;
- the lab reads exact supported contracts and validates required compatibility;
- every affected repository passes individual readiness;
- coordinated exact-version validation passes;
- no viewer, external-reference, or visual-annotation dependency is required for the released v0.6 capability itself.

## Milestone 7 — End-to-End Coding-Agent Frontend Change Review and External Reference Evidence Foundation

### Objective

Prove that the system solves the core practical frontend-correction problem through a text/config-driven workflow before investing in graphical interaction, and establish the non-graphical external visual-reference evidence foundation needed when the desired design is supplied as an approved image rather than expressed only as prose.

This is the first milestone where the complete coding-agent correction loop is operational. It is also the milestone where reference design vs candidate becomes a first-class observer evidence/evaluation path so Milestone 8 can display that canonical result rather than inventing a viewer-only implementation.

### Core text/config-driven workflow

Demonstrate:

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

Unexpected changes must remain visible and classified rather than disappearing outside the requested scope.

### External reference evidence domain

The milestone must also support a non-graphical external-reference path for an approved local image that represents desired design intent.

An external reference is not:

- an `ObservationArtifact`;
- the "before" side of the existing before/after comparison;
- source code;
- a hidden DOM/CSS/component representation;
- automatic permission to change every visible difference.

The exact public artifact/type names and schema versions must be selected during milestone planning by reusing current observer identity, provenance, validation, persistence, and boundedness precedents. Do not freeze a `ReferenceVisualArtifact` name merely because planning used that working term.

### Reference identity and provenance

A reference model must preserve, as applicable:

- deterministic logical reference identity/version;
- source image reference;
- image width/height and supported format;
- provenance;
- explicit reference viewport or other applicability identity;
- bounded reference regions;
- coordinate semantics;
- authored design constraints;
- relationships;
- selected style/asset evidence where supported;
- tolerances;
- diagnostics/limits;
- approval/supersession history.

Operational filesystem paths must not become semantic identity. Heavy image bytes should be referenced rather than copied into every downstream artifact/context packet.

### Reference regions

Support bounded meaningful reference-region identities, for example:

```text
popup-shell
header
brand-mark
current-page-card
destination-card
crawl-controls
progress
status
message
footer
```

Reference-region identity is separate from runtime target identity.

Reference geometry may include absolute image coordinates and may support normalized coordinates where appropriate. Exact coordinate semantics must be selected during milestone planning.

Reference regions should reuse the canonical layout-relationship vocabulary where the same geometric concept applies instead of creating a second relationship engine.

### Reference-to-runtime binding

The milestone must establish an explicit binding between:

```text
reference region
```

and:

```text
stable runtime target
```

The binding must be able to represent reliable association plus ambiguity/unavailability or equivalent conservative states selected during planning.

Reference identity, runtime identity, and static source identity remain separate. A binding to a runtime target never becomes source ownership automatically. Static/source evidence still flows through the Milestone 6 correlation/retrieval boundary.

### Reference applicability before fidelity

The system must decide whether a reference and candidate represent compatible intended states before ordinary fidelity differences are produced.

Relevant dimensions may include:

```text
viewport
theme
application state
variant/state identity
```

Example:

```text
reference: One Dark / active crawl
candidate: One Light / idle
```

must produce an explicit incompatible/incomparable result rather than a meaningless visual-difference list.

Where possible, extend/reuse the existing comparability/state conventions established by Milestone 4 rather than inventing an unrelated reference-only state system.

### Reference design intent and canonical contracts

A visible reference detail is evidence, not automatically a hard requirement.

The reference model must distinguish, at minimum conceptually:

```text
image-observed/derived evidence
authored design intent
informational or unassessed detail
```

When reference intent becomes executable, it must map into the existing Milestone 5 authored categories:

```text
requested
expected-dependent
protected
preserved
```

`unexpected` remains derived-only. Do not create reference-only requested/protected semantics or a separate PASS/FAIL taxonomy.

### Reference tolerance and style evidence

Reference fidelity cannot use one global pixel-perfect threshold.

Planning should define bounded property-specific tolerance semantics for appropriate categories such as:

- geometry;
- normalized position/size;
- spacing;
- layout relationships;
- selected color/style evidence;
- asset-sensitive regions;
- optional image-region similarity.

Text rendering, font differences, antialiasing, gradients, shadows, and glow may vary across platform/browser environments and must not generate false structural failures merely because screenshot bytes differ.

Screenshot/image similarity may supplement structured evidence, but it must not be the sole determinant of success.

### Reference-vs-candidate structured evaluation

The milestone must be able to combine:

```text
REFERENCE IMAGE
+ REFERENCE REGION GEOMETRY
+ REFERENCE RELATIONSHIPS
+ AUTHORED DESIGN INTENT
+ OPTIONAL IMAGE/ASSET SIMILARITY EVIDENCE
```

with:

```text
CANDIDATE SCREENSHOT
+ CANDIDATE BROWSER GEOMETRY
+ CANDIDATE RELATIONSHIPS
+ CANDIDATE COMPUTED EVIDENCE
```

and produce bounded, actionable evidence rather than only "looks different."

Example:

```text
Target: current-page-card
Reference x: 28
Candidate x: 18
Delta: -10

Reference width: 424
Candidate width: 446
Delta: +22

Expected separation below header: 24px within tolerance
Candidate separation: 38px
Result: fidelity requirement failed
```

The candidate side remains browser-authoritative and must be captured through the existing observation engine.

### Coding-agent correction packet

The external coding agent should receive only relevant reference/runtime mismatches plus active protected/preserved constraints, diagnostics/provenance, and bounded static/source context.

Do not make the coding agent reinterpret the full image from scratch on every correction iteration when structured mismatch evidence already exists.

Conceptually:

```text
reference requirement
+ candidate measurement
+ delta/failure
+ nearby protected relationships
+ bounded source evidence
→ coding agent correction
```

### Reference approval and supersession

The system must distinguish:

```text
raw imported image
≠ approved reference
≠ approved runtime baseline
```

Reference import, reference approval, baseline approval, reference supersession, and baseline supersession are separate acts.

A reference-fidelity `PASS`, ordinary comparison success, or frontend-contract `PASS` must never silently approve or supersede a reference/baseline.

Multiple approved references may exist for explicit states such as dark/light theme, desktop/mobile, idle/active/error, or other variants. Selection must be explicit through reference identity/applicability, not accidental filename matching.

### No viewer dependency

Both the ordinary text/config correction workflow and the external-reference foundation must work without requiring:

- an interactive graphical viewer;
- visual drawing;
- visual annotation authoring.

A human may express the requested change, expected dependents, protected regions/properties, preserved invariants, and initial reference regions/requirements through text or structured configuration.

### Required proof cases

Controlled targets must demonstrate:

1. a successful ordinary requested change whose dependent changes and preserved contracts pass;
2. an ordinary requested change that succeeds locally while a protected property or preserved invariant fails;
3. a reference-driven case where an approved external reference is bound to selected runtime targets, measurable fidelity mismatches are produced, bounded correction evidence reaches the coding agent, the candidate is rerendered, and reference fidelity is reevaluated;
4. a reference/candidate applicability mismatch that produces an explicit incompatible/incomparable result rather than fabricated visual differences;
5. a case where reference-fidelity requirements pass but an active protected/baseline contract fails, producing overall failure.

The protected/invariant cases prove the system prevents:

```text
fix or match one frontend area
→ silently break another
```

### Coding-agent boundary

The observer does not edit source.

A coding agent or another external implementation tool performs the edit against the target project. The observer and ecosystem provide bounded runtime/reference/static evidence before and after that edit. Source changes and evidence-producer responsibilities remain independently traceable.

The observer is not an automatic image-to-code generator, website cloner, raster-to-HTML/CSS generator, or vectorizer.

### Baseline and contract behavior

Existing approved baseline contracts remain active unless explicitly superseded.

```text
existing approved baseline contracts
+
new per-change contract
+
reference requirements where applicable
```

must all remain visible in the overall result. Successful results may be proposed as a new baseline or reference state, but approval and history must remain explicit.

### Acceptance criteria

Milestone 7 is complete when:

- the end-to-end text/config-driven coding-agent workflow runs against a controlled external target;
- bounded runtime plus relevant static evidence reaches the agent without full-repository or unbounded browser dumps;
- the agent changes source outside the observer;
- the observer recaptures and compares the result;
- requested and expected dependent changes are evaluated;
- protected properties and preserved invariants are evaluated;
- existing baseline contracts are rerun;
- successful and failing ordinary cases produce traceable actionable results;
- a locally successful requested change with a protected/invariant regression fails overall;
- an external-reference identity/artifact model exists without masquerading as an observation;
- bounded reference regions, applicability, authored intent, tolerances, and reference/runtime binding are represented explicitly;
- reference-vs-candidate structured evaluation produces measurable actionable evidence;
- incompatible reference/candidate state is represented explicitly;
- reference-derived executable intent reuses canonical contract semantics;
- bounded agent context can carry relevant reference mismatch evidence without embedding all heavy image bytes or unrelated regions;
- reference approval/supersession remains explicit;
- reference-fidelity success cannot hide an active contract failure;
- viewer and annotation systems are not required.

## Milestone 8 — Interactive Local Observation and Reference Viewer

### Objective

Add a human graphical inspection surface over the already working observation, comparison, contract, correlation, coding-agent-context, and external-reference evidence system.

The viewer enhances a proven core workflow; it is not a prerequisite for Milestones 6 or 7.

### Required interface capabilities

The viewer should show, as applicable:

- runtime screenshots;
- approved external reference images;
- stable observed targets;
- stable reference regions;
- geometry and semantic information;
- scrolling, overflow, and visibility evidence;
- layout and behavior relationships;
- before/after changes;
- reference/candidate structured fidelity evidence;
- reference applicability/incomparability;
- diagnostics and evidence-state distinctions;
- requested/dependent/protected/preserved/unexpected classifications;
- baseline and per-change contract results;
- reference-region/runtime-target bindings and ambiguity;
- source-correlation evidence and uncertainty where available;
- bounded agent-context references;
- provenance/approval information relevant to the displayed evidence.

### Reference/candidate inspection

The viewer should support a clear mode for inspecting an approved reference beside a browser-rendered candidate.

Where useful, this may include:

- side-by-side reference/candidate images;
- synchronized zoom/pan;
- region overlays;
- selecting a reference region and highlighting the bound runtime target;
- selecting a runtime target and showing its bound reference region;
- reference/candidate measurements and deltas;
- failed relationship/style/asset evidence;
- active baseline/per-change contract results;
- unsupported/partial/ambiguous/incomparable states.

The viewer displays canonical results; it must not recompute a second fidelity model merely for presentation.

### Element/screenshot/reference association

Where practical:

```text
structured runtime target selection
→ corresponding candidate screenshot region
```

```text
structured reference-region selection
→ corresponding reference image region
```

and, where an explicit binding exists:

```text
reference region
↔ runtime target
```

should be supported without inventing identity when evidence is insufficient.

### Architecture constraint

The viewer consumes existing canonical engines, contracts, and artifacts.

It must not create:

- a second observer;
- a second relationship engine;
- a second before/after comparison engine;
- a second contract/change-scope engine;
- a second reference artifact model;
- a second reference/candidate evaluation engine;
- a second static/runtime correlation engine;
- a second bounded-context builder.

CLI and programmatic paths remain first-class. Viewer state must not mutate target applications, raw observations, or raw reference images.

Merely opening/importing a reference in the viewer must not silently approve or supersede it.

### Acceptance criteria

Milestone 8 is complete when:

- a developer can inspect observations and screenshots without opening raw files;
- a developer can inspect approved external references beside candidates;
- geometry, runtime behavior, relationships, and before/after comparisons are understandable;
- reference/candidate fidelity evidence and applicability are understandable;
- contract/change-scope results identify relevant regions;
- reference/runtime binding ambiguity remains visible;
- source-correlation evidence displays uncertainty rather than false ownership;
- the evidence shown is the same canonical evidence used by the coding-agent workflow;
- selecting a reference region can expose the corresponding bound runtime target and mismatch evidence where available;
- command-line/programmatic workflows remain independently functional.

## Milestone 9 — Human Visual Annotation and Design-Intent Capture

### Objective

Add visual human intent to the already working Milestone 7 coding-agent/reference workflow through the Milestone 8 viewer.

Annotations may originate from either:

```text
a runtime observation screenshot
```

or:

```text
an approved/imported external visual reference
```

The two annotation contexts must remain explicit.

### Required annotation capabilities

Support a deliberately bounded first annotation set selected during milestone planning, such as:

- point/select;
- rectangle or area;
- arrow;
- line or boundary;
- textual note;
- preserve;
- resize;
- move;
- remove;
- inspect.

### Structured annotation artifact

Annotations must preserve:

- annotation source context (`runtime-observation` or external-reference equivalent selected during planning);
- observation/screenshot identity or reference identity;
- annotation geometry;
- annotation type;
- textual instruction where supplied;
- associated stable runtime target, relationship, or reference region where reliable;
- provenance and interpretation/confirmation state.

Do not store annotation intent only as flattened pixels. Preserve structured data in addition to any annotated screenshot/reference rendering.

Runtime-screenshot and reference-image coordinates are distinct domains. Coordinate transforms must preserve which source image the annotation belongs to.

### Reference region authoring

For external references, annotation may help define or refine:

- meaningful reference regions;
- reference-region relationships;
- asset-sensitive regions;
- design notes;
- which visual details are informational;
- which explicit geometry/style/relationship constraints should become executable intent.

A region drawn over a reference does not automatically make every enclosed pixel a requirement.

### Canonical intent and change-scope model

Annotations must feed the existing canonical reference/change-scope/contract model:

```text
runtime annotation OR external-reference annotation
→ target/relationship/reference-region binding
→ candidate requested/dependent/protected/preserved intent
→ explicit confirmation or interpretation where necessary
→ canonical per-change contract
```

Do not create annotation-only or reference-only change semantics or different PASS/FAIL rules. Ambiguous drawings must not silently become strong requirements.

### LLM and coding-agent consumption

The existing bounded agent-context system may include:

- original and annotated runtime screenshot references;
- external reference and annotated-reference references;
- structured observation evidence;
- structured reference evidence;
- structured annotations;
- current relationships;
- reference/candidate mismatches;
- baseline contracts;
- confirmed per-change scope;
- relevant bounded static evidence.

Annotation adds an input mode to the proven workflow; it does not replace text/config requests, reference evidence, or contract confirmation.

### Acceptance criteria

Milestone 9 is complete when:

- a user can annotate an existing observation in the viewer;
- a user can annotate an external reference in the viewer;
- annotations survive save/reload;
- structured annotations remain associated with the correct runtime/reference source identity;
- target/relationship/reference-region associations remain available where reliable;
- reference regions and selected design requirements can be authored without turning every pixel into a contract;
- preserve/resize/move/remove/inspect intent can be represented where supported;
- ambiguous intent requires explicit interpretation or confirmation;
- annotations can drive the existing coding-agent change-review workflow through the canonical reference and contract models;
- original raw observations and reference images remain unchanged.

## Milestone 10 — Full Visual Human–LLM Frontend Change Workflow

### Objective

Complete the visual communication version of the already operational coding-agent workflow.

This milestone combines the proven Milestone 7 correction/reference loop with the Milestone 8 viewer and Milestone 9 dual-context structured annotation.

### Intended visual entry modes

The system must support both of these entry modes.

Actual-frontend-driven:

```text
human views actual captured frontend
→ points/draws/annotates requested design change
→ observer binds intent to stable runtime regions
```

Reference-driven:

```text
human supplies or selects an approved external visual reference
→ viewer shows reference beside the actual captured candidate
→ human identifies/annotates relevant reference regions and design intent
→ observer binds confirmed reference intent to stable runtime regions
```

Both converge on the same canonical workflow:

```text
change scope is constructed and confirmed
→ bounded runtime evidence is produced
→ relevant bounded reference evidence is included where applicable
→ bounded static evidence is obtained
→ coding-agent context is assembled
→ external coding agent modifies source
→ observer rerenders
→ before/after comparison runs
→ reference-vs-candidate evaluation runs where applicable
→ requested/dependent/protected/preserved behavior is evaluated
→ baseline contracts rerun
→ unexpected changes remain explicit
→ viewer shows PASS or actionable failure evidence
→ human approves or requests correction
→ successful state may become the new approved baseline and/or explicitly
  supersede an approved reference according to project policy
```

### Critical invariant

A visual request or reference does not erase existing baseline contracts.

Unless explicitly superseded:

```text
existing approved contracts
+
new visual/requested change contract
+
active reference requirements where applicable
```

must remain active in the final evaluation.

The system must preserve unexpected-change evidence and cannot treat visual/reference intent as authorization for unrelated rendered changes.

A reference-fidelity `PASS` with a protected or preserved contract `FAIL` is overall failure.

### Reference and baseline governance

The workflow must keep separate:

- raw reference import;
- reference approval;
- active reference selection;
- reference supersession;
- baseline approval;
- baseline supersession;
- per-change approval;
- final human acceptance.

No comparison or evaluation result silently performs another governance act.

### Evidence and ownership model

The full workflow may combine:

```text
human visual intent

reference evidence
→ reference identity
→ reference image/regions
→ applicability
→ authored requirements
→ runtime binding
→ fidelity evidence

runtime evidence
→ screenshot
→ target identity
→ geometry and behavior
→ relationships
→ before/after comparison
→ contracts

static evidence
→ probable ownership
→ architecture and dependencies
→ bounded source retrieval

workflow evidence
→ request and confirmed scope
→ coding-agent context
→ implementation identity
→ verification
→ approval or correction
```

These domains remain separate and traceable. The observer remains non-mutating, the external coding agent edits source, the orchestrator coordinates bounded evidence, and the lab remains optional for normal edits outside compatibility/evaluation workflows.

### Required demonstration

Demonstrate:

- a successful actual-frontend-driven visual change;
- a successful reference-driven design-replication change;
- a reference/candidate mismatch producing actionable measured failure evidence;
- a requested visual/reference change that introduces a protected-property or preserved-invariant regression;
- a reference-fidelity pass that still fails overall because an active baseline/per-change contract fails;
- a correction cycle;
- human approval and new-baseline/reference history;
- compatible integrated ecosystem evidence using exact supported versions.

### Acceptance criteria

Milestone 10 is complete when:

- a human can inspect the actual captured frontend and express structured visual intent;
- a human can inspect/select an approved external reference and express structured reference intent;
- annotation binds to stable runtime/reference evidence where reliable;
- requested/dependent/protected/preserved scope is confirmed;
- bounded runtime, reference, and static evidence form traceable coding-agent context;
- an external coding agent changes the target;
- the observer rerenders and runs before/after comparison;
- reference-vs-candidate fidelity is reevaluated where applicable;
- all active contracts are evaluated;
- a protected/invariant regression fails despite local requested-change or reference-fidelity success;
- the viewer presents actionable evidence;
- the human can request correction and explicitly approve a successful new baseline/reference state;
- all affected ecosystem contracts remain compatible;
- no evidence producer's responsibility is merged into another project.

## Cross-Milestone Architecture Rules

Every milestone must preserve these boundaries.

### Observation engine ownership

One reusable observation engine owns browser capture.

Do not create separate browser-observation implementations for:

- command-line interface;
- graphical viewer;
- regression tests;
- annotation viewer;
- reference-driven workflows;
- orchestrator adapter.

### Browser adapter ownership

Browser-specific automation must remain behind a clear browser boundary.

Initial Chromium support must not require the entire domain model to depend directly on Playwright-specific objects.

Avoid speculative multi-browser abstraction before another browser is actually planned.

### Runtime and reference identity ownership

The observer owns stable runtime target identities and future stable reference-region identities, but these remain separate domains.

Runtime target IDs must remain distinct from:

- reference-region IDs;
- source-file paths;
- static symbol IDs;
- `my-dev-kit` graph-node IDs;
- orchestrator stage IDs;
- lab fixture IDs.

Reference-region IDs must likewise remain distinct from runtime and source identities.

Future binding/correlation may connect these identities explicitly.

Do not silently collapse them.

### Artifact ownership

Observation artifacts must have one canonical schema/versioning owner.

Future external-reference artifacts/evaluation results may have their own canonical observer-owned contract families, but they must remain distinct from observation artifacts and refer back to authoritative reference/runtime evidence.

Do not create incompatible output structures for:

- command-line use;
- graphical viewer;
- comparison;
- contracts;
- references;
- LLM packaging;
- ecosystem adapters.

Derived artifacts may have their own contracts, but they must refer back to authoritative evidence rather than copying everything.

### Evidence hierarchy

Preserve the distinction between:

```text
direct browser observation
direct image/reference measurement
authored reference requirement
normalized evidence
derived relationship
before/after comparison result
reference/candidate fidelity result
contract interpretation
bounded agent context or summary
human visual interpretation/approval
```

Do not flatten these into one unexplained result.

### Relationship ownership

Layout and behavior relationships must have one canonical interpretation layer where the relationship concept is shared.

Do not duplicate relationship logic in:

- viewer;
- reference evaluator;
- command-line interface;
- comparison engine;
- orchestrator adapter.

Reference relationships may need source-specific provenance but should reuse canonical relation semantics where appropriate.

### Comparison and reference-evaluation ownership

Before/after comparison must have one canonical implementation.

Reference design vs candidate is a distinct evaluation category and may require its own canonical observer-owned engine, but the viewer, CLI, and orchestrator must consume that one implementation rather than recreating it.

Do not pretend reference-vs-candidate is ordinary before/after comparison by forging an observation from an image.

### Contract ownership

Frontend baseline contracts and per-change contract evaluation must have one canonical engine.

Do not implement different PASS/FAIL semantics in:

- command-line validation;
- reference-driven workflows;
- viewer;
- automated tests;
- orchestrator integration.

Reference-derived executable intent feeds this engine rather than creating another contract system.

### Change-scope ownership

Requested, expected-dependent, protected, preserved, and unexpected classifications must use one canonical semantic model.

A protected-region failure cannot become a warning merely because one consumer or reference workflow prefers a looser interpretation.

### Reference approval ownership

Reference import, approval, active selection, and supersession require explicit observer-owned governance semantics when implemented.

Do not let:

- file import;
- viewer display;
- fidelity `PASS`;
- baseline `PASS`;
- coding-agent completion;

silently approve or supersede a reference.

### Target separation

Observed applications remain external targets.

Do not install observer dependencies into target applications merely to perform ordinary observation or reference-driven validation.

Optional future instrumentation may exist only when explicitly designed and must not become a hidden requirement for ordinary observation.

### my-dev-kit boundary

Do not duplicate:

- source indexing;
- symbol graphs;
- dependency graphs;
- architecture analysis;
- bounded source retrieval;
- source ownership inference;

inside `my-frontend-observer`.

Any source association must use an explicit static/runtime integration boundary. Reference/runtime binding is not static source analysis.

### Orchestrator boundary

Do not duplicate:

- workflow catalogs;
- stage lifecycle;
- readiness gates;
- correction routing;
- prompt orchestration;

inside `my-frontend-observer`.

The observer produces runtime/reference evidence.

The orchestrator coordinates workflows.

### Lab boundary

Do not duplicate:

- ecosystem evaluation;
- comparative experiment ownership;
- compatibility verdicts;
- release evaluation;

inside `my-frontend-observer`.

The observer owns production runtime/reference evidence and canonical reference/candidate evaluation.

The lab evaluates supported ecosystem behavior.

### Shared-package restraint

Do not create a shared ecosystem abstraction merely because multiple projects contain similarly shaped metadata.

A shared package must have a concrete, justified owner and compatibility need.

## Cross-Milestone Evidence Rules

### Observed, referenced, authored, and derived

Every milestone must preserve:

```text
browser-observed fact
≠
direct reference/image measurement
≠
authored design requirement
≠
derived interpretation
```

Example:

Observed:

```text
window.scrollY changed from 0 to 500
```

Derived:

```text
document appears to own page scrolling
```

Example:

Observed:

```text
navigation.width decreased
workspace.width increased
```

Not automatically proven:

```text
navigation shrink caused workspace expansion
```

Expected dependency requires explicit contract or supported intent evidence.

Example reference:

```text
reference card width measured at 424px
```

does not automatically mean:

```text
candidate card width must always equal 424px
```

unless authored reference intent makes that measurement an executable requirement with an appropriate tolerance.

### Missing evidence

Do not treat:

```text
unavailable
not observed
not applicable
unassessed
ambiguous
incompatible/incomparable
truncated
```

as interchangeable.

Do not substitute false, zero, or empty values for unavailable evidence.

### Boundedness

Every evidence-producing milestone must define appropriate limits.

Bounded lists should expose enough metadata to distinguish:

```text
no items existed
```

from:

```text
items existed but were omitted
```

Reference evidence must also remain bounded. Do not embed an entire image or every region/style difference repeatedly when references and targeted mismatch records suffice.

### Provenance

Every persistent evidence artifact must retain enough provenance to determine:

- which tool produced it;
- which version produced it;
- which schema applies;
- what target/configuration was used;
- what browser/environment matters;
- what evidence was omitted;
- what derived interpretation used which supporting facts.

Future reference artifacts/evaluations must additionally make it possible to determine which exact reference image/version, region definitions, authored requirements, applicability state, binding evidence, tolerance policy, candidate observation, and approval/supersession state were used.

## Cross-Milestone Testing Rules

Every implemented capability must receive the narrowest meaningful automated coverage.

The project should progressively maintain:

```text
unit tests
→ schema/serialization tests
→ observation integration tests
→ browser fixture tests
→ runtime behavior tests
→ comparison tests
→ relationship tests
→ contract tests
→ bounded agent-context tests
→ static/runtime correlation tests
→ ecosystem compatibility fixtures
→ text/config-driven coding-agent workflow tests
→ external-reference identity/artifact/binding tests
→ reference applicability and structured fidelity tests
→ reference-driven coding-agent correction tests
→ graphical-interface tests
→ annotation tests for runtime and reference contexts
→ full visual workflow tests
```

Every previously passing milestone remains part of regression validation for later milestones.

Do not weaken earlier tests merely to accommodate a later implementation.

### Browser-level evidence rule

Any browser/runtime feature requires browser-level validation.

Passing static typecheck or unit tests alone is not sufficient.

Reference-driven validation must also prove the candidate side against a real browser when the result depends on rendered runtime evidence.

### Fixture rule

Use deterministic local fixtures for canonical behavior.

Do not make public internet pages the authoritative test environment.

Reference-driven fixtures should use stable project-local reference images/artifacts whose identity can be pinned for deterministic tests.

### Cross-platform rule

Structured semantic evidence should be the primary portable contract.

Do not assume screenshot or reference/candidate image-diff byte identity across operating systems unless explicitly established.

Later ecosystem releases should satisfy the cross-platform validation expectations adopted by the ecosystem.

## Cross-Milestone Documentation Rules

Documentation must remain synchronized with implementation.

At minimum, as capabilities become real, maintain appropriate documentation for:

- project overview;
- architecture;
- observation artifact/schema;
- command interface;
- workflows;
- development/testing;
- limitations;
- browser/network safety;
- external-reference artifact/evaluation and local-file privacy when implemented;
- roadmap;
- ecosystem integration when implemented.

Do not document future milestone behavior as if it already exists.

### Forward-looking document rule

Forward-looking planning documents should be sufficiently self-contained for future LLM planning.

Important future design constraints should not exist only in scattered bookkeeping/reference documents.

The planning hierarchy is:

```text
Project Description
→ durable product intent

Project Milestones
→ ordered capability development
→ major design requirements
→ acceptance expectations

ROADMAP.md
→ version-level implementation direction
→ required capabilities
→ architectural constraints
→ dependencies
→ exclusions
→ acceptance expectations
```

`ROADMAP.md` must not contain prewritten implementation batches.

When implementation of a roadmap version begins, the implementation planner should:

```text
read relevant roadmap version
→ inspect current repository state
→ perform required my-dev-kit retrieval/architecture work
→ design implementation steps
→ divide those steps into batches
→ execute and validate
```

## Cross-Milestone Validation Rules

Once established, every milestone must preserve the trusted validation chain:

```text
typecheck
lint
unit/integration tests
browser tests
applicable build/package validation
documentation checks when implemented
```

Later ecosystem-integrated versions must additionally preserve:

```text
individual repository readiness
→ exact candidate identity verification
→ coordinated cross-repository compatibility validation
```

A coordinated ecosystem release must not validate downstream consumers against stale upstream versions when coordinated candidate versions are intended.

## Milestone Ordering

The intended development sequence is:

```text
Milestone 1
Runtime Observation Foundation
        ↓
Milestone 2
Stable Semantic Targets and Region Identity
        ↓
Milestone 3
Runtime Scrolling, Overflow, and Visibility Behavior
        ↓
Milestone 4
Layout Relationships, Dependency Evidence,
and Before/After Comparison
        ↓
Milestone 5
Executable Frontend Contracts
and Explicit Change Scope
        ↓
Milestone 6
Bounded Agent Context
and Native my-dev-kit Ecosystem Integration
        ↓
Milestone 7
End-to-End Coding-Agent Frontend Change Review
and External Reference Evidence Foundation
        ↓
Milestone 8
Interactive Local Observation and Reference Viewer
        ↓
Milestone 9
Human Visual Annotation
and Design-Intent Capture
        ↓
Milestone 10
Full Visual Human–LLM Frontend Change Workflow
```

The critical path through Milestone 7 proves that browser/runtime evidence,
safe-change contracts, bounded static/runtime context, an external coding
agent, and optional approved external-reference evidence can complete a
regression-aware frontend correction without a graphical viewer or annotation
authoring.

Milestones 8–10 form the human visual branch. The viewer and annotation system
enhance the proven coding-agent/reference workflow; they are not prerequisites
for it. Milestone 8 displays the reference model created in Milestone 7,
Milestone 9 adds dual-context annotation, and Milestone 10 combines actual-
frontend-driven and reference-driven entry modes.

Do not reorder these milestones merely for implementation convenience.

A milestone may span more than one package version if necessary. Multiple
milestones may be combined into one implementation version only when doing so
preserves dependency order and does not create unnecessary coupling.

Version boundaries belong in `ROADMAP.md`. Concrete implementation steps and
batches do not belong in this milestone document.

## Initial bootstrap target

The greenfield bootstrap establishes the standardized project foundation and
forward-looking documents. Milestone 1 remains the first roadmap implementation
target after bootstrap; it must be planned from the then-current repository
state before product code is written.

The eventual v0.1 vertical slice should remain intentionally small:

```text
target URL
+ viewport
+ explicitly configured targets
        ↓
Chromium observation
        ↓
screenshot
+ structured page evidence
+ structured target evidence
        ↓
versioned local observation artifact
```

The bootstrap must preserve architecture and documentation for future milestones without implementing roadmap v0.1 or later capabilities prematurely.

Do not bootstrap:

- comparison;
- regression contracts;
- per-change contracts;
- LLM context packaging;
- external visual-reference evaluation;
- graphical viewing;
- annotation;
- static/runtime source correlation;
- orchestrator adapters;
- lab adapters.

The purpose of the first milestone is to establish a clean, bounded, versioned, trustworthy runtime-evidence foundation from which every later capability can grow.
