import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../../src/cli.js';
import type { ImportedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import { EXTERNAL_REFERENCE_MANIFEST_FILENAME } from '../../src/artifacts/externalReferenceArtifactWriter.js';
import { buildMinimalPng } from './externalReferenceImageFixtures.js';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: { stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text) },
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

/** Relative `--output` locations resolve against `process.cwd()`, matching every other command's convention (see cliFrontendContracts.test.ts#runCliInDir). */
async function runCliInDir(dir: string, args: readonly string[], io: ReturnType<typeof capture>['io']): Promise<number> {
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await runCli(args, io);
  } finally {
    process.chdir(originalCwd);
  }
}

const tempDirs: string[] = [];
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('cli import-reference / approve-reference', () => {
  it('prints help for both commands', async () => {
    const out = capture();
    expect(await runCli(['import-reference', '--help'], out.io)).toBe(0);
    expect(out.stdout()).toContain('import-reference');

    const out2 = capture();
    expect(await runCli(['approve-reference', '--help'], out2.io)).toBe(0);
    expect(out2.stdout()).toContain('approve-reference');
  });

  // TST-025: end-to-end import then approve through the CLI argument parser, no Chromium involved.
  it('TST-025: imports then approves a reference end-to-end, exiting 0 with a concise result', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(37, 41));

    const importOut = capture();
    const importCode = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--label', 'homepage hero'], importOut.io);
    expect(importCode).toBe(0);
    expect(importOut.stdout()).toContain('State: imported');
    const artifactRootLine = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '));
    expect(artifactRootLine).toBeDefined();
    const artifactRoot = artifactRootLine!.slice('Artifact: '.length);

    const manifest = JSON.parse(await readFile(path.join(artifactRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME), 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.lifecycle.state).toBe('imported');

    const approveOut = capture();
    const approveCode = await runCliInDir(dir, ['approve-reference', '--reference', artifactRoot, '--output', '.'], approveOut.io);
    expect(approveCode).toBe(0);
    expect(approveOut.stdout()).toContain('State: approved');
  });

  it('exits nonzero and prints a diagnostic for an unsupported image format', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-bad-');
    const badFile = path.join(dir, 'not-an-image.bin');
    await writeFile(badFile, new Uint8Array([0, 1, 2, 3]));

    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', badFile, '--output', '.'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('unsupported-image-format');
  });

  it('exits nonzero for a nonexistent image file path', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-missing-');
    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', path.join(dir, 'nope.png'), '--output', '.'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('error:');
  });

  it('exits nonzero for missing required arguments', async () => {
    const out = capture();
    expect(await runCli(['import-reference'], out.io)).toBe(1);

    const out2 = capture();
    expect(await runCli(['approve-reference'], out2.io)).toBe(1);
  });
});
