# Current State

The project is published at package version `0.2.0` (roadmap v0.2, Stable
Semantic Targets and Region Identity; observation schema `1.1.0`).

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

## v0.1 progress (Batch 1–6; implemented and released as 0.1.0)

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
  is `0.1.0`; schema stays `1.0.0`.

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

## v0.1 status

`v0.1.0` was the first published release (see `CHANGELOG.md` and
`docs/RELEASE.md`). Everything above this section describes that released
state, still present unchanged in `v0.2.0`.

## v0.2 status (Stable Semantic Targets and Region Identity) - released as 0.2.0

v0.2 is implemented and released as package version `0.2.0`, observation
schema `1.1.0`.

- **Canonical target/locator model.** Each configured target has a stable
  observer-owned `name` plus an ordered, bounded `locators` array
  (`src/request/request.ts#TargetLocator`, `NamedTarget`). This identity is
  distinct from both the browser locator that resolves it and any
  source-code symbol. The legacy `{name, selector}` shape remains accepted
  and normalizes to a one-item `css` locator, so every v0.1 CLI invocation
  continues to work unchanged. Bounds: 20 targets max, 5 locators per
  target max (unchanged/new respectively from v0.1's target count bound).
- **Six frozen locator kinds, all resolved against real Chromium**: `role`
  (Playwright's accessibility role/name locator, exact name matching),
  `id` and `data-attribute` (exact CSS attribute-equals matching that never
  reinterprets the configured value as selector syntax), `semantic-element`
  (a frozen structural tag set: `header`, `nav`, `main`, `footer`,
  `article`, `section`, `aside`, `form`, `dialog`), `css` (unchanged v0.1
  behavior), and `text` (exact match only, no substring/fuzzy matching).
  Locator order is the fallback order: 0 matches tries the next locator; 1
  match selects and stops; more than 1 match is ambiguous and stops (never
  falls through); an unevaluable locator is unavailable and stops (never
  falls through). All six kinds converge on one measurement path
  (`src/browser/evidenceCapture.ts#captureResolvedTargetRecord`) - locator
  strategy never changes the resulting evidence shape.
- **Semantic region evidence**, added to every resolved target alongside
  the existing v0.1 role/name capture: `semanticState` (a first bounded
  family of `disabled`/`expanded`/`checked`/`selected`/`pressed`/`current`,
  read from the element's own native/ARIA properties so an explicit `false`
  is always distinguishable from "not applicable"; `checked`/`pressed` also
  support the browser's `'mixed'` value); `landmark` (derived only from the
  already-captured browser-exposed role - never from locator kind or HTML
  tag - against the standard landmark role set `banner`/`navigation`/
  `main`/`complementary`/`contentinfo`/`form`/`region`/`search`); and
  `containment` (bounded DOM containment checked only among the other
  explicitly configured targets in the same observation, in configured
  order - `available`/`partial`/`unavailable`, never a layout/spatial-
  relationship graph).
- **Proven identity stability**: the same target configuration produces the
  same `requestId` across repeated observations (with a fresh
  `observationId` every time); changing a target's locator strategy while
  keeping its stable name changes `requestId` but not the `targetEvidence`
  key; actual runtime disappearance of a still-configured target changes
  only its resolution status, never the `requestId`.
- **Public CLI**: `my-frontend-observer observe --targets-file <json-file>`
  supplies a structured `{ "targets": [...] }` collection as an alternative
  to one or more `--target id=css-selector` flags; the two are mutually
  exclusive per invocation. `--targets-file` only validates its own root
  wrapper (readable file, valid JSON, object root with exactly a `targets`
  field); all target/locator-internal validation stays owned by the
  existing `normalizeRequest()`. The file path is operational input only -
  never part of request identity, never persisted into `manifest.json`.
- **Observation schema `1.1.0`** (`src/domain/schema.ts#SCHEMA_VERSION`):
  additive over the published `1.0.0` - extends `TargetEvidenceRecord` with
  `semanticState`/`landmark`/`containment` and extends `TargetResolution`
  with `selectedLocatorKind`/`selectedLocatorIndex`/`usedFallback`/
  `confidence`/`attempts`. Artifact kind, directory structure, atomic
  persistence, and evidence-state/source vocabularies are unchanged.
- **Validation on this branch**: `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run test:browser`, `npm run build`, and
  `npm run check:docs` all pass (106 unit tests, 69 real-Chromium tests as
  of this reconciliation; see `docs/DEVELOPMENT.md` for how to reproduce).
  `scripts/dev/builtCliTargetsFileSmoke.mjs` additionally proves the built
  `dist/cli.js` (not just the imported `runCli()` function) performs a real
  semantic `--targets-file` observation end to end.

## Not implemented

- No controlled-scroll behavior, layout/spatial relationship engine,
  before/after comparison, frontend contracts/change scope, source
  ownership, my-dev-kit runtime/static integration, orchestrator/lab
  product integration, viewer, or annotation - all remain v0.3+ and
  unimplemented.
- No v0.3–v0.10 capability is implemented.

## Next target

v0.2 is implemented, validated, and released as `0.2.0`. v0.3 (Runtime
Scrolling, Overflow, and Visibility Behavior) is the next planned version.
