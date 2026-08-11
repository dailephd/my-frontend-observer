# my-frontend-observer

`my-frontend-observer` is the local-first rendered browser/runtime evidence
producer in the my-dev-kit ecosystem. Its durable product purpose is defined
in [docs/PROJECT_DESCRIPTION.md](docs/PROJECT_DESCRIPTION.md).

## Current status

Roadmap v0.1, Runtime Observation Foundation, is implemented as a
source checkout: `my-frontend-observer observe` launches a real, sandboxed
Chromium browser, enforces a loopback-only safety policy, captures a viewport
screenshot plus bounded page/target evidence, and persists it as one portable
`manifest.json` + `screenshot.png` artifact. v0.1 is not yet released as a
published package.

Setup:

```powershell
npm install
npx playwright install chromium
npm run build
```

Example use, against your own locally running frontend:

```powershell
node dist/cli.js observe `
  --url http://localhost:3000/ `
  --viewport 1280x720 `
  --target header=header `
  --target main-content=main `
  --output observations
```

This prints a concise result (`Observation:`/`State:`/`Artifact:`/`Targets:`/
`Diagnostics:`) and exits `0` on a successfully persisted observation. See
[docs/COMMANDS.md](docs/COMMANDS.md) for the full flag reference.

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
- [ROADMAP](docs/ROADMAP.md): version-level requirements; v0.1 is implemented,
  v0.2 is next.
- [Current State](docs/CURRENT_STATE.md): retained scaffold and release state.

This package is private and unreleased. No sibling ecosystem repository is a
runtime dependency of the retained foundation.
