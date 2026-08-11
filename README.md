# my-frontend-observer

`my-frontend-observer` is the local-first rendered browser/runtime evidence
producer in the my-dev-kit ecosystem. Its durable product purpose is defined
in [docs/PROJECT_DESCRIPTION.md](docs/PROJECT_DESCRIPTION.md).

## Current status

`v0.2.0`, Stable Semantic Targets and Region Identity, is the current
published release: `my-frontend-observer observe` launches a real,
sandboxed Chromium browser, enforces a loopback-only safety policy,
captures a viewport screenshot plus bounded page/target evidence, and
persists it as one portable `manifest.json` + `screenshot.png` artifact
(observation schema `1.1.0`).

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

`--target <id=css-selector>` remains the simple CSS shorthand. A second,
structured `--targets-file <json-file>` input mode ships as part of this
release - supporting a role and accessible name, a stable `id`, a `data-*`
attribute, a semantic landmark element, exact text, or an ordered fallback
between several of those. See "Structured semantic targets" in
[docs/COMMANDS.md](docs/COMMANDS.md#structured-semantic-targets-targets-file)
for the exact JSON format.

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
- [ROADMAP](docs/ROADMAP.md): version-level requirements; v0.1 and v0.2 are
  released, v0.3 is next.
- [Current State](docs/CURRENT_STATE.md): retained scaffold and release state.

No sibling ecosystem repository is a runtime dependency of the retained
foundation.
