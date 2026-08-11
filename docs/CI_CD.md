# CI/CD

A GitHub Actions pre-release readiness workflow exists at
`.github/workflows/pre-release-readiness.yml` (triggered manually via
`workflow_dispatch`, by pushing a `validation/**` or `release/**` branch, or
by a pull request into `master`). It has two phases:

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
   tarball: real Chromium observations against a disposable local HTTP
   target, covering both the legacy `--target` CSS shorthand and the
   structured `--targets-file` semantic-target path (`role`+accessible-name
   and `text` locators, schema `1.1.0`, landmark evidence,
   targets-file-path privacy, and target immutability).

This proves the same packaged candidate installs and performs a real
observation - CSS-shorthand and semantic alike - on Windows, Linux, and
macOS, not just in the source checkout.

There is no automated npm publication and no automated GitHub Release
creation - this workflow is readiness validation only. Package publication
remains a separate, later, explicit release decision.

## v0.2 readiness coverage

The packed-candidate readiness gap that previously existed for
`--targets-file` has been closed: `scripts/ci/runPackedObservationSmoke.mjs`
now exercises both the legacy CSS-shorthand path and the structured
semantic `--targets-file` path in the same run, on every platform in the
matrix. This was proven on `validation/v0.2-pre-release`
(`2a0718c37cfe6988fc5d9852db455b99aa8238af`), GitHub Actions run
`31537578062`, which passed on Windows, Linux, and macOS using one
hash-verified candidate tarball.
