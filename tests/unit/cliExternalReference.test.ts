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

  // v0.7 Prompt 2: --regions-file wires explicit regions through the CLI, and approval carries them forward.
  it('imports a reference with an explicit --regions-file, and approval carries the regions forward', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-regions-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(800, 600));
    const regionsPath = path.join(dir, 'regions.json');
    await writeFile(
      regionsPath,
      JSON.stringify({
        regions: [
          { id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 60 } },
          { id: 'current-page-card', rectangle: { x: 28, y: 92, width: 424, height: 82 } },
        ],
      }),
      'utf8',
    );

    const importOut = capture();
    const importCode = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--regions-file', regionsPath], importOut.io);
    expect(importCode).toBe(0);
    expect(importOut.stdout()).toContain('Regions: 2');

    const artifactRoot = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '))!
      .slice('Artifact: '.length);
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME), 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.regions).toHaveLength(2);

    const approveOut = capture();
    const approveCode = await runCliInDir(dir, ['approve-reference', '--reference', artifactRoot, '--output', '.'], approveOut.io);
    expect(approveCode).toBe(0);
    expect(approveOut.stdout()).toContain('Regions: 2');
  });

  it('a legacy import-reference invocation without --regions-file reports zero regions, unchanged from Prompt 1', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-no-regions-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));

    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Regions: 0');
  });

  it('exits nonzero with an invalid-reference-region diagnostic for an out-of-bounds region', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-bad-region-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));
    const regionsPath = path.join(dir, 'regions.json');
    await writeFile(regionsPath, JSON.stringify({ regions: [{ id: 'overflow', rectangle: { x: 90, y: 0, width: 50, height: 20 } }] }), 'utf8');

    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--regions-file', regionsPath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('invalid-reference-region');
  });

  it('exits nonzero for a malformed --regions-file (bad JSON, wrong root shape, unknown top-level field)', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-bad-regions-file-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));

    const badJsonPath = path.join(dir, 'bad.json');
    await writeFile(badJsonPath, '{ not valid json', 'utf8');
    const badJsonOut = capture();
    expect(await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--regions-file', badJsonPath], badJsonOut.io)).toBe(1);
    expect(badJsonOut.stderr()).toContain('not valid JSON');

    const arrayRootPath = path.join(dir, 'array-root.json');
    await writeFile(arrayRootPath, '[]', 'utf8');
    const arrayRootOut = capture();
    expect(await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--regions-file', arrayRootPath], arrayRootOut.io)).toBe(1);
    expect(arrayRootOut.stderr()).toContain('root must be a JSON object');

    const unknownFieldPath = path.join(dir, 'unknown-field.json');
    await writeFile(unknownFieldPath, JSON.stringify({ regions: [], extra: true }), 'utf8');
    const unknownFieldOut = capture();
    expect(await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--regions-file', unknownFieldPath], unknownFieldOut.io)).toBe(1);
    expect(unknownFieldOut.stderr()).toContain('unsupported top-level field');
  });

  // v0.7 Prompt 3: --requirements-file wires explicit design requirements through the CLI, and approval carries them forward.
  it('imports a reference with regions and requirements, reporting adequacy; approval carries requirements forward', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-requirements-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(800, 600));
    const regionsPath = path.join(dir, 'regions.json');
    await writeFile(regionsPath, JSON.stringify({ regions: [{ id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 60 } }] }), 'utf8');
    const requirementsPath = path.join(dir, 'requirements.json');
    await writeFile(
      requirementsPath,
      JSON.stringify({ requirements: [{ category: 'requested', subject: { kind: 'region-property', region: 'header', property: 'width' }, tolerance: { kind: 'exact' } }] }),
      'utf8',
    );

    const importOut = capture();
    const importCode = await runCliInDir(
      dir,
      ['import-reference', imagePath, '--output', '.', '--regions-file', regionsPath, '--requirements-file', requirementsPath],
      importOut.io,
    );
    expect(importCode).toBe(0);
    expect(importOut.stdout()).toContain('Requirements: 1');
    expect(importOut.stdout()).toContain('Adequacy: adequate');

    const artifactRoot = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '))!
      .slice('Artifact: '.length);
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME), 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.requirements).toHaveLength(1);

    const approveOut = capture();
    const approveCode = await runCliInDir(dir, ['approve-reference', '--reference', artifactRoot, '--output', '.'], approveOut.io);
    expect(approveCode).toBe(0);
    expect(approveOut.stdout()).toContain('Requirements: 1');
    expect(approveOut.stdout()).toContain('Adequacy: adequate');
  });

  it('a legacy import-reference invocation without --requirements-file reports zero requirements and inadequate adequacy', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-no-requirements-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));

    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Requirements: 0');
    expect(out.stdout()).toContain('Adequacy: inadequate');
  });

  it('exits nonzero with an invalid-reference-requirement diagnostic for a requirement referencing an unknown region', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-bad-requirement-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(800, 600));
    const regionsPath = path.join(dir, 'regions.json');
    await writeFile(regionsPath, JSON.stringify({ regions: [{ id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 60 } }] }), 'utf8');
    const requirementsPath = path.join(dir, 'requirements.json');
    await writeFile(
      requirementsPath,
      JSON.stringify({ requirements: [{ category: 'requested', subject: { kind: 'region-property', region: 'crawl-button', property: 'width' }, tolerance: { kind: 'exact' } }] }),
      'utf8',
    );

    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--regions-file', regionsPath, '--requirements-file', requirementsPath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('invalid-reference-requirement');
  });

  it('exits nonzero for a malformed --requirements-file (bad JSON, wrong root shape, unknown top-level field)', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-bad-requirements-file-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));

    const badJsonPath = path.join(dir, 'bad.json');
    await writeFile(badJsonPath, '{ not valid json', 'utf8');
    const badJsonOut = capture();
    expect(await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--requirements-file', badJsonPath], badJsonOut.io)).toBe(1);
    expect(badJsonOut.stderr()).toContain('not valid JSON');

    const arrayRootPath = path.join(dir, 'array-root.json');
    await writeFile(arrayRootPath, '[]', 'utf8');
    const arrayRootOut = capture();
    expect(await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--requirements-file', arrayRootPath], arrayRootOut.io)).toBe(1);
    expect(arrayRootOut.stderr()).toContain('root must be a JSON object');

    const unknownFieldPath = path.join(dir, 'unknown-field.json');
    await writeFile(unknownFieldPath, JSON.stringify({ requirements: [], extra: true }), 'utf8');
    const unknownFieldOut = capture();
    expect(await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--requirements-file', unknownFieldPath], unknownFieldOut.io)).toBe(1);
    expect(unknownFieldOut.stderr()).toContain('unsupported top-level field');
  });

  // v0.7 Prompt 4: --applicability-file wires explicit reference applicability through the CLI, and approval carries it forward.
  it('imports a reference with applicability, reporting it declared; approval carries applicability forward', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-applicability-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(800, 600));
    const applicabilityPath = path.join(dir, 'applicability.json');
    await writeFile(applicabilityPath, JSON.stringify({ viewport: { width: 1280, height: 720 }, theme: 'dark' }), 'utf8');

    const importOut = capture();
    const importCode = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--applicability-file', applicabilityPath], importOut.io);
    expect(importCode).toBe(0);
    expect(importOut.stdout()).toContain('Applicability: declared');

    const artifactRoot = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '))!
      .slice('Artifact: '.length);
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME), 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.applicability).toEqual({ viewport: { width: 1280, height: 720 }, theme: 'dark' });

    const approveOut = capture();
    const approveCode = await runCliInDir(dir, ['approve-reference', '--reference', artifactRoot, '--output', '.'], approveOut.io);
    expect(approveCode).toBe(0);
    expect(approveOut.stdout()).toContain('Applicability: declared');
  });

  it('a legacy import-reference invocation without --applicability-file reports applicability as none', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-no-applicability-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));

    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Applicability: none');
  });

  it('exits nonzero with an invalid-reference-applicability diagnostic for an out-of-bound viewport', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-bad-applicability-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(800, 600));
    const applicabilityPath = path.join(dir, 'applicability.json');
    await writeFile(applicabilityPath, JSON.stringify({ viewport: { width: 10, height: 10 } }), 'utf8');

    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--applicability-file', applicabilityPath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('invalid-reference-applicability');
  });

  it('exits nonzero for a malformed --applicability-file (bad JSON, non-object root)', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-bad-applicability-file-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));

    const badJsonPath = path.join(dir, 'bad.json');
    await writeFile(badJsonPath, '{ not valid json', 'utf8');
    const badJsonOut = capture();
    expect(await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--applicability-file', badJsonPath], badJsonOut.io)).toBe(1);
    expect(badJsonOut.stderr()).toContain('not valid JSON');

    const arrayRootPath = path.join(dir, 'array-root.json');
    await writeFile(arrayRootPath, '[]', 'utf8');
    const arrayRootOut = capture();
    expect(await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--applicability-file', arrayRootPath], arrayRootOut.io)).toBe(1);
    expect(arrayRootOut.stderr()).toContain('root must be a JSON object');
  });

  it('requires a value: bare --applicability-file fails before any persistence', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-bare-applicability-flag-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));

    const out = capture();
    const code = await runCliInDir(dir, ['import-reference', imagePath, '--output', '.', '--applicability-file'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--applicability-file requires a file path argument');
  });

  it('rejects a second --applicability-file flag', async () => {
    const dir = await makeTempDir('mfo-cli-external-reference-dup-applicability-flag-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));
    const applicabilityPath = path.join(dir, 'applicability.json');
    await writeFile(applicabilityPath, JSON.stringify({ theme: 'dark' }), 'utf8');

    const out = capture();
    const code = await runCliInDir(
      dir,
      ['import-reference', imagePath, '--output', '.', '--applicability-file', applicabilityPath, '--applicability-file', applicabilityPath],
      out.io,
    );
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--applicability-file may only be specified once');
  });
});
