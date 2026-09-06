# my-frontend-observer

`my-frontend-observer` is the local-first rendered browser/runtime evidence
producer in the my-dev-kit ecosystem. Its durable product purpose is defined
in [docs/PROJECT_DESCRIPTION.md](docs/PROJECT_DESCRIPTION.md).

## Current status

`v0.6.0`, Bounded Agent Context and Native my-dev-kit Ecosystem Integration,
is the current published release. It builds on `v0.5.0`, Executable Frontend
Contracts and Explicit Change Scope: `my-frontend-observer observe` launches a real,
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
npm install my-frontend-observer
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

### External-reference correction workflow (v0.7, implemented, unreleased)

The complete v0.7 external-reference foundation and end-to-end correction
workflow is implemented in this development state (package version still
`0.6.0` - see "Current status" above). `import-reference` and
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
Prompt-by-Prompt implementation record.

Validation:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm run check:docs
```

Planning authorities:

- [Project Description](docs/PROJECT_DESCRIPTION.md): complete durable product
  intent and responsibility boundaries.
- [Project Milestones](docs/PROJECT_MILESTONES.md): complete ordered capability
  design and cross-milestone rules.
- [ROADMAP](docs/ROADMAP.md): version-level requirements; v0.1-v0.6 are
  released; v0.7 is implemented in this development state but unreleased
  (package version remains `0.6.0`); v0.8+ remain future.
- [Current State](docs/CURRENT_STATE.md): retained scaffold and release state.

No sibling ecosystem repository is a runtime dependency of the retained
foundation.
