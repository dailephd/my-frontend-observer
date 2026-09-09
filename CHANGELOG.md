# Changelog

## [Unreleased]

v0.8, Interactive Local Observation Viewer, is implemented and tested in the
current repository (all eight implementation batches plus the hardened
documentation/implementation-completeness audit have passed - see
`docs/CURRENT_STATE.md`), but **not released**: package metadata remains
`0.7.0`. This section will become a dated `0.8.0` entry only when the
separate release-preparation stage explicitly bumps the version.

- New `view` command: starts a loopback-only (`127.0.0.1`) Node server
  serving a React + TypeScript + Vite viewer application, usable in a normal
  browser or as an installed Progressive Web App, over an existing evidence
  root (`--root`). Metadata-first evidence discovery and on-demand
  artifact/media loading; never mutates target source or any Observer
  evidence artifact.
- Observation inspection: screenshot plus SVG target overlays, geometry,
  semantics, visibility/overflow/scroll evidence, and on-demand layout
  relationships.
- Comparison/contract inspection: before/after side-by-side views and
  contract/change-scope evaluation results, including the required
  protected/preserved-failure safety case (a locally successful requested
  change alongside a genuine protected/preserved regression, shown as
  overall `FAIL`).
- External reference/candidate inspection: reference image and region
  overlays, explicit (never auto-selected) candidate selection,
  reference/candidate compatibility and applicability.
- Explicit reference-region/runtime-target binding cross-selection
  (`--bindings-file`), independent bounded zoom/pan, conditional view lock,
  and on-demand reference-fidelity evaluation shown independently alongside
  any selected contract evaluation.
- Bounded agent context inspection (`--context-file`): session-only display
  of context identity, adequacy, omissions/truncations, and runtime/static
  correlation, plus safe raw-evidence navigation. The viewer never rebuilds
  a bounded context or its correlation and never runs `@dailephd/my-dev-kit`.
- PWA hardening: real service-worker registration, an application-shell
  precache that excludes `/api/` routes, and a proven server-down behavior
  that never presents stale evidence as current.
- No second evidence engine: every canonical result the viewer displays is
  produced by the same single engine the CLI uses, called from at most one
  designated server-side call site.

## 0.7.0 - 2026-09-06

End-to-End Coding-Agent Frontend Change Review.

- External-reference artifact and lifecycle: `import-reference`/
  `approve-reference` persist an externally supplied PNG/JPEG/WebP
  design-reference image (header-only format/dimension detection - no
  decode, no OCR, no computer vision) through an explicit two-state
  (`imported`/`approved`) lifecycle. Supersession is represented only as a
  forward pointer to a newer artifact - an existing persisted artifact's own
  manifest is never rewritten.
- Explicit reference regions and geometry relationships: user/configuration-
  authored rectangles over the reference image, related to each other
  through the same six geometry-only relationship families (horizontal
  order, vertical order, area overlap, relative width, geometric fit,
  vertical sequencing) already used for runtime targets - derived on demand,
  never persisted.
- Selected design requirements and tolerance semantics: explicit,
  never-inferred requirements over region properties, region-to-region
  relationships, and derived two-region measurements, reusing v0.5's
  requested/expected-dependent/protected/preserved categories directly.
  Three reference-owned tolerance kinds (`exact`/`absolute-reference-px`/
  `percent`) stay distinct from runtime CSS-pixel comparison tolerances.
- Reference-evidence adequacy: `adequate`/`partial`/`inadequate` reporting on
  whether a reference's own definition actually supports its selected
  requirements, independent of any runtime target or candidate.
- Explicit applicability and candidate-state compatibility: a shared, closed
  state model (`theme`/`applicationState`/`authenticatedState`, plus an
  applicable CSS-pixel `viewport`) declares which runtime frontend state a
  reference represents. `evaluateReferenceCandidateCompatibility` and
  `observe`'s new `--state-file` reuse v0.4's comparability vocabulary to
  determine whether a reference and a candidate describe the same state -
  an undeclared dimension is never fabricated as a match or a mismatch.
- Explicit reference-region-to-runtime-target binding: fidelity evaluation
  requires an explicit `{referenceRegion, runtimeTarget}` declaration for
  every region a requirement depends on - never inferred from geometry,
  matching names, or source code.
- Structured reference-vs-candidate fidelity evaluation: `evaluate-
  reference-fidelity --reference --candidate [--bindings-file] [--enforce]`
  evaluates every selected requirement against live candidate evidence
  through one explicit reference-image-pixel-to-CSS-pixel coordinate scale,
  producing an honest `not-evaluated`/`pass`/`fail` result that never
  fabricates a verdict past a blocked reference-adequacy or
  reference/candidate-compatibility gate.
- Bounded fidelity integration with v0.6 agent context: `projectBoundedAgentContext`
  gained an optional `fidelity` input so fidelity mismatches compete for the
  same bounded required/permitted-target allocation and adequacy machinery
  v0.5 contract clauses already use - a `not-evaluated` fidelity always
  degrades adequacy rather than being silently reported as "no problems".
- End-to-end external-reference correction workflow: the programmatic,
  library-only `prepareReferenceCorrection`/`reviewReferenceCorrectionAttempt`
  compose reference fidelity, v0.4 comparison, and v0.5 contract evaluation
  into one overall result - matching the reference is necessary but never
  sufficient, so a candidate that visually satisfies the reference while
  regressing an active protected/preserved contract clause still resolves to
  overall `FAIL`. Neither function edits target source, launches a browser,
  or calls a remote AI provider; an external implementation actor (a human
  or a coding agent) makes the actual change between review attempts.
- Real-browser regression protection: a dedicated Chromium-driven test
  proves a full success correction, a protected-regression case, a
  two-attempt correction iteration against the same baseline, and an
  incompatible-viewport blocking case, all against a disposable,
  repository-local fixture copy the observer itself never edits.
- Three new public CLI commands (`import-reference`, `approve-reference`,
  `evaluate-reference-fidelity`) and a complete new programmatic export
  surface (`src/index.ts`) for the reference/region/requirement/
  applicability/compatibility/binding/fidelity/correction-workflow types and
  functions. External-reference schema is `1.0.0`, independent of the
  observation, comparison, frontend-contract, evaluation, and
  bounded-agent-context schema versions, none of which changed.
- Cross-platform packed-candidate validation: the pre-version-bump
  implementation candidate tarball `my-frontend-observer-0.6.0.tgz`
  (SHA-256 `0347b1f3cfd5d311e13b405c0c2fbc2f507e250cb63223d58b4d2d31df029414`)
  was hash-verified and proven on Windows, Linux, and macOS, including an
  installed-package smoke of every new v0.7 CLI command and programmatic
  export alongside every pre-existing v0.1-v0.6 packed behavior, before this
  release's version bump - see
  `docs/reports/v0.7-pre-release-readiness.md`.

## 0.6.0 - 2026-08-19

Bounded Agent Context and Native my-dev-kit Ecosystem Integration.

- Bounded runtime projection (`src/domain/boundedAgentContext.ts`,
  `boundedAgentContextProjection.ts#projectBoundedAgentContext`): a
  task-relevant, bounded view of page/viewport identity, stable targets,
  geometry, runtime behavior, relationships, before/after differences,
  contract results, requested/expected-dependent/protected/preserved scope
  (reusing the existing v0.5 `frontendContracts.ts` types directly), and
  screenshot/artifact references - never a raw evidence dump.
- Explicit adequacy reporting (`adequate`/`partial`/`inadequate` with
  structured reason codes) and omission/truncation records, distinguishing
  required from optional loss.
- Explicit runtime/static correlation
  (`boundedAgentContextCorrelation.ts#deriveRuntimeStaticCorrelations`/
  `attachRuntimeStaticCorrelations`): `correlated`/`ambiguous`/`unavailable`
  outcomes only - a stable runtime target identity never silently becomes a
  source-ownership claim, and competing candidates remain visible.
- Deterministic logical identity (`boundedAgentContextIdentity.ts`) distinct
  from fresh per-execution instance identity.
- Public export/correlation boundary only: `src/index.ts` exports the full
  bounded-agent-context and correlation type/function surface as a
  programmatic library contract (bounded-agent-context schema `1.0.0`) - no
  new CLI command, no disk artifact writer/reader, no `my-dev-kit` runtime
  dependency, no orchestrator/lab code in this repository.
- Observation schema remains `1.2.0`, comparison schema `1.0.0`, frontend
  contract schema `1.0.0`, evaluation artifact schema `1.0.0` - no existing
  schema was bumped.
- Cross-platform packed-candidate validation: one hash-verified npm
  candidate tarball (`acd067247c447294a611f37f52eab301b6038ab1c6d493ae65e81c2f1279bfd7`)
  proven on Windows, Linux, and macOS, including an installed-package smoke
  of the new bounded-agent-context projection and runtime/static
  correlation exports alongside every pre-existing v0.1-v0.5 packed
  behavior.

## 0.5.0 - 2026-08-13

Executable Frontend Contracts and Explicit Change Scope.

- Two related contract classes: a `PersistentBaselineContract` (previously
  approved frontend behavior that stays active across future changes unless
  explicitly superseded, with append-based supersession history) and a
  `PerChangeContract` (the allowed scope of one requested change).
- Four authored change-scope categories - `requested`, `expected-dependent`
  (`required` or `permitted`), `protected`, `preserved` - plus a fifth,
  strictly derived-only classification, `unexpected`, for a meaningful
  rendered difference no active clause accounts for. `unexpected` can never
  be authored as a permission.
- A closed, bounded vocabulary of 15 contract primitives (visibility,
  clipping, width bounds, non-overlap, relative width, vertical sequence,
  geometric fit, document-width-vs-viewport, scroll ownership, initial-
  viewport position, relationship-unchanged, and property-unchanged/
  increases/decreases) and three contract tolerances (`exact`,
  `absolute-px`, `percent`) - independent of `compare`'s geometry tolerance,
  which only suppresses insignificant noise and is never contract
  authorization.
- Explicit, never-inferred baseline and per-change clause supersession; two
  clauses that structurally contradict each other without explicit
  supersession produce a `conflict` result rather than a silent preference.
- One canonical evaluation engine (`evaluateFrontendContract`) that owns
  requested/expected-dependent/protected/preserved evaluation, unexpected-
  change derivation, and the overall `PASS`/`FAIL` verdict - reusing existing
  v0.4 observation/comparison evidence directly, never re-launching a
  browser, re-resolving a target, or reimplementing relationship/clipping
  derivation.
- Actionable per-clause results (`pass`/`fail`/`unavailable` with a required
  reason/`conflict` with at least two conflicting clause identities) - never
  an opaque score.
- Atomic, independently-versioned persistence for baseline contracts,
  per-change contracts, and evaluation results, with no destructive artifact
  overwrite, no copied screenshots, and full source observation/comparison/
  contract immutability.
- Three new public commands: `approve-baseline` (the only baseline-approval
  act - explicit only, never inferred from `compare` or a `PASS`
  evaluation), `save-change-contract` (persistence only), and
  `evaluate-contract` (runs the canonical evaluator against already-
  persisted evidence and persists exactly one evaluation artifact).
  `evaluate-contract --enforce` makes an already-persisted `FAIL` verdict
  produce a nonzero process exit status without changing the verdict, its
  identity, or its persisted content - a `FAIL` without `--enforce` still
  exits `0`.
- Proven against real Chromium observations, not hand-constructed
  artifacts: a fully successful contract change, and the "milestone
  signature" case - a locally successful requested change coexisting with a
  genuine protected-property regression and a genuine preserved-invariant
  regression - producing overall `FAIL`.
- Frontend contract schema `1.0.0` and evaluation artifact schema `1.0.0`,
  each its own independent schema family; observation schema remains
  `1.2.0` and comparison schema remains `1.0.0`.
- Cross-platform packed-candidate validation: one hash-verified npm
  candidate tarball proven on Windows, Linux, and macOS, covering the
  installed candidate's `approve-baseline`, `save-change-contract`, and
  `evaluate-contract` commands alongside every pre-existing v0.1-v0.4
  packed observation/comparison behavior.

## 0.4.0 - 2026-08-12

Layout Relationships, Dependency Evidence, and Before/After Comparison.

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
