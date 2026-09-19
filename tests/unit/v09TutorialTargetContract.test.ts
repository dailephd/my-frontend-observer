import { describe, expect, it, afterAll } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  buildTutorialTargetContract,
  generateTutorialTargetContract,
  isValidPort,
  isTutorialScenarioId,
  TARGET_CONTRACT_SCHEMA_VERSION,
  TUTORIAL_TARGET_ID,
  TUTORIAL_SCENARIO_IDS,
  TARGET_ROOT_PLACEHOLDER,
} from '../../examples/v09-demo/scripts/generate-tutorial-target.mjs';

const repoRoot = path.resolve(__dirname, '../..');
const workflowRoot = path.join(repoRoot, '.my-dev-kit-workflow', 'v0.9', 'tutorial-integration', 'tests', 'generator');

/** Fields the released my-dev-kit-lab 0.4.8 target-contract validator would reject. */
const FORBIDDEN_EXECUTION_FIELDS = ['shell', 'commandString', 'script', 'javascript', 'eval', 'command'];
const CONTRACT_KEYS = ['schemaVersion', 'id', 'prepare', 'processes', 'applicationUrl'];
const PROCESS_KEYS = ['id', 'executable', 'args', 'cwd', 'env', 'readiness'];
const READINESS_KEYS = ['kind', 'url', 'timeoutMs', 'intervalMs', 'requestTimeoutMs', 'acceptedStatusMin', 'acceptedStatusMax'];

function contract(overrides: { scenarioId?: string; demoPort?: number; viewerPort?: number } = {}) {
  return buildTutorialTargetContract({
    scenarioId: overrides.scenarioId ?? 'observer-v09-annotation-basics',
    demoPort: overrides.demoPort ?? 4321,
    viewerPort: overrides.viewerPort ?? 4322,
    observerRoot: repoRoot,
  });
}

function processById(value: ReturnType<typeof contract>, id: string) {
  const found = value.processes.find((entry) => entry.id === id);
  expect(found, `process ${id}`).toBeDefined();
  return found!;
}

describe('v0.9 tutorial target contract - released lab schema', () => {
  it('declares the released schema version and the one shared target identity', () => {
    const value = contract();
    expect(value.schemaVersion).toBe('1.0.0');
    expect(value.schemaVersion).toBe(TARGET_CONTRACT_SCHEMA_VERSION);
    expect(value.id).toBe('my-frontend-observer-v09-demo');
    expect(value.id).toBe(TUTORIAL_TARGET_ID);
  });

  it('uses the same target identity for every scenario', () => {
    for (const scenarioId of TUTORIAL_SCENARIO_IDS) {
      expect(contract({ scenarioId }).id).toBe(TUTORIAL_TARGET_ID);
    }
  });

  it('declares only keys the released validator accepts', () => {
    const value = contract();
    expect(Object.keys(value).sort()).toEqual([...CONTRACT_KEYS].sort());
    expect(Object.keys(value.prepare).sort()).toEqual(['args', 'executable']);
    for (const entry of value.processes) {
      expect(Object.keys(entry).every((key) => PROCESS_KEYS.includes(key))).toBe(true);
      expect(Object.keys(entry.readiness).every((key) => READINESS_KEYS.includes(key))).toBe(true);
    }
  });

  it('declares no field that would turn the contract into a shell', () => {
    const serialized = JSON.stringify(contract());
    for (const field of FORBIDDEN_EXECUTION_FIELDS) {
      expect(serialized).not.toContain(`"${field}":`);
    }
    expect(contract().prepare.executable).toBe('node');
    for (const entry of contract().processes) expect(entry.executable).toBe('node');
  });

  it('passes the target root to prepare through the only supported placeholder', () => {
    const value = contract();
    expect(value.prepare.args).toContain(TARGET_ROOT_PLACEHOLDER);
    expect(value.prepare.args[value.prepare.args.indexOf('--target-root') + 1]).toBe(TARGET_ROOT_PLACEHOLDER);
    // No other placeholder form may appear anywhere in the contract.
    const placeholders = [...JSON.stringify(value).matchAll(/\{\{[^}]*\}\}/g)].map((match) => match[0]);
    expect(new Set(placeholders)).toEqual(new Set([TARGET_ROOT_PLACEHOLDER]));
  });

  it('names the scenario it prepares', () => {
    for (const scenarioId of TUTORIAL_SCENARIO_IDS) {
      const args = contract({ scenarioId }).prepare.args;
      expect(args[args.indexOf('--scenario') + 1]).toBe(scenarioId);
    }
  });

  it('configures the demo server process with a loopback health readiness probe', () => {
    const demo = processById(contract(), 'demo-server');
    expect(demo.cwd).toBe('target-root');
    expect(demo.args[0]).toBe(`${TARGET_ROOT_PLACEHOLDER}/demo/server.mjs`);
    expect(demo.args[demo.args.indexOf('--port') + 1]).toBe('4321');
    expect(demo.readiness.kind).toBe('http');
    expect(demo.readiness.url).toBe('http://127.0.0.1:4321/health');
    expect(Number.isInteger(demo.readiness.timeoutMs) && demo.readiness.timeoutMs > 0).toBe(true);
  });

  it('configures the Observer viewer process against this checkout and its own readiness probe', () => {
    const viewer = processById(contract(), 'observer-viewer');
    expect(viewer.cwd).toBe('target-root');
    expect(viewer.args[0]).toBe(path.join(repoRoot, 'dist', 'cli.js'));
    expect(viewer.args).toContain('view');
    expect(viewer.args).toContain('--no-open');
    expect(viewer.args[viewer.args.indexOf('--port') + 1]).toBe('4322');
    // No --root: the project-aware viewer must discover the prepared project.
    expect(viewer.args).not.toContain('--root');
    expect(viewer.readiness.url).toBe('http://127.0.0.1:4322/api/status');
  });

  it('points the application url at the viewer, not the demo', () => {
    const value = contract();
    expect(value.applicationUrl).toBe('http://127.0.0.1:4322/');
  });

  it('uses loopback for every declared url', () => {
    const value = contract();
    const urls = [value.applicationUrl, ...value.processes.map((entry) => entry.readiness.url)];
    for (const url of urls) {
      expect(new URL(url).hostname, url).toBe('127.0.0.1');
      expect(new URL(url).protocol, url).toBe('http:');
    }
  });

  it('rejects an unknown scenario, an invalid port, and two identical ports', () => {
    expect(() => contract({ scenarioId: 'not-a-scenario' })).toThrow(/unknown scenario id/);
    expect(() => contract({ demoPort: 0 })).toThrow(/demo port/);
    expect(() => contract({ demoPort: 65536 })).toThrow(/demo port/);
    expect(() => contract({ viewerPort: 1.5 })).toThrow(/viewer port/);
    expect(() => contract({ demoPort: 5000, viewerPort: 5000 })).toThrow(/distinct/);
  });

  it('validates ports and scenario ids at the boundary', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isTutorialScenarioId('observer-v09-runtime-contract')).toBe(true);
    expect(isTutorialScenarioId('nope')).toBe(false);
  });

  it('is deterministic for the same scenario and explicit ports', () => {
    expect(JSON.stringify(contract())).toBe(JSON.stringify(contract()));
  });
});

describe('v0.9 tutorial target contract - generation to disk', () => {
  afterAll(async () => {
    await rm(workflowRoot, { recursive: true, force: true });
  });

  it('writes the contract and honours explicit ports exactly', async () => {
    const outPath = path.join(workflowRoot, 'explicit.json');
    const result = await generateTutorialTargetContract({
      scenarioId: 'observer-v09-reference-authoring',
      outPath,
      demoPort: 4173,
      viewerPort: 4174,
      observerRoot: repoRoot,
    });
    expect(result.demoPort).toBe(4173);
    expect(result.viewerPort).toBe(4174);
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    expect(written).toEqual(result.contract);
    expect(written.applicationUrl).toBe('http://127.0.0.1:4174/');
  });

  it('allocates two distinct free loopback ports when none are given', async () => {
    const outPath = path.join(workflowRoot, 'dynamic.json');
    const result = await generateTutorialTargetContract({
      scenarioId: 'observer-v09-annotation-basics',
      outPath,
      observerRoot: repoRoot,
    });
    expect(isValidPort(result.demoPort)).toBe(true);
    expect(isValidPort(result.viewerPort)).toBe(true);
    expect(result.demoPort).not.toBe(result.viewerPort);
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    expect(written.applicationUrl).toBe(`http://127.0.0.1:${result.viewerPort}/`);
  });
});
