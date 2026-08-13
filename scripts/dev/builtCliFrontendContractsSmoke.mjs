#!/usr/bin/env node
// v0.5 Batch 4: proves the actual *built* dist/cli.js - not the imported
// runCli() function under vitest - recognizes "approve-baseline",
// "save-change-contract", and "evaluate-contract", and that the full
// persisted contract/evaluation pipeline works end to end through the real
// public command surface. No Chromium is required: this script hand-writes
// deterministic, schema-valid observation manifests directly (preserving the
// public observation/comparison/contract artifact contracts) and lets the
// real built CLI's "compare"/"approve-baseline"/"save-change-contract"/
// "evaluate-contract" commands do everything else. Dev/readiness
// infrastructure only: never imported by production code and not part of
// the npm package. Requires `npm run build` to have already run.
//
// Usage: node scripts/dev/builtCliFrontendContractsSmoke.mjs

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, readdir } from 'node:fs/promises';
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

function rect(x, y, width, height) {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function matchedTarget(geometry, style, layout) {
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

function observationArtifact(observationId, names, evidence) {
  return {
    artifactKind: 'my-frontend-observer/observation',
    schemaVersion: '1.2.0',
    observationId,
    requestId: `req-${observationId}`,
    producer: { name: 'my-frontend-observer', version: '0.4.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '139.0.0' } },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport: { width: 1200, height: 800 },
      targets: names.map((name) => ({ name, locators: [{ kind: 'css', selector: `#${name}` }] })),
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'dev-smoke-fixture' },
    pageEvidence: {},
    targetEvidence: evidence,
    screenshot: { state: 'available', source: 'browser', value: { path: 'screenshot.png' } },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
}

async function writeObservationDir(root, subdir, observationId, artifact) {
  const dir = path.join(root, subdir, observationId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(artifact, null, 2), 'utf8');
  await writeFile(path.join(dir, 'screenshot.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  return dir;
}

async function main() {
  await access(cliPath).catch(() => fail(`built CLI not found at ${cliPath} - run "npm run build" first`));

  const workDir = await mkdtemp(path.join(tmpdir(), 'mfo-dev-cli-contracts-smoke-'));
  try {
    // --- help smoke ---
    for (const args of [['--help'], ['approve-baseline', '--help'], ['save-change-contract', '--help'], ['evaluate-contract', '--help']]) {
      const res = await run(process.execPath, [cliPath, ...args]);
      if (res.code !== 0) fail(`"${args.join(' ')}" failed (exit ${res.code}):\n${res.stdout}\n${res.stderr}`);
    }
    console.log('help smoke: PASS');

    // --- construct before/after observation fixtures directly (no Chromium) ---
    const before = observationArtifact('obs-before', ['navigation', 'workspace', 'rightAd'], {
      navigation: matchedTarget(rect(0, 0, 190, 600)),
      workspace: matchedTarget(rect(200, 0, 600, 600)),
      rightAd: matchedTarget(rect(900, 0, 200, 600)),
    });
    const after = observationArtifact('obs-after', ['navigation', 'workspace', 'rightAd'], {
      navigation: matchedTarget(
        rect(0, 0, 140, 600),
        { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' },
        { scrollWidth: 160, scrollHeight: 600, clientWidth: 140, clientHeight: 600, scrollTop: 0, scrollLeft: 0 },
      ),
      workspace: matchedTarget(rect(200, 0, 650, 600)),
      rightAd: matchedTarget(rect(900, 0, 180, 600)),
    });
    const beforeRoot = await writeObservationDir(workDir, 'observations', 'obs-before', before);
    const afterRoot = await writeObservationDir(workDir, 'observations', 'obs-after', after);

    // --- compare via the real built CLI (no browser) ---
    const compareRes = await run(process.execPath, [cliPath, 'compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], { cwd: workDir });
    if (compareRes.code !== 0) fail(`compare failed (exit ${compareRes.code}):\n${compareRes.stdout}\n${compareRes.stderr}`);
    const comparisonRoot = artifactRootFrom(compareRes.stdout);
    if (!comparisonRoot) fail('compare output missing an Artifact: line');
    console.log('compare: PASS');

    // --- approve-baseline ---
    const baselineContract = {
      artifactKind: 'my-frontend-observer/frontend-contract',
      schemaVersion: '1.0.0',
      contractClass: 'baseline',
      baselineId: 'baseline-1',
      sourceObservation: { observationId: before.observationId, requestId: before.requestId, producer: before.producer, observationSchemaVersion: before.schemaVersion },
      clauses: [],
      provenance: { approvedAt: new Date(0).toISOString() },
    };
    const baselineFile = path.join(workDir, 'baseline.json');
    await writeFile(baselineFile, JSON.stringify(baselineContract, null, 2), 'utf8');
    const approveRes = await run(process.execPath, [cliPath, 'approve-baseline', '--observation', beforeRoot, '--contract-file', baselineFile, '--output', 'baselines'], { cwd: workDir });
    if (approveRes.code !== 0) fail(`approve-baseline failed (exit ${approveRes.code}):\n${approveRes.stdout}\n${approveRes.stderr}`);
    const baselineRoot = artifactRootFrom(approveRes.stdout);
    if (!baselineRoot) fail('approve-baseline output missing an Artifact: line');
    if (!approveRes.stdout.includes('State: approved')) fail('approve-baseline output missing "State: approved"');
    console.log('approve-baseline: PASS');

    // --- save-change-contract (the milestone-signature four clauses) ---
    const changeContract = {
      artifactKind: 'my-frontend-observer/frontend-contract',
      schemaVersion: '1.0.0',
      contractClass: 'change',
      contractId: 'change-1',
      contractRequestId: 'change-request-1',
      activeBaselineIds: ['baseline-1'],
      clauses: [
        { clauseId: 'requested-nav', primitive: { kind: 'property-decreases', target: 'navigation', property: 'width' }, category: 'requested', supportingEvidence: [] },
        { clauseId: 'expected-workspace', primitive: { kind: 'property-increases', target: 'workspace', property: 'width' }, category: 'expected-dependent', expectedDependentMode: 'required', supportingEvidence: [] },
        { clauseId: 'protected-rightad', primitive: { kind: 'property-unchanged-within-tolerance', target: 'rightAd', property: 'width', tolerance: { kind: 'exact' } }, category: 'protected', supportingEvidence: [] },
        { clauseId: 'preserved-nav-unclipped', primitive: { kind: 'target-not-clipped', target: 'navigation' }, category: 'preserved', supportingEvidence: [] },
      ],
    };
    const changeFile = path.join(workDir, 'change.json');
    await writeFile(changeFile, JSON.stringify(changeContract, null, 2), 'utf8');
    const saveRes = await run(process.execPath, [cliPath, 'save-change-contract', '--contract-file', changeFile, '--output', 'contracts'], { cwd: workDir });
    if (saveRes.code !== 0) fail(`save-change-contract failed (exit ${saveRes.code}):\n${saveRes.stdout}\n${saveRes.stderr}`);
    const changeRoot = artifactRootFrom(saveRes.stdout);
    if (!changeRoot) fail('save-change-contract output missing an Artifact: line');
    console.log('save-change-contract: PASS');

    // --- evaluate-contract: milestone-signature FAIL, without --enforce (exit 0) ---
    const evalRes = await run(
      process.execPath,
      [cliPath, 'evaluate-contract', '--before', beforeRoot, '--after', afterRoot, '--comparison', comparisonRoot, '--baseline', baselineRoot, '--change', changeRoot, '--output', 'evaluations-noenforce'],
      { cwd: workDir },
    );
    if (evalRes.code !== 0) fail(`evaluate-contract (no --enforce) expected exit 0, got ${evalRes.code}:\n${evalRes.stdout}\n${evalRes.stderr}`);
    if (!evalRes.stdout.includes('Verdict: FAIL')) fail(`expected "Verdict: FAIL" in output:\n${evalRes.stdout}`);
    if (!evalRes.stdout.includes('Enforced: no')) fail(`expected "Enforced: no" in output:\n${evalRes.stdout}`);
    const evalRootNoEnforce = artifactRootFrom(evalRes.stdout);
    if (!evalRootNoEnforce) fail('evaluate-contract output missing an Artifact: line');
    console.log('evaluate-contract (FAIL, no --enforce, exit 0): PASS');

    const evalManifestNoEnforce = JSON.parse(await readFile(path.join(evalRootNoEnforce, 'manifest.json'), 'utf8'));
    if (evalManifestNoEnforce.artifactKind !== 'my-frontend-observer/frontend-contract-evaluation') fail(`unexpected evaluation artifactKind: ${evalManifestNoEnforce.artifactKind}`);
    if (evalManifestNoEnforce.schemaVersion !== '1.0.0') fail(`unexpected evaluation schemaVersion: ${evalManifestNoEnforce.schemaVersion}`);
    if (evalManifestNoEnforce.overallVerdict !== 'FAIL') fail('expected persisted overallVerdict FAIL');
    const byId = new Map(evalManifestNoEnforce.clauseResults.map((r) => [r.clauseId, r]));
    if (byId.get('requested-nav')?.status !== 'pass') fail('expected requested-nav = pass');
    if (byId.get('expected-workspace')?.status !== 'pass') fail('expected expected-workspace = pass');
    if (byId.get('protected-rightad')?.status !== 'fail') fail('expected protected-rightad = fail');
    if (byId.get('preserved-nav-unclipped')?.status !== 'fail') fail('expected preserved-nav-unclipped = fail');
    console.log('milestone-signature classifications: PASS');

    // evaluation directory contains manifest.json only - no copied screenshot.
    const evalEntries = await readdir(evalRootNoEnforce);
    if (evalEntries.length !== 1 || evalEntries[0] !== 'manifest.json') fail(`expected evaluation directory to contain only manifest.json, got: ${evalEntries.join(', ')}`);
    console.log('no screenshot copied into evaluation artifact: PASS');

    // --- evaluate-contract: same semantic evaluation with --enforce (exit nonzero) ---
    const evalEnforceRes = await run(
      process.execPath,
      [cliPath, 'evaluate-contract', '--before', beforeRoot, '--after', afterRoot, '--comparison', comparisonRoot, '--baseline', baselineRoot, '--change', changeRoot, '--output', 'evaluations-enforce', '--enforce'],
      { cwd: workDir },
    );
    if (evalEnforceRes.code === 0) fail('evaluate-contract with --enforce on a FAIL verdict was expected to exit nonzero');
    if (!evalEnforceRes.stdout.includes('Verdict: FAIL')) fail(`expected "Verdict: FAIL" in --enforce output:\n${evalEnforceRes.stdout}`);
    if (!evalEnforceRes.stdout.includes('Enforced: yes')) fail(`expected "Enforced: yes" in --enforce output:\n${evalEnforceRes.stdout}`);
    const evalRootEnforce = artifactRootFrom(evalEnforceRes.stdout);
    if (!evalRootEnforce) fail('evaluate-contract (--enforce) output missing an Artifact: line');
    console.log('evaluate-contract (FAIL, --enforce, nonzero exit): PASS');

    const evalManifestEnforce = JSON.parse(await readFile(path.join(evalRootEnforce, 'manifest.json'), 'utf8'));
    if (evalManifestEnforce.evaluationRequestId !== evalManifestNoEnforce.evaluationRequestId) {
      fail('--enforce must not change the deterministic evaluationRequestId');
    }
    if (JSON.stringify(evalManifestEnforce.clauseResults) !== JSON.stringify(evalManifestNoEnforce.clauseResults)) {
      fail('--enforce must not change clause result contents');
    }
    console.log('both FAIL invocations persist valid, semantically-identical evaluation evidence: PASS');

    // Operational paths must never appear in either persisted evaluation manifest.
    for (const manifest of [evalManifestNoEnforce, evalManifestEnforce]) {
      const serialized = JSON.stringify(manifest);
      for (const leaked of [workDir, beforeRoot, afterRoot, comparisonRoot, baselineRoot, changeRoot]) {
        if (serialized.includes(leaked)) fail(`operational filesystem path leaked into evaluation manifest: ${leaked}`);
      }
    }
    console.log('operational path privacy: PASS');

    // Source observation/comparison/contract artifacts remain unmodified.
    const beforeManifestAfter = await readFile(path.join(beforeRoot, 'manifest.json'), 'utf8');
    const afterManifestAfter = await readFile(path.join(afterRoot, 'manifest.json'), 'utf8');
    const comparisonManifestAfter = await readFile(path.join(comparisonRoot, 'manifest.json'), 'utf8');
    const baselineManifestAfter = await readFile(path.join(baselineRoot, 'manifest.json'), 'utf8');
    const changeManifestAfter = await readFile(path.join(changeRoot, 'manifest.json'), 'utf8');
    if (JSON.parse(beforeManifestAfter).observationId !== before.observationId) fail('before observation manifest unexpectedly changed');
    if (JSON.parse(afterManifestAfter).observationId !== after.observationId) fail('after observation manifest unexpectedly changed');
    if (JSON.parse(comparisonManifestAfter).before.observationId !== before.observationId) fail('comparison manifest unexpectedly changed');
    if (JSON.parse(baselineManifestAfter).baselineId !== 'baseline-1') fail('baseline manifest unexpectedly changed');
    if (JSON.parse(changeManifestAfter).contractId !== 'change-1') fail('change contract manifest unexpectedly changed');
    console.log('no source observation/comparison/contract artifact modified: PASS');

    console.log('DEV CLI FRONTEND CONTRACTS SMOKE PASS');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = process.exitCode || 1;
});
