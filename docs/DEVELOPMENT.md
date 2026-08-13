# Development

Install the current scaffold with `npm install`. Node.js 24+ is required.

Since Batch 2, the package depends on `playwright` for the Chromium browser
boundary. Install the browser binary once per machine with:

```powershell
npx playwright install chromium
```

The applicable foundation validation chain is:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm run check:docs
npm pack --dry-run
```

`npm test` runs the fast unit suite only (`tests/unit/`, currently 176
passing tests). `npm run test:browser` runs the real-Chromium integration
suite (`tests/browser/`, currently 88 passing tests) against deterministic
local fixtures under `tests/fixtures/` and requires the Chromium binary
above to be installed first; it is kept out of `npm test` because it
launches a real browser and is slower.

ROADMAP v0.1 and Project Milestone 1 require browser-level validation once the
observation capability is planned and implemented. Static checks must not later
be substituted for that required browser evidence. `npm run test:browser` is
that required browser evidence and covers the full source-checkout v0.1
workflow end to end: page/target evidence, atomic artifact persistence, and
the real `observe` CLI (including a built `node dist/cli.js observe ...`
smoke run) are all implemented and covered, including a deterministic
real-navigation-failure case (distinct from a readiness timeout or a
pre-launch safety rejection).

For maintainers validating the package boundary itself (not required for
routine development): `npm pack --dry-run` inspects the tarball contents;
installing the real tarball (`npm pack --json`, then `npm install
<tarball>` in a clean temporary directory) and running the installed bin
against a disposable local HTTP target is the way to confirm the packaged
CLI performs a real observation independent of the source checkout. This is
local package validation only, not a release procedure.

`npm run test:security` runs only the safety-relevant subset of the suite
(`tests/unit/policy.test.ts` plus the real-Chromium enforcement cases in
`tests/browser/chromiumAdapter.test.ts`) - a discoverable entry point for
security review tooling, not a replacement for `npm test`/`npm run
test:browser`.

`scripts/ci/runPackedObservationSmoke.mjs <tarball-path>` is the same
packed-candidate smoke described above, packaged as a reusable script: it
installs the given tarball into a fresh temporary consumer directory,
installs Chromium via that consumer's own Playwright dependency, runs the
installed bin against a disposable local HTTP target it creates itself, and
validates the resulting artifact - exiting nonzero on any contract failure.
It is what `.github/workflows/pre-release-readiness.yml` runs identically on
Windows, Linux, and macOS against one shared candidate tarball (see
`docs/CI_CD.md`); it can also be run locally the same way the workflow runs
it. It is readiness/CI infrastructure only, not part of the published
package and never imported by production code. In the same run it
exercises the legacy CSS-shorthand `--target` packed-observation shape,
the structured semantic `--targets-file` shape, a `window-scroll-by`
scroll scenario, and a `target-scroll-by` scroll scenario - see
`docs/CI_CD.md` for the current readiness coverage.

`scripts/dev/builtCliTargetsFileSmoke.mjs` is a separate, narrower v0.2
development smoke, added alongside the `--targets-file` implementation: it
runs the built `dist/cli.js` directly (`node dist/cli.js observe
--targets-file ...`) against an inline disposable local HTTP fixture and a
temporary JSON target file, proving a real semantic observation persists a
valid schema-`1.2.0` artifact with no packed-tarball step involved. Run it
locally after `npm run build`:

```powershell
node scripts/dev/builtCliTargetsFileSmoke.mjs
```

`scripts/dev/builtCliScrollScenarioSmoke.mjs` is the v0.3 equivalent, added
alongside the `--scroll-scenario-file` implementation: it runs the built
`dist/cli.js` directly against an inline disposable local HTTP fixture,
once with a temporary `window-scroll-by` scenario file and once with a
temporary structured `--targets-file` plus a `target-scroll-by` scenario
file, proving both real runtime scroll actions persist a valid
schema-`1.2.0` artifact with populated `scrollScenarioEvidence`,
scenario-file path privacy, and target-application immutability. Run it
locally after `npm run build`:

```powershell
node scripts/dev/builtCliScrollScenarioSmoke.mjs
```

`scripts/dev/builtCliCompareSmoke.mjs` is the v0.4 equivalent, added
alongside the `compare` command implementation (shipped as part of the
published `0.4.0` package - see `docs/CURRENT_STATE.md`): it runs the built
`dist/cli.js` twice as
`observe` against an inline disposable local HTTP fixture whose served
content changes deterministically between the two runs (a real moved/
resized target, and a page-width transition from fitting to exceeding the
viewport), then runs the built `dist/cli.js compare` against the two
resulting persisted observation artifacts. It validates artifact kind/
schema `1.0.0`, `comparability: "comparable"`, source observation
references, at least one real `moved` difference and one real page-width
relationship change, that the comparison directory contains `manifest.json`
only, that no operational filesystem path leaked into the persisted
manifest, and that both source observation manifests are byte-identical
before and after the comparison ran. Run it locally after `npm run build`:

```powershell
node scripts/dev/builtCliCompareSmoke.mjs
```

`scripts/dev/builtCliFrontendContractsSmoke.mjs` is the v0.5 Batch 4
equivalent, added alongside the `approve-baseline`/`save-change-contract`/
`evaluate-contract` command implementations (implemented on
`feature/v0.5-frontend-contracts`, not yet released - see
`docs/CURRENT_STATE.md`). Unlike the other dev smokes, it needs no Chromium
at all: it hand-writes deterministic, schema-`1.2.0`-valid observation
manifests directly to a temporary directory (preserving the public
observation artifact contract without a real browser capture), then runs
the built `dist/cli.js` for `compare`, `approve-baseline`,
`save-change-contract`, and `evaluate-contract` - twice for the final
step, once without `--enforce` and once with it, against the same
milestone-signature contract (requested navigation shrink = pass, expected
workspace expansion = pass, protected right-rail width = fail, preserved
unclipped navigation = fail, overall = `FAIL`). It validates both exit
codes (`0` without `--enforce`, nonzero with it), that both invocations
persist byte-for-byte semantically identical evaluation evidence
(`evaluationRequestId` and `clauseResults` equal), that the evaluation
directory contains `manifest.json` only, that no operational filesystem
path leaked into either persisted evaluation manifest, and that every
source observation/comparison/contract artifact remains unmodified. Run it
locally after `npm run build`:

```powershell
node scripts/dev/builtCliFrontendContractsSmoke.mjs
```

Unlike `scripts/ci/runPackedObservationSmoke.mjs`, none of these four dev
smokes is wired into any CI workflow or is a release gate - they are
source-checkout development evidence only, proving the built CLI's
`--targets-file`/`--scroll-scenario-file`/`compare`/frontend-contract
command behavior without installing a packed tarball or requiring
cross-platform infrastructure. None is part of the published package.
Cross-platform packed validation of the v0.1-v0.4 observation/compare
behavior is `scripts/ci/runPackedObservationSmoke.mjs`'s responsibility (see
`docs/CI_CD.md`) - the same script, against the same single candidate
tarball per platform; the v0.5 contract/evaluation CLI is not yet part of
that packed validation.
