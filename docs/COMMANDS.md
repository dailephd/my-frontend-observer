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

**Current status: implemented and feature-complete on the current
`feature/v0.2-stable-semantic-targets` source-checkout branch; not yet part
of any published release.** The published `my-frontend-observer@0.1.0`
package supports `--target` (CSS shorthand) only. Everything below in this
section describes the source-checkout/branch behavior.

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
- `npm pack --dry-run` — inspect the private package inventory without
  publishing. The real tarball has been installed and exercised in a clean
  temporary consumer directory (real Chromium install, real `observe` run,
  real artifact) as part of v0.1 validation; this is local package
  validation, not a release/publication step.
