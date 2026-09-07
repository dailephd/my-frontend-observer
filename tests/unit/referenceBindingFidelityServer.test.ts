import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewerServer/viewerService.js';
import { writeReferenceCandidateFixture, writeReferenceBindingFidelityFixture, writeReferenceFidelityContractFixture } from '../support/evidenceFixtures.js';

const cleanupDirs: string[] = [];
const cleanupClosers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanupClosers.splice(0).map((close) => close()));
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-binding-fidelity-'));
  cleanupDirs.push(dir);
  return dir;
}

async function makeAssetsRoot(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-assets-'));
  cleanupDirs.push(parent);
  await writeFile(path.join(parent, 'index.html'), '<!doctype html><title>fixture shell</title>');
  return parent;
}

async function startFor(root: string, bindingDeclarations: unknown[] = []): Promise<{ url: string }> {
  const assetsRoot = await makeAssetsRoot();
  const result = await startViewer({ root, port: 0, assetsRoot, bindingDeclarations });
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

describe('GET /api/references/:handle/candidate/:handle/view - coordinateMapping', () => {
  it('reports the real canonical scale for a coherent-aspect-ratio reference/applicability pair', async () => {
    const root = await makeRoot();
    await writeReferenceBindingFidelityFixture(root);
    const { url } = await startFor(root);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-fidelity-pass');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/view`)).json()) as {
      coordinateMapping: { ok: boolean; scale?: { scaleX: number; scaleY: number } };
    };
    expect(body.coordinateMapping.ok).toBe(true);
    expect(body.coordinateMapping.scale).toEqual({ scaleX: 0.25, scaleY: 0.25 });
  });

  it('reports coordinateMapping.ok=false for an incoherent aspect ratio (Batch 5 fixture)', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/view`)).json()) as { coordinateMapping: { ok: boolean; reason?: string } };
    expect(body.coordinateMapping.ok).toBe(false);
    expect(body.coordinateMapping.reason).toMatch(/coherent full-frame aspect ratio/);
  });
});

describe('GET /api/references/:handle/candidate/:handle/bindings', () => {
  it('returns real canonical bound results for explicit declarations against a matching candidate', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    const response = await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; evaluation: { bindings: { referenceRegion: string; runtimeTarget: string; status: string }[] } };
    expect(body.evaluation.bindings).toEqual([
      { referenceRegion: 'header', runtimeTarget: 'header', status: 'bound', detail: expect.any(String), targetResolutionStatus: 'matched', targetVisible: true },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar', status: 'bound', detail: expect.any(String), targetResolutionStatus: 'matched', targetVisible: true },
    ]);
  });

  it('returns an honest empty bindings array with no declarations loaded (no --bindings-file)', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root); // no bindingDeclarations
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`)).json()) as { evaluation: { bindings: unknown[] } };
    expect(body.evaluation.bindings).toEqual([]);
  });

  it('never fabricates bindings for an incompatible candidate - compatibility blocks evaluation with an empty bindings array', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root, [{ referenceRegion: 'header', runtimeTarget: 'header' }]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-incompatible');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`)).json()) as { evaluation: { compatibility: { state: string }; bindings: unknown[] } };
    expect(body.evaluation.compatibility.state).toBe('incomparable');
    expect(body.evaluation.bindings).toEqual([]);
  });

  it('reports genuine unavailable status (runtime-target-not-configured) rather than fabricating bound', async () => {
    const root = await makeRoot();
    await writeReferenceBindingFidelityFixture(root);
    const { url } = await startFor(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-binding-unavailable');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`)).json()) as {
      evaluation: { bindings: { referenceRegion: string; status: string; reasonCode?: string }[] };
    };
    const header = body.evaluation.bindings.find((b) => b.referenceRegion === 'header');
    const sidebar = body.evaluation.bindings.find((b) => b.referenceRegion === 'sidebar');
    expect(header).toMatchObject({ status: 'unavailable', reasonCode: 'runtime-target-not-configured' });
    expect(sidebar).toMatchObject({ status: 'bound' });
  });

  it('reports genuine ambiguous status, never collapsed into unavailable', async () => {
    const root = await makeRoot();
    await writeReferenceBindingFidelityFixture(root);
    const { url } = await startFor(root, [{ referenceRegion: 'header', runtimeTarget: 'header' }]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-binding-ambiguous');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`)).json()) as { evaluation: { bindings: { status: string; reasonCode?: string }[] } };
    expect(body.evaluation.bindings[0]).toMatchObject({ status: 'ambiguous', reasonCode: 'runtime-target-ambiguous' });
  });

  it('rejects declarations that are structurally invalid for the selected reference (422), never silently dropping them', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root, [{ referenceRegion: 'does-not-exist', runtimeTarget: 'header' }]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    const response = await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`);
    expect(response.status).toBe(422);
  });

  it('returns 404 for unknown reference/candidate handles and 405 for write methods', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    expect((await fetch(`${url}/api/references/external-reference-approved%3Adoes-not-exist/candidate/${candidateHandle}/bindings`)).status).toBe(404);
    expect((await fetch(`${url}/api/references/${referenceHandle}/candidate/observation%3Adoes-not-exist/bindings`)).status).toBe(404);
    expect((await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`, { method: 'POST' })).status).toBe(405);
  });
});

describe('GET /api/references/:handle/candidate/:handle/fidelity', () => {
  it('evaluates a real canonical PASS through evaluateReferenceCandidateFidelity, never a client-computed result', async () => {
    const root = await makeRoot();
    await writeReferenceBindingFidelityFixture(root);
    const { url } = await startFor(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-fidelity-pass');

    const response = await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; evaluation: { state: string; requirementResults: { requirementId: string; status: string; referenceValue?: number; candidateRawValue?: number; candidateValue?: number; delta?: number }[] } };
    expect(body.evaluation.state).toBe('pass');
    expect(body.evaluation.requirementResults).toHaveLength(4);
    expect(body.evaluation.requirementResults.every((r) => r.status === 'pass')).toBe(true);

    // Unit conflation check: candidateRawValue (CSS px) must differ from candidateValue (reference-image px) whenever the two domains are not 1:1.
    const heightResult = body.evaluation.requirementResults.find((r) => r.requirementId.length > 0 && r.candidateRawValue !== undefined && r.referenceValue === 60);
    expect(heightResult).toBeDefined();
    expect(heightResult?.candidateRawValue).toBe(240);
    expect(heightResult?.candidateValue).toBe(60);
    expect(heightResult?.delta).toBe(0);
  });

  it('evaluates a real canonical FAIL with a genuinely out-of-tolerance requirement', async () => {
    const root = await makeRoot();
    await writeReferenceBindingFidelityFixture(root);
    const { url } = await startFor(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-fidelity-fail');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`)).json()) as {
      evaluation: { state: string; requirementResults: { status: string; referenceValue?: number; candidateValue?: number; delta?: number; tolerance?: { kind: string; amount?: number } }[] };
    };
    expect(body.evaluation.state).toBe('fail');
    const failing = body.evaluation.requirementResults.find((r) => r.status === 'fail');
    expect(failing).toBeDefined();
    expect(failing?.referenceValue).toBe(120);
    expect(failing?.candidateValue).toBe(150);
    expect(failing?.delta).toBe(30);
    expect(failing?.tolerance).toEqual({ kind: 'absolute-reference-px', amount: 4 });
  });

  it('reports not-evaluated/blockedBy=incompatible without fabricating pass/fail requirement results', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root, [{ referenceRegion: 'header', runtimeTarget: 'header' }]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-incompatible');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`)).json()) as {
      evaluation: { state: string; blockedBy?: string; requirementResults: unknown[] };
    };
    expect(body.evaluation.state).toBe('not-evaluated');
    expect(body.evaluation.blockedBy).toBe('incompatible');
    expect(body.evaluation.requirementResults).toEqual([]);
  });

  it('marks requirements unavailable (binding-unavailable) rather than fabricating pass when a bound target is missing', async () => {
    const root = await makeRoot();
    await writeReferenceBindingFidelityFixture(root);
    const { url } = await startFor(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-binding-unavailable');

    const body = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`)).json()) as {
      evaluation: { state: string; requirementResults: { requirementId: string; status: string; reasonCode?: string; boundRuntimeTargets: string[] }[] };
    };
    expect(body.evaluation.state).toBe('fail'); // 'fail' is the honest overall state whenever not every requirement passes (unavailable !== pass)
    const headerPropertyResult = body.evaluation.requirementResults.find((r) => r.boundRuntimeTargets.length === 0 && r.reasonCode === 'binding-unavailable');
    expect(headerPropertyResult).toBeDefined();
    expect(headerPropertyResult?.status).toBe('unavailable');
  });

  it('the interactive /bindings result and the fidelity result\'s embedded bindings agree exactly for identical inputs', async () => {
    const root = await makeRoot();
    await writeReferenceBindingFidelityFixture(root);
    const declarations = [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ];
    const { url } = await startFor(root, declarations);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-fidelity-pass');

    const bindingsBody = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`)).json()) as { evaluation: unknown };
    const fidelityBody = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`)).json()) as { evaluation: { bindings: unknown } };
    expect(fidelityBody.evaluation.bindings).toEqual(bindingsBody.evaluation);
  });

  it('rejects invalid declarations (422) and returns 404/405 for unknown handles/write methods', async () => {
    const root = await makeRoot();
    await writeReferenceCandidateFixture(root);
    const { url } = await startFor(root, [{ referenceRegion: 'nope', runtimeTarget: 'header' }]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', 'rc-compatible');

    expect((await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`)).status).toBe(422);
    expect((await fetch(`${url}/api/references/${referenceHandle}/candidate/observation%3Adoes-not-exist/fidelity`)).status).toBe(404);
    expect((await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`, { method: 'POST' })).status).toBe(405);
  });

  it('task §68: a genuine fidelity PASS and a genuine contract-evaluation FAIL for the exact same candidate are independently retrievable, never collapsed into one status', async () => {
    const root = await makeRoot();
    const fixture = await writeReferenceFidelityContractFixture(root);
    const { url } = await startFor(root, [
      { referenceRegion: 'header', runtimeTarget: 'header' },
      { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
    ]);
    const referenceHandle = await indexHandleFor(url, 'external-reference-approved');
    const candidateHandle = await indexHandleFor(url, 'observation', fixture.candidateId);

    const fidelityBody = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`)).json()) as { evaluation: { state: string } };
    expect(fidelityBody.evaluation.state).toBe('pass');

    const candidateViewBody = (await (await fetch(`${url}/api/references/${referenceHandle}/candidate/${candidateHandle}/view`)).json()) as { evaluationHandles: string[] };
    expect(candidateViewBody.evaluationHandles).toHaveLength(1);

    const evaluationDetail = (await (await fetch(`${url}/api/artifacts/${candidateViewBody.evaluationHandles[0]}`)).json()) as { artifact: { overallVerdict: string } };
    expect(evaluationDetail.artifact.overallVerdict).toBe('FAIL');
  });
});
