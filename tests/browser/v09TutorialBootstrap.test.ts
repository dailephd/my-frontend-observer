import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { prepareTutorialTarget, RUNTIME_TARGETS, BASELINE_ALIAS, CANONICAL_VIEWPORT } from '../../examples/v09-demo/scripts/prepare-tutorial-target.mjs';
import {
  detectExternalReferenceImageFormat,
  readExternalReferenceImageDimensions,
} from '../../src/domain/externalReferenceImage.js';
import { validateProjectConfig } from '../../src/projectWorkflow/projectConfig.js';
import { isValidPersistentBaselineContract, isValidPerChangeContract } from '../../src/domain/frontendContracts.js';
import { isValidExternalReferenceArtifact } from '../../src/domain/externalReference.js';

const repoRoot = path.resolve(__dirname, '../..');
const demoRoot = path.join(repoRoot, 'examples', 'v09-demo');
const referenceImage = path.join(demoRoot, 'references', 'v09-reference.png');
const workflowRoot = path.join(repoRoot, '.my-dev-kit-workflow', 'v0.9', 'tutorial-integration', 'tests', 'bootstrap');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') { probe.close(); reject(new Error('no port')); return; }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/** Content fingerprint of the tracked demo template, used to prove prepare never writes into it. */
async function fingerprintDemoSource(): Promise<Record<string, string>> {
  const entries = await readdir(demoRoot, { withFileTypes: true, recursive: true });
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const relative = path.relative(demoRoot, full).split(path.sep).join('/');
    out[relative] = createHash('sha256').update(await readFile(full)).digest('hex');
  }
  return out;
}

async function readManifest<T>(artifactRoot: string): Promise<T> {
  return JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as T;
}

/** Every reference artifact anywhere beneath the project's managed reference root. */
async function referenceArtifacts(targetRoot: string): Promise<Record<string, unknown>[]> {
  const root = path.join(targetRoot, '.frontend-observer', 'evidence', 'references');
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const found: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'manifest.json') {
      found.push(JSON.parse(await readFile(path.join(entry.parentPath, entry.name), 'utf8')));
    }
  }
  return found;
}

beforeAll(() => {
  if (!existsSync(path.join(repoRoot, 'dist', 'cli.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit', shell: true });
  }
}, 300_000);

afterAll(async () => {
  await rm(workflowRoot, { recursive: true, force: true });
});

/**
 * v0.9 tutorial integration: the prepare command the released lab runs before
 * every tutorial. These are real bootstraps against real Chromium capture, not
 * fixtures: the project, the baseline observation, the contracts and the
 * references are all produced by canonical Observer owners.
 */
describe('v0.9 tutorial bootstrap - common base', () => {
  const targetRoot = path.join(workflowRoot, 'basics');
  let sourceBefore: Record<string, string>;
  let demoPort: number;

  beforeAll(async () => {
    await rm(workflowRoot, { recursive: true, force: true });
    sourceBefore = await fingerprintDemoSource();
    demoPort = await freePort();
    await prepareTutorialTarget({ targetRoot, scenarioId: 'observer-v09-annotation-basics', demoPort, observerRoot: repoRoot });
  }, 300_000);

  it('materializes the demo beneath the target root', async () => {
    for (const relative of ['demo/server.mjs', 'demo/app/index.html', 'demo/app/styles.css', 'demo/app/state.js']) {
      expect((await stat(path.join(targetRoot, relative))).isFile(), relative).toBe(true);
    }
  });

  it('initializes a canonical Observer project at the target root', async () => {
    const config = JSON.parse(await readFile(path.join(targetRoot, 'frontend-observer.json'), 'utf8'));
    const validated = validateProjectConfig(config);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.reason);
    expect(validated.config.viewport).toEqual(CANONICAL_VIEWPORT);
    expect(validated.config.url).toBe(`http://127.0.0.1:${demoPort}/?state=baseline`);
    expect(validated.config.defaultBaseline).toBe(BASELINE_ALIAS);
    expect(validated.config.targets.map((target) => target.name)).toEqual(RUNTIME_TARGETS.map((target) => target.name));
  });

  it('binds every runtime target to the Prompt 1 stable demo vocabulary', async () => {
    const config = JSON.parse(await readFile(path.join(targetRoot, 'frontend-observer.json'), 'utf8'));
    for (const target of config.targets as { name: string; selector: string }[]) {
      expect(target.selector, target.name).toMatch(/^\[data-demo-target="[a-z0-9-]+"\]$/);
    }
    for (const required of ['header', 'hero', 'sidebar', 'content', 'card1', 'card2', 'cta', 'footer', 'asset']) {
      expect(config.targets.map((t: { name: string }) => t.name)).toContain(required);
    }
  });

  it('captures a canonical baseline observation under the baseline alias', async () => {
    const catalog = JSON.parse(await readFile(path.join(targetRoot, '.frontend-observer', 'catalog.json'), 'utf8'));
    const entry = catalog.observations[BASELINE_ALIAS];
    expect(entry, 'baseline alias').toBeDefined();
    const artifactRoot = path.join(targetRoot, '.frontend-observer', 'evidence', entry.relativeArtifactDir);
    expect((await stat(path.join(artifactRoot, 'screenshot.png'))).size).toBeGreaterThan(0);

    const observation = await readManifest<Record<string, never>>(artifactRoot);
    expect((observation as Record<string, unknown>).observationId).toBe(entry.observationId);
    const targetEvidence = (observation as unknown as { targetEvidence: Record<string, { resolution: { state: string; value?: { selectionStatus: string } } }> }).targetEvidence;
    for (const target of RUNTIME_TARGETS) {
      const record = targetEvidence[target.name];
      expect(record, target.name).toBeDefined();
      expect(record.resolution.state, target.name).toBe('available');
      expect(record.resolution.value?.selectionStatus, target.name).toBe('matched');
    }
  });

  it('closes its temporary demo server so the lab can bind the same port', async () => {
    // The prepare above used demoPort and has returned; binding it again must succeed.
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.on('error', reject);
      probe.listen(demoPort, '127.0.0.1', () => probe.close(() => resolve()));
    });
  });

  it('writes no reference or contract evidence for the annotation-basics scenario', async () => {
    const evidence = path.join(targetRoot, '.frontend-observer', 'evidence');
    expect(existsSync(path.join(evidence, 'references'))).toBe(false);
    expect(existsSync(path.join(evidence, 'contracts'))).toBe(false);
  });

  it('leaves the tracked demo template byte-identical', async () => {
    expect(await fingerprintDemoSource()).toEqual(sourceBefore);
  });
});

describe('v0.9 tutorial bootstrap - runtime contract acceptance', () => {
  const targetRoot = path.join(workflowRoot, 'contract');

  beforeAll(async () => {
    await prepareTutorialTarget({ targetRoot, scenarioId: 'observer-v09-runtime-contract', demoPort: await freePort(), observerRoot: repoRoot });
  }, 300_000);

  it('configures project acceptance with both contract artifacts', async () => {
    const config = JSON.parse(await readFile(path.join(targetRoot, 'frontend-observer.json'), 'utf8'));
    const validated = validateProjectConfig(config);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.reason);
    expect(validated.config.acceptance?.contract).toBeDefined();
    expect(validated.config.acceptance?.contract?.baselineArtifact).toBeTruthy();
    expect(validated.config.acceptance?.contract?.changeArtifact).toBeTruthy();
  });

  it('persists a valid baseline contract at the configured path', async () => {
    const config = JSON.parse(await readFile(path.join(targetRoot, 'frontend-observer.json'), 'utf8'));
    const contract = await readManifest<unknown>(path.join(targetRoot, config.acceptance.contract.baselineArtifact));
    const validated = isValidPersistentBaselineContract(contract);
    expect(validated.valid, validated.valid ? '' : validated.reason).toBe(true);
    expect((contract as { baselineId: string }).baselineId).toBe('v09-tutorial-baseline');
  });

  it('persists a valid initial change contract at the configured path', async () => {
    const config = JSON.parse(await readFile(path.join(targetRoot, 'frontend-observer.json'), 'utf8'));
    const contract = await readManifest<unknown>(path.join(targetRoot, config.acceptance.contract.changeArtifact));
    const validated = isValidPerChangeContract(contract);
    expect(validated.valid, validated.valid ? '' : validated.reason).toBe(true);
  });

  it('ties the baseline contract to the observation it was captured from', async () => {
    const config = JSON.parse(await readFile(path.join(targetRoot, 'frontend-observer.json'), 'utf8'));
    const contract = await readManifest<{ sourceObservation: { observationId: string } }>(path.join(targetRoot, config.acceptance.contract.baselineArtifact));
    const catalog = JSON.parse(await readFile(path.join(targetRoot, '.frontend-observer', 'catalog.json'), 'utf8'));
    expect(contract.sourceObservation.observationId).toBe(catalog.observations[BASELINE_ALIAS].observationId);
  });
});

describe('v0.9 tutorial bootstrap - approved external reference', () => {
  const targetRoot = path.join(workflowRoot, 'reference');

  beforeAll(async () => {
    await prepareTutorialTarget({ targetRoot, scenarioId: 'observer-v09-reference-authoring', demoPort: await freePort(), observerRoot: repoRoot });
  }, 300_000);

  it('imports the fixed Prompt 1 reference image through the canonical owner', async () => {
    const artifacts = await referenceArtifacts(targetRoot);
    const imported = artifacts.filter((a) => (a.lifecycle as { state: string }).state === 'imported');
    expect(imported.length).toBe(1);
    for (const artifact of artifacts) {
      const validated = isValidExternalReferenceArtifact(artifact);
      expect(validated.valid, validated.valid ? '' : validated.reason).toBe(true);
    }
  });

  it('carries the committed image bytes, verified by digest', async () => {
    const bytes = await readFile(referenceImage);
    const expected = createHash('sha256').update(bytes).digest('hex');
    const artifacts = await referenceArtifacts(targetRoot);
    const imported = artifacts.find((a) => (a.lifecycle as { state: string }).state === 'imported') as { image: { sha256: string; width: number; height: number } };
    expect(imported.image.sha256).toBe(expected);
    expect({ width: imported.image.width, height: imported.image.height }).toEqual(CANONICAL_VIEWPORT);
    // And the committed asset really is the supported image it claims to be.
    expect(detectExternalReferenceImageFormat(new Uint8Array(bytes))).toBe('png');
    expect(readExternalReferenceImageDimensions(new Uint8Array(bytes), 'png')).toEqual(CANONICAL_VIEWPORT);
  });

  it('declares the committed reference regions', async () => {
    const declared = JSON.parse(await readFile(path.join(demoRoot, 'references', 'v09-reference-regions.json'), 'utf8'));
    const artifacts = await referenceArtifacts(targetRoot);
    const imported = artifacts.find((a) => (a.lifecycle as { state: string }).state === 'imported') as { regions: { id: string }[] };
    expect(imported.regions.map((region) => region.id)).toEqual(declared.regions.map((region: { id: string }) => region.id));
    expect(imported.regions.length).toBe(7);
  });

  it('explicitly approves a reference that carries the same regions', async () => {
    const artifacts = await referenceArtifacts(targetRoot);
    const approved = artifacts.filter((a) => (a.lifecycle as { state: string }).state === 'approved');
    expect(approved.length).toBe(1);
    expect((approved[0] as { regions: unknown[] }).regions.length).toBe(7);
    expect((approved[0] as { provenance?: { label?: string } }).provenance?.label).toBe('v09-tutorial-reference');
  });

  it('captures a baseline observation as well, so every scenario shares one base', async () => {
    const catalog = JSON.parse(await readFile(path.join(targetRoot, '.frontend-observer', 'catalog.json'), 'utf8'));
    expect(catalog.observations[BASELINE_ALIAS]).toBeDefined();
  });
});

describe('v0.9 tutorial bootstrap - argument safety', () => {
  it('requires an explicit target root, a known scenario and a valid demo port', async () => {
    await expect(prepareTutorialTarget({ targetRoot: '', scenarioId: 'observer-v09-annotation-basics', demoPort: 4173 })).rejects.toThrow(/explicit target root/);
    await expect(prepareTutorialTarget({ targetRoot: path.join(workflowRoot, 'never'), scenarioId: 'nope', demoPort: 4173 })).rejects.toThrow(/unknown scenario id/);
    await expect(prepareTutorialTarget({ targetRoot: path.join(workflowRoot, 'never'), scenarioId: 'observer-v09-annotation-basics', demoPort: 0 })).rejects.toThrow(/valid demo port/);
  });
});
