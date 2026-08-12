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
   tarball: four real Chromium observations against a disposable local HTTP
   target - the legacy `--target` CSS shorthand, the structured
   `--targets-file` semantic-target path (`role`+accessible-name and `text`
   locators, landmark evidence), a `--scroll-scenario-file` `window-scroll-by`
   scenario, and a combined `--targets-file` + `--scroll-scenario-file`
   `target-scroll-by` scenario against a nested scrollable container - all
   asserting schema `1.2.0`, real scroll-position movement, derived
   scroll-owner evidence (`document`/`target:<name>`), scenario transition
   evidence, targets-file/scroll-scenario-file path privacy, and target
   immutability.

This proves the same packaged candidate installs and performs a real
observation - CSS-shorthand, semantic-target, and v0.3 scroll-scenario alike
(both `window-scroll-by` and `target-scroll-by`) - on Windows, Linux, and
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

## v0.3 readiness coverage

The packed-candidate readiness gap that previously existed for the v0.3
`--scroll-scenario-file` public interface - identified during the v0.3
implementation-completeness audit as `V0_3_READINESS_VALIDATION_GAP_EXISTS`
- has been closed: `scripts/ci/runPackedObservationSmoke.mjs` now also
performs a real `window-scroll-by` observation and a real `target-scroll-by`
observation (against a nested scrollable fixture container, combined with
`--targets-file`) through the installed tarball, asserting schema `1.2.0`,
actual scroll movement, `document`/`target:<name>` scroll-owner evidence
with `derivedFrom` provenance, scenario transition evidence, and that
neither the `--targets-file` nor the `--scroll-scenario-file` local path is
ever persisted into the manifest - on every platform in the matrix, using
the same single hash-verified candidate tarball as the legacy/semantic
observations. This was proven on `validation/v0.3-pre-release`
(`e59621c2fb5a6d74f491a63dc79ebe6e8b62c175`), GitHub Actions run
`31591920744`, which passed on Windows, Linux, and macOS using one
hash-verified candidate tarball (SHA-256
`da6cbc18a98d005b84a2f12c06f5c01d390006b53c02176a6c9cdc6d9b9d24d0`) - the
release candidate for `v0.3.0`.

## v0.4 readiness gap (known, not yet closed)

v0.4's `compare` command is implemented on `feature/v0.4-layout-comparison`
(source-checkout `npm run build` and the built-CLI dev smoke
`scripts/dev/builtCliCompareSmoke.mjs` both exercise it directly against
`dist/cli.js` - see `docs/DEVELOPMENT.md`), but
`scripts/ci/runPackedObservationSmoke.mjs` has **not** been updated to
install a candidate tarball and exercise `compare` from within it. This is
a known, expected pre-release-readiness gap, not an implementation defect:
the later v0.4 pre-release-readiness workflow must extend the packed smoke
(or add an equivalent packed-candidate script) to prove `compare` works
identically to `observe` when installed from a real tarball in a clean
consumer environment, on every platform in the matrix, before `v0.4.0` is
tagged.
