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

## Current observation workflow (published as 0.3.0)

The real `observe` workflow, part of the published `my-frontend-observer@0.3.0`
package, accepts target configuration through either of two input paths,
plus one optional runtime scroll scenario:

```text
CLI arguments (--url, --viewport, --output, --timeout, exactly one of:
  one-or-more --target <id=css-selector>
  or --targets-file <json-file>,
  plus optionally --scroll-scenario-file <json-file>)
→ (--targets-file only: read + validate the local JSON root wrapper)
→ (--scroll-scenario-file only: read + validate the local JSON root shape -
  a non-array object; the file supplies RawObservationRequest.scrollScenario
  directly, with no wrapper field)
→ request construction (same RawObservationRequest either way)
→ normalizeRequest() - producing canonical {name, locators} targets and
  validating the optional scrollScenario (supported action kind, delta
  bounds/both-zero rule, stable target-name reference)
→ application observation use case (src/application/observationPersistence.ts#observe)
→ Chromium capture: launch, safe navigation, readiness, then - only if a
  scenario was configured - resolve configured targets once, capture an
  initial ScrollRuntimeSnapshot, perform the one immediate scroll
  (window.scrollBy/element.scrollBy, behavior: "instant"), wait exactly two
  requestAnimationFrame cycles, capture a final ScrollRuntimeSnapshot and
  derive transition/scroll-owner evidence; then screenshot and page/target
  evidence (resolving all six locator kinds through the single canonical
  resolver, plus semantic state/landmark/containment evidence), from the
  same live page - exactly once, always describing the final state
→ atomic artifact persistence (manifest.json + screenshot.png), schema
  1.2.0 - exactly once, only on a successful capture; scrollScenarioEvidence
  is simply one more optional manifest field, never a separate file
→ concise CLI result (Observation/State/Artifact/Targets/Diagnostics)
→ process exit status (0 for a persisted observation, including one whose
  state honestly reports "partial"; nonzero otherwise)
```

A request with no scroll scenario is unaffected: no extra snapshots, no
scroll, no extra animation-frame wait, unchanged request identity.

This is exercised by `runCli()`-level tests, real-Chromium end-to-end tests
(`tests/browser/cliObserve.test.ts`, `tests/browser/windowScrollScenario.test.ts`,
`tests/browser/targetScrollScenario.test.ts`), built `node dist/cli.js
observe ...` runs against the deterministic local fixture
(`scripts/dev/builtCliTargetsFileSmoke.mjs` for the semantic `--targets-file`
path, `scripts/dev/builtCliScrollScenarioSmoke.mjs` for the scroll-scenario
path), and the real `npm pack` tarball installed and run from a clean
temporary consumer directory outside the repository, on Windows, Linux, and
macOS (`scripts/ci/runPackedObservationSmoke.mjs`) - the same workflow,
independent of the source checkout.

## Current comparison workflow (implemented on feature branch, unreleased v0.4)

**Current status: implemented on `feature/v0.4-layout-comparison`, not yet
released.** This is a separate workflow from the published v0.3 observation
workflow above - it consumes two already-persisted observation artifacts
rather than producing one, and it never launches a browser:

```text
two prior real "observe" invocations, each producing its own persisted
  ObservationArtifact (before, after) - unrelated to this workflow itself
→ CLI arguments (--before <root>, --after <root>, --output <directory>,
  optionally --config-file <json-file>)
→ (--config-file only: read + validate the local JSON root shape - a
  non-array object; the file supplies ComparisonConfig directly, with no
  wrapper field)
→ read + validate both observation artifacts (src/artifacts/artifactReader.ts,
  the same isValidObservationArtifact structural gate the writer uses)
→ application comparison use case
  (src/application/comparisonService.ts#compareAndPersistFromArtifactRoots
  → compareAndPersist)
→ pure comparison derivation (src/domain/comparisonEngine.ts#compareObservations):
  comparability first, then - only if comparable/comparable-with-warnings -
  deriveLayoutRelationships for each side plus target/page differences,
  relationship changes, and explicit non-causal dependency evidence
→ atomic comparison-artifact persistence (manifest.json only, no copied
  screenshots), schema 1.0.0 - exactly once, for every comparability
  outcome including "incomparable"
→ concise CLI result (Comparison/State/Artifact/Differences/Relationship
  changes/Diagnostics)
→ process exit status (0 for any successfully computed and persisted
  comparison, including "incomparable"; nonzero only for invalid
  syntax/unreadable or invalid source artifacts/invalid configuration/a
  failed write)
```

Source observations are never modified by this workflow. Operational paths
(`--before`/`--after`/`--config-file`/`--output`) never affect
`comparisonRequestId` and are never written into the persisted manifest.

This is exercised by `runCli()`-level tests
(`tests/unit/cli.test.ts`, `tests/unit/cliCompareOrchestration.test.ts`,
`tests/unit/cliCompareEndToEnd.test.ts`), a real-Chromium end-to-end test
(`tests/browser/cliCompare.test.ts`), and built `node dist/cli.js compare
...` runs against real persisted observations from the deterministic local
fixture (`scripts/dev/builtCliCompareSmoke.mjs`). Packed-tarball validation
of `compare` has not yet been added to `scripts/ci/runPackedObservationSmoke.mjs`
- see `docs/CI_CD.md`; that is pre-release-readiness work, not part of
implementation.

## Future workflows

```text
stable targets and bounded runtime behavior
→ relationships and before/after comparison (implemented, unreleased - see above)
→ safe-change contracts
→ bounded agent context plus runtime/static ecosystem integration
→ text/config-driven coding-agent change review
→ interactive viewer
→ structured visual annotation
→ full visual human–LLM workflow
```

Safe-change contracts (v0.5+) and everything after remain unimplemented. The
v0.7 coding-agent workflow must work without the v0.8 viewer or v0.9
annotation system.
