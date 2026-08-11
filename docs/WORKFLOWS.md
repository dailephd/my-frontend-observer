# Workflows

## Current validation workflow

```text
install dependencies (npm install; npx playwright install chromium)
→ validate types and lint
→ run the fast unit suite (npm test)
→ run the real-Chromium integration suite (npm run test:browser)
→ build the CLI/library entries (npm run build)
→ validate documentation (npm run check:docs)
```

## Current observation workflow (published as 0.2.0)

The real `observe` workflow, part of the published `my-frontend-observer@0.2.0`
package, accepts target configuration through either of two input paths:

```text
CLI arguments (--url, --viewport, --output, --timeout, and exactly one of:
  one-or-more --target <id=css-selector>
  or --targets-file <json-file>)
→ (--targets-file only: read + validate the local JSON root wrapper)
→ request construction (same RawObservationRequest either way)
→ normalizeRequest() - producing canonical {name, locators} targets
→ application observation use case (src/application/observationPersistence.ts#observe)
→ Chromium capture (launch, safe navigation, readiness, screenshot,
  page/target evidence), resolving all six locator kinds through the single
  canonical resolver, plus semantic state/landmark/containment evidence,
  from the same live page - exactly once
→ atomic artifact persistence (manifest.json + screenshot.png), schema
  1.1.0 - exactly once, only on a successful capture
→ concise CLI result (Observation/State/Artifact/Targets/Diagnostics)
→ process exit status (0 for a persisted observation, including one whose
  state honestly reports "partial"; nonzero otherwise)
```

This is exercised by `runCli()`-level tests, real-Chromium end-to-end tests
(`tests/browser/cliObserve.test.ts`), a built
`node dist/cli.js observe ...` run against the deterministic local fixture
(including `scripts/dev/builtCliTargetsFileSmoke.mjs` for the semantic
`--targets-file` path), and the real `npm pack` tarball installed and run
from a clean temporary consumer directory outside the repository, on
Windows, Linux, and macOS - the same workflow, independent of the source
checkout.

The future dependency order after observation is:

```text
stable targets and bounded runtime behavior
→ relationships, comparison, and safe-change contracts
→ bounded agent context plus runtime/static ecosystem integration
→ text/config-driven coding-agent change review
→ interactive viewer
→ structured visual annotation
→ full visual human–LLM workflow
```

None of these later workflows is implemented. The v0.7 coding-agent workflow
must work without the v0.8 viewer or v0.9 annotation system.
