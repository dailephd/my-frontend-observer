#!/usr/bin/env node
import { realpathSync, readFileSync } from 'node:fs';
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

Options:
  --help     Show this help.
  --version  Print the package version.

Run "my-frontend-observer <command> --help" for command-specific options.
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
  | { ok: true; raw: RawObservationRequest; targetsFilePath?: string; scrollScenarioFilePath?: string }
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
  };
}

const TARGETS_FILE_ALLOWED_ROOT_FIELDS = new Set(['targets']);

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
