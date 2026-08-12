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
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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

    // Target application immutability across all four observations (served content, not browser-local scroll state).
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
