# my-frontend-observer

`my-frontend-observer` is the local-first rendered browser/runtime evidence
producer in the my-dev-kit ecosystem. Its durable product purpose is defined
in [docs/PROJECT_DESCRIPTION.md](docs/PROJECT_DESCRIPTION.md).

## Current status

`v0.5.0`, Executable Frontend Contracts and Explicit Change Scope, is the
current published release: `my-frontend-observer observe` launches a real,
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
- [ROADMAP](docs/ROADMAP.md): version-level requirements; v0.1-v0.5 are
  released, v0.6 is next.
- [Current State](docs/CURRENT_STATE.md): retained scaffold and release state.

No sibling ecosystem repository is a runtime dependency of the retained
foundation.
