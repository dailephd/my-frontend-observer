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

`npm test` runs the fast unit suite only (`tests/unit/`, currently 106
passing tests). `npm run test:browser` runs the real-Chromium integration
suite (`tests/browser/`, currently 69 passing tests) against deterministic
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
package and never imported by production code. It exercises both the
legacy CSS-shorthand `--target` packed-observation shape and the
structured semantic `--targets-file` shape in the same run - see
`docs/CI_CD.md` for the current v0.2 readiness coverage.

`scripts/dev/builtCliTargetsFileSmoke.mjs` is a separate, narrower v0.2
development smoke, added alongside the `--targets-file` implementation: it
runs the built `dist/cli.js` directly (`node dist/cli.js observe
--targets-file ...`) against an inline disposable local HTTP fixture and a
temporary JSON target file, proving a real semantic observation persists a
valid schema-`1.1.0` artifact with no packed-tarball step involved. Run it
locally after `npm run build`:

```powershell
node scripts/dev/builtCliTargetsFileSmoke.mjs
```

Unlike `scripts/ci/runPackedObservationSmoke.mjs`, it is not wired into any
CI workflow and is not a release gate - it is source-checkout development
evidence only, proving the built CLI's `--targets-file` behavior without
installing a packed tarball or requiring cross-platform infrastructure. It
is not part of the published package.
