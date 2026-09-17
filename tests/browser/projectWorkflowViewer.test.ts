import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { runCli } from '../../src/cli.js';
import { startFixtureServer, type FixtureServer } from '../fixtures/server.js';
import { readAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { checkProject } from '../../src/application/projectCheckService.js';
import { projectAnnotationsRoot } from '../../src/projectWorkflow/projectPaths.js';
import { loadProjectViewerState } from '../../src/application/projectWorkflowService.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');
let projectRoot: string;
let fixture: FixtureServer;
let browser: Browser;
let viewer: Extract<StartViewerResult, { ok: true }> | undefined;
const quiet = { stdout: () => undefined, stderr: () => undefined };

beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], { cwd: repoRoot, stdio: 'inherit' });
  projectRoot = await mkdtemp(path.join(tmpdir(), 'observer-project-browser-'));
  fixture = await startFixtureServer();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await viewer?.close(); await browser?.close(); await fixture?.close();
  if (projectRoot !== undefined) await rm(projectRoot, { recursive: true, force: true });
});

describe('project workflow alias viewer (real Chromium)', () => {
  it('initializes, captures, replaces without deletion, and aliases only the exact current artifact', async () => {
    const previous = process.cwd(); process.chdir(projectRoot);
    try {
      expect(await runCli(['init', '--url', `${fixture.baseUrl}/observation`, '--viewport', '800x600', '--target', 'header=#header'], quiet)).toBe(0);
      expect(await runCli(['capture', 'baseline'], quiet)).toBe(0);
      const first = await readAliasCatalog(aliasCatalogPath(projectRoot)); if (!first.ok) throw new Error(first.reason);
      const firstRecord = first.catalog.observations.baseline!;
      expect(existsSync(path.join(projectEvidenceRoot(projectRoot), ...firstRecord.relativeArtifactDir.split('/'), 'manifest.json'))).toBe(true);
      const checked = await checkProject(projectRoot, 'baseline');
      expect(checked.status).toBe('REVIEW_REQUIRED');
      expect(checked.comparison.state).toBe('comparable');
      expect(checked.candidate?.alias).toBe('current');
      expect(await runCli(['capture', 'baseline', '--replace'], quiet)).toBe(0);
      const second = await readAliasCatalog(aliasCatalogPath(projectRoot)); if (!second.ok) throw new Error(second.reason);
      const secondRecord = second.catalog.observations.baseline!;
      expect(secondRecord.observationId).not.toBe(firstRecord.observationId);
      expect(existsSync(path.join(projectEvidenceRoot(projectRoot), ...firstRecord.relativeArtifactDir.split('/'), 'manifest.json'))).toBe(true);
      expect(JSON.parse(await readFile(path.join(projectEvidenceRoot(projectRoot), ...secondRecord.relativeArtifactDir.split('/'), 'manifest.json'), 'utf8')).observationId).toBe(secondRecord.observationId);

      viewer = await startViewer({ root: projectEvidenceRoot(projectRoot), port: 0, assetsRoot: viewerDist, aliasMetadata: { observationAliasesByRelativeDir: { [secondRecord.relativeArtifactDir]: 'baseline' } } }) as Extract<StartViewerResult, { ok: true }>;
      const index = await (await fetch(`${viewer.url}/api/index`)).json() as { records: { alias?: string; logicalId?: string }[] };
      expect(index.records.filter((record) => record.alias === 'baseline')).toHaveLength(1);
      expect(index.records.find((record) => record.alias === 'baseline')?.logicalId).toBe(secondRecord.observationId);
      expect(index.records.find((record) => record.logicalId === firstRecord.observationId)?.alias).toBeUndefined();

      const page = await browser.newPage(); await page.goto(viewer.url);
      const item = page.locator('.evidence-list__item', { hasText: 'baseline' }); await item.waitFor();
      expect(await item.locator('.evidence-list__id').textContent()).toBe('baseline');
      expect(await item.textContent()).not.toContain(secondRecord.observationId);
      await item.click();
      await page.locator('.target-overlay-svg image').first().waitFor();
      expect(await page.textContent('body')).toContain(secondRecord.observationId);
      await page.close();
    } finally { process.chdir(previous); }
  }, 120_000);

  it('v0.9 Batch 2: a real same-origin page in a project-aware viewer can save an annotation, while a read-only viewer cannot', async () => {
    const state = await loadProjectViewerState(projectRoot);
    if (!state.ok) throw new Error(state.message);
    const authoringViewer = await startViewer({ root: state.root, port: 0, assetsRoot: viewerDist, aliasMetadata: { observationAliasesByRelativeDir: state.aliases }, authoringProjectRoot: state.projectRoot });
    if (!authoringViewer.ok) throw new Error(JSON.stringify(authoringViewer.diagnostics));
    const readOnlyViewer = await startViewer({ root: state.root, port: 0, assetsRoot: viewerDist });
    if (!readOnlyViewer.ok) throw new Error(JSON.stringify(readOnlyViewer.diagnostics));
    const page = await browser.newPage();
    try {
      await page.goto(authoringViewer.url);
      const saved = await page.evaluate(async () => {
        const session = (await (await fetch('/api/authoring/session')).json()) as { enabled: boolean; token: string };
        const index = (await (await fetch('/api/index')).json()) as { records: { family: string; handle: string; alias?: string }[] };
        const source = index.records.find((record) => record.family === 'observation' && record.alias === 'baseline');
        const body = JSON.stringify({ sourceHandle: source?.handle, items: [{ annotationItemId: 'item-1', mark: { kind: 'rectangle', x: 10, y: 20, width: 100, height: 50 }, association: { kind: 'runtime-target', target: 'header' }, interpretation: { state: 'uninterpreted' } }] });
        const withoutToken = await fetch('/api/annotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        const response = await fetch('/api/annotations', { method: 'POST', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': session.token }, body });
        return { enabled: session.enabled, withoutToken: withoutToken.status, status: response.status, json: (await response.json()) as { annotationId?: string; handle?: string } };
      });
      expect(saved.enabled).toBe(true);
      expect(saved.withoutToken).toBe(403);
      expect(saved.status).toBe(201);
      expect(existsSync(path.join(projectAnnotationsRoot(projectRoot), saved.json.annotationId!, 'manifest.json'))).toBe(true);

      await page.goto(readOnlyViewer.url);
      const readOnly = await page.evaluate(async () => {
        const session = (await (await fetch('/api/authoring/session')).json()) as { enabled: boolean };
        const response = await fetch('/api/annotations', { method: 'POST', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': 'a'.repeat(64) }, body: '{}' });
        return { enabled: session.enabled, status: response.status };
      });
      expect(readOnly).toEqual({ enabled: false, status: 403 });
    } finally {
      await page.close();
      await authoringViewer.close();
      await readOnlyViewer.close();
    }
  }, 120_000);
});
