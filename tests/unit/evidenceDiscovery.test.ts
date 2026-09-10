import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverManifests } from '../../src/viewerServer/evidence/discovery.js';
import { classifyManifest } from '../../src/viewerServer/evidence/classify.js';
import { buildEvidenceIndexMetadata } from '../../src/viewerServer/evidence/index.js';
import {
  writeFullPipelineFixture,
  writeExternalReferencePairFixture,
  writeMalformedJsonManifest,
  writeUnsupportedVersionManifest,
  writeUnrecognizedManifest,
  writeUnrelatedFile,
  writeObservationWithMissingScreenshot,
} from '../support/evidenceFixtures.js';

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-evidence-root-'));
  cleanupDirs.push(dir);
  return dir;
}

describe('discoverManifests', () => {
  it('finds only files literally named manifest.json, in deterministic sorted order', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    await writeUnrelatedFile(root, 'README.txt');
    await writeUnrelatedFile(root, 'notes/random.json', '{"not":"evidence"}');

    const first = await discoverManifests(root);
    const second = await discoverManifests(root);
    expect(first.manifests.map((m) => m.relativeDir)).toEqual(second.manifests.map((m) => m.relativeDir));
    expect(first.manifests.length).toBeGreaterThanOrEqual(5); // before, after, comparison, baseline, change, evaluation
    for (const m of first.manifests) {
      expect(m.absolutePath.endsWith('manifest.json')).toBe(true);
    }
    // Sorted ascending by relative directory.
    const sorted = [...first.manifests].sort((a, b) => (a.relativeDir < b.relativeDir ? -1 : a.relativeDir > b.relativeDir ? 1 : 0));
    expect(first.manifests).toEqual(sorted);
  });

  it('never opens or reports an unrelated file, even one that is valid JSON', async () => {
    const root = await makeRoot();
    await writeUnrelatedFile(root, 'package.json', '{"name":"not-evidence"}');
    await writeUnrelatedFile(root, 'notes/random.json', '{"not":"evidence"}');
    const result = await discoverManifests(root);
    expect(result.manifests).toEqual([]);
  });

  it('never follows a directory symlink out of the evidence root', async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-outside-'));
    cleanupDirs.push(outside);
    await writeFullPipelineFixture(outside); // real evidence, but outside the authorized root

    const linkPath = path.join(root, 'escape-link');
    try {
      await symlink(outside, linkPath, 'dir');
    } catch {
      // Symlink creation can require elevated privileges on some Windows configurations; skip this assertion there rather than fail spuriously.
      return;
    }
    const result = await discoverManifests(root);
    expect(result.manifests).toEqual([]);
  });
});

describe('classifyManifest', () => {
  it('classifies a valid current observation as supported', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const classified = await classifyManifest(path.join(fixture.beforeRoot, 'manifest.json'));
    expect(classified.supportState).toBe('supported');
    if (classified.supportState === 'supported') {
      expect(classified.family).toBe('observation');
      expect(classified.artifact.observationId).toBe('obs-before');
    }
  });

  it('classifies a valid current comparison, baseline contract, change contract, and evaluation as supported', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const comparison = await classifyManifest(path.join(fixture.comparisonRoot, 'manifest.json'));
    const baseline = await classifyManifest(path.join(fixture.baselineRoot, 'manifest.json'));
    const change = await classifyManifest(path.join(fixture.changeRoot, 'manifest.json'));
    const evaluation = await classifyManifest(path.join(fixture.evaluationRoot, 'manifest.json'));
    expect(comparison.supportState).toBe('supported');
    expect(baseline.supportState).toBe('supported');
    expect(change.supportState).toBe('supported');
    expect(evaluation.supportState).toBe('supported');
    if (comparison.supportState === 'supported') expect(comparison.family).toBe('comparison');
    if (baseline.supportState === 'supported') expect(baseline.family).toBe('baseline-contract');
    if (change.supportState === 'supported') expect(change.family).toBe('change-contract');
    if (evaluation.supportState === 'supported') expect(evaluation.family).toBe('contract-evaluation');
  });

  it('classifies an imported external reference and an approved external reference distinctly, both supported', async () => {
    const root = await makeRoot();
    const fixture = await writeExternalReferencePairFixture(root);
    const imported = await classifyManifest(path.join(fixture.importedRoot, 'manifest.json'));
    const approved = await classifyManifest(path.join(fixture.approvedRoot, 'manifest.json'));
    expect(imported.supportState).toBe('supported');
    expect(approved.supportState).toBe('supported');
    if (imported.supportState === 'supported') expect(imported.family).toBe('external-reference-imported');
    if (approved.supportState === 'supported') expect(approved.family).toBe('external-reference-approved');
  });

  it('classifies malformed JSON honestly, distinct from every other problem state', async () => {
    const root = await makeRoot();
    const dir = await writeMalformedJsonManifest(root, 'broken');
    const classified = await classifyManifest(path.join(dir, 'manifest.json'));
    expect(classified.supportState).toBe('malformed-json');
  });

  it('classifies a recognized kind with an unsupported future schema version honestly, never fabricating a domain object', async () => {
    const root = await makeRoot();
    const dir = await writeUnsupportedVersionManifest(root, 'future');
    const classified = await classifyManifest(path.join(dir, 'manifest.json'));
    expect(classified.supportState).toBe('unsupported-version');
    if (classified.supportState === 'unsupported-version') {
      expect(classified.family).toBe('observation');
      expect(classified.foundSchemaVersion).toBe('99.0.0');
    }
  });

  it('classifies an unrecognized manifest (no known artifactKind) honestly', async () => {
    const root = await makeRoot();
    const dir = await writeUnrecognizedManifest(root, 'mystery');
    const classified = await classifyManifest(path.join(dir, 'manifest.json'));
    expect(classified.supportState).toBe('unrecognized-kind');
  });

  it('a bounded-agent-context-kind manifest is treated as unrecognized (no disk reader exists for that family)', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'bac');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ artifactKind: 'my-frontend-observer/bounded-agent-context', schemaVersion: '1.0.0' }), 'utf8');
    const classified = await classifyManifest(path.join(dir, 'manifest.json'));
    expect(classified.supportState).toBe('unrecognized-kind');
  });
});

describe('buildEvidenceIndexMetadata', () => {
  it('indexes recognized evidence, excludes unrelated files, and does not let one malformed artifact erase valid neighbors', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    await writeMalformedJsonManifest(root, 'broken');
    await writeUnrelatedFile(root, 'README.txt');

    const result = await buildEvidenceIndexMetadata(root);
    const families = result.records.map((r) => r.family);
    expect(families).toContain('observation');
    expect(families).toContain('comparison');
    expect(families).toContain('baseline-contract');
    expect(families).toContain('change-contract');
    expect(families).toContain('contract-evaluation');
    expect(result.records.some((r) => r.supportState === 'malformed-json')).toBe(true);
    expect(result.records.length).toBe(7); // before, after, comparison, baseline, change, evaluation + 1 malformed
  });

  it('returns metadata only - never full artifact payloads or media bytes', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const result = await buildEvidenceIndexMetadata(root);
    const observationRecord = result.records.find((r) => r.family === 'observation');
    expect(observationRecord).toBeDefined();
    const serialized = JSON.stringify(observationRecord);
    // No target-evidence/geometry/browser-provenance keys (full ObservationArtifact fields) leak into the metadata record.
    expect(serialized).not.toContain('targetEvidence');
    expect(serialized).not.toContain('pageEvidence');
    expect(serialized).not.toContain('requestConfig');
  });

  it('reports honest media availability, including a genuinely missing screenshot', async () => {
    const root = await makeRoot();
    await writeObservationWithMissingScreenshot(root, 'obsroot');
    const result = await buildEvidenceIndexMetadata(root);
    const record = result.records.find((r) => r.family === 'observation');
    expect(record?.media?.[0]).toMatchObject({ role: 'screenshot', available: false });
  });

  it('deterministic ordering across repeated calls', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const a = await buildEvidenceIndexMetadata(root);
    const b = await buildEvidenceIndexMetadata(root);
    expect(a.records.map((r) => r.handle)).toEqual(b.records.map((r) => r.handle));
  });
});
