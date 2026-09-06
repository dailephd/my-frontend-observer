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

A related failure occurs when the desired design already exists as an external visual reference. A user may have an approved PNG, WebP, screenshot, rendered mockup, or other image showing what the interface should look like, while the current application looks substantially different. Giving that image directly to a coding agent still leaves the agent to guess dimensions, spacing, region boundaries, relationships, state/theme applicability, style details, and which visual differences are actually requirements. Source/unit tests can pass while the result remains visibly far from the approved design.

The system therefore needs to represent both:

```text
what the browser actually rendered
```

and, when supplied:

```text
what an approved external visual reference specifies
```

without pretending that an external raster image is an earlier runtime observation or source-code artifact.

`my-frontend-observer` exists to provide that missing representation.

## Product identity

`my-frontend-observer` is the runtime/browser evidence producer within the broader `my-dev-kit` ecosystem.

Its responsibility is:

```text
running frontend
→ real browser
→ structured runtime evidence
```

It also owns the structured evidence boundary for approved external visual references used to describe desired design intent. That reference evidence remains distinct from browser runtime evidence while being comparable to a rendered candidate through explicit bindings and evaluation.

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
- what visual change the user intends;
- what an approved external visual reference specifies where one is supplied;
- which reference regions correspond to runtime targets where that binding is reliable;
- how a rendered candidate differs from explicit reference-design requirements.

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
→ external visual-reference evidence
→ reference/runtime binding
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

Build `my-frontend-observer`, a local-first frontend observation, visual-communication, and runtime-regression tool that allows humans, LLMs, coding agents, and automated checks to reason from the frontend that the browser actually rendered and, when present, from an approved external visual reference describing the intended design.

The tool should convert browser state and explicitly supplied design-reference evidence into structured, inspectable evidence combining, as capabilities mature:

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
- approved external visual references;
- stable identities for meaningful reference regions;
- reference geometry, relationships, applicability, tolerances, and provenance;
- explicit reference-region to runtime-target bindings;
- structured reference-design versus candidate evidence;
- structured visual annotations.

The primary goal is not to automatically redesign interfaces.

The primary goal is to give a human and an LLM a shared representation of:

> What is actually on the screen, where it is, how large it is, how it behaves, how its important regions relate to one another, what the user wants changed or wants matched from an approved reference, what must remain intact, and what actually changed after an implementation edit?

## Three primary product jobs

### 1. Human-to-LLM design and layout communication

The observer should help a user communicate visual and layout intent without requiring the LLM to infer everything from prose or source code.

The system should eventually allow communication through a combination of:

```text
runtime screenshot or approved external reference
+ stable named regions
+ measured or authored geometry
+ layout relationships
+ runtime behavior where applicable
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

or:

```text
make this popup match the approved One Dark reference
match this card's width and horizontal position
preserve these button proportions and spacing
use this approved artwork rather than redesigning it
this footer placement is informational, not an exact requirement
```

without needing to express the implementation mechanism.

An external reference is desired-design evidence, not implementation. A raster image does not reveal original DOM structure, CSS, vector paths, component hierarchy, source ownership, hidden layout constraints, or design-token names unless those are separately supplied. The observer must preserve that distinction rather than fabricating hidden structure.

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

An external reference-fidelity success must obey the same rule. Matching a supplied design region does not authorize breaking a protected control, preserved relationship, baseline invariant, or unrelated application behavior.

### 3. Runtime evidence for the my-dev-kit ecosystem

The observer should provide the runtime evidence domain that static repository analysis cannot provide.

The intended long-term combination is:

```text
my-dev-kit static evidence
+
my-frontend-observer runtime evidence
+
my-frontend-observer reference evidence where applicable
        ↓
bounded coordinated context
        ↓
LLM / coding agent
```

A runtime region may eventually be correlated with bounded source evidence without requiring the observer to become a source-analysis engine or requiring `my-dev-kit` to become a browser runner. Likewise, a reference region may bind to a runtime target without implying source ownership.

## Intended users

Primary users:

- developers using LLMs or coding agents for frontend development;
- developers debugging visual and responsive regressions;
- developers who need to communicate visual layout intent to an LLM;
- developers who need to reproduce or validate an approved external visual design reference;
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

The first version does not need comparison, change contracts, visual annotation, source ownership, external visual-reference evaluation, or direct integration with other ecosystem projects.

Its purpose is to establish a trustworthy runtime-evidence foundation.

## Intended end-to-end workflow

The long-term workflow supports two human intent entry modes.

Actual-frontend-driven:

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
```

Reference-driven:

```text
approved external visual reference
+ current browser-rendered candidate
        ↓
reference identity, regions, relationships, applicability, and intent
        ↓
explicit reference-region ↔ runtime-target binding
        ↓
structured reference-vs-candidate evidence
        ↓
human confirms which reference details are requirements
```

Both then converge on:

```text
requested / dependent / protected / preserved change scope
        ↓
bounded runtime evidence
+ relevant reference evidence where applicable
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
+ reference-vs-candidate evaluation where applicable
        ↓
requested changes evaluated
+ dependent changes evaluated
+ protected properties evaluated
+ existing regression contracts rerun
+ reference requirements evaluated
        ↓
PASS
or
actionable evidence identifying what broke or still differs
        ↓
human approves new baseline/reference state
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
- reference/candidate inspection;
- regression evidence.

The system should eventually support:

- viewport screenshots;
- full-page screenshots where useful.

Exact initial screenshot behavior and capture-readiness semantics must be defined before implementation.

Pixel-perfect screenshot comparison must not become the only regression mechanism or the only reference-fidelity mechanism.

Structured browser evidence remains essential.

## Principal capability 3 — Stable rendered-region identity

Meaningful rendered regions need stable logical identities so humans, LLMs, comparisons, annotations, regression contracts, and reference bindings can refer to the same conceptual runtime region over time.

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

A reference region likewise has a separate reference identity. The released
v0.7 binding model keeps:

```text
reference region:
primary-navigation-reference

runtime target:
primary-navigation
```

as two explicit identity domains rather than collapsing them into one.

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

Reference-driven evaluation uses explicit caller-supplied state/applicability
identity so the observer does not compare the wrong theme, viewport,
authentication state, or application state as though it were the intended
reference state.

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

Expected dependency semantics should come from an explicit contract, user intent, approved reference intent, or another supported source of evidence.

Reference regions reuse the canonical relationship vocabulary when the same
geometric relation applies, while preserving the fact that reference
relationships are derived from explicit reference-image geometry rather than
browser-observed DOM/runtime facts.

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

Package version and observation schema version must remain separate concepts.

The v0.7 `ExternalReferenceArtifact` is a separate evidence family. It does
not masquerade as an observation merely to reuse an existing serializer.

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

Before/after comparison remains conceptually distinct from reference-design
versus candidate evaluation. An external desired-state image is not an earlier
runtime state.

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

Reference-derived executable intent maps into this same change-scope model. A
visible detail in a reference may remain informational or unassessed until
explicitly promoted into requested, expected-dependent, protected, or
preserved intent. There is no separate reference-only change taxonomy.

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
element begins below initial viewport
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

Reference fidelity supplements these contracts. It does not replace or weaken
them, and a fidelity pass cannot override a protected or preserved contract
failure.

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

When an external reference is active, the released v0.7 extension adds only
task-relevant reference identity, selected design requirements, measurable
candidate mismatches, bound runtime targets, protected/preserved context, and
references to heavy image assets. It does not place the full reference artifact
or every image difference into the agent packet by default.

Runtime/static correlation must be explicit and may be ambiguous. A stable
runtime target identity must never silently become a source-ownership claim.
The observer owns runtime projection and its correlation/export boundary;
`my-dev-kit` owns static indexing and retrieval; the orchestrator coordinates
bounded consumption; the lab owns exact compatibility evaluation.

This integrated, text/config-driven path supports an end-to-end coding-agent
change review before the viewer or visual annotation becomes a prerequisite.
The observer does not edit source: an external coding agent makes the change,
after which the observer rerenders, compares, and evaluates preserved contracts
and, where applicable, reference fidelity.

## Implemented capability (v0.7) — External visual reference and reference-driven design evidence

v0.7 supports approved external visual references as a structured desired-design evidence domain.

The public `import-reference` command accepts PNG, JPEG, and WebP images. Format
and dimensions are detected from bounded header bytes rather than trusted from a
filename extension, and the implementation enforces bounded file-size and image-
dimension limits. No OCR, image segmentation, computer-vision target discovery,
or raster-to-code reconstruction is part of this capability.

A raw reference image is evidence, not implementation. It does not reveal hidden DOM structure, source ownership, original CSS, component hierarchy, design tokens, original vector paths, or inaccessible font metadata.

The `ExternalReferenceArtifact` and its derived evaluation path preserve enough
structured information to answer:

```text
which exact reference image/version was used?
which regions were defined?
which requirements were explicitly authored?
which relationships were derived?
which candidate observation was evaluated?
which viewport/theme/application state applies?
which tolerance/evaluation policy was used?
which approval or supersession decision applies?
```

### Reference-region model

v0.7 reference regions are explicit, bounded semantic rectangles authored by a
user or configuration. Each region has a stable `id` and a canonical
`{x, y, width, height}` rectangle in reference-image pixels with origin at the
image's top-left corner. `right`, `bottom`, `centerX`, and `centerY` are derived
on demand from that canonical rectangle and are not redundantly persisted.
There is no automatic segmentation and no normalized-coordinate region model in
v0.7.

Reference regions reuse the same geometry-only relationship predicates used by
runtime layout relationships where the concept is genuinely shared, including
horizontal/vertical order, overlap, relative width, geometric fit, and vertical
sequencing. Reference relationships are derived on demand and do not become
requirements automatically.

### Reference-design intent and tolerances

Not every visible pixel is a requirement.

Reference evidence distinguishes:

```text
visible/derived evidence
explicit authored requirement
informational/unassessed detail
```

Executable reference requirements reuse the canonical v0.5 authored categories:

```text
requested
expected-dependent
protected
preserved
```

`unexpected` remains derived-only.

v0.7 supports selected requirement subjects over region properties,
region-to-region relationships, and bounded two-region measurements. Numeric
reference tolerances are explicitly reference-owned and use:

- `exact`;
- `absolute-reference-px`;
- `percent`.

Reference-image coordinates and tolerances are not silently treated as CSS
pixels. Fidelity establishes an explicit full-frame reference-image-pixel to
CSS-pixel scale from the reference image dimensions and declared applicable
runtime viewport, with an independent aspect-ratio-coherence gate.

Selected color/style evidence, asset-similarity evidence, or image-region
similarity are not v0.7 success mechanisms. They may be added later only as
bounded supplemental evidence and must not replace structured geometry,
relationships, applicability, or canonical contract evaluation.

### Reference applicability and comparability

Reference and candidate must represent compatible intended states before ordinary fidelity differences are evaluated.

v0.7 supports explicit caller-supplied applicability dimensions for:

```text
viewport
theme
application state
authenticated state
```

The corresponding candidate state is likewise caller/configuration supplied on
observation. It is not inferred from screenshot pixels, DOM, CSS, URL, or source
code.

For example:

```text
reference: One Dark / active crawl
candidate: One Light / idle
```

produces an explicit incompatible/incomparable result rather than a meaningless visual-difference list when those dimensions are declared and conflict.

The compatibility implementation reuses the existing v0.4 comparability result
and per-dimension comparison conventions rather than creating an unrelated
reference-only state system.

### Reference-to-runtime binding

The system uses an explicit association between:

```text
reference region
```

and:

```text
runtime target
```

Binding declarations are caller/configuration supplied and are never inferred
from geometry, matching names, or source code. Binding results use the closed
states:

```text
bound
ambiguous
unavailable
```

Reference identity, runtime identity, and source identity remain separate domains.

### Structured reference-vs-candidate evaluation

v0.7 combines selected reference requirements with browser-authoritative
candidate evidence and produces bounded, actionable structured fidelity results.
Evaluation proceeds through reference structural validation, reference-evidence
adequacy, reference/candidate compatibility, explicit binding, then each
selected requirement. An inadequate reference or incompatible candidate is
`not-evaluated`; it is not fabricated into an ordinary visual failure.

Example evidence remains of the form:

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

Pixel or image similarity is not the success mechanism in v0.7.

### Reference lifecycle and approval

A random supplied image never silently becomes a project baseline or active design authority.

The v0.7 persisted lifecycle has exactly two explicit states:

```text
imported
→ approved
```

`import-reference` creates a new imported artifact. `approve-reference` is the
only explicit approval act and creates a new approved artifact instance while
preserving the imported artifact unchanged. Supersession is represented by a
forward pointer on the newer artifact and never rewrites the superseded
artifact. There is no automatic measured, annotated, active, or auto-approved
lifecycle state in v0.7.

Reference approval is separate from baseline approval. Reference supersession is separate from baseline supersession. A fidelity `PASS` does not approve either one automatically.

### Multiple references

The model permits separately identified references for explicit states such as:

```text
dark theme / idle
dark theme / active
dark theme / error
light theme / idle
light theme / active
light theme / error
desktop
mobile
```

The correct reference must be selected by explicit identity/applicability rules rather than by accidental filename matching.

### Asset fidelity

A reference region may represent artwork or another asset-sensitive area.

The observer can currently preserve the reference image and structured region
geometry but does not claim to recover vector paths or hidden source data from a
raster reference. Raster-to-vector reconstruction and image-to-code generation
remain external implementation concerns. Bounded asset/image-similarity evidence
would be a later extension, not a current v0.7 contract.

### Coding-agent correction packet

The v0.7 bounded agent context reports measurable reference/candidate mismatches
rather than asking the coding agent to reinterpret the entire image each
iteration. It carries relevant failed requirements, bound runtime targets,
active protected/preserved context, provenance, adequacy/omission/truncation,
and bounded static/source correlation when supplied by the caller.

The implemented correction loop is:

```text
approved external reference
→ structured reference evidence
→ current candidate observation
→ structured fidelity mismatch
→ bounded runtime/static context
→ external coding agent correction
→ real Chromium rerender
→ reevaluate reference fidelity
+ canonical before/after comparison
+ canonical baseline/per-change contract evaluation
→ PASS or actionable failure
```

Matching the reference is necessary but never sufficient: an active protected or
preserved contract regression still makes the overall correction review fail.
The observer never edits target source; the implementation actor remains external.

The viewer and annotation systems later consume this reference model. They must not create another one.

## Implemented foundation (v0.6) — Static/runtime source association

The observer provides an explicit programmatic runtime/static correlation
boundary for associating stable runtime targets with caller-supplied bounded
static candidates where reliable.

The chain is:

```text
rendered region
→ runtime target identity
→ correlation evidence
→ my-dev-kit static identity / bounded evidence
→ relevant source retrieval
```

Correlation results preserve `correlated`, `ambiguous`, or `unavailable`
outcomes and competing candidates. The observer does not implement a competing
repository-analysis system and does not silently turn a runtime target into a
source owner. `my-dev-kit` remains the owner of repository crawling, parsing,
indexing, source graphs, architecture, and bounded retrieval. The observer
package has no runtime dependency on `@dailephd/my-dev-kit`; static candidate
evidence is supplied through the explicit boundary.

## Principal capability 13 — Human visual review

After the text/config-driven coding-agent workflow and non-graphical external-reference evidence foundation are proven, the project should provide a human-readable graphical way to inspect the same canonical evidence.

A later local interface should allow the developer to:

- view the captured screenshot;
- view an approved external reference beside the candidate where applicable;
- inspect known observed regions;
- inspect known reference regions and their runtime bindings;
- see geometry;
- see relevant browser properties;
- inspect relationships;
- inspect before/after comparisons;
- inspect reference/candidate fidelity evidence;
- inspect contract results;
- understand warnings and failures.

Selecting a structured runtime or reference region should identify the corresponding screenshot/reference area where practical.

Likewise, selecting an image region should eventually support identifying the corresponding known runtime target or reference region when evidence is sufficient.

The viewer must consume the reusable observation, reference, comparison, contract, correlation, and bounded-context engines/artifacts.

It must not contain a second browser-observation implementation, a second reference model, a second binding engine, a second reference-evaluation implementation, a second contract engine, or a second bounded-context builder.

## Future capability — Human visual annotation

A later phase should allow the user to communicate visual intent directly on top of either an observed frontend or an approved external reference.

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
annotation source context: runtime observation or external reference
observation/screenshot identity or reference identity
annotation geometry
annotation type
textual instruction
associated runtime target/reference region where available
provenance and confirmation state
```

Example:

```text
annotation
→ runtime target primary-navigation
→ resize
→ "make this visually narrower"
```

Another annotation may express:

```text
annotation
→ reference region current-page-card
→ "match this width and horizontal position"
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
+ approved reference image where applicable
+ annotated screenshot/reference
+ structured runtime observations
+ structured reference evidence
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
what the user wants changed or matched
```

Runtime-screenshot annotations and reference-image annotations remain different coordinate/identity domains. Ambiguous drawings must not silently become executable requirements.

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
→ what approved external reference should this candidate match?
→ where does the candidate differ from that explicit reference intent?
```

Neither project should normally import or execute the other merely to perform its native responsibility.

Their evidence may be correlated by an explicit consumer or integration contract.

## Relationship to `my-dev-kit-orchestrator`

`my-dev-kit-orchestrator` owns workflow coordination rather than runtime observation or reference interpretation.

The observer's v0.6/v0.7 public programmatic boundaries already expose bounded
runtime, correlation, fidelity, and correction-handoff evidence suitable for an
external orchestrator or coding-agent workflow. Orchestrator-side integration
remains a sibling-repository responsibility rather than code owned by this
repository.

The orchestrator should not:

- own browser automation;
- reproduce observer measurements;
- create its own external-reference schema;
- recompute reference/candidate fidelity;
- embed full raw observation/reference artifacts into prompts by default;
- redefine observer evidence semantics;
- become the canonical owner of observer artifacts.

The observer exposes machine-consumable artifacts and a clean programmatic boundary so orchestrator integration does not require parsing human console output.

## Relationship to `my-dev-kit-lab`

`my-dev-kit-lab` should evaluate observer compatibility and ecosystem behavior when coordinated validation requires it.

Possible responsibilities include:

- exact readers for supported observer artifact versions;
- pinned observer fixtures;
- browser/schema compatibility matrices;
- static/runtime correlation experiments;
- external-reference fixture and reader compatibility where required;
- reference/candidate evidence-quality evaluation where required;
- evidence-quality evaluation;
- controlled compatibility tests across ecosystem projects.

The lab must not become the observer's production runtime or reference-evaluation engine.

Normal frontend observation and normal reference-driven correction should not require the lab.

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

Observation and reference-driven evaluation must not require uploading:

- screenshots;
- external reference images;
- page contents;
- source code;
- observation artifacts;
- reference artifacts;
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
- sensitive rendered data;
- secret-bearing URLs or output;
- cleanup of browser processes and temporary state.

The first version should remain intentionally conservative and local.

Safety behavior must be explicit rather than dependent on undocumented browser defaults.

External-reference support has a separate local-file privacy boundary. v0.7
detects PNG/JPEG/WebP from header bytes, reads dimensions from bounded header
bytes without decoding pixels, enforces file-size/dimension bounds, keeps
operational paths out of semantic identity, and treats reference files as data,
not executable instructions.

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

Importing or evaluating an external reference does not authorize observer source edits or changes to the target application.

## Preferred platform

Primary development platform:

- desktop developer workstation;
- Windows first-class.

The implementation must avoid unnecessary Windows-specific assumptions.

Artifact paths, serialization, tests, and browser behavior should be designed so future ecosystem releases can satisfy the cross-platform validation expectations used by the broader `my-dev-kit` ecosystem.

Cross-platform screenshot byte identity should not be assumed unless explicitly established by testing.

Structured semantic evidence should remain the primary portable contract.

The same caution applies to reference/candidate image similarity: font rasterization, graphics environment, antialiasing, and browser/OS differences must not be treated as exact semantic equality unless explicitly proven.

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

Do not put canonical reference-evaluation logic directly inside viewer presentation components either.

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

The architecture has added, and later capabilities may continue to add:

```text
relationship engine
comparison engine
contract engine
bounded agent-context and correlation/export boundary
coding-agent review workflow
external visual-reference artifact/identity boundary
reference-to-runtime binding
reference/candidate structured evaluation
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
- a viewer-only reference model or reference-evaluation engine;
- annotation-only change semantics;
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

The bounded agent context, static/runtime integration, text-driven coding-agent review, and non-graphical external-reference evidence foundation are on the core path after comparison/contracts. The graphical viewer and annotation system follow as human-interface enhancements.

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

The same rule applies to references. Do not send every region, pixel delta, style sample, or image byte to a coding agent when only a bounded subset is relevant to the requested correction. Reference artifacts and bounded fidelity context expose omission/truncation where limits matter.

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

Reference evidence likewise preserves, as applicable:

- exact reference identity/version;
- image reference and format/dimensions;
- region identity and coordinate semantics;
- authored requirements versus derived relationships;
- applicability state;
- approval/supersession state;
- binding evidence;
- tolerance/evaluation policy;
- candidate observation identity;
- diagnostics, limits, and omissions.

Naturally unstable metadata such as capture time should not become the only logical identity of an observation or reference.

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

Current reference support likewise makes malformed/unsupported reference data,
ambiguous/unavailable reference-to-runtime binding, incompatible
reference/candidate state, unavailable candidate evidence, and bounded fidelity
omissions explicit rather than fabricating normal values.

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
→ external-reference artifact/identity/binding tests
→ reference applicability and structured fidelity tests
→ reference-driven coding-agent correction tests
→ viewer tests
→ annotation tests for runtime and reference contexts
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
- protected-region regression;
- external reference whose candidate has measurable geometry/spacing mismatch;
- external reference with wrong theme/application-state candidate producing incompatibility;
- asset-sensitive reference region;
- reference-fidelity success coexisting with a protected-contract failure.

The first version should use controlled local fixture pages rather than depending on public internet pages for canonical test evidence.

Tests must distinguish:

```text
direct browser observation
derived interpretation
authored reference requirement
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

Passing static TypeScript validation alone is not sufficient for a browser-observation feature or a reference-driven workflow whose candidate side is browser-rendered.

Later ecosystem releases should also satisfy the coordinated compatibility and cross-platform validation expectations of the `my-dev-kit` ecosystem.

## Performance expectations

The tool is a developer utility.

Correctness, boundedness, determinism, and inspectability are more important than extreme runtime optimization.

However:

- do not capture the entire Document Object Model when targeted evidence is sufficient;
- do not emit enormous computed-style dumps;
- do not take unnecessary screenshots;
- do not repeatedly decode/copy the same reference image into every downstream artifact;
- do not keep browser processes alive indefinitely;
- make observation and reference scope explicit;
- preserve evidence needed to explain conclusions;
- avoid duplicating unchanged evidence unnecessarily.

## Accessibility evidence

Where the browser exposes it reliably, capture useful semantic/accessibility information such as:

- role;
- accessible name;
- landmark identity;
- relevant state.

This can help a human or LLM identify regions more reliably than position alone. Reference-to-runtime binding remains explicit and is never inferred merely because semantic evidence looks similar.

The project is not initially intended to replace a dedicated accessibility-audit product.

## Inspectability

Observation and regression results must be explainable.

A useful result should identify:

```text
what was observed or explicitly referenced
where it was observed/referenced
what changed or still differs
before/reference value
after/candidate value
difference
expected condition
actual condition
contract, reference requirement, or relationship involved
supporting artifact
supporting screenshot/reference
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

Given the same approved reference content, reference configuration, region definitions, applicability identity, and tolerance policy, the reference's logical identity and fidelity evaluation are deterministic according to the v0.7 contract.

Fields that are naturally unstable must either:

- be normalized;
- be excluded from logical comparison;
- or be explicitly identified as unstable metadata.

Deterministic target ordering, reference-region ordering, diagnostic ordering, serialization, and artifact references should be preferred where practical.

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
- a Figma or Canva replacement;
- a screenshot-cloning SaaS;
- an autonomous raster-to-HTML/CSS generator;
- an automatic logo/vector reconstruction system;
- a general-purpose computer-vision framework;
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
- external visual-reference evaluation;
- visual annotation;
- comparison;
- regression contracts.

Those capabilities may appear later according to Project Milestones and `ROADMAP.md`.

## Explicit product principles

1. Observe before inferring.
2. Browser runtime is authoritative for rendered geometry.
3. Source code and rendered output are different evidence domains.
4. External desired-design references are a third evidence domain, distinct from runtime observations and source code.
5. `my-dev-kit` owns static repository/source evidence; `my-frontend-observer` owns runtime browser evidence and its structured reference-evidence boundary.
6. Stable runtime-region identity does not automatically imply known source ownership.
7. Reference-region identity does not automatically imply runtime-target identity or source ownership.
8. Observed dimensions are measurements, not automatically fixed design constants.
9. A visible reference pixel is not automatically a hard requirement.
10. Prefer relationship-based layout requirements when they better represent user intent.
11. Distinguish direct browser facts, direct image measurements, authored requirements, and derived interpretations.
12. Preserve raw evidence behind normalized and summarized evidence.
13. Keep evidence bounded and make omissions explicit.
14. Never represent unavailable evidence as if it were an observed false or zero.
15. Never claim a visual requirement passed solely because a styling declaration looks correct.
16. Never claim reference fidelity from pixel similarity alone when structured evidence is available or required.
17. A requested change may legitimately cause dependent changes.
18. Distinguish requested changes, expected dependent changes, protected properties, preserved invariants, and unexpected changes.
19. A local requested change or reference match does not authorize unrelated rendered changes.
20. Previously approved frontend invariants remain active unless the user explicitly supersedes them.
21. Imported reference, approved reference, baseline approval, reference supersession, and baseline supersession are separate states/actions.
22. Make regressions and fidelity failures explainable.
23. Keep observation and reference evaluation non-destructive.
24. Keep artifacts local-first, versioned, portable, and inspectable.
25. Separate browser observation from static source analysis.
26. Separate evidence production from workflow orchestration and downstream evaluation.
27. Human visual intent must eventually be representable alongside machine measurements and external desired-design references.
28. Deep ecosystem integration should use explicit contracts and adapters rather than duplicated responsibilities.
29. Do not introduce speculative cross-project coupling before a real consumer requires it.
30. The viewer and annotation layers consume canonical reference/comparison/contract evidence; they do not redefine it.

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
approved external desired-design references where applicable
rendered frontend reality
static repository evidence
LLM reasoning
coding-agent implementation
```

The critical path has established:

```text
render and observe
→ identify stable regions and runtime behavior
→ compare
→ enforce requested/dependent/protected/preserved scope
→ combine bounded runtime and static evidence
→ establish external-reference identity/regions/requirements/applicability/binding
→ evaluate reference fidelity
→ provide bounded context to an external coding agent
→ rerender and reject fidelity or protected-contract regressions
```

Only after those core workflows work should the human visual branch add:

```text
viewer with reference/candidate inspection
→ structured annotation on runtime or reference images
→ full visual human–LLM workflow with both entry modes
```

The desired eventual visual cycle is:

```text
render/current candidate
+ optional approved external reference
→ observe
→ identify stable runtime regions and reference regions
→ measure geometry and behavior
→ evaluate reference applicability/fidelity where applicable
→ show human
→ annotate/request change on runtime or reference
→ define requested/dependent/protected/preserved scope
→ combine bounded runtime/reference and static evidence
→ provide context to LLM
→ coding agent implements
→ rerender
→ compare before/after
→ reevaluate reference/candidate fidelity
→ rerun preserved contracts
→ identify unexpected changes
→ approve or correct
→ establish new baseline and/or explicitly supersede reference according to policy
→ repeat
```

The project succeeds when an LLM no longer needs to guess what a frontend looks like from source code alone, when a human can communicate visual intent or an approved desired design without translating every design idea into implementation terminology, and when a frontend change cannot be considered successful while silently breaking previously approved rendered behavior.
