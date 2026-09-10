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

## External visual-reference security and privacy boundary (v0.7, released as `0.7.0`)

External visual-reference support (`import-reference`/`approve-reference`/
`evaluate-reference-fidelity`, plus the programmatic correction-workflow
coordinator) is released as part of the published `0.7.0` package. Imported reference images remain
local-first evidence: `import-reference` reads a local file path only,
never a URL, and no code path in this repository uploads a reference image,
a candidate screenshot, source code, or any derived evidence to an external
service. Reference/candidate compatibility and fidelity evaluation are pure,
in-process computations over already-loaded artifacts - neither launches a
network request.

Bounded local-file safety for reference images is a frozen, source-verified
policy, not an open decision: `EXTERNAL_REFERENCE_SUPPORTED_IMAGE_FORMATS`
(`png`/`jpeg`/`webp`, detected from header/magic bytes only, never from a
caller-declared file extension), `EXTERNAL_REFERENCE_MAX_IMAGE_BYTES`
(20,000,000 bytes), and `[EXTERNAL_REFERENCE_MIN_DIMENSION_PX,
EXTERNAL_REFERENCE_MAX_DIMENSION_PX]` (`[1, 8192]` pixels per side, parsed
from the same bounded header bytes, never a full pixel decode) are all
enforced before any artifact is persisted; an unsupported/undetectable
format, an over-limit file, or invalid/out-of-bound dimensions is rejected
outright (`unsupported-image-format`/`invalid-image-dimensions`/
`image-too-large`), never silently clamped or accepted.

Reference images are treated as untrusted data, not executable content: the
format/dimension detector never evaluates embedded code, never dynamically
loads a script, and never treats image metadata as an instruction source -
only bounded header-byte inspection is performed, no general-purpose image
or video codec is invoked. Explicit, caller-supplied state
(`--state-file`/`--applicability-file`, `theme`/`applicationState`/
`authenticatedState`) is a closed, bounded label vocabulary with no field
capable of holding a credential, token, cookie, session id, or authorization
header - `authenticatedState` accepts only the literal values
`'authenticated'`/`'unauthenticated'`.

Reference artifacts and the bounded correction handoff preserve path privacy
and boundedness: every reference/observation/binding/fidelity/context
identity function is a pure hash of semantic content only - an operational
file path (the image path, a `--regions-file`/`--requirements-file`/
`--applicability-file`/`--state-file`/`--bindings-file` path, or an artifact
root directory) is never included in any logical identity, and importing
the same semantic reference content from two different filesystem locations
produces the same `referenceRequestId`. The bounded coding-agent handoff
(`ReferenceCorrectionHandoff`) never embeds raw reference image bytes, a
full `ObservationArtifact`, or a source excerpt - only stable identifiers,
bounded fidelity mismatch records, and evidence path *references*.

Import never silently promotes an image to an approved reference: only the
explicit `approve-reference` command (or `approveExternalReference`
programmatically) transitions a reference out of the `'imported'` lifecycle
state, and the v0.7 correction workflow's `prepareReferenceCorrection`/
`reviewReferenceCorrectionAttempt` both fail closed if the supplied
reference is not already approved. Neither function - nor anything either
calls - ever invokes `approveExternalReference` or
`approveAndPersistBaseline` itself; a `'pass'` review result is reported as
`approvalEligible: true`, a plain flag, never an automatic approval action.

Reference/candidate comparison and fidelity evaluation do not broaden the
existing browser/network boundary: candidate rendering continues through the
existing loopback-only Chromium observation path unchanged, and reference
evaluation itself never launches a browser at all (it consumes only
already-captured `ObservationArtifact` evidence). The v0.7 correction
workflow never edits target source: `src/domain/referenceCorrectionWorkflow.ts`
and everything it imports contain no filesystem-write call, no
`child_process` invocation, and no patch-application mechanism - the actual
source edit between review attempts is always the responsibility of an
external implementation actor (a human or a coding agent), never this
package's own product code. No remote AI/model-provider dependency was
introduced anywhere in v0.7.

## Interactive local viewer (v0.8, released as `0.8.0`)

`my-frontend-observer view` (`src/viewerServer/`, `viewer/`) is implemented,
tested, and formally security-reviewed. The properties below were verified
locally/manually during implementation (Batches 1-8) and then re-verified
through the formal pre-release security audit - see
`docs/reports/v0.8-prerelease-readiness-cross-platform-security-code-rot.md`,
which also found and fixed one real finding: a media filename that is
itself a symlink/junction pointing outside the evidence root could
previously have had its linked-to file's content served. `checkExists()`
(`src/viewerServer/evidence/mediaResolver.ts`) now uses `lstat()` and
rejects any non-regular-file entry, closing that escape.

- **Loopback-only, fixed local origin**: the Node viewer server binds only
  to `127.0.0.1` (never `0.0.0.0`), never a configurable remote host.
  `--port` selects the TCP port only (default `4319`); an explicit alternate
  port fails startup if already in use rather than silently falling back.
- **Explicit evidence root, path containment, traversal rejection**: `--root`
  is the only filesystem root the server ever reads from. Every artifact/
  media route resolves a caller-supplied handle against that root through
  the existing canonical discovery/classification path and rejects any
  handle that would resolve outside it - the server never exposes `--root`
  as a generic static directory or arbitrary filesystem path, and never
  interprets an `EvidenceReference` as a filesystem path to the browser.
- **No arbitrary filesystem browsing, no static-candidate path
  interpretation**: the viewer offers no directory-listing or free-path
  endpoint; every route addresses one specific, already-discovered handle.
- **Read-only API**: every `/api/*` route rejects non-`GET`/`HEAD` methods
  with `405` at a single top-of-handler check
  (`src/viewerServer/httpServer.ts`), covering every route uniformly,
  including ones added in later batches.
- **No target-source or evidence mutation**: the viewer server has no
  filesystem-write call anywhere in its own code path; it never edits
  target source and never modifies, supersedes, or persists a new instance
  of any existing Observer evidence artifact.
- **Binding/context files are explicit local session input, not persisted
  evidence**: `--bindings-file`/`--context-file` are read once at startup,
  validated through the existing canonical validators, held only in server
  memory, and never written into any Observer artifact or exposed as a
  filesystem path to the browser. The viewer never runs
  `@dailephd/my-dev-kit` and never rebuilds a bounded context or its
  correlation from these files - it only displays what it was given.
- **PWA shell cache scope**: the service worker precaches only the built
  application shell (HTML/JS/CSS/icons/manifest); `navigateFallbackDenylist`
  excludes every `/api/` route from the precache, verified both statically
  (built `sw.js`) and live (real Chromium: zero Cache Storage entries under
  any `/api/` pathname after normal use - see
  `docs/reports/v0.8-integrated-viewer-acceptance-batch8.md`).
- **Server-down stale-evidence protection**: proven in real Chromium - after
  the server is stopped and the page reloaded, the app shell may still
  render from the precache, but the evidence-dependent surface shows an
  explicit unavailable state, never previously-fetched evidence presented
  as current.

## Not yet addressed

Certificate-failure-specific handling, permission-prompt-specific handling
(Chromium's default deny-all applies; no permission is ever explicitly
granted), and any non-loopback/remote browsing mode remain unimplemented and
out of scope. `my-frontend-observer@0.8.0` is published to npm, and a
pre-release readiness CI workflow (Windows/Linux/macOS packed-candidate
validation, now covering the v0.8 viewer alongside every earlier version's
packed behavior) exists (see `docs/CI_CD.md`). The v0.7 external-reference/
correction-workflow security properties above are released as part of
`0.7.0`, following a completed cross-platform pre-release security
validation stage (see `docs/reports/v0.7-pre-release-readiness.md`). The
v0.8 interactive viewer's security boundary described above is released as
part of `0.8.0`, following a completed formal pre-release cross-platform
security validation stage (see
`docs/reports/v0.8-prerelease-readiness-cross-platform-security-code-rot.md`).
Symlink/junction filesystem-escape handling for the viewer's raw-evidence
routes is now exercised by a dedicated regression test
(`tests/unit/viewerEvidenceServer.test.ts`), which caught and led to the fix
described above. Annotation (v0.9) remains a future, unimplemented concern
with its own security review still to come. None of this expands the
security scope above: remote browsing, certificate handling,
permission-prompt handling, and future annotation-specific file handling
remain separate, unimplemented concerns.
