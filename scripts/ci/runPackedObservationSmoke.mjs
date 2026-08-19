#!/usr/bin/env node
// Cross-platform (Windows/Linux/macOS) readiness-only smoke helper.
//
// Proves that the actual packed npm tarball - not the source checkout -
// installs, exposes its bin, launches real Chromium, performs a real
// observation against a disposable local HTTP target, and produces a valid
// portable artifact. Exits nonzero on any contract failure so CI can gate on
// it directly. This is test/readiness infrastructure only: it is never
// imported by production code and is not itself part of the npm package
// (see package.json "files").
//
// Usage: node scripts/ci/runPackedObservationSmoke.mjs <path-to-tarball> [--out <summary-json-path>]

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function fail(message) {
  console.error(`SMOKE FAILURE: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', ...opts });
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
  const args = process.argv.slice(2);
  const tarballArg = args.find((a) => !a.startsWith('--'));
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;

  if (!tarballArg) fail('usage: runPackedObservationSmoke.mjs <path-to-tarball> [--out <summary-json-path>]');
  const tarballPath = path.resolve(tarballArg);

  const consumerDir = await mkdtemp(path.join(tmpdir(), 'mfo-ci-smoke-'));
  const summary = { platform: process.platform, arch: process.arch, nodeVersion: process.version };

  // Hoisted so the outer `finally` can always close it, even if a fail()
  // throws before reaching the original inline `server.close()` call below -
  // otherwise a still-listening HTTP server keeps the process alive
  // indefinitely on any failure path between server startup and that line.
  let server;
  // Snapshotted before any smoke work touches the current working directory,
  // so the v0.5 repo-root-leak check below can prove this run itself wrote
  // nothing new there, rather than asserting the repo root is pristine
  // (which would false-fail on unrelated pre-existing local directories).
  const initialCwdEntries = new Set(await readdir(process.cwd()).catch(() => []));

  try {
    await writeFile(path.join(consumerDir, 'package.json'), JSON.stringify({ name: 'mfo-ci-smoke-consumer', version: '0.0.0', private: true }, null, 2));

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    console.log(`[t+0ms] installing candidate tarball with ${npmCmd}...`);
    const t0 = Date.now();
    const install = await run(npmCmd, ['install', tarballPath, '--no-audit', '--no-fund'], { cwd: consumerDir });
    console.log(`[t+${Date.now() - t0}ms] npm install exit=${install.code}`);
    if (install.code !== 0) fail(`npm install of candidate tarball failed:\n${install.stdout}\n${install.stderr}`);

    const installedPkgPath = path.join(consumerDir, 'node_modules', 'my-frontend-observer', 'package.json');
    console.log(`checking installed package at ${installedPkgPath}`);
    const installedPkg = JSON.parse(await readFile(installedPkgPath, 'utf8'));
    const binName = Object.keys(installedPkg.bin ?? {})[0];
    if (!binName) fail('installed package.json has no bin entry');
    const binRelativePath = installedPkg.bin[binName];
    const binAbsolutePath = path.join(consumerDir, 'node_modules', 'my-frontend-observer', binRelativePath);
    summary.binName = binName;
    summary.packageVersion = installedPkg.version;
    console.log(`binName=${binName} packageVersion=${installedPkg.version} binPath=${binAbsolutePath}`);

    // Resolve and invoke the installed bin's real file directly via `node`, rather than through
    // `npx --no-install <name>`: npx's local-only bin resolution proved unreliable in this
    // environment (observed returning exit 0 with completely empty stdout/stderr on macOS/Linux
    // hosted runners, i.e. silently not running anything). Invoking `node <installed-dist-file>`
    // still exercises exactly the installed tarball's own compiled code - never the source
    // checkout - just without routing through npx's shim resolution.
    function runBin(binArgs) {
      // shell:false - process.execPath may contain spaces (e.g. "C:\Program Files\nodejs\node.exe"),
      // which a shell:true invocation would mis-tokenize; spawning the real executable directly needs no shell.
      return run(process.execPath, [binAbsolutePath, ...binArgs], { cwd: consumerDir, shell: false });
    }

    const pwVersion = installedPkg.dependencies?.playwright;
    summary.playwrightDependencyRange = pwVersion ?? null;

    const playwrightPkgPath = path.join(consumerDir, 'node_modules', 'playwright', 'package.json');
    const playwrightPkg = JSON.parse(await readFile(playwrightPkgPath, 'utf8'));
    const playwrightCliRelative = playwrightPkg.bin?.playwright;
    if (!playwrightCliRelative) fail('installed playwright package.json has no "playwright" bin entry');
    const playwrightCliPath = path.join(consumerDir, 'node_modules', 'playwright', playwrightCliRelative);

    console.log(`[t+${Date.now() - t0}ms] installing Chromium via consumer-local playwright (${playwrightCliPath})...`);
    const pwInstall = await run(process.execPath, [playwrightCliPath, 'install', 'chromium', ...(process.platform === 'linux' ? ['--with-deps'] : [])], {
      cwd: consumerDir,
      shell: false,
    });
    console.log(`[t+${Date.now() - t0}ms] playwright install chromium exit=${pwInstall.code}`);
    if (pwInstall.code !== 0) fail(`playwright install chromium failed:\n${pwInstall.stdout}\n${pwInstall.stderr}`);

    const versionRes = await runBin(['--version']);
    console.log(`[t+${Date.now() - t0}ms] --version exit=${versionRes.code} stdout=${JSON.stringify(versionRes.stdout)} stderr=${JSON.stringify(versionRes.stderr)}`);
    if (versionRes.code !== 0 || versionRes.stdout.trim().length === 0) fail(`--version failed or empty (exit ${versionRes.code}):\nstdout:\n${versionRes.stdout}\nstderr:\n${versionRes.stderr}`);
    summary.versionOutput = versionRes.stdout.trim();

    const helpRes = await runBin(['--help']);
    console.log(`[t+${Date.now() - t0}ms] --help exit=${helpRes.code} stdoutLength=${helpRes.stdout.length}`);
    if (helpRes.code !== 0 || helpRes.stdout.trim().length === 0) fail(`--help failed or empty (exit ${helpRes.code}):\nstdout:\n${helpRes.stdout}\nstderr:\n${helpRes.stderr}`);

    const observeHelpRes = await runBin(['observe', '--help']);
    console.log(`[t+${Date.now() - t0}ms] observe --help exit=${observeHelpRes.code} stdoutLength=${observeHelpRes.stdout.length}`);
    if (observeHelpRes.code !== 0) fail(`observe --help failed:\n${observeHelpRes.stderr}`);

    // v0.4: the installed candidate must expose "compare" alongside "observe".
    const compareHelpRes = await runBin(['compare', '--help']);
    console.log(`[t+${Date.now() - t0}ms] compare --help exit=${compareHelpRes.code} stdoutLength=${compareHelpRes.stdout.length}`);
    if (compareHelpRes.code !== 0) fail(`compare --help failed:\n${compareHelpRes.stderr}`);
    for (const flag of ['--before', '--after', '--output', '--config-file']) {
      if (!compareHelpRes.stdout.includes(flag)) fail(`compare --help missing expected flag documentation: ${flag}`);
    }

    // v0.5: the installed candidate must expose the frontend-contract commands too.
    const approveBaselineHelpRes = await runBin(['approve-baseline', '--help']);
    console.log(`[t+${Date.now() - t0}ms] approve-baseline --help exit=${approveBaselineHelpRes.code} stdoutLength=${approveBaselineHelpRes.stdout.length}`);
    if (approveBaselineHelpRes.code !== 0) fail(`approve-baseline --help failed:\n${approveBaselineHelpRes.stderr}`);
    for (const flag of ['--observation', '--contract-file', '--output']) {
      if (!approveBaselineHelpRes.stdout.includes(flag)) fail(`approve-baseline --help missing expected flag documentation: ${flag}`);
    }

    const saveChangeContractHelpRes = await runBin(['save-change-contract', '--help']);
    console.log(`[t+${Date.now() - t0}ms] save-change-contract --help exit=${saveChangeContractHelpRes.code} stdoutLength=${saveChangeContractHelpRes.stdout.length}`);
    if (saveChangeContractHelpRes.code !== 0) fail(`save-change-contract --help failed:\n${saveChangeContractHelpRes.stderr}`);
    for (const flag of ['--contract-file', '--output']) {
      if (!saveChangeContractHelpRes.stdout.includes(flag)) fail(`save-change-contract --help missing expected flag documentation: ${flag}`);
    }

    const evaluateContractHelpRes = await runBin(['evaluate-contract', '--help']);
    console.log(`[t+${Date.now() - t0}ms] evaluate-contract --help exit=${evaluateContractHelpRes.code} stdoutLength=${evaluateContractHelpRes.stdout.length}`);
    if (evaluateContractHelpRes.code !== 0) fail(`evaluate-contract --help failed:\n${evaluateContractHelpRes.stderr}`);
    for (const flag of ['--before', '--after', '--comparison', '--baseline', '--change', '--output', '--enforce']) {
      if (!evaluateContractHelpRes.stdout.includes(flag)) fail(`evaluate-contract --help missing expected flag documentation: ${flag}`);
    }
    summary.v05HelpCommandsExposed = true;

    // v0.5 purity check: the resolved bin path must come from this temporary
    // consumer's own installed node_modules, never the repository checkout
    // this script itself lives in.
    if (binAbsolutePath.includes(path.resolve('.')) || binAbsolutePath.includes('src' + path.sep)) {
      fail('resolved installed bin unexpectedly points at the source checkout rather than the installed candidate');
    }

    const html =
      '<!doctype html><html><head><title>ci smoke fixture</title><style>' +
      'html,body{margin:0;padding:0}' +
      'body{width:100%;height:2000px}' +
      '#panel{position:absolute;top:20px;left:300px;width:200px;height:150px;overflow:auto}' +
      '#panel-content{width:180px;height:900px}' +
      '</style></head><body>' +
      '<header id="header">Header</header><main id="main">Main</main>' +
      '<nav aria-label="Primary"><a href="#">Home</a></nav>' +
      '<button type="button">Run</button>' +
      '<div id="panel"><div id="panel-content">Panel scrollable content</div></div>' +
      '</body></html>';

    // v0.4: same-logical-URL, in-process-toggleable fixture for the compare
    // smoke below. "navigation" stays fixed; "workspace" moves+resizes
    // between variants, deterministically crossing from does-not-overlap/
    // left-of into overlaps/horizontally-overlapping - large enough to
    // exceed the default 0.5px geometry tolerance on every platform, using
    // only explicit integer CSS pixel positions (no font-dependent layout).
    let compareVariant = 'before';
    function compareFixtureHtml() {
      const workspace = compareVariant === 'before' ? { left: 200, width: 300, height: 100 } : { left: 100, width: 350, height: 140 };
      return (
        '<!doctype html><html><head><title>compare smoke fixture</title><style>' +
        'html,body{margin:0;padding:0}' +
        '#navigation{position:absolute;top:0;left:0;width:140px;height:40px;}' +
        `#workspace{position:absolute;top:0;left:${workspace.left}px;width:${workspace.width}px;height:${workspace.height}px;}` +
        '</style></head><body>' +
        '<div id="navigation">Navigation</div><div id="workspace">Workspace</div>' +
        '</body></html>'
      );
    }

    // v0.5: same-logical-URL, in-process-toggleable fixture for the packed
    // frontend-contract smoke below. Deliberately spaced (workspace ends at
    // 210+560=770, well left of rail's fixed left:800) so only the intended
    // navigation/workspace/rail resized/clipping-changed differences occur -
    // never an incidental relationship-family change - mirroring
    // tests/fixtures/server.ts's `/contract` route design. "navigation"
    // contains a fixed 190px-wide inner element inside an
    // "overflow:hidden" outer box, so shrinking the outer box below 190px
    // produces genuine v0.4 clipping (scrollWidth > clientWidth AND
    // overflow:hidden), never a fabricated clipping claim.
    const CONTRACT_NAV_WIDTH = { baseline: 200, success: 195, 'protected-regression': 140 };
    const CONTRACT_WORKSPACE_WIDTH = { baseline: 500, success: 560, 'protected-regression': 560 };
    const CONTRACT_RAIL_WIDTH = { baseline: 150, success: 150, 'protected-regression': 130 };
    let contractVariant = 'baseline';
    function contractFixtureHtml() {
      const navWidth = CONTRACT_NAV_WIDTH[contractVariant];
      const workspaceWidth = CONTRACT_WORKSPACE_WIDTH[contractVariant];
      const railWidth = CONTRACT_RAIL_WIDTH[contractVariant];
      return (
        '<!doctype html><html><head><title>contract smoke fixture</title><style>' +
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

    server = createServer((req, res) => {
      if (req.url === '/smoke') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html);
        return;
      }
      if (req.url === '/compare-smoke') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(compareFixtureHtml());
        return;
      }
      if (req.url === '/contract-smoke') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(contractFixtureHtml());
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const targetUrl = `http://127.0.0.1:${port}/smoke`;
    const compareTargetUrl = `http://127.0.0.1:${port}/compare-smoke`;
    const contractTargetUrl = `http://127.0.0.1:${port}/contract-smoke`;

    const beforeHtml = await fetch(targetUrl).then((r) => r.text());

    // --- Observation 1: legacy CSS --target shorthand (v0.1 packed-compatibility evidence). ---
    const cssOutputSubdir = `ci-smoke-output-css-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cssOutputSubdir), { recursive: true });

    const cssObserveRes = await runBin([
      'observe',
      '--url', targetUrl,
      '--viewport', '1024x768',
      '--target', 'header=#header',
      '--target', 'main=#main',
      '--output', cssOutputSubdir,
    ]);

    console.log('--- css observe stdout ---');
    console.log(cssObserveRes.stdout);
    console.log('--- css observe stderr ---');
    console.log(cssObserveRes.stderr);
    console.log(`--- css observe exit code: ${cssObserveRes.code} ---`);
    if (cssObserveRes.code !== 0) fail(`legacy CSS observe failed (exit ${cssObserveRes.code}):\n${cssObserveRes.stdout}\n${cssObserveRes.stderr}`);

    const requiredLines = ['Observation:', 'State:', 'Artifact:', 'Targets:', 'Diagnostics:'];
    for (const prefix of requiredLines) {
      if (!cssObserveRes.stdout.includes(prefix)) {
        fail(`css observe stdout missing expected "${prefix}" line. Full stdout:\n${cssObserveRes.stdout}\nFull stderr:\n${cssObserveRes.stderr}`);
      }
    }

    const cssArtifactLine = cssObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const cssArtifactRoot = cssArtifactLine.slice('Artifact: '.length).trim();
    summary.cssArtifactRoot = cssArtifactRoot;

    const cssManifest = JSON.parse(await readFile(path.join(cssArtifactRoot, 'manifest.json'), 'utf8'));
    const cssScreenshot = await readFile(path.join(cssArtifactRoot, 'screenshot.png'));

    if (cssManifest.schemaVersion !== '1.2.0') fail(`unexpected schemaVersion (css observation): ${cssManifest.schemaVersion}`);
    if (cssManifest.artifactKind !== 'my-frontend-observer/observation') fail(`unexpected artifactKind (css observation): ${cssManifest.artifactKind}`);
    if (typeof cssManifest.observationId !== 'string' || cssManifest.observationId.length === 0) fail('missing observationId (css observation)');
    if (typeof cssManifest.requestId !== 'string' || cssManifest.requestId.length === 0) fail('missing requestId (css observation)');
    if (cssManifest.browser?.state !== 'available') fail('missing browser provenance (css observation)');
    if (!cssManifest.pageEvidence || Object.keys(cssManifest.pageEvidence).length === 0) fail('missing page evidence (css observation)');
    if (!cssManifest.targetEvidence || Object.keys(cssManifest.targetEvidence).length === 0) fail('missing target evidence (css observation)');
    const cssScreenshotRef = cssManifest.artifactReferences?.find((r) => r.kind === 'screenshot');
    if (!cssScreenshotRef || path.isAbsolute(cssScreenshotRef.path) || cssScreenshotRef.path.includes(':')) fail('css screenshot artifact reference is not relative');
    if (cssScreenshot.length === 0) fail('css screenshot.png is empty');
    if (!isPngSignature(new Uint8Array(cssScreenshot))) fail('css screenshot.png is not a valid PNG');

    // --- Observation 2: v0.2 structured --targets-file, real semantic (non-CSS) locators. ---
    const targetsFilePath = path.join(consumerDir, 'targets.json');
    await writeFile(
      targetsFilePath,
      JSON.stringify({
        targets: [
          { name: 'primary-navigation', locators: [{ kind: 'role', role: 'navigation', name: 'Primary' }] },
          { name: 'action', locators: [{ kind: 'text', text: 'Run' }] },
        ],
      }),
      'utf8',
    );

    const semanticOutputSubdir = `ci-smoke-output-semantic-${randomUUID()}`;
    await mkdir(path.join(consumerDir, semanticOutputSubdir), { recursive: true });

    const semanticObserveRes = await runBin([
      'observe',
      '--url', targetUrl,
      '--viewport', '1024x768',
      '--targets-file', targetsFilePath,
      '--output', semanticOutputSubdir,
    ]);

    summary.observeExitCode = semanticObserveRes.code;
    summary.observeStdout = semanticObserveRes.stdout;
    summary.observeStderr = semanticObserveRes.stderr;
    console.log('--- semantic observe stdout ---');
    console.log(semanticObserveRes.stdout);
    console.log('--- semantic observe stderr ---');
    console.log(semanticObserveRes.stderr);
    console.log(`--- semantic observe exit code: ${semanticObserveRes.code} ---`);
    if (semanticObserveRes.code !== 0) fail(`semantic --targets-file observe failed (exit ${semanticObserveRes.code}):\n${semanticObserveRes.stdout}\n${semanticObserveRes.stderr}`);

    for (const prefix of requiredLines) {
      if (!semanticObserveRes.stdout.includes(prefix)) {
        fail(`semantic observe stdout missing expected "${prefix}" line. Full stdout:\n${semanticObserveRes.stdout}\nFull stderr:\n${semanticObserveRes.stderr}`);
      }
    }

    const artifactLine = semanticObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const artifactRoot = artifactLine.slice('Artifact: '.length).trim();
    summary.artifactRoot = artifactRoot;

    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8'));
    const screenshot = await readFile(path.join(artifactRoot, 'screenshot.png'));

    if (manifest.schemaVersion !== '1.2.0') fail(`unexpected schemaVersion: ${manifest.schemaVersion}`);
    if (manifest.artifactKind !== 'my-frontend-observer/observation') fail(`unexpected artifactKind: ${manifest.artifactKind}`);
    if (typeof manifest.observationId !== 'string' || manifest.observationId.length === 0) fail('missing observationId');
    if (typeof manifest.requestId !== 'string' || manifest.requestId.length === 0) fail('missing requestId');
    if (manifest.browser?.state !== 'available') fail('missing browser provenance');
    if (!manifest.pageEvidence || Object.keys(manifest.pageEvidence).length === 0) fail('missing page evidence');
    if (!manifest.targetEvidence || Object.keys(manifest.targetEvidence).length === 0) fail('missing target evidence');
    const screenshotRef = manifest.artifactReferences?.find((r) => r.kind === 'screenshot');
    if (!screenshotRef || path.isAbsolute(screenshotRef.path) || screenshotRef.path.includes(':')) fail('screenshot artifact reference is not relative');
    if (screenshot.length === 0) fail('screenshot.png is empty');
    if (!isPngSignature(new Uint8Array(screenshot))) fail('screenshot.png is not a valid PNG');

    // Structured targets preserved in requestConfig (names + canonical locator shape).
    const configuredTargetNames = (manifest.requestConfig?.targets ?? []).map((t) => t.name);
    if (JSON.stringify(configuredTargetNames) !== JSON.stringify(['primary-navigation', 'action'])) {
      fail(`requestConfig.targets names not preserved in order: ${JSON.stringify(configuredTargetNames)}`);
    }

    // Semantic locator resolution: both configured targets must have actually matched.
    const navRecord = manifest.targetEvidence['primary-navigation'];
    const actionRecord = manifest.targetEvidence['action'];
    if (navRecord?.resolution?.value?.selectionStatus !== 'matched') fail('primary-navigation (role locator) did not resolve');
    if (navRecord?.resolution?.value?.selectedLocatorKind !== 'role') fail('primary-navigation selected-locator provenance missing/wrong');
    if (actionRecord?.resolution?.value?.selectionStatus !== 'matched') fail('action (text locator) did not resolve');
    if (actionRecord?.resolution?.value?.selectedLocatorKind !== 'text') fail('action selected-locator provenance missing/wrong');

    // Semantic role/name evidence and derived landmark, where the fixture supports them.
    if (navRecord?.semantics?.value?.role !== 'navigation') fail('primary-navigation semantic role not persisted');
    if (navRecord?.landmark?.value !== 'navigation') fail('primary-navigation landmark evidence not persisted');

    // Target-file path privacy: the temporary absolute targets-file path must never be serialized.
    const serializedManifest = JSON.stringify(manifest);
    if (serializedManifest.includes(targetsFilePath) || serializedManifest.includes('targets.json')) {
      fail('targets-file path leaked into persisted manifest');
    }

    // --- Observation 3: v0.3 --scroll-scenario-file, window-scroll-by (packed-candidate proof). ---
    const windowScenarioPath = path.join(consumerDir, 'window-scroll.json');
    await writeFile(windowScenarioPath, JSON.stringify({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 500 } }), 'utf8');
    const windowOutputSubdir = `ci-smoke-output-window-scroll-${randomUUID()}`;
    await mkdir(path.join(consumerDir, windowOutputSubdir), { recursive: true });

    const windowObserveRes = await runBin([
      'observe',
      '--url', targetUrl,
      '--viewport', '1024x768',
      '--scroll-scenario-file', windowScenarioPath,
      '--output', windowOutputSubdir,
    ]);
    console.log('--- window-scroll observe stdout ---');
    console.log(windowObserveRes.stdout);
    console.log(`--- window-scroll observe exit code: ${windowObserveRes.code} ---`);
    if (windowObserveRes.code !== 0) fail(`window-scroll-by observe failed (exit ${windowObserveRes.code}):\n${windowObserveRes.stdout}\n${windowObserveRes.stderr}`);
    for (const prefix of requiredLines) {
      if (!windowObserveRes.stdout.includes(prefix)) fail(`window-scroll observe stdout missing expected "${prefix}" line`);
    }

    const windowArtifactLine = windowObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const windowArtifactRoot = windowArtifactLine.slice('Artifact: '.length).trim();
    const windowManifest = JSON.parse(await readFile(path.join(windowArtifactRoot, 'manifest.json'), 'utf8'));
    const windowScreenshot = await readFile(path.join(windowArtifactRoot, 'screenshot.png'));

    if (windowManifest.schemaVersion !== '1.2.0') fail(`unexpected schemaVersion (window scenario): ${windowManifest.schemaVersion}`);
    if (windowManifest.requestConfig?.scrollScenario?.action?.kind !== 'window-scroll-by') fail('window-scroll-by scenario not persisted into requestConfig');
    const windowEvidence = windowManifest.scrollScenarioEvidence;
    if (!windowEvidence) fail('scrollScenarioEvidence missing from window-scroll-by manifest');
    if (typeof windowEvidence.initial?.window?.scrollY !== 'number') fail('missing initial.window.scrollY (window scenario)');
    if (typeof windowEvidence.final?.window?.scrollY !== 'number') fail('missing final.window.scrollY (window scenario)');
    if (windowEvidence.final.window.scrollY === windowEvidence.initial.window.scrollY) fail('window.scrollY did not change after window-scroll-by');
    if (!windowEvidence.transition) fail('missing scenario transition evidence (window scenario)');
    if (windowEvidence.scrollOwner?.value?.kind !== 'document') fail(`expected scrollOwner document, got ${JSON.stringify(windowEvidence.scrollOwner)}`);
    if (windowEvidence.scrollOwner?.source !== 'derived') fail('window scrollOwner source is not "derived"');
    if (!Array.isArray(windowEvidence.scrollOwner?.derivedFrom) || windowEvidence.scrollOwner.derivedFrom.length === 0) fail('window scrollOwner derivedFrom is empty');
    if (windowManifest.pageEvidence?.windowScrollY?.value !== windowEvidence.final.window.scrollY) {
      fail('ordinary pageEvidence.windowScrollY does not agree with scrollScenarioEvidence.final.window.scrollY');
    }
    const windowScreenshotRef = windowManifest.artifactReferences?.find((r) => r.kind === 'screenshot');
    if (!windowScreenshotRef || path.isAbsolute(windowScreenshotRef.path) || windowScreenshotRef.path.includes(':')) fail('window screenshot artifact reference is not relative');
    if (windowScreenshot.length === 0 || !isPngSignature(new Uint8Array(windowScreenshot))) fail('window scenario screenshot.png is missing/invalid');
    const serializedWindowManifest = JSON.stringify(windowManifest);
    if (serializedWindowManifest.includes(windowScenarioPath) || serializedWindowManifest.includes('window-scroll.json')) {
      fail('scroll-scenario-file path leaked into persisted window-scroll manifest');
    }

    // --- Observation 4: v0.3 --targets-file + --scroll-scenario-file, target-scroll-by (packed-candidate proof). ---
    const scrollTargetsFilePath = path.join(consumerDir, 'scroll-targets.json');
    await writeFile(scrollTargetsFilePath, JSON.stringify({ targets: [{ name: 'tool-workspace', locators: [{ kind: 'id', value: 'panel' }] }] }), 'utf8');
    const targetScenarioPath = path.join(consumerDir, 'target-scroll.json');
    await writeFile(targetScenarioPath, JSON.stringify({ action: { kind: 'target-scroll-by', target: 'tool-workspace', deltaX: 0, deltaY: 300 } }), 'utf8');
    const targetScrollOutputSubdir = `ci-smoke-output-target-scroll-${randomUUID()}`;
    await mkdir(path.join(consumerDir, targetScrollOutputSubdir), { recursive: true });

    const targetScrollObserveRes = await runBin([
      'observe',
      '--url', targetUrl,
      '--viewport', '1024x768',
      '--targets-file', scrollTargetsFilePath,
      '--scroll-scenario-file', targetScenarioPath,
      '--output', targetScrollOutputSubdir,
    ]);
    console.log('--- target-scroll observe stdout ---');
    console.log(targetScrollObserveRes.stdout);
    console.log(`--- target-scroll observe exit code: ${targetScrollObserveRes.code} ---`);
    if (targetScrollObserveRes.code !== 0) fail(`target-scroll-by observe failed (exit ${targetScrollObserveRes.code}):\n${targetScrollObserveRes.stdout}\n${targetScrollObserveRes.stderr}`);
    for (const prefix of requiredLines) {
      if (!targetScrollObserveRes.stdout.includes(prefix)) fail(`target-scroll observe stdout missing expected "${prefix}" line`);
    }

    const targetScrollArtifactLine = targetScrollObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: '));
    const targetScrollArtifactRoot = targetScrollArtifactLine.slice('Artifact: '.length).trim();
    const targetScrollManifest = JSON.parse(await readFile(path.join(targetScrollArtifactRoot, 'manifest.json'), 'utf8'));
    const targetScrollScreenshot = await readFile(path.join(targetScrollArtifactRoot, 'screenshot.png'));

    if (targetScrollManifest.schemaVersion !== '1.2.0') fail(`unexpected schemaVersion (target scenario): ${targetScrollManifest.schemaVersion}`);
    if (targetScrollManifest.requestConfig?.scrollScenario?.action?.target !== 'tool-workspace') fail('target-scroll-by stable target name not persisted');
    const targetScrollEvidence = targetScrollManifest.scrollScenarioEvidence;
    if (!targetScrollEvidence) fail('scrollScenarioEvidence missing from target-scroll-by manifest');
    const twInitial = targetScrollEvidence.initial?.targets?.['tool-workspace'];
    const twFinal = targetScrollEvidence.final?.targets?.['tool-workspace'];
    if (typeof twInitial?.metrics?.value?.scrollTop !== 'number') fail('missing initial target scrollTop (target scenario)');
    if (typeof twFinal?.metrics?.value?.scrollTop !== 'number') fail('missing final target scrollTop (target scenario)');
    if (twFinal.metrics.value.scrollTop === twInitial.metrics.value.scrollTop) fail('target scrollTop did not change after target-scroll-by');
    if (twInitial?.overflow?.value?.verticalOverflow !== true) fail('expected actual vertical overflow on the nested scroll target');
    if (targetScrollEvidence.final?.window?.scrollY !== targetScrollEvidence.initial?.window?.scrollY) fail('window.scrollY changed for a target-only scroll');
    if (targetScrollEvidence.scrollOwner?.value?.kind !== 'target' || targetScrollEvidence.scrollOwner?.value?.target !== 'tool-workspace') {
      fail(`expected scrollOwner target:tool-workspace, got ${JSON.stringify(targetScrollEvidence.scrollOwner)}`);
    }
    if (targetScrollEvidence.scrollOwner?.source !== 'derived') fail('target scrollOwner source is not "derived"');
    if (!targetScrollEvidence.transition) fail('missing scenario transition evidence (target scenario)');
    if (!targetScrollManifest.targetEvidence?.['tool-workspace']) fail('final ordinary targetEvidence missing for tool-workspace');
    const targetScrollScreenshotRef = targetScrollManifest.artifactReferences?.find((r) => r.kind === 'screenshot');
    if (!targetScrollScreenshotRef || path.isAbsolute(targetScrollScreenshotRef.path) || targetScrollScreenshotRef.path.includes(':')) fail('target-scroll screenshot artifact reference is not relative');
    if (targetScrollScreenshot.length === 0 || !isPngSignature(new Uint8Array(targetScrollScreenshot))) fail('target scenario screenshot.png is missing/invalid');
    const serializedTargetScrollManifest = JSON.stringify(targetScrollManifest);
    if (
      serializedTargetScrollManifest.includes(scrollTargetsFilePath) ||
      serializedTargetScrollManifest.includes('scroll-targets.json') ||
      serializedTargetScrollManifest.includes(targetScenarioPath) ||
      serializedTargetScrollManifest.includes('target-scroll.json')
    ) {
      fail('targets-file or scroll-scenario-file path leaked into persisted target-scroll manifest');
    }

    // --- v0.4: installed "compare" against two installed-"observe" artifacts (comparable case). ---
    const compareTargetArgs = ['--target', 'navigation=#navigation', '--target', 'workspace=#workspace'];

    compareVariant = 'before';
    const cmpBeforeOutputSubdir = `ci-smoke-output-cmp-before-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cmpBeforeOutputSubdir), { recursive: true });
    const cmpBeforeObserveRes = await runBin(['observe', '--url', compareTargetUrl, '--viewport', '800x600', ...compareTargetArgs, '--output', cmpBeforeOutputSubdir]);
    if (cmpBeforeObserveRes.code !== 0) fail(`compare-fixture "before" observe failed (exit ${cmpBeforeObserveRes.code}):\n${cmpBeforeObserveRes.stdout}\n${cmpBeforeObserveRes.stderr}`);
    const cmpBeforeRoot = cmpBeforeObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();

    compareVariant = 'after';
    const cmpAfterOutputSubdir = `ci-smoke-output-cmp-after-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cmpAfterOutputSubdir), { recursive: true });
    const cmpAfterObserveRes = await runBin(['observe', '--url', compareTargetUrl, '--viewport', '800x600', ...compareTargetArgs, '--output', cmpAfterOutputSubdir]);
    if (cmpAfterObserveRes.code !== 0) fail(`compare-fixture "after" observe failed (exit ${cmpAfterObserveRes.code}):\n${cmpAfterObserveRes.stdout}\n${cmpAfterObserveRes.stderr}`);
    const cmpAfterRoot = cmpAfterObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();

    // Source-immutability baseline: hash both source observations' manifest+screenshot bytes before comparing.
    const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
    const cmpBeforeManifestRaw0 = await readFile(path.join(cmpBeforeRoot, 'manifest.json'));
    const cmpBeforeScreenshotRaw0 = await readFile(path.join(cmpBeforeRoot, 'screenshot.png'));
    const cmpAfterManifestRaw0 = await readFile(path.join(cmpAfterRoot, 'manifest.json'));
    const cmpAfterScreenshotRaw0 = await readFile(path.join(cmpAfterRoot, 'screenshot.png'));
    const preCompareHashes = {
      beforeManifest: sha256(cmpBeforeManifestRaw0),
      beforeScreenshot: sha256(cmpBeforeScreenshotRaw0),
      afterManifest: sha256(cmpAfterManifestRaw0),
      afterScreenshot: sha256(cmpAfterScreenshotRaw0),
    };

    const compareConfigPath = path.join(consumerDir, 'compare-config.json');
    await writeFile(
      compareConfigPath,
      JSON.stringify({
        geometryTolerancePx: 0.5,
        expectedDependencies: [
          {
            cause: { target: 'navigation', property: 'width', direction: 'unchanged' },
            effect: { target: 'workspace', property: 'width', direction: 'increase' },
            source: 'explicit-config',
          },
        ],
      }),
      'utf8',
    );

    const cmpOutputSubdir = `ci-smoke-output-cmp-result-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cmpOutputSubdir), { recursive: true });
    const cmpRes = await runBin(['compare', '--before', cmpBeforeRoot, '--after', cmpAfterRoot, '--output', cmpOutputSubdir, '--config-file', compareConfigPath]);
    console.log('--- compare (comparable) stdout ---');
    console.log(cmpRes.stdout);
    console.log(`--- compare (comparable) exit code: ${cmpRes.code} ---`);
    if (cmpRes.code !== 0) fail(`comparable compare failed (exit ${cmpRes.code}):\n${cmpRes.stdout}\n${cmpRes.stderr}`);
    for (const prefix of ['Comparison:', 'State:', 'Artifact:', 'Differences:', 'Relationship changes:', 'Diagnostics:']) {
      if (!cmpRes.stdout.includes(prefix)) fail(`comparable compare stdout missing expected "${prefix}" line`);
    }

    const cmpArtifactRoot = cmpRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cmpManifest = JSON.parse(await readFile(path.join(cmpArtifactRoot, 'manifest.json'), 'utf8'));

    // Installed-package-independence: resolve isValidComparisonArtifact/isValidObservationArtifact
    // from the *consumer's own* node_modules, not the source checkout, and validate the real
    // persisted manifest through it (never manual key inspection only).
    const installedIndexPath = path.join(consumerDir, 'node_modules', 'my-frontend-observer', 'dist', 'index.js');
    const installedPackageApi = await import(pathToFileURL(installedIndexPath).href);
    if (installedIndexPath.includes(path.resolve('.')) || installedIndexPath.includes('src' + path.sep)) {
      fail('resolved installed package index unexpectedly points at the source checkout');
    }
    if (typeof installedPackageApi.isValidComparisonArtifact !== 'function') fail('installed package does not export isValidComparisonArtifact');
    const cmpValidation = installedPackageApi.isValidComparisonArtifact(cmpManifest);
    if (!cmpValidation.valid) fail(`comparable ComparisonArtifact failed installed-package structural validation: ${cmpValidation.reason}`);
    if (typeof installedPackageApi.isValidObservationArtifact !== 'function') fail('installed package does not export isValidObservationArtifact');
    const cmpBeforeObsValidation = installedPackageApi.isValidObservationArtifact(JSON.parse(cmpBeforeManifestRaw0.toString('utf8')));
    if (!cmpBeforeObsValidation.valid) fail(`before ObservationArtifact failed installed-package structural validation: ${cmpBeforeObsValidation.reason}`);

    if (cmpManifest.artifactKind !== 'my-frontend-observer/comparison') fail(`unexpected comparison artifactKind: ${cmpManifest.artifactKind}`);
    if (cmpManifest.schemaVersion !== '1.0.0') fail(`unexpected comparison schemaVersion: ${cmpManifest.schemaVersion}`);
    if (typeof cmpManifest.comparisonId !== 'string' || cmpManifest.comparisonId.length === 0) fail('missing comparisonId');
    if (typeof cmpManifest.comparisonRequestId !== 'string' || cmpManifest.comparisonRequestId.length === 0) fail('missing comparisonRequestId');
    if (cmpManifest.comparability?.state !== 'comparable') fail(`expected comparability "comparable", got ${JSON.stringify(cmpManifest.comparability)}`);
    if (cmpManifest.before?.observationId !== JSON.parse(cmpBeforeManifestRaw0.toString('utf8')).observationId) fail('before observation reference mismatch');
    if (cmpManifest.after?.observationId !== JSON.parse(cmpAfterManifestRaw0.toString('utf8')).observationId) fail('after observation reference mismatch');
    if (cmpManifest.before?.screenshot?.path !== 'screenshot.png') fail('before screenshot reference missing/incorrect');
    if (cmpManifest.after?.screenshot?.path !== 'screenshot.png') fail('after screenshot reference missing/incorrect');

    // Meaningful target difference: workspace moved AND resized by an explicit, tolerance-exceeding amount.
    const workspaceMoved = cmpManifest.differences?.find((d) => d.kind === 'moved' && d.subject?.type === 'target' && d.subject?.target === 'workspace');
    if (!workspaceMoved) fail('expected a "moved" difference for target "workspace"');
    if (workspaceMoved.before?.x !== 200 || workspaceMoved.after?.x !== 100 || workspaceMoved.delta?.x !== -100) {
      fail(`unexpected moved-difference values: ${JSON.stringify(workspaceMoved)}`);
    }
    const workspaceResized = cmpManifest.differences?.find((d) => d.kind === 'resized' && d.subject?.type === 'target' && d.subject?.target === 'workspace');
    if (!workspaceResized) fail('expected a "resized" difference for target "workspace"');
    if (workspaceResized.before?.width !== 300 || workspaceResized.after?.width !== 350 || workspaceResized.delta?.width !== 50) {
      fail(`unexpected resized-difference values: ${JSON.stringify(workspaceResized)}`);
    }

    // Meaningful relationship change: navigation/workspace crossed from separated to overlapping
    // (guards the v0.4 relationship-family matching regression - both the horizontal-order and
    // area-overlap families change simultaneously for this same pair).
    const relChange = cmpManifest.relationshipChanges?.find(
      (c) => c.scope === 'pairwise' && ((c.subjectTarget === 'navigation' && c.relatedTarget === 'workspace') || (c.subjectTarget === 'workspace' && c.relatedTarget === 'navigation')),
    );
    if (!relChange) fail('expected at least one pairwise relationshipChanges entry for navigation/workspace');
    const relDiff = cmpManifest.differences?.find((d) => d.kind === 'relative-position-changed');
    if (!relDiff) fail('expected a "relative-position-changed" difference for the navigation/workspace transition');
    if (!Array.isArray(relDiff.evidence) || relDiff.evidence.length === 0) fail('relationship-change difference has no supporting evidence references');
    summary.relationshipChangeBefore = relChange.before;
    summary.relationshipChangeAfter = relChange.after;

    // Explicit non-causal dependency evidence: navigation.width unchanged -> workspace.width increases.
    const depEvidence = cmpManifest.expectedDependencyEvidence?.[0];
    if (!depEvidence) fail('expected one expectedDependencyEvidence entry from --config-file');
    if (!['consistent', 'not-observed', 'contradictory-to-declaration', 'unavailable'].includes(depEvidence.outcome)) {
      fail(`unexpected dependency outcome vocabulary: ${depEvidence.outcome}`);
    }
    if (depEvidence.outcome !== 'consistent') fail(`expected dependency outcome "consistent" for this deterministic fixture, got "${depEvidence.outcome}"`);
    const serializedCmpManifestForCausalCheck = JSON.stringify(cmpManifest);
    for (const forbidden of ['causedBy', 'causalConfidence', 'causalScore', 'dependencyStrength', '"PASS"', '"FAIL"']) {
      if (serializedCmpManifestForCausalCheck.includes(forbidden)) fail(`forbidden causal/verdict vocabulary found in comparison manifest: ${forbidden}`);
    }

    // Path privacy: none of the operational absolute paths may appear in the persisted manifest.
    for (const leaked of [cmpBeforeRoot, cmpAfterRoot, compareConfigPath, consumerDir]) {
      if (serializedCmpManifestForCausalCheck.includes(leaked)) fail(`operational filesystem path leaked into comparison manifest: ${leaked}`);
    }

    // Comparison directory layout: manifest.json only, no copied screenshots/side files.
    const cmpDirEntries = await readdir(cmpArtifactRoot);
    if (cmpDirEntries.length !== 1 || cmpDirEntries[0] !== 'manifest.json') {
      fail(`expected comparison directory to contain only manifest.json, got: ${cmpDirEntries.join(', ')}`);
    }

    // Source-observation immutability: re-hash both source observations after comparing.
    const postCompareHashes = {
      beforeManifest: sha256(await readFile(path.join(cmpBeforeRoot, 'manifest.json'))),
      beforeScreenshot: sha256(await readFile(path.join(cmpBeforeRoot, 'screenshot.png'))),
      afterManifest: sha256(await readFile(path.join(cmpAfterRoot, 'manifest.json'))),
      afterScreenshot: sha256(await readFile(path.join(cmpAfterRoot, 'screenshot.png'))),
    };
    if (JSON.stringify(preCompareHashes) !== JSON.stringify(postCompareHashes)) {
      fail(`source observation(s) were modified by compare: before=${JSON.stringify(preCompareHashes)} after=${JSON.stringify(postCompareHashes)}`);
    }

    summary.comparisonArtifactKind = cmpManifest.artifactKind;
    summary.comparisonSchemaVersion = cmpManifest.schemaVersion;
    summary.comparisonComparableState = cmpManifest.comparability.state;
    summary.comparisonTargetDifferenceKinds = Array.from(new Set((cmpManifest.differences ?? []).map((d) => d.kind))).sort();
    summary.comparisonRelationshipChangePresent = true;
    summary.comparisonDependencyOutcome = depEvidence.outcome;
    summary.comparisonPathPrivacyPassed = true;
    summary.comparisonSourceImmutabilityPassed = true;
    summary.comparisonScreenshotReferencesPresent = true;
    summary.comparisonDirectoryLayout = cmpDirEntries;
    summary.comparableCompareOk = true;

    // --- v0.4: installed "compare" for an incompatible pair (incomparable case). ---
    const cmpIncompatibleOutputSubdir = `ci-smoke-output-cmp-incompatible-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cmpIncompatibleOutputSubdir), { recursive: true });
    // compareVariant is still 'after' - deliberately reusing the same rendered content and only
    // changing viewport, so viewport is the *only* comparability dimension that differs.
    const cmpIncompatibleObserveRes = await runBin(['observe', '--url', compareTargetUrl, '--viewport', '600x400', ...compareTargetArgs, '--output', cmpIncompatibleOutputSubdir]);
    if (cmpIncompatibleObserveRes.code !== 0) fail(`incompatible-viewport observe failed (exit ${cmpIncompatibleObserveRes.code}):\n${cmpIncompatibleObserveRes.stdout}\n${cmpIncompatibleObserveRes.stderr}`);
    const cmpIncompatibleRoot = cmpIncompatibleObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();

    const cmpIncomparableOutputSubdir = `ci-smoke-output-cmp-incomparable-result-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cmpIncomparableOutputSubdir), { recursive: true });
    const cmpIncomparableRes = await runBin(['compare', '--before', cmpBeforeRoot, '--after', cmpIncompatibleRoot, '--output', cmpIncomparableOutputSubdir]);
    console.log('--- compare (incomparable) stdout ---');
    console.log(cmpIncomparableRes.stdout);
    console.log(`--- compare (incomparable) exit code: ${cmpIncomparableRes.code} ---`);
    if (cmpIncomparableRes.code !== 0) fail(`incomparable compare unexpectedly exited nonzero (exit ${cmpIncomparableRes.code}):\n${cmpIncomparableRes.stdout}\n${cmpIncomparableRes.stderr}`);

    const cmpIncomparableArtifactRoot = cmpIncomparableRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cmpIncomparableManifest = JSON.parse(await readFile(path.join(cmpIncomparableArtifactRoot, 'manifest.json'), 'utf8'));
    const cmpIncomparableValidation = installedPackageApi.isValidComparisonArtifact(cmpIncomparableManifest);
    if (!cmpIncomparableValidation.valid) fail(`incomparable ComparisonArtifact failed installed-package structural validation: ${cmpIncomparableValidation.reason}`);

    if (cmpIncomparableManifest.artifactKind !== 'my-frontend-observer/comparison') fail('unexpected incomparable artifactKind');
    if (cmpIncomparableManifest.schemaVersion !== '1.0.0') fail('unexpected incomparable schemaVersion');
    if (cmpIncomparableManifest.comparability?.state !== 'incomparable') fail(`expected comparability "incomparable", got ${JSON.stringify(cmpIncomparableManifest.comparability)}`);
    const viewportReason = cmpIncomparableManifest.comparability.reasons?.find((r) => r.code === 'viewport-mismatch');
    if (!viewportReason || viewportReason.severity !== 'blocking') fail(`expected a blocking "viewport-mismatch" comparability reason, got ${JSON.stringify(cmpIncomparableManifest.comparability.reasons)}`);
    if ((cmpIncomparableManifest.differences ?? []).length !== 0) fail(`expected no ordinary differences for an incomparable pair, got ${JSON.stringify(cmpIncomparableManifest.differences)}`);
    if ((cmpIncomparableManifest.relationshipChanges ?? []).length !== 0) fail('expected no relationshipChanges for an incomparable pair');

    summary.comparisonIncomparableState = cmpIncomparableManifest.comparability.state;
    summary.comparisonIncomparableReasonPresent = true;
    summary.incomparableCompareOk = true;

    // --- v0.5: installed "approve-baseline"/"save-change-contract"/"evaluate-contract"
    // against real installed-candidate observe/compare evidence (comparable pair). ---
    const contractTargetArgs = ['--target', 'navigation=#cp-nav', '--target', 'workspace=#cp-workspace', '--target', 'rail=#cp-rail'];

    contractVariant = 'baseline';
    const cpBaselineOutputSubdir = `ci-smoke-output-cp-baseline-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpBaselineOutputSubdir), { recursive: true });
    const cpBaselineObserveRes = await runBin(['observe', '--url', contractTargetUrl, '--viewport', '1000x700', ...contractTargetArgs, '--output', cpBaselineOutputSubdir]);
    if (cpBaselineObserveRes.code !== 0) fail(`contract-fixture baseline observe failed (exit ${cpBaselineObserveRes.code}):\n${cpBaselineObserveRes.stdout}\n${cpBaselineObserveRes.stderr}`);
    const cpBaselineObsRoot = cpBaselineObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cpBaselineManifestRaw0 = await readFile(path.join(cpBaselineObsRoot, 'manifest.json'));
    const cpBaselineScreenshotRaw0 = await readFile(path.join(cpBaselineObsRoot, 'screenshot.png'));
    const cpBaselineManifest = JSON.parse(cpBaselineManifestRaw0.toString('utf8'));

    const baselineContract = {
      artifactKind: 'my-frontend-observer/frontend-contract',
      schemaVersion: '1.0.0',
      contractClass: 'baseline',
      baselineId: 'baseline-1',
      sourceObservation: {
        observationId: cpBaselineManifest.observationId,
        requestId: cpBaselineManifest.requestId,
        producer: cpBaselineManifest.producer,
        observationSchemaVersion: cpBaselineManifest.schemaVersion,
      },
      clauses: [{ clauseId: 'baseline-nav-unclipped', primitive: { kind: 'target-not-clipped', target: 'navigation' }, supportingEvidence: [] }],
      provenance: { approvedAt: new Date(0).toISOString() },
    };
    const baselineContractFilePath = path.join(consumerDir, 'cp-baseline-contract.json');
    await writeFile(baselineContractFilePath, JSON.stringify(baselineContract, null, 2), 'utf8');

    const cpApproveOutputSubdir = `ci-smoke-output-cp-approve-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpApproveOutputSubdir), { recursive: true });
    const cpApproveRes = await runBin(['approve-baseline', '--observation', cpBaselineObsRoot, '--contract-file', baselineContractFilePath, '--output', cpApproveOutputSubdir]);
    console.log('--- approve-baseline stdout ---');
    console.log(cpApproveRes.stdout);
    if (cpApproveRes.code !== 0) fail(`installed approve-baseline failed (exit ${cpApproveRes.code}):\n${cpApproveRes.stdout}\n${cpApproveRes.stderr}`);
    if (!cpApproveRes.stdout.includes('State: approved')) fail(`expected "State: approved" from approve-baseline:\n${cpApproveRes.stdout}`);
    const cpBaselineArtifactRoot = cpApproveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    summary.packedApproveBaselineOk = true;

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
    const changeContractFilePath = path.join(consumerDir, 'cp-change-contract.json');
    await writeFile(changeContractFilePath, JSON.stringify(changeContract, null, 2), 'utf8');

    const cpSaveOutputSubdir = `ci-smoke-output-cp-save-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpSaveOutputSubdir), { recursive: true });
    const cpSaveRes = await runBin(['save-change-contract', '--contract-file', changeContractFilePath, '--output', cpSaveOutputSubdir]);
    console.log('--- save-change-contract stdout ---');
    console.log(cpSaveRes.stdout);
    if (cpSaveRes.code !== 0) fail(`installed save-change-contract failed (exit ${cpSaveRes.code}):\n${cpSaveRes.stdout}\n${cpSaveRes.stderr}`);
    const cpChangeArtifactRoot = cpSaveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    summary.packedSaveChangeContractOk = true;

    // Scenario A: candidate change succeeds fully -> overall PASS, --enforce still exits 0.
    contractVariant = 'success';
    const cpSuccessOutputSubdir = `ci-smoke-output-cp-success-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpSuccessOutputSubdir), { recursive: true });
    const cpSuccessObserveRes = await runBin(['observe', '--url', contractTargetUrl, '--viewport', '1000x700', ...contractTargetArgs, '--output', cpSuccessOutputSubdir]);
    if (cpSuccessObserveRes.code !== 0) fail(`contract-fixture success observe failed (exit ${cpSuccessObserveRes.code}):\n${cpSuccessObserveRes.stdout}\n${cpSuccessObserveRes.stderr}`);
    const cpSuccessObsRoot = cpSuccessObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();

    const cpCompareSuccessOutputSubdir = `ci-smoke-output-cp-compare-success-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpCompareSuccessOutputSubdir), { recursive: true });
    const cpCompareSuccessRes = await runBin(['compare', '--before', cpBaselineObsRoot, '--after', cpSuccessObsRoot, '--output', cpCompareSuccessOutputSubdir]);
    if (cpCompareSuccessRes.code !== 0) fail(`contract-fixture success compare failed (exit ${cpCompareSuccessRes.code}):\n${cpCompareSuccessRes.stdout}\n${cpCompareSuccessRes.stderr}`);
    const cpCompareSuccessRoot = cpCompareSuccessRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cpCompareSuccessManifest = JSON.parse(await readFile(path.join(cpCompareSuccessRoot, 'manifest.json'), 'utf8'));
    if (cpCompareSuccessManifest.comparability.state !== 'comparable') fail(`expected comparable for contract-fixture success pair, got ${cpCompareSuccessManifest.comparability.state}`);
    summary.packedComparableUsedForContractOk = true;

    const cpEvalPassOutputSubdir = `ci-smoke-output-cp-eval-pass-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpEvalPassOutputSubdir), { recursive: true });
    const cpEvalPassRes = await runBin([
      'evaluate-contract',
      '--before', cpBaselineObsRoot,
      '--after', cpSuccessObsRoot,
      '--comparison', cpCompareSuccessRoot,
      '--baseline', cpBaselineArtifactRoot,
      '--change', cpChangeArtifactRoot,
      '--output', cpEvalPassOutputSubdir,
      '--enforce',
    ]);
    console.log('--- evaluate-contract (PASS, --enforce) stdout ---');
    console.log(cpEvalPassRes.stdout);
    console.log(`--- evaluate-contract (PASS, --enforce) exit code: ${cpEvalPassRes.code} ---`);
    if (cpEvalPassRes.code !== 0) fail(`packed PASS evaluate-contract with --enforce expected exit 0, got ${cpEvalPassRes.code}:\n${cpEvalPassRes.stdout}\n${cpEvalPassRes.stderr}`);
    if (!cpEvalPassRes.stdout.includes('Verdict: PASS')) fail(`expected "Verdict: PASS" from packed evaluate-contract:\n${cpEvalPassRes.stdout}`);
    const cpEvalPassRoot = cpEvalPassRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cpEvalPassManifest = JSON.parse(await readFile(path.join(cpEvalPassRoot, 'manifest.json'), 'utf8'));
    if (cpEvalPassManifest.overallVerdict !== 'PASS') fail(`expected persisted overallVerdict PASS, got ${cpEvalPassManifest.overallVerdict}`);
    if ((cpEvalPassManifest.unexpectedChanges ?? []).length !== 0) fail(`expected zero unexpected changes for the packed PASS scenario, got ${JSON.stringify(cpEvalPassManifest.unexpectedChanges)}`);
    summary.packedEvaluatePassOk = true;
    summary.packedEvaluatePassEnforceExitCode = cpEvalPassRes.code;

    // Scenario B: the real-browser milestone signature (requested/expected-dependent PASS,
    // protected/preserved FAIL) - installed candidate, real observed geometry.
    contractVariant = 'protected-regression';
    const cpRegressionOutputSubdir = `ci-smoke-output-cp-regression-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpRegressionOutputSubdir), { recursive: true });
    const cpRegressionObserveRes = await runBin(['observe', '--url', contractTargetUrl, '--viewport', '1000x700', ...contractTargetArgs, '--output', cpRegressionOutputSubdir]);
    if (cpRegressionObserveRes.code !== 0) fail(`contract-fixture regression observe failed (exit ${cpRegressionObserveRes.code}):\n${cpRegressionObserveRes.stdout}\n${cpRegressionObserveRes.stderr}`);
    const cpRegressionObsRoot = cpRegressionObserveRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cpRegressionManifestRaw0 = await readFile(path.join(cpRegressionObsRoot, 'manifest.json'));
    const cpRegressionScreenshotRaw0 = await readFile(path.join(cpRegressionObsRoot, 'screenshot.png'));

    const cpCompareRegressionOutputSubdir = `ci-smoke-output-cp-compare-regression-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpCompareRegressionOutputSubdir), { recursive: true });
    const cpCompareRegressionRes = await runBin(['compare', '--before', cpBaselineObsRoot, '--after', cpRegressionObsRoot, '--output', cpCompareRegressionOutputSubdir]);
    if (cpCompareRegressionRes.code !== 0) fail(`contract-fixture regression compare failed (exit ${cpCompareRegressionRes.code}):\n${cpCompareRegressionRes.stdout}\n${cpCompareRegressionRes.stderr}`);
    const cpCompareRegressionRoot = cpCompareRegressionRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cpCompareRegressionManifestRaw0 = await readFile(path.join(cpCompareRegressionRoot, 'manifest.json'));
    const cpCompareRegressionManifest = JSON.parse(cpCompareRegressionManifestRaw0.toString('utf8'));
    if (cpCompareRegressionManifest.comparability.state !== 'comparable') fail(`expected comparable for contract-fixture regression pair, got ${cpCompareRegressionManifest.comparability.state}`);
    const cpClipDiff = cpCompareRegressionManifest.differences.find((d) => d.kind === 'clipping-changed' && d.subject.type === 'target' && d.subject.target === 'navigation');
    if (!cpClipDiff || cpClipDiff.before !== 'not-clipped' || cpClipDiff.after !== 'clipped') fail('expected a real installed-candidate navigation clipping-changed difference (not-clipped -> clipped)');
    const cpRailResized = cpCompareRegressionManifest.differences.find((d) => d.kind === 'resized' && d.subject?.type === 'target' && d.subject?.target === 'rail');
    if (!cpRailResized) fail('expected a real installed-candidate resized difference for target "rail"');

    const cpBaselineContractArtifactRaw0 = await readFile(path.join(cpBaselineArtifactRoot, 'manifest.json'));
    const cpChangeContractArtifactRaw0 = await readFile(path.join(cpChangeArtifactRoot, 'manifest.json'));

    const cpEvalFailNoEnforceOutputSubdir = `ci-smoke-output-cp-eval-fail-noenforce-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpEvalFailNoEnforceOutputSubdir), { recursive: true });
    const cpEvalFailNoEnforceRes = await runBin([
      'evaluate-contract',
      '--before', cpBaselineObsRoot,
      '--after', cpRegressionObsRoot,
      '--comparison', cpCompareRegressionRoot,
      '--baseline', cpBaselineArtifactRoot,
      '--change', cpChangeArtifactRoot,
      '--output', cpEvalFailNoEnforceOutputSubdir,
    ]);
    console.log('--- evaluate-contract (FAIL, no --enforce) stdout ---');
    console.log(cpEvalFailNoEnforceRes.stdout);
    console.log(`--- evaluate-contract (FAIL, no --enforce) exit code: ${cpEvalFailNoEnforceRes.code} ---`);
    if (cpEvalFailNoEnforceRes.code !== 0) fail(`packed FAIL evaluate-contract without --enforce expected exit 0, got ${cpEvalFailNoEnforceRes.code}:\n${cpEvalFailNoEnforceRes.stdout}\n${cpEvalFailNoEnforceRes.stderr}`);
    if (!cpEvalFailNoEnforceRes.stdout.includes('Verdict: FAIL')) fail(`expected "Verdict: FAIL" from packed evaluate-contract:\n${cpEvalFailNoEnforceRes.stdout}`);
    const cpEvalFailNoEnforceRoot = cpEvalFailNoEnforceRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cpEvalFailNoEnforceManifest = JSON.parse(await readFile(path.join(cpEvalFailNoEnforceRoot, 'manifest.json'), 'utf8'));
    const cpClauseById = new Map(cpEvalFailNoEnforceManifest.clauseResults.map((r) => [r.clauseId, r]));
    if (cpClauseById.get('requested-nav-shrink')?.status !== 'pass') fail(`expected requested-nav-shrink = pass, got ${JSON.stringify(cpClauseById.get('requested-nav-shrink'))}`);
    if (cpClauseById.get('expected-workspace-grow')?.status !== 'pass') fail(`expected expected-workspace-grow = pass, got ${JSON.stringify(cpClauseById.get('expected-workspace-grow'))}`);
    if (cpClauseById.get('protected-rail-width')?.status !== 'fail') fail(`expected protected-rail-width = fail, got ${JSON.stringify(cpClauseById.get('protected-rail-width'))}`);
    if (cpClauseById.get('preserved-nav-unclipped')?.status !== 'fail') fail(`expected preserved-nav-unclipped = fail, got ${JSON.stringify(cpClauseById.get('preserved-nav-unclipped'))}`);
    if (cpEvalFailNoEnforceManifest.overallVerdict !== 'FAIL') fail(`expected persisted overallVerdict FAIL, got ${cpEvalFailNoEnforceManifest.overallVerdict}`);
    summary.packedEvaluateFailNoEnforceExitCode = cpEvalFailNoEnforceRes.code;
    summary.packedRequestedResult = cpClauseById.get('requested-nav-shrink')?.status;
    summary.packedExpectedDependentResult = cpClauseById.get('expected-workspace-grow')?.status;
    summary.packedProtectedResult = cpClauseById.get('protected-rail-width')?.status;
    summary.packedPreservedResult = cpClauseById.get('preserved-nav-unclipped')?.status;
    summary.packedOverallFailVerdict = cpEvalFailNoEnforceManifest.overallVerdict;

    const cpEvalFailNoEnforceEntries = await readdir(cpEvalFailNoEnforceRoot);
    if (cpEvalFailNoEnforceEntries.length !== 1 || cpEvalFailNoEnforceEntries[0] !== 'manifest.json') {
      fail(`expected packed evaluation directory to contain only manifest.json, got: ${cpEvalFailNoEnforceEntries.join(', ')}`);
    }
    summary.packedEvaluationNoScreenshotCopied = true;

    const cpEvalFailEnforceOutputSubdir = `ci-smoke-output-cp-eval-fail-enforce-${randomUUID()}`;
    await mkdir(path.join(consumerDir, cpEvalFailEnforceOutputSubdir), { recursive: true });
    const cpEvalFailEnforceRes = await runBin([
      'evaluate-contract',
      '--before', cpBaselineObsRoot,
      '--after', cpRegressionObsRoot,
      '--comparison', cpCompareRegressionRoot,
      '--baseline', cpBaselineArtifactRoot,
      '--change', cpChangeArtifactRoot,
      '--output', cpEvalFailEnforceOutputSubdir,
      '--enforce',
    ]);
    console.log('--- evaluate-contract (FAIL, --enforce) stdout ---');
    console.log(cpEvalFailEnforceRes.stdout);
    console.log(`--- evaluate-contract (FAIL, --enforce) exit code: ${cpEvalFailEnforceRes.code} ---`);
    if (cpEvalFailEnforceRes.code === 0) fail('packed FAIL evaluate-contract with --enforce was expected to exit nonzero');
    if (!cpEvalFailEnforceRes.stdout.includes('Verdict: FAIL')) fail(`expected "Verdict: FAIL" from packed evaluate-contract (--enforce):\n${cpEvalFailEnforceRes.stdout}`);
    const cpEvalFailEnforceRoot = cpEvalFailEnforceRes.stdout.split('\n').find((l) => l.startsWith('Artifact: ')).slice('Artifact: '.length).trim();
    const cpEvalFailEnforceManifest = JSON.parse(await readFile(path.join(cpEvalFailEnforceRoot, 'manifest.json'), 'utf8'));
    summary.packedEvaluateFailEnforceExitCode = cpEvalFailEnforceRes.code;

    if (cpEvalFailEnforceManifest.evaluationRequestId !== cpEvalFailNoEnforceManifest.evaluationRequestId) {
      fail('--enforce must not change the deterministic evaluationRequestId');
    }
    if (JSON.stringify(cpEvalFailEnforceManifest.clauseResults) !== JSON.stringify(cpEvalFailNoEnforceManifest.clauseResults)) {
      fail('--enforce must not change clause result contents');
    }
    summary.packedEvaluationRequestIdEqual = true;
    summary.packedClauseResultsEqual = true;

    // Source-evidence immutability across the whole v0.5 packed scenario.
    if (!(await readFile(path.join(cpBaselineObsRoot, 'manifest.json'))).equals(cpBaselineManifestRaw0)) fail('packed baseline observation manifest changed');
    if (!(await readFile(path.join(cpBaselineObsRoot, 'screenshot.png'))).equals(cpBaselineScreenshotRaw0)) fail('packed baseline observation screenshot changed');
    if (!(await readFile(path.join(cpRegressionObsRoot, 'manifest.json'))).equals(cpRegressionManifestRaw0)) fail('packed regression observation manifest changed');
    if (!(await readFile(path.join(cpRegressionObsRoot, 'screenshot.png'))).equals(cpRegressionScreenshotRaw0)) fail('packed regression observation screenshot changed');
    if (!(await readFile(path.join(cpCompareRegressionRoot, 'manifest.json'))).equals(cpCompareRegressionManifestRaw0)) fail('packed comparison manifest changed after evaluation');
    if (!(await readFile(path.join(cpBaselineArtifactRoot, 'manifest.json'))).equals(cpBaselineContractArtifactRaw0)) fail('packed baseline contract artifact changed after evaluation');
    if (!(await readFile(path.join(cpChangeArtifactRoot, 'manifest.json'))).equals(cpChangeContractArtifactRaw0)) fail('packed per-change contract artifact changed after evaluation');
    summary.packedSourceArtifactsImmutable = true;

    // Path privacy across the v0.5 packed scenario.
    const cpSerializedEvalManifests = JSON.stringify(cpEvalFailNoEnforceManifest) + JSON.stringify(cpEvalFailEnforceManifest) + JSON.stringify(cpEvalPassManifest);
    for (const leaked of [consumerDir, cpBaselineObsRoot, cpRegressionObsRoot, cpCompareRegressionRoot, cpBaselineArtifactRoot, cpChangeArtifactRoot, baselineContractFilePath, changeContractFilePath]) {
      if (cpSerializedEvalManifests.includes(leaked)) fail(`operational filesystem path leaked into a packed evaluation manifest: ${leaked}`);
    }
    summary.packedEvaluationPathPrivacyPassed = true;

    // --- v0.6: installed package's bounded-agent-context projection + runtime/static
    // correlation public surface (programmatic export only - no CLI command, no disk
    // artifact family - see docs/CONTRACTS.md). Resolved from the consumer's own
    // installed node_modules (the same `installedPackageApi` import already used above
    // for the v0.4/v0.5 validators), never the source checkout.
    if (typeof installedPackageApi.projectBoundedAgentContext !== 'function') fail('installed package does not export projectBoundedAgentContext');
    if (typeof installedPackageApi.deriveRuntimeStaticCorrelations !== 'function') fail('installed package does not export deriveRuntimeStaticCorrelations');
    if (typeof installedPackageApi.attachRuntimeStaticCorrelations !== 'function') fail('installed package does not export attachRuntimeStaticCorrelations');
    if (typeof installedPackageApi.isValidBoundedAgentContextArtifact !== 'function') fail('installed package does not export isValidBoundedAgentContextArtifact');

    const manifestSnapshotBeforeBoundedContext = JSON.stringify(manifest);
    const boundedContextGeneratedAt = new Date(0).toISOString();
    const projectionInput = {
      generatedAt: boundedContextGeneratedAt,
      producerVersion: manifest.producer.version,
      projectionProfile: 'frontend-change-review',
      focusTargetIds: ['primary-navigation', 'action'],
      observation: manifest,
    };
    const projectionResult = installedPackageApi.projectBoundedAgentContext(projectionInput);
    if (!projectionResult.ok) fail(`installed projectBoundedAgentContext failed: ${projectionResult.reason}`);
    const boundedArtifact = projectionResult.artifact;
    const boundedArtifactValidation = installedPackageApi.isValidBoundedAgentContextArtifact(boundedArtifact);
    if (!boundedArtifactValidation.valid) fail(`installed-package BoundedAgentContextArtifact failed structural validation: ${boundedArtifactValidation.reason}`);
    if (boundedArtifact.artifactKind !== 'my-frontend-observer/bounded-agent-context') fail(`unexpected bounded-agent-context artifactKind: ${boundedArtifact.artifactKind}`);
    if (boundedArtifact.schemaVersion !== '1.0.0') fail(`unexpected bounded-agent-context schemaVersion: ${boundedArtifact.schemaVersion}`);
    if (!['adequate', 'partial', 'inadequate'].includes(boundedArtifact.adequacy?.state)) fail(`unexpected adequacy state: ${JSON.stringify(boundedArtifact.adequacy)}`);
    if (!Array.isArray(boundedArtifact.omissions)) fail('bounded-agent-context artifact missing omissions array');
    if (!Array.isArray(boundedArtifact.truncations)) fail('bounded-agent-context artifact missing truncations array');
    const boundedTargetIds = boundedArtifact.targets.map((t) => t.targetId).sort();
    if (JSON.stringify(boundedTargetIds) !== JSON.stringify(['action', 'primary-navigation'])) {
      fail(`unexpected bounded-agent-context target ids: ${JSON.stringify(boundedTargetIds)}`);
    }

    // Deterministic logical identity vs. fresh instance identity: re-running the same
    // logical input must reproduce contextRequestId exactly, while contextId (a fresh
    // per-execution instance identity) must differ across the two runs.
    const projectionResult2 = installedPackageApi.projectBoundedAgentContext(projectionInput);
    if (!projectionResult2.ok) fail(`installed projectBoundedAgentContext (rerun) failed: ${projectionResult2.reason}`);
    if (projectionResult2.artifact.contextRequestId !== boundedArtifact.contextRequestId) {
      fail(`contextRequestId is not deterministic across identical inputs: ${projectionResult2.artifact.contextRequestId} !== ${boundedArtifact.contextRequestId}`);
    }
    if (projectionResult2.artifact.contextId === boundedArtifact.contextId) {
      fail('contextId (fresh instance identity) unexpectedly matched across two separate projection calls');
    }
    summary.boundedContextDeterministicRequestId = true;
    summary.boundedContextFreshInstanceId = true;

    // Runtime/static correlation: exact ("correlated"), competing-candidates
    // ("ambiguous"), and no-responsible-candidate ("unavailable") outcomes, plus
    // attach-to-artifact + no source-ownership/causal vocabulary leakage.
    const staticProducer = { name: 'ci-smoke-static-producer', version: '0.0.0', indexId: 'ci-smoke-index-1' };
    const deriveResult = installedPackageApi.deriveRuntimeStaticCorrelations({
      staticProducer,
      correlatedAt: boundedContextGeneratedAt,
      targets: [
        {
          runtimeTargetId: 'primary-navigation',
          required: true,
          runtimeEvidenceRefs: [{ path: 'targetEvidence.primary-navigation.geometry' }],
          candidates: [{ candidateId: 'file:src/components/Nav.tsx', kind: 'file', evidenceRefs: [{ path: 'src/components/Nav.tsx' }] }],
        },
        {
          runtimeTargetId: 'action',
          required: false,
          runtimeEvidenceRefs: [{ path: 'targetEvidence.action.geometry' }],
          candidates: [],
        },
      ],
    });
    if (!deriveResult.ok) fail(`installed deriveRuntimeStaticCorrelations failed: ${deriveResult.reason}`);
    const navCorrelation = deriveResult.records.find((r) => r.runtimeTargetId === 'primary-navigation');
    const actionCorrelation = deriveResult.records.find((r) => r.runtimeTargetId === 'action');
    if (navCorrelation?.status !== 'correlated') fail(`expected primary-navigation correlation status "correlated", got ${JSON.stringify(navCorrelation)}`);
    if (navCorrelation.candidates?.length !== 1 || navCorrelation.candidates[0].candidateId !== 'file:src/components/Nav.tsx') {
      fail(`expected primary-navigation correlated candidate identity preserved, got ${JSON.stringify(navCorrelation.candidates)}`);
    }
    if (actionCorrelation?.status !== 'unavailable') fail(`expected action correlation status "unavailable", got ${JSON.stringify(actionCorrelation)}`);

    // Ambiguous outcome: derive-only proof (two competing candidates for one target),
    // deliberately not attached to the real artifact above (attach requires every
    // correlation's runtimeTargetId to already exist in artifact.targets - this
    // synthetic target id is not one of the two real projected targets).
    const ambiguousDeriveResult = installedPackageApi.deriveRuntimeStaticCorrelations({
      staticProducer,
      correlatedAt: boundedContextGeneratedAt,
      targets: [
        {
          runtimeTargetId: 'ci-smoke-ambiguous-target',
          required: false,
          runtimeEvidenceRefs: [{ path: 'targetEvidence.ci-smoke-ambiguous-target.geometry' }],
          candidates: [
            { candidateId: 'file:src/components/A.tsx', kind: 'file', evidenceRefs: [{ path: 'src/components/A.tsx' }] },
            { candidateId: 'file:src/components/B.tsx', kind: 'file', evidenceRefs: [{ path: 'src/components/B.tsx' }] },
          ],
        },
      ],
    });
    if (!ambiguousDeriveResult.ok) fail(`installed deriveRuntimeStaticCorrelations (ambiguous case) failed: ${ambiguousDeriveResult.reason}`);
    const ambiguousRecord = ambiguousDeriveResult.records[0];
    if (ambiguousRecord?.status !== 'ambiguous') fail(`expected "ambiguous" correlation status, got ${JSON.stringify(ambiguousRecord)}`);
    if ((ambiguousRecord.candidates?.length ?? 0) < 2) fail('expected ambiguous record to preserve both competing candidates');
    summary.boundedContextCorrelationStatuses = { correlated: navCorrelation.status, ambiguous: ambiguousRecord.status, unavailable: actionCorrelation.status };

    const attachResult = installedPackageApi.attachRuntimeStaticCorrelations(boundedArtifact, deriveResult);
    if (!attachResult.ok) fail(`installed attachRuntimeStaticCorrelations failed: ${attachResult.reason}`);
    const attachedArtifactValidation = installedPackageApi.isValidBoundedAgentContextArtifact(attachResult.artifact);
    if (!attachedArtifactValidation.valid) fail(`attached BoundedAgentContextArtifact failed structural validation: ${attachedArtifactValidation.reason}`);
    if ((attachResult.artifact.correlations ?? []).length !== 2) fail(`expected 2 attached correlation records, got ${(attachResult.artifact.correlations ?? []).length}`);

    // Runtime identity must never silently become a source-ownership/causal claim.
    const serializedBoundedArtifact = JSON.stringify(attachResult.artifact) + JSON.stringify(ambiguousDeriveResult);
    for (const forbidden of ['"owner"', '"causedBy"', '"sourceOwner"', '"editAuthority"']) {
      if (serializedBoundedArtifact.includes(forbidden)) fail(`forbidden source-ownership/causal vocabulary found in bounded-agent-context output: ${forbidden}`);
    }

    // Source-observation immutability: the runtime observation passed into the v0.6
    // projection must not have been mutated on disk by projection/correlation/attach.
    const manifestRawAfterBoundedContext = await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8');
    if (JSON.parse(manifestRawAfterBoundedContext).observationId !== manifest.observationId) {
      fail('source observation manifest on disk no longer matches the in-memory observation used for bounded-agent-context projection');
    }
    if (JSON.stringify(manifest) !== manifestSnapshotBeforeBoundedContext) {
      fail('in-memory observation object was mutated by projectBoundedAgentContext/deriveRuntimeStaticCorrelations/attachRuntimeStaticCorrelations');
    }
    summary.boundedAgentContextInputImmutable = true;

    summary.boundedAgentContextArtifactKind = boundedArtifact.artifactKind;
    summary.boundedAgentContextSchemaVersion = boundedArtifact.schemaVersion;
    summary.boundedAgentContextAdequacyState = boundedArtifact.adequacy.state;
    summary.boundedAgentContextTargetIds = boundedTargetIds;
    summary.boundedAgentContextCorrelationAttachOk = true;
    summary.boundedAgentContextSourceCheckoutIndependent = true;
    summary.v06PackedSmokeOk = true;

    // Target/output isolation: this run must not have written anything new
    // into the repository root - compared against the entries already
    // present before this smoke started (never a fixed-name assertion,
    // which would false-fail on unrelated pre-existing local directories).
    const finalCwdEntries = await readdir(process.cwd()).catch(() => []);
    const newCwdEntries = finalCwdEntries.filter((entry) => !initialCwdEntries.has(entry));
    if (newCwdEntries.length > 0) {
      fail(`repository-root artifact leak detected - new entries appeared in ${process.cwd()}: ${newCwdEntries.join(', ')}`);
    }
    summary.packedNoRepoRootLeak = true;

    // Target application immutability across all observations (served content, not browser-local scroll state).
    const afterHtml = await fetch(targetUrl).then((r) => r.text());
    server.close();
    summary.targetImmutable = beforeHtml === afterHtml;
    if (!summary.targetImmutable) fail('observed target content changed after observation');

    summary.windowScrollScenarioPassed = true;
    summary.targetScrollScenarioPassed = true;
    summary.windowScrollOwner = windowEvidence.scrollOwner.value;
    summary.targetScrollOwner = targetScrollEvidence.scrollOwner.value;
    summary.scrollScenarioSchemaVersion = windowManifest.schemaVersion;

    summary.schemaVersion = manifest.schemaVersion;
    summary.artifactKind = manifest.artifactKind;
    summary.targetIds = Object.keys(manifest.targetEvidence).sort();
    summary.targetSelectionStatuses = Object.fromEntries(
      Object.entries(manifest.targetEvidence).map(([name, record]) => [name, record.resolution?.value?.selectionStatus]),
    );
    summary.semanticLocatorKindsCovered = Object.values(manifest.targetEvidence).map((r) => r.resolution?.value?.selectedLocatorKind).filter(Boolean).sort();
    summary.landmarkEvidence = navRecord?.landmark?.value ?? null;
    summary.evidenceStatesEncountered = Array.from(
      new Set(
        [...Object.values(manifest.pageEvidence), ...Object.values(manifest.targetEvidence).flatMap((r) => Object.values(r))]
          .map((f) => f?.state)
          .filter(Boolean),
      ),
    ).sort();
    summary.evidenceSourcesEncountered = Array.from(
      new Set(
        [...Object.values(manifest.pageEvidence), ...Object.values(manifest.targetEvidence).flatMap((r) => Object.values(r))]
          .map((f) => f?.source)
          .filter(Boolean),
      ),
    ).sort();
    summary.artifactReferencePaths = (manifest.artifactReferences ?? []).map((r) => r.path);
    summary.completionState = manifest.completion?.state;
    summary.browserProvenance = manifest.browser?.value ?? null;
    summary.screenshotBytes = screenshot.length;
    summary.targetsFilePathLeaked = false;
    summary.legacyCssObservationPassed = true;
    summary.pass = true;

    console.log('SMOKE PASS');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (server && server.listening) server.close();
    await rm(consumerDir, { recursive: true, force: true }).catch(() => undefined);
  }

  if (outPath) {
    await writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = process.exitCode || 1;
});
