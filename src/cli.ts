#!/usr/bin/env node
import { realpathSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeRequest } from './request/request.js';
import type { RawObservationRequest } from './request/request.js';
import type { Diagnostic } from './domain/diagnostics.js';
import { getProducerInfo } from './domain/schema.js';
import type { ComparisonConfig } from './domain/comparison.js';
import { observe } from './application/observationPersistence.js';
import { compareAndPersistFromArtifactRoots } from './application/comparisonService.js';
import { approveAndPersistBaseline, persistPerChangeContract } from './application/frontendContractPersistenceService.js';
import { evaluateAndPersistFromArtifactRoots } from './application/frontendContractEvaluationService.js';
import { importExternalReference, approveExternalReference } from './application/externalReferencePersistenceService.js';
import { evaluateReferenceCandidateFidelityFromArtifactRoots } from './application/referenceFidelityEvaluationService.js';
import type { ReferenceRegion } from './domain/externalReferenceRegions.js';
import type { RawReferenceRequirement } from './domain/externalReferenceRequirements.js';
import type { ExternalReferenceApplicability } from './domain/externalReferenceApplicability.js';
import type { ReferenceRuntimeBindingDeclaration } from './domain/externalReferenceRuntimeBinding.js';
import { startViewer } from './viewerServer/viewerService.js';
import { openInDefaultBrowser } from './viewerServer/openBrowser.js';
import { DEFAULT_VIEWER_PORT } from './viewerServer/port.js';
import { classifyContextFileContent, MAX_CONTEXT_FILE_BYTES } from './viewerServer/context.js';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIO: CliIO = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

const TOP_LEVEL_HELP = `my-frontend-observer - local-first browser runtime evidence producer

Usage:
  my-frontend-observer <command> [options]

Commands:
  observe               Capture one bounded browser observation and persist
                        it as a portable artifact.
  compare               Compare two persisted observations and write a
                        structured comparison artifact.
  approve-baseline      Explicitly approve and persist one already-authored
                        persistent baseline contract against the observation
                        it claims to approve.
  save-change-contract  Validate and persist one already-authored per-change
                        contract so it can later be evaluated.
  evaluate-contract     Evaluate a candidate change against an approved
                        baseline, a per-change contract, and existing
                        before/after/comparison evidence, and persist the
                        result.
  import-reference      Validate and persist one local external design-
                        reference image as a new, unapproved
                        external-reference artifact.
  approve-reference     Explicitly approve one already-imported
                        external-reference artifact, persisting a new
                        approved artifact instance.
  evaluate-reference-fidelity  Evaluate whether a candidate observation
                        satisfies an external reference's selected design
                        requirements, gated by reference adequacy,
                        reference/candidate compatibility, and explicit
                        region-to-target bindings. Prints a structured
                        result; persists nothing.
  view                   Start the local, loopback-only viewer server and
                        print its URL for a normal browser or an installed
                        Progressive Web App.

Options:
  --help     Show this help.
  --version  Print the package version.

Run "my-frontend-observer <command> --help" for command-specific options.
`;

const VIEW_HELP = `Usage:
  my-frontend-observer view --root <evidence-root> [--bindings-file <json-file>] [--context-file <json-file>] [options]

Required:
  --root <path>   Local evidence-root directory the viewer session
                  represents. Validated operationally (must exist and be a
                  directory) - this batch does not read or interpret any
                  Observer artifacts under it.

Options:
  --port <n>      TCP port to bind, in [0, 65535]. Defaults to ${DEFAULT_VIEWER_PORT}.
                  An explicit alternate port is a different web origin than
                  the default - an installed PWA is not portable across
                  origins. If the requested port is already in use, this
                  command fails with an actionable error; it never silently
                  falls back to a different port.
  --bindings-file <json-file>  Local JSON file of the form
                  { "bindings": [ { "referenceRegion": "...", "runtimeTarget": "..." } ] }
                  (the exact same operational wrapper format as
                  \`evaluate-reference-fidelity --bindings-file\`, sharing its
                  parser). Explicit, session-only viewer input: read once at
                  startup, never persisted, never written into any Observer
                  artifact, and never exposed as a path to the browser. Its
                  declarations become available for on-demand binding/
                  fidelity evaluation once a reference and candidate are
                  explicitly selected in the viewer. Reference-specific
                  validity (region existence, etc.) is checked when a
                  reference is actually selected, not at startup - only the
                  file's own readability/JSON/wrapper shape is validated at
                  startup. Omit to run with no binding declarations (the
                  viewer remains fully usable; cross-selection stays
                  disabled).
  --context-file <json-file>  Local JSON file containing exactly one
                  BoundedAgentContextArtifact value directly (no wrapper
                  object) - e.g. { "artifactKind":
                  "my-frontend-observer/bounded-agent-context",
                  "schemaVersion": "1.0.0", ... }. Explicit, session-only
                  viewer input: read once at startup, validated through the
                  existing canonical isValidBoundedAgentContextArtifact,
                  held only in server memory, never persisted, never written
                  into any Observer artifact, and never exposed as a path to
                  the browser. Bounded agent context remains programmatic-
                  only as an Observer-produced contract - this command does
                  not add a way to generate, save, or write one; the viewer
                  never rebuilds it (no projectBoundedAgentContext call) and
                  never derives runtime/static correlation (no
                  deriveRuntimeStaticCorrelations/attachRuntimeStaticCorrelations
                  call) - it only displays the exact context it was given.
                  A recognized artifactKind with a schemaVersion other than
                  the currently supported one starts the viewer showing an
                  honest "unsupported version" context state rather than
                  failing. An unreadable file, invalid JSON, wrong
                  artifactKind, or a structurally invalid current-schema
                  artifact fails startup clearly. Omit to run with no
                  bounded context supplied (the viewer remains fully usable;
                  the context panel says none was supplied). May be combined
                  with --bindings-file.
  --no-open       Do not attempt to open the system default browser after
                  the server starts. Browser auto-open is a best-effort
                  convenience only: its failure is never fatal and never
                  affects server startup success.
  --help          Show this help.

Starts one Node HTTP server bound only to 127.0.0.1, serving the built
React + TypeScript + Vite viewer application (and its PWA manifest/service
worker) plus one minimal read-only status endpoint. The server never writes
to the supplied evidence root, never exposes it as a generic static
directory, and never launches a browser observation. The process keeps
running (serving the viewer) until interrupted. On success, prints the
viewer URL and exits only when the server stops. On invalid syntax, a
missing/non-directory --root, an invalid --port, or a port already in use,
prints structured diagnostics to stderr and exits nonzero without starting
a server.
`;

const OBSERVE_HELP = `Usage:
  my-frontend-observer observe --url <loopback-url> [options]

Required:
  --url <url>              Loopback target URL (http/https, localhost/127.x.x.x/::1 only).

Options:
  --viewport <WIDTHxHEIGHT> Viewport size, e.g. 1280x720.
  --target <id=selector>    An explicit CSS-shorthand observation target.
                            Repeatable. Parsed on the first "=" only, so
                            selectors containing "=" (e.g.
                            button[data-state="active"]) are preserved
                            intact. Cannot be combined with --targets-file.
  --targets-file <json-file> Loads structured semantic observation targets
                            from a local JSON file: { "targets": [ { "name":
                            "...", "locators": [ { "kind": "role"|"id"|
                            "data-attribute"|"semantic-element"|"css"|"text",
                            ... } ] } ] }. Locator order within a target is
                            the fallback order. Relative paths resolve from
                            the current working directory; the file path
                            itself is never persisted into the artifact or
                            included in the observation's request identity.
                            Cannot be combined with --target.
  --scroll-scenario-file <json-file>
                            Loads one bounded runtime scroll scenario from a
                            local JSON file: { "action": { "kind":
                            "window-scroll-by"|"target-scroll-by", ...,
                            "deltaX": <int>, "deltaY": <int> } }.
                            "target-scroll-by" additionally requires a
                            "target" naming a configured stable target.
                            Exactly zero or one scenario per observation.
                            Relative paths resolve from the current working
                            directory; the file path itself is never
                            persisted into the artifact or included in the
                            observation's request identity. May be combined
                            with either --target or --targets-file.
  --state-file <json-file>  Loads explicit, caller-declared frontend state
                            identity from a local JSON file: { "theme":
                            "...", "applicationState": "...",
                            "authenticatedState": "authenticated"|
                            "unauthenticated" } (each field independently
                            optional; at least one required). Never inferred
                            by the observer from screenshot pixels, CSS, DOM,
                            or URLs - this is caller-declared metadata only,
                            used solely for later comparability/compatibility
                            evaluation. Relative paths resolve from the
                            current working directory; the file path itself
                            is never persisted into the artifact or included
                            in the observation's request identity.
  --output <directory>      Portable, relative output location for the
                            observation artifact.
  --timeout <ms>            Overall request timeout in milliseconds.
  --help                    Show this help.

On success, prints a concise result and exits 0. On invalid syntax, invalid
request, unsafe/failed navigation, or a failed artifact write, prints
structured diagnostics to stderr and exits nonzero. No progress output is
printed during a normal capture.
`;

const COMPARE_HELP = `Usage:
  my-frontend-observer compare --before <observation-artifact-root> --after <observation-artifact-root> --output <directory> [options]

Required:
  --before <path>           Root directory of the "before" persisted
                             observation artifact (the directory containing
                             its manifest.json).
  --after <path>             Root directory of the "after" persisted
                             observation artifact.
  --output <directory>      Portable, relative output location for the
                            comparison artifact.

Options:
  --config-file <json-file> Loads a comparison configuration from a local
                            JSON file: { "geometryTolerancePx": <0-10>,
                            "expectedDependencies": [ { "cause": { "target":
                            "...", "property": "x"|"y"|"width"|"height",
                            "direction": "increase"|"decrease"|"change"|
                            "unchanged" }, "effect": { ... same shape ... },
                            "source": "explicit-config" } ] }. Relative
                            paths resolve from the current working
                            directory; the file path itself is never
                            persisted into the artifact or included in the
                            comparison request identity. Without
                            --config-file, geometryTolerancePx defaults to
                            0.5 with no declared dependencies.
  --help                    Show this help.

Comparison reads two already-persisted observation artifacts and derives
evidence purely from their existing content - it never launches a browser
and never re-observes either target. On success, prints a concise result
and exits 0, including when the two observations are found to be
"incomparable" (that is itself a successful comparison outcome, not a
failure). On invalid syntax, an unreadable or structurally invalid source
artifact, invalid configuration, or a failed artifact write, prints
structured diagnostics to stderr and exits nonzero. No progress output is
printed during a normal comparison.
`;

const APPROVE_BASELINE_HELP = `Usage:
  my-frontend-observer approve-baseline --observation <observation-artifact-root> --contract-file <json-file> --output <directory>

Required:
  --observation <path>      Root directory of the persisted observation
                             artifact (the directory containing its
                             manifest.json) that this baseline claims to
                             approve.
  --contract-file <json-file> Local JSON file containing one already-authored
                             persistent baseline contract (the raw contract
                             value, no wrapper field). Relative paths resolve
                             from the current working directory; the file
                             path itself is never persisted or included in
                             any identity.
  --output <directory>      Portable, relative output location for the
                             baseline artifact.

Options:
  --help                     Show this help.

This command is the only explicit baseline-approval act in the observer -
approval is never inferred from a successful comparison or evaluation. The
supplied contract's source-observation reference must match the supplied
observation artifact's stable identity; a mismatched or unrelated observation
is rejected. Any \`supersedesBaselineId\` already authored in the contract is
preserved exactly - this command never discovers, infers, or deletes a prior
baseline. Remains local and non-mutating: it never launches a browser and
never modifies the source observation or any existing baseline artifact. On
success, prints a concise result and exits 0. On invalid syntax, an
unreadable/malformed contract file, a non-baseline contract, a
structurally invalid contract, a source-observation mismatch, an existing
artifact collision, or a persistence failure, prints structured diagnostics
to stderr and exits nonzero.
`;

const SAVE_CHANGE_CONTRACT_HELP = `Usage:
  my-frontend-observer save-change-contract --contract-file <json-file> --output <directory>

Required:
  --contract-file <json-file> Local JSON file containing one already-authored
                             per-change contract (the raw contract value, no
                             wrapper field). Relative paths resolve from the
                             current working directory; the file path itself
                             is never persisted or included in any identity.
  --output <directory>      Portable, relative output location for the
                             change-contract artifact.

Options:
  --help                     Show this help.

This command validates and persists a per-change contract only - it does not
approve anything. Any \`supersedesBaselineClauseIds\` already authored on a
clause is preserved exactly; resolving those references against a particular
baseline remains \`evaluate-contract\`'s responsibility, not this command's.
Remains local and non-mutating. On success, prints a concise result and
exits 0. On invalid syntax, an unreadable/malformed contract file, a
non-change contract (e.g. a persistent baseline contract), a structurally
invalid contract (including an authored \`unexpected\` category, which is
never a valid authored scope), an existing artifact collision, or a
persistence failure, prints structured diagnostics to stderr and exits
nonzero.
`;

const EVALUATE_CONTRACT_HELP = `Usage:
  my-frontend-observer evaluate-contract --before <observation-artifact-root> --after <observation-artifact-root> --comparison <comparison-artifact-root> --baseline <baseline-contract-artifact-root> --change <per-change-contract-artifact-root> --output <directory> [--enforce]

Required:
  --before <path>      Root directory of the "before" persisted observation
                        artifact.
  --after <path>        Root directory of the "after" persisted observation
                        artifact.
  --comparison <path>   Root directory of the already-persisted comparison
                        artifact for that before/after pair.
  --baseline <path>     Root directory of the already-approved persistent
                        baseline contract artifact.
  --change <path>       Root directory of the already-persisted per-change
                        contract artifact.
  --output <directory>  Portable, relative output location for the
                        evaluation artifact.

Options:
  --enforce  Make a FAIL verdict produce a nonzero process exit status. A
             FAIL evaluation is always persisted and printed identically
             with or without this flag - it changes only the process exit
             code, never evaluation identity, contents, or persistence.
  --help     Show this help.

This command never launches a browser, never re-resolves targets, and never
recomputes comparison or relationship evidence - it reads the already-
persisted before/after observations and comparison exactly as given and
evaluates the supplied baseline/change contracts against them exactly once.
A FAIL verdict (a found regression or unsatisfied contract clause) is a
successful, persisted evaluation outcome, not an execution error; without
--enforce it exits 0 like PASS. On success (evaluation constructed and
persisted, verdict PASS, or verdict FAIL without --enforce), prints a
concise result and exits 0. With --enforce and verdict FAIL, prints the same
result and exits nonzero. On invalid syntax, an unreadable/malformed/
incoherent source artifact, or a persistence failure (evaluation could not
even be constructed), prints structured diagnostics to stderr, persists
nothing, and exits nonzero.
`;

const IMPORT_REFERENCE_HELP = `Usage:
  my-frontend-observer import-reference <image-file> --output <directory> [options]

Required:
  <image-file>           Local path to a PNG, JPEG, or WebP external design-
                          reference image.
  --output <directory>   Portable, relative output location for the
                          external-reference artifact.

Options:
  --label <text>         Optional human-readable label, stored as pure
                          provenance - never part of the reference's logical
                          identity.
  --supersedes <path>    Root directory of a prior external-reference
                          artifact (imported or approved) that this import
                          explicitly supersedes. The prior artifact is never
                          modified.
  --regions-file <json-file>  Local JSON file of the form { "regions": [...] }
                          declaring explicit, meaningful reference-image
                          regions (id + a {x, y, width, height} rectangle in
                          reference-image pixels, origin at the image's
                          top-left corner). Optional - a reference imported
                          without this flag behaves exactly as in v0.7 Prompt
                          1. Region content participates in the reference's
                          logical identity; the file path itself never does.
  --requirements-file <json-file>  Local JSON file of the form
                          { "requirements": [...] } declaring explicit,
                          user-selected design requirements over the regions
                          above - what actually matters for later candidate
                          evaluation, never inferred merely because a region
                          property/relationship exists. Each requirement has
                          a "category" (requested | expected-dependent |
                          protected | preserved - "unexpected" is never
                          authorable), a "subject" (a region property, a
                          region-to-region relationship, or a derived
                          two-region measurement), and - for property/
                          measurement subjects - a "tolerance" (exact |
                          absolute-reference-px | percent; relationship
                          subjects must omit tolerance). Requires --regions-
                          file (or an already-present region set) supplying
                          every region a requirement refers to. Optional -
                          a reference imported without this flag behaves
                          exactly as in v0.7 Prompt 1/2. Requirement content
                          participates in the reference's logical identity.
  --applicability-file <json-file>  Local JSON file declaring the runtime
                          frontend state this reference is intended to
                          represent: { "viewport": { "width", "height" },
                          "theme": "...", "applicationState": "...",
                          "authenticatedState": "authenticated"|
                          "unauthenticated" } (each field independently
                          optional; at least one required). "viewport" here
                          is the CSS-pixel runtime viewport the design
                          represents - distinct from the reference image's
                          own pixel dimensions, which are never assumed
                          equal. Never inferred from the image - caller-
                          declared metadata only, used for later reference/
                          candidate compatibility evaluation (see
                          docs/CONTRACTS.md "v0.7 Prompt 4"). Optional - a
                          reference imported without this flag behaves
                          exactly as in v0.7 Prompt 1/2/3. Applicability
                          content participates in the reference's logical
                          identity.
  --help                 Show this help.

Detects the image format from its header bytes only (never from the file
extension), reads its pixel dimensions from the same bounded header bytes
(never decoding pixel data), and persists a new external-reference artifact
in the "imported" lifecycle state - importing never approves it. On success,
prints a concise result (including the accepted region/requirement counts,
the resulting reference-side requirement adequacy: adequate, partial, or
inadequate, and whether applicability was declared) and exits 0. On an
unreadable file, an unsupported or undetectable format, invalid/out-of-bound
dimensions, an over-limit file size, an unresolvable --supersedes target, an
invalid region (missing/duplicate/malformed id, non-finite/negative/zero
geometry, a region extending outside the image, or more than the bounded
maximum region count), an invalid requirement (unsupported category/
property/measurement/relationship, a tolerance that is missing/inapplicable/
out of bounds, a reference to an unknown region id, a duplicate requirement
subject, or more than the bounded maximum requirement count), or invalid
applicability (an out-of-bound viewport, an invalid state label, an
unsupported authenticatedState value, or an empty applicability object),
prints structured diagnostics to stderr and exits nonzero.
`;

const APPROVE_REFERENCE_HELP = `Usage:
  my-frontend-observer approve-reference --reference <external-reference-artifact-root> --output <directory> [options]

Required:
  --reference <path>     Root directory of the already-imported
                          external-reference artifact (the directory
                          containing its manifest.json) to approve.
  --output <directory>   Portable, relative output location for the newly
                          persisted approved artifact.

Options:
  --supersedes <path>    Root directory of a prior external-reference
                          artifact (imported or approved) that this approval
                          explicitly supersedes. The prior artifact is never
                          modified.
  --help                 Show this help.

This is the only explicit reference-approval act in the observer - approval
is never inferred from a successful import or from any later fidelity
evaluation. Approving persists a brand-new artifact instance (a fresh
referenceId sharing the imported artifact's referenceRequestId) that carries
a reference back to the imported artifact's image rather than a second copy
of its bytes; the imported artifact's own manifest is never modified. Any
regions, requirements, and applicability already declared on the imported
artifact are carried forward unchanged (not re-validated against new input,
not re-derived) - approval never adds, removes, or edits regions,
requirements, or applicability. Only a reference currently in the "imported"
lifecycle state can be approved. On success, prints a concise result
(including the carried-forward region/requirement counts, reference-side
requirement adequacy, and whether applicability was declared) and exits 0.
On an unreadable/malformed --reference target, a target that is not in the
"imported" state, an unresolvable --supersedes target, or a persistence
failure, prints structured diagnostics to stderr and exits nonzero.
`;

const EVALUATE_REFERENCE_FIDELITY_HELP = `Usage:
  my-frontend-observer evaluate-reference-fidelity --reference <external-reference-artifact-root> --candidate <observation-artifact-root> [options]

Required:
  --reference <path>   Root directory of an already-imported or already-
                        approved external-reference artifact (the directory
                        containing its manifest.json).
  --candidate <path>   Root directory of the already-persisted candidate
                        observation artifact to evaluate against it.

Options:
  --bindings-file <json-file>  Local JSON file of the form
                        { "bindings": [ { "referenceRegion": "...",
                        "runtimeTarget": "..." } ] } declaring which stable
                        observer runtime target (a configured target name -
                        see "observe" --target/--targets-file) explicitly
                        corresponds to each reference region a selected
                        requirement depends on. Never inferred from
                        geometry, matching names, or source code - a
                        binding exists only because this file declares it.
                        Optional - omitting it (or supplying an empty
                        "bindings" array) evaluates with no bindings at
                        all, so every requirement whose subject depends on
                        a reference region becomes "unavailable".
  --enforce  Make a FAIL fidelity result produce a nonzero process exit
             status. A FAIL result is always printed identically with or
             without this flag - it changes only the process exit code,
             never the evaluation's content. Has no effect on a
             "not-evaluated" result (a reference-adequacy or compatibility
             blocker is never treated as a design mismatch).
  --help     Show this help.

This command never launches a browser, never re-resolves targets, and
never recomputes reference regions/requirements/adequacy, compatibility, or
bindings - it reads the already-persisted reference and candidate exactly
as given, evaluates the supplied binding declarations, and evaluates every
one of the reference's selected requirements exactly once. It persists
nothing: the result exists only for this invocation. On success, prints a
concise result (reference-side adequacy, compatibility state, the overall
fidelity state - "not-evaluated"/"pass"/"fail" - and a pass/fail/unavailable
requirement breakdown) and exits 0, unless --enforce is given and the
fidelity state is "fail", in which case it exits nonzero. A "not-evaluated"
result (reference adequacy inadequate, or reference/candidate
incompatible) is a successful, structured evaluation outcome, never an
execution error - it always exits 0. On invalid syntax, an unreadable/
malformed --reference or --candidate target, a malformed --bindings-file,
or an invalid/out-of-bound binding declaration, prints structured
diagnostics to stderr and exits nonzero.
`;

function parseViewport(raw: string): { width: number; height: number } | undefined {
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { width, height };
}

function parseTarget(raw: string): { name: string; selector: string } | undefined {
  const eq = raw.indexOf('=');
  if (eq <= 0 || eq === raw.length - 1) return undefined;
  return { name: raw.slice(0, eq), selector: raw.slice(eq + 1) };
}

type ParsedObserveArgs =
  | { ok: true; raw: RawObservationRequest; targetsFilePath?: string; scrollScenarioFilePath?: string; stateFilePath?: string }
  | { ok: false; errors: string[] };

/** CLI-syntax-only parsing: shape/format errors only. Domain bounds and policy are Batch 1's job, not this function's. */
function parseObserveArgs(argv: readonly string[]): ParsedObserveArgs {
  const errors: string[] = [];
  let targetUrl: string | undefined;
  let viewport: { width: number; height: number } | undefined;
  const targets: { name: string; selector: string }[] = [];
  let outputLocation: string | undefined;
  let timeoutMs: number | undefined;
  let targetsFilePath: string | undefined;
  let targetsFileFlagCount = 0;
  let scrollScenarioFilePath: string | undefined;
  let scrollScenarioFileFlagCount = 0;
  let stateFilePath: string | undefined;
  let stateFileFlagCount = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--url':
        targetUrl = argv[(i += 1)];
        break;
      case '--viewport': {
        const value = argv[(i += 1)];
        const parsed = value === undefined ? undefined : parseViewport(value);
        if (parsed === undefined) {
          errors.push(`--viewport must be WIDTHxHEIGHT (e.g. 1280x720); got ${JSON.stringify(value)}`);
        } else {
          viewport = parsed;
        }
        break;
      }
      case '--target': {
        const value = argv[(i += 1)];
        const parsed = value === undefined ? undefined : parseTarget(value);
        if (parsed === undefined) {
          errors.push(`--target must be id=css-selector; got ${JSON.stringify(value)}`);
        } else {
          targets.push(parsed);
        }
        break;
      }
      case '--targets-file': {
        const value = argv[(i += 1)];
        targetsFileFlagCount += 1;
        if (value === undefined) {
          errors.push('--targets-file requires a file path argument');
        } else if (targetsFileFlagCount > 1) {
          errors.push('--targets-file may only be specified once');
        } else {
          targetsFilePath = value;
        }
        break;
      }
      case '--scroll-scenario-file': {
        const value = argv[(i += 1)];
        scrollScenarioFileFlagCount += 1;
        if (value === undefined) {
          errors.push('--scroll-scenario-file requires a file path argument');
        } else if (scrollScenarioFileFlagCount > 1) {
          errors.push('--scroll-scenario-file may only be specified once');
        } else {
          scrollScenarioFilePath = value;
        }
        break;
      }
      case '--state-file': {
        const value = argv[(i += 1)];
        stateFileFlagCount += 1;
        if (value === undefined) {
          errors.push('--state-file requires a file path argument');
        } else if (stateFileFlagCount > 1) {
          errors.push('--state-file may only be specified once');
        } else {
          stateFilePath = value;
        }
        break;
      }
      case '--output':
        outputLocation = argv[(i += 1)];
        break;
      case '--timeout': {
        const value = argv[(i += 1)];
        const parsedNumber = value === undefined ? NaN : Number(value);
        if (!Number.isFinite(parsedNumber)) {
          errors.push(`--timeout must be a number of milliseconds; got ${JSON.stringify(value)}`);
        } else {
          timeoutMs = parsedNumber;
        }
        break;
      }
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }

  if (targetUrl === undefined) errors.push('--url is required');
  if (targets.length > 0 && targetsFilePath !== undefined) {
    errors.push('--target and --targets-file cannot be combined; use one or the other');
  }

  if (errors.length > 0) return { ok: false, errors };

  const raw: RawObservationRequest = {
    targetUrl,
    ...(viewport === undefined ? {} : { viewport }),
    ...(targets.length > 0 ? { targets } : {}),
    ...(outputLocation === undefined ? {} : { outputLocation }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  return {
    ok: true,
    raw,
    ...(targetsFilePath === undefined ? {} : { targetsFilePath }),
    ...(scrollScenarioFilePath === undefined ? {} : { scrollScenarioFilePath }),
    ...(stateFilePath === undefined ? {} : { stateFilePath }),
  };
}

const TARGETS_FILE_ALLOWED_ROOT_FIELDS = new Set(['targets']);
const REGIONS_FILE_ALLOWED_ROOT_FIELDS = new Set(['regions']);

type LoadRegionsFileResult = { ok: true; regions: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility, mirroring loadTargetsFile exactly:
 * read one local JSON file, validate only the root wrapper (object root,
 * exactly the "regions" field, nothing else), and hand the still-unvalidated
 * `regions` value to the existing domain validators
 * (isValidReferenceRegions, called inside importExternalReference) - region
 * geometry/ID rules stay owned there, never duplicated here. The file path
 * itself is never returned beyond this function, so it can never reach the
 * persisted artifact or its identity.
 */
function loadRegionsFile(filePath: string): LoadRegionsFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--regions-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--regions-file is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '--regions-file root must be a JSON object' };
  }

  const record = parsed as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter((key) => !REGIONS_FILE_ALLOWED_ROOT_FIELDS.has(key));
  if (unknownFields.length > 0) {
    return { ok: false, error: `--regions-file has unsupported top-level field(s): ${unknownFields.join(', ')}` };
  }
  if (!('regions' in record)) {
    return { ok: false, error: '--regions-file must have a "regions" property' };
  }

  return { ok: true, regions: record.regions };
}

const REQUIREMENTS_FILE_ALLOWED_ROOT_FIELDS = new Set(['requirements']);

type LoadRequirementsFileResult = { ok: true; requirements: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility, mirroring loadRegionsFile exactly:
 * read one local JSON file, validate only the root wrapper (object root,
 * exactly the "requirements" field, nothing else), and hand the
 * still-unvalidated `requirements` value to the existing domain validators
 * (isValidRawReferenceRequirement/isValidReferenceRequirements, called
 * inside importExternalReference) - requirement category/subject/tolerance
 * rules stay owned there, never duplicated here. The file path itself is
 * never returned beyond this function, so it can never reach the persisted
 * artifact or its identity.
 */
function loadRequirementsFile(filePath: string): LoadRequirementsFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--requirements-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--requirements-file is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '--requirements-file root must be a JSON object' };
  }

  const record = parsed as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter((key) => !REQUIREMENTS_FILE_ALLOWED_ROOT_FIELDS.has(key));
  if (unknownFields.length > 0) {
    return { ok: false, error: `--requirements-file has unsupported top-level field(s): ${unknownFields.join(', ')}` };
  }
  if (!('requirements' in record)) {
    return { ok: false, error: '--requirements-file must have a "requirements" property' };
  }

  return { ok: true, requirements: record.requirements };
}

type LoadApplicabilityFileResult = { ok: true; applicability: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility, mirroring `loadStateFile`/
 * `loadScrollScenarioFile`: read one local JSON file and validate only the
 * root shape (plain, non-array object) - the file supplies
 * `ExternalReferenceApplicability` directly (no wrapper field), so there is
 * no root-field allowlist to enforce here. Every applicability rule
 * (viewport bounds, state-label pattern, authenticatedState enum) stays
 * owned by `isValidExternalReferenceApplicability`, not duplicated here. The
 * file path itself is never returned beyond this function, so it can never
 * reach the persisted artifact or its identity.
 */
function loadApplicabilityFile(filePath: string): LoadApplicabilityFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--applicability-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--applicability-file is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '--applicability-file root must be a JSON object' };
  }

  return { ok: true, applicability: parsed };
}

const BINDINGS_FILE_ALLOWED_ROOT_FIELDS = new Set(['bindings']);

type LoadBindingsFileResult = { ok: true; bindings: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility, mirroring `loadRegionsFile`/
 * `loadRequirementsFile` exactly: read one local JSON file, validate only
 * the root wrapper (object root, exactly the "bindings" property, nothing
 * else), and hand the still-unvalidated `bindings` value to the existing
 * domain validator (`isValidReferenceRuntimeBindingDeclarations`, called
 * inside `evaluateReferenceCandidateFidelity`) - every binding-declaration
 * rule (shape, bounds, reference-region existence, duplicate/conflict)
 * stays owned there, never duplicated here. The file path itself is never
 * returned beyond this function, so it can never reach the evaluation
 * result or any identity.
 */
function loadBindingsFile(filePath: string): LoadBindingsFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--bindings-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--bindings-file is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '--bindings-file root must be a JSON object' };
  }

  const record = parsed as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter((key) => !BINDINGS_FILE_ALLOWED_ROOT_FIELDS.has(key));
  if (unknownFields.length > 0) {
    return { ok: false, error: `--bindings-file has unsupported top-level field(s): ${unknownFields.join(', ')}` };
  }
  if (!('bindings' in record)) {
    return { ok: false, error: '--bindings-file must have a "bindings" property' };
  }

  return { ok: true, bindings: record.bindings };
}

type LoadContextFileResult = { ok: true; state: import('./viewerServer/context.js').ContextSessionState } | { ok: false; error: string };

/**
 * v0.8 Batch 7 CLI/input-boundary-only responsibility, mirroring
 * `loadBindingsFile`'s exact shape: read one local JSON file (size-bounded
 * via `MAX_CONTEXT_FILE_BYTES`, checked via `statSync` before ever reading
 * the file's bytes), parse it, and hand the parsed value to
 * `classifyContextFileContent` - every artifactKind/schemaVersion/structural
 * rule stays owned there (which itself defers all current-schema structural
 * validation to the existing canonical `isValidBoundedAgentContextArtifact`,
 * never a second validator). Unlike `--bindings-file`, the context file's
 * root IS the artifact value directly (task §12) - no wrapper object. The
 * file path itself is never returned beyond this function.
 */
function loadContextFile(filePath: string): LoadContextFileResult {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--context-file could not be read: ${message}` };
  }
  if (size > MAX_CONTEXT_FILE_BYTES) {
    return { ok: false, error: `--context-file exceeds the bounded size limit (${MAX_CONTEXT_FILE_BYTES} bytes)` };
  }

  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--context-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--context-file is not valid JSON: ${message}` };
  }

  const classified = classifyContextFileContent(parsed);
  if (!classified.ok) return { ok: false, error: classified.error };
  return { ok: true, state: classified.state };
}

type LoadTargetsFileResult = { ok: true; targets: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility: read one local JSON file, validate
 * only the root wrapper this file format owns (object root, exactly the
 * "targets" field, nothing else), and hand the still-unvalidated `targets`
 * value to the existing `normalizeRequest()` - every target/locator-internal
 * rule (bounds, locator kinds, per-kind fields) stays owned there, not
 * duplicated here. The file path itself is never returned to the caller
 * beyond this function, so it can never reach the persisted request/artifact.
 */
function loadTargetsFile(filePath: string): LoadTargetsFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--targets-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--targets-file is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '--targets-file root must be a JSON object' };
  }

  const record = parsed as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter((key) => !TARGETS_FILE_ALLOWED_ROOT_FIELDS.has(key));
  if (unknownFields.length > 0) {
    return { ok: false, error: `--targets-file has unsupported top-level field(s): ${unknownFields.join(', ')}` };
  }
  if (!('targets' in record)) {
    return { ok: false, error: '--targets-file must have a "targets" property' };
  }

  return { ok: true, targets: record.targets };
}

type LoadScrollScenarioFileResult = { ok: true; scenario: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility, mirroring `loadTargetsFile`: read
 * one local JSON file and validate only the root shape this file format
 * owns (plain, non-array object) - the file supplies the value of
 * `RawObservationRequest.scrollScenario` directly (no wrapper field), so
 * there is no root-field allowlist to enforce here the way
 * `loadTargetsFile` enforces `{ "targets": [...] }`. Every scenario/action
 * rule (supported kind, required action, delta types/bounds, the both-zero
 * rule, stable target reference, unknown fields) stays owned by
 * `normalizeRequest()`, not duplicated here. The file path itself is never
 * returned to the caller beyond this function, so it can never reach the
 * persisted request/artifact.
 */
function loadScrollScenarioFile(filePath: string): LoadScrollScenarioFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--scroll-scenario-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--scroll-scenario-file is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '--scroll-scenario-file root must be a JSON object' };
  }

  return { ok: true, scenario: parsed };
}

type LoadStateFileResult = { ok: true; state: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility, mirroring `loadScrollScenarioFile`
 * exactly: read one local JSON file and validate only the root shape (plain,
 * non-array object) - the file supplies the value of
 * `RawObservationRequest.explicitState` directly (no wrapper field), so
 * there is no root-field allowlist to enforce here. Every state rule
 * (supported dimension keys, label pattern, authenticatedState enum) stays
 * owned by `normalizeRequest()`/`isValidExplicitStateDimensions`, not
 * duplicated here. The file path itself is never returned to the caller
 * beyond this function, so it can never reach the persisted request/artifact.
 */
function loadStateFile(filePath: string): LoadStateFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--state-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--state-file is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '--state-file root must be a JSON object' };
  }

  return { ok: true, state: parsed };
}

type ParsedCompareArgs =
  | { ok: true; beforeRoot: string; afterRoot: string; outputLocation: string; configFilePath?: string }
  | { ok: false; errors: string[] };

/** CLI-syntax-only parsing, mirroring `parseObserveArgs`: shape/presence/duplication errors only. Comparison-config semantics stay owned by the existing domain validator. */
function parseCompareArgs(argv: readonly string[]): ParsedCompareArgs {
  const errors: string[] = [];
  let beforeRoot: string | undefined;
  let beforeFlagCount = 0;
  let afterRoot: string | undefined;
  let afterFlagCount = 0;
  let outputLocation: string | undefined;
  let outputFlagCount = 0;
  let configFilePath: string | undefined;
  let configFileFlagCount = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--before': {
        const value = argv[(i += 1)];
        beforeFlagCount += 1;
        if (value === undefined) {
          errors.push('--before requires a path argument');
        } else if (beforeFlagCount > 1) {
          errors.push('--before may only be specified once');
        } else {
          beforeRoot = value;
        }
        break;
      }
      case '--after': {
        const value = argv[(i += 1)];
        afterFlagCount += 1;
        if (value === undefined) {
          errors.push('--after requires a path argument');
        } else if (afterFlagCount > 1) {
          errors.push('--after may only be specified once');
        } else {
          afterRoot = value;
        }
        break;
      }
      case '--output': {
        const value = argv[(i += 1)];
        outputFlagCount += 1;
        if (value === undefined) {
          errors.push('--output requires a directory argument');
        } else if (outputFlagCount > 1) {
          errors.push('--output may only be specified once');
        } else {
          outputLocation = value;
        }
        break;
      }
      case '--config-file': {
        const value = argv[(i += 1)];
        configFileFlagCount += 1;
        if (value === undefined) {
          errors.push('--config-file requires a file path argument');
        } else if (configFileFlagCount > 1) {
          errors.push('--config-file may only be specified once');
        } else {
          configFilePath = value;
        }
        break;
      }
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }

  if (beforeRoot === undefined) errors.push('--before is required');
  if (afterRoot === undefined) errors.push('--after is required');
  if (outputLocation === undefined) errors.push('--output is required');

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    beforeRoot: beforeRoot as string,
    afterRoot: afterRoot as string,
    outputLocation: outputLocation as string,
    ...(configFilePath === undefined ? {} : { configFilePath }),
  };
}

type LoadComparisonConfigFileResult = { ok: true; config: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility, mirroring `loadScrollScenarioFile`:
 * read one local JSON file and validate only the root shape this file format
 * owns (plain, non-array object) - the file supplies the value of
 * `ComparisonConfig` directly (no wrapper field). Every semantic rule
 * (geometry tolerance bounds, dependency property/direction vocabulary,
 * dependency source/provenance) stays owned by the existing comparison
 * domain validator (`isValidComparisonConfig`, invoked inside
 * `compareObservations`), not duplicated here. The file path itself is
 * never returned to the caller beyond this function, so it can never reach
 * the persisted comparison artifact or its request identity.
 */
function loadComparisonConfigFile(filePath: string): LoadComparisonConfigFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--config-file could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `--config-file is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '--config-file root must be a JSON object' };
  }

  return { ok: true, config: parsed };
}

type LoadContractFileResult = { ok: true; contract: unknown } | { ok: false; error: string };

/**
 * CLI/input-boundary-only responsibility, mirroring `loadComparisonConfigFile`:
 * read one local JSON file and validate only the root shape this file format
 * owns (plain, non-array object) - the file supplies the raw contract value
 * directly (no wrapper field). Every semantic/structural rule (artifact
 * kind, schema version, contract class, clause shape, authored category
 * vocabulary) stays owned by the existing frozen domain validators
 * (`isValidPersistentBaselineContract`/`isValidPerChangeContract`, invoked
 * inside the application layer), never duplicated here. The file path
 * itself is never returned to the caller beyond this function, so it can
 * never reach a persisted artifact or its identity.
 */
function loadContractFile(filePath: string, flagLabel: string): LoadContractFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${flagLabel} could not be read: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${flagLabel} is not valid JSON: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: `${flagLabel} root must be a JSON object` };
  }

  return { ok: true, contract: parsed };
}

type ParsedApproveBaselineArgs =
  | { ok: true; observationRoot: string; contractFilePath: string; outputLocation: string }
  | { ok: false; errors: string[] };

/** CLI-syntax-only parsing, mirroring `parseCompareArgs`. */
function parseApproveBaselineArgs(argv: readonly string[]): ParsedApproveBaselineArgs {
  const errors: string[] = [];
  let observationRoot: string | undefined;
  let observationFlagCount = 0;
  let contractFilePath: string | undefined;
  let contractFileFlagCount = 0;
  let outputLocation: string | undefined;
  let outputFlagCount = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--observation': {
        const value = argv[(i += 1)];
        observationFlagCount += 1;
        if (value === undefined) errors.push('--observation requires a path argument');
        else if (observationFlagCount > 1) errors.push('--observation may only be specified once');
        else observationRoot = value;
        break;
      }
      case '--contract-file': {
        const value = argv[(i += 1)];
        contractFileFlagCount += 1;
        if (value === undefined) errors.push('--contract-file requires a file path argument');
        else if (contractFileFlagCount > 1) errors.push('--contract-file may only be specified once');
        else contractFilePath = value;
        break;
      }
      case '--output': {
        const value = argv[(i += 1)];
        outputFlagCount += 1;
        if (value === undefined) errors.push('--output requires a directory argument');
        else if (outputFlagCount > 1) errors.push('--output may only be specified once');
        else outputLocation = value;
        break;
      }
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }

  if (observationRoot === undefined) errors.push('--observation is required');
  if (contractFilePath === undefined) errors.push('--contract-file is required');
  if (outputLocation === undefined) errors.push('--output is required');

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, observationRoot: observationRoot as string, contractFilePath: contractFilePath as string, outputLocation: outputLocation as string };
}

type ParsedSaveChangeContractArgs = { ok: true; contractFilePath: string; outputLocation: string } | { ok: false; errors: string[] };

/** CLI-syntax-only parsing, mirroring `parseCompareArgs`. */
function parseSaveChangeContractArgs(argv: readonly string[]): ParsedSaveChangeContractArgs {
  const errors: string[] = [];
  let contractFilePath: string | undefined;
  let contractFileFlagCount = 0;
  let outputLocation: string | undefined;
  let outputFlagCount = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--contract-file': {
        const value = argv[(i += 1)];
        contractFileFlagCount += 1;
        if (value === undefined) errors.push('--contract-file requires a file path argument');
        else if (contractFileFlagCount > 1) errors.push('--contract-file may only be specified once');
        else contractFilePath = value;
        break;
      }
      case '--output': {
        const value = argv[(i += 1)];
        outputFlagCount += 1;
        if (value === undefined) errors.push('--output requires a directory argument');
        else if (outputFlagCount > 1) errors.push('--output may only be specified once');
        else outputLocation = value;
        break;
      }
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }

  if (contractFilePath === undefined) errors.push('--contract-file is required');
  if (outputLocation === undefined) errors.push('--output is required');

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, contractFilePath: contractFilePath as string, outputLocation: outputLocation as string };
}

type ParsedEvaluateContractArgs =
  | { ok: true; beforeRoot: string; afterRoot: string; comparisonRoot: string; baselineRoot: string; changeRoot: string; outputLocation: string; enforce: boolean }
  | { ok: false; errors: string[] };

/** CLI-syntax-only parsing. `--enforce` is a boolean switch (no value); repeating it is harmless (idempotent), matching a boolean flag's natural semantics rather than the "may only be specified once" policy used for single-value flags. */
function parseEvaluateContractArgs(argv: readonly string[]): ParsedEvaluateContractArgs {
  const errors: string[] = [];
  let beforeRoot: string | undefined;
  let beforeFlagCount = 0;
  let afterRoot: string | undefined;
  let afterFlagCount = 0;
  let comparisonRoot: string | undefined;
  let comparisonFlagCount = 0;
  let baselineRoot: string | undefined;
  let baselineFlagCount = 0;
  let changeRoot: string | undefined;
  let changeFlagCount = 0;
  let outputLocation: string | undefined;
  let outputFlagCount = 0;
  let enforce = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--before': {
        const value = argv[(i += 1)];
        beforeFlagCount += 1;
        if (value === undefined) errors.push('--before requires a path argument');
        else if (beforeFlagCount > 1) errors.push('--before may only be specified once');
        else beforeRoot = value;
        break;
      }
      case '--after': {
        const value = argv[(i += 1)];
        afterFlagCount += 1;
        if (value === undefined) errors.push('--after requires a path argument');
        else if (afterFlagCount > 1) errors.push('--after may only be specified once');
        else afterRoot = value;
        break;
      }
      case '--comparison': {
        const value = argv[(i += 1)];
        comparisonFlagCount += 1;
        if (value === undefined) errors.push('--comparison requires a path argument');
        else if (comparisonFlagCount > 1) errors.push('--comparison may only be specified once');
        else comparisonRoot = value;
        break;
      }
      case '--baseline': {
        const value = argv[(i += 1)];
        baselineFlagCount += 1;
        if (value === undefined) errors.push('--baseline requires a path argument');
        else if (baselineFlagCount > 1) errors.push('--baseline may only be specified once');
        else baselineRoot = value;
        break;
      }
      case '--change': {
        const value = argv[(i += 1)];
        changeFlagCount += 1;
        if (value === undefined) errors.push('--change requires a path argument');
        else if (changeFlagCount > 1) errors.push('--change may only be specified once');
        else changeRoot = value;
        break;
      }
      case '--output': {
        const value = argv[(i += 1)];
        outputFlagCount += 1;
        if (value === undefined) errors.push('--output requires a directory argument');
        else if (outputFlagCount > 1) errors.push('--output may only be specified once');
        else outputLocation = value;
        break;
      }
      case '--enforce':
        enforce = true;
        break;
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }

  if (beforeRoot === undefined) errors.push('--before is required');
  if (afterRoot === undefined) errors.push('--after is required');
  if (comparisonRoot === undefined) errors.push('--comparison is required');
  if (baselineRoot === undefined) errors.push('--baseline is required');
  if (changeRoot === undefined) errors.push('--change is required');
  if (outputLocation === undefined) errors.push('--output is required');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    beforeRoot: beforeRoot as string,
    afterRoot: afterRoot as string,
    comparisonRoot: comparisonRoot as string,
    baselineRoot: baselineRoot as string,
    changeRoot: changeRoot as string,
    outputLocation: outputLocation as string,
    enforce,
  };
}

type ParsedImportReferenceArgs =
  | {
      ok: true;
      imageFilePath: string;
      outputLocation: string;
      label?: string;
      supersedesReferenceRoot?: string;
      regionsFilePath?: string;
      requirementsFilePath?: string;
      applicabilityFilePath?: string;
    }
  | { ok: false; errors: string[] };

/** CLI-syntax-only parsing, mirroring `parseApproveBaselineArgs`. The image file path is the one positional argument. */
function parseImportReferenceArgs(argv: readonly string[]): ParsedImportReferenceArgs {
  const errors: string[] = [];
  let imageFilePath: string | undefined;
  let outputLocation: string | undefined;
  let outputFlagCount = 0;
  let label: string | undefined;
  let labelFlagCount = 0;
  let supersedesReferenceRoot: string | undefined;
  let supersedesFlagCount = 0;
  let regionsFilePath: string | undefined;
  let regionsFileFlagCount = 0;
  let requirementsFilePath: string | undefined;
  let requirementsFileFlagCount = 0;
  let applicabilityFilePath: string | undefined;
  let applicabilityFileFlagCount = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--output': {
        const value = argv[(i += 1)];
        outputFlagCount += 1;
        if (value === undefined) errors.push('--output requires a directory argument');
        else if (outputFlagCount > 1) errors.push('--output may only be specified once');
        else outputLocation = value;
        break;
      }
      case '--label': {
        const value = argv[(i += 1)];
        labelFlagCount += 1;
        if (value === undefined) errors.push('--label requires a text argument');
        else if (labelFlagCount > 1) errors.push('--label may only be specified once');
        else label = value;
        break;
      }
      case '--supersedes': {
        const value = argv[(i += 1)];
        supersedesFlagCount += 1;
        if (value === undefined) errors.push('--supersedes requires a path argument');
        else if (supersedesFlagCount > 1) errors.push('--supersedes may only be specified once');
        else supersedesReferenceRoot = value;
        break;
      }
      case '--regions-file': {
        const value = argv[(i += 1)];
        regionsFileFlagCount += 1;
        if (value === undefined) errors.push('--regions-file requires a file path argument');
        else if (regionsFileFlagCount > 1) errors.push('--regions-file may only be specified once');
        else regionsFilePath = value;
        break;
      }
      case '--requirements-file': {
        const value = argv[(i += 1)];
        requirementsFileFlagCount += 1;
        if (value === undefined) errors.push('--requirements-file requires a file path argument');
        else if (requirementsFileFlagCount > 1) errors.push('--requirements-file may only be specified once');
        else requirementsFilePath = value;
        break;
      }
      case '--applicability-file': {
        const value = argv[(i += 1)];
        applicabilityFileFlagCount += 1;
        if (value === undefined) errors.push('--applicability-file requires a file path argument');
        else if (applicabilityFileFlagCount > 1) errors.push('--applicability-file may only be specified once');
        else applicabilityFilePath = value;
        break;
      }
      default:
        if (arg === undefined) break;
        if (arg.startsWith('--')) errors.push(`unrecognized argument: ${arg}`);
        else if (imageFilePath !== undefined) errors.push('only one image-file argument may be given');
        else imageFilePath = arg;
    }
  }

  if (imageFilePath === undefined) errors.push('an image-file argument is required');
  if (outputLocation === undefined) errors.push('--output is required');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    imageFilePath: imageFilePath as string,
    outputLocation: outputLocation as string,
    ...(label === undefined ? {} : { label }),
    ...(supersedesReferenceRoot === undefined ? {} : { supersedesReferenceRoot }),
    ...(regionsFilePath === undefined ? {} : { regionsFilePath }),
    ...(requirementsFilePath === undefined ? {} : { requirementsFilePath }),
    ...(applicabilityFilePath === undefined ? {} : { applicabilityFilePath }),
  };
}

type ParsedApproveReferenceArgs =
  | { ok: true; referenceRoot: string; outputLocation: string; supersedesReferenceRoot?: string }
  | { ok: false; errors: string[] };

/** CLI-syntax-only parsing, mirroring `parseApproveBaselineArgs`. */
function parseApproveReferenceArgs(argv: readonly string[]): ParsedApproveReferenceArgs {
  const errors: string[] = [];
  let referenceRoot: string | undefined;
  let referenceFlagCount = 0;
  let outputLocation: string | undefined;
  let outputFlagCount = 0;
  let supersedesReferenceRoot: string | undefined;
  let supersedesFlagCount = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--reference': {
        const value = argv[(i += 1)];
        referenceFlagCount += 1;
        if (value === undefined) errors.push('--reference requires a path argument');
        else if (referenceFlagCount > 1) errors.push('--reference may only be specified once');
        else referenceRoot = value;
        break;
      }
      case '--output': {
        const value = argv[(i += 1)];
        outputFlagCount += 1;
        if (value === undefined) errors.push('--output requires a directory argument');
        else if (outputFlagCount > 1) errors.push('--output may only be specified once');
        else outputLocation = value;
        break;
      }
      case '--supersedes': {
        const value = argv[(i += 1)];
        supersedesFlagCount += 1;
        if (value === undefined) errors.push('--supersedes requires a path argument');
        else if (supersedesFlagCount > 1) errors.push('--supersedes may only be specified once');
        else supersedesReferenceRoot = value;
        break;
      }
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }

  if (referenceRoot === undefined) errors.push('--reference is required');
  if (outputLocation === undefined) errors.push('--output is required');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    referenceRoot: referenceRoot as string,
    outputLocation: outputLocation as string,
    ...(supersedesReferenceRoot === undefined ? {} : { supersedesReferenceRoot }),
  };
}

type ParsedEvaluateReferenceFidelityArgs =
  | { ok: true; referenceRoot: string; candidateRoot: string; bindingsFilePath?: string; enforce: boolean }
  | { ok: false; errors: string[] };

/** CLI-syntax-only parsing, mirroring `parseEvaluateContractArgs`'s `--enforce` handling exactly. */
function parseEvaluateReferenceFidelityArgs(argv: readonly string[]): ParsedEvaluateReferenceFidelityArgs {
  const errors: string[] = [];
  let referenceRoot: string | undefined;
  let referenceFlagCount = 0;
  let candidateRoot: string | undefined;
  let candidateFlagCount = 0;
  let bindingsFilePath: string | undefined;
  let bindingsFileFlagCount = 0;
  let enforce = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--reference': {
        const value = argv[(i += 1)];
        referenceFlagCount += 1;
        if (value === undefined) errors.push('--reference requires a path argument');
        else if (referenceFlagCount > 1) errors.push('--reference may only be specified once');
        else referenceRoot = value;
        break;
      }
      case '--candidate': {
        const value = argv[(i += 1)];
        candidateFlagCount += 1;
        if (value === undefined) errors.push('--candidate requires a path argument');
        else if (candidateFlagCount > 1) errors.push('--candidate may only be specified once');
        else candidateRoot = value;
        break;
      }
      case '--bindings-file': {
        const value = argv[(i += 1)];
        bindingsFileFlagCount += 1;
        if (value === undefined) errors.push('--bindings-file requires a file path argument');
        else if (bindingsFileFlagCount > 1) errors.push('--bindings-file may only be specified once');
        else bindingsFilePath = value;
        break;
      }
      case '--enforce':
        enforce = true;
        break;
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }

  if (referenceRoot === undefined) errors.push('--reference is required');
  if (candidateRoot === undefined) errors.push('--candidate is required');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    referenceRoot: referenceRoot as string,
    candidateRoot: candidateRoot as string,
    ...(bindingsFilePath === undefined ? {} : { bindingsFilePath }),
    enforce,
  };
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const target = diagnostic.targetName === undefined ? '' : ` (target: ${diagnostic.targetName})`;
  return `[${diagnostic.code}] ${diagnostic.message}${target}`;
}

/** Completion states that must never be reported as a successful process exit, even though they may still have a persisted artifact. */
const NON_SUCCESS_COMPLETION_STATES = new Set(['fatal', 'invalid-request']);

async function runObserveCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(OBSERVE_HELP);
    return 0;
  }

  const parsedArgs = parseObserveArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(OBSERVE_HELP);
    return 1;
  }

  let raw = parsedArgs.raw;
  if (parsedArgs.targetsFilePath !== undefined) {
    const loaded = loadTargetsFile(parsedArgs.targetsFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(OBSERVE_HELP);
      return 1;
    }
    raw = { ...raw, targets: loaded.targets };
  }
  if (parsedArgs.scrollScenarioFilePath !== undefined) {
    const loaded = loadScrollScenarioFile(parsedArgs.scrollScenarioFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(OBSERVE_HELP);
      return 1;
    }
    raw = { ...raw, scrollScenario: loaded.scenario };
  }
  if (parsedArgs.stateFilePath !== undefined) {
    const loaded = loadStateFile(parsedArgs.stateFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(OBSERVE_HELP);
      return 1;
    }
    raw = { ...raw, explicitState: loaded.state };
  }

  const normalized = normalizeRequest(raw);
  if (!normalized.ok) {
    for (const diagnostic of normalized.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  // Exactly one application observation attempt: one browser capture, persisted at most once.
  const result = await observe(normalized.request);
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  io.stdout(`Observation: ${result.observationId}\n`);
  io.stdout(`State: ${result.completion.state}\n`);
  io.stdout(`Artifact: ${result.artifactRoot}\n`);
  io.stdout(`Targets: ${result.targetCount}\n`);
  io.stdout(`Diagnostics: ${result.diagnostics.length}\n`);

  return NON_SUCCESS_COMPLETION_STATES.has(result.completion.state) ? 1 : 0;
}

/**
 * Thin orchestration only: parse args, optionally load a config file, then
 * delegate to the existing `compareAndPersistFromArtifactRoots` application
 * function exactly once. No comparability/geometry/relationship/dependency
 * logic lives here - see `src/domain/comparisonEngine.ts`. `incomparable` is
 * a successful comparison outcome (the operation determined the two
 * observations should not be treated as equivalent frontend states), so it
 * exits 0 exactly like `comparable`/`comparable-with-warnings`; only a
 * genuine parse/read/domain/persistence failure exits nonzero.
 */
async function runCompareCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(COMPARE_HELP);
    return 0;
  }

  const parsedArgs = parseCompareArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(COMPARE_HELP);
    return 1;
  }

  let config: Partial<ComparisonConfig> | undefined;
  if (parsedArgs.configFilePath !== undefined) {
    const loaded = loadComparisonConfigFile(parsedArgs.configFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(COMPARE_HELP);
      return 1;
    }
    config = loaded.config as Partial<ComparisonConfig>;
  }

  // Exactly one application comparison attempt: two artifact reads, one pure comparison, persisted at most once.
  const result = await compareAndPersistFromArtifactRoots(parsedArgs.beforeRoot, parsedArgs.afterRoot, {
    ...(config === undefined ? {} : { config }),
    outputLocation: parsedArgs.outputLocation,
  });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  io.stdout(`Comparison: ${result.comparisonId}\n`);
  io.stdout(`State: ${result.comparability}\n`);
  io.stdout(`Artifact: ${result.artifactRoot}\n`);
  io.stdout(`Differences: ${result.differenceCount}\n`);
  io.stdout(`Relationship changes: ${result.relationshipChangeCount}\n`);
  io.stdout(`Diagnostics: ${result.diagnosticsCount}\n`);

  return 0;
}

/**
 * Thin orchestration only: parse args, load the raw contract JSON file, then
 * delegate to the existing `approveAndPersistBaseline` application function
 * exactly once. No contract/coherence validation lives here - see
 * `src/application/frontendContractPersistenceService.ts`. This is the only
 * command in the observer that approves a baseline.
 */
async function runApproveBaselineCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(APPROVE_BASELINE_HELP);
    return 0;
  }

  const parsedArgs = parseApproveBaselineArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(APPROVE_BASELINE_HELP);
    return 1;
  }

  const loaded = loadContractFile(parsedArgs.contractFilePath, '--contract-file');
  if (!loaded.ok) {
    io.stderr(`error: ${loaded.error}\n`);
    io.stderr(APPROVE_BASELINE_HELP);
    return 1;
  }

  // Exactly one application approval attempt: one observation read, one coherence check, persisted at most once.
  const result = await approveAndPersistBaseline(loaded.contract, parsedArgs.observationRoot, { outputLocation: parsedArgs.outputLocation });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  io.stdout(`Baseline: ${result.baselineId}\n`);
  io.stdout(`State: approved\n`);
  io.stdout(`Artifact: ${result.artifactRoot}\n`);
  io.stdout(`Clauses: ${result.clauseCount}\n`);
  io.stdout(`Supersedes: ${result.supersedesBaselineId ?? 'none'}\n`);

  return 0;
}

/**
 * Thin orchestration only: parse args, load the raw contract JSON file, then
 * delegate to the existing `persistPerChangeContract` application function
 * exactly once. Persistence, not approval.
 */
async function runSaveChangeContractCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(SAVE_CHANGE_CONTRACT_HELP);
    return 0;
  }

  const parsedArgs = parseSaveChangeContractArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(SAVE_CHANGE_CONTRACT_HELP);
    return 1;
  }

  const loaded = loadContractFile(parsedArgs.contractFilePath, '--contract-file');
  if (!loaded.ok) {
    io.stderr(`error: ${loaded.error}\n`);
    io.stderr(SAVE_CHANGE_CONTRACT_HELP);
    return 1;
  }

  // Exactly one application persistence attempt.
  const result = await persistPerChangeContract(loaded.contract, { outputLocation: parsedArgs.outputLocation });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  io.stdout(`Change contract: ${result.contractId}\n`);
  io.stdout(`Artifact: ${result.artifactRoot}\n`);
  io.stdout(`Clauses: ${result.clauseCount}\n`);
  io.stdout(`Supersedes baseline clauses: ${result.supersedesBaselineClauseCount}\n`);

  return 0;
}

/**
 * Thin orchestration only: parse args, then delegate to the existing
 * `evaluateAndPersistFromArtifactRoots` application function exactly once.
 * No evaluation/tolerance/conflict/unexpected-classification logic lives
 * here - see `src/domain/frontendContractEvaluation.ts`. `--enforce` is
 * applied only after the evaluation has already been constructed and
 * persisted: it selects the process exit status for an already-final FAIL
 * result and never affects evaluation identity, contents, or persistence. A
 * FAIL verdict is a successful, persisted evaluation outcome (a found
 * regression), never treated as a construction/persistence failure.
 */
async function runEvaluateContractCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(EVALUATE_CONTRACT_HELP);
    return 0;
  }

  const parsedArgs = parseEvaluateContractArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(EVALUATE_CONTRACT_HELP);
    return 1;
  }

  // Exactly one application evaluation attempt: reads before/after/comparison/baseline/change once each,
  // calls the canonical evaluator exactly once, and persists exactly one evaluation artifact.
  const result = await evaluateAndPersistFromArtifactRoots(parsedArgs.beforeRoot, parsedArgs.afterRoot, parsedArgs.comparisonRoot, parsedArgs.baselineRoot, parsedArgs.changeRoot, {
    outputLocation: parsedArgs.outputLocation,
  });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  io.stdout(`Evaluation: ${result.evaluationId}\n`);
  io.stdout(`Verdict: ${result.overallVerdict}\n`);
  io.stdout(`Artifact: ${result.artifactRoot}\n`);
  io.stdout(`Clauses: ${result.clauseResultCount}\n`);
  io.stdout(`Unexpected: ${result.unexpectedChangeCount}\n`);
  io.stdout(`Enforced: ${parsedArgs.enforce ? 'yes' : 'no'}\n`);

  if (parsedArgs.enforce && result.overallVerdict === 'FAIL') return 1;
  return 0;
}

/**
 * Thin orchestration only: parse args, read the local image file's raw
 * bytes, then delegate to the existing `importExternalReference` application
 * function exactly once. No format/dimension validation lives here - see
 * `src/domain/externalReferenceImage.ts`.
 */
async function runImportReferenceCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(IMPORT_REFERENCE_HELP);
    return 0;
  }

  const parsedArgs = parseImportReferenceArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(IMPORT_REFERENCE_HELP);
    return 1;
  }

  let imageBytes: Uint8Array;
  try {
    imageBytes = readFileSync(parsedArgs.imageFilePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`error: could not read image file "${parsedArgs.imageFilePath}": ${message}\n`);
    io.stderr(IMPORT_REFERENCE_HELP);
    return 1;
  }

  let regions: ReferenceRegion[] | undefined;
  if (parsedArgs.regionsFilePath !== undefined) {
    const loaded = loadRegionsFile(parsedArgs.regionsFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(IMPORT_REFERENCE_HELP);
      return 1;
    }
    // CLI boundary owns file-read/root-wrapper syntax only; region content/geometry validation is owned by isValidReferenceRegions, called inside importExternalReference.
    regions = loaded.regions as ReferenceRegion[];
  }

  let requirements: RawReferenceRequirement[] | undefined;
  if (parsedArgs.requirementsFilePath !== undefined) {
    const loaded = loadRequirementsFile(parsedArgs.requirementsFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(IMPORT_REFERENCE_HELP);
      return 1;
    }
    // CLI boundary owns file-read/root-wrapper syntax only; requirement category/subject/tolerance validation is owned by isValidRawReferenceRequirement/isValidReferenceRequirements, called inside importExternalReference.
    requirements = loaded.requirements as RawReferenceRequirement[];
  }

  let applicability: ExternalReferenceApplicability | undefined;
  if (parsedArgs.applicabilityFilePath !== undefined) {
    const loaded = loadApplicabilityFile(parsedArgs.applicabilityFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(IMPORT_REFERENCE_HELP);
      return 1;
    }
    // CLI boundary owns file-read syntax only; applicability semantics are owned by isValidExternalReferenceApplicability, called inside importExternalReference.
    applicability = loaded.applicability as ExternalReferenceApplicability;
  }

  // Exactly one application import attempt: format/dimension validation, an optional region-set validation, an optional requirement-set validation, an optional applicability validation, an optional supersession-target read, persisted at most once.
  const result = await importExternalReference(imageBytes, {
    outputLocation: parsedArgs.outputLocation,
    ...(parsedArgs.label === undefined ? {} : { label: parsedArgs.label }),
    ...(parsedArgs.supersedesReferenceRoot === undefined ? {} : { supersedesReferenceRoot: parsedArgs.supersedesReferenceRoot }),
    ...(regions === undefined ? {} : { regions }),
    ...(requirements === undefined ? {} : { requirements }),
    ...(applicability === undefined ? {} : { applicability }),
  });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  io.stdout(`Reference: ${result.referenceId}\n`);
  io.stdout(`State: imported\n`);
  io.stdout(`Artifact: ${result.artifactRoot}\n`);
  io.stdout(`Image: ${result.imagePath}\n`);
  io.stdout(`Regions: ${result.regionCount}\n`);
  io.stdout(`Requirements: ${result.requirementCount}\n`);
  io.stdout(`Applicability: ${result.hasApplicability ? 'declared' : 'none'}\n`);
  io.stdout(`Adequacy: ${result.adequacy.status}\n`);

  return 0;
}

/**
 * Thin orchestration only: parse args, then delegate to the existing
 * `approveExternalReference` application function exactly once. This is the
 * only command in the observer that approves an external reference.
 */
async function runApproveReferenceCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(APPROVE_REFERENCE_HELP);
    return 0;
  }

  const parsedArgs = parseApproveReferenceArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(APPROVE_REFERENCE_HELP);
    return 1;
  }

  // Exactly one application approval attempt: one reference read, an optional supersession-target read, persisted at most once.
  const result = await approveExternalReference(parsedArgs.referenceRoot, {
    outputLocation: parsedArgs.outputLocation,
    ...(parsedArgs.supersedesReferenceRoot === undefined ? {} : { supersedesReferenceRoot: parsedArgs.supersedesReferenceRoot }),
  });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  io.stdout(`Reference: ${result.referenceId}\n`);
  io.stdout(`State: approved\n`);
  io.stdout(`Artifact: ${result.artifactRoot}\n`);
  io.stdout(`Regions: ${result.regionCount}\n`);
  io.stdout(`Requirements: ${result.requirementCount}\n`);
  io.stdout(`Adequacy: ${result.adequacy.status}\n`);
  io.stdout(`Applicability: ${result.hasApplicability ? 'declared' : 'none'}\n`);

  return 0;
}

/**
 * Thin orchestration only: parse args, load the optional bindings file
 * (syntax/root-shape only - every binding-declaration rule stays owned by
 * `isValidReferenceRuntimeBindingDeclarations`, called inside the domain
 * evaluator), then delegate to the existing
 * `evaluateReferenceCandidateFidelityFromArtifactRoots` application function
 * exactly once. No adequacy/compatibility/binding/tolerance/coordinate-
 * mapping/relationship logic lives here - see
 * `src/domain/externalReferenceFidelity.ts`. `--enforce` is applied only
 * after the evaluation has already been computed: it selects the process
 * exit status for an already-final "fail" fidelity state and never affects
 * the evaluation's content. Persists nothing.
 */
async function runEvaluateReferenceFidelityCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(EVALUATE_REFERENCE_FIDELITY_HELP);
    return 0;
  }

  const parsedArgs = parseEvaluateReferenceFidelityArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(EVALUATE_REFERENCE_FIDELITY_HELP);
    return 1;
  }

  let bindings: ReferenceRuntimeBindingDeclaration[] = [];
  if (parsedArgs.bindingsFilePath !== undefined) {
    const loaded = loadBindingsFile(parsedArgs.bindingsFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(EVALUATE_REFERENCE_FIDELITY_HELP);
      return 1;
    }
    // CLI boundary owns file-read/root-wrapper syntax only; binding-declaration shape/bounds/existence/conflict validation is owned by isValidReferenceRuntimeBindingDeclarations, called inside evaluateReferenceCandidateFidelity.
    bindings = loaded.bindings as ReferenceRuntimeBindingDeclaration[];
  }

  // Exactly one application evaluation attempt: reads reference/candidate once each, calls the canonical evaluator exactly once.
  const result = await evaluateReferenceCandidateFidelityFromArtifactRoots(parsedArgs.referenceRoot, parsedArgs.candidateRoot, bindings);
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  const { evaluation } = result;
  const passCount = evaluation.requirementResults.filter((r) => r.status === 'pass').length;
  const failCount = evaluation.requirementResults.filter((r) => r.status === 'fail').length;
  const unavailableCount = evaluation.requirementResults.filter((r) => r.status === 'unavailable').length;

  io.stdout(`Reference: ${evaluation.referenceId}\n`);
  io.stdout(`Candidate: ${evaluation.candidateObservationId}\n`);
  io.stdout(`Adequacy: ${evaluation.adequacy.status}\n`);
  if (evaluation.compatibility !== undefined) io.stdout(`Compatibility: ${evaluation.compatibility.state}\n`);
  io.stdout(`State: ${evaluation.state}\n`);
  if (evaluation.blockedBy !== undefined) io.stdout(`Blocked by: ${evaluation.blockedBy}\n`);
  io.stdout(`Requirements: ${evaluation.requirementResults.length} (pass: ${passCount}, fail: ${failCount}, unavailable: ${unavailableCount})\n`);
  io.stdout(`Enforced: ${parsedArgs.enforce ? 'yes' : 'no'}\n`);

  if (parsedArgs.enforce && evaluation.state === 'fail') return 1;
  return 0;
}

type ParsedViewArgs = { ok: true; root: string; port?: number; noOpen: boolean; bindingsFilePath?: string; contextFilePath?: string } | { ok: false; errors: string[] };

/** CLI-syntax-only parsing, mirroring `parseApproveBaselineArgs`. `--port` shape/range checking happens here; root existence/directory-ness is the application layer's job (see `startViewer`). */
function parseViewArgs(argv: readonly string[]): ParsedViewArgs {
  const errors: string[] = [];
  let root: string | undefined;
  let rootFlagCount = 0;
  let port: number | undefined;
  let portFlagCount = 0;
  let noOpen = false;
  let bindingsFilePath: string | undefined;
  let bindingsFileFlagCount = 0;
  let contextFilePath: string | undefined;
  let contextFileFlagCount = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--root': {
        const value = argv[(i += 1)];
        rootFlagCount += 1;
        if (value === undefined) errors.push('--root requires a path argument');
        else if (rootFlagCount > 1) errors.push('--root may only be specified once');
        else root = value;
        break;
      }
      case '--port': {
        const value = argv[(i += 1)];
        portFlagCount += 1;
        if (value === undefined) {
          errors.push('--port requires a numeric argument');
        } else if (portFlagCount > 1) {
          errors.push('--port may only be specified once');
        } else {
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
            errors.push(`--port must be an integer between 0 and 65535; got ${JSON.stringify(value)}`);
          } else {
            port = parsed;
          }
        }
        break;
      }
      case '--no-open':
        noOpen = true;
        break;
      case '--bindings-file': {
        const value = argv[(i += 1)];
        bindingsFileFlagCount += 1;
        if (value === undefined) errors.push('--bindings-file requires a file path argument');
        else if (bindingsFileFlagCount > 1) errors.push('--bindings-file may only be specified once');
        else bindingsFilePath = value;
        break;
      }
      case '--context-file': {
        const value = argv[(i += 1)];
        contextFileFlagCount += 1;
        if (value === undefined) errors.push('--context-file requires a file path argument');
        else if (contextFileFlagCount > 1) errors.push('--context-file may only be specified once');
        else contextFilePath = value;
        break;
      }
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }

  if (root === undefined) errors.push('--root is required');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    root: root as string,
    ...(port === undefined ? {} : { port }),
    noOpen,
    ...(bindingsFilePath === undefined ? {} : { bindingsFilePath }),
    ...(contextFilePath === undefined ? {} : { contextFilePath }),
  };
}

/**
 * Thin orchestration only: parse args, delegate to the existing
 * `startViewer` application function exactly once, print status, and
 * optionally attempt a best-effort browser open. Never parses Observer
 * artifacts, never derives evidence, never mutates anything. Returns as soon
 * as the server is confirmed listening (or has failed to start) - the
 * process itself keeps running afterward only because the server's open
 * listening socket keeps the Node event loop alive, not because this
 * function blocks.
 */
async function runViewCommand(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--help')) {
    io.stdout(VIEW_HELP);
    return 0;
  }

  const parsedArgs = parseViewArgs(argv);
  if (!parsedArgs.ok) {
    for (const error of parsedArgs.errors) io.stderr(`error: ${error}\n`);
    io.stderr(VIEW_HELP);
    return 1;
  }

  // Reuses the exact same operational binding-file wrapper parser as `evaluate-reference-fidelity --bindings-file`
  // (see loadBindingsFile above) - one shared parser, never a second divergent one. Reference-specific declaration
  // validity (region existence, shape) is deferred to the moment a reference is actually selected in the viewer,
  // via the existing canonical isValidReferenceRuntimeBindingDeclarations - never checked here without a reference.
  let bindingDeclarations: unknown[] = [];
  if (parsedArgs.bindingsFilePath !== undefined) {
    const loaded = loadBindingsFile(parsedArgs.bindingsFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(VIEW_HELP);
      return 1;
    }
    if (!Array.isArray(loaded.bindings)) {
      io.stderr('error: --bindings-file "bindings" property must be an array\n');
      io.stderr(VIEW_HELP);
      return 1;
    }
    bindingDeclarations = loaded.bindings;
  }

  // Reuses the exact same canonical validator (isValidBoundedAgentContextArtifact, via
  // classifyContextFileContent) that owns current-schema structural validity - never a second validator.
  // A recognized-kind, non-current-schema file is not a startup failure (task §16); every other problem is.
  let contextState: import('./viewerServer/context.js').ContextSessionState = { status: 'none' };
  if (parsedArgs.contextFilePath !== undefined) {
    const loaded = loadContextFile(parsedArgs.contextFilePath);
    if (!loaded.ok) {
      io.stderr(`error: ${loaded.error}\n`);
      io.stderr(VIEW_HELP);
      return 1;
    }
    contextState = loaded.state;
  }

  const result = await startViewer({
    root: parsedArgs.root,
    ...(parsedArgs.port === undefined ? {} : { port: parsedArgs.port }),
    bindingDeclarations,
    context: contextState,
  });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    return 1;
  }

  io.stdout(`Viewer: ${result.url}\n`);
  io.stdout(`Root: ${result.root}\n`);
  io.stdout(`Press Ctrl+C to stop.\n`);

  if (!parsedArgs.noOpen) {
    try {
      await openInDefaultBrowser(result.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      io.stderr(`note: could not open the default browser automatically: ${message}\n`);
    }
  }

  return 0;
}

/** Testable CLI entry point: pure function of argv (+ injectable IO), no direct process.exit. */
export async function runCli(argv: readonly string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined) {
    io.stderr(TOP_LEVEL_HELP);
    return 1;
  }

  if (command === '--help' || command === '-h') {
    io.stdout(TOP_LEVEL_HELP);
    return 0;
  }

  if (command === '--version') {
    io.stdout(`${getProducerInfo().version}\n`);
    return 0;
  }

  if (command === 'observe') {
    return runObserveCommand(rest, io);
  }

  if (command === 'compare') {
    return runCompareCommand(rest, io);
  }

  if (command === 'approve-baseline') {
    return runApproveBaselineCommand(rest, io);
  }

  if (command === 'save-change-contract') {
    return runSaveChangeContractCommand(rest, io);
  }

  if (command === 'evaluate-contract') {
    return runEvaluateContractCommand(rest, io);
  }

  if (command === 'import-reference') {
    return runImportReferenceCommand(rest, io);
  }

  if (command === 'approve-reference') {
    return runApproveReferenceCommand(rest, io);
  }

  if (command === 'evaluate-reference-fidelity') {
    return runEvaluateReferenceFidelityCommand(rest, io);
  }

  if (command === 'view') {
    return runViewCommand(rest, io);
  }

  io.stderr(`error: unrecognized command "${command}"\n`);
  io.stderr(TOP_LEVEL_HELP);
  return 1;
}

/**
 * Resolves symlinks on both sides before comparing paths, not just a raw URL string
 * comparison: on macOS, `os.tmpdir()` (and other paths) live under `/var`, which is
 * itself a symlink to `/private/var`. A plain `import.meta.url === pathToFileURL(...)`
 * comparison silently evaluates false in that case (mismatched but equivalent paths),
 * so the CLI's own entry point never runs - `node dist/cli.js ...` exits 0 having
 * printed nothing. Real-pathing both sides makes the comparison symlink-safe.
 */
function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
