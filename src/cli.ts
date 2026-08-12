#!/usr/bin/env node
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeRequest } from './request/request.js';
import type { RawObservationRequest } from './request/request.js';
import type { Diagnostic } from './domain/diagnostics.js';
import { getProducerInfo } from './domain/schema.js';
import { observe } from './application/observationPersistence.js';

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
  observe    Capture one bounded browser observation and persist it as a
             portable artifact.

Options:
  --help     Show this help.
  --version  Print the package version.

Run "my-frontend-observer observe --help" for observe command options.
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
