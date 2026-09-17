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
candidate observation against it. These commands are released and supported
in the current package; see [COMMANDS.md](COMMANDS.md) and
[CONTRACTS.md](CONTRACTS.md) for the exact flags and contract.

To inspect a project visually instead of opening raw artifact files,
`my-frontend-observer view --no-open` starts a local,
loopback-only viewer server (usable in a normal browser or as an installed
PWA) over managed project evidence. For existing standalone evidence roots,
use `my-frontend-observer view --root observations --no-open`. See
[COMMANDS.md](COMMANDS.md#view) for the full
flag reference, including `--bindings-file` and `--context-file`.

### Visual annotation (v0.9, implemented, not yet released)

The current repository state adds visual annotation to the project-aware
viewer. It is not in a published release yet; the published package is
`0.8.1`.

```powershell
node dist/cli.js view
```

1. Run the project-aware `view` (without `--root`) and open the printed URL.
2. Select an observation or an external reference in the evidence list.
3. Pick a drawing mode and draw a point, rectangle, line, arrow, or note.
4. Explicitly associate the mark with a target, relationship, or region if it
   is about one. Drawing over something never associates it.
5. Choose a structured intent, review the candidate, and confirm it.
6. Save the annotation. Each save is a new immutable revision.
7. Optionally, select confirmed runtime intent and promote it to a change
   contract, or select confirmed reference intent and materialize it into a
   new reference revision.

Activating a promoted contract for `check` is a separate explicit choice. A
materialized reference stays `imported` until you approve it with the
existing `approve-reference` command. `view --root <root>` is always
read-only.

To validate the repository itself instead:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm run check:docs
```
