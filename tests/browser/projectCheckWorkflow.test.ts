import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli, type CliIO } from '../../src/cli.js';
import { readAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, projectConfigPath, projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';
import { resolveContainedAcceptancePath } from '../../src/projectWorkflow/checkAcceptance.js';
import type { CheckWorkflowResult } from '../../src/projectWorkflow/checkResult.js';
import { readObservationArtifact } from '../../src/artifacts/artifactReader.js';
import { approveAndPersistBaseline, persistPerChangeContract } from '../../src/application/frontendContractPersistenceService.js';
import { importExternalReference, approveExternalReference } from '../../src/application/externalReferencePersistenceService.js';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';

const fixtureRoot = process.env.MFO_PROMPT2_FIXTURE_ROOT ?? path.join(tmpdir(), 'mfo-prompt2-fixtures');
const roots = {
  review: path.join(fixtureRoot, 'review-required'),
  contract: path.join(fixtureRoot, 'contract-fail-pass'),
  reference: path.join(fixtureRoot, 'reference-fail-pass'),
  comparison: path.join(fixtureRoot, 'comparison-blocked'),
  history: path.join(fixtureRoot, 'current-history'),
  symlink: path.join(fixtureRoot, 'symlink-security'),
};
const viewerDist = path.resolve(__dirname, '../../dist/viewer');
const servers: Server[] = [];
let viewer: Extract<StartViewerResult, { ok: true }> | undefined;

function output(): { io: CliIO; stdout: () => string; stderr: () => string } {
  const stdout: string[] = []; const stderr: string[] = [];
  return { io: { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) }, stdout: () => stdout.join(''), stderr: () => stderr.join('') };
}

async function resetProject(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, 'source'), { recursive: true });
}

async function startFileFrontend(root: string): Promise<string> {
  const server = createServer(async (_request, response) => {
    try { response.writeHead(200, { 'content-type': 'text/html' }); response.end(await readFile(path.join(root, 'source', 'index.html'))); }
    catch { response.writeHead(500); response.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('fixture server failed');
  return `http://127.0.0.1:${address.port}/`;
}

async function inProject<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const before = process.cwd(); process.chdir(root);
  try { return await operation(); } finally { process.chdir(before); }
}

function page(widths: { nav: number; workspace: number; rail: number; footer?: number }): string {
  return `<!doctype html><html><head><style>html,body{margin:0}#nav{position:absolute;left:0;top:0;width:${widths.nav}px;height:80px;overflow:hidden}#nav>span{display:block;width:190px}#workspace{position:absolute;left:210px;top:0;width:${widths.workspace}px;height:80px}#rail{position:absolute;left:800px;top:0;width:${widths.rail}px;height:80px}#footer{position:absolute;left:0;top:200px;width:${widths.footer ?? 950}px;height:50px}</style></head><body><nav id="nav"><span>Navigation</span></nav><main id="workspace">Workspace</main><aside id="rail">Rail</aside><footer id="footer">Footer</footer></body></html>`;
}

async function initialize(root: string, url: string, targets = ['nav=#nav', 'workspace=#workspace', 'rail=#rail', 'footer=#footer']): Promise<void> {
  await inProject(root, async () => {
    const result = await runCli(['init', '--url', url, '--viewport', '1000x700', ...targets.flatMap((target) => ['--target', target])], output().io);
    expect(result).toBe(0);
    expect(await runCli(['capture', 'baseline'], output().io)).toBe(0);
  });
}

async function baselineRecord(root: string) {
  const catalog = await readAliasCatalog(aliasCatalogPath(root)); if (!catalog.ok) throw new Error(catalog.reason);
  const record = catalog.catalog.observations.baseline; if (record === undefined) throw new Error('missing baseline');
  return record;
}

async function writeConfigAcceptance(root: string, acceptance: unknown): Promise<void> {
  const config = JSON.parse(await readFile(projectConfigPath(root), 'utf8')) as Record<string, unknown>;
  await writeFile(projectConfigPath(root), `${JSON.stringify({ ...config, schemaVersion: '1.1.0', acceptance }, null, 2)}\n`);
}

async function runCheckJson(root: string): Promise<{ exitCode: number; value: CheckWorkflowResult; stdout: string }> {
  return inProject(root, async () => {
    const out = output(); const exitCode = await runCli(['check', 'baseline', '--json'], out.io);
    expect(out.stderr()).toBe('');
    return { exitCode, value: JSON.parse(out.stdout()) as CheckWorkflowResult, stdout: out.stdout() };
  });
}

function minimalPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(41); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const u32 = (at: number, value: number) => { bytes[at] = (value >>> 24) & 255; bytes[at + 1] = (value >>> 16) & 255; bytes[at + 2] = (value >>> 8) & 255; bytes[at + 3] = value & 255; };
  u32(8, 13); bytes.set([73, 72, 68, 82], 12); u32(16, width); u32(20, height); bytes.set([8, 6, 0, 0, 0], 24); bytes.set([1, 2, 3, 4], 37); return bytes;
}

beforeAll(async () => { await mkdir(fixtureRoot, { recursive: true }); });
afterAll(async () => {
  await viewer?.close();
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('project check real-Chromium acceptance', () => {
  it('returns REVIEW_REQUIRED from comparison evidence alone', async () => {
    await resetProject(roots.review); await writeFile(path.join(roots.review, 'source', 'index.html'), page({ nav: 200, workspace: 500, rail: 150 }));
    const url = await startFileFrontend(roots.review); await initialize(roots.review, url);
    await writeFile(path.join(roots.review, 'source', 'index.html'), page({ nav: 195, workspace: 560, rail: 150 }));
    const checked = await runCheckJson(roots.review);
    expect(checked.exitCode).toBe(2); expect(checked.value.status).toBe('REVIEW_REQUIRED'); expect(checked.value.comparison.differenceCount).toBeGreaterThan(0);
  }, 120_000);

  it('uses unchanged canonical contracts for actionable FAIL then PASS and preserves current history', async () => {
    await resetProject(roots.contract); await writeFile(path.join(roots.contract, 'source', 'index.html'), page({ nav: 200, workspace: 500, rail: 150 }));
    const url = await startFileFrontend(roots.contract); await initialize(roots.contract, url);
    const record = await baselineRecord(roots.contract); const observationRoot = path.join(projectEvidenceRoot(roots.contract), ...record.relativeArtifactDir.split('/'));
    const observation = await readObservationArtifact(path.join(observationRoot, 'manifest.json')); if (!observation.ok) throw new Error(observation.reason);
    const baseline = await approveAndPersistBaseline({ artifactKind: 'my-frontend-observer/frontend-contract', schemaVersion: '1.0.0', contractClass: 'baseline', baselineId: 'project-baseline', sourceObservation: { observationId: observation.artifact.observationId, requestId: observation.artifact.requestId, producer: observation.artifact.producer, observationSchemaVersion: observation.artifact.schemaVersion }, clauses: [{ clauseId: 'baseline-nav-unclipped', primitive: { kind: 'target-not-clipped', target: 'nav' }, supportingEvidence: [] }], provenance: { approvedAt: new Date(0).toISOString() } }, observationRoot, { outputLocation: 'contracts/baseline', cwd: roots.contract });
    if (!baseline.ok) throw new Error(JSON.stringify(baseline.diagnostics));
    const change = await persistPerChangeContract({ artifactKind: 'my-frontend-observer/frontend-contract', schemaVersion: '1.0.0', contractClass: 'change', contractId: 'requested-layout', contractRequestId: 'requested-layout-request', activeBaselineIds: ['project-baseline'], clauses: [
      { clauseId: 'requested-nav-shrink', primitive: { kind: 'property-decreases', target: 'nav', property: 'width' }, category: 'requested', supportingEvidence: [] },
      { clauseId: 'expected-workspace-grow', primitive: { kind: 'property-increases', target: 'workspace', property: 'width' }, category: 'expected-dependent', expectedDependentMode: 'required', supportingEvidence: [] },
      { clauseId: 'protected-rail-width', primitive: { kind: 'property-unchanged-within-tolerance', target: 'rail', property: 'width', tolerance: { kind: 'exact' } }, category: 'protected', supportingEvidence: [] },
      { clauseId: 'preserved-nav-visible', primitive: { kind: 'target-visible', target: 'nav' }, category: 'preserved', supportingEvidence: [] },
    ] }, { outputLocation: 'contracts/change', cwd: roots.contract });
    if (!change.ok) throw new Error(JSON.stringify(change.diagnostics));
    await writeConfigAcceptance(roots.contract, { contract: { baselineArtifact: path.relative(roots.contract, baseline.artifactRoot).split(path.sep).join('/'), changeArtifact: path.relative(roots.contract, change.artifactRoot).split(path.sep).join('/') } });
    const configBefore = await readFile(projectConfigPath(roots.contract)); const baselineContractBefore = await readFile(baseline.manifestPath); const changeContractBefore = await readFile(change.manifestPath);

    await writeFile(path.join(roots.contract, 'source', 'index.html'), page({ nav: 140, workspace: 560, rail: 130 }));
    const failed = await runCheckJson(roots.contract);
    expect(failed.exitCode).toBe(1); expect(failed.value.status).toBe('FAIL');
    expect(failed.value.contract.failedClauses).toContainEqual(expect.objectContaining({ clauseId: 'protected-rail-width', source: 'change', category: 'protected', primitive: { kind: 'property-unchanged-within-tolerance', target: 'rail', property: 'width', tolerance: { kind: 'exact' } }, status: 'fail', supportingEvidence: expect.any(Array) }));
    expect(failed.stdout).not.toContain(roots.contract); expect(failed.stdout).not.toContain('screenshot.png');
    const firstCurrent = (await readAliasCatalog(aliasCatalogPath(roots.contract))); if (!firstCurrent.ok) throw new Error(firstCurrent.reason); const first = firstCurrent.catalog.observations.current!;

    const human = await inProject(roots.contract, async () => { const out = output(); const code = await runCli(['check', 'baseline'], out.io); return { code, text: out.stdout() }; });
    expect(human.code).toBe(1); expect(human.text).toContain('protected protected-rail-width: FAIL'); expect(human.text).toContain('Inspect: my-frontend-observer view'); expect(human.text).not.toContain(record.observationId); expect(human.text).not.toContain(roots.contract);

    await writeFile(path.join(roots.contract, 'source', 'index.html'), page({ nav: 195, workspace: 560, rail: 150 }));
    const passed = await runCheckJson(roots.contract);
    expect(passed.exitCode).toBe(0); expect(passed.value.status).toBe('PASS'); expect(passed.value.contract.state).toBe('PASS');
    expect(await readFile(projectConfigPath(roots.contract))).toEqual(configBefore); expect(await readFile(baseline.manifestPath)).toEqual(baselineContractBefore); expect(await readFile(change.manifestPath)).toEqual(changeContractBefore);
    const newestCatalog = await readAliasCatalog(aliasCatalogPath(roots.contract)); if (!newestCatalog.ok) throw new Error(newestCatalog.reason); const newest = newestCatalog.catalog.observations.current!;
    expect(newest.observationId).not.toBe(first.observationId); expect(existsSync(path.join(projectEvidenceRoot(roots.contract), ...first.relativeArtifactDir.split('/'), 'manifest.json'))).toBe(true);
  }, 120_000);

  it('maps approved reference fidelity to FAIL, PASS, and canonical BLOCKED', async () => {
    await resetProject(roots.reference); await writeFile(path.join(roots.reference, 'source', 'index.html'), page({ nav: 200, workspace: 500, rail: 150 }));
    const url = await startFileFrontend(roots.reference); await initialize(roots.reference, url, ['rail=#rail']);
    const imported = await importExternalReference(minimalPng(1000, 700), { outputLocation: 'references/imported', cwd: roots.reference, regions: [{ id: 'rail-region', rectangle: { x: 800, y: 0, width: 150, height: 80 } }], requirements: [{ category: 'protected', subject: { kind: 'region-property', region: 'rail-region', property: 'width' }, tolerance: { kind: 'exact' } }], applicability: { viewport: { width: 1000, height: 700 } } });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references/approved', cwd: roots.reference }); if (!approved.ok) throw new Error(JSON.stringify(approved.diagnostics));
    await mkdir(path.join(roots.reference, 'bindings'), { recursive: true }); await writeFile(path.join(roots.reference, 'bindings', 'reference.json'), JSON.stringify({ bindings: [{ referenceRegion: 'rail-region', runtimeTarget: 'rail' }] }));
    await writeConfigAcceptance(roots.reference, { reference: { approvedArtifact: path.relative(roots.reference, approved.artifactRoot).split(path.sep).join('/'), bindingsFile: 'bindings/reference.json' } });
    await writeFile(path.join(roots.reference, 'source', 'index.html'), page({ nav: 200, workspace: 500, rail: 130 }));
    const failed = await runCheckJson(roots.reference); expect(failed.exitCode).toBe(1); expect(failed.value.reference.state).toBe('FAIL'); expect(failed.value.reference.failedRequirements).toHaveLength(1);
    await writeFile(path.join(roots.reference, 'source', 'index.html'), page({ nav: 200, workspace: 500, rail: 150 }));
    const passed = await runCheckJson(roots.reference); expect(passed.exitCode).toBe(0); expect(passed.value.reference.state).toBe('PASS');
    const config = JSON.parse(await readFile(projectConfigPath(roots.reference), 'utf8')); config.viewport = { width: 900, height: 700 }; await writeFile(projectConfigPath(roots.reference), JSON.stringify(config));
    const blocked = await runCheckJson(roots.reference); expect(blocked.exitCode).toBe(3); expect(blocked.value.status).toBe('BLOCKED'); expect(blocked.value.reference.state).toBe('BLOCKED'); expect(blocked.value.reference.blockedBy).toBe('incompatible');
  }, 120_000);

  it('returns BLOCKED for canonical incomparable viewport evidence', async () => {
    await resetProject(roots.comparison); await writeFile(path.join(roots.comparison, 'source', 'index.html'), page({ nav: 200, workspace: 500, rail: 150 }));
    const url = await startFileFrontend(roots.comparison); await initialize(roots.comparison, url, ['rail=#rail']);
    const config = JSON.parse(await readFile(projectConfigPath(roots.comparison), 'utf8')); config.viewport = { width: 900, height: 700 }; await writeFile(projectConfigPath(roots.comparison), JSON.stringify(config));
    const blocked = await runCheckJson(roots.comparison); expect(blocked.exitCode).toBe(3); expect(blocked.value.status).toBe('BLOCKED'); expect(blocked.value.comparison.state).toBe('incomparable'); expect(blocked.value.blockers).toContainEqual(expect.objectContaining({ code: 'comparison-incomparable' }));
  }, 120_000);

  it('keeps immutable current history and aliases only the newest exact artifact in the viewer', async () => {
    await resetProject(roots.history); await writeFile(path.join(roots.history, 'source', 'index.html'), page({ nav: 200, workspace: 500, rail: 150 }));
    const url = await startFileFrontend(roots.history); await initialize(roots.history, url, ['rail=#rail']);
    await runCheckJson(roots.history); const one = await readAliasCatalog(aliasCatalogPath(roots.history)); if (!one.ok) throw new Error(one.reason); const first = one.catalog.observations.current!;
    await writeFile(path.join(roots.history, 'source', 'index.html'), page({ nav: 200, workspace: 500, rail: 145 })); await runCheckJson(roots.history);
    const two = await readAliasCatalog(aliasCatalogPath(roots.history)); if (!two.ok) throw new Error(two.reason); const second = two.catalog.observations.current!;
    expect(second.observationId).not.toBe(first.observationId); expect(existsSync(path.join(projectEvidenceRoot(roots.history), ...first.relativeArtifactDir.split('/'), 'manifest.json'))).toBe(true);
    viewer = await startViewer({ root: projectEvidenceRoot(roots.history), port: 0, assetsRoot: viewerDist, aliasMetadata: { observationAliasesByRelativeDir: Object.fromEntries(Object.entries(two.catalog.observations).map(([alias, value]) => [value.relativeArtifactDir, alias])) } }) as Extract<StartViewerResult, { ok: true }>;
    const index = await (await fetch(`${viewer.url}/api/index`)).json() as { records: { alias?: string; logicalId?: string }[] };
    expect(index.records.filter((item) => item.alias === 'current')).toHaveLength(1); expect(index.records.find((item) => item.alias === 'current')?.logicalId).toBe(second.observationId); expect(index.records.find((item) => item.logicalId === first.observationId)?.alias).toBeUndefined();
    await viewer.close(); viewer = undefined;
    const frontend = servers.pop(); if (frontend === undefined) throw new Error('missing fixture server'); await new Promise<void>((resolve) => frontend.close(() => resolve()));
    const failedCapture = await runCheckJson(roots.history); expect(failedCapture.exitCode).toBe(3); expect(failedCapture.value.blockers).toContainEqual(expect.objectContaining({ code: 'candidate-capture-failed' }));
    const afterFailure = await readAliasCatalog(aliasCatalogPath(roots.history)); if (!afterFailure.ok) throw new Error(afterFailure.reason); expect(afterFailure.catalog.observations.current).toEqual(second);
  }, 120_000);

  it('rejects a real acceptance symlink escape when the platform permits creating it', async () => {
    await resetProject(roots.symlink); const outside = path.join(fixtureRoot, 'symlink-outside'); await mkdir(outside, { recursive: true }); await writeFile(path.join(outside, 'comparison.json'), '{"geometryTolerancePx":0.5}');
    const link = path.join(roots.symlink, 'escaped');
    try { await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (process.platform === 'win32') return; throw error; }
    expect(resolveContainedAcceptancePath(roots.symlink, 'escaped/comparison.json')).toEqual({ ok: false, error: 'acceptance path escapes project root: escaped/comparison.json' });
  });
});
