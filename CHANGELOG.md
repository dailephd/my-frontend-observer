# Changelog

## Unreleased

Layout Relationships, Dependency Evidence, and Before/After Comparison
(v0.4). Implemented on `feature/v0.4-layout-comparison`; not yet published -
the package version below remains the current published release.

- New comparison artifact kind `my-frontend-observer/comparison`, schema
  `1.0.0` - independent of and never reused for the observation schema.
- Canonical layout-relationship derivation from a single observation:
  horizontal order (`left-of`/`right-of`/`horizontally-overlapping`),
  vertical order (`above`/`below`/`vertically-overlapping`), area overlap,
  relative width, geometric fit (kept explicitly distinct from DOM
  containment), vertical sequencing (`follows-vertically`), and document-
  width fit/exceeds-viewport - bounded to configured targets, with explicit
  evidence-path provenance and honest unresolved-target handling.
- Comparability analysis, evaluated before any rendered difference:
  `comparable` / `comparable-with-warnings` / `incomparable`, with
  structured reasons (hard mismatches on page URL, viewport, browser
  engine, or scroll-scenario configuration; warnings for producer/browser
  version and target-configuration differences; theme/authenticated-state/
  application-state recorded as unassessed, never silently equal).
- Before/after target and page differences: appeared/disappeared (never
  confused with a target added/removed from configuration), moved, resized,
  visibility changes, clipping changes (reusing one canonical clipping
  derivation), actual horizontal/vertical dimensional-overflow changes, DOM
  containment changes, page-size changes, and scroll-owner changes - each a
  structured record with before/after values, deltas where meaningful, and
  supporting evidence references.
- Relationship-change detection between two observations, matched by
  relationship family and subject/related target (never array position),
  including a `relative-position-changed` distinction from plain absolute
  target movement.
- Explicit, non-causal expected-dependency evidence: a caller may declare an
  expected relationship between two targets' `x`/`y`/`width`/`height`
  properties and `increase`/`decrease`/`change`/`unchanged` directions; each
  declaration evaluates independently to `consistent` / `not-observed` /
  `contradictory-to-declaration` / `unavailable`. The observer never infers
  a dependency from observed co-change and never produces a causal claim.
- Deterministic, direction-sensitive comparison identity
  (`comparisonRequestId`) plus a fresh `comparisonId` per execution;
  operational filesystem paths never affect identity and are never written
  into the persisted manifest.
- Atomic comparison-artifact persistence: `<outputLocation>/<comparisonId>/
  manifest.json` only - no screenshot bytes are copied; the manifest
  retains logical references to the source observations' own
  `screenshot.path`. Source observations are never modified.
- New public `compare` command: `my-frontend-observer compare --before
  <observation-artifact-root> --after <observation-artifact-root> --output
  <directory> [--config-file <json-file>]`. Reads two already-persisted
  observation artifacts and never launches a browser. `comparable`,
  `comparable-with-warnings`, and `incomparable` all persist successfully
  and exit `0`; only invalid syntax, an unreadable/invalid source artifact,
  invalid configuration, or a failed write exits nonzero.

## 0.3.0 - 2026-08-12

Runtime Scrolling, Overflow, and Visibility Behavior.

- Bounded runtime scroll scenarios: an observation may configure zero or
  one scroll action, `window-scroll-by` or `target-scroll-by` (signed
  integer `deltaX`/`deltaY`, bounded to `[-20000, 20000]`, at least one
  non-zero). Not a generic interaction recorder or browser automation
  framework - exactly one bounded action per observation.
- Real `window-scroll-by` execution: vertical and horizontal document
  scrolling, with browser-authoritative (not calculated) final position,
  including natural boundary clamping and valid no-movement scenarios.
- Real `target-scroll-by` execution against the existing stable configured
  target identity and the same canonical target-resolution path every
  locator kind already uses: real nested vertical/horizontal element
  scrolling, boundary clamping, and non-scrollable/no-movement targets. An
  action target that cannot be uniquely resolved at runtime is never
  scrolled and never fabricated as moved - the existing target-missing/
  target-ambiguous/target-hidden diagnostics explain it honestly.
- Initial/final bounded runtime snapshots (window scroll position, the
  browser's own scrolling-root/`documentElement`/`body` metrics, and
  per-configured-target scroll metrics) around an immediate, non-smooth
  scroll action and an exact two-`requestAnimationFrame` stabilization
  wait.
- Actual dimensional overflow (`scrollWidth`/`scrollHeight` vs.
  `clientWidth`/`clientHeight`) kept explicitly distinct from the computed
  `overflow-x`/`overflow-y` CSS declaration.
- Real viewport-relation evidence (`above`/`intersecting`/`below`,
  `intersectsViewport`, `fullyWithinViewport`) and `enteredViewport`/
  `leftViewport` scenario transitions; a hidden/non-rendered target's
  viewport relation is honestly `not-applicable`, never fabricated
  geometry - hidden and offscreen remain distinct.
- Bounded before/after scenario transition evidence for window and
  per-target scroll position, geometry, and viewport relation - not a
  generic comparison/diff engine.
- Derived scroll-owner interpretation (`document` /
  `target:<stable-target-name>` / `none` / `indeterminate`), always
  traceable (`derivedFrom`) to the underlying observed scroll-position
  measurements only - never from CSS overflow, bounding-rectangle movement
  alone, target name, or DOM hierarchy.
- New `--scroll-scenario-file <json-file>` CLI input, usable together with
  either `--target` or `--targets-file`; the file path is operational input
  only, never persisted and never part of request identity, exactly like
  `--targets-file`'s path.
- Observation schema `1.2.0` (additive over `1.1.0`).
- Cross-platform packed-candidate validation: one hash-verified npm
  candidate tarball proven on Windows, Linux, and macOS, covering the
  legacy `--target` CSS shorthand, the structured `--targets-file`
  semantic-target path, and both `--scroll-scenario-file` action kinds.

## 0.2.0 - 2026-08-11

Stable Semantic Targets and Region Identity.

- Canonical `{name, locators}` target model with a stable observer-owned
  target identity, distinct from both the browser locator that resolves a
  target and any source-code symbol. The existing `--target id=selector`
  CSS shorthand remains fully supported and normalizes into this model
  unchanged.
- Six frozen, real-Chromium-resolved locator kinds per target, evaluated in
  configured order with fallback on no match, immediate stop (no fallback)
  on ambiguous or unevaluable results: `role` (+ optional exact accessible
  name), `id`, `data-attribute`, `semantic-element`, `css`, and `text`
  (exact match only).
- Explicit missing/ambiguous/unavailable resolution reporting, and hidden
  (present-but-not-visible) target evidence, for every locator kind.
- Bounded semantic-region evidence per resolved target: accessibility
  state (`disabled`/`expanded`/`checked`/`selected`/`pressed`/`current`,
  with an explicit `false` always distinguishable from "not applicable"),
  derived landmark identity, and configured-target-only DOM containment.
- Proven stable request identity: the same target configuration produces
  the same request identity across repeated observations; changing a
  target's locator strategy changes the request identity without changing
  its stable name; a target's actual runtime disappearance is
  distinguishable from a configuration change.
- New `--targets-file <json-file>` CLI input for structured semantic target
  configuration, mutually exclusive with `--target`.
- Observation schema `1.1.0`.
- Cross-platform packed-candidate validation: one hash-verified npm
  candidate tarball proven on Windows, Linux, and macOS, covering both the
  legacy `--target` CSS shorthand and the structured `--targets-file`
  semantic-target path.

## 0.1.0 - 2026-08-11

Runtime Observation Foundation. First public release.

- Local-first browser runtime evidence producer: a real `observe` CLI command
  that launches Chromium under a loopback-only network safety policy.
- Explicit CSS-selector observation targets (`--target id=selector`,
  repeatable).
- Viewport screenshot capture (`screenshot.png`).
- Bounded page evidence and bounded target evidence, with honest
  unavailable/not-applicable/partial states when evidence cannot be
  determined rather than guessing.
- Loopback/network safety enforcement (`http`/`https`, `localhost`/`127.x.x.x`/
  `::1` only).
- Versioned, portable observation artifact: `manifest.json` + `screenshot.png`
  written atomically per observation, artifact schema `1.0.0`.
- Validated as a packed npm tarball with a clean-consumer install-and-observe
  smoke on Windows, Linux, and macOS.
