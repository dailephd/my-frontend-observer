#!/usr/bin/env node
// Cross-platform (Windows/Linux/macOS) readiness-only smoke helper.
//
// Proves that the actual packed npm tarball's installed v0.9 visual-annotation
// workflow - never the source checkout - works end to end in a clean consumer
// with consumer-local real Chromium:
//   1. the tarball contains the compiled v0.9 owners and the built viewer;
//   2. the public package entry resolves inside the consumer and exposes the
//      v0.9 programmatic exports;
//   3. init / capture baseline / check baseline --json still work;
//   4. project-aware `view` enables authoring (viewer protocol 1.3.0);
//   5. a runtime annotation is drawn, explicitly associated, confirmed, saved,
//      reloaded, and promoted into a canonical change contract;
//   6. an external reference imported by the installed CLI is annotated, and a
//      confirmed region is materialized into a new imported revision that
//      supersedes the source, reuses its exact image bytes, and is not approved;
//   7. a standalone `view --root` session stays read-only.
// This is test/readiness infrastructure only: it is never imported by
// production code and is not part of the npm package (see package.json
// "files"). The summary never contains the authoring token, absolute project
// paths, or annotation note text.
//
// Usage: node scripts/ci/runPackedV09AnnotationSmoke.mjs <path-to-tarball> [--consumer-root <root>] [--out <summary-json-path>]

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const INSTALLED_PACKAGE_NAME = '@dailephd/my-frontend-observer';
const EXPECTED_VIEWER_PROTOCOL_VERSION = '1.3.0';
const EXPECTED_SCHEMA_VERSION = '1.0.0';
const AUTHORING_TOKEN_HEADER = 'x-frontend-observer-authoring-token';

/** Compiled v0.9 owners that must ship in the installed package (paths relative to the package root). */
const REQUIRED_PACKAGE_FILES = [
  'dist/index.js',
  'dist/cli.js',
  'dist/domain/visualAnnotation.js',
  'dist/domain/visualAnnotationIdentity.js',
  'dist/artifacts/visualAnnotationArtifactReader.js',
  'dist/artifacts/visualAnnotationArtifactWriter.js',
  'dist/application/visualAnnotationPersistenceService.js',
  'dist/application/visualAnnotationContractPromotionService.js',
  'dist/application/visualAnnotationReferenceMaterializationService.js',
  'dist/viewerServer/annotationAuthoring.js',
  'dist/viewerServer/annotationContractPromotion.js',
  'dist/viewerServer/annotationReferenceMaterialization.js',
  'dist/viewer/index.html',
  'dist/viewer/sw.js',
];

/** Public programmatic exports that must resolve from the bare package specifier. */
const REQUIRED_PUBLIC_EXPORTS = [
  'VISUAL_ANNOTATION_ARTIFACT_KIND',
  'VISUAL_ANNOTATION_SCHEMA_VERSION',
  'isValidVisualAnnotationArtifact',
  'buildVisualAnnotationRequestIdentity',
  'buildVisualAnnotationInstanceIdentity',
  'readVisualAnnotationArtifact',
  'writeVisualAnnotationArtifact',
  'persistVisualAnnotation',
  'materializeVisualAnnotationReference',
];

function installedPackageDir(consumerDir) {
  return path.join(consumerDir, 'node_modules', ...INSTALLED_PACKAGE_NAME.split('/'));
}

function fail(message) {
  console.error(`V0.9 ANNOTATION SMOKE FAILURE: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** A real, decodable solid-color RGB PNG, so the installed viewer renders the reference image in Chromium. */
function buildRealPng(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    for (let x = 0; x < width; x++) raw.set(rgb, rowStart + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function artifactPathFromCliOutput(projectDir, stdout, label) {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('Artifact: '));
  if (!line) fail(`${label} stdout missing "Artifact: " line:\n${stdout}`);
  const artifactPath = line.slice('Artifact: '.length).trim();
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(projectDir, artifactPath);
}

/** Filesystem identity comparison that tolerates /var -> /private/var and Windows case differences. */
async function canonical(candidate) {
  const physical = path.normalize(await realpath(candidate));
  return process.platform === 'win32' ? physical.toLowerCase() : physical;
}

async function isInside(child, parent) {
  const [c, p] = await Promise.all([canonical(child), canonical(parent)]);
  return c.startsWith(p + path.sep);
}

async function snapshotDir(dir) {
  const snapshot = {};
  for (const name of (await readdir(dir)).sort()) snapshot[name] = sha256(await readFile(path.join(dir, name)));
  return snapshot;
}

async function listDirs(dir) {
  return (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.tmp-')).map((entry) => entry.name).sort();
}

function startView(binAbsolutePath, args, cwd) {
  const child = spawn(process.execPath, [binAbsolutePath, 'view', '--port', '0', '--no-open', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (d) => (output.stdout += d.toString()));
  child.stderr.on('data', (d) => (output.stderr += d.toString()));
  return { child, output };
}

async function waitForViewerUrl(viewer) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const match = viewer.output.stdout.match(/Viewer: (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) return match[1];
    if (viewer.child.exitCode !== null) fail(`viewer exited early (code ${viewer.child.exitCode}):\n${viewer.output.stdout}\n${viewer.output.stderr}`);
    await delay(100);
  }
  fail(`viewer did not print its URL:\n${viewer.output.stdout}\n${viewer.output.stderr}`);
}

async function stopView(viewer) {
  if (!viewer || viewer.child.exitCode !== null) return;
  const exited = new Promise((resolve) => viewer.child.once('exit', resolve));
  viewer.child.kill();
  await Promise.race([exited, delay(10_000)]);
}

// --- real-Chromium UI helpers (pointer input mapped through the SVG's own CTM) ---

async function sourceToClient(page, svgSelector, x, y) {
  await page.evaluate((selector) => globalThis.document.querySelector(selector).scrollIntoView({ block: 'start', inline: 'nearest' }), svgSelector);
  return page.evaluate(
    ([selector, sx, sy]) => {
      const svg = globalThis.document.querySelector(selector);
      const point = svg.createSVGPoint();
      point.x = sx;
      point.y = sy;
      const client = point.matrixTransform(svg.getScreenCTM());
      return { x: client.x, y: client.y };
    },
    [svgSelector, x, y],
  );
}

async function drawRectangle(page, svgSelector, from, to) {
  await page.getByRole('button', { name: 'Rectangle mode' }).click();
  const a = await sourceToClient(page, svgSelector, from.x, from.y);
  const b = await sourceToClient(page, svgSelector, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const selected = page.locator('.annotation-panel__item');
  await selected.waitFor({ timeout: 10_000 });
  return selected.getAttribute('data-selected-annotation-item-id');
}

async function waitForInterpretation(page, state) {
  await page.locator(`.annotation-panel__interpretation[data-interpretation-state="${state}"]`).waitFor({ timeout: 10_000 });
}

function evidenceItem(page, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('.evidence-list__item--supported').filter({ has: page.locator('.evidence-list__id', { hasText: new RegExp(`^${escaped}$`) }) }).first();
}

async function saveAnnotation(page) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/annotations' && r.request().method() === 'POST', { timeout: 15_000 }),
    page.getByRole('button', { name: 'Save annotation' }).click(),
  ]);
  const body = await response.json();
  if (response.status() !== 201 || typeof body.annotationId !== 'string') fail(`annotation save failed: ${response.status()} ${JSON.stringify(body)}`);
  await page.locator(`[data-annotation-id="${body.annotationId}"]`).waitFor({ timeout: 15_000 });
  return body;
}

async function main() {
  const args = process.argv.slice(2);
  const tarballArg = args.find((a, index) => !a.startsWith('--') && !['--out', '--consumer-root'].includes(args[index - 1]));
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const consumerRootIndex = args.indexOf('--consumer-root');
  const suppliedConsumerRoot = consumerRootIndex >= 0 ? args[consumerRootIndex + 1] : undefined;
  if (!tarballArg || (outIndex >= 0 && !outPath) || (consumerRootIndex >= 0 && !suppliedConsumerRoot)) {
    fail('usage: runPackedV09AnnotationSmoke.mjs <path-to-tarball> [--consumer-root <root>] [--out <summary-json-path>]');
  }
  const tarballPath = path.resolve(tarballArg);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  const workRoot = suppliedConsumerRoot === undefined ? await mkdtemp(path.join(tmpdir(), 'mfo-ci-v09-annotation-smoke-')) : path.resolve(suppliedConsumerRoot);
  const consumerDir = path.join(workRoot, 'installed-package');
  const projectDir = path.join(workRoot, 'target');
  const summary = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    packageVersion: null,
    tarballSha256: null,
    viewerProtocolVersion: null,
    packageContentsPass: false,
    publicExportsPass: false,
    consumerPurityPass: false,
    projectWorkflowPass: false,
    authoringSessionEnabled: false,
    runtimeAnnotationPass: false,
    runtimePromotionPass: false,
    contractInspectionPass: false,
    referenceAnnotationPass: false,
    referenceMaterializationPass: false,
    newReferenceInspectionPass: false,
    readOnlyBoundaryPass: false,
    result: 'FAIL',
  };
  let fixtureServer;
  let projectViewer;
  let standaloneViewer;
  let browser;

  try {
    summary.tarballSha256 = sha256(await readFile(tarballPath));
    await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    await mkdir(consumerDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(consumerDir, 'package.json'), JSON.stringify({ name: 'mfo-ci-v09-annotation-smoke-consumer', version: '0.0.0', private: true, type: 'module' }, null, 2));

    // --- install the exact tarball into the clean consumer ---
    const npmCli = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : undefined;
    const npmCmd = process.platform === 'win32' ? process.execPath : 'npm';
    const npmInstallArgs = process.platform === 'win32' ? [npmCli, 'install', tarballPath, '--no-audit', '--no-fund'] : ['install', tarballPath, '--no-audit', '--no-fund'];
    console.log('installing candidate tarball...');
    const install = await run(npmCmd, npmInstallArgs, { cwd: consumerDir });
    if (install.code !== 0) fail(`npm install of candidate tarball failed:\n${install.stdout}\n${install.stderr}`);

    const installedDir = installedPackageDir(consumerDir);
    const installedPkg = JSON.parse(await readFile(path.join(installedDir, 'package.json'), 'utf8'));
    summary.packageVersion = installedPkg.version;
    const binName = Object.keys(installedPkg.bin ?? {})[0];
    if (!binName) fail('installed package.json has no bin entry');
    const binAbsolutePath = path.join(installedDir, installedPkg.bin[binName]);

    // --- package contents: compiled v0.9 owners and the built viewer are installed from the tarball ---
    for (const relative of REQUIRED_PACKAGE_FILES) {
      const file = path.join(installedDir, ...relative.split('/'));
      const info = await stat(file).catch(() => undefined);
      if (!info?.isFile() || info.size === 0) fail(`installed package is missing ${relative}`);
    }
    if (await stat(path.join(installedDir, 'scripts')).catch(() => undefined)) fail('readiness scripts were unexpectedly packaged');
    summary.packageContentsPass = true;

    // --- purity: bin and bare-specifier resolution stay inside the consumer's node_modules ---
    const consumerModules = path.join(consumerDir, 'node_modules');
    const repoSrc = path.join(repoRoot, 'src');
    const repoDist = path.join(repoRoot, 'dist');
    if (!(await isInside(binAbsolutePath, consumerModules))) fail('installed bin resolves outside the consumer node_modules');
    const probePath = path.join(consumerDir, 'probe-exports.mjs');
    await writeFile(
      probePath,
      [
        `const resolved = import.meta.resolve(${JSON.stringify(INSTALLED_PACKAGE_NAME)});`,
        `const playwrightResolved = import.meta.resolve('playwright');`,
        `const api = await import(${JSON.stringify(INSTALLED_PACKAGE_NAME)});`,
        `const names = ${JSON.stringify(REQUIRED_PUBLIC_EXPORTS)};`,
        `console.log(JSON.stringify({ resolved, playwrightResolved, types: Object.fromEntries(names.map((name) => [name, typeof api[name]])), schemaVersion: api.VISUAL_ANNOTATION_SCHEMA_VERSION, artifactKind: api.VISUAL_ANNOTATION_ARTIFACT_KIND, promotionExported: typeof api.promoteVisualAnnotationContract }));`,
      ].join('\n'),
    );
    const probe = await run(process.execPath, [probePath], { cwd: consumerDir });
    if (probe.code !== 0) fail(`public export probe failed:\n${probe.stdout}\n${probe.stderr}`);
    const probeResult = JSON.parse(probe.stdout.trim().split(/\r?\n/).at(-1));
    const resolvedEntry = fileURLToPath(probeResult.resolved);
    const resolvedPlaywright = fileURLToPath(probeResult.playwrightResolved);
    for (const [label, resolvedFile] of [['package entry', resolvedEntry], ['playwright', resolvedPlaywright]]) {
      if (!(await isInside(resolvedFile, consumerModules))) fail(`${label} resolves outside the consumer node_modules`);
      const physical = await canonical(resolvedFile);
      for (const forbidden of [repoSrc, repoDist]) {
        const forbiddenCanonical = await canonical(forbidden).catch(() => undefined);
        if (forbiddenCanonical !== undefined && physical.startsWith(forbiddenCanonical + path.sep)) fail(`${label} resolves into the repository checkout`);
      }
    }
    summary.consumerPurityPass = true;
    for (const name of REQUIRED_PUBLIC_EXPORTS) {
      const kind = probeResult.types[name];
      if (kind === 'undefined') fail(`public export ${name} does not resolve from ${INSTALLED_PACKAGE_NAME}`);
    }
    if (probeResult.schemaVersion !== EXPECTED_SCHEMA_VERSION) fail(`VISUAL_ANNOTATION_SCHEMA_VERSION is ${probeResult.schemaVersion}`);
    summary.visualAnnotationArtifactKind = probeResult.artifactKind;
    summary.contractPromotionServicePublicExport = probeResult.promotionExported === 'function';
    summary.publicExportsPass = true;
    const installedApi = await import(pathToFileURL(resolvedEntry).href);

    // --- consumer-local Playwright and Chromium ---
    const playwrightPkg = JSON.parse(await readFile(path.join(consumerModules, 'playwright', 'package.json'), 'utf8'));
    const playwrightCliPath = path.join(consumerModules, 'playwright', playwrightPkg.bin.playwright);
    console.log('installing Chromium via consumer-local playwright...');
    const pwInstall = await run(process.execPath, [playwrightCliPath, 'install', 'chromium', ...(process.platform === 'linux' ? ['--with-deps'] : [])], { cwd: consumerDir });
    if (pwInstall.code !== 0) fail(`playwright install chromium failed:\n${pwInstall.stdout}\n${pwInstall.stderr}`);
    const playwrightModule = await import(pathToFileURL(resolvedPlaywright).href);
    const chromium = playwrightModule.chromium ?? playwrightModule.default.chromium;

    const runBin = (binArgs, cwd = projectDir) => run(process.execPath, [binAbsolutePath, ...binArgs], { cwd });

    // --- installed v0.8.1 project workflow: init, capture baseline, check baseline --json ---
    const html =
      '<!doctype html><html><head><title>v0.9 annotation smoke fixture</title><style>' +
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
    const targetUrl = `http://127.0.0.1:${fixtureServer.address().port}/smoke`;

    const init = await runBin(['init', '--url', targetUrl, '--viewport', '1024x768', '--target', 'header=#header', '--target', 'sidebar=#sidebar']);
    if (init.code !== 0) fail(`init failed (exit ${init.code}):\n${init.stdout}\n${init.stderr}`);
    const capture = await runBin(['capture', 'baseline']);
    if (capture.code !== 0) fail(`capture baseline failed (exit ${capture.code}):\n${capture.stdout}\n${capture.stderr}`);
    const observationDir = artifactPathFromCliOutput(projectDir, capture.stdout, 'capture');
    const observation = JSON.parse(await readFile(path.join(observationDir, 'manifest.json'), 'utf8'));
    // No acceptance criteria are configured, so comparison evidence alone must never be reported as PASS.
    const check = await runBin(['check', 'baseline', '--json']);
    const checkJson = JSON.parse(check.stdout);
    if (check.code !== 2 || checkJson.status !== 'REVIEW_REQUIRED' || checkJson.contract?.configured !== false || checkJson.reference?.configured !== false) {
      fail(`check baseline did not return the deterministic REVIEW_REQUIRED result: exit ${check.code} ${check.stdout} ${check.stderr}`);
    }
    const configPath = path.join(projectDir, 'frontend-observer.json');
    summary.projectWorkflowPass = true;

    const evidenceRoot = path.join(projectDir, '.frontend-observer', 'evidence');
    const annotationsRoot = path.join(evidenceRoot, 'annotations');
    const contractsRoot = path.join(evidenceRoot, 'contracts');
    const referencesRoot = path.join(evidenceRoot, 'references');

    // --- external reference through the installed canonical importer ---
    const referenceImage = path.join(projectDir, 'reference.png');
    await writeFile(referenceImage, buildRealPng(400, 300, [16, 120, 90]));
    const regionsFile = path.join(projectDir, 'regions.json');
    await writeFile(regionsFile, JSON.stringify({ regions: [{ id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } }] }));
    await mkdir(referencesRoot, { recursive: true });
    const imported = await runBin(['import-reference', referenceImage, '--output', '.frontend-observer/evidence/references', '--regions-file', regionsFile, '--label', 'v0.9 annotation smoke reference']);
    if (imported.code !== 0) fail(`import-reference failed (exit ${imported.code}):\n${imported.stdout}\n${imported.stderr}`);
    const sourceReferenceDir = artifactPathFromCliOutput(projectDir, imported.stdout, 'import-reference');
    const sourceReference = JSON.parse(await readFile(path.join(sourceReferenceDir, 'manifest.json'), 'utf8'));
    const sourceReferenceSnapshot = await snapshotDir(sourceReferenceDir);
    const configBefore = await readFile(configPath);

    // --- project-aware installed viewer ---
    projectViewer = startView(binAbsolutePath, [], projectDir);
    const viewerUrl = await waitForViewerUrl(projectViewer);
    if (!viewerUrl.startsWith('http://127.0.0.1:')) fail('viewer bound to a non-loopback host');
    const status = await (await fetch(`${viewerUrl}/api/status`)).json();
    summary.viewerProtocolVersion = status.viewerProtocolVersion;
    if (status.viewerProtocolVersion !== EXPECTED_VIEWER_PROTOCOL_VERSION) fail(`viewer protocol is ${status.viewerProtocolVersion}`);
    const session = await (await fetch(`${viewerUrl}/api/authoring/session`)).json();
    if (session.enabled !== true || typeof session.token !== 'string' || session.token.length === 0) fail('project-aware viewer did not enable authoring');
    summary.authoringSessionEnabled = true;

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(viewerUrl, { waitUntil: 'load' });

    // --- runtime annotation: draw, associate, move right, confirm, save ---
    const runtimeSvg = 'svg.target-overlay-svg';
    await evidenceItem(page, 'baseline').waitFor({ timeout: 15_000 });
    await evidenceItem(page, 'baseline').click();
    await page.locator(`${runtimeSvg} image`).first().waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 15_000 });
    const runtimeItemId = await drawRectangle(page, runtimeSvg, { x: 20, y: 10 }, { x: 300, y: 60 });
    await page.locator('.target-list__item', { hasText: 'header' }).first().click();
    await page.getByRole('button', { name: 'Associate target header', exact: true }).click();
    await page.locator('.annotation-panel__association[data-association-kind="runtime-target"]').waitFor({ timeout: 10_000 });
    await page.getByLabel('Runtime intent operation').selectOption('move');
    await page.getByLabel('Move direction').selectOption('right');
    await page.getByLabel('Intent category').selectOption('requested');
    await page.getByRole('button', { name: 'Set candidate intent' }).click();
    await waitForInterpretation(page, 'candidate');
    await page.getByRole('button', { name: 'Confirm runtime intent' }).click();
    await waitForInterpretation(page, 'confirmed');
    const runtimeSaved = await saveAnnotation(page);

    const runtimeRead = await installedApi.readVisualAnnotationArtifact(path.join(annotationsRoot, runtimeSaved.annotationId, 'manifest.json'));
    if (!runtimeRead.ok) fail(`installed canonical reader rejected the runtime annotation: ${runtimeRead.reason}`);
    const runtimeArtifact = runtimeRead.artifact;
    if (runtimeArtifact.schemaVersion !== EXPECTED_SCHEMA_VERSION) fail(`runtime annotation schema is ${runtimeArtifact.schemaVersion}`);
    if (runtimeArtifact.source.kind !== 'runtime-observation' || runtimeArtifact.source.observationId !== observation.observationId || runtimeArtifact.source.requestId !== observation.requestId) fail('runtime annotation source is not the canonical baseline observation');
    const runtimeItem = runtimeArtifact.items.find((item) => item.annotationItemId === runtimeItemId);
    if (runtimeItem?.interpretation.state !== 'confirmed' || runtimeItem.association?.target !== 'header') fail('runtime annotation item is not a confirmed, explicitly associated item');

    // Reload from canonical evidence in a fresh page load.
    await page.reload({ waitUntil: 'load' });
    await evidenceItem(page, 'baseline').click();
    await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 15_000 });
    await page.locator(`[data-annotation-id="${runtimeSaved.annotationId}"]`).click();
    await page.locator(`[data-annotation-item-id="${runtimeItemId}"]`).first().waitFor({ timeout: 15_000 });
    summary.runtimeAnnotationPass = true;

    // --- runtime promotion into a canonical change contract ---
    await page.locator(`[data-promotion-item-id="${runtimeItemId}"] input[type="checkbox"]`).check();
    const [promotion] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/promote-contract') && r.request().method() === 'POST', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Promote selected to change contract' }).click(),
    ]);
    const promoted = await promotion.json();
    if (promotion.status() !== 201 || promoted.activation?.state !== 'not-requested') fail(`promotion failed: ${promotion.status()} ${JSON.stringify(promoted)}`);
    const contract = JSON.parse(await readFile(path.join(contractsRoot, promoted.contractId, 'manifest.json'), 'utf8'));
    const clause = contract.clauses?.[0];
    if (contract.artifactKind !== 'my-frontend-observer/frontend-contract' || contract.contractClass !== 'change' || contract.schemaVersion !== EXPECTED_SCHEMA_VERSION || contract.clauses.length !== 1) fail('promoted contract is not one canonical change contract');
    if (clause.category !== 'requested' || JSON.stringify(clause.primitive) !== JSON.stringify({ kind: 'property-increases', target: 'header', property: 'x' })) fail(`unexpected promoted clause: ${JSON.stringify(clause)}`);
    if (!(await readFile(configPath)).equals(configBefore)) fail('promotion without activation changed the project config');
    summary.runtimePromotionPass = true;

    await page.reload({ waitUntil: 'load' });
    await evidenceItem(page, promoted.contractId).click();
    await page.locator('.artifact-preview__raw').waitFor({ timeout: 15_000 });
    if (!(await page.locator('.artifact-preview__raw').textContent()).includes('"contractClass": "change"')) fail('promoted contract is not inspectable in the installed viewer');
    summary.contractInspectionPass = true;

    // --- reference annotation: rectangle -> candidate create -> confirm -> save ---
    const referenceSvg = 'svg.reference-region-overlay-svg';
    await evidenceItem(page, sourceReference.referenceId).click();
    await page.locator(referenceSvg).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Rectangle mode' }).waitFor({ timeout: 15_000 });
    const referenceItemId = await drawRectangle(page, referenceSvg, { x: 200, y: 100 }, { x: 350, y: 200 });
    await page.getByLabel('Proposed region ID').fill('smoke-region');
    await page.getByRole('button', { name: 'Create candidate region', exact: true }).click();
    await waitForInterpretation(page, 'candidate');
    await page.getByRole('button', { name: 'Confirm reference intent', exact: true }).click();
    await waitForInterpretation(page, 'confirmed');
    const referenceSaved = await saveAnnotation(page);
    const referenceRead = await installedApi.readVisualAnnotationArtifact(path.join(annotationsRoot, referenceSaved.annotationId, 'manifest.json'));
    if (!referenceRead.ok) fail(`installed canonical reader rejected the reference annotation: ${referenceRead.reason}`);
    const referenceSource = referenceRead.artifact.source;
    if (referenceSource.kind !== 'external-reference' || referenceSource.referenceId !== sourceReference.referenceId || referenceSource.coordinateSpace.kind !== 'reference-image-px' || referenceSource.coordinateSpace.width !== 400) fail('reference annotation source is not the canonical imported reference');
    summary.referenceAnnotationPass = true;

    // --- materialize the confirmed region into a new imported revision ---
    const referenceDirsBefore = await listDirs(referencesRoot);
    await page.locator(`[data-materialization-item-id="${referenceItemId}"] input[type="checkbox"]`).check();
    const [materialization] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/materialize-reference') && r.request().method() === 'POST', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Materialize selected into new reference revision' }).click(),
    ]);
    const materialized = await materialization.json();
    if (materialization.status() !== 201 || materialized.lifecycle !== 'imported' || materialized.approvalRequired !== true || materialized.supersedesReferenceId !== sourceReference.referenceId) fail(`materialization failed: ${materialization.status()} ${JSON.stringify(materialized)}`);
    const newReferenceDir = path.join(referencesRoot, materialized.referenceId);
    const newReference = JSON.parse(await readFile(path.join(newReferenceDir, 'manifest.json'), 'utf8'));
    if (newReference.lifecycle?.state !== 'imported' || newReference.supersedesReferenceId !== sourceReference.referenceId) fail('new reference is not an imported revision superseding the source');
    if (!newReference.regions?.some((region) => region.id === 'smoke-region') || newReference.regions[0]?.id !== 'header') fail('new reference does not contain the source region followed by the materialized region');
    if (newReference.image?.sha256 !== sourceReference.image.sha256) fail('new reference image SHA-256 differs from the source image');
    const imageName = (await readdir(newReferenceDir)).find((name) => name !== 'manifest.json');
    const sourceImageName = (await readdir(sourceReferenceDir)).find((name) => name !== 'manifest.json');
    if (!(await readFile(path.join(newReferenceDir, imageName))).equals(await readFile(path.join(sourceReferenceDir, sourceImageName)))) fail('new reference image bytes differ from the source image bytes');
    if (JSON.stringify(await snapshotDir(sourceReferenceDir)) !== JSON.stringify(sourceReferenceSnapshot)) fail('source reference changed during materialization');
    const referenceDirsAfter = await listDirs(referencesRoot);
    if (JSON.stringify(referenceDirsAfter) !== JSON.stringify([...referenceDirsBefore, materialized.referenceId].sort())) fail('materialization did not add exactly one reference artifact');
    for (const name of referenceDirsAfter) {
      const manifest = JSON.parse(await readFile(path.join(referencesRoot, name, 'manifest.json'), 'utf8'));
      if (manifest.lifecycle?.state !== 'imported') fail('an approved reference was created automatically');
    }
    if (!(await readFile(configPath)).equals(configBefore)) fail('materialization changed the project config');
    summary.referenceMaterializationPass = true;

    await page.reload({ waitUntil: 'load' });
    await evidenceItem(page, materialized.referenceId).click();
    await page.locator(`${referenceSvg} rect[data-region-id="smoke-region"]`).first().waitFor({ timeout: 15_000 });
    summary.newReferenceInspectionPass = true;
    if (pageErrors.length > 0) fail(`page errors in the project-aware viewer: ${pageErrors.join(' | ')}`);
    await context.close();
    await stopView(projectViewer);

    // --- standalone arbitrary-root viewer stays read-only ---
    const annotationDirsBefore = await listDirs(annotationsRoot);
    const contractDirsBefore = await listDirs(contractsRoot);
    const referenceDirsBeforeStandalone = await listDirs(referencesRoot);
    standaloneViewer = startView(binAbsolutePath, ['--root', evidenceRoot], consumerDir);
    const standaloneUrl = await waitForViewerUrl(standaloneViewer);
    const standaloneSession = await (await fetch(`${standaloneUrl}/api/authoring/session`)).json();
    if (standaloneSession.enabled !== false || 'token' in standaloneSession) fail('standalone viewer exposed an authoring session');
    const standaloneHost = new URL(standaloneUrl).host;
    const annotationHandle = `visual-annotation:${encodeURIComponent(`annotations/${referenceSaved.annotationId}`)}`;
    for (const [route, body] of [
      ['/api/annotations', { sourceHandle: 'observation:x', items: [] }],
      [`/api/annotations/${encodeURIComponent(annotationHandle)}/promote-contract`, { itemIds: [runtimeItemId], activateForCheck: false }],
      [`/api/annotations/${encodeURIComponent(annotationHandle)}/materialize-reference`, { itemIds: [referenceItemId] }],
    ]) {
      const response = await fetch(`${standaloneUrl}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://${standaloneHost}`, [AUTHORING_TOKEN_HEADER]: session.token }, body: JSON.stringify(body) });
      if (response.status !== 403) fail(`standalone viewer accepted a write attempt on ${route}: ${response.status}`);
    }
    const readOnlyContext = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    const readOnlyPage = await readOnlyContext.newPage();
    const writeRequests = [];
    readOnlyPage.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) writeRequests.push(request.method());
    });
    await readOnlyPage.goto(standaloneUrl, { waitUntil: 'load' });
    await evidenceItem(readOnlyPage, observation.observationId).click();
    await readOnlyPage.locator(`${runtimeSvg} image`).first().waitFor({ timeout: 15_000 });
    await readOnlyPage.getByText('Read-only viewer', { exact: true }).waitFor({ timeout: 15_000 });
    if ((await readOnlyPage.getByRole('button', { name: 'Rectangle mode' }).count()) !== 0) fail('standalone viewer offers drawing tools');
    if ((await readOnlyPage.getByRole('button', { name: 'Save annotation' }).count()) !== 0) fail('standalone viewer offers saving');
    await readOnlyContext.close();
    if (writeRequests.length > 0) fail(`standalone viewer page issued write requests: ${writeRequests.join(', ')}`);
    if (JSON.stringify(await listDirs(annotationsRoot)) !== JSON.stringify(annotationDirsBefore) || JSON.stringify(await listDirs(contractsRoot)) !== JSON.stringify(contractDirsBefore) || JSON.stringify(await listDirs(referencesRoot)) !== JSON.stringify(referenceDirsBeforeStandalone)) {
      fail('standalone viewer changed evidence');
    }
    summary.readOnlyBoundaryPass = true;

    summary.result = 'PASS';
    console.log('PACKED V0.9 ANNOTATION SMOKE: PASS');
  } finally {
    await browser?.close().catch(() => {});
    await stopView(projectViewer).catch(() => {});
    await stopView(standaloneViewer).catch(() => {});
    if (fixtureServer) await new Promise((resolve) => fixtureServer.close(() => resolve()));
    await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
    if (outPath) await writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8').catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = process.exitCode || 1;
});
