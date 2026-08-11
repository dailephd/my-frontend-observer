# Changelog

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
