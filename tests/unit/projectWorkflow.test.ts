import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateObservationAlias, validateProjectConfig } from '../../src/projectWorkflow/projectConfig.js';
import { discoverFrontendObserverProject } from '../../src/projectWorkflow/projectDiscovery.js';
import { ALIAS_CATALOG_SCHEMA_VERSION, readAliasCatalog, serializeAliasCatalog, validateAliasCatalog, writeAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, annotationOutputLocation, observationOutputLocation, projectAnnotationsRoot, projectConfigPath, projectEvidenceRoot, projectObservationsRoot, projectStateRoot } from '../../src/projectWorkflow/projectPaths.js';
import { initializeFrontendObserverProject, loadProjectViewerState } from '../../src/application/projectWorkflowService.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root(): Promise<string> { const value = await mkdtemp(path.join(tmpdir(), 'observer-project-')); roots.push(value); return value; }
const validConfig = { schemaVersion: '1.0.0', url: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 720 }, targets: [{ name: 'header', selector: '#header' }], defaultBaseline: 'baseline' };
const requestId = 'a'.repeat(64);
const observationId = `${requestId}-${'b'.repeat(32)}`;

describe('project configuration and aliases', () => {
  it('validates through the canonical request boundary', () => expect(validateProjectConfig(validConfig).ok).toBe(true));
  it('rejects unknown fields and schema mismatches', () => {
    expect(validateProjectConfig({ ...validConfig, extra: true }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '2.0.0' }).ok).toBe(false);
  });
  it('keeps v1.0 compatible and validates the v1.1 acceptance path contract', () => {
    expect(validateProjectConfig(validConfig).ok).toBe(true);
    expect(validateProjectConfig({ ...validConfig, acceptance: {} }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0' }).ok).toBe(true);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { contract: { baselineArtifact: 'contracts/base', changeArtifact: 'contracts/change' }, reference: { approvedArtifact: 'references/approved', bindingsFile: 'bindings.json' }, comparisonConfigFile: 'comparison.json' } }).ok).toBe(true);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { contract: { baselineArtifact: 'base' } } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { contract: { changeArtifact: 'change' } } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { reference: { approvedArtifact: '../escape' } } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { comparisonConfigFile: 'C:/escape' } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { comparisonConfigFile: '/escape' } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { comparisonConfigFile: '\\escape' } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { comparisonConfigFile: '' } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { comparisonConfigFile: 'bad\0path' } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { comparisonConfigFile: 'bad:path' } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { comparisonConfigFile: './comparison.json' } }).ok).toBe(false);
    expect(validateProjectConfig({ ...validConfig, schemaVersion: '1.1.0', acceptance: { unknown: 'value' } }).ok).toBe(false);
  });
  it('accepts the exact portable alias vocabulary and rejects unsafe/reserved values', () => {
    for (const alias of ['baseline', 'homepage', 'homepage-before', 'desktop.dark', 'candidate_1']) expect(validateObservationAlias(alias)).toEqual({ ok: true });
    for (const alias of ['', 'Upper', 'with space', 'a/b', 'a\\b', 'a:b', 'a..b', 'a'.repeat(65)]) expect(validateObservationAlias(alias).ok).toBe(false);
    expect(validateObservationAlias('current')).toEqual({ ok: false, reason: 'reserved' });
  });
});

describe('project discovery and paths', () => {
  it('discovers at root and from a nested directory, and reports absence', async () => {
    const dir = await root(); const nested = path.join(dir, 'a', 'b'); await mkdir(nested, { recursive: true });
    expect((await discoverFrontendObserverProject(nested)).ok).toBe(false);
    await writeFile(projectConfigPath(dir), '{}');
    expect(await discoverFrontendObserverProject(dir)).toEqual({ ok: true, projectRoot: dir, configPath: projectConfigPath(dir) });
    expect(await discoverFrontendObserverProject(nested)).toEqual({ ok: true, projectRoot: dir, configPath: projectConfigPath(dir) });
  });
  it('stops at the nearest malformed config instead of falling through', async () => {
    const dir = await root(); const nested = path.join(dir, 'nested'); await mkdir(nested); await writeFile(projectConfigPath(dir), JSON.stringify(validConfig)); await writeFile(projectConfigPath(nested), '{bad');
    expect((await discoverFrontendObserverProject(nested) as { ok: true; projectRoot: string }).projectRoot).toBe(nested);
  });
  it('derives every managed path from one root', async () => {
    const dir = await root();
    expect(projectStateRoot(dir)).toBe(path.join(dir, '.frontend-observer'));
    expect(aliasCatalogPath(dir)).toBe(path.join(dir, '.frontend-observer', 'catalog.json'));
    expect(projectEvidenceRoot(dir)).toBe(path.join(dir, '.frontend-observer', 'evidence'));
    expect(projectObservationsRoot(dir)).toBe(path.join(dir, '.frontend-observer', 'evidence', 'observations'));
    expect(observationOutputLocation('baseline')).toBe('.frontend-observer/evidence/observations/baseline');
  });
  it('v0.9: derives the managed annotation root and portable annotation output location without aliases', async () => {
    const dir = await root();
    expect(projectAnnotationsRoot(dir)).toBe(path.join(dir, '.frontend-observer', 'evidence', 'annotations'));
    expect(annotationOutputLocation()).toBe('.frontend-observer/evidence/annotations');
    expect(observationOutputLocation('baseline')).toBe('.frontend-observer/evidence/observations/baseline');
  });
  it('v0.9: loadProjectViewerState reports the canonical resolved project root alongside the unchanged evidence root and aliases', async () => {
    const dir = await root();
    const initialized = await initializeFrontendObserverProject({ projectRoot: dir, url: validConfig.url, viewport: validConfig.viewport, targets: validConfig.targets, replace: false });
    expect(initialized.ok).toBe(true);
    const relativeInput = path.relative(process.cwd(), dir);
    const state = await loadProjectViewerState(relativeInput);
    expect(state).toEqual({ ok: true, projectRoot: path.resolve(dir), root: projectEvidenceRoot(path.resolve(dir)), aliases: {} });
  });
});

describe('alias catalog', () => {
  const catalog = { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { zed: { observationId, requestId, relativeArtifactDir: `observations/zed/${observationId}` }, alpha: { observationId, requestId, relativeArtifactDir: `observations/alpha/${observationId}` } } };
  it('validates records and rejects unsupported versions and traversal', () => {
    expect(validateAliasCatalog(catalog).ok).toBe(true);
    expect(validateAliasCatalog({ ...catalog, schemaVersion: '9.0.0' }).ok).toBe(false);
    expect(validateAliasCatalog({ ...catalog, observations: { bad: { observationId, requestId, relativeArtifactDir: '../escape' } } }).ok).toBe(false);
  });
  it('accepts system-managed current in catalogs while user capture validation keeps it reserved', () => {
    const current = { ...catalog, observations: { current: catalog.observations.alpha } };
    expect(validateAliasCatalog(current).ok).toBe(true);
    expect(validateObservationAlias('current')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateObservationAlias('current', true)).toEqual({ ok: true });
  });
  it('serializes deterministically with sorted keys and a newline', () => {
    const one = serializeAliasCatalog(catalog); const two = serializeAliasCatalog(catalog);
    expect(one).toBe(two); expect(one.indexOf('"alpha"')).toBeLessThan(one.indexOf('"zed"')); expect(one.endsWith('\n')).toBe(true);
  });
  it('atomically creates and replaces a catalog', async () => {
    const dir = await root(); const file = path.join(dir, 'catalog.json'); await writeAliasCatalog(file, catalog);
    await writeAliasCatalog(file, { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: {} });
    expect((await readAliasCatalog(file)).ok).toBe(true); expect(await readFile(file, 'utf8')).toBe('{\n  "schemaVersion": "1.0.0",\n  "observations": {}\n}\n');
  });
});
