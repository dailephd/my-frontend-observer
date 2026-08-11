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

## Current v0.1 observation workflow

The real, source-checkout `observe` workflow is:

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
of the source checkout. It has not been published to a registry.

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
