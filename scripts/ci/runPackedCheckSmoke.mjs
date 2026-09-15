#!/usr/bin/env node
// Installed-package v0.8.1 check proof. All generated paths are supplied by
// the caller through --consumer-root and remain outside the package checkout.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (value) => { stdout += value; }); child.stderr.on('data', (value) => { stderr += value; });
    child.on('error', reject); child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function fail(message) { throw new Error(`PACKED CHECK FAILURE: ${message}`); }
function artifactLine(stdout) { return stdout.split(/\r?\n/).find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length).trim(); }
function page({ nav, workspace, rail }) { return `<!doctype html><html><head><style>html,body{margin:0}#nav{position:absolute;left:0;top:0;width:${nav}px;height:80px;overflow:hidden}#nav span{display:block;width:190px}#workspace{position:absolute;left:210px;top:0;width:${workspace}px;height:80px}#rail{position:absolute;left:800px;top:0;width:${rail}px;height:80px}</style></head><body><nav id="nav"><span>Navigation</span></nav><main id="workspace">Workspace</main><aside id="rail">Rail</aside></body></html>`; }

async function main() {
  const args = process.argv.slice(2); const tarball = path.resolve(args[0] ?? ''); const rootIndex = args.indexOf('--consumer-root'); const root = rootIndex < 0 ? undefined : path.resolve(args[rootIndex + 1]);
  if (!args[0] || root === undefined) fail('usage: runPackedCheckSmoke.mjs <tarball> --consumer-root <root> [--out <file>]');
  const outIndex = args.indexOf('--out'); const outPath = outIndex < 0 ? undefined : path.resolve(args[outIndex + 1]);
  const installRoot = path.join(root, 'installed-package'); const targetRoot = path.join(root, 'target'); const sourceRoot = path.join(targetRoot, 'source');
  await rm(installRoot, { recursive: true, force: true }); await rm(targetRoot, { recursive: true, force: true }); await mkdir(installRoot, { recursive: true }); await mkdir(sourceRoot, { recursive: true });
  await writeFile(path.join(installRoot, 'package.json'), JSON.stringify({ name: 'packed-check-consumer', private: true, version: '0.0.0' }));
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const installed = await run(npmCommand, ['install', tarball, '--no-audit', '--no-fund'], { cwd: installRoot, shell: process.platform === 'win32' }); if (installed.code !== 0) fail(`install failed\n${installed.stdout}\n${installed.stderr}`);
  const packageJson = JSON.parse(await readFile(path.join(installRoot, 'node_modules', 'my-frontend-observer', 'package.json'), 'utf8')); const binary = path.join(installRoot, 'node_modules', 'my-frontend-observer', packageJson.bin['my-frontend-observer']);
  const playwrightPackage = JSON.parse(await readFile(path.join(installRoot, 'node_modules', 'playwright', 'package.json'), 'utf8'));
  const playwrightCli = path.join(installRoot, 'node_modules', 'playwright', playwrightPackage.bin.playwright);
  const browserInstall = await run(process.execPath, [playwrightCli, 'install', 'chromium'], { cwd: installRoot }); if (browserInstall.code !== 0) fail(`Chromium install failed\n${browserInstall.stdout}\n${browserInstall.stderr}`);
  const cli = (cliArgs) => run(process.execPath, [binary, ...cliArgs], { cwd: targetRoot });
  for (const command of ['init', 'capture', 'check', 'view']) { const help = await cli([command, '--help']); if (help.code !== 0) fail(`${command} --help failed`); }

  await writeFile(path.join(sourceRoot, 'index.html'), page({ nav: 200, workspace: 500, rail: 150 }));
  const server = createServer(async (_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(await readFile(path.join(sourceRoot, 'index.html'))); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (address === null || typeof address === 'string') fail('frontend server failed');
  let viewer; let browser;
  const summary = { packageVersion: packageJson.version, installedPackage: installRoot, target: targetRoot };
  try {
    const init = await cli(['init', '--url', `http://127.0.0.1:${address.port}/`, '--viewport', '1000x700', '--target', 'nav=#nav', '--target', 'workspace=#workspace', '--target', 'rail=#rail']); if (init.code !== 0) fail(`init failed\n${init.stderr}`);
    const capture = await cli(['capture', 'baseline']); if (capture.code !== 0) fail(`capture failed\n${capture.stderr}`); const baselineRoot = artifactLine(capture.stdout); if (!baselineRoot) fail('capture omitted artifact');
    const baselineManifest = JSON.parse(await readFile(path.join(baselineRoot, 'manifest.json'), 'utf8'));
    await writeFile(path.join(sourceRoot, 'index.html'), page({ nav: 195, workspace: 560, rail: 150 }));
    const review = await cli(['check', 'baseline', '--json']); const reviewJson = JSON.parse(review.stdout); if (review.code !== 2 || reviewJson.status !== 'REVIEW_REQUIRED') fail(`REVIEW_REQUIRED failed: ${review.code} ${review.stdout} ${review.stderr}`); summary.reviewRequired = true;

    const authoredRoot = path.join(targetRoot, 'contracts'); await mkdir(authoredRoot, { recursive: true });
    const baselineContractFile = path.join(authoredRoot, 'baseline.json'); const changeContractFile = path.join(authoredRoot, 'change.json');
    await writeFile(baselineContractFile, JSON.stringify({ artifactKind: 'my-frontend-observer/frontend-contract', schemaVersion: '1.0.0', contractClass: 'baseline', baselineId: 'packed-baseline', sourceObservation: { observationId: baselineManifest.observationId, requestId: baselineManifest.requestId, producer: baselineManifest.producer, observationSchemaVersion: baselineManifest.schemaVersion }, clauses: [], provenance: { approvedAt: new Date(0).toISOString() } }));
    await writeFile(changeContractFile, JSON.stringify({ artifactKind: 'my-frontend-observer/frontend-contract', schemaVersion: '1.0.0', contractClass: 'change', contractId: 'packed-change', contractRequestId: 'packed-change-request', activeBaselineIds: ['packed-baseline'], clauses: [
      { clauseId: 'requested-nav-shrink', primitive: { kind: 'property-decreases', target: 'nav', property: 'width' }, category: 'requested', supportingEvidence: [] },
      { clauseId: 'expected-workspace-grow', primitive: { kind: 'property-increases', target: 'workspace', property: 'width' }, category: 'expected-dependent', expectedDependentMode: 'required', supportingEvidence: [] },
      { clauseId: 'protected-rail-width', primitive: { kind: 'property-unchanged-within-tolerance', target: 'rail', property: 'width', tolerance: { kind: 'exact' } }, category: 'protected', supportingEvidence: [] },
    ] }));
    const approved = await cli(['approve-baseline', '--observation', baselineRoot, '--contract-file', baselineContractFile, '--output', '.frontend-observer/evidence/contracts/baseline']); const baselineArtifact = artifactLine(approved.stdout); if (approved.code !== 0 || !baselineArtifact) fail(`approve baseline failed\n${approved.stdout}\n${approved.stderr}`);
    const saved = await cli(['save-change-contract', '--contract-file', changeContractFile, '--output', '.frontend-observer/evidence/contracts/change']); const changeArtifact = artifactLine(saved.stdout); if (saved.code !== 0 || !changeArtifact) fail(`save contract failed\n${saved.stdout}\n${saved.stderr}`);
    const configPath = path.join(targetRoot, 'frontend-observer.json'); const config = JSON.parse(await readFile(configPath, 'utf8')); config.schemaVersion = '1.1.0'; config.acceptance = { contract: { baselineArtifact: path.relative(targetRoot, baselineArtifact).split(path.sep).join('/'), changeArtifact: path.relative(targetRoot, changeArtifact).split(path.sep).join('/') } }; await writeFile(configPath, JSON.stringify(config, null, 2));
    const acceptanceBefore = await readFile(configPath); const baselineBefore = await readFile(path.join(baselineArtifact, 'manifest.json')); const changeBefore = await readFile(path.join(changeArtifact, 'manifest.json'));

    await writeFile(path.join(sourceRoot, 'index.html'), page({ nav: 140, workspace: 560, rail: 130 })); const failed = await cli(['check', 'baseline', '--json']); const failedJson = JSON.parse(failed.stdout); if (failed.code !== 1 || failedJson.status !== 'FAIL' || !failedJson.contract.failedClauses.some((item) => item.clauseId === 'protected-rail-width' && item.category === 'protected')) fail(`FAIL check failed: ${failed.code} ${failed.stdout} ${failed.stderr}`); summary.fail = true;
    await writeFile(path.join(sourceRoot, 'index.html'), page({ nav: 195, workspace: 560, rail: 150 })); const passed = await cli(['check', 'baseline', '--json']); const passedJson = JSON.parse(passed.stdout); if (passed.code !== 0 || passedJson.status !== 'PASS') fail(`PASS check failed: ${passed.code} ${passed.stdout} ${passed.stderr}`); summary.pass = true;
    if (!(await readFile(configPath)).equals(acceptanceBefore) || !(await readFile(path.join(baselineArtifact, 'manifest.json'))).equals(baselineBefore) || !(await readFile(path.join(changeArtifact, 'manifest.json'))).equals(changeBefore)) fail('acceptance criteria changed during correction');
    const catalog = JSON.parse(await readFile(path.join(targetRoot, '.frontend-observer', 'catalog.json'), 'utf8')); if (!catalog.observations.baseline || !catalog.observations.current) fail('baseline/current aliases missing'); summary.currentAliasUpdated = true;

    viewer = spawn(process.execPath, [binary, 'view', '--port', '0', '--no-open'], { cwd: targetRoot, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; viewer.stdout.on('data', (value) => { stdout += value; });
    let viewerUrl; for (let index = 0; index < 200; index++) { viewerUrl = stdout.match(/Viewer: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]; if (viewerUrl) break; await delay(50); } if (!viewerUrl) fail('viewer did not start');
    const index = await (await fetch(`${viewerUrl}/api/index`)).json(); if (!index.records.some((item) => item.alias === 'baseline') || !index.records.some((item) => item.alias === 'current')) fail('viewer index omitted aliases');
    const playwrightPath = path.join(installRoot, 'node_modules', 'playwright', 'index.js'); const playwright = await import(pathToFileURL(playwrightPath).href); browser = await (playwright.chromium ?? playwright.default.chromium).launch(); const pageHandle = await browser.newPage(); await pageHandle.goto(viewerUrl); const currentItem = pageHandle.locator('.evidence-list__item', { hasText: 'current' }); await currentItem.waitFor(); await currentItem.click(); await pageHandle.getByText(catalog.observations.current.observationId, { exact: false }).waitFor({ timeout: 15_000 }); await pageHandle.close(); summary.viewerAliases = true;
    summary.result = 'PASS'; console.log('PACKED CHECK SMOKE: PASS');
  } finally {
    await browser?.close().catch(() => {}); viewer?.kill(); await new Promise((resolve) => server.close(() => resolve()));
    if (outPath) await writeFile(outPath, JSON.stringify(summary, null, 2));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
