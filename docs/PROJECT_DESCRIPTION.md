# my-frontend-observer

## Project type

Greenfield developer tool and runtime-evidence producer within the `my-dev-kit` ecosystem.

## Problem

Large language models (LLMs) and coding agents can inspect frontend source code, component trees, stylesheets, project architecture, and static dependencies, but they often cannot reliably understand what an application actually looks like or how it actually behaves after a browser renders it.

This creates a recurring frontend-development failure mode:

1. A user describes a visual, layout, scrolling, responsiveness, or composition problem.
2. The LLM interprets the request primarily through language and source code.
3. Static repository evidence identifies a plausible source owner.
4. A coding agent changes styling, layout, or component structure.
5. The requested local symptom appears fixed.
6. Another previously correct part of the rendered interface becomes visually or behaviorally broken.
7. Source-level tests may still pass because the regression exists only in actual browser geometry, scrolling, overflow, clipping, spacing, responsiveness, or composition.
8. The coding agent may incorrectly declare success because the requested source-level change was made without verifying the complete rendered result.

Examples include:

- shrinking a navigation column while leaving its contents too large for the new width;
- shrinking a navigation column without transferring the released space to the intended workspace;
- accidentally allowing an advertising rail to absorb released width;
- changing one grid track while unintentionally moving or resizing unrelated regions;
- fixing a nested scroll container in source while the rendered page still scrolls through the wrong container;
- causing labels to wrap, clip, overlap, or disappear;
- creating horizontal overflow at another viewport;
- moving, hiding, or resizing advertising, footer, header, or workspace regions unintentionally;
- satisfying one numerical styling requirement while degrading the composition as a whole;
- fixing one frontend problem while silently violating a previously approved frontend behavior.

Static repository understanding alone cannot reliably detect these failures because the authoritative evidence exists in the rendered browser.

There is also a communication problem.

A human often thinks about a frontend visually:

```text
make this region narrower
move this boundary
give the released space to this region
preserve these regions
keep this scrolling behavior
do not change this layout relationship
```

An LLM normally receives that intent as prose and must translate it into source changes without a reliable shared representation of the rendered interface.

`my-frontend-observer` exists to provide that missing representation.

## Product identity

`my-frontend-observer` is the runtime/browser evidence producer within the broader `my-dev-kit` ecosystem.

Its responsibility is:

```text
running frontend
→ real browser
→ structured runtime evidence
```

It owns evidence about:

- what is actually rendered;
- where rendered regions are;
- how large they are;
- how they relate spatially;
- what is visible or clipped;
- what owns scrolling;
- whether overflow exists;
- what changed between observations;
- whether approved runtime relationships remain valid;
- what visual change the user intends.

It does not own static repository analysis.

The long-term ecosystem responsibility model is:

```text
my-dev-kit
→ static repository/source evidence producer
→ files
→ symbols
→ dependencies
→ architecture
→ probable source ownership
→ bounded source retrieval

my-frontend-observer
→ rendered browser/runtime evidence producer
→ screenshots
→ rendered-region identity
→ geometry
→ layout relationships
→ scrolling and overflow
→ comparisons
→ runtime contracts
→ visual intent

my-dev-kit-orchestrator
→ coordinates development workflows
→ consumes bounded evidence when appropriate
→ prepares task context
→ manages implementation/verification workflow

my-dev-kit-lab
→ evaluates ecosystem behavior
→ compatibility
→ controlled fixtures
→ experiments
→ evidence quality
→ cross-project validation
```

These projects remain separately versioned and independently executable.

Deep ecosystem integration must not require collapsing their responsibilities into one package.

## Product goal

Build `my-frontend-observer`, a local-first frontend observation, visual-communication, and runtime-regression tool that allows humans, LLMs, coding agents, and automated checks to reason from the frontend that the browser actually rendered.

The tool should convert browser state into structured, inspectable evidence combining, as capabilities mature:

- screenshots;
- stable identities for meaningful rendered regions;
- relevant Document Object Model structure;
- rendered element geometry;
- computed browser layout properties;
- viewport information;
- scroll ownership and scroll state;
- visibility and overflow information;
- accessibility and semantic information;
- relationships between important rendered regions;
- before-and-after observations;
- persistent frontend invariants;
- requested-change intent;
- expected dependent changes;
- protected regions and properties;
- structured visual annotations.

The primary goal is not to automatically redesign interfaces.

The primary goal is to give a human and an LLM a shared representation of:

> What is actually on the screen, where it is, how large it is, how it behaves, how its important regions relate to one another, what the user wants changed, what must remain intact, and what actually changed after an implementation edit?

## Three primary product jobs

### 1. Human-to-LLM design and layout communication

The observer should help a user communicate visual and layout intent without requiring the LLM to infer everything from prose or source code.

The system should eventually allow communication through a combination of:

```text
screenshot
+ stable named regions
+ measured geometry
+ layout relationships
+ runtime behavior
+ visual annotation
+ textual intent
```

A user should be able to communicate ideas such as:

```text
make primary navigation narrower
give the released horizontal space to the workspace
preserve both advertising rails
do not clip navigation labels
keep document-level scrolling
leave the footer relationship unchanged
```

without needing to express the implementation mechanism.

### 2. Safe LLM-assisted frontend changes

The observer should make the complete rendered result part of the definition of implementation success.

A requested local change must not be considered successful merely because the requested element changed.

The tool should eventually distinguish:

```text
requested change
expected dependent change
protected change
preserved invariant
unexpected change
```

This creates an explicit allowed scope of frontend change.

Previously approved runtime behavior must remain valid unless the user explicitly supersedes it.

### 3. Runtime evidence for the my-dev-kit ecosystem

The observer should provide the runtime evidence domain that static repository analysis cannot provide.

The intended long-term combination is:

```text
my-dev-kit static evidence
+
my-frontend-observer runtime evidence
        ↓
bounded coordinated context
        ↓
LLM / coding agent
```

A runtime region may eventually be correlated with bounded source evidence without requiring the observer to become a source-analysis engine or requiring `my-dev-kit` to become a browser runner.

## Intended users

Primary users:

- developers using LLMs or coding agents for frontend development;
- developers debugging visual and responsive regressions;
- developers who need to communicate visual layout intent to an LLM;
- developers who need browser-observed evidence before accepting frontend changes;
- maintainers who want machine-readable runtime frontend evidence;
- maintainers of the broader `my-dev-kit` ecosystem.

The initial user is a developer working locally with web applications, LLMs, and coding agents.

## Initial workflow

The first useful workflow is intentionally small:

```text
local web application
→ target URL + viewport + explicit observation targets
→ my-frontend-observer launches Chromium
→ browser renders target
→ observer captures screenshot
→ observer captures structured page evidence
→ observer captures structured target evidence
→ observer writes a versioned local observation artifact
→ command-line result reports completion, warnings, or failure
```

The first version does not need comparison, change contracts, visual annotation, source ownership, or direct integration with other ecosystem projects.

Its purpose is to establish a trustworthy runtime-evidence foundation.

## Intended end-to-end workflow

The long-term workflow is:

```text
local web application
        ↓
my-frontend-observer
        ↓
baseline observation
+ screenshot
+ regions
+ geometry
+ relationships
+ runtime behavior
        ↓
human reviews frontend
        ↓
human requests or visually annotates change
        ↓
requested / dependent / protected change scope
        ↓
bounded runtime evidence
        +
bounded static evidence from my-dev-kit where useful
        ↓
my-dev-kit-orchestrator / developer / LLM
        ↓
coding agent changes target source separately
        ↓
my-frontend-observer captures new state
        ↓
before/after comparison
        ↓
requested changes evaluated
+ dependent changes evaluated
+ protected properties evaluated
+ existing regression contracts rerun
        ↓
PASS
or
actionable evidence identifying what broke
        ↓
human approves new baseline
or requests another iteration
```

The target application remains a separate project throughout this process.

## Principal capability 1 — Browser observation

The tool must observe a locally running web application through a real browser.

Initial browser support should use Chromium through Playwright unless architecture work establishes a materially better supported mechanism.

The initial implementation should accept at minimum:

- target URL;
- viewport width;
- viewport height;
- explicitly configured observation targets;
- output location.

Later configuration may support:

- route collections;
- themes;
- reusable scenarios;
- browser-state setup;
- authentication setup;
- device profiles;
- interaction sequences.

Those later capabilities are not required for the first version.

Browser runtime behavior is authoritative for rendered geometry.

The observer must not infer final layout solely from source styles.

## Principal capability 2 — Screenshot capture

For each observation, capture the rendered page as an image.

The screenshot is evidence associated with the same observation identity as the structured browser measurements.

Screenshots support:

- human review;
- multimodal LLM review;
- annotation;
- before/after inspection;
- regression evidence.

The system should eventually support:

- viewport screenshots;
- full-page screenshots where useful.

Exact initial screenshot behavior and capture-readiness semantics must be defined before implementation.

Pixel-perfect screenshot comparison must not become the only regression mechanism.

Structured browser evidence remains essential.

## Principal capability 3 — Stable rendered-region identity

Meaningful rendered regions need stable logical identities so humans, LLMs, comparisons, annotations, and regression contracts can refer to the same conceptual region over time.

Examples may include:

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

The observer must not assume that every application uses the same regions.

Region identity should support appropriate browser-observable mechanisms such as:

- semantic HTML elements;
- accessibility role;
- accessible name;
- stable `id`;
- stable `data-*` attribute;
- bounded CSS selector fallback;
- text-based selection only where appropriate.

A target may have a stable observer-level identity without having a known source-code component identity.

For example:

```text
runtime target:
primary-navigation
```

does not by itself prove:

```text
source owner:
VerticalNav.tsx
```

Source ownership belongs to the static-analysis integration boundary.

## Principal capability 4 — Rendered layout map

Capture a structured representation of important rendered elements.

For an observed region, useful browser evidence includes:

```text
identifier
selection method
semantic role
tag
accessible name where available
text summary where appropriate

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
z-index where relevant

scroll width
scroll height
client width
client height
scroll top
scroll left
```

The observer should prefer browser-computed values over attempting to infer final geometry from source styling.

Observed dimensions are measurements, not automatically design constants.

For example:

```text
primary-navigation.width = 176
```

means:

```text
the browser rendered the observed region at 176 pixels
```

It does not automatically mean:

```text
navigation must always be exactly 176 pixels wide
```

Responsive layouts must remain possible.

The output must distinguish:

```text
direct browser observation
computed browser property
derived relationship or interpretation
```

## Principal capability 5 — Page-level browser state

Capture page-level evidence such as:

```text
URL
final URL after navigation
document title

viewport width
viewport height
device pixel ratio

document width
document height
document scroll width
document scroll height
document client width
document client height

window scroll X
window scroll Y

horizontal overflow state
vertical overflow state
```

This should make questions such as these answerable from runtime evidence:

- Does the document own vertical scrolling?
- Is a child container actually scrolling instead?
- Is there horizontal document overflow?
- Is the footer below the initial viewport?
- Did the page become taller or wider after a change?
- Did viewport behavior change unexpectedly?

## Principal capability 6 — Runtime scrolling, overflow, and visibility

Scrolling must be treated as runtime behavior rather than inferred solely from style declarations.

The observer should eventually be able to:

1. capture initial scroll state;
2. perform a controlled scroll action;
3. capture resulting scroll state;
4. identify which observed regions changed scroll position;
5. expose evidence about which container appears to own scrolling;
6. identify whether elements enter or leave the viewport;
7. identify horizontal or vertical overflow.

Example direct observation:

```text
before:
window.scrollY = 0
main.scrollTop = 0

after requested page scroll:
window.scrollY = 500
main.scrollTop = 0
```

Possible derived interpretation:

```text
document appears to own primary vertical scrolling
```

The observer must not present the derived statement as if it were a direct browser measurement.

## Principal capability 7 — Layout relationships and dependency relationships

Individual measurements are not enough.

Many design requirements concern relationships between regions.

The observer should support relationship-oriented evidence such as:

```text
navigation is left of workspace
workspace is wider than navigation
navigation does not overlap workspace
workspace does not overlap right advertising rail
footer begins after main content
element is contained inside parent
navigation contents fit inside navigation
document width does not exceed viewport width
```

The system should also leave room for an explicit layout relationship or dependency model.

Example:

```text
Viewport
    ↓
AppShell
    ├── LeftAd
    ├── Navigation
    ├── Workspace
    └── RightAd
```

A requested change may imply legitimate dependent changes.

Example:

```text
Navigation width decreases
        ↓
Workspace width increases
Workspace x-position may move
```

Other properties may need to remain preserved:

```text
LeftAd width
RightAd width
Header height
Footer relationships
```

The system must distinguish observed relationships from causal claims.

It should not automatically claim that one region caused another region to change merely because both changed.

Expected dependency semantics should come from an explicit contract, user intent, or another supported source of evidence.

## Principal capability 8 — Observation artifact

Each capture should produce one cohesive, observer-owned, versioned observation artifact or artifact directory.

The exact schema and filenames must be decided during architecture and schema design.

A conceptual structure may resemble:

```text
observation/
  manifest.json
  page.json
  elements.json
  screenshot.png
```

Possible future additions may include:

```text
relationships.json
interactions.json
comparison.json
contracts.json
annotations.json
summary.txt
```

These names are conceptual rather than fixed requirements.

The public artifact contract should establish from the beginning:

```text
artifact kind
schema version
observation identity
producer version
browser identity
request/configuration identity
provenance
artifact references
completion state
diagnostics
limits
truncation/omission reporting
```

Artifact paths should be relative and portable where possible.

Heavy evidence such as screenshots should be referenced rather than embedded into unrelated structured records.

Consumers must be able to distinguish a completed observation from a partial or failed capture.

The artifact must distinguish:

```text
observed evidence
derived evidence
unavailable evidence
not-applicable evidence
partial evidence
```

The artifact schema should evolve intentionally and additively where compatible.

Package version and artifact schema version must remain separate concepts.

## Principal capability 9 — Before/after comparison

The tool should compare two observations representing comparable logical frontend states.

Useful differences include:

```text
element moved
element resized
element disappeared
element appeared
visibility changed
element became clipped
horizontal overflow appeared
vertical overflow changed
document size changed
scroll-owner evidence changed
relative position changed
layout relationship changed
```

Comparison should produce structured evidence such as:

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
Before: 176
After: 97
Difference: -79
```

The comparison engine should preserve references to before/after screenshots and underlying observations.

The tool should not rely solely on screenshot pixel differences.

Before/after comparison is not part of the first observation version.

The initial observation identity and provenance model must nevertheless preserve enough information to support future comparability decisions.

## Principal capability 10 — Explicit change scope

A central long-term concept is the ability to represent what a requested frontend change is allowed to affect.

A change should be expressible through categories such as:

### Requested changes

Properties or relationships explicitly intended to change.

Example:

```text
primary-navigation.width
→ decrease significantly
```

### Expected dependent changes

Properties expected to change as a legitimate consequence.

Example:

```text
tool-workspace.width
→ increase using released horizontal space

tool-workspace.x
→ may move left
```

### Protected properties or regions

Properties expected to remain unchanged.

Example:

```text
left-ad-rail.width
right-ad-rail.width
header.height
```

### Preserved invariants and behaviors

Previously correct relationships or behaviors that must remain true.

Example:

```text
navigation contents remain unclipped
navigation does not overlap workspace
workspace does not overlap advertising rails
document does not horizontally overflow
document continues to own primary page scrolling
mobile layout remains usable
```

Together, these categories define the allowed scope of rendered change.

This concept may eventually be represented by an explicit `ChangeContract` or equivalent schema.

The conceptual name does not require that exact implementation type.

## Principal capability 11 — Frontend regression and change contracts

The project should support persistent executable runtime invariants.

Examples include:

```text
element is visible
element is not clipped
element width is within a bound
element A does not overlap element B
element A is wider than element B
element A follows element B vertically
document width does not exceed viewport width
window owns requested page scrolling
specified element does not own primary page scrolling
element begins below the initial viewport
```

Relationship-oriented contracts should be preferred when they represent user intent more accurately than fixed pixels.

For example:

Prefer:

```text
workspace width increases when navigation width decreases
```

when that is the actual design requirement.

Use:

```text
navigation.width = 97
```

only when the user truly requires that exact value.

The system should support two related forms of contract:

```text
persistent baseline contracts
```

and:

```text
per-change contracts
```

Persistent baseline contracts preserve approved frontend behavior across future changes.

Per-change contracts describe:

```text
requested changes
expected dependent changes
protected properties
preserved invariants
```

Example evaluation:

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

A frontend change must not be declared successful merely because its requested local mutation succeeded.

## Principal capability 12 — Bounded agent context and static/runtime integration

Structured output must support both programmatic use and LLM consumption.

The tool should eventually produce a bounded runtime-evidence package containing, as applicable:

- target page identity;
- viewport;
- major observed regions;
- region geometry;
- semantic identities;
- layout relationships;
- dependency/change-scope information;
- overflow state;
- scroll evidence;
- comparison results;
- contract results;
- important warnings;
- references to underlying raw evidence.

Preserve the evidence hierarchy:

```text
raw browser evidence
        ↓
normalized structured evidence
        ↓
derived relationships
        ↓
bounded summary/context
        ↓
LLM reasoning
```

The bounded context must not require an LLM to consume:

- an entire raw Document Object Model dump;
- every computed style property;
- enormous accessibility trees;
- repeated unchanged measurements;
- every screenshot produced during a workflow.

The summary must remain traceable to the evidence supporting it.

The initial command-line version may return a concise execution summary.

That operational summary must not be confused with the richer agent-oriented context package described here.

The shortest path to practical coding-agent use combines this bounded runtime
projection with relevant bounded static/source evidence from `my-dev-kit`.
The evidence domains remain separate and traceable:

```text
observer runtime evidence
+
my-dev-kit static evidence
        ↓
bounded agent context
        ↓
external coding agent
```

Runtime/static correlation must be explicit and may be ambiguous. A stable
runtime target identity must never silently become a source-ownership claim.
The observer owns runtime projection and its correlation/export boundary;
`my-dev-kit` owns static indexing and retrieval; the orchestrator coordinates
bounded consumption; the lab owns exact compatibility evaluation.

This integrated, text/config-driven path must support an end-to-end coding-agent
change review before the viewer or visual annotation becomes a prerequisite.
The observer does not edit source: an external coding agent makes the change,
after which the observer rerenders, compares, and evaluates preserved contracts.

## Future capability — Static/runtime source association

The observer should associate runtime regions with bounded static source
evidence from `my-dev-kit` where reliable.

The desired chain is:

```text
rendered region
→ runtime target identity
→ correlation evidence
→ my-dev-kit static node or bounded static evidence
→ relevant source retrieval
```

`my-frontend-observer` must not implement a competing repository-analysis
system. It must not duplicate repository crawling, parsing, indexing, source
graphs, retrieval, architecture inference, or edit-owner analysis. If runtime
evidence cannot prove source ownership, the observer must preserve uncertainty.

The ecosystem integration needed for bounded coding-agent context belongs on
the core path after safe-change contracts and before human-interface work.

## Principal capability 13 — Human visual review

After the text/config-driven coding-agent workflow is proven, the project should
provide a human-readable graphical way to inspect the same canonical evidence.

A later local interface should allow the developer to:

- view the captured screenshot;
- inspect known observed regions;
- see geometry;
- see relevant browser properties;
- inspect relationships;
- inspect comparisons;
- inspect contract results;
- understand warnings and failures.

Selecting a structured region should identify the corresponding screenshot area where practical.

Likewise, selecting a screenshot region should eventually support identifying the corresponding known target.

The viewer must consume the reusable observation engine and artifacts.

It must not contain a second browser-observation implementation.

## Future capability — Human visual annotation

A later phase should allow the user to communicate visual intent directly on top of an observed frontend.

Useful annotation concepts may include:

- freehand drawing;
- rectangle;
- arrow;
- line;
- textual note;
- preserve marker;
- resize marker;
- move marker;
- remove marker;
- inspect marker.

Annotations must remain structured.

Do not store annotation intent only as flattened image pixels.

An annotation should preserve information such as:

```text
observation identity
screenshot identity
annotation geometry
annotation type
textual instruction
associated runtime target where available
```

Example:

```text
annotation
→ primary-navigation
→ resize
→ "make this visually narrower"
```

Another annotation may express:

```text
annotation
→ right-ad-rail
→ preserve
```

The intended LLM-facing package may eventually combine:

```text
original screenshot
+ annotated screenshot
+ structured runtime observations
+ structured annotations
+ current change scope
+ previously approved contracts
```

This allows an LLM to reason simultaneously about:

```text
what exists
```

and:

```text
what the user wants changed
```

## Relationship to `my-dev-kit`

`my-dev-kit` and `my-frontend-observer` are sibling evidence producers.

Conceptually:

```text
my-dev-kit
→ what source exists?
→ how is the repository structured?
→ what symbols and dependencies matter?
→ what source probably owns this behavior?
→ what bounded source should the agent inspect?

my-frontend-observer
→ what did the browser actually render?
→ where are the important regions?
→ how large are they?
→ what relationships exist?
→ what is clipped or overflowing?
→ what owns scrolling?
→ what changed?
```

Neither project should normally import or execute the other merely to perform its native responsibility.

Their evidence may later be correlated by an explicit consumer or integration contract.

## Relationship to `my-dev-kit-orchestrator`

`my-dev-kit-orchestrator` owns workflow coordination rather than runtime observation.

A future integration may allow the orchestrator to consume a bounded projection or reference to observer evidence.

The orchestrator should not:

- own browser automation;
- reproduce observer measurements;
- embed full raw observation artifacts into prompts by default;
- redefine observer evidence semantics;
- become the canonical owner of observer artifacts.

The observer should expose machine-consumable artifacts and a clean programmatic boundary so future orchestrator integration does not require parsing human console output.

No orchestrator runtime dependency is required for the first observer versions.

## Relationship to `my-dev-kit-lab`

`my-dev-kit-lab` should eventually evaluate observer compatibility and ecosystem behavior.

Possible future responsibilities include:

- exact readers for supported observer artifact versions;
- pinned observer fixtures;
- browser/schema compatibility matrices;
- static/runtime correlation experiments;
- evidence-quality evaluation;
- controlled compatibility tests across ecosystem projects.

The lab must not become the observer's production runtime.

Normal frontend observation should not require the lab.

## Ecosystem integration principle

Deep integration means:

```text
shared contracts
+ explicit evidence boundaries
+ compatible identities
+ exact readers/adapters
+ coordinated workflows
```

It does not mean:

```text
one package
one runtime
one schema for everything
or duplicated responsibilities
```

Do not introduce a shared cross-repository schema package merely for symmetry.

A shared package should exist only if a future concrete integration demonstrates that it is necessary.

## Local-first requirement

The tool should be local-first.

The normal initial workflow should operate against applications running on:

```text
localhost
127.0.0.1
local development hosts
```

Observation must not require uploading:

- screenshots;
- page contents;
- source code;
- observation artifacts;
- visual annotations.

No external artificial-intelligence API is required for the core observer.

An LLM consuming generated evidence may operate separately from the observer.

## Browser and network safety

Running a browser introduces a security and privacy boundary that must be defined explicitly.

Before broad navigation support is implemented, the project must define behavior for matters such as:

- allowed URL schemes;
- local versus remote targets;
- redirects;
- navigation timeouts;
- certificate failures;
- downloads;
- popups;
- browser permissions;
- network requests;
- unexpected navigation;
- credential-bearing pages;
- sensitive content captured into artifacts;
- secret-bearing URLs or output;
- cleanup of browser processes and temporary state.

The first version should remain intentionally conservative and local.

Safety behavior must be explicit rather than dependent on undocumented browser defaults.

## Target immutability

Observation is non-destructive by default.

The observer must not:

- edit the target application's files;
- modify target source code;
- commit target changes;
- install dependencies into the target;
- alter target configuration;
- persist unintended application state;
- perform destructive interactions merely to collect layout evidence.

The observed project is a target, not part of the observer repository.

Interactions such as:

- navigation;
- viewport resize;
- scrolling;
- explicitly approved safe controls;

are acceptable when they are part of a defined observation scenario.

A coding agent or another external tool performs source changes.

## Preferred platform

Primary development platform:

- desktop developer workstation;
- Windows first-class.

The implementation must avoid unnecessary Windows-specific assumptions.

Artifact paths, serialization, tests, and browser behavior should be designed so future ecosystem releases can satisfy the cross-platform validation expectations used by the broader `my-dev-kit` ecosystem.

Cross-platform screenshot byte identity should not be assumed unless explicitly established by testing.

Structured semantic evidence should remain the primary portable contract.

## Preferred implementation stack

Preferred language:

TypeScript.

Preferred runtime:

Node.js.

Preferred browser automation:

Playwright.

Initial public interface:

command-line interface (CLI).

The first scaffold should favor a TypeScript/Node.js command-line project rather than a web-application-first architecture.

The browser-observation engine must remain independent of command-line formatting so it can later support:

- command-line use;
- programmatic use;
- graphical local viewing;
- automated regression workflows;
- ecosystem adapters.

A later interactive viewer may use React or another suitable web user-interface stack.

Do not put Playwright/browser-control logic directly inside React presentation components.

Do not promise a stable public programmatic application programming interface merely because internal modules are reusable.

A public programmatic interface should become a compatibility commitment only when explicitly designed and tested.

## Architectural direction

Use explicit ownership boundaries.

The smallest expected conceptual separation is:

```text
command-line interface
        ↓
observation application/engine
        ↓
browser adapter
        ↓
runtime evidence

observation domain/schema
        ↓
artifact writer

deterministic fixture infrastructure
        ↓
browser-level validation
```

As later capabilities arrive, the architecture may add:

```text
relationship engine
comparison engine
contract engine
bounded agent-context and correlation/export boundary
coding-agent review workflow
viewer
annotation system
```

These should extend the existing evidence model rather than creating parallel implementations.

Avoid speculative abstraction.

Do not create:

- a generic plugin framework without multiple real implementations;
- a second observation engine for the viewer;
- a second comparison implementation for the user interface;
- a second contract engine for automated tests;
- a generic ecosystem evidence framework before concrete integration requires one.

## Initial product interface

The initial public interface is CLI-first.

The developer should be able to provide:

```text
target URL
viewport
observation targets
output location
```

and receive:

```text
screenshot
structured page observation
structured target observations
versioned observation artifact
concise execution/result summary
```

The CLI should be suitable for both human and machine invocation.

Its architecture should leave room for:

- machine-readable output;
- stable diagnostic codes;
- explicit exit behavior;
- separation between parseable output and human progress/diagnostics.

The CLI must not own browser logic directly.

The bounded agent context, static/runtime integration, and text-driven
coding-agent review belong to the core path after comparison/contracts. The
graphical viewer and annotation system follow as human-interface enhancements.

## Evidence boundedness

The observer must avoid collecting enormous amounts of runtime information merely because the browser exposes it.

Initial observation should be explicitly scoped.

Prefer:

```text
explicit observation targets
+ required page facts
+ required target facts
```

over:

```text
entire DOM
+ every style property
+ complete accessibility tree
```

Where evidence is bounded or truncated, the result should make the omission visible.

A bounded collection should expose enough information to distinguish:

```text
nothing existed
```

from:

```text
evidence existed but was omitted because of a limit
```

Required evidence adequacy must not mean merely that some evidence was captured.

If required configured evidence is missing, partial, or unavailable, the observer must say so.

## Evidence provenance

Runtime evidence should remain traceable to its source.

Observation artifacts should record appropriate provenance such as:

- observer package version;
- artifact schema version;
- browser engine;
- browser version;
- target URL;
- final URL;
- viewport;
- observation configuration;
- target identity and locator;
- observation method;
- artifact references;
- diagnostics;
- limits and omissions;
- capture identity;
- derivation method for derived facts.

Naturally unstable metadata such as capture time should not become the only logical identity of an observation.

## Diagnostic behavior

Observation failure and partial evidence must be explainable.

The project should establish stable machine-readable diagnostics for cases such as:

- invalid request;
- unsupported configuration;
- navigation failure;
- missing target;
- ambiguous target;
- hidden target;
- unavailable browser evidence;
- bounded/truncated evidence;
- artifact write failure;
- browser failure.

Do not silently select an arbitrary target when selection is ambiguous.

Do not represent unavailable evidence as a normal false or zero value.

Warnings, partial observations, invalid requests, and fatal failures must remain distinguishable.

## Testing expectations

Testing is a core requirement.

The project should progressively include:

```text
unit tests
→ schema/serialization tests
→ browser adapter integration tests
→ deterministic browser fixture tests
→ comparison tests
→ contract tests
→ bounded agent-context and correlation tests
→ ecosystem compatibility fixtures
→ text-driven coding-agent workflow tests
→ viewer tests
→ annotation tests
→ full visual workflow tests
```

Important deterministic fixture scenarios should eventually include:

- normal desktop layout;
- narrow navigation;
- clipped navigation contents;
- horizontal page overflow;
- nested scrolling;
- document scrolling;
- footer after workspace;
- overlapping regions;
- mobile layout;
- hidden elements;
- expected dependent resizing;
- protected-region regression.

The first version should use controlled local fixture pages rather than depending on public internet pages for canonical test evidence.

Tests must distinguish:

```text
direct browser observation
derived interpretation
```

Screenshot evidence should not be treated as the only source of truth.

Cross-platform tests should distinguish semantic/layout evidence from rendering differences that may legitimately vary by operating system, browser build, fonts, or graphics environment.

## Validation expectations

The project should maintain a trustworthy validation chain appropriate to its current capabilities.

At minimum, once established:

```text
typecheck
lint
unit/integration tests
browser fixture tests
production build when a graphical interface exists
documentation checks when implemented
```

Browser-related functionality must always have browser-level evidence.

Passing static TypeScript validation alone is not sufficient for a browser-observation feature.

Later ecosystem releases should also satisfy the coordinated compatibility and cross-platform validation expectations of the `my-dev-kit` ecosystem.

## Performance expectations

The tool is a developer utility.

Correctness, boundedness, determinism, and inspectability are more important than extreme runtime optimization.

However:

- do not capture the entire Document Object Model when targeted evidence is sufficient;
- do not emit enormous computed-style dumps;
- do not take unnecessary screenshots;
- do not keep browser processes alive indefinitely;
- make observation scope explicit;
- preserve evidence needed to explain conclusions;
- avoid duplicating unchanged evidence unnecessarily.

## Accessibility evidence

Where the browser exposes it reliably, capture useful semantic/accessibility information such as:

- role;
- accessible name;
- landmark identity;
- relevant state.

This can help a human or LLM identify regions more reliably than position alone.

The project is not initially intended to replace a dedicated accessibility-audit product.

## Inspectability

Observation and regression results must be explainable.

A useful result should identify:

```text
what was observed
where it was observed
what changed
before value
after value
expected condition
actual condition
contract or relationship involved
supporting artifact
supporting screenshot
```

Avoid unexplained scores.

Avoid opaque artificial-intelligence classification in the core validation path.

An LLM may reason over the evidence, but the evidence producer itself should remain inspectable.

## Determinism

Given:

- the same target build;
- the same browser version;
- the same viewport;
- the same observation configuration;
- the same deterministic fixture state;

the structured observation should be stable enough for meaningful comparison.

Fields that are naturally unstable must either:

- be normalized;
- be excluded from logical comparison;
- or be explicitly identified as unstable metadata.

Deterministic target ordering, diagnostic ordering, serialization, and artifact references should be preferred where practical.

## Non-goals for the initial project

The initial project is not:

- a replacement for browser developer tools;
- a replacement for Playwright;
- a replacement for `my-dev-kit`;
- a replacement for `my-dev-kit-orchestrator`;
- a replacement for `my-dev-kit-lab`;
- an autonomous frontend designer;
- an autonomous coding agent;
- a visual website builder;
- a hosted screenshot service;
- a cloud browser farm;
- a full accessibility scanner;
- a complete cross-browser testing service;
- a pixel-perfect visual-diff-only system;
- a source-code editor;
- a deployment system.

The initial project does not need:

- authentication;
- payments;
- advertising;
- multi-user collaboration;
- cloud persistence;
- remote browser infrastructure;
- external LLM APIs;
- production hosting;
- Firefox or WebKit support;
- source ownership;
- static repository indexing;
- orchestrator integration;
- lab integration;
- visual annotation;
- comparison;
- regression contracts.

Those capabilities may appear later according to Project Milestones and `ROADMAP.md`.

## Explicit product principles

1. Observe before inferring.
2. Browser runtime is authoritative for rendered geometry.
3. Source code and rendered output are different evidence domains.
4. `my-dev-kit` owns static repository/source evidence; `my-frontend-observer` owns runtime browser evidence.
5. Stable runtime-region identity does not automatically imply known source ownership.
6. Observed dimensions are measurements, not automatically fixed design constants.
7. Prefer relationship-based layout requirements when they better represent user intent.
8. Distinguish direct browser facts from derived interpretations.
9. Preserve raw evidence behind normalized and summarized evidence.
10. Keep evidence bounded and make omissions explicit.
11. Never represent unavailable evidence as if it were an observed false or zero.
12. Never claim a visual requirement passed solely because a styling declaration looks correct.
13. A requested change may legitimately cause dependent changes.
14. Distinguish requested changes, expected dependent changes, protected properties, preserved invariants, and unexpected changes.
15. A local requested change does not authorize unrelated rendered changes.
16. Previously approved frontend invariants remain active unless the user explicitly supersedes them.
17. Make regressions explainable.
18. Keep observation non-destructive.
19. Keep artifacts local-first, versioned, portable, and inspectable.
20. Separate browser observation from static source analysis.
21. Separate evidence production from workflow orchestration and downstream evaluation.
22. Human visual intent must eventually be representable alongside machine measurements.
23. Deep ecosystem integration should use explicit contracts and adapters rather than duplicated responsibilities.
24. Do not introduce speculative cross-project coupling before a real consumer requires it.

## Documentation and planning principles

Documentation must distinguish current implemented behavior from future intended behavior.

Current-state documentation should accurately record what exists.

Forward-looking planning documents should preserve enough local design context for future LLM planning without requiring critical intent to be reconstructed from many unrelated bookkeeping documents.

In particular:

```text
Project Description
→ durable product intent
→ responsibility boundaries
→ long-term capability model

Project Milestones
→ ordered capability development
→ major requirements
→ acceptance expectations
→ cross-milestone invariants

ROADMAP.md
→ high-level version specifications
→ version goals
→ required capabilities
→ architectural constraints
→ dependencies
→ exclusions
→ acceptance expectations
```

`ROADMAP.md` must not predefine implementation batches.

When implementation of a roadmap version begins, the planner should:

```text
read the roadmap version
→ inspect current repository state
→ obtain required architecture/retrieval evidence
→ design the implementation steps
→ divide those steps into appropriate implementation batches
→ execute and validate those batches
```

Forward-looking requirements may intentionally appear in more than one planning document when doing so prevents future planning context from becoming fragmented.

## Long-term product direction

The long-term goal is to create a reliable communication and validation bridge between:

```text
human visual intent
rendered frontend reality
static repository evidence
LLM reasoning
coding-agent implementation
```

The critical path must first prove:

```text
render and observe
→ identify stable regions and runtime behavior
→ compare
→ enforce requested/dependent/protected/preserved scope
→ combine bounded runtime and static evidence
→ provide context to an external coding agent
→ rerender and reject regressions
```

Only after that core workflow works should the human visual branch add:

```text
viewer
→ structured annotation
→ full visual human–LLM workflow
```

The desired eventual visual cycle is:

```text
render
→ observe
→ identify stable regions
→ measure geometry and behavior
→ show human
→ annotate/request change
→ define requested/dependent/protected scope
→ combine bounded runtime and static evidence
→ provide context to LLM
→ coding agent implements
→ rerender
→ compare
→ rerun preserved contracts
→ identify unexpected changes
→ approve or correct
→ establish new baseline
→ repeat
```

The project succeeds when an LLM no longer needs to guess what a frontend looks like from source code alone, when a human can communicate visual intent without translating every design idea into implementation terminology, and when a frontend change cannot be considered successful while silently breaking previously approved rendered behavior.
