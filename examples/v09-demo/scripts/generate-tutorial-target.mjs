#!/usr/bin/env node
// Generates one `TutorialTargetContractV1` for a my-frontend-observer v0.9
// tutorial run against the released `@dailephd/my-dev-kit-lab@0.4.8`.
//
// The contract is machine-specific: it carries absolute paths to this
// checkout and two dynamically chosen loopback ports. It is therefore
// generated on demand and never committed. Only this generator is tracked.
//
// The generated contract declares:
//   - a `prepare` command that materializes a disposable Observer project;
//   - a `demo-server` managed process serving the materialized demo;
//   - an `observer-viewer` managed process serving this checkout's built,
//     project-aware Observer viewer;
//   - an `applicationUrl` pointing at the viewer, which is the application
//     the tutorial actually drives.
//
// Usage:
//   node examples/v09-demo/scripts/generate-tutorial-target.mjs \
//     --scenario <scenario-id> --out <target-contract-path> \
//     [--demo-port <port>] [--viewer-port <port>] [--observer-root <dir>]

import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(scriptDir, '..');
const defaultObserverRoot = path.resolve(demoRoot, '..', '..');

/** Released lab schema version for a target contract (my-dev-kit-lab 0.4.8). */
export const TARGET_CONTRACT_SCHEMA_VERSION = '1.0.0';

/** One shared lab target identity for every Observer v0.9 tutorial. */
export const TUTORIAL_TARGET_ID = 'my-frontend-observer-v09-demo';

/** The only placeholder the released lab target contract supports. */
export const TARGET_ROOT_PLACEHOLDER = '{{targetRoot}}';

/** The four prepare modes this demo supports. A contract may name only these. */
export const TUTORIAL_SCENARIO_IDS = [
  'observer-v09-annotation-basics',
  'observer-v09-runtime-contract',
  'observer-v09-reference-authoring',
  'observer-v09-reference-materialization',
];

export const PORT_MIN = 1;
export const PORT_MAX = 65535;

/** Readiness budgets: the demo server is trivial; the viewer reads and indexes real evidence. */
const DEMO_READINESS_TIMEOUT_MS = 20_000;
const VIEWER_READINESS_TIMEOUT_MS = 40_000;

export function isValidPort(value) {
  return Number.isInteger(value) && value >= PORT_MIN && value <= PORT_MAX;
}

export function isTutorialScenarioId(value) {
  return typeof value === 'string' && TUTORIAL_SCENARIO_IDS.includes(value);
}

/**
 * Asks the operating system for one free loopback port. The listener is closed
 * immediately, so the port is only known-free at this instant: nothing can
 * reserve a TCP port without holding it open. Callers must therefore keep the
 * gap between generation and the tutorial run short, which is why generation
 * happens per run rather than once.
 */
function reserveEphemeralPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not read an assigned loopback port'));
        return;
      }
      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * Chooses two distinct free loopback ports. Both probes are held open at the
 * same time before either is released, so the operating system cannot hand out
 * the same port twice.
 */
async function reserveTwoDistinctPorts() {
  const first = await reserveEphemeralPort();
  let second = await reserveEphemeralPort();
  let attempts = 0;
  while (second === first) {
    if (attempts > 10) throw new Error('could not obtain two distinct free loopback ports');
    attempts += 1;
    second = await reserveEphemeralPort();
  }
  return { demoPort: first, viewerPort: second };
}

/**
 * Builds the exact released-schema contract. Pure: every dynamic input is a
 * parameter, so the same inputs always produce byte-identical output.
 */
export function buildTutorialTargetContract({ scenarioId, demoPort, viewerPort, observerRoot }) {
  if (!isTutorialScenarioId(scenarioId)) {
    throw new Error(`unknown scenario id ${JSON.stringify(scenarioId)}; expected one of ${TUTORIAL_SCENARIO_IDS.join(', ')}`);
  }
  if (!isValidPort(demoPort)) throw new Error(`demo port must be an integer in [${PORT_MIN}, ${PORT_MAX}]; got ${JSON.stringify(demoPort)}`);
  if (!isValidPort(viewerPort)) throw new Error(`viewer port must be an integer in [${PORT_MIN}, ${PORT_MAX}]; got ${JSON.stringify(viewerPort)}`);
  if (demoPort === viewerPort) throw new Error('demo port and viewer port must be distinct');

  const root = path.resolve(observerRoot);
  const prepareScript = path.join(root, 'examples', 'v09-demo', 'scripts', 'prepare-tutorial-target.mjs');
  const observerCli = path.join(root, 'dist', 'cli.js');

  return {
    schemaVersion: TARGET_CONTRACT_SCHEMA_VERSION,
    id: TUTORIAL_TARGET_ID,
    prepare: {
      executable: 'node',
      args: [
        prepareScript,
        '--target-root',
        TARGET_ROOT_PLACEHOLDER,
        '--scenario',
        scenarioId,
        '--demo-port',
        String(demoPort),
        '--observer-root',
        root,
      ],
    },
    processes: [
      {
        id: 'demo-server',
        executable: 'node',
        // The materialized disposable copy, not the tracked template.
        args: [`${TARGET_ROOT_PLACEHOLDER}/demo/server.mjs`, '--port', String(demoPort)],
        cwd: 'target-root',
        readiness: {
          kind: 'http',
          url: `http://127.0.0.1:${demoPort}/health`,
          timeoutMs: DEMO_READINESS_TIMEOUT_MS,
        },
      },
      {
        id: 'observer-viewer',
        executable: 'node',
        // No --root: the project-aware viewer discovers the initialized
        // project from its working directory, which is the target root.
        args: [observerCli, 'view', '--port', String(viewerPort), '--no-open'],
        cwd: 'target-root',
        readiness: {
          kind: 'http',
          url: `http://127.0.0.1:${viewerPort}/api/status`,
          timeoutMs: VIEWER_READINESS_TIMEOUT_MS,
        },
      },
    ],
    applicationUrl: `http://127.0.0.1:${viewerPort}/`,
  };
}

export async function generateTutorialTargetContract({ scenarioId, outPath, demoPort, viewerPort, observerRoot }) {
  // Explicit ports win; anything left unspecified is filled from a fresh
  // free-port probe. Distinctness is then enforced once, for every combination.
  let ports = { demoPort, viewerPort };
  if (demoPort === undefined || viewerPort === undefined) {
    const chosen = await reserveTwoDistinctPorts();
    ports = { demoPort: demoPort ?? chosen.demoPort, viewerPort: viewerPort ?? chosen.viewerPort };
    let attempts = 0;
    while (ports.demoPort === ports.viewerPort) {
      if (attempts > 10) throw new Error('could not obtain two distinct free loopback ports');
      attempts += 1;
      const replacement = await reserveEphemeralPort();
      ports = demoPort === undefined ? { ...ports, demoPort: replacement } : { ...ports, viewerPort: replacement };
    }
  }

  const contract = buildTutorialTargetContract({
    scenarioId,
    demoPort: ports.demoPort,
    viewerPort: ports.viewerPort,
    observerRoot: observerRoot ?? defaultObserverRoot,
  });

  const resolvedOut = path.resolve(outPath);
  await mkdir(path.dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, `${JSON.stringify(contract, null, 2)}\n`);
  return { contract, outPath: resolvedOut, ...ports };
}

function parseArgs(argv) {
  const errors = [];
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--scenario':
      case '--out':
      case '--observer-root': {
        const value = argv[(index += 1)];
        if (value === undefined) errors.push(`${arg} requires a value`);
        else values[arg.slice(2)] = value;
        break;
      }
      case '--demo-port':
      case '--viewer-port': {
        const value = argv[(index += 1)];
        const parsed = value === undefined ? Number.NaN : Number(value);
        if (!isValidPort(parsed)) errors.push(`${arg} must be an integer in [${PORT_MIN}, ${PORT_MAX}]; got ${JSON.stringify(value)}`);
        else values[arg.slice(2)] = parsed;
        break;
      }
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }
  if (values.scenario === undefined) errors.push('--scenario is required');
  else if (!isTutorialScenarioId(values.scenario)) errors.push(`--scenario must be one of ${TUTORIAL_SCENARIO_IDS.join(', ')}`);
  if (values.out === undefined) errors.push('--out is required');
  if (values['demo-port'] !== undefined && values['viewer-port'] !== undefined && values['demo-port'] === values['viewer-port']) {
    errors.push('--demo-port and --viewer-port must be distinct');
  }
  return { errors, values };
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { errors, values } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    for (const error of errors) console.error(`generate tutorial target: ${error}`);
    console.error('usage: node generate-tutorial-target.mjs --scenario <id> --out <path> [--demo-port <p>] [--viewer-port <p>] [--observer-root <dir>]');
    process.exitCode = 1;
  } else {
    const result = await generateTutorialTargetContract({
      scenarioId: values.scenario,
      outPath: values.out,
      ...(values['demo-port'] === undefined ? {} : { demoPort: values['demo-port'] }),
      ...(values['viewer-port'] === undefined ? {} : { viewerPort: values['viewer-port'] }),
      ...(values['observer-root'] === undefined ? {} : { observerRoot: values['observer-root'] }),
    });
    console.log(`target contract written to ${result.outPath}`);
    console.log(`  demo port:   ${result.demoPort}`);
    console.log(`  viewer port: ${result.viewerPort}`);
  }
}
