import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { rm, readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { runCli } from '../../src/cli.js';
import { startFixtureServer, type FixtureServer, CONTRACT_FIXTURE_SELECTORS, type ContractFixtureCandidate } from '../fixtures/server.js';
import { CONTRACT_ARTIFACT_KIND, CONTRACT_SCHEMA_VERSION, type PersistentBaselineContract, type PerChangeContract } from '../../src/domain/frontendContracts.js';
import { isValidFrontendContractEvaluationArtifact, type FrontendContractEvaluationArtifact } from '../../src/domain/frontendContractEvaluationArtifact.js';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: { stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text) },
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

const TARGET_ARGS = [
  '--target',
  `navigation=${CONTRACT_FIXTURE_SELECTORS.navigation}`,
  '--target',
  `workspace=${CONTRACT_FIXTURE_SELECTORS.workspace}`,
  '--target',
  `rail=${CONTRACT_FIXTURE_SELECTORS.rail}`,
  '--target',
  `footer=${CONTRACT_FIXTURE_SELECTORS.footer}`,
];

describe('runCli - real end-to-end v0.5 frontend contract workflow (Batch 5)', () => {
  let fixtures: FixtureServer;
  const outputLocations: string[] = [];
  const tempFileDirs: string[] = [];

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  afterEach(async () => {
    fixtures.setContractFixtureCandidate('baseline');
    await Promise.all(outputLocations.splice(0).map((loc) => rm(path.resolve(process.cwd(), loc), { recursive: true, force: true })));
    await Promise.all(tempFileDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function freshOutputLocation(prefix: string): string {
    const loc = `${prefix}/mfo-cli-contract-test-${randomUUID()}`;
    outputLocations.push(loc);
    return loc;
  }

  async function writeContractFile(name: string, value: unknown): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-cli-contract-file-'));
    tempFileDirs.push(dir);
    const filePath = path.join(dir, name);
    await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
    return filePath;
  }

  async function observeCandidate(candidate: ContractFixtureCandidate): Promise<string> {
    fixtures.setContractFixtureCandidate(candidate);
    const out = capture();
    const code = await runCli(['observe', '--url', `${fixtures.baseUrl}/contract`, '--viewport', '1000x700', ...TARGET_ARGS, '--output', freshOutputLocation('observations')], out.io);
    if (code !== 0) throw new Error(`expected observe to succeed for candidate "${candidate}": ${out.stderr()}`);
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactLine?.slice('Artifact: '.length);
    if (!artifactRoot) throw new Error('expected an Artifact: line in observe output');
    return artifactRoot;
  }

  async function compareOnce(beforeRoot: string, afterRoot: string): Promise<{ code: number; artifactRoot: string }> {
    const out = capture();
    const outputLocation = freshOutputLocation('comparisons');
    const code = await runCli(['compare', '--before', beforeRoot, '--after', afterRoot, '--output', outputLocation], out.io);
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactLine?.slice('Artifact: '.length);
    if (code !== 0 || !artifactRoot) throw new Error(`expected compare to succeed: ${out.stdout()} ${out.stderr()}`);
    return { code, artifactRoot };
  }

  async function approveBaselineOnce(observationRoot: string, contract: PersistentBaselineContract): Promise<string> {
    const contractFile = await writeContractFile('baseline.json', contract);
    const out = capture();
    const code = await runCli(['approve-baseline', '--observation', observationRoot, '--contract-file', contractFile, '--output', freshOutputLocation('baselines')], out.io);
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactLine?.slice('Artifact: '.length);
    if (code !== 0 || !artifactRoot) throw new Error(`expected approve-baseline to succeed: ${out.stdout()} ${out.stderr()}`);
    return artifactRoot;
  }

  async function saveChangeContractOnce(contract: PerChangeContract): Promise<string> {
    const contractFile = await writeContractFile('change.json', contract);
    const out = capture();
    const code = await runCli(['save-change-contract', '--contract-file', contractFile, '--output', freshOutputLocation('contracts')], out.io);
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactLine?.slice('Artifact: '.length);
    if (code !== 0 || !artifactRoot) throw new Error(`expected save-change-contract to succeed: ${out.stdout()} ${out.stderr()}`);
    return artifactRoot;
  }

  async function evaluateContractOnce(
    beforeRoot: string,
    afterRoot: string,
    comparisonRoot: string,
    baselineRoot: string,
    changeRoot: string,
    extra: readonly string[] = [],
  ): Promise<{ code: number; out: ReturnType<typeof capture> }> {
    const out = capture();
    const outputLocation = freshOutputLocation('evaluations');
    const code = await runCli(
      ['evaluate-contract', '--before', beforeRoot, '--after', afterRoot, '--comparison', comparisonRoot, '--baseline', baselineRoot, '--change', changeRoot, '--output', outputLocation, ...extra],
      out.io,
    );
    return { code, out };
  }

  async function readEvaluationManifest(out: ReturnType<typeof capture>): Promise<FrontendContractEvaluationArtifact> {
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactLine?.slice('Artifact: '.length);
    if (!artifactRoot) throw new Error('expected an Artifact: line in evaluate-contract output');
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as FrontendContractEvaluationArtifact;
    expect(isValidFrontendContractEvaluationArtifact(manifest)).toEqual({ valid: true });
    return manifest;
  }

  function buildBaselineContract(observationId: string, requestId: string, producerVersion: string, observationSchemaVersion: string): PersistentBaselineContract {
    return {
      artifactKind: CONTRACT_ARTIFACT_KIND,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      contractClass: 'baseline',
      baselineId: `baseline-${randomUUID()}`,
      sourceObservation: { observationId, requestId, producer: { name: 'my-frontend-observer', version: producerVersion }, observationSchemaVersion: observationSchemaVersion as '1.2.0' },
      clauses: [
        { clauseId: 'baseline-nav-unclipped', primitive: { kind: 'target-not-clipped', target: 'navigation' }, supportingEvidence: [] },
        { clauseId: 'baseline-nav-no-overlap-workspace', primitive: { kind: 'targets-do-not-overlap', targetA: 'navigation', targetB: 'workspace' }, supportingEvidence: [] },
      ],
      provenance: { approvedAt: new Date().toISOString() },
    };
  }

  function buildChangeContract(): PerChangeContract {
    return {
      artifactKind: CONTRACT_ARTIFACT_KIND,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      contractClass: 'change',
      contractId: `change-${randomUUID()}`,
      contractRequestId: `change-request-${randomUUID()}`,
      activeBaselineIds: [],
      clauses: [
        { clauseId: 'requested-nav-shrink', primitive: { kind: 'property-decreases', target: 'navigation', property: 'width' }, category: 'requested', supportingEvidence: [] },
        {
          clauseId: 'expected-workspace-grow',
          primitive: { kind: 'property-increases', target: 'workspace', property: 'width' },
          category: 'expected-dependent',
          expectedDependentMode: 'required',
          supportingEvidence: [],
        },
        {
          clauseId: 'protected-rail-width',
          primitive: { kind: 'property-unchanged-within-tolerance', target: 'rail', property: 'width', tolerance: { kind: 'exact' } },
          category: 'protected',
          supportingEvidence: [],
        },
        { clauseId: 'preserved-nav-unclipped', primitive: { kind: 'target-not-clipped', target: 'navigation' }, category: 'preserved', supportingEvidence: [] },
      ],
    };
  }

  async function observationManifest(root: string): Promise<{ observationId: string; requestId: string; producer: { name: string; version: string }; schemaVersion: string }> {
    const raw = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    return raw;
  }

  it('TST-501/502/503/504/505/509/520: real successful contract workflow produces PASS through the public CLI, both with and without --enforce', async () => {
    const baselineObsRoot = await observeCandidate('baseline');
    const baselineObsManifest = await observationManifest(baselineObsRoot);

    const baselineRoot = await approveBaselineOnce(
      baselineObsRoot,
      buildBaselineContract(baselineObsManifest.observationId, baselineObsManifest.requestId, baselineObsManifest.producer.version, baselineObsManifest.schemaVersion),
    );
    const changeRoot = await saveChangeContractOnce(buildChangeContract());

    const successObsRoot = await observeCandidate('success');
    const { code: compareCode, artifactRoot: comparisonRoot } = await compareOnce(baselineObsRoot, successObsRoot);
    expect(compareCode).toBe(0);
    const comparisonManifest = JSON.parse(await readFile(path.join(comparisonRoot, 'manifest.json'), 'utf8'));
    expect(comparisonManifest.comparability.state).toBe('comparable');

    // TST-502/503: real requested/expected-dependent evidence, no hand-authored comparison record.
    const navDiff = comparisonManifest.differences.find((d: { subject: { type: string; target?: string } }) => d.subject.type === 'target' && d.subject.target === 'navigation');
    expect(navDiff).toMatchObject({ kind: 'resized' });
    const workspaceDiff = comparisonManifest.differences.find((d: { subject: { type: string; target?: string } }) => d.subject.type === 'target' && d.subject.target === 'workspace');
    expect(workspaceDiff).toMatchObject({ kind: 'resized' });

    const { code: evalCode, out: evalOut } = await evaluateContractOnce(baselineObsRoot, successObsRoot, comparisonRoot, baselineRoot, changeRoot);
    expect(evalCode).toBe(0);
    expect(evalOut.stdout()).toContain('Verdict: PASS');
    const evalManifest = await readEvaluationManifest(evalOut);
    expect(evalManifest.overallVerdict).toBe('PASS');
    expect(evalManifest.unexpectedChanges).toEqual([]);
    const byId = new Map(evalManifest.clauseResults.map((r) => [r.clauseId, r]));
    expect(byId.get('requested-nav-shrink')?.status).toBe('pass');
    expect(byId.get('expected-workspace-grow')?.status).toBe('pass');
    expect(byId.get('protected-rail-width')?.status).toBe('pass');
    expect(byId.get('preserved-nav-unclipped')?.status).toBe('pass');
    expect(byId.get('baseline-nav-unclipped')?.status).toBe('pass');
    expect(byId.get('baseline-nav-no-overlap-workspace')?.status).toBe('pass');

    // TST-520: a real PASS with --enforce still exits 0.
    const { code: enforceCode, out: enforceOut } = await evaluateContractOnce(baselineObsRoot, successObsRoot, comparisonRoot, baselineRoot, changeRoot, ['--enforce']);
    expect(enforceCode).toBe(0);
    expect(enforceOut.stdout()).toContain('Verdict: PASS');
    expect(enforceOut.stdout()).toContain('Enforced: yes');
  });

  it('TST-506/507/508/509/510/511/512/513/514/515/516: real milestone-signature failure, enforcement, and full immutability', async () => {
    const baselineObsRoot = await observeCandidate('baseline');
    const baselineObsManifest = await observationManifest(baselineObsRoot);
    const baselineRoot = await approveBaselineOnce(
      baselineObsRoot,
      buildBaselineContract(baselineObsManifest.observationId, baselineObsManifest.requestId, baselineObsManifest.producer.version, baselineObsManifest.schemaVersion),
    );
    const changeRoot = await saveChangeContractOnce(buildChangeContract());

    const regressionObsRoot = await observeCandidate('protected-regression');
    const { code: compareCode, artifactRoot: comparisonRoot } = await compareOnce(baselineObsRoot, regressionObsRoot);
    expect(compareCode).toBe(0);
    const comparisonManifestRaw = await readFile(path.join(comparisonRoot, 'manifest.json'), 'utf8');
    const comparisonManifest = JSON.parse(comparisonManifestRaw);
    expect(comparisonManifest.comparability.state).toBe('comparable'); // TST-518

    // TST-507: the preserved failure must be backed by the real canonical clipping derivation.
    const clipDiff = comparisonManifest.differences.find((d: { kind: string; subject: { type: string; target?: string } }) => d.kind === 'clipping-changed' && d.subject.type === 'target' && d.subject.target === 'navigation');
    expect(clipDiff).toMatchObject({ before: 'not-clipped', after: 'clipped' });
    // TST-508: the protected failure must be backed by a real captured geometry/comparison "resized" difference.
    const railDiff = comparisonManifest.differences.find((d: { kind: string; subject: { type: string; target?: string } }) => d.kind === 'resized' && d.subject.type === 'target' && d.subject.target === 'rail');
    expect(railDiff).toBeDefined();

    // Byte snapshots before evaluation (TST-512..515).
    const beforeManifestBefore = await readFile(path.join(baselineObsRoot, 'manifest.json'), 'utf8');
    const beforeScreenshotBefore = await readFile(path.join(baselineObsRoot, 'screenshot.png'));
    const afterManifestBefore = await readFile(path.join(regressionObsRoot, 'manifest.json'), 'utf8');
    const afterScreenshotBefore = await readFile(path.join(regressionObsRoot, 'screenshot.png'));
    const baselineArtifactManifestBefore = await readFile(path.join(baselineRoot, 'manifest.json'), 'utf8');
    const changeArtifactManifestBefore = await readFile(path.join(changeRoot, 'manifest.json'), 'utf8');

    // --- without --enforce: persists FAIL, exits 0 (TST-506, TST-509) ---
    const { code: noEnforceCode, out: noEnforceOut } = await evaluateContractOnce(baselineObsRoot, regressionObsRoot, comparisonRoot, baselineRoot, changeRoot);
    expect(noEnforceCode).toBe(0);
    expect(noEnforceOut.stdout()).toContain('Verdict: FAIL');
    const noEnforceManifest = await readEvaluationManifest(noEnforceOut);
    expect(noEnforceManifest.overallVerdict).toBe('FAIL');
    const byIdNoEnforce = new Map(noEnforceManifest.clauseResults.map((r) => [r.clauseId, r]));
    expect(byIdNoEnforce.get('requested-nav-shrink')?.status).toBe('pass');
    expect(byIdNoEnforce.get('expected-workspace-grow')?.status).toBe('pass');
    expect(byIdNoEnforce.get('protected-rail-width')?.status).toBe('fail');
    expect(byIdNoEnforce.get('preserved-nav-unclipped')?.status).toBe('fail');
    expect(byIdNoEnforce.get('baseline-nav-unclipped')?.status).toBe('fail');

    // Source immutability after the first evaluation (TST-512..515).
    expect(await readFile(path.join(baselineObsRoot, 'manifest.json'), 'utf8')).toBe(beforeManifestBefore);
    expect(await readFile(path.join(baselineObsRoot, 'screenshot.png'))).toEqual(beforeScreenshotBefore);
    expect(await readFile(path.join(regressionObsRoot, 'manifest.json'), 'utf8')).toBe(afterManifestBefore);
    expect(await readFile(path.join(regressionObsRoot, 'screenshot.png'))).toEqual(afterScreenshotBefore);
    expect(await readFile(path.join(comparisonRoot, 'manifest.json'), 'utf8')).toBe(comparisonManifestRaw);
    expect(await readFile(path.join(baselineRoot, 'manifest.json'), 'utf8')).toBe(baselineArtifactManifestBefore);
    expect(await readFile(path.join(changeRoot, 'manifest.json'), 'utf8')).toBe(changeArtifactManifestBefore);

    // TST-516: evaluation artifact directory contains only manifest.json, no copied screenshot.
    const { readdir } = await import('node:fs/promises');
    const noEnforceArtifactLine = noEnforceOut.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const noEnforceArtifactRoot = noEnforceArtifactLine?.slice('Artifact: '.length);
    if (!noEnforceArtifactRoot) throw new Error('expected an Artifact: line');
    expect(await readdir(noEnforceArtifactRoot)).toEqual(['manifest.json']);

    // --- with --enforce: same semantic FAIL, nonzero exit (TST-510, TST-511) ---
    const { code: enforceCode, out: enforceOut } = await evaluateContractOnce(baselineObsRoot, regressionObsRoot, comparisonRoot, baselineRoot, changeRoot, ['--enforce']);
    expect(enforceCode).not.toBe(0);
    expect(enforceOut.stdout()).toContain('Verdict: FAIL');
    expect(enforceOut.stdout()).toContain('Enforced: yes');
    const enforceManifest = await readEvaluationManifest(enforceOut);
    expect(enforceManifest.evaluationRequestId).toBe(noEnforceManifest.evaluationRequestId); // TST-511
    expect(enforceManifest.clauseResults).toEqual(noEnforceManifest.clauseResults);
    expect(enforceManifest.overallVerdict).toBe('FAIL');

    // Source remains immutable after the second (enforced) evaluation too.
    expect(await readFile(path.join(baselineObsRoot, 'manifest.json'), 'utf8')).toBe(beforeManifestBefore);
    expect(await readFile(path.join(regressionObsRoot, 'manifest.json'), 'utf8')).toBe(afterManifestBefore);
    expect(await readFile(path.join(comparisonRoot, 'manifest.json'), 'utf8')).toBe(comparisonManifestRaw);
    expect(await readFile(path.join(baselineRoot, 'manifest.json'), 'utf8')).toBe(baselineArtifactManifestBefore);
    expect(await readFile(path.join(changeRoot, 'manifest.json'), 'utf8')).toBe(changeArtifactManifestBefore);

    // TST-517 (partial): the fixture route itself was never touched by observer/CLI code - only this
    // test's own setContractFixtureCandidate calls change served content; the assertions above (the
    // fixture-derived observation manifests) prove no observer-side mutation occurred.
  });

  it('TST-519: a real unrelated rendered change becomes unexpected and forces overall FAIL', async () => {
    const baselineObsRoot = await observeCandidate('baseline');
    const baselineObsManifest = await observationManifest(baselineObsRoot);
    const baselineRoot = await approveBaselineOnce(
      baselineObsRoot,
      buildBaselineContract(baselineObsManifest.observationId, baselineObsManifest.requestId, baselineObsManifest.producer.version, baselineObsManifest.schemaVersion),
    );
    const changeRoot = await saveChangeContractOnce(buildChangeContract());

    const unexpectedObsRoot = await observeCandidate('unexpected-change');
    const { code: compareCode, artifactRoot: comparisonRoot } = await compareOnce(baselineObsRoot, unexpectedObsRoot);
    expect(compareCode).toBe(0);
    const comparisonManifest = JSON.parse(await readFile(path.join(comparisonRoot, 'manifest.json'), 'utf8'));
    expect(comparisonManifest.comparability.state).toBe('comparable');
    const footerDiff = comparisonManifest.differences.find((d: { subject: { type: string; target?: string } }) => d.subject.type === 'target' && d.subject.target === 'footer');
    expect(footerDiff).toMatchObject({ kind: 'resized' });

    const { code, out } = await evaluateContractOnce(baselineObsRoot, unexpectedObsRoot, comparisonRoot, baselineRoot, changeRoot);
    expect(code).toBe(0);
    const manifest = await readEvaluationManifest(out);
    const byId = new Map(manifest.clauseResults.map((r) => [r.clauseId, r]));
    expect(byId.get('requested-nav-shrink')?.status).toBe('pass');
    expect(byId.get('expected-workspace-grow')?.status).toBe('pass');
    expect(byId.get('protected-rail-width')?.status).toBe('pass');
    expect(byId.get('preserved-nav-unclipped')?.status).toBe('pass');
    expect(manifest.unexpectedChanges.length).toBeGreaterThanOrEqual(1);
    expect(manifest.unexpectedChanges.some((u) => u.subject.type === 'target' && u.subject.target === 'footer')).toBe(true);
    expect(manifest.overallVerdict).toBe('FAIL');
  });

  it('TST-407-equivalent for real evidence: a baseline whose sourceObservation does not match the supplied observation is rejected', async () => {
    const baselineObsRoot = await observeCandidate('baseline');
    const otherObsRoot = await observeCandidate('success');
    const otherObsManifest = await observationManifest(otherObsRoot);
    const mismatchedContract = buildBaselineContract(otherObsManifest.observationId, otherObsManifest.requestId, otherObsManifest.producer.version, otherObsManifest.schemaVersion);
    const contractFile = await writeContractFile('mismatched-baseline.json', mismatchedContract);
    const out = capture();
    const code = await runCli(['approve-baseline', '--observation', baselineObsRoot, '--contract-file', contractFile, '--output', freshOutputLocation('baselines')], out.io);
    expect(code).not.toBe(0);
  });
});
