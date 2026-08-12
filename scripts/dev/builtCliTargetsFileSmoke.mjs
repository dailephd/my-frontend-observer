#!/usr/bin/env node
// v0.2 Batch 4: proves the actual *built* dist/cli.js - not the imported
// runCli() function under vitest - recognizes --targets-file, launches real
// Chromium, resolves a structured semantic target through the existing
// resolver, and persists a valid schema-1.2.0 artifact. This is dev/
// readiness infrastructure only: never imported by production code and not
// part of the npm package. Requires `npm run build` to have already run.
//
// Usage: node scripts/dev/builtCliTargetsFileSmoke.mjs

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
    '<!doctype html><html><body>' +
    '<nav id="nav" aria-label="Primary"><a href="#">Home</a></nav>' +
    '<button id="cta" type="button">Submit</button>' +
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

  const workDir = await mkdtemp(path.join(tmpdir(), 'mfo-dev-cli-smoke-'));
  try {
    const targetsFilePath = path.join(workDir, 'targets.json');
    await writeFile(
      targetsFilePath,
      JSON.stringify({
        targets: [
          { name: 'primary-navigation', locators: [{ kind: 'role', role: 'navigation', name: 'Primary' }] },
          { name: 'button', locators: [{ kind: 'text', text: 'Submit' }] },
        ],
      }),
      'utf8',
    );

    const outputSubdir = 'dev-cli-smoke-output';
    await mkdir(path.join(workDir, outputSubdir), { recursive: true });

    const beforeHtml = await fetch(targetUrl).then((r) => r.text());

    const observeRes = await run(
      process.execPath,
      [cliPath, 'observe', '--url', targetUrl, '--viewport', '1024x768', '--targets-file', targetsFilePath, '--output', outputSubdir],
      { cwd: workDir },
    );

    const afterHtml = await fetch(targetUrl).then((r) => r.text());
    server.close();

    if (beforeHtml !== afterHtml) fail('observed target content changed after observation');
    console.log(`observe exit=${observeRes.code}`);
    console.log(observeRes.stdout);
    if (observeRes.stderr) console.log(`stderr:\n${observeRes.stderr}`);
    if (observeRes.code !== 0) fail(`observe failed (exit ${observeRes.code}):\n${observeRes.stdout}\n${observeRes.stderr}`);

    for (const prefix of ['Observation:', 'State:', 'Artifact:', 'Targets:', 'Diagnostics:']) {
      if (!observeRes.stdout.includes(prefix)) fail(`observe stdout missing expected "${prefix}" line`);
    }

    const artifactLine = observeRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const artifactRoot = artifactLine.slice('Artifact: '.length).trim();

    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8'));
    const screenshot = await readFile(path.join(artifactRoot, 'screenshot.png'));

    if (manifest.schemaVersion !== '1.2.0') fail(`unexpected schemaVersion: ${manifest.schemaVersion}`);
    if (manifest.artifactKind !== 'my-frontend-observer/observation') fail(`unexpected artifactKind: ${manifest.artifactKind}`);
    if (manifest.targetEvidence?.['primary-navigation']?.resolution?.value?.selectionStatus !== 'matched') {
      fail('primary-navigation (role locator) did not resolve through the built CLI');
    }
    if (manifest.targetEvidence?.['button']?.resolution?.value?.selectionStatus !== 'matched') {
      fail('button (text locator) did not resolve through the built CLI');
    }
    if (screenshot.length === 0 || !isPngSignature(new Uint8Array(screenshot))) fail('screenshot.png is missing/invalid');
    const serializedManifest = JSON.stringify(manifest);
    if (serializedManifest.includes(targetsFilePath) || serializedManifest.includes('targets.json')) {
      fail('targets-file path leaked into persisted manifest');
    }

    console.log('DEV CLI SEMANTIC SMOKE PASS');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = process.exitCode || 1;
});
