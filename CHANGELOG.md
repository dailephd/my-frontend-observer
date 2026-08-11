# Changelog

## Unreleased

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
