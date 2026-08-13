# Commands

## Product command surface

`node dist/cli.js observe` (or `my-frontend-observer observe` once installed
as a bin) captures one bounded, loopback-only browser observation and
persists it as a portable artifact.

```text
my-frontend-observer observe --url <loopback-url> [options]
```

Required:

- `--url <url>` — loopback target URL (`http`/`https`; `localhost`,
  `127.x.x.x`, or `::1` only - enforced by the existing request/safety
  contracts, not by CLI-local logic).

Options:

- `--viewport <WIDTHxHEIGHT>` — e.g. `1280x720`. Malformed syntax (missing
  `x`, non-numeric, empty side) is rejected before any browser launches;
  in-range bounds are enforced by the existing request validator.
- `--target <id=css-selector>` — an explicit CSS-shorthand observation
  target. Repeatable; order is preserved. Parsed on the *first* `=` only, so
  a selector containing `=` survives intact, e.g.
  `--target action=button[data-state="active"]`. Cannot be combined with
  `--targets-file`.
- `--targets-file <json-file>` — loads structured semantic observation
  targets from a local JSON file instead of `--target`. Cannot be combined
  with `--target`. See "Structured semantic targets" below.
- `--scroll-scenario-file <json-file>` — loads one bounded runtime scroll
  scenario from a local JSON file. May be combined with either `--target` or
  `--targets-file` (it is independent of target configuration). See "Scroll
  scenario (`--scroll-scenario-file`)" below.
- `--output <directory>` — portable, relative output location for the
  observation artifact (same contract as the request's `outputLocation`; no
  drive letter, no leading `/`, no `..` segments).
- `--timeout <ms>` — overall request timeout in milliseconds.
- `--help` — show `observe` usage.

Also available: `--help` / `-h` (top-level usage) and `--version` (prints the
actual package version).

On success the command prints exactly:

```text
Observation: <observation-id>
State: <complete|partial|warning|fatal|invalid-request>
Artifact: <artifact-root-path>
Targets: <configured-target-count>
Diagnostics: <diagnostic-count>
```

and exits `0` for a validly persisted observation - including one whose
`State` truthfully reports `partial` (e.g. a missing or ambiguous target)
- or exits nonzero for invalid CLI syntax, a request the existing validator
rejects, an unsafe/failed navigation with no persistable artifact, or a
failed artifact write. No progress output is printed during a normal
capture. CLI-syntax errors (e.g. a missing `--url`) print as `error:
<message>` followed by `observe` usage; request/capture/persistence
diagnostics print one per line as `[code] message`.

### Structured semantic targets (`--targets-file`)

**Current status: shipped as part of the published `my-frontend-observer@0.3.0`
package.** `--target` (CSS shorthand) remains fully supported alongside it.

`--targets-file <json-file>` is the public entry point to the v0.2 canonical
target/locator model established in `src/request/request.ts`. It supplies
the same `targets` collection that `--target` supplies, just in structured
form; both converge on the same `normalizeRequest()` validation and the same
downstream browser resolver - there is no separate semantic observation path.

File format (the exact, first frozen structure - the root object supports
only the `targets` field; any other top-level field is rejected):

```json
{
  "targets": [
    {
      "name": "primary-navigation",
      "locators": [
        { "kind": "role", "role": "navigation", "name": "Primary" },
        { "kind": "id", "value": "nav" }
      ]
    },
    {
      "name": "workspace",
      "locators": [
        { "kind": "data-attribute", "attribute": "data-region", "value": "workspace" }
      ]
    }
  ]
}
```

Each target has a stable `name` and an ordered `locators` array (1-5
entries; order is the fallback order - the first locator that resolves
uniquely wins, an ambiguous or unevaluable locator stops immediately without
trying the next one). Each locator is one of the six frozen kinds:

- `{ "kind": "role", "role": "<string>", "name"?: "<string>" }`
- `{ "kind": "id", "value": "<string>" }`
- `{ "kind": "data-attribute", "attribute": "data-*", "value": "<string>" }`
- `{ "kind": "semantic-element", "tag": "<one of the frozen structural tags>" }`
- `{ "kind": "css", "selector": "<string>" }`
- `{ "kind": "text", "text": "<exact string>" }`

`--targets-file` itself only validates that the file is readable, is valid
JSON, and has an object root containing exactly a `targets` field - every
target/locator-internal rule (bounds, per-kind required fields, supported
values) is enforced by the same `normalizeRequest()` validator `--target`
already goes through, so both input modes produce identical diagnostics for
equivalent mistakes.

The path may be relative (resolved from the current working directory) or
absolute; it is operational input only - it never affects the observation's
request identity and is never written into `manifest.json`.

Example:

```powershell
my-frontend-observer observe `
  --url http://localhost:3000/ `
  --viewport 1280x720 `
  --targets-file .\targets.json `
  --output observations
```

### Scroll scenario (`--scroll-scenario-file`)

**Current status: shipped as part of the published `my-frontend-observer@0.3.0`
package.** Observation schema is `1.2.0`.

`--scroll-scenario-file <json-file>` is the public entry point to the v0.3
runtime scroll-scenario contract established in `src/request/request.ts`
(`ScrollScenario`/`ScrollAction`) and executed in `src/browser/`. It supplies
exactly the value of the normalized request's `scrollScenario` field - the
file root *is* the scenario object itself, with no wrapper field (unlike
`--targets-file`'s `{ "targets": [...] }` root).

A request supports **zero or one** scroll scenario. There are exactly two
supported action kinds:

Window scrolling:

```json
{
  "action": {
    "kind": "window-scroll-by",
    "deltaX": 0,
    "deltaY": 600
  }
}
```

Target scrolling (the `target` value must be the stable `name` of one of the
observation's own configured targets - never a CSS selector, DOM id, or
source symbol):

```json
{
  "action": {
    "kind": "target-scroll-by",
    "target": "tool-workspace",
    "deltaX": 0,
    "deltaY": 400
  }
}
```

`deltaX`/`deltaY` are signed integers bounded to `[-20000, 20000]`; at least
one must be non-zero (both zero is rejected). Every scroll/action rule -
supported action kind, required fields, delta types/bounds, the both-zero
rule, and the stable-target-name reference for `target-scroll-by` - is
enforced by the same `normalizeRequest()` validator used everywhere else, not
duplicated in CLI code; `--scroll-scenario-file` itself only validates that
the file is readable, is valid JSON, and has a non-array object root.

The observer performs the requested scroll immediately (no smooth-scroll
animation), waits exactly two `requestAnimationFrame` cycles, and captures a
final runtime snapshot - the same final state that the observation's ordinary
`pageEvidence`, `targetEvidence`, and `screenshot.png` describe. The actual
resulting scroll position is browser-authoritative and may be clamped by
document/element boundaries; a scenario that produces no movement (already at
a boundary, or a non-scrollable target) is still a valid, successfully
persisted observation, never a fabricated failure.

Usable with either target input mode:

```powershell
my-frontend-observer observe `
  --url http://localhost:3000/ `
  --target workspace=.workspace `
  --scroll-scenario-file .\scroll.json `
  --output observations
```

```powershell
my-frontend-observer observe `
  --url http://localhost:3000/ `
  --targets-file .\targets.json `
  --scroll-scenario-file .\scroll.json `
  --output observations
```

`--target` and `--targets-file` remain mutually exclusive with each other,
exactly as before; `--scroll-scenario-file` is independent of both and is
never itself a third mutually-exclusive target mode. `window-scroll-by`
requires no configured target at all.

The path may be relative (resolved from the current working directory) or
absolute; it is operational input only - like `--targets-file`'s path, it
never affects the observation's request identity and is never written into
`manifest.json`. Two different scenario files with identical content produce
the same `requestId`; only the requested scenario *configuration*
participates in identity, never the runtime outcome (actual scroll
distance, clamping, or scroll-owner result).

If a `target-scroll-by` scenario's configured action target cannot be
uniquely resolved at runtime (missing, ambiguous, or otherwise unavailable),
the scroll is not performed, no movement is fabricated, and the observation
persists honestly - typically as `partial` - carrying the same
`target-missing`/`target-ambiguous`/`browser-evidence-unavailable` diagnostic
that any other unresolved configured target would produce.

## `compare`

**Current status: shipped as part of the published `my-frontend-observer@0.4.0`
package.** Comparison schema is `1.0.0`, independent of and never reused for
the observation schema (`1.2.0`).

`my-frontend-observer compare` (or `node dist/cli.js compare` from a source
checkout) reads two already-persisted observation artifacts and derives
before/after evidence purely from their existing content:

```text
my-frontend-observer compare --before <observation-artifact-root> --after <observation-artifact-root> --output <directory> [options]
```

Required:

- `--before <path>` — root directory of the "before" persisted observation
  artifact (the directory containing its `manifest.json`, as produced by
  `observe`).
- `--after <path>` — root directory of the "after" persisted observation
  artifact.
- `--output <directory>` — portable, relative output location for the
  comparison artifact (same contract as `observe --output`).

Options:

- `--config-file <json-file>` — loads a comparison configuration directly
  (no wrapper field): `{ "geometryTolerancePx": <0-10>,
  "expectedDependencies": [...] }`. Without it, `geometryTolerancePx`
  defaults to `0.5` CSS px with no declared dependencies. As with
  `--targets-file`/`--scroll-scenario-file`, `--config-file` only validates
  file readability, JSON validity, and a non-array object root; every
  semantic rule (tolerance bounds, dependency property/direction
  vocabulary, dependency source marker) is enforced by the same domain
  validator the comparison engine itself uses.
- `--help` — show `compare` usage.

**Comparison never launches a browser.** It reads two manifests through the
existing observation-artifact reader, runs the pure comparison engine, and
persists a portable `manifest.json` — no navigation, no target
re-resolution, no Chromium process.

On success the command prints exactly:

```text
Comparison: <comparison-id>
State: <comparable|comparable-with-warnings|incomparable>
Artifact: <comparison-artifact-root>
Differences: <count>
Relationship changes: <count>
Diagnostics: <count>
```

and exits `0` — **including when `State` is `incomparable`**: comparison
determining that two observations should not be treated as equivalent
frontend states is itself a successful outcome, not a failure. The command
exits nonzero only for invalid CLI syntax, an unreadable/malformed/
structurally-invalid source artifact, invalid comparison configuration, or
a failed artifact write.

### Comparability

Before any rendered difference is calculated, the engine evaluates whether
the two observations are comparable at all:

- **Hard incompatibilities** (force `incomparable`): different logical page
  URL, different viewport, different browser engine, or a mismatched scroll
  scenario configuration (no scenario vs. a scenario, or two different
  scenario configurations).
- **Warnings** (still `comparable-with-warnings`, comparison proceeds):
  different producer package version, different browser version, or a
  changed/added/removed configured target.
- **Unassessed dimensions** the observer does not yet model (theme,
  authenticated state, application state) are always recorded, never
  silently claimed identical.

An `incomparable` result still persists a structurally valid
`ComparisonArtifact`: the comparability reasons are recorded, and ordinary
rendered differences/relationship changes stay empty rather than fabricated.

### Difference and relationship evidence

For a `comparable`/`comparable-with-warnings` result, the manifest's
`differences` and `relationshipChanges` arrays carry structured before/
after evidence: appeared/disappeared targets (only for a stable target name
configured on both sides — a target added/removed from configuration is
recorded separately as a `configurationChanges` entry, never fabricated as
appeared/disappeared), moved/resized targets, visibility changes, clipping
changes, actual dimensional overflow changes, DOM containment changes,
page-size changes, scroll-owner changes, and layout-relationship
transitions (e.g. `does-not-overlap` → `overlaps`, or
`document-width-fits-viewport` → `document-width-exceeds-viewport`) reused
verbatim from the same canonical relationship engine `observe` output feeds
Batch 2's `deriveLayoutRelationships`.

### Explicit dependency evidence (non-causal)

`--config-file`'s `expectedDependencies` lets you declare an expected
layout relationship such as "`navigation.width` decreases →
`workspace.width` increases" using only the frozen `x`/`y`/`width`/`height`
property vocabulary and `increase`/`decrease`/`change`/`unchanged`
direction vocabulary. Each declaration is evaluated independently against
the two observations and persists exactly one outcome: `consistent`,
`not-observed`, `contradictory-to-declaration`, or `unavailable`. **The
observer never infers a dependency from co-change, and never emits a
causal claim, a PASS/FAIL verdict, or a change-contract decision** — v0.4
produces comparison evidence; whether that evidence satisfies some
contract is v0.5+ scope.

### Path privacy

`--before`, `--after`, `--config-file`, and `--output` are operational
filesystem input only. None of them affect `comparisonRequestId`, and none
of them are written into the persisted manifest — the manifest instead
retains logical source references (`observationId`, `requestId`,
`producer`, `observationSchemaVersion`, and the source `screenshot.path`).
Two semantically identical observation/config pairs read from different
filesystem locations produce the same `comparisonRequestId`; each execution
still gets a fresh `comparisonId`.

### Source observations remain immutable

Comparison is read-only with respect to its inputs: it never modifies
either source observation's `manifest.json` or `screenshot.png`, and it
never copies screenshot bytes into the comparison directory — the
comparison artifact directory contains `manifest.json` only.

Example:

```powershell
node dist/cli.js compare `
  --before observations/<before-id> `
  --after observations/<after-id> `
  --output comparisons `
  --config-file .\comparison-config.json
```

## `approve-baseline`

**Current status: shipped as part of the published `my-frontend-observer@0.5.0`
package.** Frontend contract schema is `1.0.0`, independent of the
observation (`1.2.0`) and comparison (`1.0.0`) schemas.

`my-frontend-observer approve-baseline` is the *only* baseline-approval
operation in the observer — approval is never inferred from a successful
comparison or evaluation, and no command automatically supersedes or selects
a baseline. It explicitly approves and persists one already-authored
`PersistentBaselineContract` against the observation it claims to approve:

```text
my-frontend-observer approve-baseline --observation <observation-artifact-root> --contract-file <json-file> --output <directory>
```

Required:

- `--observation <path>` — root directory of the persisted observation
  artifact this baseline claims to approve (read through the existing
  observation-artifact reader).
- `--contract-file <json-file>` — local JSON file containing one raw
  `PersistentBaselineContract` (no wrapper field). As with `--config-file`,
  only file readability/JSON-validity/non-array-object-root is checked here;
  every structural rule (artifact kind, schema version, clause shape) is
  enforced by the existing frozen domain validator.
- `--output <directory>` — portable, relative output location for the
  baseline artifact.

Before persisting, the application layer verifies the contract's frozen
`sourceObservation` reference (`observationId`, `requestId`, `producer`,
`observationSchemaVersion`) actually matches the supplied observation
artifact's stable identity — approving a baseline against an unrelated
observation is rejected, even if both artifacts are individually valid. Any
`supersedesBaselineId` already authored in the contract is preserved exactly
as supplied; this command never discovers a prior baseline, infers
supersession, or deletes anything.

On success the command prints exactly:

```text
Baseline: <baseline-id>
State: approved
Artifact: <baseline-artifact-root>
Clauses: <count>
Supersedes: <baseline-id|none>
```

and exits `0`. It exits nonzero for invalid CLI syntax, an unreadable/
malformed/structurally-invalid contract file, a `PerChangeContract` passed
where a baseline is expected, a source-observation mismatch, an existing
artifact collision (baseline identities are never overwritten), or a failed
artifact write.

## `save-change-contract`

**Current status: shipped as part of the published `my-frontend-observer@0.5.0`
package.**

`my-frontend-observer save-change-contract` validates and persists one
already-authored `PerChangeContract` so it can later be evaluated — this is
persistence only, never approval:

```text
my-frontend-observer save-change-contract --contract-file <json-file> --output <directory>
```

Required:

- `--contract-file <json-file>` — local JSON file containing one raw
  `PerChangeContract` (no wrapper field).
- `--output <directory>` — portable, relative output location for the
  change-contract artifact.

Domain/application validation rejects a `PersistentBaselineContract` passed
here, malformed clauses, an unsupported authored category, an authored
`category: "unexpected"` (the derived-only fifth classification can never be
authored as a permission), and invalid tolerance/mode fields — none of this
is duplicated in CLI code. Any `supersedesBaselineClauseIds` already
authored on a clause is preserved exactly; resolving those references
against a particular baseline remains `evaluate-contract`'s responsibility.

On success the command prints exactly:

```text
Change contract: <contract-id>
Artifact: <contract-artifact-root>
Clauses: <count>
Supersedes baseline clauses: <count>
```

and exits `0`. It exits nonzero for invalid CLI syntax, an unreadable/
malformed/structurally-invalid contract file, a persistent baseline contract
passed here, an existing artifact collision, or a failed artifact write.

## `evaluate-contract`

**Current status: shipped as part of the published `my-frontend-observer@0.5.0`
package.** Frontend contract evaluation artifact schema is `1.0.0`, its own
independent family.

`my-frontend-observer evaluate-contract` executes the canonical Batch 2
evaluator against already-persisted evidence/contracts and persists the
result:

```text
my-frontend-observer evaluate-contract --before <observation-artifact-root> --after <observation-artifact-root> --comparison <comparison-artifact-root> --baseline <baseline-contract-artifact-root> --change <per-change-contract-artifact-root> --output <directory> [--enforce]
```

Required:

- `--before <path>` / `--after <path>` — root directories of the persisted
  before/after observation artifacts.
- `--comparison <path>` — root directory of the already-persisted comparison
  artifact for that before/after pair.
- `--baseline <path>` — root directory of the already-approved baseline
  contract artifact.
- `--change <path>` — root directory of the already-persisted per-change
  contract artifact.
- `--output <directory>` — portable, relative output location for the
  evaluation artifact.

Options:

- `--enforce` — makes a `FAIL` verdict produce a nonzero process exit
  status. A `FAIL` evaluation is always persisted and printed identically
  with or without this flag; `--enforce` changes only the process exit code
  — never evaluation identity, contents, or persistence.

**`evaluate-contract` never launches a browser, never re-resolves targets,
and never recomputes comparison or relationship evidence** — it reads the
already-persisted before/after observations and comparison exactly as given
(through the existing observation-artifact reader and a new comparison
reader) and calls the canonical `evaluateFrontendContract` exactly once.

A `FAIL` verdict (a found regression or unsatisfied contract clause) is a
successful, persisted evaluation outcome — not an execution error. On
success (evaluation constructed and persisted, verdict `PASS`, or verdict
`FAIL` without `--enforce`), the command prints exactly:

```text
Evaluation: <evaluation-id>
Verdict: <PASS|FAIL>
Artifact: <evaluation-artifact-root>
Clauses: <total-clause-result-count>
Unexpected: <unexpected-change-count>
Enforced: <yes|no>
```

and exits `0`; with `--enforce` and verdict `FAIL`, it prints the same
result and exits nonzero. It exits nonzero and persists nothing for invalid
CLI syntax or an unreadable/malformed/incoherent source artifact (evaluation
could not even be constructed) — distinct from a legitimate persisted `FAIL`.

The evaluation artifact directory contains `manifest.json` only — no
screenshot is copied. Operational `--before`/`--after`/`--comparison`/
`--baseline`/`--change`/`--output` paths never enter the persisted
`evaluationRequestId` or any other semantic field; two semantically
identical evaluations invoked from different filesystem locations share the
same `evaluationRequestId` even though each execution gets a fresh
`evaluationId`.

## Foundation commands

- `npm install` — install dependencies (includes the `playwright` runtime
  dependency since Batch 2).
- `npx playwright install chromium` — install the Chromium binary once per
  machine (see `docs/DEVELOPMENT.md`).
- `npm run typecheck` — run TypeScript no-emit checking.
- `npm run lint` — lint the repository and scripts.
- `npm test` — run the fast unit suite (`tests/unit/`).
- `npm run test:browser` — run the real-Chromium integration suite
  (`tests/browser/`), including a real `observe` end-to-end test against the
  deterministic local fixture.
- `npm run test:security` — run only the safety-relevant subset of the suite
  (`tests/unit/policy.test.ts` plus the real-Chromium enforcement cases in
  `tests/browser/chromiumAdapter.test.ts`: unsafe initial target, prohibited
  redirect, prohibited subresource request, and browser cleanup around
  safety/navigation failure) — a discoverable entry point for security
  review tooling; it is a subset of, not a replacement for, `npm test` and
  `npm run test:browser`.
- `npm run build` — clean and compile `src/` (including `src/cli.ts`) to
  `dist/`.
- `npm run check:docs` — validate canonical documents and roadmap structure.
- `npm pack --dry-run` — inspect the public package's tarball inventory
  before publishing. The real tarball has been installed and exercised in a
  clean temporary consumer directory (real Chromium install, real `observe`
  run, real artifact) on Windows, Linux, and macOS as part of v0.1
  validation, again for v0.2's packed semantic `--targets-file` behavior,
  and again for v0.3's packed `--scroll-scenario-file` window/target scroll
  behavior (`scripts/ci/runPackedObservationSmoke.mjs`); this is local
  package validation, not a release/publication step.
