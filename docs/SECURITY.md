# Security

## Current controls

`my-frontend-observer` launches a real, sandboxed Chromium browser
(`src/browser/chromiumAdapter.ts`) and enforces a conservative, local-first,
credential-free, non-destructive browser/network boundary
(`src/safety/policy.ts`) as actual product behavior, covered by real-Chromium
tests:

- allowed schemes are `http`/`https` only;
- allowed hosts are loopback only (`localhost`, `127.0.0.1`, `::1`, and any
  `127.x.x.x` form) - no DNS resolution, no arbitrary "local dev host";
- credential-bearing URLs (`user:pass@host`) are rejected;
- the initial target, every navigation redirect, and every subresource
  request are independently classified against the same loopback policy and
  blocked before being contacted if unsafe;
- popups and downloads are never followed/saved (reported as non-fatal
  diagnostics);
- navigation and readiness are bounded by explicit, request-configured
  timeouts - no unbounded wait;
- the Chromium browser/context/page are reliably closed on every exit path
  (success, safety rejection, navigation/readiness failure, or an
  unexpected internal error);
- the observed target's own content/source is never modified by observation.

## Comparison (`compare`, shipped as part of the published `0.4.0` package)

`my-frontend-observer compare` introduces no new network or browser
surface: it never
launches Chromium, never navigates, and never re-observes a target - it only
reads two local, already-persisted observation-artifact `manifest.json`
files (`src/artifacts/artifactReader.ts`) through the same structural
validator the observation writer uses, computes a pure in-memory
comparison, and writes one local comparison `manifest.json`
(`src/artifacts/comparisonArtifactWriter.ts`). Manifest content is parsed
as JSON only and is never executed (no `eval`, no dynamic code loading from
a manifest).

## Frontend contracts (`approve-baseline`/`save-change-contract`/`evaluate-contract`, shipped as part of the published `0.5.0` package)

These three commands introduce no new browser or network surface:
`src/application/frontendContractPersistenceService.ts` and
`src/application/frontendContractEvaluationService.ts` import nothing from
`src/browser/` and never launch Chromium. `approve-baseline` and
`save-change-contract` validate and persist a local JSON contract file
(parsed as JSON only, never executed); `evaluate-contract` reads
already-persisted local observation/comparison/contract artifacts and runs
the pure `evaluateFrontendContract` function. None of the three navigates,
re-observes a target, or contacts a network resource.

## Bounded agent context and correlation (v0.6, released as `0.6.0`)

`src/domain/boundedAgentContextProjection.ts` and
`src/domain/boundedAgentContextCorrelation.ts` introduce no new browser or
network surface: neither imports anything from `src/browser/`, neither
launches Chromium or navigates, and neither performs filesystem or network
I/O of its own. Both are pure, in-memory functions over already-captured
observation/comparison/contract evidence plus caller-supplied candidate
static-evidence records - the correlation module never reads a file path or
retrieves anything itself; the caller (outside this repository) is
responsible for however it obtained the candidate evidence it passes in.
Neither module embeds source code snippets, redacts anything, or invokes
another ecosystem tool (`@dailephd/my-dev-kit` is not a dependency of either
module). Bounded runtime projections may include existing screenshot *path
references* (never embedded bytes), consistent with every other artifact
family's existing reference-not-embed discipline.

## Planned external visual-reference security and privacy boundary (v0.7+)

External visual-reference support is future work and is not implemented in
`0.6.0`. When implemented, imported reference images must remain local-first
evidence. Importing or evaluating a reference must not require uploading the
image, screenshot, source code, annotation, or derived evidence to an external
service.

The v0.7 planning/implementation workflow must define bounded local-file safety
for supported reference formats and must decide explicit limits such as accepted
formats, maximum dimensions/filesize, decode/parse failure behavior, and whether
reference bytes are copied into observer-owned storage or referenced from an
approved project-local location. The exact policy is not frozen here.

Reference images are untrusted data, not executable content. A reference reader
must not evaluate embedded code, dynamically load scripts, or treat image
metadata as an instruction source. If future formats can contain active or
complex embedded content, their parser/decoder boundary must be reviewed
explicitly rather than inheriting a generic file-loading mechanism.

Reference artifacts and downstream correction packets must preserve path
privacy and boundedness. Operational absolute paths must not become semantic
identity merely because a reference was imported from that location. Heavy
image bytes should be referenced rather than copied repeatedly into every
comparison, viewer state, annotation artifact, or agent-context packet.

The privacy model must also distinguish a raw imported image from an approved
reference. Import must not silently promote an image to a project baseline,
active reference, or superseding design authority. Approval and supersession
must be explicit and auditable.

Reference/candidate comparison must not broaden the existing browser/network
boundary. Candidate rendering continues through the current loopback-only
Chromium observation path unless a later separately approved roadmap change
expands that policy. External references themselves do not authorize remote
navigation or third-party network requests.

## Not yet addressed

Certificate-failure-specific handling, permission-prompt-specific handling
(Chromium's default deny-all applies; no permission is ever explicitly
granted), and any non-loopback/remote browsing mode remain unimplemented and
out of scope. `my-frontend-observer@0.6.0` is published to npm, and a
pre-release readiness CI workflow (Windows/Linux/macOS packed-candidate
validation) already exists (see `docs/CI_CD.md`); these are no longer future
decisions. External visual-reference import/evaluation, reference annotation,
and viewer handling remain future v0.7+ concerns. Those facts do not expand the
security scope above: remote browsing, certificate handling, permission-prompt
handling, and the exact future reference-file limits remain separate,
unimplemented concerns.
