import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  prepareDemoTarget,
  validateTargetRoot,
  PrepareDemoError,
  DEMO_SOURCE_ROOT,
  REPO_ROOT,
} from '../../examples/v09-demo/scripts/prepare.mjs';

/**
 * Substantial generated state stays inside the repository-local approved
 * workflow root (which is git-ignored), never in the tracked demo template
 * and never in the repository root.
 */
const workflowRoot = path.join(REPO_ROOT, '.my-dev-kit-workflow', 'v0.9', 'demo-foundation', 'tests', 'materialization');

/** Exactly what a materialized target root is expected to contain. */
const EXPECTED_TARGET_FILES = [
  'app/assets/asset-alternate.svg',
  'app/assets/asset-primary.svg',
  'app/assets/brand-mark.svg',
  'app/index.html',
  'app/state.js',
  'app/styles.css',
  'server.mjs',
];

async function listRelativeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

/** Content-addressed snapshot of the tracked template, used to prove immutability across a destructive materialization. */
async function fingerprintSource(): Promise<Record<string, string>> {
  const files = await listRelativeFiles(DEMO_SOURCE_ROOT);
  const fingerprint: Record<string, string> = {};
  for (const relative of files) {
    const bytes = await readFile(path.join(DEMO_SOURCE_ROOT, relative));
    fingerprint[relative] = createHash('sha256').update(bytes).digest('hex');
  }
  return fingerprint;
}

describe('v0.9 demo materialization - target-root safety', () => {
  it('requires an explicit target root', async () => {
    await expect(prepareDemoTarget(undefined)).rejects.toBeInstanceOf(PrepareDemoError);
    await expect(prepareDemoTarget('')).rejects.toBeInstanceOf(PrepareDemoError);
    await expect(prepareDemoTarget('   ')).rejects.toBeInstanceOf(PrepareDemoError);
  });

  it('rejects a filesystem or drive root', () => {
    const { root } = path.parse(path.resolve(REPO_ROOT));
    expect(() => validateTargetRoot(root)).toThrow(/filesystem root/);
    expect(() => validateTargetRoot(path.sep)).toThrow(/filesystem root|root-like/);
  });

  it('rejects a root-like target with fewer than two segments below its root', () => {
    const { root } = path.parse(path.resolve(REPO_ROOT));
    expect(() => validateTargetRoot(path.join(root, 'Windows'))).toThrow(/root-like target/);
    expect(() => validateTargetRoot(path.join(root, 'usr'))).toThrow(/root-like target/);
  });

  it('rejects the home directory', () => {
    expect(() => validateTargetRoot(homedir())).toThrow(/home directory|root-like target/);
  });

  it('rejects the repository root', () => {
    expect(() => validateTargetRoot(REPO_ROOT)).toThrow(/repository root/);
  });

  it('rejects the immutable demo template and anything inside it', () => {
    expect(() => validateTargetRoot(DEMO_SOURCE_ROOT)).toThrow(/immutable demo template/);
    expect(() => validateTargetRoot(path.join(DEMO_SOURCE_ROOT, 'app'))).toThrow(/immutable demo template/);
    expect(() => validateTargetRoot(path.join(DEMO_SOURCE_ROOT, 'references'))).toThrow(/immutable demo template/);
  });

  it('rejects a directory that contains the repository, which a reset would destroy', () => {
    expect(() => validateTargetRoot(path.resolve(REPO_ROOT, '..'))).toThrow(/contains the repository|root-like target|home directory/);
  });

  it('rejects a null byte in the target root', () => {
    expect(() => validateTargetRoot('some\0path')).toThrow(/null byte/);
  });

  it('accepts a disposable target inside the approved workflow root', () => {
    expect(validateTargetRoot(workflowRoot)).toBe(path.resolve(workflowRoot));
  });
});

describe('v0.9 demo materialization - clean, deterministic, non-destructive to the source', () => {
  const target = path.join(workflowRoot, 'target');
  let sourceBefore: Record<string, string>;

  beforeAll(async () => {
    await rm(workflowRoot, { recursive: true, force: true });
    sourceBefore = await fingerprintSource();
  });

  afterAll(async () => {
    await rm(workflowRoot, { recursive: true, force: true });
  });

  it('produces exactly the expected demo files in a clean target', async () => {
    const result = await prepareDemoTarget(target);
    expect(result.targetRoot).toBe(path.resolve(target));
    expect(await listRelativeFiles(target)).toEqual(EXPECTED_TARGET_FILES);
  });

  it('copies each file byte-for-byte from the tracked template', async () => {
    for (const relative of EXPECTED_TARGET_FILES) {
      const sourceRelative = relative === 'server.mjs' ? 'scripts/server.mjs' : relative;
      const sourceBytes = await readFile(path.join(DEMO_SOURCE_ROOT, sourceRelative));
      const targetBytes = await readFile(path.join(target, relative));
      expect(targetBytes.equals(sourceBytes), `${relative} must match the template byte-for-byte`).toBe(true);
    }
  });

  it('writes no Observer evidence into the target', async () => {
    for (const relative of await listRelativeFiles(target)) {
      expect(relative).not.toContain('.frontend-observer');
    }
  });

  it('rerunning resets the target deterministically, discarding anything the previous run left behind', async () => {
    await mkdir(path.join(target, 'stale-dir'), { recursive: true });
    await writeFile(path.join(target, 'stale-dir', 'leftover.txt'), 'from a previous run');
    await writeFile(path.join(target, 'app', 'index.html'), '<!doctype html><title>mutated</title>');

    await prepareDemoTarget(target);

    expect(await listRelativeFiles(target)).toEqual(EXPECTED_TARGET_FILES);
    const restored = await readFile(path.join(target, 'app', 'index.html'), 'utf8');
    const template = await readFile(path.join(DEMO_SOURCE_ROOT, 'app', 'index.html'), 'utf8');
    expect(restored).toBe(template);
  });

  it('leaves the tracked demo template completely unchanged', async () => {
    const sourceAfter = await fingerprintSource();
    expect(sourceAfter).toEqual(sourceBefore);
  });

  it('writes nothing outside the selected target root', async () => {
    const workflowEntries = await listRelativeFiles(workflowRoot);
    for (const relative of workflowEntries) {
      expect(relative.startsWith('target/')).toBe(true);
    }
    // The template keeps its own directories; nothing new appeared beside them.
    const demoEntries = await readdir(DEMO_SOURCE_ROOT, { withFileTypes: true });
    expect(demoEntries.map((entry) => entry.name).sort()).toEqual(['README.md', 'app', 'references', 'scripts', 'tutorials']);
  });

  it('produces a target whose server can be started from the target root alone', async () => {
    const serverPath = path.join(target, 'server.mjs');
    const stats = await stat(serverPath);
    expect(stats.isFile()).toBe(true);
    const { defaultAppRoot } = await import(pathToFileURL(serverPath).href);
    expect(defaultAppRoot()).toBe(path.join(path.resolve(target), 'app'));
  });
});
