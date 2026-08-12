# Architecture

## Current scaffold architecture

The current repository is one published TypeScript ESM package
(`my-frontend-observer@0.3.0`):

- `src/cli.ts` is the real, thin `observe` command entry point (argument
  parsing/output only).
- `src/index.ts` is the library entry point re-exporting the observer-owned
  contracts/functions from every layer below.
- `scripts/clean.mjs` safely removes only the project `dist/` directory.
- `scripts/check-docs.mjs` validates the canonical documentation foundation,
  roadmap version presence, and the no-batches rule.
- TypeScript, ESLint, Vitest, and package configuration provide foundation
  validation, now exercised by real product tests (`tests/unit/`,
  `tests/browser/`).

Batch 1 added the observation domain/schema and safety-policy layer
(`src/domain/`, `src/request/`, `src/safety/`). Batch 2 added a real
Playwright Chromium browser adapter (`src/browser/`), a minimal application
seam invoking it (`src/application/`), and a deterministic browser
fixture/test boundary (`tests/fixtures/`, `tests/browser/`, run via
`npm run test:browser`). Batch 3 extended that single browser adapter with an
internal page/target measurement module (`src/browser/evidenceCapture.ts`)
that reads page and explicit-CSS-target evidence from the same live,
already-ready page used for the screenshot - no second browser/page is ever
opened, and Playwright objects still never leave `src/browser/`. Batch 4
added the artifact ownership boundary itself: `src/artifacts/artifactWriter.ts`
is the one canonical place that writes an observation to disk (temp
directory, then one atomic rename into `<outputLocation>/<observationId>/`),
and `src/application/observationPersistence.ts` assembles the frozen
`ObservationArtifact` from a browser-capture result before handing it to the
writer. The artifact layer has no Playwright dependency and is testable
without launching Chromium. Batch 5 completed the boundary chain: `src/cli.ts`
parses `observe` arguments (CLI-syntax errors only - e.g. malformed
`WIDTHxHEIGHT`), constructs a raw request, and hands it to the existing
Batch 1 `normalizeRequest`; on success it calls one new application-level use
case, `observe()` in `src/application/observationPersistence.ts`, which runs
the existing `runBrowserCapture` exactly once and, only on success, the
existing artifact writer exactly once, then returns a small observer-owned
`ApplicationObservationResult` (observation id, completion state, artifact
path, target/diagnostic counts) for the CLI to print. The CLI never imports
Playwright or the filesystem-write path directly. Batch 6 closed the
remaining real-Chromium coverage gap (a genuine navigation failure, distinct
from a readiness timeout or a pre-launch safety rejection) and validated the
packed npm tarball end to end in a clean consumer environment, independent
of the source checkout. There is still no controlled-scroll/comparison
behavior.

## Current v0.2 architecture (released/current architecture)

v0.2 extends the same architecture rather than adding a parallel one.
`src/request/request.ts` now owns a canonical `{name, locators}` target
model (`TargetLocator`, six frozen kinds) in place of the old CSS-only
shape; the legacy `{name, selector}` input still normalizes into it. The one
existing browser-side target resolver/measurement module,
`src/browser/evidenceCapture.ts`, was extended - not replaced - to resolve
all six locator kinds against the live page through a single Playwright
`Locator` per attempt, honor the frozen ordered-fallback/ambiguity/
unavailable-no-fallback contract, and converge every kind on the same
measurement path (`captureResolvedTargetRecord`); it additionally computes
bounded semantic state, derived landmark identity, and configured-target-
only DOM containment from the same already-resolved elements in the same
capture pass - no second browser/page, no second resolution algorithm.
`src/domain/schema.ts` extends `TargetEvidenceRecord`/`TargetResolution`
additively for schema `1.1.0`, with matching structural validation in
`isValidObservationArtifact`. `src/cli.ts` gained one CLI/input-boundary-
only addition, `--targets-file`: it reads and validates only the JSON root
wrapper (via the already-imported `node:fs`, never `node:fs/promises`) and
hands the parsed `targets` value into the existing `RawObservationRequest`/
`normalizeRequest()` path unchanged - there is no second application
observation use case, and Playwright objects still never leave
`src/browser/`. The artifact writer, application observation use case, and
overall boundary chain (`CLI → normalizeRequest → observe() →
runBrowserCapture → artifact writer`) are unchanged from v0.1.

## Current v0.3 architecture (released/current architecture)

v0.3 extends the same single-observation architecture again; it does not add
a second browser lifecycle, target resolver, or artifact path.
`src/request/request.ts` adds one optional `scrollScenario` field to
`NormalizedObservationRequest` (`ScrollScenario { action }`, exactly
`window-scroll-by` or `target-scroll-by`); `src/domain/schema.ts` adds the
matching bounded runtime evidence types (`ScrollRuntimeSnapshot`,
`ViewportRelationEvidence`, `OverflowEvidence`, `ScrollScenarioTransition`,
`ScrollOwnerInterpretation`) and structural validation for schema `1.2.0`
(additive over `1.1.0`). `src/domain/scrollEvidence.ts` holds the pure,
browser-independent derivations (viewport relation, actual overflow,
transitions, and `deriveScrollOwner`) so they are unit-testable without
Chromium. `src/browser/scrollCapture.ts` holds the one browser-side scenario
capture module: it reuses `evidenceCapture.ts#resolveConfiguredTargets` (now
exported) to resolve configured targets exactly once, captures an initial
`ScrollRuntimeSnapshot`, performs the one immediate scroll
(`window.scrollBy`/`element.scrollBy`, both `behavior: 'instant'`), waits
exactly two `requestAnimationFrame` cycles, and captures a final snapshot -
all inside `chromiumAdapter.ts#captureViewportInternal`'s existing single
navigate → ready → capture flow, strictly before the unchanged
screenshot/`capturePageEvidence`/`captureTargetEvidence` calls, so every
downstream capture (including a no-scenario request, which skips this block
entirely) describes only the final state. `src/cli.ts` gained one CLI/input-
boundary-only addition, `--scroll-scenario-file`: mirroring
`--targets-file`, it reads and validates only the file readability/JSON-
validity/non-array-object-root shape and hands the parsed value straight
into `RawObservationRequest.scrollScenario` - every scenario/action rule
(kind, deltas, target reference) stays owned by `normalizeRequest()`. There
is still one canonical `observe()` application use case and one artifact
writer; `scrollScenarioEvidence` is simply one more optional field on the
same `ObservationArtifact`.

## Planned v0.1 architecture constraints

v0.1 planning must preserve these approved boundaries without treating module
names from the historical run as mandatory:

```text
thin command-line boundary
        ↓
reusable observation engine/application layer
        ↓
browser automation boundary
        ↓
observer-owned runtime evidence

observer-owned domain/schema
        ↓
artifact ownership boundary

deterministic fixture/test boundary
        ↓
browser-level validation
```

Use one browser engine implementation, keep browser logic out of presentation,
avoid speculative plugin/multi-browser abstractions, and keep observed
applications external. Before v0.6, versions must not add runtime coupling to
sibling ecosystem projects. v0.6 may add only explicit bounded context,
correlation/export, orchestrator-consumption, and lab-compatibility contracts
while preserving independent ownership.

The text/config-driven coding-agent workflow must be operational before the
viewer and annotation layers are added. Those interfaces consume the same
canonical observation, relationship, comparison, contract, change-scope,
correlation, and context boundaries rather than creating parallel engines.
The concrete implementation plan and module layout must be designed only after
the relevant version planning workflow inspects the current repositories.
