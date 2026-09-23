# Release

`v0.10.0` (Full Visual Human–LLM Frontend Change Workflow) is the current
release state. Formal exact-candidate readiness passed on Windows, Linux, and
macOS, including installed-package workflow smokes and security/PWA gates.

`v0.9.1` (PWA Hard-Gate Isolation and Reproducible Security Acceptance) is the
previous maintenance release, published to npm as
`@dailephd/my-frontend-observer`. It hardened isolated PWA security acceptance
without changing production behavior.

The CLI remains `my-frontend-observer`; package identity and product identity
are intentionally distinct. Canonical artifact schemas remain versioned
independently from the npm package version.

Observation, comparison, frontend contract, evaluation artifact,
bounded-agent-context, external-reference, visual annotation,
visual-change-workflow, handoff, Viewer protocol, and package version all
remain separate: package version is `0.10.0`; observation schema is
`1.2.0`, comparison schema is `1.0.0`, frontend contract schema is `1.0.0`,
evaluation artifact schema is `1.0.0`, bounded-agent-context schema is
`1.0.0`, external-reference schema is `1.0.0`, and visual annotation schema is
`1.0.0`, visual-change-workflow schema is `1.0.0`, handoff version is `1.0.0`,
and Viewer protocol is `1.3.0` - none changes automatically with the package
version. v0.9 introduced the visual annotation schema and bumped no existing
schema.

Prior releases: `v0.8.1` (Project Workflow CLI and Human-Readable Evidence
Aliases), `v0.8.0` (Interactive Local Observation Viewer), `v0.7.0` (End-to-End
Coding-Agent Frontend Change Review), `v0.6.0` (Bounded Agent Context and Native my-dev-kit
Ecosystem Integration), `v0.5.0` (Executable Frontend Contracts and
Explicit Change Scope), `v0.4.0` (Layout Relationships, Dependency
Evidence, and Before/After Comparison), `v0.3.0` (Runtime Scrolling,
Overflow, and Visibility Behavior), `v0.2.0` (Stable Semantic Targets and
Region Identity), `v0.1.0` (Runtime Observation Foundation) - see
`CHANGELOG.md`.
