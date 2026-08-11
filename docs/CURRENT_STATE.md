# Current State

The project is private and unreleased at package version `0.0.0`.

## Greenfield foundation established

The retained repository contains:

- Node.js 24+ and TypeScript ESM package configuration;
- TypeScript build and typecheck configuration;
- ESLint configuration;
- a Vitest runner configured to report honestly when no tests exist;
- a safe `dist/` clean script;
- documentation validation;
- package allowlisting;
- minimal `src/cli.ts` and `src/index.ts` placeholders required by the selected
  TypeScript CLI starter profile;
- complete repository-local Project Description, Project Milestones, ROADMAP,
  and standardized documentation.

The package bin (`src/cli.ts`) now implements the real `observe` command
described below; it is no longer the not-implemented placeholder.

## v0.1 progress (Batch 1–6; implementation complete, not yet release-ready)

- Batch 1 froze and implemented the observation request contract, evidence
  states/sources, schema 1.0.0, observation/request identity, bounded
  readiness semantics, diagnostic/completion semantics, browser/network
  safety policy, and portable path normalization, with 40 passing unit tests.
- Batch 2 added a Playwright Chromium browser boundary (`src/browser/`) and a
  minimal application seam (`src/application/`) that launches a real
  Chromium browser, enforces the Batch 1 loopback/redirect/subresource
  safety policy at runtime, applies the requested viewport, waits for the
  approved bounded readiness condition, captures a real viewport PNG
  screenshot, returns observer-owned browser provenance, and reliably closes
  the browser on every exit path. Deterministic local HTTP fixtures live
  under `tests/fixtures/`; the real-Chromium integration tests live under
  `tests/browser/` and run via `npm run test:browser` (kept separate from
  `npm test`, which continues to run only the fast unit suite).
- Batch 3 extended the same single browser observation (no second Chromium
  lifecycle) to also capture the v0.1 minimum page evidence (requested/final
  URL, title, viewport, device pixel ratio, document scroll/client
  dimensions plus a derived overall document width/height, window scroll
  position) and explicit-target evidence (tag, geometry, computed
  display/position/overflow, scroll/client metrics, initial visibility, and
  role/name where the browser reliably exposes them) for every configured
  CSS target, honoring missing/ambiguous-target semantics honestly. This
  additively extended `src/domain/schema.ts`'s `TargetEvidenceRecord` (new
  `tag`/`layout`/`visibility`/`semantics` categories, and concrete shapes for
  `geometry`/`style`) and `BrowserCaptureResult`; schema version stays
  `1.0.0`.
- Batch 4 added a portable, atomic observation-artifact writer
  (`src/artifacts/artifactWriter.ts`) and a minimal application persistence
  seam (`src/application/observationPersistence.ts`) that assembles the
  frozen `ObservationArtifact` shape from a Batch 2/3 browser capture (using
  the existing Batch 1 identity/completion functions verbatim, no new logic
  invented) and writes it to `<outputLocation>/<observationId>/manifest.json`
  plus `screenshot.png`. Writing happens in a sibling temporary directory
  first (screenshot before manifest), finalized only via one atomic
  directory rename, so a consumer can never observe a partially-written
  artifact under its real name; a filesystem failure anywhere in that
  sequence reports the existing `artifact-write-failure` diagnostic and
  leaves no completed artifact behind. Internal artifact references
  (`screenshot.png`) are relative/portable; the observation's logical
  identity is the existing Batch 1 `observationId`, not its filesystem
  location. The writer has no Playwright dependency and does not modify the
  observed target. Schema stays `1.0.0`.
- Batch 5 wired the existing owners into the real user-facing workflow:
  `src/cli.ts` implements a real `observe` command (thin argument
  parsing/output only - no Chromium, safety, evidence, or filesystem logic
  of its own), and `src/application/observationPersistence.ts` gained one
  `observe()` use case that runs the existing browser capture exactly once
  and, only on success, persists it exactly once through the existing
  artifact writer. CLI syntax errors (malformed `WIDTHxHEIGHT`, malformed
  `id=selector`) are rejected before any browser launches; all domain bounds
  and safety decisions still come from the existing Batch 1 request
  validator and safety policy, not CLI-local logic. A successfully
  persisted observation - including one whose completion state honestly
  reports `partial` - exits `0`; invalid syntax/request, an unpersistable
  browser failure, or a failed artifact write exits nonzero. Package version
  stays `0.0.0`; schema stays `1.0.0`.

So: `my-frontend-observer observe --url ... --viewport ... --target ...
--output ...` is a real, working, source-checkout command that launches
Chromium, produces bounded runtime evidence, and writes a portable local
artifact - proven both via `runCli()`-level tests and a built
`node dist/cli.js observe ...` smoke run against the deterministic fixture.

Batch 6 closed the remaining v0.1 coverage gap (a genuine real-Chromium
navigation failure - connection reset mid-navigation - distinct from a
readiness timeout or a pre-launch safety rejection) and proved the packaged
form of the implementation works independent of the source checkout: the
real `npm pack` tarball, installed fresh in a clean temporary consumer
directory outside the repository, exposes its `my-frontend-observer` bin,
reports the correct version/help text, installs its own Chromium binary via
the consumer-local Playwright toolchain, and performs a real observation
against a disposable local HTTP target - producing a `manifest.json` +
`screenshot.png` artifact identical in shape to the source-checkout result,
without modifying the observed target, and with the temporary consumer/
tarball/output fully cleaned up afterward. Documentation across the
repository was reconciled to this implemented state as part of the same
batch.

## Not implemented

- v0.1 is implemented and packaged-tarball-validated, but it is not yet
  published, tagged, or release-prepared - no version bump, release branch,
  or npm publication has occurred.
- There is no controlled-scroll behavior, target-source correlation, or
  capability beyond the bounded page/target evidence Batches 3-5 established.
- No v0.2–v0.10 capability is implemented.
- No public release, deployment, or hosted CI workflow exists; local package
  validation (this batch) is not cross-platform CI.

## Next target

v0.1 implementation is complete. The next allowed workflow is a separate
pre-release-readiness (cross-platform + security validation) task; it has
not been performed as part of this implementation work.
