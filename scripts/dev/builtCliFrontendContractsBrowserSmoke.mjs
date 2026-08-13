#!/usr/bin/env node
// v0.5 Batch 5: proves the actual *built* dist/cli.js's complete v0.5 public
// contract workflow (observe -> approve-baseline -> save-change-contract ->
// observe -> compare -> evaluate-contract) against a real, disposable local
// HTTP fixture and real Chromium - not the imported runCli() function under
// vitest, and not hand-constructed artifacts (see the companion
// Chromium-free scripts/dev/builtCliFrontendContractsSmoke.mjs, which proves
// only the CLI/persistence/evaluation surface). This is dev/readiness
// infrastructure only: never imported by production code and not part of
// the npm package. Requires `npm run build` and an installed Chromium
// (`npx playwright install chromium`).
//
// Usage: node scripts/dev/builtCliFrontendContractsBrowserSmoke.mjs

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = path.join(repoRoot, 'dist', 'cli.js');

function fail(message) {
  console.error(`SMOKE FAILURE: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function artifactRootFrom(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('Artifact: '));
  return line ? line.slice('Artifact: '.length).trim() : undefined;
}

// Same deterministic geometry as tests/fixtures/server.ts's `/contract`
// route (CONTRACT_FIXTURE_SELECTORS/renderContractFixtureHtml) - duplicated
// here rather than imported, matching this repository's established
// scripts/dev/*.mjs convention of an inline disposable HTTP fixture (see
// builtCliCompareSmoke.mjs#renderHtml).
const NAV_WIDTH = { baseline: 200, success: 195, 'protected-regression': 140 };
const WORKSPACE_WIDTH = { baseline: 500, success: 560, 'protected-regression': 560 };
const RAIL_WIDTH = { baseline: 150, success: 150, 'protected-regression': 130 };

function renderHtml(candidate) {
  const navWidth = NAV_WIDTH[candidate];
  const workspaceWidth = WORKSPACE_WIDTH[candidate];
  const railWidth = RAIL_WIDTH[candidate];
  return (
    '<!doctype html><html><head><style>' +
    'html,body{margin:0;padding:0}' +
    `#cp-nav{position:absolute;top:0;left:0;width:${navWidth}px;height:80px;overflow:hidden;}` +
    '#cp-nav-inner{width:190px;height:20px;}' +
    `#cp-workspace{position:absolute;top:0;left:210px;width:${workspaceWidth}px;height:80px;}` +
    `#cp-rail{position:absolute;top:0;left:800px;width:${railWidth}px;height:80px;}` +
    '</style></head><body>' +
    '<div id="cp-nav"><div id="cp-nav-inner">Nav</div></div>' +
    '<div id="cp-workspace">Workspace</div>' +
    '<div id="cp-rail">Rail</div>' +
    '</body></html>'
  );
}

async function main() {
  await access(cliPath).catch(() => fail(`built CLI not found at ${cliPath} - run "npm run build" first`));

  let candidate = 'baseline';
  const server = createServer((req, res) => {
    if (req.url === '/contract') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(renderHtml(candidate));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const targetUrl = `http://127.0.0.1:${port}/contract`;
  const targetArgs = ['--target', 'navigation=#cp-nav', '--target', 'workspace=#cp-workspace', '--target', 'rail=#cp-rail'];

  const workDir = await mkdtemp(path.join(tmpdir(), 'mfo-dev-cli-contracts-browser-smoke-'));
  try {
    // --- 1. observe baseline via the real built CLI + real Chromium ---
    candidate = 'baseline';
    const baselineObsSubdir = 'observations-baseline';
    await mkdir(path.join(workDir, baselineObsSubdir), { recursive: true });
    const baselineObsRes = await run(process.execPath, [cliPath, 'observe', '--url', targetUrl, '--viewport', '1000x700', ...targetArgs, '--output', baselineObsSubdir], { cwd: workDir });
    if (baselineObsRes.code !== 0) fail(`observe (baseline) failed (exit ${baselineObsRes.code}):\n${baselineObsRes.stdout}\n${baselineObsRes.stderr}`);
    const baselineObsRoot = artifactRootFrom(baselineObsRes.stdout);
    if (!baselineObsRoot) fail('observe (baseline) output missing an Artifact: line');
    console.log('observe (baseline, real Chromium): PASS');

    const beforeManifestRaw = await readFile(path.join(baselineObsRoot, 'manifest.json'), 'utf8');
    const beforeManifest = JSON.parse(beforeManifestRaw);
    const beforeScreenshotRaw = await readFile(path.join(baselineObsRoot, 'screenshot.png'));

    // --- 2. approve-baseline via the real built CLI ---
    const baselineContract = {
      artifactKind: 'my-frontend-observer/frontend-contract',
      schemaVersion: '1.0.0',
      contractClass: 'baseline',
      baselineId: 'baseline-1',
      sourceObservation: { observationId: beforeManifest.observationId, requestId: beforeManifest.requestId, producer: beforeManifest.producer, observationSchemaVersion: beforeManifest.schemaVersion },
      clauses: [{ clauseId: 'baseline-nav-unclipped', primitive: { kind: 'target-not-clipped', target: 'navigation' }, supportingEvidence: [] }],
      provenance: { approvedAt: new Date(0).toISOString() },
    };
    const baselineFile = path.join(workDir, 'baseline.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(baselineFile, JSON.stringify(baselineContract, null, 2), 'utf8'));
    const approveRes = await run(process.execPath, [cliPath, 'approve-baseline', '--observation', baselineObsRoot, '--contract-file', baselineFile, '--output', 'baselines'], { cwd: workDir });
    if (approveRes.code !== 0) fail(`approve-baseline failed (exit ${approveRes.code}):\n${approveRes.stdout}\n${approveRes.stderr}`);
    const baselineRoot = artifactRootFrom(approveRes.stdout);
    if (!baselineRoot) fail('approve-baseline output missing an Artifact: line');
    console.log('approve-baseline (real observation): PASS');

    // --- 3. save-change-contract via the real built CLI ---
    const changeContract = {
      artifactKind: 'my-frontend-observer/frontend-contract',
      schemaVersion: '1.0.0',
      contractClass: 'change',
      contractId: 'change-1',
      contractRequestId: 'change-request-1',
      activeBaselineIds: ['baseline-1'],
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
    const changeFile = path.join(workDir, 'change.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(changeFile, JSON.stringify(changeContract, null, 2), 'utf8'));
    const saveRes = await run(process.execPath, [cliPath, 'save-change-contract', '--contract-file', changeFile, '--output', 'contracts'], { cwd: workDir });
    if (saveRes.code !== 0) fail(`save-change-contract failed (exit ${saveRes.code}):\n${saveRes.stdout}\n${saveRes.stderr}`);
    const changeRoot = artifactRootFrom(saveRes.stdout);
    if (!changeRoot) fail('save-change-contract output missing an Artifact: line');
    console.log('save-change-contract: PASS');

    // --- 4. observe successful candidate via real Chromium, compare, evaluate: expect PASS ---
    candidate = 'success';
    const successObsSubdir = 'observations-success';
    await mkdir(path.join(workDir, successObsSubdir), { recursive: true });
    const successObsRes = await run(process.execPath, [cliPath, 'observe', '--url', targetUrl, '--viewport', '1000x700', ...targetArgs, '--output', successObsSubdir], { cwd: workDir });
    if (successObsRes.code !== 0) fail(`observe (success) failed (exit ${successObsRes.code}):\n${successObsRes.stdout}\n${successObsRes.stderr}`);
    const successObsRoot = artifactRootFrom(successObsRes.stdout);
    if (!successObsRoot) fail('observe (success) output missing an Artifact: line');
    console.log('observe (success candidate, real Chromium): PASS');

    const compareSuccessRes = await run(process.execPath, [cliPath, 'compare', '--before', baselineObsRoot, '--after', successObsRoot, '--output', 'comparisons-success'], { cwd: workDir });
    if (compareSuccessRes.code !== 0) fail(`compare (success) failed (exit ${compareSuccessRes.code}):\n${compareSuccessRes.stdout}\n${compareSuccessRes.stderr}`);
    const comparisonSuccessRoot = artifactRootFrom(compareSuccessRes.stdout);
    if (!comparisonSuccessRoot) fail('compare (success) output missing an Artifact: line');
    const comparisonSuccessManifest = JSON.parse(await readFile(path.join(comparisonSuccessRoot, 'manifest.json'), 'utf8'));
    if (comparisonSuccessManifest.comparability.state !== 'comparable') fail(`expected comparable, got ${comparisonSuccessManifest.comparability.state}`);
    console.log('compare (baseline vs success, real evidence): PASS');

    const evalPassRes = await run(
      process.execPath,
      [cliPath, 'evaluate-contract', '--before', baselineObsRoot, '--after', successObsRoot, '--comparison', comparisonSuccessRoot, '--baseline', baselineRoot, '--change', changeRoot, '--output', 'evaluations-success'],
      { cwd: workDir },
    );
    if (evalPassRes.code !== 0) fail(`evaluate-contract (success) expected exit 0, got ${evalPassRes.code}:\n${evalPassRes.stdout}\n${evalPassRes.stderr}`);
    if (!evalPassRes.stdout.includes('Verdict: PASS')) fail(`expected "Verdict: PASS":\n${evalPassRes.stdout}`);
    console.log('evaluate-contract (real successful candidate -> PASS): PASS');

    // --- 5. observe regression candidate via real Chromium, compare, evaluate: expect the milestone-signature FAIL ---
    candidate = 'protected-regression';
    const regressionObsSubdir = 'observations-regression';
    await mkdir(path.join(workDir, regressionObsSubdir), { recursive: true });
    const regressionObsRes = await run(process.execPath, [cliPath, 'observe', '--url', targetUrl, '--viewport', '1000x700', ...targetArgs, '--output', regressionObsSubdir], { cwd: workDir });
    if (regressionObsRes.code !== 0) fail(`observe (regression) failed (exit ${regressionObsRes.code}):\n${regressionObsRes.stdout}\n${regressionObsRes.stderr}`);
    const regressionObsRoot = artifactRootFrom(regressionObsRes.stdout);
    if (!regressionObsRoot) fail('observe (regression) output missing an Artifact: line');
    console.log('observe (regression candidate, real Chromium): PASS');

    const compareRegressionRes = await run(process.execPath, [cliPath, 'compare', '--before', baselineObsRoot, '--after', regressionObsRoot, '--output', 'comparisons-regression'], { cwd: workDir });
    if (compareRegressionRes.code !== 0) fail(`compare (regression) failed (exit ${compareRegressionRes.code}):\n${compareRegressionRes.stdout}\n${compareRegressionRes.stderr}`);
    const comparisonRegressionRoot = artifactRootFrom(compareRegressionRes.stdout);
    if (!comparisonRegressionRoot) fail('compare (regression) output missing an Artifact: line');
    const comparisonRegressionManifestRaw = await readFile(path.join(comparisonRegressionRoot, 'manifest.json'), 'utf8');
    const comparisonRegressionManifest = JSON.parse(comparisonRegressionManifestRaw);
    if (comparisonRegressionManifest.comparability.state !== 'comparable') fail(`expected comparable, got ${comparisonRegressionManifest.comparability.state}`);
    const clipDiff = comparisonRegressionManifest.differences.find((d) => d.kind === 'clipping-changed' && d.subject.type === 'target' && d.subject.target === 'navigation');
    if (!clipDiff || clipDiff.before !== 'not-clipped' || clipDiff.after !== 'clipped') fail('expected a real navigation clipping-changed difference (not-clipped -> clipped)');
    console.log('compare (baseline vs regression, real clipping evidence): PASS');

    const beforeManifestSnapshot = await readFile(path.join(baselineObsRoot, 'manifest.json'), 'utf8');
    const afterManifestSnapshot = await readFile(path.join(regressionObsRoot, 'manifest.json'), 'utf8');

    const evalFailRes = await run(
      process.execPath,
      [
        cliPath,
        'evaluate-contract',
        '--before',
        baselineObsRoot,
        '--after',
        regressionObsRoot,
        '--comparison',
        comparisonRegressionRoot,
        '--baseline',
        baselineRoot,
        '--change',
        changeRoot,
        '--output',
        'evaluations-regression-noenforce',
      ],
      { cwd: workDir },
    );
    if (evalFailRes.code !== 0) fail(`evaluate-contract (regression, no --enforce) expected exit 0, got ${evalFailRes.code}:\n${evalFailRes.stdout}\n${evalFailRes.stderr}`);
    if (!evalFailRes.stdout.includes('Verdict: FAIL')) fail(`expected "Verdict: FAIL":\n${evalFailRes.stdout}`);
    const evalFailRoot = artifactRootFrom(evalFailRes.stdout);
    if (!evalFailRoot) fail('evaluate-contract (regression, no --enforce) output missing an Artifact: line');
    const evalFailManifest = JSON.parse(await readFile(path.join(evalFailRoot, 'manifest.json'), 'utf8'));
    const byId = new Map(evalFailManifest.clauseResults.map((r) => [r.clauseId, r]));
    if (byId.get('requested-nav-shrink')?.status !== 'pass') fail('expected requested-nav-shrink = pass');
    if (byId.get('expected-workspace-grow')?.status !== 'pass') fail('expected expected-workspace-grow = pass');
    if (byId.get('protected-rail-width')?.status !== 'fail') fail('expected protected-rail-width = fail');
    if (byId.get('preserved-nav-unclipped')?.status !== 'fail') fail('expected preserved-nav-unclipped = fail');
    if (evalFailManifest.overallVerdict !== 'FAIL') fail('expected overall FAIL');
    console.log('evaluate-contract (real milestone-signature FAIL, no --enforce, exit 0): PASS');

    const evalEntries = await readdir(evalFailRoot);
    if (evalEntries.length !== 1 || evalEntries[0] !== 'manifest.json') fail(`expected evaluation directory to contain only manifest.json, got: ${evalEntries.join(', ')}`);
    console.log('no screenshot copied into evaluation artifact: PASS');

    // --- 6. same semantic evidence, with --enforce: nonzero exit, identical evaluationRequestId ---
    const evalEnforceRes = await run(
      process.execPath,
      [
        cliPath,
        'evaluate-contract',
        '--before',
        baselineObsRoot,
        '--after',
        regressionObsRoot,
        '--comparison',
        comparisonRegressionRoot,
        '--baseline',
        baselineRoot,
        '--change',
        changeRoot,
        '--output',
        'evaluations-regression-enforce',
        '--enforce',
      ],
      { cwd: workDir },
    );
    if (evalEnforceRes.code === 0) fail('evaluate-contract (regression, --enforce) was expected to exit nonzero');
    if (!evalEnforceRes.stdout.includes('Verdict: FAIL')) fail(`expected "Verdict: FAIL":\n${evalEnforceRes.stdout}`);
    const evalEnforceRoot = artifactRootFrom(evalEnforceRes.stdout);
    if (!evalEnforceRoot) fail('evaluate-contract (regression, --enforce) output missing an Artifact: line');
    const evalEnforceManifest = JSON.parse(await readFile(path.join(evalEnforceRoot, 'manifest.json'), 'utf8'));
    if (evalEnforceManifest.evaluationRequestId !== evalFailManifest.evaluationRequestId) fail('--enforce must not change the deterministic evaluationRequestId');
    if (JSON.stringify(evalEnforceManifest.clauseResults) !== JSON.stringify(evalFailManifest.clauseResults)) fail('--enforce must not change clause result contents');
    console.log('evaluate-contract (same milestone-signature FAIL, --enforce, nonzero exit): PASS');

    // --- 7. immutability + path privacy across the whole real-browser workflow ---
    if ((await readFile(path.join(baselineObsRoot, 'manifest.json'), 'utf8')) !== beforeManifestRaw) fail('baseline observation manifest changed');
    if (!(await readFile(path.join(baselineObsRoot, 'screenshot.png'))).equals(beforeScreenshotRaw)) fail('baseline observation screenshot changed');
    if ((await readFile(path.join(baselineObsRoot, 'manifest.json'), 'utf8')) !== beforeManifestSnapshot) fail('baseline observation manifest changed after evaluation');
    if ((await readFile(path.join(regressionObsRoot, 'manifest.json'), 'utf8')) !== afterManifestSnapshot) fail('regression observation manifest changed after evaluation');
    if ((await readFile(path.join(comparisonRegressionRoot, 'manifest.json'), 'utf8')) !== comparisonRegressionManifestRaw) fail('comparison manifest changed after evaluation');
    console.log('source observation/comparison immutability across real workflow: PASS');

    for (const manifest of [evalFailManifest, evalEnforceManifest]) {
      const serialized = JSON.stringify(manifest);
      for (const leaked of [workDir, baselineObsRoot, regressionObsRoot, comparisonRegressionRoot, baselineRoot, changeRoot]) {
        if (serialized.includes(leaked)) fail(`operational filesystem path leaked into evaluation manifest: ${leaked}`);
      }
    }
    console.log('operational path privacy: PASS');

    console.log('DEV CLI FRONTEND CONTRACTS BROWSER SMOKE PASS');
  } finally {
    server.close();
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = process.exitCode || 1;
});
