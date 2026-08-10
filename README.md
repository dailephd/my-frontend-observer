# my-frontend-observer

`my-frontend-observer` is the planned local-first rendered browser/runtime
evidence producer in the my-dev-kit ecosystem. Its durable product purpose is
defined in [docs/PROJECT_DESCRIPTION.md](docs/PROJECT_DESCRIPTION.md).

## Current status

The repository contains the standardized greenfield TypeScript CLI project
foundation. Roadmap v0.1, Runtime Observation Foundation, has not been
implemented and is the next implementation target. There is no working browser
observation command, Chromium capture path, observation schema, or runtime
artifact writer.

Current foundation setup:

```powershell
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run check:docs
```

The package bin currently reports that v0.1 is not implemented and exits with a
failure status; it is a transparent starter-profile placeholder, not product
functionality.

Planning authorities:

- [Project Description](docs/PROJECT_DESCRIPTION.md): complete durable product
  intent and responsibility boundaries.
- [Project Milestones](docs/PROJECT_MILESTONES.md): complete ordered capability
  design and cross-milestone rules.
- [ROADMAP](docs/ROADMAP.md): version-level requirements; v0.1 is next.
- [Current State](docs/CURRENT_STATE.md): retained scaffold and release state.

This package is private and unreleased. No sibling ecosystem repository is a
runtime dependency of the retained foundation.
