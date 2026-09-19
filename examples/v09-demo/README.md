# my-frontend-observer v0.9 demo

A small deterministic web application built for one job: making the concepts
`my-frontend-observer` works with visible enough that a person can point at
them.

It is not a product feature and not part of the published npm package. It is a
version-controlled demonstration template that later tutorial automation
materializes into a disposable working copy.

## 1. Why this demo exists

Observer captures browser evidence, compares observations, evaluates change
contracts, and works against external visual references. Explaining any of that
against a real application is hard, because a real application changes for
reasons that have nothing to do with the point being made.

This demo removes that noise. Every region is named, every difference between
states is deliberate, and the rendered geometry at the canonical viewport
depends on nothing except the state you ask for.

- Canonical viewport: **1440 x 900**
- Demo identity: `my-frontend-observer-v09-demo`
- Everything is local. No network font, no CDN, no remote image, no external
  API. It renders correctly with no internet connection.
- No animation, transition, timer, random value or current time anywhere, so
  two captures of the same state produce the same geometry.

## 2. Layout and stable demo targets

The page is a header, a navigation bar, a sidebar next to a main content
column, and a footer. The content column holds a hero, two cards, a
call-to-action and a local illustration asset.

Each region carries a stable `data-demo-target` attribute. These names are the
demo's identity contract. They never depend on incidental CSS classes, and
tutorials and tests bind to them:

```text
header
navigation
hero
sidebar
content
card-1
card-2
cta
footer
asset
```

A small number of elements also carry `data-testid` attributes, added only
where automation needs to interact with the page rather than just measure it:

```text
demo-state-badge      the header badge showing the current state
demo-cta-button       the call-to-action button
demo-asset-image      the local illustration image
demo-nav-<state>      one navigation link per demo state
```

## 3. The state model

The demo has nine frozen states. The navigation bar links to all of them, and
the header badge always shows which one is rendered.

1. `baseline` - the reference point every other state is described against.
2. `move-hero` - the hero moves right by 160px. Its width is unchanged, so
   this reads as "x increased", not "it was resized".
3. `wider-sidebar` - the sidebar grows from 260px to 400px. Nothing moves
   vertically.
4. `changed-spacing` - the horizontal gap between the sidebar and the content
   column grows from 24px to 96px. A relationship between two regions changed,
   not a region itself.
5. `move-footer` - the footer lifts 64px off the bottom edge, leaving a visible
   strip of canvas below it. Deliberately the shape of a real layout
   regression.
6. `removed-card` - `card-2` is genuinely absent from the document, not merely
   hidden.
7. `changed-asset` - the illustration image swaps to a different local asset
   while its container geometry stays identical.
8. `multi-change` - five deliberate differences at once: the hero move, the
   wider sidebar, the removed card, the swapped asset, and the lifted footer.
9. `reference` - a desired design rather than a change. See section 6.

Two states are deliberately structural rather than geometric. `removed-card`
removes the element from the DOM, and `changed-asset` changes which local file
the image points at. Everything else is expressed as a CSS custom property
override in `app/styles.css`, keyed on the state attribute.

### What each state is good for

- `move-hero` is the clean example of a horizontal move: one region's `x`
  increases and nothing else differs.
- `wider-sidebar` is the clean example of a resize: one region's `width`
  increases and nothing else differs.
- `changed-spacing` is about measurement between regions rather than any single
  region's box.
- `move-footer` gives a second, vertical movement example.
- `removed-card` shows the kind of human intent that can be annotated as a
  `remove` operation but that the current contract-primitive vocabulary cannot
  promote into a contract clause. That gap is the point: the demo should make
  an honest limitation visible rather than hide it.
- `changed-asset` keeps an asset-sensitive difference separate from geometry,
  so the two are never conflated.
- `multi-change` exists so selecting only some differences has something to
  select from. It is not the state to use for a simple first explanation.

## 4. Materializing the demo

The tracked directory `examples/v09-demo/` is immutable. Nothing writes into
it during ordinary use. To get a working copy, materialize it into a target
root you own and are willing to lose:

```powershell
node examples/v09-demo/scripts/prepare.mjs <targetRoot>
```

The target root is required and never defaulted. The script resolves it
absolutely and refuses a filesystem or drive root, any path with fewer than two
segments below its root, the home directory, the repository root, the demo
template itself or anything inside it, and any directory that contains the
repository.

Reset semantics are simply "materialize again": a rerun destroys and recreates
the target root, so a target always ends up in exactly the same clean state.
There is no separate reset command.

A materialized target contains only what it needs to serve the demo on its own:

```text
<targetRoot>/
    app/
        index.html
        styles.css
        state.js
        assets/
    server.mjs
```

## 5. Running the demo

The port is always chosen by the caller. The server never picks one for you:

```powershell
node <targetRoot>/server.mjs --port 4173
```

It binds `127.0.0.1` only, serves nothing outside the `app/` directory, and
rejects path traversal. Requests for file types outside a small allowlist are
404, not guessed.

Select a state through the URL:

```text
http://127.0.0.1:4173/
http://127.0.0.1:4173/?state=baseline
http://127.0.0.1:4173/?state=move-hero
http://127.0.0.1:4173/?state=reference
```

Omitting `?state=` renders `baseline`. An unrecognized state fails closed: the
server answers HTTP 400 with an explicit invalid-state page naming the value it
rejected and listing the supported states. It never silently substitutes a
different state.

Readiness has its own endpoint:

```text
GET /health
```

It answers HTTP 200 with a bounded, deterministic JSON document: `ok`,
`demoId`, `schemaVersion`, `canonicalViewport`, `defaultState` and `states`.
There is no timestamp and no per-run identity in it, so two calls to a running
server return identical bytes.

To serve the tracked template directly without materializing it first, for
example while editing the demo, pass an explicit application root:

```powershell
node examples/v09-demo/scripts/server.mjs --port 4173 --app-root examples/v09-demo/app
```

## 6. The reference image

`references/v09-reference.png` is a fixed 1440x900 PNG captured from the
`reference` state. It stands in for the external visual reference a designer
would hand over: a desired design, not a record of what the application
currently does.

It differs from `baseline` in four controlled ways, chosen so a reference
workflow has something of each kind to work with:

- a region's geometry differs (the sidebar is 320px wide, the hero is offset),
- a relationship differs (the sidebar-to-content gap is 56px),
- the asset-sensitive area differs (the alternate illustration),
- the visual treatment differs (a different accent colour).

`references/v09-reference.provenance.json` records where the image came from,
at which viewport, how to regenerate it, and what it is for. It is a plain
record beside the asset. It is not an Observer evidence artifact and it defines
no Observer schema.

The committed PNG is a fixed asset. No test run regenerates it. When the demo's
appearance intentionally changes, regenerate and review it deliberately:

```powershell
npm run build
node examples/v09-demo/scripts/generate-reference.mjs
```

That script adds no second screenshot engine. It serves the `reference` state
on loopback and captures it through the repository's own canonical Chromium
observation path, which is why it needs a prior build.

No approved reference artifact is committed here. Importing and approving this
PNG happens through the canonical Observer commands, inside a disposable
materialized target, never in this template.

## 7. The tutorials

`tutorials/` holds four `TutorialScenarioV1` files for the released
`@dailephd/my-dev-kit-lab@0.4.8` tutorial runtime. They drive the real Observer
viewer against a disposable project built from this demo.

```text
01-annotation-basics.json          marks are evidence, association is explicit
02-runtime-intent-contract.json    meaning, confirmation, selective promotion, activation
03-reference-authoring.json        reference regions and explicit design requirements
04-reference-materialization.json  selected intent becomes a new imported revision
```

They are pure lab contracts. They contain no Observer-only field, no absolute
path, and no generated identifier, so nothing in them is specific to one
machine or one run.

### Requirements

The lab is an external tool, not an Observer dependency. Observer does not
depend on it at build or run time, and `npm install` never fetches it.

```text
@dailephd/my-dev-kit-lab@0.4.8 or later
```

Version 0.4.8 is the minimum, because it is the first release with the
locator-anchored positional pointer actions (`pointer-click` and
`pointer-drag`) that annotation drawing needs.

Build Observer first. The tutorials run this checkout's unreleased v0.9
implementation, not the published package:

```powershell
npm run build
```

### Generating a target contract

A target contract carries absolute paths and two dynamic loopback ports, so it
is generated per run and never committed:

```powershell
node examples/v09-demo/scripts/generate-tutorial-target.mjs `
  --scenario observer-v09-annotation-basics `
  --out .my-dev-kit-workflow/v0.9/tutorial-integration/target-contract.json
```

Ports are free loopback ports chosen at generation time. Pass `--demo-port` and
`--viewer-port` to pin them for debugging. Free-port discovery cannot reserve a
port indefinitely, so generate the contract immediately before the run.

The four `--scenario` values are the four scenario ids:

```text
observer-v09-annotation-basics
observer-v09-runtime-contract
observer-v09-reference-authoring
observer-v09-reference-materialization
```

### Validating

```powershell
npx --yes @dailephd/my-dev-kit-lab@0.4.8 tutorial validate `
  --scenario examples/v09-demo/tutorials/01-annotation-basics.json `
  --target-contract .my-dev-kit-workflow/v0.9/tutorial-integration/target-contract.json `
  --json
```

Validation is read-only: it starts no process and needs no browser.

### Running

```powershell
npx --yes @dailephd/my-dev-kit-lab@0.4.8 tutorial run `
  --scenario examples/v09-demo/tutorials/01-annotation-basics.json `
  --target-contract .my-dev-kit-workflow/v0.9/tutorial-integration/target-contract.json `
  --out $env:TEMP\my-frontend-observer-v09-tutorial-smoke\s01 `
  --json
```

Always send `--out` somewhere outside the repository. A run writes a video,
screenshots, subtitles, Markdown, a manifest and a whole disposable Observer
project; none of that belongs in tracked source.

Each run gets a fresh target root, and each scenario builds its own starting
state from scratch. No tutorial depends on another tutorial having run.

### What prepare does

The target contract names `scripts/prepare-tutorial-target.mjs` as its prepare
command. The lab runs it once, before any process or browser starts. It
materializes the demo with this template's own materialization script, serves
it temporarily on the demo port, and then uses the built Observer CLI to
initialize a project, capture a baseline observation, and add whatever the
chosen scenario needs: contract acceptance for the runtime-contract tutorial,
an imported and approved reference for the two reference tutorials. The
temporary server is stopped in a `finally`, so the port is free for the demo
server the lab manages itself.

Nothing in prepare handwrites an Observer artifact. Every artifact comes from a
canonical Observer command.

### Driving form controls

The viewer uses native `<select>` elements, and the lab has no select action.
The scenarios choose an option by focusing the control and pressing
`ArrowDown`, which is ordinary keyboard use. The number of presses follows the
order of the frozen vocabularies in `viewer/src/annotation/`. Two consequences
are worth knowing before editing a scenario: adding an option to one of those
vocabularies shifts the counts, and the reference requirement form keeps its
previous values when another mark is selected, so later steps step from where
the last one left off rather than from empty.

## 8. What lives where

```text
examples/v09-demo/
    app/                    the demo application itself
        index.html          structure, stable target names, test ids
        styles.css          all geometry, including every state override
        state.js            the two structural state differences
        assets/             local SVG assets
    references/             the fixed reference PNG, its provenance record,
                            and the region geometry the tutorials import
    scripts/
        prepare.mjs                  materialize the template into a disposable target
        server.mjs                   the loopback demo server
        generate-reference.mjs       deliberate reference-image regeneration
        generate-tutorial-target.mjs per-run lab target contract
        prepare-tutorial-target.mjs  the lab's trusted prepare command
    tutorials/              the four lab tutorial scenarios
    README.md               this file
```
