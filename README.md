# my-frontend-observer

## Common project workflow (v0.9.1)

```powershell
my-frontend-observer init --url http://127.0.0.1:3000 --target app=#app
my-frontend-observer capture baseline

# make a frontend change
my-frontend-observer check baseline

# inspect canonical evidence and provenance
my-frontend-observer view
```

`check baseline --json` returns bounded coding-agent evidence and exits `0`,
`1`, `2`, or `3` for `PASS`, `FAIL`, `REVIEW_REQUIRED`, or `BLOCKED`.
Canonical hashes remain available in viewer details and persisted provenance,
but are not normal workflow command inputs. The existing low-level commands
remain supported. v0.9.1 is the current published release.

v0.9.1 is a maintenance release that hardens independent PWA security-gate
validation without changing production PWA behavior.

`my-frontend-observer` is the local-first rendered browser/runtime evidence
producer in the my-dev-kit ecosystem. Its durable product purpose is defined
in [docs/PROJECT_DESCRIPTION.md](docs/PROJECT_DESCRIPTION.md). Whole-ecosystem
composition is documented in the [my-dev-kit ecosystem guide](https://github.com/dailephd/my-dev-kit/blob/main/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md), including the [command-surface compatibility map](https://github.com/dailephd/my-dev-kit/blob/main/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md#915-command-surface-compatibility-map).

## Current status

`v0.9.1`, PWA Hard-Gate Isolation and Reproducible Security Acceptance, is the
current published release. It preserves the `v0.9.0` Human Visual Annotation
and Design-Intent Capture release and builds on `v0.8.1`, Project Workflow CLI and
Human-Readable Evidence Aliases, `v0.8.0`, Interactive Local Observation
Viewer, and `v0.7.0`, End-to-End Coding-Agent Frontend Change
Review, `v0.6.0`, Bounded Agent Context and Native my-dev-kit Ecosystem
Integration, and `v0.5.0`, Executable Frontend Contracts and Explicit Change
Scope: `my-frontend-observer observe` launches a real,
sandboxed Chromium browser, enforces a loopback-only safety policy, captures
a viewport screenshot plus bounded page/target evidence, and persists it as
one portable `manifest.json` + `screenshot.png` artifact (observation schema
`1.2.0`). `my-frontend-observer compare` reads two already-persisted
observation artifacts and derives before/after evidence purely from their
existing content, persisting a comparison artifact (comparison schema
`1.0.0`). `my-frontend-observer approve-baseline`, `save-change-contract`,
and `evaluate-contract` turn that evidence into an executable frontend
contract: an explicitly approved baseline plus a per-change contract
(requested/expected-dependent/protected/preserved scope) are evaluated
together into one `PASS`/`FAIL` verdict, so a locally successful requested
change can never silently hide a protected-region regression (frontend
contract schema `1.0.0`; evaluation artifact schema `1.0.0`).

Install:

```powershell
npm install --save-dev @dailephd/my-frontend-observer
npx playwright install chromium
```

Setup for working from a source checkout instead:

```powershell
npm install
npx playwright install chromium
npm run build
```

Example use, against your own locally running frontend:

```powershell
my-frontend-observer observe `
  --url http://localhost:3000/ `
  --viewport 1280x720 `
  --target header=header `
  --target main-content=main `
  --output observations
```

(From a source checkout, use `node dist/cli.js observe ...` instead.)

This prints a concise result (`Observation:`/`State:`/`Artifact:`/`Targets:`/
`Diagnostics:`) and exits `0` on a successfully persisted observation. See
[docs/COMMANDS.md](docs/COMMANDS.md) for the full flag reference.

`--target <id=css-selector>` remains the simple CSS shorthand. A structured
`--targets-file <json-file>` input mode - supporting a role and accessible
name, a stable `id`, a `data-*` attribute, a semantic landmark element,
exact text, or an ordered fallback between several of those - ships
alongside it. See "Structured semantic targets" in
[docs/COMMANDS.md](docs/COMMANDS.md#structured-semantic-targets-targets-file)
for the exact JSON format.

### Runtime scroll scenarios

`--scroll-scenario-file <json-file>` ships in this release: a real, bounded
`window-scroll-by` or `target-scroll-by` action performs one immediate,
non-smooth scroll and captures initial/final runtime evidence - window and
configured-target scroll position, actual overflow, viewport relation,
entered/left-viewport transitions, and a derived scroll-owner
interpretation (`document`, `target:<stable-target-name>`, `none`, or
`indeterminate`), all persisted in the same `manifest.json`. It may be
combined with either `--target` or `--targets-file`. See "Scroll scenario"
in
[docs/COMMANDS.md](docs/COMMANDS.md#scroll-scenario---scroll-scenario-file)
for the exact JSON format and flag reference.

### Comparison

`my-frontend-observer compare` reads two already-persisted observation
artifacts and derives before/after evidence purely from their existing
content - it never launches a browser:

```powershell
my-frontend-observer compare `
  --before observations/<before-observation-id> `
  --after observations/<after-observation-id> `
  --output comparisons
```

(From a source checkout, use `node dist/cli.js compare ...` instead.)

This prints a concise result (`Comparison:`/`State:`/`Artifact:`/
`Differences:`/`Relationship changes:`/`Diagnostics:`) and exits `0` -
including when the two observations turn out to be `incomparable`, which is
itself a successful comparison outcome. See
[docs/COMMANDS.md](docs/COMMANDS.md) for the full flag reference.

### Frontend contracts

`v0.5.0` ships a text/config-driven frontend contract and evaluation
workflow: approve a baseline against an observation, save a per-change
contract, then evaluate a candidate change against them plus existing
before/after/comparison evidence, deriving one `PASS`/`FAIL` verdict:

```powershell
my-frontend-observer approve-baseline --observation observations/<id> --contract-file baseline.json --output baselines
my-frontend-observer save-change-contract --contract-file change.json --output contracts
my-frontend-observer evaluate-contract --before observations/<before-id> --after observations/<after-id> --comparison comparisons/<id> --baseline baselines/<baseline-id> --change contracts/<contract-id> --output evaluations [--enforce]
```

(From a source checkout, use `node dist/cli.js approve-baseline ...` etc.
instead.)

`evaluate-contract` never launches a browser or recomputes comparison
evidence. `--enforce` only changes the process exit status for a `FAIL`
verdict; the verdict itself, and its persisted evidence, are unaffected. See
[docs/COMMANDS.md](docs/COMMANDS.md) for the full flag reference and
[docs/WORKFLOWS.md](docs/WORKFLOWS.md) for the end-to-end flow.

### Bounded agent context (v0.6.0)

`src/domain/boundedAgentContext.ts`, `boundedAgentContextProjection.ts`,
`boundedAgentContextCorrelation.ts`, and `boundedAgentContextIdentity.ts`
ship a programmatic (library-only, no CLI command) bounded runtime
projection and an explicit runtime/static correlation boundary
(`correlated`/`ambiguous`/`unavailable`, never inferred source ownership),
exported from `src/index.ts` (bounded-agent-context schema `1.0.0`). See
[docs/CONTRACTS.md](docs/CONTRACTS.md) for the exact contract and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits the existing
pipeline.

### External-reference correction workflow (v0.7.0)

`import-reference` and
`approve-reference` persist an externally supplied design-reference image
(with optional regions, selected requirements/tolerances, and applicability
state); `evaluate-reference-fidelity --reference --candidate
[--bindings-file] [--enforce]` compares an already-persisted candidate
observation against it, gated by reference adequacy, reference/candidate
compatibility, and explicit region-to-target bindings:

```powershell
my-frontend-observer import-reference design.png --output references --regions-file regions.json --requirements-file requirements.json --applicability-file applicability.json
my-frontend-observer approve-reference --reference references/<id> --output references
my-frontend-observer evaluate-reference-fidelity --reference references/<approved-id> --candidate observations/<id> --bindings-file bindings.json
```

(From a source checkout, use `node dist/cli.js import-reference ...` etc.
instead.)

`import-reference`/`approve-reference`/`evaluate-reference-fidelity` never
launch a browser or edit any file outside their own declared output
location; `evaluate-reference-fidelity` persists nothing. A programmatic,
library-only correction-workflow coordinator
(`prepareReferenceCorrection`/`reviewReferenceCorrectionAttempt`, exported
from `src/index.ts`, no CLI command) composes the full cycle - reference
fidelity (reused unchanged) plus canonical v0.4 comparison and v0.5 contract
evaluation - into one overall result: matching the reference is necessary
but never sufficient, so a candidate that visually satisfies the reference
while regressing an active protected/preserved contract clause still
resolves to overall `FAIL`. my-frontend-observer never edits target source
itself; an external implementation actor (a human or a coding agent, never
this package) makes the actual source change between review attempts. See
[docs/CONTRACTS.md](docs/CONTRACTS.md) and
[docs/WORKFLOWS.md](docs/WORKFLOWS.md) for the exact contract and workflow,
and [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) for the full
implementation record.

### Interactive local viewer (v0.8.0)

`my-frontend-observer view [--root <evidence-root>] [--bindings-file <json-file>] [--context-file <json-file>] [--port <n>] [--no-open]`
starts a loopback-only (`127.0.0.1`) Node server that serves a React +
TypeScript + Vite viewer application - usable in a normal browser or as an
installed Progressive Web App - over the same evidence root used by every
other command above. It never edits target source, never mutates any
evidence artifact, and never runs `@dailephd/my-dev-kit`:

```powershell
# In an initialized project, use managed evidence and aliases.
my-frontend-observer view --port 4319 --no-open

# `--root` remains the standalone/advanced form.
my-frontend-observer view --root observations --port 4319 --no-open
```

(From a source checkout, use `node dist/cli.js view ...` instead.)

### Visual annotation (v0.9.0)

v0.9.0 adds structured visual annotation to the project-aware viewer. The
model rests on a few deliberate separations:

- Drawing is evidence, not meaning. A mark on its own says nothing about what
  should change.
- Association is explicit. You choose what a mark is about.
- Confirmation is explicit. A candidate meaning is only a proposal until you
  confirm it.
- Promotion and materialization are selected actions. Nothing is promoted or
  materialized just because it was confirmed.
- Promotion does not activate a contract, and materialization does not approve
  a reference. Those remain separate, explicit decisions.

The capabilities:

- **Runtime screenshot annotation**: draw points, rectangles, lines, arrows,
  and notes on an observation screenshot. Geometry is stored in runtime CSS
  pixels.
- **External-reference annotation**: draw the same marks on an imported or
  approved design reference. Geometry is stored in reference-image pixels.
- **Explicit association**: a mark is linked to a runtime target, a runtime
  relationship, a reference region, or a reference relationship only when you
  choose it. Drawing over something never creates an association.
- **Candidate and confirmed intent**: you choose a structured intent (for
  example "move header right" or "create region hero"), review the exact
  candidate structure, and confirm it explicitly. Editing a confirmed item
  withdraws the confirmation.
- **Immutable saves**: each save writes a new `VisualAnnotationArtifact`
  (schema `1.0.0`). A revision supersedes its parent and never rewrites it.
- **Runtime contract promotion**: selected confirmed runtime intent can be
  promoted into a normal per-change frontend contract. Activating that
  contract for `check` is a separate explicit choice.
- **Reference materialization**: selected confirmed reference regions and
  requirements can be materialized into a new imported external-reference
  revision that supersedes the source. The source reference is never changed,
  and the new revision is not approved automatically.

Authoring is available only in the project-aware viewer:

```powershell
# Project-aware: annotation authoring enabled for this project.
my-frontend-observer view

# Standalone: always read-only, even for annotation evidence.
my-frontend-observer view --root .frontend-observer/evidence
```

There is no separate annotation command. Observer still never edits target
source, never approves a baseline or reference on its own, and never adds a
new PASS/FAIL rule for annotations. The existing contract and reference
evaluators remain the only source of verdicts. See
[docs/WORKFLOWS.md](docs/WORKFLOWS.md) and
[docs/SECURITY.md](docs/SECURITY.md) for the full workflow and the local write
boundary.

## Demo and tutorials

Explaining annotation, contracts, and references against a real application is
hard, because a real application changes for reasons unrelated to the lesson.
The repository therefore keeps a small deterministic demo application in
[examples/v09-demo/](examples/v09-demo/README.md). Every region is named and
every state difference is deliberate, so the same state always renders the
same geometry at the canonical 1440x900 viewport.

Four v0.9 tutorial scenarios live in `examples/v09-demo/tutorials/`. They are
recorded by the external tool `@dailephd/my-dev-kit-lab@0.4.9`, which drives
the real Observer viewer in Chromium against a disposable project built from
the demo. Observer itself has no tutorial command and does not depend on the
lab.

A contributor builds Observer, generates a per-run target contract, then
validates and runs a scenario:

```powershell
npm run build
node examples/v09-demo/scripts/generate-tutorial-target.mjs `
  --scenario observer-v09-annotation-basics `
  --out .my-dev-kit-workflow/adhoc/target-contract.json
npx --yes @dailephd/my-dev-kit-lab@0.4.9 tutorial validate `
  --scenario examples/v09-demo/tutorials/01-annotation-basics.json `
  --target-contract .my-dev-kit-workflow/adhoc/target-contract.json --json
npx --yes @dailephd/my-dev-kit-lab@0.4.9 tutorial run `
  --scenario examples/v09-demo/tutorials/01-annotation-basics.json `
  --target-contract .my-dev-kit-workflow/adhoc/target-contract.json `
  --out <an output directory you choose outside the repository> --json
```

A run writes a WebM video, screenshots, SRT and VTT subtitles, a Markdown
tutorial, and a manifest into the output directory you choose. None of that is
committed. The demo and tutorial sources are repository examples only. They
are not included in the npm package. See
[examples/v09-demo/README.md](examples/v09-demo/README.md) for the full
contributor workflow.

## License

MIT. See [LICENSE](LICENSE).

The viewer shows observation screenshots and SVG target overlays,
before/after comparisons and contract/change-scope results, approved
external references beside candidate observations with explicit binding
cross-selection and on-demand fidelity evaluation, and - when
`--context-file` supplies one - a read-only inspection of a bounded agent
context's adequacy, omissions/truncations, and runtime/static correlation.
Both `--bindings-file` and `--context-file` are explicit, session-only
input: read once at startup, held only in server memory, never persisted,
and never exposed as a filesystem path to the browser. See
[docs/COMMANDS.md](docs/COMMANDS.md#view) for the full flag reference and
[docs/WORKFLOWS.md](docs/WORKFLOWS.md) for the viewer workflow.

See [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) for the exact current
implementation and release state.

Validation:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run test:security
npm run build
npm run check:docs
```

Planning authorities:

- [Project Description](docs/PROJECT_DESCRIPTION.md): complete durable product
  intent and responsibility boundaries.
- [Project Milestones](docs/PROJECT_MILESTONES.md): complete ordered capability
  design and cross-milestone rules.
- [ROADMAP](docs/ROADMAP.md): version-level requirements; v0.1-v0.9.1 are
  released; v0.10 remains future.
- [Current State](docs/CURRENT_STATE.md): retained scaffold and release state.

No sibling ecosystem repository is a runtime dependency of the retained
foundation.
