# Quickstart

For complete coding-agent features, runtime-to-source repair, shared-component
protection, and ecosystem failure feedback, use the single
[ecosystem workflow guide in my-dev-kit](https://github.com/dailephd/my-dev-kit/blob/main/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md).
Observer owns the browser evidence and its canonical evaluations. Project tests
own application actions and backend/frontend integration. Orchestrator owns
native lifecycle when selected. Lab supplies applicable assurance separately.
This repository does not maintain another ecosystem-guide copy.

The common source workflow is:

```powershell
node dist/cli.js init --url http://127.0.0.1:3000 --target app=#app
node dist/cli.js capture baseline
# make a frontend change
node dist/cli.js check baseline --json
node dist/cli.js view
```

Use `check baseline --json` for a coding agent. It captures a new immutable
candidate, compares it canonically, and evaluates configured acceptance. The
result and exit status are `PASS`/0, `FAIL`/1, `REVIEW_REQUIRED`/2, or `BLOCKED`/3.
Comparison alone returns `REVIEW_REQUIRED`, even when no differences are found.
Configure the applicable contract and/or approved reference through the current
project schema before expecting an acceptance PASS. See
[COMMANDS.md](COMMANDS.md#v081-common-workflow) for the exact fields.

On a failure, preserve the bounded evidence, correct source externally, and
recheck against the same baseline. Do not replace the baseline, relax protected
requirements, or treat REVIEW_REQUIRED/BLOCKED as success. Observer never edits
source. Canonical IDs remain available in details and provenance but are not
required as ordinary project-command input.

Prerequisites are Node.js 24 or later and npm. The package identity is:

```powershell
npm install --save-dev @dailephd/my-frontend-observer
npx playwright install chromium
```

The installed CLI remains `my-frontend-observer`. Use the resolved local binary
or `npx @dailephd/my-frontend-observer` and record its version. For source setup:

```powershell
npm install
npx playwright install chromium
npm run build
```

The advanced observation workflow remains supported:

```powershell
node dist/cli.js observe `
  --url http://localhost:3000/ `
  --viewport 1280x720 `
  --target header=header `
  --target main-content=main `
  --output observations
```

It launches Chromium, captures a screenshot plus bounded page/target evidence,
and writes a portable artifact under `observations/<observation-id>/`.
[COMMANDS.md](COMMANDS.md) documents structured `--targets-file` input, bounded
`--scroll-scenario-file` actions, and declared `--state-file` identity. Declaring
state does not log in, seed data, or execute a user journey. Establish required
application state with the project's actual setup/browser test commands.

With two observations, `compare --before <root> --after <root> --output
comparisons` derives before/after evidence without launching another browser.
It can report incomparable evidence successfully, so inspect the semantic
result rather than treat advanced-command exit 0 as acceptance.

`approve-baseline`, `save-change-contract`, and `evaluate-contract` expose the
advanced frontend contract flow. A selected external image additionally uses
`import-reference`, `approve-reference`, and `evaluate-reference-fidelity`.
Reference requirements, applicability, explicit bindings, and protected behavior
remain independent acceptance responsibilities. A raw image import does not
approve a reference or prove every aesthetic requirement. See
[CONTRACTS.md](CONTRACTS.md) and [WORKFLOWS.md](WORKFLOWS.md).

`my-frontend-observer view --no-open` starts the loopback-only viewer over managed
project evidence. Use `view --root observations --no-open` for standalone roots.
The viewer is inspect-only. Its `--bindings-file` and `--context-file` inputs do
not create a second evaluator or automatic source-owner mapping.

To validate this repository itself, rather than the target application:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm run check:docs
```
