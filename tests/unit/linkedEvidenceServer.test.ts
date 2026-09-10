import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewerServer/viewerService.js';
import { writeFullPipelineFixture, writeAllPassPipelineFixture, writeBaselineSupersessionFixture } from '../support/evidenceFixtures.js';

const cleanupDirs: string[] = [];
const cleanupClosers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanupClosers.splice(0).map((close) => close()));
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-linked-evidence-'));
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

describe('GET /api/comparisons/:handle/view', () => {
  it('resolves the exact before/after observations by canonical identity - never by folder name/screenshot/URL/geometry similarity', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const comparisonHandle = await indexHandleFor(url, 'comparison');
    const beforeHandle = await indexHandleFor(url, 'observation', 'obs-before');
    const afterHandle = await indexHandleFor(url, 'observation', 'obs-after');

    const response = await fetch(`${url}/api/comparisons/${comparisonHandle}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; before: { status: string; handle?: string }; after: { status: string; handle?: string } };
    expect(body.before).toEqual({ status: 'resolved', handle: beforeHandle });
    expect(body.after).toEqual({ status: 'resolved', handle: afterHandle });
    void fixture;
  });

  it('reports missing linked evidence honestly when the before observation is absent from the root', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const comparisonHandle = await indexHandleFor(url, 'comparison');

    // Remove only the before observation from the authorized root, leaving the after observation intact.
    await rm(fixture.beforeRoot, { recursive: true, force: true });

    const response = await fetch(`${url}/api/comparisons/${comparisonHandle}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { before: { status: string }; after: { status: string } };
    expect(body.before).toEqual({ status: 'missing' });
    expect(body.after.status).toBe('resolved');
  });

  it('reports ambiguity when two indexed observations share identical exact identity', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const comparisonHandle = await indexHandleFor(url, 'comparison');

    // Duplicate the before observation's manifest verbatim under a different directory name - identical identity, genuine ambiguity.
    const duplicateDir = path.join(root, 'observations', 'obs-before-duplicate');
    await mkdir(duplicateDir, { recursive: true });
    const manifestBytes = await readFile(path.join(fixture.beforeRoot, 'manifest.json'));
    await writeFile(path.join(duplicateDir, 'manifest.json'), manifestBytes);

    const response = await fetch(`${url}/api/comparisons/${comparisonHandle}/view`);
    const body = (await response.json()) as { before: { status: string; count?: number } };
    expect(body.before.status).toBe('ambiguous');
    expect(body.before.count).toBe(2);
  });

  it('rejects a handle for a non-comparison family with 409', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const observationHandle = await indexHandleFor(url, 'observation', 'obs-before');
    const response = await fetch(`${url}/api/comparisons/${observationHandle}/view`);
    expect(response.status).toBe(409);
  });

  it('rejects an unknown handle with 404', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/comparisons/comparison:does-not-exist/view`);
    expect(response.status).toBe(404);
  });

  it('rejects write methods', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'comparison');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${url}/api/comparisons/${handle}/view`, { method });
      expect(response.status).toBe(405);
    }
  });
});

describe('GET /api/evaluations/:handle/view', () => {
  it('resolves baseline/change/comparison/before/after all by exact identity', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const evaluationHandle = await indexHandleFor(url, 'contract-evaluation');
    const baselineHandle = await indexHandleFor(url, 'baseline-contract');
    const changeHandle = await indexHandleFor(url, 'change-contract');
    const comparisonHandle = await indexHandleFor(url, 'comparison');
    const beforeHandle = await indexHandleFor(url, 'observation', 'obs-before');
    const afterHandle = await indexHandleFor(url, 'observation', 'obs-after');

    const response = await fetch(`${url}/api/evaluations/${evaluationHandle}/view`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      baseline: { status: string; handle?: string };
      change: { status: string; handle?: string };
      comparison: { status: string; handle?: string };
      before: { status: string; handle?: string };
      after: { status: string; handle?: string };
    };
    expect(body.baseline).toEqual({ status: 'resolved', handle: baselineHandle });
    expect(body.change).toEqual({ status: 'resolved', handle: changeHandle });
    expect(body.comparison).toEqual({ status: 'resolved', handle: comparisonHandle });
    expect(body.before).toEqual({ status: 'resolved', handle: beforeHandle });
    expect(body.after).toEqual({ status: 'resolved', handle: afterHandle });
  });

  it('reports a missing baseline contract honestly without recomputing anything', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const evaluationHandle = await indexHandleFor(url, 'contract-evaluation');
    await rm(fixture.baselineRoot, { recursive: true, force: true });

    const response = await fetch(`${url}/api/evaluations/${evaluationHandle}/view`);
    const body = (await response.json()) as { baseline: { status: string } };
    expect(body.baseline).toEqual({ status: 'missing' });
  });

  it('reports a missing comparison honestly', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const evaluationHandle = await indexHandleFor(url, 'contract-evaluation');
    await rm(fixture.comparisonRoot, { recursive: true, force: true });

    const response = await fetch(`${url}/api/evaluations/${evaluationHandle}/view`);
    const body = (await response.json()) as { comparison: { status: string } };
    expect(body.comparison).toEqual({ status: 'missing' });
  });

  it('rejects a handle for a non-evaluation family with 409', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const comparisonHandle = await indexHandleFor(url, 'comparison');
    const response = await fetch(`${url}/api/evaluations/${comparisonHandle}/view`);
    expect(response.status).toBe(409);
  });

  it('rejects an unknown handle with 404', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/evaluations/contract-evaluation:does-not-exist/view`);
    expect(response.status).toBe(404);
  });

  it('rejects write methods', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'contract-evaluation');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${url}/api/evaluations/${handle}/view`, { method });
      expect(response.status).toBe(405);
    }
  });
});

describe('all-pass and safety-failure fixtures produce real canonical verdicts (never hand-edited)', () => {
  it('the all-pass fixture evaluation is a genuine PASS with every clause passing', async () => {
    const root = await makeRoot();
    await writeAllPassPipelineFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'contract-evaluation');
    const detail = (await (await fetch(`${url}/api/artifacts/${handle}`)).json()) as { artifact: { overallVerdict: string; clauseResults: { status: string }[] } };
    expect(detail.artifact.overallVerdict).toBe('PASS');
    expect(detail.artifact.clauseResults.every((r) => r.status === 'pass')).toBe(true);
  });

  it('the full-pipeline fixture evaluation is a genuine FAIL: requested passes, protected and preserved fail', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'contract-evaluation');
    const detail = (await (await fetch(`${url}/api/artifacts/${handle}`)).json()) as { artifact: { overallVerdict: string; clauseResults: { clauseId: string; status: string }[] } };
    expect(detail.artifact.overallVerdict).toBe('FAIL');
    const byId = Object.fromEntries(detail.artifact.clauseResults.map((r) => [r.clauseId, r.status]));
    expect(byId['requested-nav']).toBe('pass');
    expect(byId['protected-rightad']).toBe('fail');
    expect(byId['preserved-nav-unclipped']).toBe('fail');
  });

  it('the baseline-supersession fixture reports real active/superseded baseline clause ids and an unexpected change', async () => {
    const root = await makeRoot();
    await writeBaselineSupersessionFixture(root);
    const { url } = await startFor(root);
    const handle = await indexHandleFor(url, 'contract-evaluation');
    const detail = (await (await fetch(`${url}/api/artifacts/${handle}`)).json()) as {
      artifact: { activeBaselineClauseIds: string[]; supersededBaselineClauseIds: string[]; unexpectedChanges: { classification: string }[] };
    };
    expect(detail.artifact.activeBaselineClauseIds).toContain('baseline-workspace-visible');
    expect(detail.artifact.supersededBaselineClauseIds).toContain('baseline-nav-visible');
    expect(detail.artifact.unexpectedChanges.length).toBeGreaterThan(0);
    expect(detail.artifact.unexpectedChanges[0]?.classification).toBe('unexpected');
  });
});
