import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewerServer/viewerService.js';
import { writeReferenceCandidateFixture, writeExternalReferencePairFixture } from '../support/evidenceFixtures.js';

const cleanupDirs: string[] = [];
const cleanupClosers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanupClosers.splice(0).map((close) => close()));
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-reference-view-'));
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
  if (record === undefined) throw new Error(`no ${family} record found (logicalId=${logicalId})`);
  return record.handle;
}

describe('GET /api/references/:handle/view', () => {
  it('derives real canonical region relationships and requirement adequacy from an imported reference - never a second derivation engine', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const importedHandle = await indexHandleFor(url, 'external-reference-imported');

    const response = await fetch(`${url}/api/references/${importedHandle}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      regionRelationships: { regions: string[]; pairwiseRelationships: { kind: string; subjectRegion: string; relatedRegion: string }[] } | null;
      requirementAdequacy: { status: string; totalRequirements: number; evaluableRequirements: number } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.regionRelationships).not.toBeNull();
    expect(body.regionRelationships?.regions.sort()).toEqual(['header', 'sidebar']);
    expect(body.regionRelationships?.pairwiseRelationships.some((r) => r.kind === 'follows-vertically')).toBe(true);
    expect(body.requirementAdequacy).not.toBeNull();
    expect(body.requirementAdequacy?.totalRequirements).toBe(4);
    expect(body.requirementAdequacy?.status).toBe('adequate');
    expect(body.requirementAdequacy?.evaluableRequirements).toBe(4);
  });

  it('derives the same evidence for the approved reference (carries regions/requirements forward verbatim from the imported source)', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const approvedHandle = await indexHandleFor(url, 'external-reference-approved');

    const response = await fetch(`${url}/api/references/${approvedHandle}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; requirementAdequacy: { status: string } | null };
    expect(body.ok).toBe(true);
    expect(body.requirementAdequacy?.status).toBe('adequate');
  });

  it('reports null region relationships/adequacy honestly for a reference with no authored regions/requirements', async () => {
    const root = await makeRoot();
    await writeExternalReferencePairFixture(root);
    const { url } = await startFor(root);
    const importedHandle = await indexHandleFor(url, 'external-reference-imported');

    const response = await fetch(`${url}/api/references/${importedHandle}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; regionRelationships: unknown; requirementAdequacy: unknown };
    expect(body.regionRelationships).toBeNull();
    expect(body.requirementAdequacy).toBeNull();
  });

  it('rejects a handle that does not resolve to external-reference evidence (409)', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    const response = await fetch(`${url}/api/references/${candidateHandle}/view`);
    expect(response.status).toBe(409);
  });

  it('returns 404 for an unknown reference handle', async () => {
    const root = await makeRoot();
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/references/external-reference-imported%3Adoes-not-exist/view`);
    expect(response.status).toBe(404);
  });

  it('rejects write methods (405)', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const importedHandle = await indexHandleFor(url, 'external-reference-imported');
    const response = await fetch(`${url}/api/references/${importedHandle}/view`, { method: 'POST' });
    expect(response.status).toBe(405);
  });
});

describe('GET /api/references/:handle/candidate/:handle/view', () => {
  it('evaluates real canonical compatibility through evaluateReferenceCandidateCompatibility - comparable for a matching candidate', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    const response = await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; compatibility: { compatibility: { state: string; reasons: unknown[] } }; evaluationHandles: string[] };
    expect(body.compatibility.compatibility.state).toBe('comparable');
    const codes = body.compatibility.compatibility.reasons.map((r) => r.code);
    expect(codes).toEqual(['authenticated-state-unassessed', 'application-state-unassessed']);
    for (const reason of body.compatibility.compatibility.reasons) expect(reason.severity).toBe('unassessed');
    expect(body.evaluationHandles).toEqual([]);
  });

  it('reports incomparable with real canonical blocking reasons for a viewport/theme-mismatched candidate', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-incompatible');

    const response = await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; compatibility: { compatibility: { state: string; reasons: { code: string; severity: string }[] } } };
    expect(body.compatibility.compatibility.state).toBe('incomparable');
    const codes = body.compatibility.compatibility.reasons.map((r) => r.code);
    expect(codes).toContain('viewport-mismatch');
    expect(codes).toContain('theme-mismatch');
  });

  it('never fabricates an evaluation context - lists zero handles when no evaluation references this candidate as "after"', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    const response = await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/view`);
    const body = (await response.json()) as { evaluationHandles: string[] };
    expect(body.evaluationHandles).toEqual([]);
  });

  it('returns 404 for an unknown candidate handle', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const response = await fetch(`${url}/api/references/${referenceHandle}/candidate/observation%3Adoes-not-exist/view`);
    expect(response.status).toBe(404);
  });

  it('rejects a candidate handle that is not observation evidence (409)', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const otherReferenceHandle = await indexHandleFor(url, 'external-reference-imported');

    const response = await fetch(`${url}/api/references/${referenceHandle}/candidate/${otherReferenceHandle}/view`);
    expect(response.status).toBe(409);
  });
});
