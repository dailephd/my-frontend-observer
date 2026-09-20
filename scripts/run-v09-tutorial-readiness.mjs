#!/usr/bin/env node

// Repository-owned release-support orchestration for the four v0.9 tutorials.
// Tutorial behavior remains owned by examples/v09-demo and my-dev-kit-lab.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateTutorialTargetContract } from '../examples/v09-demo/scripts/generate-tutorial-target.mjs';
import { readExternalReferenceArtifact, readPerChangeContract, readPersistentBaselineContract, readVisualAnnotationArtifact } from '../dist/index.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const labVersion = '0.4.8';
const scenarios = [
  ['observer-v09-annotation-basics', '01-annotation-basics'],
  ['observer-v09-runtime-contract', '02-runtime-intent-contract'],
  ['observer-v09-reference-authoring', '03-reference-authoring'],
  ['observer-v09-reference-materialization', '04-reference-materialization'],
];

function fail(message) { throw new Error(message); }
function npxCommand() { return process.platform === 'win32' ? 'npx.cmd' : 'npx'; }
async function jsonFile(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function readArtifact(reader, file) {
  const result = await reader(file);
  if (!result?.ok) fail(`canonical reader rejected ${file}`);
  return result.artifact;
}
async function filesNamed(dir, name) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await filesNamed(full, name));
    else if (entry.name === name) result.push(full);
  }
  return result;
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function trackedDemoDigest() {
  const files = execFileSync('git', ['ls-files', 'examples/v09-demo'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file.replaceAll('\\', '/') + '\0').update(readFileSync(path.join(root, file)));
  return { files: files.length, sha256: hash.digest('hex') };
}
function status() { return execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }); }
async function runLab(args) {
  const { stdout } = await execFileAsync(npxCommand(), ['--yes', `@dailephd/my-dev-kit-lab@${labVersion}`, ...args], { cwd: root, maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32' });
  const start = stdout.indexOf('{');
  if (start < 0) fail(`lab did not return JSON: ${stdout.slice(-500)}`);
  return JSON.parse(stdout.slice(start));
}
async function validateArtifacts(result, scenarioPath) {
  if (result.status !== 'passed') fail(`${scenarioPath}: tutorial status was ${result.status}`);
  if (!Array.isArray(result.cleanupErrors) || result.cleanupErrors.length !== 0) fail(`${scenarioPath}: cleanupErrors was not empty`);
  const required = ['video', 'srt', 'vtt', 'markdown', 'manifest'];
  for (const kind of required) {
    const item = result.artifacts?.[kind];
    if (item?.status !== 'written' || !(item.sizeBytes > 0)) fail(`${scenarioPath}: ${kind} was not written and non-empty`);
  }
  if (!Array.isArray(result.artifacts?.screenshots) || result.artifacts.screenshots.length === 0 || result.artifacts.screenshots.some((item) => item.status !== 'written' || !(item.sizeBytes > 0))) fail(`${scenarioPath}: screenshots were incomplete`);
  const targetRoot = result.paths?.targetRoot;
  if (!targetRoot) fail(`${scenarioPath}: target root missing from result`);
  const annotationFiles = await filesNamed(path.join(targetRoot, '.frontend-observer', 'evidence', 'annotations'), 'manifest.json');
  const referenceFiles = await filesNamed(path.join(targetRoot, '.frontend-observer', 'evidence', 'references'), 'manifest.json');
  const contractFiles = await filesNamed(path.join(targetRoot, '.frontend-observer', 'evidence', 'contracts'), 'manifest.json');
  const annotations = [];
  for (const file of annotationFiles) annotations.push(await readArtifact(readVisualAnnotationArtifact, file));
  const references = [];
  for (const file of referenceFiles) references.push({ ...(await readArtifact(readExternalReferenceArtifact, file)), __file: file });
  const contracts = [];
  for (const file of contractFiles) {
    const raw = await jsonFile(file);
    contracts.push(raw.contractClass === 'baseline' ? await readArtifact(readPersistentBaselineContract, file) : await readArtifact(readPerChangeContract, file));
  }
  const id = result.scenarioId;
  if (id === 'observer-v09-annotation-basics') {
    if (annotations.length !== 2) fail(`${id}: expected original and revision annotations`);
    const [original, revision] = annotations.sort((a, b) => (a.provenance?.createdAt ?? '').localeCompare(b.provenance?.createdAt ?? ''));
    if (revision.supersedesAnnotationId !== original.annotationId) fail(`${id}: annotation chain is invalid`);
    const kinds = new Set(original.items.map((item) => item.mark.kind));
    for (const kind of ['point', 'rectangle', 'line', 'arrow', 'note']) if (!kinds.has(kind)) fail(`${id}: missing ${kind} mark`);
  } else if (id === 'observer-v09-runtime-contract') {
    const change = contracts.find((item) => item.contractClass === 'change' && item.clauses?.length === 2);
    if (!change || change.clauses.some((clause) => clause.primitive?.kind === 'inspect' || clause.primitive?.kind === 'remove')) fail(`${id}: promoted contract invariant failed`);
    if (!contracts.some((item) => item.contractClass === 'baseline' && item.baselineId === 'v09-tutorial-baseline')) fail(`${id}: baseline was not preserved`);
  } else if (id === 'observer-v09-reference-authoring') {
    const annotation = annotations.find((item) => item.source?.kind === 'external-reference');
    const approved = references.find((item) => item.lifecycle === 'approved');
    if (!annotation || annotation.items.length !== 7 || !approved || (approved.requirements?.length ?? 0) !== 0) fail(`${id}: reference authoring invariants failed`);
  } else if (id === 'observer-v09-reference-materialization') {
    const approved = references.find((item) => item.lifecycle === 'approved');
    const imported = references.filter((item) => item.lifecycle === 'imported');
    if (!approved || imported.length !== 1 || (approved.requirements?.length ?? 0) !== 0 || (imported[0].requirements?.length ?? 0) < 1) fail(`${id}: materialization lifecycle invariant failed`);
    const imagePath = (reference) => reference.image?.path ? path.join(path.dirname(reference.__file ?? ''), reference.image.path) : undefined;
    const sourceImage = imagePath(approved);
    const revisionImage = imagePath(imported[0]);
    if (sourceImage && revisionImage && sha256(readFileSync(sourceImage)) !== sha256(readFileSync(revisionImage))) fail(`${id}: source and materialized image digests differ`);
  }
  return { canonicalEvidence: true, annotationCount: annotations.length, referenceCount: references.length, contractCount: contracts.length };
}
async function main() {
  const outRoot = path.resolve(process.argv[2] ?? process.env.RUNNER_TEMP ?? path.join(root, '.my-dev-kit-workflow', 'adhoc', 'v09-final-readiness', 'tutorials'));
  const requestedScenario = process.argv[3];
  const selectedScenarios = requestedScenario === undefined ? scenarios : scenarios.filter(([scenarioId]) => scenarioId === requestedScenario);
  if (selectedScenarios.length === 0) fail(`unknown scenario ${requestedScenario}`);
  await mkdir(outRoot, { recursive: true });
  const beforeDigest = trackedDemoDigest();
  const beforeStatus = status();
  const results = [];
  for (const [scenarioId, fileName] of selectedScenarios) {
    const scenarioPath = path.join(root, 'examples', 'v09-demo', 'tutorials', `${fileName}.json`);
    const runRoot = path.join(outRoot, fileName);
    const contractPath = path.join(runRoot, 'target-contract.json');
    await mkdir(runRoot, { recursive: true });
    await generateTutorialTargetContract({ scenarioId, outPath: contractPath, observerRoot: root });
    await runLab(['tutorial', 'validate', '--scenario', scenarioPath, '--target-contract', contractPath, '--json']);
    const run = await runLab(['tutorial', 'run', '--scenario', scenarioPath, '--target-contract', contractPath, '--out', path.join(runRoot, 'run'), '--json']);
    const evidence = await validateArtifacts(run, fileName);
    results.push({ scenarioId, status: run.status, cleanupErrors: run.cleanupErrors, runId: run.runId, evidence, paths: run.paths });
  }
  const afterDigest = trackedDemoDigest();
  if (JSON.stringify(beforeDigest) !== JSON.stringify(afterDigest)) fail('tracked examples/v09-demo changed during tutorial readiness');
  if (status() !== beforeStatus) fail('repository status changed during tutorial readiness');
  const summary = { schemaVersion: 'v09-tutorial-readiness-summary-1', labVersion, scenarios: results, demoSourceImmutable: true, repositoryUnchanged: true, beforeDigest, afterDigest };
  await writeFile(path.join(outRoot, 'readiness-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}
main().catch((error) => { console.error(`v0.9 tutorial readiness failed: ${error.message}`); process.exitCode = 1; });
