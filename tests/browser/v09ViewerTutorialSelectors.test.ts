import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { loadProjectViewerState } from '../../src/application/projectWorkflowService.js';
import { TestResources, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

type RunningViewer = Extract<StartViewerResult, { ok: true }>;

/**
 * v0.9 tutorial integration added exactly two stable automation selectors to
 * the viewer, one per annotation drawing surface. They exist so a
 * locator-anchored pointer gesture binds to a declared contract rather than to
 * a presentation class name.
 *
 * These tests prove each id is present in the state a tutorial uses it in, and
 * that adding it changed no behavior: the surface keeps its role, its
 * accessible name and its pointer handling. Nothing here asserts internal
 * React structure.
 */
describe('v0.9 viewer tutorial selectors', () => {
  let browser: Browser;
  const resources = new TestResources();
  let viewer: RunningViewer;
  let page: Page;

  beforeAll(async () => {
    if (!existsSync(path.join(viewerDist, 'index.html'))) {
      execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], { cwd: repoRoot, stdio: 'inherit' });
    }
    browser = await chromium.launch();
    const project = await writeInitializedProject(resources);
    const state = await loadProjectViewerState(project.projectRoot);
    if (!state.ok) throw new Error(state.message);
    const started = await startViewer({
      root: state.root,
      port: 0,
      assetsRoot: viewerDist,
      aliasMetadata: { observationAliasesByRelativeDir: state.aliases },
      authoringProjectRoot: state.projectRoot,
    });
    if (!started.ok) throw new Error('viewer failed to start');
    viewer = started;
    page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    await page.goto(viewer.url);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await viewer?.close();
    await resources.cleanup();
  });

  async function openObservation(): Promise<void> {
    await page.goto(viewer.url);
    const item = page.locator('.evidence-list__item', { hasText: 'observation' }).first();
    await item.waitFor({ timeout: 15_000 });
    await item.click();
    await page.locator('[data-testid="runtime-annotation-surface"]').waitFor({ timeout: 15_000 });
  }

  it('exposes exactly one runtime annotation surface when an observation is open', async () => {
    await openObservation();
    const surface = page.locator('[data-testid="runtime-annotation-surface"]');
    expect(await surface.count()).toBe(1);
  });

  it('puts the runtime test id on the real drawing surface, not a wrapper', async () => {
    await openObservation();
    const described = await page.locator('[data-testid="runtime-annotation-surface"]').evaluate((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      hasScreenshot: element.querySelector('image') !== null,
      classes: element.getAttribute('class'),
    }));
    expect(described.tag).toBe('svg');
    expect(described.hasScreenshot).toBe(true);
    // Behaviour-neutral: the pre-existing role, accessible name and class are untouched.
    expect(described.role).toBe('img');
    expect(described.ariaLabel).toMatch(/^Observation viewport, \d+ by \d+ CSS pixels$/);
    expect(described.classes).toContain('target-overlay-svg');
  });

  it('keeps the runtime surface present in every interaction mode a tutorial uses', async () => {
    await openObservation();
    for (const mode of ['Select', 'Pan', 'Point', 'Rectangle', 'Line', 'Arrow', 'Note']) {
      await page.getByRole('button', { name: `${mode} mode` }).click();
      expect(await page.locator('[data-testid="runtime-annotation-surface"]').count(), mode).toBe(1);
    }
  });

  it('still draws through the surface, so the added id changed no behaviour', async () => {
    await openObservation();
    const before = await page.locator('.annotation-panel__draft-summary').getAttribute('data-draft-item-count');
    await page.getByRole('button', { name: 'Rectangle mode' }).click();
    const box = await page.locator('[data-testid="runtime-annotation-surface"]').boundingBox();
    if (box === null) throw new Error('surface has no bounding box');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
    await page.mouse.up();
    expect(before).toBe('0');
    expect(await page.locator('.annotation-panel__draft-summary').getAttribute('data-draft-item-count')).toBe('1');
  });

  it('does not leak the runtime surface id into the comparison workspace', async () => {
    // The overlay component is shared; only the annotation-capable workspace
    // supplies a test id, so a two-pane view can never render a duplicate.
    await openObservation();
    const duplicates = await page.locator('[data-testid="runtime-annotation-surface"]').count();
    expect(duplicates).toBe(1);
    expect(await page.locator('[data-testid="reference-annotation-surface"]').count()).toBe(0);
  });

  it('exposes exactly one reference annotation surface when a reference is open', async () => {
    await page.goto(viewer.url);
    const reference = page.locator('.evidence-list__item', { hasText: 'external-reference' }).first();
    await reference.waitFor({ timeout: 15_000 });
    await reference.click();
    const surface = page.locator('[data-testid="reference-annotation-surface"]');
    await surface.waitFor({ timeout: 15_000 });
    expect(await surface.count()).toBe(1);

    const described = await surface.evaluate((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      classes: element.getAttribute('class'),
    }));
    expect(described.tag).toBe('svg');
    expect(described.role).toBe('img');
    // The reference surface keeps announcing reference-image pixels, which is
    // the coordinate distinction the tutorials teach.
    expect(described.ariaLabel).toMatch(/^Reference image, \d+ by \d+ pixels$/);
    expect(described.classes).toContain('reference-region-overlay-svg');
    expect(await page.locator('[data-testid="runtime-annotation-surface"]').count()).toBe(0);
  });
});
