#!/usr/bin/env node
// v0.4 Batch 4: proves the actual *built* dist/cli.js - not the imported
// runCli() function under vitest - recognizes the "compare" command, reads
// two real persisted observation artifacts (each produced by a real
// built-CLI "observe" invocation against real Chromium), and produces a
// valid schema-1.0.0 ComparisonArtifact purely from their existing content
// (comparison itself launches no browser). This is dev/readiness
// infrastructure only: never imported by production code and not part of
// the npm package. Requires `npm run build` to have already run.
//
// Usage: node scripts/dev/builtCliCompareSmoke.mjs

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

function renderHtml(variant) {
  const movedTop = variant === 'before' ? 0 : 40;
  const movedLeft = variant === 'before' ? 100 : 140;
  const wide = variant === 'after' ? '<div id="wide" style="position:absolute;top:0;left:0;width:1200px;height:1px;"></div>' : '';
  return (
    '<!doctype html><html><head><style>' +
    'html,body{margin:0;padding:0}' +
    `#moved{position:absolute;top:${movedTop}px;left:${movedLeft}px;width:80px;height:40px;}` +
    '</style></head><body>' +
    '<div id="moved">Moved</div>' +
    wide +
    '</body></html>'
  );
}

async function main() {
  await access(cliPath).catch(() => fail(`built CLI not found at ${cliPath} - run "npm run build" first`));

  let variant = 'before';
  const server = createServer((req, res) => {
    if (req.url === '/smoke') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(renderHtml(variant));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const targetUrl = `http://127.0.0.1:${port}/smoke`;

  const workDir = await mkdtemp(path.join(tmpdir(), 'mfo-dev-cli-compare-smoke-'));
  try {
    // --- 1. observe "before" via the real built CLI ---
    variant = 'before';
    const beforeOutputSubdir = 'dev-cli-compare-smoke-before-output';
    await mkdir(path.join(workDir, beforeOutputSubdir), { recursive: true });
    const beforeRes = await run(
      process.execPath,
      [cliPath, 'observe', '--url', targetUrl, '--viewport', '800x600', '--target', 'moved=#moved', '--output', beforeOutputSubdir],
      { cwd: workDir },
    );
    console.log(`observe (before) exit=${beforeRes.code}`);
    console.log(beforeRes.stdout);
    if (beforeRes.code !== 0) fail(`observe (before) failed (exit ${beforeRes.code}):\n${beforeRes.stdout}\n${beforeRes.stderr}`);
    const beforeArtifactLine = beforeRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const beforeArtifactRoot = beforeArtifactLine.slice('Artifact: '.length).trim();
    const beforeManifestRaw = await readFile(path.join(beforeArtifactRoot, 'manifest.json'), 'utf8');

    // --- 2. observe "after" (real layout change) via the real built CLI ---
    variant = 'after';
    const afterOutputSubdir = 'dev-cli-compare-smoke-after-output';
    await mkdir(path.join(workDir, afterOutputSubdir), { recursive: true });
    const afterRes = await run(
      process.execPath,
      [cliPath, 'observe', '--url', targetUrl, '--viewport', '800x600', '--target', 'moved=#moved', '--output', afterOutputSubdir],
      { cwd: workDir },
    );
    console.log(`observe (after) exit=${afterRes.code}`);
    console.log(afterRes.stdout);
    if (afterRes.code !== 0) fail(`observe (after) failed (exit ${afterRes.code}):\n${afterRes.stdout}\n${afterRes.stderr}`);
    const afterArtifactLine = afterRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const afterArtifactRoot = afterArtifactLine.slice('Artifact: '.length).trim();
    const afterManifestRaw = await readFile(path.join(afterArtifactRoot, 'manifest.json'), 'utf8');

    server.close();

    // --- 3. compare via the real built CLI (comparison phase launches no browser) ---
    const compareOutputSubdir = 'dev-cli-compare-smoke-comparison-output';
    await mkdir(path.join(workDir, compareOutputSubdir), { recursive: true });
    const compareRes = await run(
      process.execPath,
      [cliPath, 'compare', '--before', beforeArtifactRoot, '--after', afterArtifactRoot, '--output', compareOutputSubdir],
      { cwd: workDir },
    );
    console.log(`compare exit=${compareRes.code}`);
    console.log(compareRes.stdout);
    if (compareRes.stderr) console.log(`stderr:\n${compareRes.stderr}`);
    if (compareRes.code !== 0) fail(`compare failed (exit ${compareRes.code}):\n${compareRes.stdout}\n${compareRes.stderr}`);

    const comparisonArtifactLine = compareRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    if (!comparisonArtifactLine) fail('compare output missing an Artifact: line');
    const comparisonArtifactRoot = comparisonArtifactLine.slice('Artifact: '.length).trim();
    const comparisonManifest = JSON.parse(await readFile(path.join(comparisonArtifactRoot, 'manifest.json'), 'utf8'));

    if (comparisonManifest.artifactKind !== 'my-frontend-observer/comparison') fail(`unexpected artifactKind: ${comparisonManifest.artifactKind}`);
    if (comparisonManifest.schemaVersion !== '1.0.0') fail(`unexpected comparison schemaVersion: ${comparisonManifest.schemaVersion}`);
    if (typeof comparisonManifest.comparisonRequestId !== 'string' || comparisonManifest.comparisonRequestId.length === 0) fail('comparisonRequestId missing');
    if (typeof comparisonManifest.comparisonId !== 'string' || comparisonManifest.comparisonId.length === 0) fail('comparisonId missing');
    if (comparisonManifest.comparability?.state !== 'comparable') fail(`expected comparability "comparable", got ${comparisonManifest.comparability?.state}`);

    const beforeManifest = JSON.parse(beforeManifestRaw);
    const afterManifest = JSON.parse(afterManifestRaw);
    if (comparisonManifest.before?.observationId !== beforeManifest.observationId) fail('before observation reference mismatch');
    if (comparisonManifest.after?.observationId !== afterManifest.observationId) fail('after observation reference mismatch');
    if (comparisonManifest.before?.screenshot?.path !== 'screenshot.png') fail('before screenshot reference missing/incorrect');
    if (comparisonManifest.after?.screenshot?.path !== 'screenshot.png') fail('after screenshot reference missing/incorrect');

    const moved = comparisonManifest.differences?.find((d) => d.kind === 'moved');
    if (!moved) fail('expected at least one "moved" difference');
    const pageChange = comparisonManifest.relationshipChanges?.find((c) => c.scope === 'page');
    if (!pageChange || pageChange.after !== 'document-width-exceeds-viewport') fail('expected a page-width relationship change to "exceeds"');

    // Comparison directory contains manifest.json only - no copied screenshots/side files.
    const comparisonEntries = await readdir(comparisonArtifactRoot);
    if (comparisonEntries.length !== 1 || comparisonEntries[0] !== 'manifest.json') {
      fail(`expected comparison directory to contain only manifest.json, got: ${comparisonEntries.join(', ')}`);
    }

    // Path privacy: no operational filesystem path leaked into the comparison manifest.
    const serializedComparisonManifest = JSON.stringify(comparisonManifest);
    for (const leaked of [beforeArtifactRoot, afterArtifactRoot, workDir]) {
      if (serializedComparisonManifest.includes(leaked)) fail(`operational filesystem path leaked into comparison manifest: ${leaked}`);
    }

    // Source observations remain byte-identical after comparison.
    const beforeManifestAfterCompare = await readFile(path.join(beforeArtifactRoot, 'manifest.json'), 'utf8');
    const afterManifestAfterCompare = await readFile(path.join(afterArtifactRoot, 'manifest.json'), 'utf8');
    if (beforeManifestAfterCompare !== beforeManifestRaw) fail('before observation manifest changed after comparison');
    if (afterManifestAfterCompare !== afterManifestRaw) fail('after observation manifest changed after comparison');

    console.log('DEV CLI COMPARE SMOKE PASS');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = process.exitCode || 1;
});
