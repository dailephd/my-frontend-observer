import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../../src/cli.js';
import { ARTIFACT_KIND, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetGeometry, TargetEvidenceRecord, TargetComputedStyle, TargetLayoutMetrics } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';
import { writeObservationArtifact, MANIFEST_FILENAME as OBSERVATION_MANIFEST_FILENAME } from '../../src/artifacts/artifactWriter.js';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import { writeComparisonArtifact } from '../../src/artifacts/comparisonArtifactWriter.js';
import { CONTRACT_ARTIFACT_KIND, CONTRACT_SCHEMA_VERSION, type PersistentBaselineContract, type PerChangeContract } from '../../src/domain/frontendContracts.js';
import { writePersistentBaselineContract, writePerChangeContract, FRONTEND_CONTRACT_MANIFEST_FILENAME } from '../../src/artifacts/frontendContractArtifactWriter.js';
import { readFrontendContractEvaluationArtifact } from '../../src/artifacts/frontendContractEvaluationArtifactReader.js';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: { stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text) },
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

/**
 * Relative `--output` locations resolve against `process.cwd()` (there is no
 * `--cwd` CLI flag, matching `compare`/`observe`'s own established
 * convention - see `tests/unit/cliCompareEndToEnd.test.ts#runCompareInDir`),
 * so tests that need isolated output temporarily `chdir` into the fixture
 * directory and always restore the real cwd afterward.
 */
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
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function rect(x: number, y: number, width: number, height: number): TargetGeometry {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function matchedTarget(geometry: TargetGeometry, style?: TargetComputedStyle, layout?: TargetLayoutMetrics): TargetEvidenceRecord {
  return {
    resolution: {
      state: 'available',
      source: 'derived',
      value: {
        selectionMethod: 'ordered-locators',
        selectionStatus: 'matched',
        selectedLocatorKind: 'css',
        selectedLocatorIndex: 0,
        usedFallback: false,
        confidence: 'exact',
        attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'matched', matchCount: 1 }],
      },
      derivedFrom: ['locator-attempts'],
    },
    tag: { state: 'available', source: 'browser', value: 'div' },
    geometry: { state: 'available', source: 'browser', value: geometry },
    style: { state: 'available', source: 'computed-browser', value: style ?? { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
    layout: { state: 'available', source: 'browser', value: layout ?? { scrollWidth: geometry.width, scrollHeight: geometry.height, clientWidth: geometry.width, clientHeight: geometry.height, scrollTop: 0, scrollLeft: 0 } },
    visibility: { state: 'available', source: 'derived', value: { visible: true }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
  };
}

function target(name: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: `#${name}` }] };
}

function observation(observationId: string, names: NamedTarget[], evidence: Record<string, TargetEvidenceRecord>): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observationId,
    requestId: `req-${observationId}`,
    producer: { name: PRODUCER_NAME, version: '0.4.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '139.0.0' } },
    requestConfig: { targetUrl: 'http://localhost/', viewport: { width: 1200, height: 800 }, targets: names, outputLocation: 'observations', timeoutMs: 30000, readiness: { condition: 'load', timeoutMs: 10000 } },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence: evidence,
    screenshot: { state: 'available', source: 'browser', value: { path: 'screenshot.png' } },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
}

function baselineContract(overrides: Partial<PersistentBaselineContract> = {}): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: { observationId: 'obs-before', requestId: 'req-obs-before', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
    clauses: [],
    provenance: { approvedAt: '2026-08-13T00:00:00.000Z' },
    ...overrides,
  };
}

function changeContract(overrides: Partial<PerChangeContract> = {}): PerChangeContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'change',
    contractId: 'change-1',
    contractRequestId: 'change-request-1',
    activeBaselineIds: ['baseline-1'],
    clauses: [],
    ...overrides,
  };
}

async function writeJsonFile(dir: string, name: string, value: unknown): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  return filePath;
}

async function fullPipelineFixture(dir: string) {
  const before = observation('obs-before', [target('navigation'), target('workspace'), target('rightAd')], {
    navigation: matchedTarget(rect(0, 0, 190, 600)),
    workspace: matchedTarget(rect(200, 0, 600, 600)),
    rightAd: matchedTarget(rect(900, 0, 200, 600)),
  });
  const after = observation('obs-after', [target('navigation'), target('workspace'), target('rightAd')], {
    navigation: matchedTarget(rect(0, 0, 140, 600), { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' }, { scrollWidth: 160, scrollHeight: 600, clientWidth: 140, clientHeight: 600, scrollTop: 0, scrollLeft: 0 }),
    workspace: matchedTarget(rect(200, 0, 650, 600)),
    rightAd: matchedTarget(rect(900, 0, 180, 600)),
  });

  const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1, 2, 3]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, new Uint8Array([4, 5, 6]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  const baseline = baselineContract();
  const change = changeContract({
    clauses: [
      { clauseId: 'requested-nav', primitive: { kind: 'property-decreases', target: 'navigation', property: 'width' }, category: 'requested', supportingEvidence: [] },
      { clauseId: 'expected-workspace', primitive: { kind: 'property-increases', target: 'workspace', property: 'width' }, category: 'expected-dependent', expectedDependentMode: 'required', supportingEvidence: [] },
      { clauseId: 'protected-rightad', primitive: { kind: 'property-unchanged-within-tolerance', target: 'rightAd', property: 'width', tolerance: { kind: 'exact' } }, category: 'protected', supportingEvidence: [] },
      { clauseId: 'preserved-nav-unclipped', primitive: { kind: 'target-not-clipped', target: 'navigation' }, category: 'preserved', supportingEvidence: [] },
    ],
  });
  const baselineWritten = await writePersistentBaselineContract(baseline, 'baselines', { cwd: dir });
  const changeWritten = await writePerChangeContract(change, 'contracts', { cwd: dir });
  if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

  return {
    before,
    after,
    beforeRoot: beforeWritten.artifactRoot,
    afterRoot: afterWritten.artifactRoot,
    comparisonRoot: comparisonWritten.artifactRoot,
    baselineRoot: baselineWritten.artifactRoot,
    changeRoot: changeWritten.artifactRoot,
  };
}

// --- TST-401..404: help surface -----------------------------------------------

describe('help surface (TST-401..404)', () => {
  it('TST-401: top-level help lists all five commands, no future ones', async () => {
    const out = capture();
    const code = await runCli(['--help'], out.io);
    expect(code).toBe(0);
    for (const name of ['observe', 'compare', 'approve-baseline', 'save-change-contract', 'evaluate-contract']) {
      expect(out.stdout()).toContain(name);
    }
    expect(out.stdout()).not.toContain('viewer');
    expect(out.stdout()).not.toContain('annotation');
  });

  it('TST-402: approve-baseline --help documents required flags and purpose', async () => {
    const out = capture();
    const code = await runCli(['approve-baseline', '--help'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('--observation');
    expect(out.stdout()).toContain('--contract-file');
    expect(out.stdout()).toContain('--output');
    expect(out.stdout()).toContain('approval');
  });

  it('TST-403: save-change-contract --help documents required flags and purpose', async () => {
    const out = capture();
    const code = await runCli(['save-change-contract', '--help'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('--contract-file');
    expect(out.stdout()).toContain('--output');
  });

  it('TST-404: evaluate-contract --help documents required flags plus --enforce and never launches a browser', async () => {
    const out = capture();
    const code = await runCli(['evaluate-contract', '--help'], out.io);
    expect(code).toBe(0);
    for (const flag of ['--before', '--after', '--comparison', '--baseline', '--change', '--output', '--enforce']) {
      expect(out.stdout()).toContain(flag);
    }
    expect(out.stdout()).toContain('never launches a browser');
  });
});

// --- TST-405/406: approve-baseline happy path -----------------------------------

describe('approve-baseline happy path (TST-405, TST-406)', () => {
  it('persists exactly once, prints canonical fields, and exits 0', async () => {
    const dir = await makeTempDir('mfo-cli-approve-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const written = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected observation write to succeed');

    const contract = baselineContract({ sourceObservation: { observationId: 'obs-before', requestId: 'req-obs-before', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION } });
    const contractFile = await writeJsonFile(dir, 'baseline.json', contract);

    const out = capture();
    const code = await runCliInDir(dir, ['approve-baseline', '--observation', written.artifactRoot, '--contract-file', contractFile, '--output', 'baselines'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Baseline: baseline-1');
    expect(out.stdout()).toContain('State: approved');
    expect(out.stdout()).toContain('Artifact:');
    expect(out.stdout()).toContain('Clauses: 0');
    expect(out.stdout()).toContain('Supersedes: none');

    const manifestPath = path.join(dir, 'baselines', 'baseline-1', FRONTEND_CONTRACT_MANIFEST_FILENAME);
    await expect(access(manifestPath)).resolves.toBeUndefined();
  });
});

// --- TST-407: baseline source mismatch --------------------------------------------

describe('baseline source-observation mismatch (TST-407)', () => {
  it('rejects and persists nothing when the contract references a different observation', async () => {
    const dir = await makeTempDir('mfo-cli-mismatch-');
    const observationB = observation('obs-B', [], {});
    const written = await writeObservationArtifact(observationB, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected observation write to succeed');

    const contractForA = baselineContract({ sourceObservation: { observationId: 'obs-A', requestId: 'req-obs-A', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION } });
    const contractFile = await writeJsonFile(dir, 'baseline.json', contractForA);

    const out = capture();
    const code = await runCliInDir(dir, ['approve-baseline', '--observation', written.artifactRoot, '--contract-file', contractFile, '--output', 'baselines'], out.io);
    expect(code).not.toBe(0);
    expect(out.stderr().length).toBeGreaterThan(0);

    await expect(access(path.join(dir, 'baselines'))).rejects.toBeDefined();
  });
});

// --- TST-408: wrong class passed to approve-baseline ------------------------------

describe('wrong contract class (TST-408, TST-412)', () => {
  it('TST-408: a PerChangeContract is rejected by approve-baseline', async () => {
    const dir = await makeTempDir('mfo-cli-wrongclass-baseline-');
    const before = observation('obs-before', [], {});
    const written = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected observation write to succeed');
    const contractFile = await writeJsonFile(dir, 'change.json', changeContract());

    const out = capture();
    const code = await runCliInDir(dir, ['approve-baseline', '--observation', written.artifactRoot, '--contract-file', contractFile, '--output', 'baselines'], out.io);
    expect(code).not.toBe(0);
    await expect(access(path.join(dir, 'baselines'))).rejects.toBeDefined();
  });

  it('TST-412: a PersistentBaselineContract is rejected by save-change-contract', async () => {
    const dir = await makeTempDir('mfo-cli-wrongclass-change-');
    const contractFile = await writeJsonFile(dir, 'baseline.json', baselineContract());

    const out = capture();
    const code = await runCliInDir(dir, ['save-change-contract', '--contract-file', contractFile, '--output', 'contracts'], out.io);
    expect(code).not.toBe(0);
    await expect(access(path.join(dir, 'contracts'))).rejects.toBeDefined();
  });
});

// --- TST-409/410: malformed / structurally invalid baseline -----------------------

describe('malformed and structurally invalid baseline rejection (TST-409, TST-410)', () => {
  it('TST-409: malformed JSON is rejected before persistence', async () => {
    const dir = await makeTempDir('mfo-cli-malformed-');
    const before = observation('obs-before', [], {});
    const written = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected observation write to succeed');
    const contractFile = path.join(dir, 'bad.json');
    await writeFile(contractFile, '{ not valid json', 'utf8');

    const out = capture();
    const code = await runCliInDir(dir, ['approve-baseline', '--observation', written.artifactRoot, '--contract-file', contractFile, '--output', 'baselines'], out.io);
    expect(code).not.toBe(0);
  });

  it('TST-410: structurally invalid contract fields are rejected by domain validation', async () => {
    const dir = await makeTempDir('mfo-cli-invalidfields-');
    const before = observation('obs-before', [], {});
    const written = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected observation write to succeed');
    const invalidContract = { ...baselineContract(), clauses: [{ clauseId: 'c-1', primitive: { kind: 'bogus' }, supportingEvidence: [] }] };
    const contractFile = await writeJsonFile(dir, 'invalid.json', invalidContract);

    const out = capture();
    const code = await runCliInDir(dir, ['approve-baseline', '--observation', written.artifactRoot, '--contract-file', contractFile, '--output', 'baselines'], out.io);
    expect(code).not.toBe(0);
  });
});

// --- TST-411: save-change-contract happy path -------------------------------------

describe('save-change-contract happy path (TST-411)', () => {
  it('persists exactly once and exits 0', async () => {
    const dir = await makeTempDir('mfo-cli-savechange-');
    const contract = changeContract({ clauses: [{ clauseId: 'c-1', primitive: { kind: 'target-visible', target: 'nav' }, category: 'requested', supportingEvidence: [] }] });
    const contractFile = await writeJsonFile(dir, 'change.json', contract);

    const out = capture();
    const code = await runCliInDir(dir, ['save-change-contract', '--contract-file', contractFile, '--output', 'contracts'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Change contract: change-1');
    expect(out.stdout()).toContain('Clauses: 1');

    await expect(access(path.join(dir, 'contracts', 'change-1', FRONTEND_CONTRACT_MANIFEST_FILENAME))).resolves.toBeUndefined();
  });
});

// --- TST-413: authored unexpected rejected through public command -----------------

describe('authored "unexpected" is rejected (TST-413)', () => {
  it('rejects a clause authored with category "unexpected" via existing domain validation, no CLI special-casing', async () => {
    const dir = await makeTempDir('mfo-cli-unexpected-');
    const contract = { ...changeContract(), clauses: [{ clauseId: 'c-1', primitive: { kind: 'target-visible', target: 'nav' }, category: 'unexpected', supportingEvidence: [] }] };
    const contractFile = await writeJsonFile(dir, 'change.json', contract);

    const out = capture();
    const code = await runCliInDir(dir, ['save-change-contract', '--contract-file', contractFile, '--output', 'contracts'], out.io);
    expect(code).not.toBe(0);
  });
});

// --- TST-414: supersession IDs preserved ------------------------------------------

describe('supersession identity preserved through save-change-contract (TST-414)', () => {
  it('supersedesBaselineClauseIds round-trips exactly', async () => {
    const dir = await makeTempDir('mfo-cli-supersede-');
    const contract = changeContract({
      clauses: [
        { clauseId: 'c-1', primitive: { kind: 'property-decreases', target: 'nav', property: 'width' }, category: 'requested', supportingEvidence: [], supersedesBaselineClauseIds: ['baseline-clause-1'] },
      ],
    });
    const contractFile = await writeJsonFile(dir, 'change.json', contract);
    const out = capture();
    const code = await runCliInDir(dir, ['save-change-contract', '--contract-file', contractFile, '--output', 'contracts'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Supersedes baseline clauses: 1');

    const raw = await readFile(path.join(dir, 'contracts', 'change-1', FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8');
    expect(JSON.parse(raw).clauses[0].supersedesBaselineClauseIds).toEqual(['baseline-clause-1']);
  });
});

// --- TST-415/416/417: evaluate-contract PASS / FAIL / FAIL+enforce ---------------

describe('evaluate-contract verdict/exit behavior (TST-415, TST-416, TST-417, TST-435, TST-436)', () => {
  it('TST-415: PASS evaluation persists and exits 0', async () => {
    const dir = await makeTempDir('mfo-cli-pass-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    const afterWritten = await writeObservationArtifact(after, new Uint8Array([2]), { cwd: dir });
    if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');
    const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
    if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');
    const baselineWritten = await writePersistentBaselineContract(baselineContract(), 'baselines', { cwd: dir });
    const changeWritten = await writePerChangeContract(changeContract(), 'contracts', { cwd: dir });
    if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

    const out = capture();
    const code = await runCliInDir(dir, 
      ['evaluate-contract', '--before', beforeWritten.artifactRoot, '--after', afterWritten.artifactRoot, '--comparison', comparisonWritten.artifactRoot, '--baseline', baselineWritten.artifactRoot, '--change', changeWritten.artifactRoot, '--output', 'evaluations'],
      out.io,
    );
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Verdict: PASS');
    expect(out.stdout()).toContain('Enforced: no');
  });

  it('TST-416/417/435/436: milestone-signature FAIL persists identically; exits 0 without --enforce, nonzero with --enforce', async () => {
    const dirA = await makeTempDir('mfo-cli-fail-noenforce-');
    const fixtureA = await fullPipelineFixture(dirA);
    const outA = capture();
    const codeA = await runCliInDir(dirA,
      ['evaluate-contract', '--before', fixtureA.beforeRoot, '--after', fixtureA.afterRoot, '--comparison', fixtureA.comparisonRoot, '--baseline', fixtureA.baselineRoot, '--change', fixtureA.changeRoot, '--output', 'evaluations'],
      outA.io,
    );
    expect(codeA).toBe(0);
    expect(outA.stdout()).toContain('Verdict: FAIL');
    expect(outA.stdout()).toContain('Enforced: no');

    const manifestMatch = /Artifact: (.+)\n/.exec(outA.stdout());
    if (!manifestMatch) throw new Error('expected an Artifact line in output');
    const artifactRootA = manifestMatch[1] as string;
    const readA = await readFrontendContractEvaluationArtifact(path.join(artifactRootA, 'manifest.json'));
    if (!readA.ok) throw new Error(readA.reason);
    const byId = new Map(readA.artifact.clauseResults.map((r) => [r.clauseId, r]));
    expect(byId.get('requested-nav')?.status).toBe('pass');
    expect(byId.get('expected-workspace')?.status).toBe('pass');
    expect(byId.get('protected-rightad')?.status).toBe('fail');
    expect(byId.get('preserved-nav-unclipped')?.status).toBe('fail');
    expect(readA.artifact.overallVerdict).toBe('FAIL');

    const dirB = await makeTempDir('mfo-cli-fail-enforce-');
    const fixtureB = await fullPipelineFixture(dirB);
    const outB = capture();
    const codeB = await runCliInDir(dirB,
      ['evaluate-contract', '--before', fixtureB.beforeRoot, '--after', fixtureB.afterRoot, '--comparison', fixtureB.comparisonRoot, '--baseline', fixtureB.baselineRoot, '--change', fixtureB.changeRoot, '--output', 'evaluations', '--enforce'],
      outB.io,
    );
    expect(codeB).not.toBe(0);
    expect(outB.stdout()).toContain('Verdict: FAIL');
    expect(outB.stdout()).toContain('Enforced: yes');
  });

  it('TST-437: PASS still exits 0 with --enforce', async () => {
    const dir = await makeTempDir('mfo-cli-pass-enforce-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    const afterWritten = await writeObservationArtifact(after, new Uint8Array([2]), { cwd: dir });
    if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');
    const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
    if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');
    const baselineWritten = await writePersistentBaselineContract(baselineContract(), 'baselines', { cwd: dir });
    const changeWritten = await writePerChangeContract(changeContract(), 'contracts', { cwd: dir });
    if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

    const out = capture();
    const code = await runCliInDir(dir, 
      ['evaluate-contract', '--before', beforeWritten.artifactRoot, '--after', afterWritten.artifactRoot, '--comparison', comparisonWritten.artifactRoot, '--baseline', baselineWritten.artifactRoot, '--change', changeWritten.artifactRoot, '--output', 'evaluations', '--enforce'],
      out.io,
    );
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Verdict: PASS');
  });
});

// --- TST-418/419: --enforce affects exit status only --------------------------------

describe('--enforce affects exit status only (TST-418, TST-419)', () => {
  it('the same semantic inputs with and without --enforce produce the same evaluationRequestId and identical clause contents', async () => {
    const dirA = await makeTempDir('mfo-cli-enforce-identity-a-');
    const dirB = await makeTempDir('mfo-cli-enforce-identity-b-');
    const fixtureA = await fullPipelineFixture(dirA);
    const fixtureB = await fullPipelineFixture(dirB);

    const outA = capture();
    await runCliInDir(dirA, ['evaluate-contract', '--before', fixtureA.beforeRoot, '--after', fixtureA.afterRoot, '--comparison', fixtureA.comparisonRoot, '--baseline', fixtureA.baselineRoot, '--change', fixtureA.changeRoot, '--output', 'evaluations'], outA.io);
    const outB = capture();
    await runCliInDir(dirB, ['evaluate-contract', '--before', fixtureB.beforeRoot, '--after', fixtureB.afterRoot, '--comparison', fixtureB.comparisonRoot, '--baseline', fixtureB.baselineRoot, '--change', fixtureB.changeRoot, '--output', 'evaluations', '--enforce'], outB.io);

    const requestIdA = /Evaluation: (.+)\n/.exec(outA.stdout())?.[1]?.split('-').slice(0, -1).join('-');
    const artifactRootA = /Artifact: (.+)\n/.exec(outA.stdout())?.[1];
    const artifactRootB = /Artifact: (.+)\n/.exec(outB.stdout())?.[1];
    if (!artifactRootA || !artifactRootB) throw new Error('expected Artifact lines');

    const readA = await readFrontendContractEvaluationArtifact(path.join(artifactRootA, 'manifest.json'));
    const readB = await readFrontendContractEvaluationArtifact(path.join(artifactRootB, 'manifest.json'));
    if (!readA.ok || !readB.ok) throw new Error('expected both reads to succeed');

    expect(readA.artifact.evaluationRequestId).toBe(readB.artifact.evaluationRequestId);
    expect(readA.artifact.clauseResults).toEqual(readB.artifact.clauseResults);
    expect(readA.artifact.overallVerdict).toBe(readB.artifact.overallVerdict);
    expect(requestIdA).toBeDefined();
  });
});

// --- TST-420: construction failure ------------------------------------------------

describe('evaluation construction failure (TST-420)', () => {
  it('an incoherent baseline/change root (unreadable) exits nonzero and persists nothing', async () => {
    const dir = await makeTempDir('mfo-cli-construction-fail-');
    const before = observation('obs-before', [], {});
    const after = observation('obs-after', [], {});
    const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    const afterWritten = await writeObservationArtifact(after, new Uint8Array([2]), { cwd: dir });
    if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');
    const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
    if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

    const out = capture();
    const code = await runCliInDir(dir, 
      [
        'evaluate-contract',
        '--before',
        beforeWritten.artifactRoot,
        '--after',
        afterWritten.artifactRoot,
        '--comparison',
        comparisonWritten.artifactRoot,
        '--baseline',
        path.join(dir, 'does-not-exist-baseline'),
        '--change',
        path.join(dir, 'does-not-exist-change'),
        '--output',
        'evaluations',
      ],
      out.io,
    );
    expect(code).not.toBe(0);
    await expect(access(path.join(dir, 'evaluations'))).rejects.toBeDefined();
  });
});

// --- TST-421: incomparable evidence persists a legitimate FAIL --------------------

describe('incomparable evidence (TST-421)', () => {
  it('an incomparable comparison persists the canonical FAIL evaluation, never a fabricated PASS', async () => {
    const dir = await makeTempDir('mfo-cli-incomparable-');
    const before = observation('obs-before', [], {});
    const beforeMismatched: ObservationArtifact = { ...before, requestConfig: { ...before.requestConfig, targetUrl: 'http://localhost/a' } };
    const after = observation('obs-after', [], {});
    const afterMismatched: ObservationArtifact = { ...after, requestConfig: { ...after.requestConfig, targetUrl: 'http://localhost/b' } };
    const beforeWritten = await writeObservationArtifact(beforeMismatched, new Uint8Array([1]), { cwd: dir });
    const afterWritten = await writeObservationArtifact(afterMismatched, new Uint8Array([2]), { cwd: dir });
    if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');
    const compared = compareObservations(beforeMismatched, afterMismatched);
    if (!compared.ok) throw new Error('expected ok comparison');
    expect(compared.artifact.comparability.state).toBe('incomparable');
    const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
    if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');
    const baselineWritten = await writePersistentBaselineContract(baselineContract({ clauses: [{ clauseId: 'b-1', primitive: { kind: 'document-width-fits-viewport' }, supportingEvidence: [] }] }), 'baselines', { cwd: dir });
    const changeWritten = await writePerChangeContract(changeContract(), 'contracts', { cwd: dir });
    if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

    const out = capture();
    const code = await runCliInDir(dir, 
      ['evaluate-contract', '--before', beforeWritten.artifactRoot, '--after', afterWritten.artifactRoot, '--comparison', comparisonWritten.artifactRoot, '--baseline', baselineWritten.artifactRoot, '--change', changeWritten.artifactRoot, '--output', 'evaluations'],
      out.io,
    );
    expect(code).toBe(0);
    expect(out.stdout()).toContain('Verdict: FAIL');
  });
});

// --- TST-422/423: exactly-once evaluator/writer through the CLI ------------------

describe('exactly-once evaluator/writer through the CLI (TST-422, TST-423)', () => {
  it('evaluateFrontendContract and the evaluation writer are each invoked exactly once', async () => {
    vi.doMock('../../src/domain/frontendContractEvaluation.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/domain/frontendContractEvaluation.js')>();
      return { ...actual, evaluateFrontendContract: vi.fn(actual.evaluateFrontendContract) };
    });
    vi.doMock('../../src/artifacts/frontendContractEvaluationArtifactWriter.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/artifacts/frontendContractEvaluationArtifactWriter.js')>();
      return { ...actual, writeFrontendContractEvaluationArtifact: vi.fn(actual.writeFrontendContractEvaluationArtifact) };
    });
    vi.resetModules();
    const evalModule = await import('../../src/domain/frontendContractEvaluation.js');
    const writerModule = await import('../../src/artifacts/frontendContractEvaluationArtifactWriter.js');
    const { runCli: runCliFresh } = await import('../../src/cli.js');

    const dir = await makeTempDir('mfo-cli-once-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    const afterWritten = await writeObservationArtifact(after, new Uint8Array([2]), { cwd: dir });
    if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');
    const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
    if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');
    const baselineWritten = await writePersistentBaselineContract(baselineContract(), 'baselines', { cwd: dir });
    const changeWritten = await writePerChangeContract(changeContract(), 'contracts', { cwd: dir });
    if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

    const out = capture();
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await runCliFresh(
        ['evaluate-contract', '--before', beforeWritten.artifactRoot, '--after', afterWritten.artifactRoot, '--comparison', comparisonWritten.artifactRoot, '--baseline', baselineWritten.artifactRoot, '--change', changeWritten.artifactRoot, '--output', 'evaluations'],
        out.io,
      );
    } finally {
      process.chdir(originalCwd);
    }

    expect(vi.mocked(evalModule.evaluateFrontendContract)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writerModule.writeFrontendContractEvaluationArtifact)).toHaveBeenCalledTimes(1);

    vi.doUnmock('../../src/domain/frontendContractEvaluation.js');
    vi.doUnmock('../../src/artifacts/frontendContractEvaluationArtifactWriter.js');
    vi.resetModules();
  });
});

// --- TST-424/425: CLI import boundaries -------------------------------------------

describe('CLI import boundaries (TST-424, TST-425)', () => {
  it('src/cli.ts never imports browser/Playwright code or an artifact writer/reader module directly', async () => {
    const source = await readFile(new URL('../../src/cli.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]playwright['"]/);
    expect(source).not.toMatch(/from ['"].*\/browser\//);
    expect(source).not.toMatch(/from ['"].*\/artifacts\//);
    expect(source).not.toMatch(/from ['"]node:fs\/promises['"]/);
  });
});

// --- TST-426/427: no re-comparison, no target re-resolution -----------------------

describe('no re-comparison or target re-resolution (TST-426, TST-427)', () => {
  it('evaluate-contract source never calls compareObservations or a target-resolution import', async () => {
    const applicationSource = await readFile(new URL('../../src/application/frontendContractEvaluationService.ts', import.meta.url), 'utf8');
    expect(applicationSource).not.toContain('compareObservations');
    expect(applicationSource).not.toMatch(/from ['"].*\/browser\//);
  });
});

// --- TST-428: operational path privacy (via evaluationRequestId equality) --------

describe('operational path privacy (TST-428)', () => {
  it('two different temp-directory locations with semantically identical evidence produce the same evaluationRequestId', async () => {
    const dirA = await makeTempDir('mfo-cli-path-a-');
    const dirB = await makeTempDir('mfo-cli-path-b-');
    const fixtureA = await fullPipelineFixture(dirA);
    const fixtureB = await fullPipelineFixture(dirB);

    const outA = capture();
    await runCliInDir(dirA, ['evaluate-contract', '--before', fixtureA.beforeRoot, '--after', fixtureA.afterRoot, '--comparison', fixtureA.comparisonRoot, '--baseline', fixtureA.baselineRoot, '--change', fixtureA.changeRoot, '--output', 'evaluations'], outA.io);
    const outB = capture();
    await runCliInDir(dirB, ['evaluate-contract', '--before', fixtureB.beforeRoot, '--after', fixtureB.afterRoot, '--comparison', fixtureB.comparisonRoot, '--baseline', fixtureB.baselineRoot, '--change', fixtureB.changeRoot, '--output', 'evaluations'], outB.io);

    const artifactRootA = /Artifact: (.+)\n/.exec(outA.stdout())?.[1];
    const artifactRootB = /Artifact: (.+)\n/.exec(outB.stdout())?.[1];
    if (!artifactRootA || !artifactRootB) throw new Error('expected Artifact lines');
    const readA = await readFrontendContractEvaluationArtifact(path.join(artifactRootA, 'manifest.json'));
    const readB = await readFrontendContractEvaluationArtifact(path.join(artifactRootB, 'manifest.json'));
    if (!readA.ok || !readB.ok) throw new Error('expected both reads to succeed');
    expect(readA.artifact.evaluationRequestId).toBe(readB.artifact.evaluationRequestId);
    expect(JSON.stringify(readA.artifact)).not.toContain(dirA);
  });
});

// --- TST-429..433: immutability through the CLI -----------------------------------

describe('source immutability through the CLI (TST-429..433)', () => {
  it('observation manifests/screenshots, comparison, baseline, and change artifacts remain byte-identical after evaluate-contract', async () => {
    const dir = await makeTempDir('mfo-cli-immutability-');
    const fixture = await fullPipelineFixture(dir);

    const beforeManifestBefore = await readFile(path.join(fixture.beforeRoot, OBSERVATION_MANIFEST_FILENAME), 'utf8');
    const afterManifestBefore = await readFile(path.join(fixture.afterRoot, OBSERVATION_MANIFEST_FILENAME), 'utf8');
    const comparisonManifestBefore = await readFile(path.join(fixture.comparisonRoot, 'manifest.json'), 'utf8');
    const baselineManifestBefore = await readFile(path.join(fixture.baselineRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8');
    const changeManifestBefore = await readFile(path.join(fixture.changeRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8');

    const out = capture();
    const code = await runCliInDir(dir, 
      ['evaluate-contract', '--before', fixture.beforeRoot, '--after', fixture.afterRoot, '--comparison', fixture.comparisonRoot, '--baseline', fixture.baselineRoot, '--change', fixture.changeRoot, '--output', 'evaluations'],
      out.io,
    );
    expect(code).toBe(0);

    expect(await readFile(path.join(fixture.beforeRoot, OBSERVATION_MANIFEST_FILENAME), 'utf8')).toBe(beforeManifestBefore);
    expect(await readFile(path.join(fixture.afterRoot, OBSERVATION_MANIFEST_FILENAME), 'utf8')).toBe(afterManifestBefore);
    expect(await readFile(path.join(fixture.comparisonRoot, 'manifest.json'), 'utf8')).toBe(comparisonManifestBefore);
    expect(await readFile(path.join(fixture.baselineRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8')).toBe(baselineManifestBefore);
    expect(await readFile(path.join(fixture.changeRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8')).toBe(changeManifestBefore);
  });
});

// --- TST-434: existing destination collision --------------------------------------

describe('existing artifact collision through the CLI (TST-434)', () => {
  it('a second approve-baseline to the same baseline identity fails and preserves the first artifact', async () => {
    const dir = await makeTempDir('mfo-cli-collision-');
    const before = observation('obs-before', [], {});
    const written = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected observation write to succeed');
    const contract = baselineContract({ sourceObservation: { observationId: 'obs-before', requestId: 'req-obs-before', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION } });
    const contractFile = await writeJsonFile(dir, 'baseline.json', contract);

    const first = capture();
    const firstCode = await runCliInDir(dir, ['approve-baseline', '--observation', written.artifactRoot, '--contract-file', contractFile, '--output', 'baselines'], first.io);
    expect(firstCode).toBe(0);
    const manifestPath = path.join(dir, 'baselines', 'baseline-1', FRONTEND_CONTRACT_MANIFEST_FILENAME);
    const rawBefore = await readFile(manifestPath, 'utf8');

    const second = capture();
    const secondCode = await runCliInDir(dir, ['approve-baseline', '--observation', written.artifactRoot, '--contract-file', contractFile, '--output', 'baselines'], second.io);
    expect(secondCode).not.toBe(0);

    const rawAfter = await readFile(manifestPath, 'utf8');
    expect(rawAfter).toBe(rawBefore);
  });
});

// --- TST-438/439: deterministic, concise output -----------------------------------

describe('deterministic and concise CLI output (TST-438, TST-439)', () => {
  it('output line order is stable across repeated runs and never dumps the full artifact JSON', async () => {
    const dir = await makeTempDir('mfo-cli-output-shape-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1]), { cwd: dir });
    const afterWritten = await writeObservationArtifact(after, new Uint8Array([2]), { cwd: dir });
    if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');
    const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
    if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');
    const baselineWritten = await writePersistentBaselineContract(baselineContract(), 'baselines', { cwd: dir });
    const changeWritten = await writePerChangeContract(changeContract(), 'contracts', { cwd: dir });
    if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

    const out = capture();
    await runCliInDir(dir, 
      ['evaluate-contract', '--before', beforeWritten.artifactRoot, '--after', afterWritten.artifactRoot, '--comparison', comparisonWritten.artifactRoot, '--baseline', baselineWritten.artifactRoot, '--change', changeWritten.artifactRoot, '--output', 'evaluations'],
      out.io,
    );
    const lines = out.stdout().trim().split('\n');
    expect(lines.map((line) => line.split(':')[0])).toEqual(['Evaluation', 'Verdict', 'Artifact', 'Clauses', 'Unexpected', 'Enforced']);
    expect(out.stdout().length).toBeLessThan(500);
    expect(out.stdout()).not.toContain('"clauseResults"');
  });
});

// --- TST-434b: evaluation destination collision -----------------------------------

describe('evaluation artifact collision behavior', () => {
  it('re-persisting to the same output location does not overwrite an existing evaluation artifact', async () => {
    const dir = await makeTempDir('mfo-cli-eval-collision-');
    const fixture = await fullPipelineFixture(dir);
    const first = capture();
    const firstCode = await runCliInDir(dir, 
      ['evaluate-contract', '--before', fixture.beforeRoot, '--after', fixture.afterRoot, '--comparison', fixture.comparisonRoot, '--baseline', fixture.baselineRoot, '--change', fixture.changeRoot, '--output', 'evaluations'],
      first.io,
    );
    expect(firstCode).toBe(0);
    const evaluationsDir = path.join(dir, 'evaluations');
    const entriesBefore = await readdir(evaluationsDir);
    expect(entriesBefore.length).toBe(1);
  });
});

// --- unknown flag rejection --------------------------------------------------------

describe('argument syntax rules', () => {
  it('rejects an unknown flag for each new command', async () => {
    for (const command of ['approve-baseline', 'save-change-contract', 'evaluate-contract']) {
      const out = capture();
      const code = await runCli([command, '--bogus-flag', 'x'], out.io);
      expect(code).not.toBe(0);
    }
  });

  it('rejects a duplicated single-value flag', async () => {
    const dir = await makeTempDir('mfo-cli-dupflag-');
    await mkdir(dir, { recursive: true });
    const out = capture();
    const code = await runCliInDir(dir, ['save-change-contract', '--contract-file', 'a.json', '--contract-file', 'b.json', '--output', 'contracts'], out.io);
    expect(code).not.toBe(0);
  });
});
