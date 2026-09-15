# Quickstart

The common source workflow is:

```powershell
node dist/cli.js init --url http://127.0.0.1:3000 --target app=#app
node dist/cli.js capture baseline
# make a frontend change
node dist/cli.js check baseline
node dist/cli.js view
```

Use `check baseline --json` for a coding agent: on `FAIL`, use the returned
bounded runtime evidence, correct source externally, and rerun until `PASS`.
Observer never edits source. Canonical IDs remain available in details and
provenance but are not required as ordinary command input.

Prerequisites are Node.js 24 or later and npm. For the published package:

```powershell
npm install --save-dev @dailephd/my-frontend-observer
npx playwright install chromium
```

The installed CLI is still named `my-frontend-observer`.

```powershell
npm install
npx playwright install chromium
npm run build
```

Run a real observation against your own local frontend:

```powershell
node dist/cli.js observe `
  --url http://localhost:3000/ `
  --viewport 1280x720 `
  --target header=header `
  --target main-content=main `
  --output observations
```

This launches Chromium, captures a screenshot plus bounded page/target
evidence, and writes one portable artifact under `observations/<observation-id>/`.
See [COMMANDS.md](COMMANDS.md) for the full flag reference, including the
`--targets-file` structured semantic-target input and the
`--scroll-scenario-file` bounded runtime scroll scenario input.

Once you have two such artifacts, `node dist/cli.js compare --before
<root> --after <root> --output comparisons` derives before/after evidence
between them without launching a browser again - see
[COMMANDS.md](COMMANDS.md#compare) for details.

You can then approve a baseline, save a per-change contract, and evaluate a
candidate change against them plus the observation/comparison evidence
above - see [COMMANDS.md](COMMANDS.md#approve-baseline) for the exact flags
and [WORKFLOWS.md](WORKFLOWS.md) for the full flow.

If you also have an external design-reference image, `import-reference`/
`approve-reference`/`evaluate-reference-fidelity` let you compare a
candidate observation against it (implemented in the current development
state; see [COMMANDS.md](COMMANDS.md) and [CONTRACTS.md](CONTRACTS.md) for
the exact flags and contract).

To inspect a project visually instead of opening raw artifact files,
`my-frontend-observer view --no-open` starts a local,
loopback-only viewer server (usable in a normal browser or as an installed
PWA) over managed project evidence. For existing standalone evidence roots,
use `my-frontend-observer view --root observations --no-open`. See
[COMMANDS.md](COMMANDS.md#view) for the full
flag reference, including `--bindings-file` and `--context-file`.

To validate the repository itself instead:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm run check:docs
```
