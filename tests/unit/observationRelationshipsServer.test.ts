import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewerServer/viewerService.js';
import { deriveLayoutRelationships } from '../../src/domain/relationships.js';
import { readObservationArtifact } from '../../src/artifacts/artifactReader.js';
import { writeRichObservationFixture, writeFullPipelineFixture, writeUnsupportedVersionManifest } from '../support/evidenceFixtures.js';

const cleanupDirs: string[] = [];
const cleanupClosers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanupClosers.splice(0).map((close) => close()));
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-obs-relationships-'));
  cleanupDirs.push(dir);
  return dir;
}

async function makeAssetsRoot(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-assets-'));
  cleanupDirs.push(parent);
  await writeFile(path.join(parent, 'index.html'), '<!doctype html><title>fixture shell</title>');
  return parent;
}

async function startFor(root: string): Promise<{ url: string }> {
  const assetsRoot = await makeAssetsRoot();
  const result = await startViewer({ root, port: 0, assetsRoot });
  if (!result.ok) throw new Error(`expected server to start: ${JSON.stringify(result.diagnostics)}`);
  cleanupClosers.push(result.close);
  return { url: result.url };
}

async function indexHandleFor(url: string, family: string, logicalId?: string): Promise<string> {
  const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string; logicalId?: string }[] };
  const record = index.records.find((r) => r.family === family && (logicalId === undefined || r.logicalId === logicalId));
  if (record === undefined) throw new Error(`no ${family} record found`);
  return record.handle;
}

describe('GET /api/observations/:handle/relationships', () => {
  it('returns exactly the canonical deriveLayoutRelationships(...) result for a real observation - never a second computation', async () => {
    const root = await makeRoot();
    const fixture = await writeRichObservationFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'observation', fixture.observationId);

    const response = await fetch(`${url}/api/observations/${handle}/relationships`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; graph: unknown };
    expect(body.ok).toBe(true);

    // Independently re-derive the same graph directly from the persisted artifact through the same canonical function,
    // and assert byte-for-byte equality - proving the server route is a thin pass-through, not a reimplementation.
    const read = await readObservationArtifact(path.join(fixture.artifactRoot, 'manifest.json'));
    if (!read.ok) throw new Error('expected fixture artifact to read back validly');
    const expected = deriveLayoutRelationships(read.artifact);
    expect(expected.ok).toBe(true);
    if (expected.ok) {
      expect(body.graph).toEqual(expected.graph);
    }
  });

  it('lists the genuinely unresolved target and excludes it from geometric relationships, matching canonical evidence', async () => {
    const root = await makeRoot();
    const fixture = await writeRichObservationFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'observation', fixture.observationId);

    const body = (await (await fetch(`${url}/api/observations/${handle}/relationships`)).json()) as {
      graph: { unresolvedTargets: { target: string; reason: string }[]; pairwiseRelationships: { subjectTarget: string; relatedTarget: string }[] };
    };
    expect(body.graph.unresolvedTargets).toContainEqual({ target: 'missingWidget', reason: 'not-found' });
    for (const rel of body.graph.pairwiseRelationships) {
      expect(rel.subjectTarget).not.toBe('missingWidget');
      expect(rel.relatedTarget).not.toBe('missingWidget');
    }
  });

  it('produces a real geometric relationship (header above footer) traceable to canonical evidence', async () => {
    const root = await makeRoot();
    const fixture = await writeRichObservationFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'observation', fixture.observationId);

    const body = (await (await fetch(`${url}/api/observations/${handle}/relationships`)).json()) as {
      graph: { pairwiseRelationships: { kind: string; subjectTarget: string; relatedTarget: string }[] };
    };
    expect(body.graph.pairwiseRelationships.some((r) => r.kind === 'above' && r.subjectTarget === 'header' && r.relatedTarget === 'footer')).toBe(true);
  });

  it('rejects a handle for a non-observation family with 409, never attempting derivation', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'comparison');

    const response = await fetch(`${url}/api/observations/${handle}/relationships`);
    expect(response.status).toBe(409);
  });

  it('rejects an unknown handle with 404', async () => {
    const root = await makeRoot();
    await writeRichObservationFixture(root);
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/observations/observation:does-not-exist/relationships`);
    expect(response.status).toBe(404);
  });

  it('rejects an unsupported-version observation handle with 409, never fabricating a graph', async () => {
    const root = await makeRoot();
    await writeUnsupportedVersionManifest(root, 'future');
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'observation');
    const response = await fetch(`${url}/api/observations/${handle}/relationships`);
    expect(response.status).toBe(409);
  });

  it('rejects write methods', async () => {
    const root = await makeRoot();
    const fixture = await writeRichObservationFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'observation', fixture.observationId);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${url}/api/observations/${handle}/relationships`, { method });
      expect(response.status).toBe(405);
    }
  });
});
