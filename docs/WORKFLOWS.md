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

## Current source-branch v0.3 scroll-scenario workflow (implemented, not yet published)

`feature/v0.3-runtime-scrolling` extends the same workflow with one optional
input; it is not part of the published `0.2.0` package. Package version
remains `0.2.0`; observation schema is `1.2.0`.

```text
CLI arguments, as above, plus optionally exactly one:
  --scroll-scenario-file <json-file>
→ (--scroll-scenario-file only: read + validate the local JSON root shape -
  a non-array object; the file supplies RawObservationRequest.scrollScenario
  directly, with no wrapper field)
→ request construction (same RawObservationRequest either way)
→ normalizeRequest() - validating the optional scrollScenario alongside
  targets/viewport/readiness (supported action kind, delta bounds/both-zero
  rule, stable target-name reference)
→ application observation use case (unchanged - observe())
→ Chromium capture: navigate, ready, then - only if a scenario was
  configured - resolve configured targets once, capture an initial
  ScrollRuntimeSnapshot, perform the one immediate scroll
  (window.scrollBy/element.scrollBy, behavior: "instant"), wait exactly two
  requestAnimationFrame cycles, capture a final ScrollRuntimeSnapshot and
  derive transition/scroll-owner evidence - all before the unchanged
  screenshot/page-evidence/target-evidence capture, so every downstream
  capture (scenario or not) describes only the final state
→ atomic artifact persistence (manifest.json + screenshot.png), schema
  1.2.0 - exactly once, only on a successful capture; scrollScenarioEvidence
  is simply one more optional manifest field, never a separate file
→ concise CLI result (Observation/State/Artifact/Targets/Diagnostics,
  unchanged in shape) → process exit status (unchanged semantics)
```

A request with no scroll scenario is unaffected: no extra snapshots, no
scroll, no extra animation-frame wait, unchanged request identity. This is
exercised by `runCli()`-level tests, real-Chromium end-to-end tests
(`tests/browser/cliObserve.test.ts`, `tests/browser/windowScrollScenario.test.ts`,
`tests/browser/targetScrollScenario.test.ts`), and a built
`node dist/cli.js observe ...` run
(`scripts/dev/builtCliScrollScenarioSmoke.mjs`) - source-checkout
development evidence only, not cross-platform packed-release validation.

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
