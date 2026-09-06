# Release

`v0.6.0` is published to npm as `my-frontend-observer`, validated on
Windows, Linux, and macOS as an installed packed-tarball consumer prior to
publication (covering the legacy CSS-shorthand `--target` path, the
structured semantic `--targets-file` path, the bounded
`--scroll-scenario-file` `window-scroll-by`/`target-scroll-by` runtime
scroll scenario path, the installed `compare` command's comparable and
incomparable cases, the installed `approve-baseline`/`save-change-contract`/
`evaluate-contract` frontend contract commands - including both a fully
successful contract change and the milestone-signature failure, with
`--enforce` exit-status behavior - and the installed bounded-agent-context
projection/correlation programmatic exports). No project license has been
declared yet; that decision remains open for a later explicit task.

v0.7 (End-to-End Coding-Agent Frontend Change Review - the external-
reference foundation, approval lifecycle, applicability/compatibility,
region-to-target binding, structured fidelity evaluation, its bounded-
agent-context integration, and the controlled end-to-end correction
workflow) is fully implemented in the current development state but has
**not** been released: no v0.7 tag, npm publish, or GitHub Release exists
yet. See `docs/CURRENT_STATE.md` and
`docs/reports/v0.7-implementation-completeness-documentation-reconciliation.md`
for the completeness audit; a separate, later pre-release readiness stage
(cross-platform packed-candidate validation, security review) is required
before v0.7 can be published. This document's release process itself is
unchanged by v0.7 - no release mechanics were altered.

Observation, comparison, frontend contract, evaluation artifact,
bounded-agent-context, external-reference, and package version all remain
separate: package version is `0.6.0`; observation schema is `1.2.0`,
comparison schema is `1.0.0`, frontend contract schema is `1.0.0`,
evaluation artifact schema is `1.0.0`, bounded-agent-context schema is
`1.0.0`, and external-reference schema is `1.0.0` - none of which changes
automatically with the package version, and none of which has been bumped
by the (unreleased) v0.7 work.

Prior releases: `v0.5.0` (Executable Frontend Contracts and Explicit Change
Scope), `v0.4.0` (Layout Relationships, Dependency Evidence, and
Before/After Comparison), `v0.3.0` (Runtime Scrolling, Overflow, and
Visibility Behavior), `v0.2.0` (Stable Semantic Targets and Region
Identity), `v0.1.0` (Runtime Observation Foundation) - see `CHANGELOG.md`.
