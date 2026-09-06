import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeExternalReferenceArtifact, EXTERNAL_REFERENCE_MANIFEST_FILENAME } from '../../src/artifacts/externalReferenceArtifactWriter.js';
import { readExternalReferenceArtifact } from '../../src/artifacts/externalReferenceArtifactReader.js';
import { EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import type { ImportedExternalReferenceArtifact, ApprovedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import { buildMinimalPng } from './externalReferenceImageFixtures.js';

const IMAGE_BYTES = buildMinimalPng(37, 41);
const IMAGE_SHA256 = createHash('sha256').update(IMAGE_BYTES).digest('hex');

function importedArtifact(referenceId = 'req-1-instance-1'): ImportedExternalReferenceArtifact {
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: 'req-1',
    referenceId,
    producer: { name: 'my-frontend-observer', version: '0.6.0' },
    provenance: { importedAt: '2026-01-01T00:00:00.000Z' },
    image: { path: 'reference.png', format: 'png', width: 37, height: 41, byteLength: IMAGE_BYTES.length, sha256: IMAGE_SHA256 },
    lifecycle: { state: 'imported' },
    diagnostics: [],
    completion: { state: 'complete' },
  };
}

function approvedArtifact(imported: ImportedExternalReferenceArtifact, referenceId = 'req-1-instance-2'): ApprovedExternalReferenceArtifact {
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: imported.referenceRequestId,
    referenceId,
    producer: imported.producer,
    provenance: imported.provenance,
    sourceReference: {
      referenceId: imported.referenceId,
      referenceRequestId: imported.referenceRequestId,
      producer: imported.producer,
      schemaVersion: imported.schemaVersion,
      image: imported.image,
    },
    lifecycle: { state: 'approved', approvedAt: '2026-01-02T00:00:00.000Z' },
    diagnostics: [],
    completion: { state: 'complete' },
  };
}

describe('externalReferenceArtifactWriter / reader', () => {
  const tempDirs: string[] = [];

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-external-reference-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // TST-009 (writer half): an 'imported' artifact persists both its manifest and its owned image file.
  it('persists an imported artifact with its owned image file, at a bare relative image path', async () => {
    const cwd = await freshCwd();
    const artifact = importedArtifact();

    const result = await writeExternalReferenceArtifact(artifact, IMAGE_BYTES, '.', { cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const onDisk = await readFile(result.imagePath!);
    expect(new Uint8Array(onDisk)).toEqual(IMAGE_BYTES);

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.image.path).toBe('reference.png');
    expect(path.isAbsolute(manifest.image.path)).toBe(false);
  });

  // TST-024: an approved artifact's directory contains only the manifest - no image bytes are ever copied into it.
  it('TST-024: persists an approved artifact with no image file in its own directory', async () => {
    const cwd = await freshCwd();
    const imported = importedArtifact();
    const approved = approvedArtifact(imported);

    const result = await writeExternalReferenceArtifact(approved, undefined, '.', { cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.imagePath).toBeUndefined();

    const files = await readdir(result.artifactRoot);
    expect(files).toEqual([EXTERNAL_REFERENCE_MANIFEST_FILENAME]);
  });

  // TST-022: an existing directory at the same referenceId is a genuine collision, never overwritten.
  it('TST-022: refuses to overwrite an existing artifact at the same referenceId', async () => {
    const cwd = await freshCwd();
    const artifact = importedArtifact();

    const first = await writeExternalReferenceArtifact(artifact, IMAGE_BYTES, '.', { cwd });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected first write to succeed');
    const before = await readFile(first.manifestPath, 'utf8');

    const second = await writeExternalReferenceArtifact(artifact, IMAGE_BYTES, '.', { cwd });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected second write to be rejected');
    expect(second.diagnostics[0]?.code).toBe('artifact-write-failure');

    const after = await readFile(first.manifestPath, 'utf8');
    expect(after).toBe(before);
  });

  // TST-021: no leftover .tmp-* directory after a successful write.
  it('TST-021: leaves no temporary directory behind after a successful write', async () => {
    const cwd = await freshCwd();
    const artifact = importedArtifact();

    const result = await writeExternalReferenceArtifact(artifact, IMAGE_BYTES, '.', { cwd });
    expect(result.ok).toBe(true);

    const entries = await readdir(cwd);
    expect(entries.some((entry) => entry.startsWith('.tmp-'))).toBe(false);
  });

  it('refuses to persist an "imported" artifact without image bytes', async () => {
    const cwd = await freshCwd();
    const result = await writeExternalReferenceArtifact(importedArtifact(), undefined, '.', { cwd });
    expect(result.ok).toBe(false);
  });

  it('refuses to persist a structurally invalid artifact', async () => {
    const cwd = await freshCwd();
    const invalid = { ...importedArtifact(), schemaVersion: '9.9.9' } as unknown as ImportedExternalReferenceArtifact;
    const result = await writeExternalReferenceArtifact(invalid, IMAGE_BYTES, '.', { cwd });
    expect(result.ok).toBe(false);
  });

  // TST-023: writer/reader round-trip symmetry, and the reader fails closed on corrupt JSON / structurally invalid content.
  it('TST-023: reader round-trips exactly what the writer persisted, and fails closed on corruption', async () => {
    const cwd = await freshCwd();
    const artifact = importedArtifact();
    const written = await writeExternalReferenceArtifact(artifact, IMAGE_BYTES, '.', { cwd });
    if (!written.ok) throw new Error('expected ok result');

    const read = await readExternalReferenceArtifact(written.manifestPath);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('expected ok read');
    expect(read.artifact).toEqual(artifact);

    const missing = await readExternalReferenceArtifact(path.join(cwd, 'does-not-exist', EXTERNAL_REFERENCE_MANIFEST_FILENAME));
    expect(missing.ok).toBe(false);

    const badJsonPath = path.join(cwd, 'bad.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(badJsonPath, '{not json', 'utf8');
    const badJson = await readExternalReferenceArtifact(badJsonPath);
    expect(badJson.ok).toBe(false);

    const invalidStructurePath = path.join(cwd, 'invalid.json');
    await writeFile(invalidStructurePath, JSON.stringify({ artifactKind: 'wrong' }), 'utf8');
    const invalidStructure = await readExternalReferenceArtifact(invalidStructurePath);
    expect(invalidStructure.ok).toBe(false);
  });
});
