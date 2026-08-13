# Quickstart

Prerequisites are Node.js 24 or later and npm.

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

To validate the repository itself instead:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm run check:docs
```
