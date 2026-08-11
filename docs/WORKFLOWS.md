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

## Current v0.1 observation workflow (published)

The real `observe` workflow, part of the published `my-frontend-observer@0.1.0`
package, is:

```text
CLI arguments (--url, --viewport, --target, --output, --timeout)
→ request construction
→ existing Batch 1 request validation/normalization
→ application observation use case (src/application/observationPersistence.ts#observe)
→ existing Chromium capture (launch, safe navigation, readiness, screenshot,
  page/target evidence) - exactly once
→ existing atomic artifact persistence (manifest.json + screenshot.png) -
  exactly once, only on a successful capture
→ concise CLI result (Observation/State/Artifact/Targets/Diagnostics)
→ process exit status (0 for a persisted observation, including one whose
  state honestly reports "partial"; nonzero otherwise)
```

This is exercised by `runCli()`-level tests, by a built
`node dist/cli.js observe ...` run against the deterministic local fixture,
and by the real `npm pack` tarball installed and run from a clean temporary
consumer directory outside the repository - the same workflow, independent
of the source checkout.

## Current v0.2 observation workflow (implemented on the current branch, not yet released)

On the current `feature/v0.2-stable-semantic-targets` branch, target
configuration gains a second, structured input path - not a second
workflow:

```text
CLI arguments (--url, --viewport, --output, --timeout, and exactly one of:
  one-or-more --target <id=css-selector>
  or --targets-file <json-file>)
→ (--targets-file only: read + validate the local JSON root wrapper)
→ request construction (same RawObservationRequest either way)
→ existing normalizeRequest() - now producing canonical {name, locators} targets
→ existing application observation use case
→ existing Chromium capture, now resolving all six locator kinds through the
  single canonical resolver, plus semantic state/landmark/containment
  evidence, from the same live page - exactly once
→ existing atomic artifact persistence, now schema 1.1.0
→ the same concise CLI result and exit-status contract as v0.1
```

Exercised by `runCli()`-level tests, real-Chromium end-to-end tests
(`tests/browser/cliObserve.test.ts`), and a built
`node dist/cli.js observe --targets-file ...` smoke
(`scripts/dev/builtCliTargetsFileSmoke.mjs`). This workflow is **not** part
of the published `my-frontend-observer@0.1.0` package; it exists only on
the current source checkout/branch pending a future v0.2 release.

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
