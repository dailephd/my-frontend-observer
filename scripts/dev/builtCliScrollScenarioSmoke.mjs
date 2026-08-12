#!/usr/bin/env node
// v0.3 Batch 4: proves the actual *built* dist/cli.js - not the imported
// runCli() function under vitest - recognizes --scroll-scenario-file,
// launches real Chromium, performs a real window-scroll-by and a real
// target-scroll-by, and persists a valid schema-1.2.0 artifact with
// populated scrollScenarioEvidence. This is dev/readiness infrastructure
// only: never imported by production code and not part of the npm package.
// Requires `npm run build` to have already run.
//
// Usage: node scripts/dev/builtCliScrollScenarioSmoke.mjs

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function isPngSignature(bytes) {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

async function main() {
  await access(cliPath).catch(() => fail(`built CLI not found at ${cliPath} - run "npm run build" first`));

  const html =
    '<!doctype html><html><head><style>' +
    'html,body{margin:0;padding:0}' +
    'body{width:2000px;height:2000px}' +
    '#panel{position:absolute;top:20px;left:20px;width:200px;height:150px;overflow:auto}' +
    '#panel-content{width:180px;height:900px}' +
    '</style></head><body>' +
    '<div id="panel"><div id="panel-content">Scrollable panel content</div></div>' +
    '</body></html>';
  const server = createServer((req, res) => {
    if (req.url === '/smoke') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const targetUrl = `http://127.0.0.1:${port}/smoke`;

  const workDir = await mkdtemp(path.join(tmpdir(), 'mfo-dev-cli-scroll-smoke-'));
  try {
    const beforeHtml = await fetch(targetUrl).then((r) => r.text());

    // --- 1. window-scroll-by, via legacy --target shorthand ---
    const windowScenarioPath = path.join(workDir, 'window-scroll.json');
    await writeFile(windowScenarioPath, JSON.stringify({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 500 } }), 'utf8');
    const windowOutputSubdir = 'dev-cli-scroll-smoke-window-output';
    await mkdir(path.join(workDir, windowOutputSubdir), { recursive: true });

    const windowRes = await run(
      process.execPath,
      [cliPath, 'observe', '--url', targetUrl, '--viewport', '800x600', '--scroll-scenario-file', windowScenarioPath, '--output', windowOutputSubdir],
      { cwd: workDir },
    );
    console.log(`window-scroll-by observe exit=${windowRes.code}`);
    console.log(windowRes.stdout);
    if (windowRes.stderr) console.log(`stderr:\n${windowRes.stderr}`);
    if (windowRes.code !== 0) fail(`window-scroll-by observe failed (exit ${windowRes.code}):\n${windowRes.stdout}\n${windowRes.stderr}`);

    const windowArtifactLine = windowRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const windowArtifactRoot = windowArtifactLine.slice('Artifact: '.length).trim();
    const windowManifest = JSON.parse(await readFile(path.join(windowArtifactRoot, 'manifest.json'), 'utf8'));
    const windowScreenshot = await readFile(path.join(windowArtifactRoot, 'screenshot.png'));

    if (windowManifest.schemaVersion !== '1.2.0') fail(`unexpected schemaVersion: ${windowManifest.schemaVersion}`);
    if (windowManifest.requestConfig?.scrollScenario?.action?.kind !== 'window-scroll-by') {
      fail('window-scroll-by scenario was not persisted into requestConfig');
    }
    const windowEvidence = windowManifest.scrollScenarioEvidence;
    if (!windowEvidence) fail('scrollScenarioEvidence missing from window-scroll-by manifest');
    if (windowEvidence.initial?.window?.scrollY !== 0) fail('expected initial window.scrollY === 0');
    if (!(windowEvidence.final?.window?.scrollY > 0)) fail('expected real window scroll movement (final window.scrollY > 0)');
    if (windowEvidence.scrollOwner?.value?.kind !== 'document') fail(`expected scrollOwner document, got ${JSON.stringify(windowEvidence.scrollOwner)}`);
    if (windowManifest.pageEvidence?.windowScrollY?.value !== windowEvidence.final.window.scrollY) {
      fail('ordinary pageEvidence.windowScrollY does not agree with scrollScenarioEvidence.final.window.scrollY');
    }
    if (windowScreenshot.length === 0 || !isPngSignature(new Uint8Array(windowScreenshot))) fail('window scenario screenshot.png is missing/invalid');
    const serializedWindowManifest = JSON.stringify(windowManifest);
    if (serializedWindowManifest.includes(windowScenarioPath) || serializedWindowManifest.includes('window-scroll.json')) {
      fail('scroll-scenario-file path leaked into persisted window-scroll manifest');
    }

    // --- 2. target-scroll-by, via --targets-file + --scroll-scenario-file ---
    const targetsFilePath = path.join(workDir, 'targets.json');
    await writeFile(targetsFilePath, JSON.stringify({ targets: [{ name: 'panel', locators: [{ kind: 'id', value: 'panel' }] }] }), 'utf8');
    const targetScenarioPath = path.join(workDir, 'target-scroll.json');
    await writeFile(targetScenarioPath, JSON.stringify({ action: { kind: 'target-scroll-by', target: 'panel', deltaX: 0, deltaY: 400 } }), 'utf8');
    const targetOutputSubdir = 'dev-cli-scroll-smoke-target-output';
    await mkdir(path.join(workDir, targetOutputSubdir), { recursive: true });

    const targetRes = await run(
      process.execPath,
      [
        cliPath,
        'observe',
        '--url',
        targetUrl,
        '--viewport',
        '800x600',
        '--targets-file',
        targetsFilePath,
        '--scroll-scenario-file',
        targetScenarioPath,
        '--output',
        targetOutputSubdir,
      ],
      { cwd: workDir },
    );
    console.log(`target-scroll-by observe exit=${targetRes.code}`);
    console.log(targetRes.stdout);
    if (targetRes.stderr) console.log(`stderr:\n${targetRes.stderr}`);
    if (targetRes.code !== 0) fail(`target-scroll-by observe failed (exit ${targetRes.code}):\n${targetRes.stdout}\n${targetRes.stderr}`);

    const targetArtifactLine = targetRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const targetArtifactRoot = targetArtifactLine.slice('Artifact: '.length).trim();
    const targetManifest = JSON.parse(await readFile(path.join(targetArtifactRoot, 'manifest.json'), 'utf8'));
    const targetScreenshot = await readFile(path.join(targetArtifactRoot, 'screenshot.png'));

    if (targetManifest.schemaVersion !== '1.2.0') fail(`unexpected schemaVersion: ${targetManifest.schemaVersion}`);
    if (targetManifest.requestConfig?.scrollScenario?.action?.target !== 'panel') fail('target-scroll-by scenario target not persisted');
    const targetEvidence = targetManifest.scrollScenarioEvidence;
    if (!targetEvidence) fail('scrollScenarioEvidence missing from target-scroll-by manifest');
    if (targetEvidence.initial?.targets?.panel?.metrics?.value?.scrollTop !== 0) fail('expected initial panel scrollTop === 0');
    if (!(targetEvidence.final?.targets?.panel?.metrics?.value?.scrollTop > 0)) fail('expected real panel scroll movement (final scrollTop > 0)');
    if (targetEvidence.final?.window?.scrollY !== 0) fail('expected window.scrollY unchanged for a target-only scroll');
    if (targetEvidence.scrollOwner?.value?.kind !== 'target' || targetEvidence.scrollOwner?.value?.target !== 'panel') {
      fail(`expected scrollOwner target:panel, got ${JSON.stringify(targetEvidence.scrollOwner)}`);
    }
    if (targetManifest.targetEvidence?.panel?.resolution?.value?.selectionStatus !== 'matched') fail('panel target did not resolve');
    if (targetScreenshot.length === 0 || !isPngSignature(new Uint8Array(targetScreenshot))) fail('target scenario screenshot.png is missing/invalid');
    const serializedTargetManifest = JSON.stringify(targetManifest);
    if (
      serializedTargetManifest.includes(targetsFilePath) ||
      serializedTargetManifest.includes('targets.json') ||
      serializedTargetManifest.includes(targetScenarioPath) ||
      serializedTargetManifest.includes('target-scroll.json')
    ) {
      fail('targets-file or scroll-scenario-file path leaked into persisted target-scroll manifest');
    }

    // --- target application immutability (served content, not browser-local scroll state) ---
    const afterHtml = await fetch(targetUrl).then((r) => r.text());
    server.close();
    if (beforeHtml !== afterHtml) fail('observed target content changed after scenario observations');

    console.log('DEV CLI SCROLL SCENARIO SMOKE PASS');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = process.exitCode || 1;
});
