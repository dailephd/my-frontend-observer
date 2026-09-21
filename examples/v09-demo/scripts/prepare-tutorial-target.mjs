#!/usr/bin/env node
// Trusted prepare command for the my-frontend-observer v0.9 tutorial target
// contract. The released lab runs exactly this executable, once, before it
// starts any managed process or browser.
//
// It builds a complete disposable Observer project inside the lab-owned target
// root:
//
//   <targetRoot>/demo/                materialized deterministic demo
//   <targetRoot>/frontend-observer.json   canonical project configuration
//   <targetRoot>/.frontend-observer/      canonical managed evidence state
//
// Everything it creates comes from a canonical Observer owner: the demo is
// materialized by Prompt 1's own materialization script, and the project,
// baseline observation, contracts and references are produced by the built
// Observer CLI. Nothing here handwrites an Observer artifact.
//
// The temporary demo server it starts is stopped in a `finally`, so a failing
// prepare never leaves a listener behind. The process always terminates; it
// never becomes the long-running demo server the lab manages itself.
//
// Usage:
//   node prepare-tutorial-target.mjs --target-root <dir> --scenario <id>
//                                    --demo-port <port> --observer-root <dir>

import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareDemoTarget } from './prepare.mjs';
import { startDemoServer } from './server.mjs';
import { TUTORIAL_SCENARIO_IDS, isTutorialScenarioId, isValidPort } from './generate-tutorial-target.mjs';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(scriptDir, '..');
const defaultObserverRoot = path.resolve(demoRoot, '..', '..');

/** The fixed Prompt 1 reference asset the reference tutorials are built on. */
const REFERENCE_IMAGE = path.join(demoRoot, 'references', 'v09-reference.png');
const REFERENCE_REGIONS_FILE = path.join(demoRoot, 'references', 'v09-reference-regions.json');

/** Human-readable label so a tutorial can select the reference without a random id. */
const REFERENCE_LABEL = 'v09-tutorial-reference';

export const BASELINE_ALIAS = 'baseline';
export const CANONICAL_VIEWPORT = { width: 1440, height: 900 };

/**
 * The runtime targets every tutorial project configures, bound to Prompt 1's
 * stable `data-demo-target` vocabulary. Observer target names must match
 * `^[A-Za-z0-9_-]{1,64}$`, so the two card regions use `card1`/`card2` while
 * the demo attribute itself stays `card-1`/`card-2`.
 */
export const RUNTIME_TARGETS = [
  { name: 'header', selector: '[data-demo-target="header"]' },
  { name: 'navigation', selector: '[data-demo-target="navigation"]' },
  { name: 'hero', selector: '[data-demo-target="hero"]' },
  { name: 'sidebar', selector: '[data-demo-target="sidebar"]' },
  { name: 'content', selector: '[data-demo-target="content"]' },
  { name: 'card1', selector: '[data-demo-target="card-1"]' },
  { name: 'card2', selector: '[data-demo-target="card-2"]' },
  { name: 'cta', selector: '[data-demo-target="cta"]' },
  { name: 'footer', selector: '[data-demo-target="footer"]' },
  { name: 'asset', selector: '[data-demo-target="asset"]' },
];

class PrepareError extends Error {}

function parseArgs(argv) {
  const errors = [];
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--target-root':
      case '--scenario':
      case '--observer-root': {
        const value = argv[(index += 1)];
        if (value === undefined) errors.push(`${arg} requires a value`);
        else values[arg.slice(2)] = value;
        break;
      }
      case '--demo-port': {
        const value = argv[(index += 1)];
        const parsed = value === undefined ? Number.NaN : Number(value);
        if (!isValidPort(parsed)) errors.push(`--demo-port must be an integer in [1, 65535]; got ${JSON.stringify(value)}`);
        else values['demo-port'] = parsed;
        break;
      }
      default:
        errors.push(`unrecognized argument: ${arg}`);
    }
  }
  if (values['target-root'] === undefined) errors.push('--target-root is required');
  if (values.scenario === undefined) errors.push('--scenario is required');
  else if (!isTutorialScenarioId(values.scenario)) errors.push(`--scenario must be one of ${TUTORIAL_SCENARIO_IDS.join(', ')}`);
  if (values['demo-port'] === undefined) errors.push('--demo-port is required');
  return { errors, values };
}

/** Runs the built Observer CLI inside the disposable project and fails loudly on a nonzero exit. */
async function observer(observerRoot, targetRoot, args) {
  const cli = path.join(observerRoot, 'dist', 'cli.js');
  try {
    const { stdout } = await execFileAsync(process.execPath, [cli, ...args], { cwd: targetRoot, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    throw new PrepareError(`observer ${args[0]} failed (exit ${error.code}): ${stderr || stdout || error.message}`);
  }
}

/** Reads one value the Observer CLI printed as "Label: value". */
function readPrintedField(stdout, label) {
  const match = new RegExp(`^${label}:\\s*(.+)$`, 'm').exec(stdout);
  return match === null ? undefined : match[1].trim();
}

async function setUpApprovedReference(observerRoot, targetRoot) {
  // Import, then explicitly approve, through the canonical owners. Regions come
  // from the tracked fixture whose geometry is frozen against the committed PNG.
  const importOut = await observer(observerRoot, targetRoot, [
    'import-reference',
    REFERENCE_IMAGE,
    '--output',
    '.frontend-observer/evidence/references/tutorial-source-import',
    '--label',
    REFERENCE_LABEL,
    '--regions-file',
    REFERENCE_REGIONS_FILE,
  ]);
  const importedRoot = readPrintedField(importOut, 'Artifact') ?? path.join(targetRoot, '.frontend-observer/evidence/references/tutorial-source-import');

  await observer(observerRoot, targetRoot, [
    'approve-reference',
    '--reference',
    importedRoot,
    '--output',
    '.frontend-observer/evidence/references/tutorial-source-approved',
  ]);
  return { importedRoot };
}

async function setUpContractAcceptance(observerRoot, targetRoot, baselineArtifactRoot) {
  // A baseline contract is authored input to the canonical approve-baseline
  // command, which is what actually validates and persists the artifact. The
  // single clause is deliberately trivial and true of the demo baseline: the
  // tutorial is about promotion and activation, not about contract content.
  const manifestPath = path.join(baselineArtifactRoot, 'manifest.json');
  const observation = JSON.parse(await readFile(manifestPath, 'utf8'));
  const authoredBaseline = {
    artifactKind: 'my-frontend-observer/frontend-contract',
    schemaVersion: '1.0.0',
    contractClass: 'baseline',
    baselineId: 'v09-tutorial-baseline',
    // Exactly the canonical FrontendContractObservationReference shape, read
    // from the observation Observer just captured rather than assumed.
    sourceObservation: {
      observationId: observation.observationId,
      requestId: observation.requestId,
      producer: observation.producer,
      observationSchemaVersion: observation.schemaVersion,
    },
    clauses: [
      {
        clauseId: 'header-visible',
        primitive: { kind: 'target-visible', target: 'header' },
        // A clause always carries its supporting evidence list, even when
        // empty: the field is required, never optional.
        supportingEvidence: [],
      },
    ],
    provenance: { approvedAt: new Date(0).toISOString() },
  };
  const baselineContractFile = path.join(targetRoot, 'tutorial-baseline-contract.json');
  await writeFile(baselineContractFile, `${JSON.stringify(authoredBaseline, null, 2)}\n`);
  const approveOut = await observer(observerRoot, targetRoot, [
    'approve-baseline',
    '--observation',
    baselineArtifactRoot,
    '--contract-file',
    baselineContractFile,
    '--output',
    '.frontend-observer/evidence/contracts/tutorial-baseline',
  ]);
  // `--output` names a parent directory; the writer creates the artifact
  // directory beneath it. Project acceptance must point at the artifact
  // itself, so the real path is read back from the command rather than
  // reconstructed from the output argument.
  const baselineArtifact = projectRelative(targetRoot, readPrintedField(approveOut, 'Artifact'));

  // An initial change contract so project acceptance is complete before the
  // tutorial runs. The tutorial's own promotion later replaces which change
  // contract is active, and must leave the baseline entry untouched.
  const authoredChange = {
    artifactKind: 'my-frontend-observer/frontend-contract',
    schemaVersion: '1.0.0',
    contractClass: 'change',
    contractId: 'v09-tutorial-initial-change',
    contractRequestId: 'v09-tutorial-initial-change-request',
    activeBaselineIds: ['v09-tutorial-baseline'],
    clauses: [],
  };
  const changeContractFile = path.join(targetRoot, 'tutorial-change-contract.json');
  await writeFile(changeContractFile, `${JSON.stringify(authoredChange, null, 2)}\n`);
  const changeOut = await observer(observerRoot, targetRoot, [
    'save-change-contract',
    '--contract-file',
    changeContractFile,
    '--output',
    '.frontend-observer/evidence/contracts/tutorial-initial-change',
  ]);
  const changeArtifact = projectRelative(targetRoot, readPrintedField(changeOut, 'Artifact'));

  if (baselineArtifact === undefined || changeArtifact === undefined) {
    throw new PrepareError('contract setup could not read the persisted artifact paths back from the Observer CLI');
  }
  return { baselineArtifact, changeArtifact };
}

/** Converts an absolute artifact root into the portable project-relative path project acceptance requires. */
function projectRelative(targetRoot, absolute) {
  if (absolute === undefined) return undefined;
  return path.relative(path.resolve(targetRoot), path.resolve(absolute)).split(path.sep).join('/');
}

/**
 * Writes project acceptance through the canonical project-configuration
 * validator: the configuration is re-read, extended, revalidated and only then
 * written back, so an invalid acceptance block can never reach disk.
 */
async function writeAcceptance(observerRoot, targetRoot, acceptance) {
  const { validateProjectConfig } = await import(pathToModuleUrl(path.join(observerRoot, 'dist', 'projectWorkflow', 'projectConfig.js')));
  const configPath = path.join(targetRoot, 'frontend-observer.json');
  const current = JSON.parse(await readFile(configPath, 'utf8'));
  const next = { ...current, schemaVersion: '1.1.0', acceptance };
  const validated = validateProjectConfig(next);
  if (!validated.ok) throw new PrepareError(`project acceptance configuration is invalid: ${validated.reason}`);
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

function pathToModuleUrl(filePath) {
  return new URL(`file:///${filePath.split(path.sep).join('/')}`).href;
}

export async function prepareTutorialTarget({ targetRoot, scenarioId, demoPort, observerRoot }) {
  if (typeof targetRoot !== 'string' || targetRoot.trim().length === 0) throw new PrepareError('an explicit target root is required');
  if (!isTutorialScenarioId(scenarioId)) throw new PrepareError(`unknown scenario id ${JSON.stringify(scenarioId)}`);
  if (!isValidPort(demoPort)) throw new PrepareError('a valid demo port is required');

  const root = path.resolve(targetRoot);
  const observer1Root = path.resolve(observerRoot ?? defaultObserverRoot);
  await mkdir(root, { recursive: true });

  // 1. Materialize the demo using Prompt 1's canonical materialization owner.
  //    No second copy algorithm exists.
  const demoTarget = path.join(root, 'demo');
  await prepareDemoTarget(demoTarget);

  // 2. Serve it temporarily so Observer's own init/capture have a live
  //    loopback target. The lab starts the persistent demo server later.
  const server = await startDemoServer({ port: demoPort, appRoot: path.join(demoTarget, 'app') });
  const created = { demoTarget, scenarioId };
  try {
    // 3. Canonical project initialization.
    const targetsFile = path.join(root, 'tutorial-targets.json');
    await writeFile(targetsFile, `${JSON.stringify({ targets: RUNTIME_TARGETS }, null, 2)}\n`);
    await observer(observer1Root, root, [
      'init',
      '--url',
      `http://127.0.0.1:${demoPort}/?state=baseline`,
      '--viewport',
      `${CANONICAL_VIEWPORT.width}x${CANONICAL_VIEWPORT.height}`,
      '--targets-file',
      targetsFile,
      '--default-baseline',
      BASELINE_ALIAS,
    ]);

    // 4. Canonical baseline capture.
    const captureOut = await observer(observer1Root, root, ['capture', BASELINE_ALIAS]);
    const baselineArtifact = readPrintedField(captureOut, 'Artifact');
    if (baselineArtifact === undefined) throw new PrepareError(`baseline capture did not report an artifact root:\n${captureOut}`);
    created.baselineArtifact = baselineArtifact;
    created.observationId = readPrintedField(captureOut, 'Observation');
    created.completionState = readPrintedField(captureOut, 'Completion');

    // 5. Scenario-specific canonical evidence.
    if (scenarioId === 'observer-v09-runtime-contract') {
      const acceptance = await setUpContractAcceptance(observer1Root, root, baselineArtifact);
      await writeAcceptance(observer1Root, root, {
        contract: { baselineArtifact: acceptance.baselineArtifact, changeArtifact: acceptance.changeArtifact },
      });
      created.contractAcceptance = { baselineArtifact: acceptance.baselineArtifact, changeArtifact: acceptance.changeArtifact };
    }

    if (scenarioId === 'observer-v09-reference-authoring' || scenarioId === 'observer-v09-reference-materialization') {
      const reference = await setUpApprovedReference(observer1Root, root);
      created.referenceImported = reference.importedRoot;
      // A copy of the fixed image beside the project makes the run root
      // self-describing for post-run verification; it is never Observer evidence.
      await copyFile(REFERENCE_IMAGE, path.join(root, 'tutorial-reference-source.png'));
    }

    return created;
  } finally {
    // Always release the temporary listener, including on every failure path,
    // so the lab's own managed demo server can bind this exact port next.
    await server.close().catch(() => undefined);
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { errors, values } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    for (const error of errors) console.error(`prepare tutorial target: ${error}`);
    console.error('usage: node prepare-tutorial-target.mjs --target-root <dir> --scenario <id> --demo-port <port> [--observer-root <dir>]');
    process.exitCode = 1;
  } else {
    try {
      const result = await prepareTutorialTarget({
        targetRoot: values['target-root'],
        scenarioId: values.scenario,
        demoPort: values['demo-port'],
        ...(values['observer-root'] === undefined ? {} : { observerRoot: values['observer-root'] }),
      });
      console.log(`tutorial target prepared for ${result.scenarioId}`);
      console.log(`  demo:     ${result.demoTarget}`);
      console.log(`  baseline: ${result.baselineArtifact}`);
    } catch (error) {
      console.error(`prepare tutorial target: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
