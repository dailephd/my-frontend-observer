#!/usr/bin/env node
// Cross-platform (Windows/Linux/macOS) readiness-only smoke helper.
//
// Proves that the actual packed npm tarball's installed v0.8 viewer -
// never the source checkout - starts, serves its React/PWA shell over a
// loopback-only HTTP listener, indexes real evidence produced by the same
// installed CLI, renders a real observation (SVG target overlay) and a real
// external-reference/candidate pair in real Chromium, accepts
// --bindings-file/--context-file, rejects write methods, registers a
// service worker, and never presents stale evidence once the server is
// stopped. This is test/readiness infrastructure only: it is never
// imported by production code and is not itself part of the npm package
// (see package.json "files").
//
// Usage: node scripts/ci/runPackedViewerSmoke.mjs <path-to-tarball> [--out <summary-json-path>]

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

function fail(message) {
  console.error(`VIEWER SMOKE FAILURE: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** header-only PNG fixture (never real pixel data) - sufficient for the header-only importer parser (see tests/unit/externalReferenceImageFixtures.ts). */
function buildMinimalPng(width, height) {
  const bytes = new Uint8Array(41);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const writeU32 = (offset, value) => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  writeU32(8, 13);
  bytes.set(Array.from('IHDR').map((c) => c.charCodeAt(0)), 12);
  writeU32(16, width);
  writeU32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0xde, 0xad, 0xbe, 0xef], 37);
  return Buffer.from(bytes);
}

async function main() {
  const args = process.argv.slice(2);
  const tarballArg = args.find((a) => !a.startsWith('--'));
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (!tarballArg) fail('usage: runPackedViewerSmoke.mjs <path-to-tarball> [--out <summary-json-path>]');
  const tarballPath = path.resolve(tarballArg);

  const consumerDir = await mkdtemp(path.join(tmpdir(), 'mfo-ci-viewer-smoke-'));
  const summary = { platform: process.platform, arch: process.arch, nodeVersion: process.version };
  let fixtureServer;
  let viewerProcess;
  let browser;

  try {
    await writeFile(path.join(consumerDir, 'package.json'), JSON.stringify({ name: 'mfo-ci-viewer-smoke-consumer', version: '0.0.0', private: true }, null, 2));

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    console.log('installing candidate tarball...');
    const install = await run(npmCmd, ['install', tarballPath, '--no-audit', '--no-fund'], { cwd: consumerDir });
    if (install.code !== 0) fail(`npm install of candidate tarball failed:\n${install.stdout}\n${install.stderr}`);

    const installedPkgPath = path.join(consumerDir, 'node_modules', 'my-frontend-observer', 'package.json');
    const installedPkg = JSON.parse(await readFile(installedPkgPath, 'utf8'));
    const binName = Object.keys(installedPkg.bin ?? {})[0];
    if (!binName) fail('installed package.json has no bin entry');
    const binAbsolutePath = path.join(consumerDir, 'node_modules', 'my-frontend-observer', installedPkg.bin[binName]);
    summary.packageVersion = installedPkg.version;

    // Purity: the resolved bin must live inside this consumer's own installed
    // node_modules, never the repository's own src/dist (regardless of where
    // the OS/CI places its temp directory relative to the repo checkout).
    const repoSrcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
    if (!binAbsolutePath.startsWith(path.join(consumerDir, 'node_modules') + path.sep) || binAbsolutePath.includes(repoSrcDir)) {
      fail(`resolved installed bin unexpectedly points outside the consumer's installed candidate: ${binAbsolutePath}`);
    }

    function runBin(binArgs, opts = {}) {
      return run(process.execPath, [binAbsolutePath, ...binArgs], { cwd: consumerDir, shell: false, ...opts });
    }

    const playwrightPkgPath = path.join(consumerDir, 'node_modules', 'playwright', 'package.json');
    const playwrightPkg = JSON.parse(await readFile(playwrightPkgPath, 'utf8'));
    const playwrightCliPath = path.join(consumerDir, 'node_modules', 'playwright', playwrightPkg.bin.playwright);
    console.log('installing Chromium via consumer-local playwright...');
    const pwInstall = await run(process.execPath, [playwrightCliPath, 'install', 'chromium', ...(process.platform === 'linux' ? ['--with-deps'] : [])], { cwd: consumerDir, shell: false });
    if (pwInstall.code !== 0) fail(`playwright install chromium failed:\n${pwInstall.stdout}\n${pwInstall.stderr}`);

    // playwright's own index.js is CJS with only a default export detectable
    // through Node's ESM interop (no static named-export analysis available
    // for its dynamically-built object) - take chromium off the default.
    const playwrightIndexPath = path.join(consumerDir, 'node_modules', 'playwright', playwrightPkg.main ?? 'index.js');
    const playwrightModule = await import(pathToFileURL(playwrightIndexPath).href);
    const chromium = playwrightModule.chromium ?? playwrightModule.default.chromium;

    // --- installed --version/--help/view --help ---
    const versionRes = await runBin(['--version']);
    if (versionRes.code !== 0 || !versionRes.stdout.trim()) fail(`--version failed: ${versionRes.stdout}\n${versionRes.stderr}`);
    summary.versionOutput = versionRes.stdout.trim();

    const helpRes = await runBin(['--help']);
    if (helpRes.code !== 0 || !helpRes.stdout.includes('view')) fail('--help failed or does not list "view"');

    const viewHelpRes = await runBin(['view', '--help']);
    if (viewHelpRes.code !== 0) fail(`view --help failed:\n${viewHelpRes.stderr}`);
    for (const flag of ['--root', '--port', '--bindings-file', '--context-file', '--no-open']) {
      if (!viewHelpRes.stdout.includes(flag)) fail(`view --help missing expected flag documentation: ${flag}`);
    }
    summary.viewHelpOk = true;

    // --- build one real ObservationArtifact via the installed CLI, against a disposable local fixture ---
    const html =
      '<!doctype html><html><head><title>viewer smoke fixture</title><style>' +
      'html,body{margin:0;padding:0}' +
      '#header{position:absolute;top:0;left:0;width:800px;height:80px;}' +
      '#sidebar{position:absolute;top:100px;left:0;width:200px;height:400px;}' +
      '</style></head><body><div id="header">Header</div><div id="sidebar">Sidebar</div></body></html>';
    fixtureServer = createServer((req, res) => {
      if (req.url === '/smoke') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
    const fixturePort = fixtureServer.address().port;
    const targetUrl = `http://127.0.0.1:${fixturePort}/smoke`;

    // --output must be a relative, portable path (no drive letter/leading "/") -
    // resolved from the CLI's cwd, which every runBin() call fixes to consumerDir.
    const evidenceRootRel = 'evidence';
    const evidenceRoot = path.join(consumerDir, evidenceRootRel);
    await mkdir(evidenceRoot, { recursive: true });
    const observationOutRel = path.join(evidenceRootRel, 'observation-1');
    await mkdir(path.join(consumerDir, observationOutRel), { recursive: true });

    const observeRes = await runBin(['observe', '--url', targetUrl, '--viewport', '1024x768', '--target', 'header=#header', '--target', 'sidebar=#sidebar', '--output', observationOutRel]);
    if (observeRes.code !== 0) fail(`observe failed (exit ${observeRes.code}):\n${observeRes.stdout}\n${observeRes.stderr}`);
    const observeArtifactLine = observeRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    if (!observeArtifactLine) fail(`observe stdout missing "Artifact: " line:\n${observeRes.stdout}`);
    const observationOutDir = observeArtifactLine.slice('Artifact: '.length).trim();
    const observationManifest = JSON.parse(await readFile(path.join(observationOutDir, 'manifest.json'), 'utf8'));
    summary.observationId = observationManifest.observationId;

    // --- build one real imported + one approved external-reference artifact via the installed CLI ---
    const referenceImagePath = path.join(consumerDir, 'reference.png');
    await writeFile(referenceImagePath, buildMinimalPng(800, 500));
    const regionsFilePath = path.join(consumerDir, 'regions.json');
    await writeFile(regionsFilePath, JSON.stringify({ regions: [{ id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 80 } }] }), 'utf8');

    const importedRefOutRel = path.join(evidenceRootRel, 'reference-imported-1');
    await mkdir(path.join(consumerDir, importedRefOutRel), { recursive: true });
    const importRes = await runBin(['import-reference', referenceImagePath, '--output', importedRefOutRel, '--regions-file', regionsFilePath, '--label', 'ci viewer smoke reference']);
    if (importRes.code !== 0) fail(`import-reference failed (exit ${importRes.code}):\n${importRes.stdout}\n${importRes.stderr}`);
    const importArtifactLine = importRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    if (!importArtifactLine) fail(`import-reference stdout missing "Artifact: " line:\n${importRes.stdout}`);
    const importedRefOutDir = importArtifactLine.slice('Artifact: '.length).trim();
    const importedRefManifest = JSON.parse(await readFile(path.join(importedRefOutDir, 'manifest.json'), 'utf8'));
    summary.importedReferenceId = importedRefManifest.referenceId;

    const approvedRefOutRel = path.join(evidenceRootRel, 'reference-approved-1');
    await mkdir(path.join(consumerDir, approvedRefOutRel), { recursive: true });
    const approveRes = await runBin(['approve-reference', '--reference', importedRefOutDir, '--output', approvedRefOutRel]);
    if (approveRes.code !== 0) fail(`approve-reference failed (exit ${approveRes.code}):\n${approveRes.stdout}\n${approveRes.stderr}`);
    const approveArtifactLine = approveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    if (!approveArtifactLine) fail(`approve-reference stdout missing "Artifact: " line:\n${approveRes.stdout}`);
    const approvedRefOutDir = approveArtifactLine.slice('Artifact: '.length).trim();
    const approvedRefManifest = JSON.parse(await readFile(path.join(approvedRefOutDir, 'manifest.json'), 'utf8'));
    summary.approvedReferenceId = approvedRefManifest.referenceId;

    // --- explicit bindings-file / context-file session input ---
    const bindingsFilePath = path.join(consumerDir, 'bindings.json');
    await writeFile(bindingsFilePath, JSON.stringify({ bindings: [{ referenceRegion: 'header', runtimeTarget: 'header' }] }), 'utf8');

    // Built through the installed package's own exported projectBoundedAgentContext -
    // never hand-edited - against the real observation created above (task requires
    // "installed public/programmatic API if exported", never fabricated schema fields).
    const installedIndexPath = path.join(consumerDir, 'node_modules', 'my-frontend-observer', 'dist', 'index.js');
    const installedPackageApi = await import(pathToFileURL(installedIndexPath).href);
    if (typeof installedPackageApi.projectBoundedAgentContext !== 'function') fail('installed package does not export projectBoundedAgentContext');
    const contextProjection = installedPackageApi.projectBoundedAgentContext({
      generatedAt: new Date().toISOString(),
      producerVersion: installedPkg.version,
      projectionProfile: 'frontend-change-review',
      focusTargetIds: ['header'],
      observation: observationManifest,
    });
    if (!contextProjection.ok) fail(`installed projectBoundedAgentContext failed: ${contextProjection.reason}`);
    const contextFilePath = path.join(consumerDir, 'context.json');
    await writeFile(contextFilePath, JSON.stringify(contextProjection.artifact), 'utf8');

    // --- start the installed viewer as a real child process (port 0 = ephemeral) ---
    viewerProcess = spawn(process.execPath, [binAbsolutePath, 'view', '--root', evidenceRoot, '--port', '0', '--no-open', '--bindings-file', bindingsFilePath, '--context-file', contextFilePath], {
      cwd: consumerDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let viewerStdout = '';
    let viewerStderr = '';
    viewerProcess.stdout.on('data', (d) => (viewerStdout += d.toString()));
    viewerProcess.stderr.on('data', (d) => (viewerStderr += d.toString()));

    let viewerUrl;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const m = viewerStdout.match(/Viewer: (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        viewerUrl = m[1];
        break;
      }
      if (viewerProcess.exitCode !== null) fail(`viewer process exited early (code ${viewerProcess.exitCode}):\n${viewerStdout}\n${viewerStderr}`);
      await delay(100);
    }
    if (!viewerUrl) fail(`viewer did not print its URL within timeout:\nstdout:${viewerStdout}\nstderr:${viewerStderr}`);
    summary.viewerUrl = viewerUrl;
    if (!viewerUrl.startsWith('http://127.0.0.1:')) fail(`viewer bound to non-loopback host: ${viewerUrl}`);

    // --- read-only API audit: every write method must be rejected ---
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${viewerUrl}/api/status`, { method });
      if (res.status !== 405) fail(`expected 405 for ${method} /api/status, got ${res.status}`);
    }
    summary.readOnlyApiOk = true;

    // --- /api/status, /api/index ---
    const statusRes = await fetch(`${viewerUrl}/api/status`);
    if (!statusRes.ok) fail(`/api/status failed: ${statusRes.status}`);
    const statusBody = await statusRes.json();
    if (statusBody.root !== evidenceRoot) fail(`/api/status root mismatch: ${statusBody.root}`);
    summary.viewerProtocolVersion = statusBody.viewerProtocolVersion;

    const indexRes = await fetch(`${viewerUrl}/api/index`);
    if (!indexRes.ok) fail(`/api/index failed: ${indexRes.status}`);
    const indexBody = await indexRes.json();
    if (!Array.isArray(indexBody.records) || indexBody.records.length < 3) fail(`/api/index did not index the expected evidence (observation + 2 references): ${JSON.stringify(indexBody.records)}`);
    summary.indexedRecordCount = indexBody.records.length;

    // --- path containment / traversal against a media-style route ---
    const traversalRes = await fetch(`${viewerUrl}/api/media/${encodeURIComponent('observation:' + observationManifest.observationId)}/..%2f..%2f..%2fetc%2fpasswd`);
    if (traversalRes.status === 200) fail('encoded traversal segment unexpectedly returned 200 from a media route');
    // An unmapped asset-like path legitimately SPA-falls-back to the shell (200) - see
    // viewerServer.test.ts - so the security property under test is that no real filesystem
    // content is ever leaked, not that the status code is non-200.
    const encodedTraversalRes = await fetch(`${viewerUrl}/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    const encodedTraversalBody = await encodedTraversalRes.text();
    if (encodedTraversalBody.includes('root:') || encodedTraversalBody.includes('/bin/')) {
      fail('encoded traversal path leaked real filesystem content');
    }
    summary.traversalRejected = true;

    // --- real Chromium: shell load, evidence-list interaction, SVG overlay, reference view ---
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(viewerUrl, { waitUntil: 'load' });

    const observationItem = page.locator('.evidence-list__item', { hasText: observationManifest.observationId });
    await observationItem.waitFor({ timeout: 15_000 });
    await observationItem.click();

    const overlayImage = page.locator('.target-overlay-svg image').first();
    await overlayImage.waitFor({ timeout: 15_000 });
    const overlayHref = await overlayImage.getAttribute('href');
    if (!overlayHref || !overlayHref.startsWith('/api/media/observation:')) fail(`SVG overlay image href unexpected: ${overlayHref}`);

    const headerRect = page.locator('rect[data-target-name="header"]');
    await headerRect.waitFor({ timeout: 10_000 });
    summary.svgOverlayRendered = true;

    // Confirm the media the overlay references actually loads (200, non-empty, safe content-type).
    const mediaRes = await fetch(`${viewerUrl}${overlayHref}`);
    if (!mediaRes.ok) fail(`overlay screenshot media did not load: ${mediaRes.status}`);
    const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
    if (mediaBuf.length === 0) fail('overlay screenshot media is empty');
    summary.screenshotMediaLoaded = true;

    const approvedRefItem = page.locator('.evidence-list__item', { hasText: approvedRefManifest.referenceId });
    await approvedRefItem.waitFor({ timeout: 15_000 });
    await approvedRefItem.click();
    const refImage = page.locator('.reference-region-overlay-svg image').first();
    await refImage.waitFor({ timeout: 15_000 });
    summary.referenceViewRendered = true;

    if (pageErrors.length > 0) fail(`page-level fatal error(s) encountered: ${pageErrors.join(' | ')}`);
    summary.noPageErrors = true;

    // --- service worker registration + PWA manifest reachability ---
    await page.waitForFunction(() => 'serviceWorker' in navigator, { timeout: 5_000 });
    const swRegistered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => undefined);
      return Boolean(reg && reg.active);
    });
    if (!swRegistered) fail('service worker did not register/activate');
    summary.serviceWorkerRegistered = true;

    const manifestRes = await fetch(`${viewerUrl}/manifest.webmanifest`);
    if (!manifestRes.ok) fail(`PWA manifest not fetchable: ${manifestRes.status}`);
    const manifestBody = await manifestRes.json();
    if (manifestBody.display !== 'standalone') fail(`manifest display is not standalone: ${manifestBody.display}`);
    summary.pwaManifestOk = true;

    // --- PWA cache-storage boundary: /api/ responses must never land in cache storage ---
    const apiCached = await page.evaluate(async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        if (requests.some((r) => new URL(r.url).pathname.startsWith('/api/'))) return true;
      }
      return false;
    });
    if (apiCached) fail('an /api/ response was found in service-worker cache storage - evidence must never be cached as authoritative');
    summary.apiNeverCached = true;

    // --- HARD GATE: after the server stops, a reload must never present stale evidence as current ---
    const exitPromise = new Promise((resolve) => viewerProcess.once('exit', (code, signal) => resolve({ code, signal })));
    viewerProcess.kill();
    const exitResult = await Promise.race([exitPromise, delay(10_000).then(() => undefined)]);
    if (exitResult === undefined) fail(`viewer process (pid ${viewerProcess.pid}, killed=${viewerProcess.killed}) did not exit after kill() within 10s`);

    await page.reload({ waitUntil: 'load' }).catch(() => {});
    await delay(500);
    const postDownIndexRes = await fetch(`${viewerUrl}/api/index`).catch((err) => ({ ok: false, networkError: String(err) }));
    if (postDownIndexRes.ok) fail('server-down gate: /api/index unexpectedly still reachable after the viewer process was killed');
    summary.serverDownStaleEvidenceGatePassed = true;

    await page.close();

    console.log('PACKED VIEWER SMOKE: PASS');
    summary.result = 'PASS';
  } finally {
    try {
      await browser?.close();
    } catch {
      /* best-effort */
    }
    try {
      if (viewerProcess && viewerProcess.exitCode === null) viewerProcess.kill();
    } catch {
      /* best-effort */
    }
    try {
      await new Promise((resolve) => (fixtureServer ? fixtureServer.close(() => resolve()) : resolve()));
    } catch {
      /* best-effort */
    }
    await rm(consumerDir, { recursive: true, force: true }).catch(() => {});
    if (outPath) {
      await writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8').catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = process.exitCode || 1;
});
