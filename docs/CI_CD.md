# CI/CD

A GitHub Actions pre-release readiness workflow exists at
`.github/workflows/pre-release-readiness.yml` (triggered manually via
`workflow_dispatch` or by pushing a `validation/**` branch). It has two
phases:

1. **candidate** (Linux, Node 24): `npm ci`, install Chromium, typecheck,
   lint, `npm test`, `npm run test:browser`, `npm run test:security`,
   build, `npm run check:docs`, then `npm pack` to produce exactly one
   candidate tarball and its SHA-256, uploaded as build artifacts.
2. **matrix-smoke** (`windows-latest`, `ubuntu-latest`, `macos-latest`, all
   Node 24): each job downloads the *same* candidate tarball produced by the
   candidate job, independently recomputes and verifies its SHA-256 against
   the candidate job's hash (failing immediately on any mismatch - no job
   ever builds its own tarball), installs Chromium via the installed
   package's own Playwright dependency, and runs
   `scripts/ci/runPackedObservationSmoke.mjs` against the installed
   tarball: a real Chromium observation against a disposable local HTTP
   target, with artifact/schema/screenshot/target-immutability assertions.

This proves the same packaged candidate installs and performs a real
observation on Windows, Linux, and macOS, not just in the source checkout.

There is no automated npm publication and no automated GitHub Release
creation - this workflow is readiness validation only, run from a
`validation/**` branch, never from a release branch or tag. Package
publication remains a separate, later, explicit release decision.

## v0.2 readiness coverage gap

As of this writing, `scripts/ci/runPackedObservationSmoke.mjs` (the script
`matrix-smoke` runs on every platform) still only invokes the packed CLI
with `--target <id=selector>` (the legacy v0.1 CSS shorthand) - it does not
exercise `--targets-file` or any of the six v0.2 semantic locator kinds.
`--targets-file` has real-Chromium end-to-end coverage in the source
checkout (`tests/browser/cliObserve.test.ts`) and a source-checkout-only
built-CLI smoke (`scripts/dev/builtCliTargetsFileSmoke.mjs`, see
`docs/DEVELOPMENT.md`), but neither proves the semantic target-file
workflow through the *packed npm tarball* on Windows, Linux, and macOS the
way the existing CSS-shorthand path is proven. This is a
**V0_2_READINESS_VALIDATION_GAP_EXISTS** classification, not an
implementation gap: the product capability is complete and tested in the
source checkout; only the packaged-candidate cross-platform readiness
script has not yet been extended to exercise it. Extending
`runPackedObservationSmoke.mjs` (or adding an equivalent packed
`--targets-file` case) is required work for the next v0.2 pre-release
readiness workflow, not for this documentation task.
