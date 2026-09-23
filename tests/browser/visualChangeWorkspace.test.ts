import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { persistVisualChangeWorkflow } from '../../src/application/visualChangeWorkflowPersistenceService.js';
import type { VisualChangeActualScope } from '../../src/domain/visualChangeWorkflow.js';
import { visualChangeOutputLocation } from '../../src/projectWorkflow/projectPaths.js';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { TestResources, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';

const repoRoot = path.resolve(__dirname, '../..'); const viewerDist = path.join(repoRoot, 'dist', 'viewer'); const resources = new TestResources(); let browser: Browser;
const scope: VisualChangeActualScope = { entryMode: 'actual-frontend', annotationId: 'annotation-id', annotationArtifactPath: '.frontend-observer/evidence/annotations/annotation', baselineObservation: { artifactId: 'baseline-observation', observationId: 'baseline-observation', requestId: 'baseline-request', artifactPath: '.frontend-observer/evidence/observations/baseline' }, changeContract: { artifactId: 'change-contract', contractId: 'change-contract', contractRequestId: 'change-request', artifactPath: '.frontend-observer/evidence/contracts/change' } };
beforeAll(async () => { if (!existsSync(path.join(viewerDist, 'index.html'))) execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], { cwd: repoRoot, stdio: 'inherit' }); browser = await chromium.launch(); }, 120_000);
afterAll(async () => { await browser?.close(); await resources.cleanup(); });

async function viewer(authoring: boolean): Promise<Extract<StartViewerResult, { ok: true }>> { const project = await writeInitializedProject(resources); const persisted = await persistVisualChangeWorkflow({ scope, outputLocation: visualChangeOutputLocation(), cwd: project.projectRoot }); if (!persisted.ok) throw new Error('workflow fixture failed'); const result = await startViewer({ root: project.root, port: 0, assetsRoot: viewerDist, ...(authoring ? { authoringProjectRoot: project.projectRoot } : {}) }); if (!result.ok) throw new Error('viewer failed'); return result; }

describe('Visual changes Viewer workspace (real Chromium)', () => {
  it.each([{ authoring: false }, { authoring: true }])('is keyboard-accessible, exact, and $authoring authoring mode', async ({ authoring }) => {
    const running = await viewer(authoring); const page = await browser.newPage(); try { await page.goto(running.url); const tabs = page.getByRole('navigation', { name: 'Viewer mode' }); await expect.poll(async () => tabs.getByRole('button').allTextContents()).toEqual(['Evidence', 'Bounded context', 'Visual changes']); const visual = tabs.getByRole('button', { name: 'Visual changes' }); await visual.focus(); await page.keyboard.press('Enter'); expect(await visual.getAttribute('aria-pressed')).toBe('true'); const selector = page.locator('.visual-change-list button'); await selector.first().waitFor(); await selector.first().press('Enter'); await page.getByRole('heading', { name: 'Workflow summary' }).waitFor(); const text = await page.locator('.visual-change-detail').textContent(); expect(text).toContain('actual-frontend'); expect(text).toContain('baseline-observation'); expect(text).toContain('change-contract'); expect(text).toContain('unavailable'); expect(text).not.toContain('Prepare handoff'); expect(text).not.toContain('Request correction');
      if (authoring) { expect(await page.getByRole('button', { name: 'Activate' }).count()).toBe(1); expect(await page.getByRole('button', { name: 'Run check' }).isDisabled()).toBe(true); }
      else { expect(text).toContain('Project-aware authoring is required'); expect(await page.getByRole('button', { name: 'Activate' }).count()).toBe(0); }
      expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, body: document.body.textContent?.includes('x-frontend-observer-authoring-token') }))).toEqual({ local: 0, session: 0, body: false });
    } finally { await page.close(); await running.close(); }
  }, 120_000);
});
