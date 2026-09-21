# CI/CD

CI interprets `check` as PASS `0`, FAIL `1`, REVIEW_REQUIRED `2`, or BLOCKED `3`. The released package is `@dailephd/my-frontend-observer@0.9.1`; its CLI remains `my-frontend-observer`. Packed readiness installs one exact tarball and runs `runPackedViewerSmoke.mjs` as the single project/viewer smoke owner for `init`, `capture`, bounded `check --json` REVIEW_REQUIRED and unchanged-contract FAIL-to-PASS, alias-aware project `view`, and viewer security. `runPackedObservationSmoke.mjs` remains the lower-level legacy observation smoke.

## Gate isolation invariant

Cross-platform/full-suite success does not by itself prove that a security or
acceptance gate is independent. Any test explicitly labeled `HARD GATE`,
`SECURITY GATE`, or `ACCEPTANCE GATE` must also be able to run from fresh
state without relying on earlier test order, a previously warmed service-worker
cache, a persistent browser profile from an earlier run, or another test's
server/evidence setup.

v0.9.1 applies this rule to the PWA server-down
hard gate. `npm run test:pwa-hard-gate` runs that gate by itself. It is a
separate required proof in addition to the normal full-file execution in
`npm run test:browser` and `npm run test:security`.

`npm run test:security` now ends with `npm run test:pwa-hard-gate`. The
`candidate` job in `.github/workflows/pre-release-readiness.yml` already runs
`npm run test:security`, so release-readiness candidate validation receives
the isolated gate automatically. The workflow YAML did not need to change. The
released v0.9.1 suite contains the corrected isolated gate. No production PWA
regression was found.

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

## v0.6 packed-candidate coverage (released as `0.6.0`)

`.github/workflows/pre-release-readiness.yml`'s existing candidate-job steps
(`npm test`, `npm run test:browser`, `npm run test:security`, `npm run
build`, `npm run check:docs`) cover the v0.6 bounded-agent-context and
correlation modules, since they are part of the same `src/`/`tests/unit/`
tree exercised by `npm test`. `scripts/ci/runPackedObservationSmoke.mjs`
(the matrix-smoke packed-candidate proof) now also exercises the installed
package's bounded-agent-context and runtime/static correlation public
export surface directly - bounded projection, adequacy, omission/
truncation, deterministic request identity vs. fresh instance identity,
`correlated`/`ambiguous`/`unavailable` correlation outcomes, v0.5
scope-inheritance, schema validation, and input immutability - since v0.6
adds no new CLI command and no disk artifact for the packed candidate to
observe end-to-end; it is a programmatic export surface only (see
`docs/CONTRACTS.md`). This closed the readiness gap identified during v0.6
pre-release validation. The final pre-release candidate
(`acd067247c447294a611f37f52eab301b6038ab1c6d493ae65e81c2f1279bfd7`) passed
Windows, Linux, and macOS using that one hash-verified tarball (GitHub
Actions run `32304059259`) before the `0.6.0` release below.

## v0.7 packed-candidate coverage (released as `0.7.0`)

The v0.7 pre-release readiness stage identified the same class of gap
`scripts/ci/runPackedObservationSmoke.mjs` had already closed for every
prior version: the packed-candidate smoke exercised `observe`/`compare`/
`approve-baseline`/`save-change-contract`/`evaluate-contract` and the v0.6
bounded-agent-context/correlation exports, but none of v0.7's new surface.
This was closed the same way as every prior version's gap - one narrow,
additive extension to the existing script, never a second parallel
framework: the installed candidate's `import-reference --help`/
`approve-reference --help`/`evaluate-reference-fidelity --help`; a real
external-reference image imported and approved through the installed CLI
with explicit regions, three requirement kinds (`region-property`,
`region-relationship`, and both `exact`/`absolute-reference-px` tolerance
kinds), and a declared `applicability.viewport`; explicit region↔runtime-
target bindings reusing the existing v0.5 contract-fixture geometry; a
genuine fidelity `pass` and a genuine fidelity `fail` (each checked with and
without `--enforce`, mirroring `evaluate-contract`'s own PASS/FAIL/
`--enforce` proof pattern); an `observe --state-file` explicit-state
round-trip; and the installed package's programmatic
`evaluateReferenceCandidateFidelityFromArtifactRoots`/
`prepareReferenceCorrection`/`reviewReferenceCorrectionAttempt` exports,
including a `prepareReferenceCorrection` handoff carrying a bounded-agent-
context artifact (exercising the v0.7 bounded fidelity projection and its
v0.6 bounded-agent-context integration together) and both a `pass` and a
`fail` `reviewReferenceCorrectionAttempt` outcome - all resolved from the
installed package's own `node_modules`, never the source checkout, and all
re-verified against a re-hash of the pre-existing source observation
manifest to confirm none of the new calls mutated it.

This was proven cross-platform on the validation branch
`validation/v0.7-pre-release` at commit
`b2286bdc9550d70fa1047a1f732968a8eca46a1e`: GitHub Actions run
[`34054085344`](https://github.com/dailephd/my-frontend-observer/actions/runs/34054085344)
passed completely - the candidate job (Linux, Node 24) and all three
`matrix-smoke` lanes (`windows-latest` Node v24.19.0, `ubuntu-latest` Node
v24.20.0, `macos-latest` Node v24.20.0) - using one shared **pre-version-
bump implementation candidate** tarball, `my-frontend-observer-0.6.0.tgz`
(package version still `0.6.0` at that point in the readiness stage - the
version bump to `0.7.0` happened only afterward, during release
preparation; this tarball itself was never version `0.7.0`), SHA-256
`0347b1f3cfd5d311e13b405c0c2fbc2f507e250cb63223d58b4d2d31df029414`,
independently hash-verified by each of the three matrix lanes before any of
them ran the smoke (no lane built its own tarball). Every lane's
`smoke-summary-<os>.json` reported the same v0.7 evidence described above,
alongside every pre-existing v0.1-v0.6 packed assertion, still passing
unchanged on all three platforms - see
`docs/reports/v0.7-pre-release-readiness.md` for the complete readiness
report.

## v0.8.1 packaging implications (released as `0.8.1`; formal cross-platform readiness passed)

v0.8.1 is released as `@dailephd/my-frontend-observer@0.8.1` - see
`docs/CURRENT_STATE.md`. `.github/workflows/pre-release-readiness.yml`'s
matrix now covers it: alongside the pre-existing packed-observation smoke,
each platform runner also installs the exact candidate tarball and runs
`scripts/ci/runPackedViewerSmoke.mjs`, proving in real Chromium that the
installed `view` command binds to loopback only, indexes real evidence,
renders the SVG target overlay and a reference view, enforces its read-only
API, rejects path traversal, registers its service worker, never caches
`/api/` responses as authoritative, and never presents stale evidence once
the server is stopped.

`npm run build` builds both the Node/CLI output (`tsc -p tsconfig.json`) and
the browser-side viewer application plus its PWA assets (`vite build
--config viewer/vite.config.ts` into `dist/viewer` - service worker,
manifest, precached app shell); the existing `files` package allowlist
(`dist`, `README.md`, `CHANGELOG.md`, `docs`) already includes
`dist/viewer`, so no separate publish boundary was created for the viewer;
the existing CLI/library commands (`observe` through
`evaluate-reference-fidelity`) remain packaged and unchanged; and package
version stays independent of every schema version, as for every prior
release.

Formal Windows/Linux/macOS cross-platform validation - the same exact
hash-verified candidate tarball on every platform - and a formal security
audit (which found and fixed one real finding: a symlinked-media
evidence-root escape in the viewer's media route) both passed before this
release - see
`docs/reports/v0.8-prerelease-readiness-cross-platform-security-code-rot.md`
for the complete readiness report.

## v0.9 packaging implications (released in 0.9.0; final cross-platform readiness passed)

v0.9 visual annotation is released as `@dailephd/my-frontend-observer@0.9.0`.
Final exact-candidate readiness passed on Windows, Linux and macOS - see
`docs/reports/v0.9-final-pre-release-readiness.md`.
`.github/workflows/pre-release-readiness.yml` keeps the same exact-candidate
structure:

1. The `candidate` job runs once on Linux with Node 24. It runs every local
   validation command, builds the package, creates one tarball with
   `npm pack --json`, freezes its SHA-256, and uploads both.
2. The `matrix-smoke` job runs on `windows-latest`, `ubuntu-latest`, and
   `macos-latest` with Node 24. Each lane downloads that same tarball and
   fails if its SHA-256 differs.
3. Each lane installs the tarball into a clean consumer and runs three packed
   smokes in real Chromium:
   1. `scripts/ci/runPackedObservationSmoke.mjs` (observation and low-level
      command behavior), writing `smoke-summary.json`;
   2. `scripts/ci/runPackedViewerSmoke.mjs` (project workflow and
      project-aware viewer inspection), writing `viewer-smoke-summary.json`;
   3. `scripts/ci/runPackedV09AnnotationSmoke.mjs` (v0.9 annotation), writing
      `v09-annotation-smoke-summary.json`.
4. All three summaries are uploaded as the `smoke-summary-<os>` artifact.

The v0.9 annotation smoke uses only the installed package. It checks that the
compiled v0.9 owners and the built viewer are in the tarball, that the bare
package specifier and Playwright resolve inside the consumer's own
`node_modules`, and that the public v0.9 exports resolve. It then runs
`init`, `capture baseline`, and `check baseline --json`, and starts the
project-aware `view` (viewer protocol `1.3.0`, authoring enabled). In real
Chromium it saves and reloads a runtime annotation, promotes confirmed move
intent into a canonical change contract, imports a reference with the
installed `import-reference`, annotates it, and materializes a confirmed
region into a new imported revision. That revision must supersede the source,
reuse its exact image bytes, and not be approved. Finally it starts a
standalone `view --root` session and proves it is read-only. The summary never
contains the authoring token, absolute project paths, or note text.

The standalone read-only proof for v0.9 authoring lives in the v0.9
annotation smoke. The project-aware inspection and project workflow proof
lives in the packed viewer smoke.

A separate `tutorial-readiness` job runs on the same three operating systems.
It builds Observer from the repository source and runs
`scripts/run-v09-tutorial-readiness.mjs`, which validates and runs the four
`examples/v09-demo/tutorials/` scenarios through the external tool
`@dailephd/my-dev-kit-lab@0.4.9`, then reads the evidence each run wrote back
through the canonical Observer readers. It fails unless every scenario passes
with empty `cleanupErrors`, the tracked demo source is unchanged, and the
repository status is unchanged. The demo and the lab are repository release
support only. Neither is in the npm package or an Observer dependency.

The v0.9 matrix wiring has not yet run in GitHub Actions for this candidate.
The local Windows run of all three smokes against one exact tarball is
recorded in `docs/reports/v0.9-batch7-integrated-acceptance.md`.
