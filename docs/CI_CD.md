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

## v0.4 readiness coverage

The packed-candidate readiness gap that previously existed for the v0.4
`compare` public command - identified during the v0.4 implementation/
documentation audit as `V0_4_READINESS_VALIDATION_GAP_EXISTS` - has been
closed: `scripts/ci/runPackedObservationSmoke.mjs` now also installs the
candidate tarball, observes a deterministic before/after fixture through
the installed `observe`, and runs the installed `compare` against both
resulting artifacts, asserting (through the *installed package's own*
exported `isValidComparisonArtifact`/`isValidObservationArtifact`, resolved
from the consumer's own `node_modules` rather than the source checkout):
comparison artifact kind/schema `1.0.0`, a `comparable` result with a real
`moved`+`resized` target difference and a real relationship-family
transition (`does-not-overlap`→`overlaps` and `left-of`→
`horizontally-overlapping` simultaneously - the same pair the v0.4
relationship-family matching regression concerns), an explicit
`--config-file` non-causal dependency-evidence result, an `incomparable`
result (differing viewport) with the expected blocking comparability
reason and no fabricated ordinary differences, comparison-manifest path
privacy (no absolute operational path leakage), retained (never copied)
before/after screenshot references, a `manifest.json`-only comparison
directory, and byte-identical source-observation manifests/screenshots
before and after comparing - on every platform in the matrix, using the
same single hash-verified candidate tarball as the legacy/semantic/scroll
observations. This preserves every pre-existing v0.1-v0.3 packed
observation proof unchanged and adds the v0.4 proof additively, in the same
script and the same candidate, per the established same-candidate
architecture (no second `npm pack`, no per-platform rebuild).

## v0.5 readiness coverage

The packed-readiness coverage gap identified during the v0.5 implementation-
completeness audit as `V0_5_READINESS_VALIDATION_GAP_EXISTS` - the packed
candidate smoke exercised `observe`/`compare` but not `approve-baseline`/
`save-change-contract`/`evaluate-contract` - has been **corrected locally**:
`scripts/ci/runPackedObservationSmoke.mjs` now also installs the same
candidate tarball, observes a deterministic navigation/workspace/rail
fixture through the installed `observe`, and drives the complete installed
`approve-baseline` → `save-change-contract` → `observe` (candidate) →
`compare` → `evaluate-contract` sequence, proving both a fully successful
contract change (overall `PASS`, `--enforce` still exits `0`) and the
milestone-signature failure (a locally successful requested/expected-
dependent change alongside a real protected right-rail regression and a
real preserved navigation-clipping regression, overall `FAIL`) - including
`--enforce` producing a nonzero exit for the identical `FAIL` evidence
(`evaluationRequestId` and `clauseResults` unchanged), full source
observation/comparison/contract-artifact immutability, no copied
screenshots, and no repository-root artifact leakage. All product behavior
under test is invoked through the installed tarball's own executable, never
imported from the source checkout. This addition is exercised in every
existing matrix lane (`windows-latest`, `ubuntu-latest`, `macos-latest`)
because all three already invoke this same script against the same
candidate tarball - no workflow YAML change was required.

This correction has since been proven cross-platform on the validation
branch `validation/v0.5-pre-release`, first tested at commit
`90255a9175503664f3e65d4114ee205176b7040a`: GitHub Actions run
[`31727856546`](https://github.com/dailephd/my-frontend-observer/actions/runs/31727856546)
passed completely - the candidate job (Linux, Node 24) and all three
`matrix-smoke` lanes (`windows-latest` Node v24.18.1, `ubuntu-latest` Node
v24.19.0, `macos-latest` Node v24.18.0) - using one shared candidate
tarball, `my-frontend-observer-0.4.0.tgz`, SHA-256
`9533a53e475614cd80a29dfa8b0f85e533e3ad736596579f559479e90e78941a`,
independently hash-verified by each of the three matrix lanes before any of
them ran the smoke (no lane built its own tarball). Every lane's
`smoke-summary.json` reported byte-identical v0.5 evidence: the installed
candidate's `approve-baseline`/`save-change-contract`/`evaluate-contract`
`--help` all present, a real successful contract change (overall `PASS`,
`--enforce` exits `0`), and the real milestone-signature failure (requested/
expected-dependent `pass`, protected/preserved `fail`, overall `FAIL`,
identical `evaluationRequestId`/`clauseResults` with `--enforce` exiting `1`
and without it exiting `0`), plus source-artifact immutability, no copied
screenshot, no path leakage, and no repository-root leakage - alongside
every pre-existing v0.1-v0.4 packed observe/compare/scroll assertion, still
passing unchanged on all three platforms.

## v0.6 readiness note (implemented and canonically verified; release pending)

`.github/workflows/pre-release-readiness.yml`'s existing candidate-job steps
(`npm test`, `npm run test:browser`, `npm run test:security`, `npm run
build`, `npm run check:docs`) already cover the v0.6 bounded-agent-context
and correlation modules, since they are part of the same `src/`/`tests/unit/`
tree exercised by `npm test`. However, `scripts/ci/runPackedObservationSmoke.mjs`
(the matrix-smoke packed-candidate proof) does not yet exercise
bounded-agent-context, because v0.6 adds no new CLI command and no disk
artifact for the packed candidate to observe end-to-end - it is a
programmatic export surface only (see `docs/CONTRACTS.md`). This is a
genuine readiness gap for a future v0.6 release-preparation stage to address
(e.g. an installed-package import smoke of the exported functions), not
something corrected as part of this documentation reconciliation.
