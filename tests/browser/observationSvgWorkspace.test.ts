import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeRichObservationFixture, type RichObservationFixture } from '../support/evidenceFixtures.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

let browser: Browser;
let server: Extract<StartViewerResult, { ok: true }>;
let evidenceRoot: string;
let fixture: RichObservationFixture;

/**
 * v0.8 Batch 3 real-browser proof (task §33): the actual built React shell,
 * through the actual loopback viewer server, against one real persisted
 * observation (real writer, real decodable viewport-sized PNG screenshot,
 * two geometrically resolved targets plus one genuinely unresolved target).
 */
beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }

  evidenceRoot = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-obs-svg-workspace-'));
  fixture = await writeRichObservationFixture(evidenceRoot);

  const result = await startViewer({ root: evidenceRoot, port: 0, assetsRoot: viewerDist });
  if (!result.ok) throw new Error(`viewer server failed to start: ${JSON.stringify(result.diagnostics)}`);
  server = result;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (evidenceRoot !== undefined) await rm(evidenceRoot, { recursive: true, force: true });
});

describe('observation SVG inspection workspace (real Chromium, real persisted observation)', () => {
  it('loads the screenshot, renders SVG target rectangles with canonical geometry, and never fabricates one for the unresolved target', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item', { hasText: fixture.observationId });
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      // Screenshot visibly loads (the SVG <image> element resolves against the real Batch 2 media endpoint, never a local path/base64).
      const image = page.locator('.target-overlay-svg image');
      await image.waitFor({ timeout: 10_000 });
      const href = await image.getAttribute('href');
      expect(href).toMatch(/^\/api\/media\/observation:/);

      // Resolved targets have real SVG rectangles using their exact canonical geometry (rect(0,0,800,80) for "header").
      const headerRect = page.locator('rect[data-target-name="header"]');
      await headerRect.waitFor({ timeout: 10_000 });
      expect(await headerRect.getAttribute('x')).toBe('0');
      expect(await headerRect.getAttribute('y')).toBe('0');
      expect(await headerRect.getAttribute('width')).toBe('800');
      expect(await headerRect.getAttribute('height')).toBe('80');

      const sidebarRect = page.locator('rect[data-target-name="sidebar"]');
      await sidebarRect.waitFor({ timeout: 10_000 });
      expect(await sidebarRect.getAttribute('x')).toBe('0');
      expect(await sidebarRect.getAttribute('y')).toBe('100');
      expect(await sidebarRect.getAttribute('width')).toBe('200');
      expect(await sidebarRect.getAttribute('height')).toBe('400');

      // The genuinely unresolved target never receives a fabricated rectangle.
      expect(await page.locator('rect[data-target-name="missingWidget"]').count()).toBe(0);
      // It still appears in the structured target list, honestly labeled.
      const listEntry = page.locator('.target-list__item', { hasText: 'missingWidget' });
      await listEntry.waitFor({ timeout: 5_000 });
      expect(await listEntry.textContent()).toContain('not-found');
    } finally {
      await page.close();
    }
  });

  it('selecting the SVG rectangle selects the stable target, highlights the list entry, and the inspector shows matching canonical geometry', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item', { hasText: fixture.observationId });
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      const headerRect = page.locator('rect[data-target-name="header"]');
      await headerRect.waitFor({ timeout: 10_000 });
      await headerRect.click();

      await page.getByText('Target: header').waitFor({ timeout: 5_000 });
      const inspectorText = await page.locator('.inspector').textContent();
      expect(inspectorText).toContain('x:0');
      expect(inspectorText).toContain('y:0');
      expect(inspectorText).toContain('w:800');
      expect(inspectorText).toContain('h:80');

      const listItem = page.locator('.target-list__item', { hasText: 'header' });
      await expect.poll(() => listItem.getAttribute('aria-pressed')).toBe('true');
      await expect.poll(() => headerRect.getAttribute('aria-pressed')).toBe('true');
    } finally {
      await page.close();
    }
  });

  it('selecting a target from the list highlights the same SVG target', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item', { hasText: fixture.observationId });
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      const listItem = page.locator('.target-list__item', { hasText: 'sidebar' });
      await listItem.waitFor({ timeout: 10_000 });
      await listItem.click();

      const sidebarRect = page.locator('rect[data-target-name="sidebar"]');
      await expect.poll(() => sidebarRect.getAttribute('aria-pressed')).toBe('true');
      await page.getByText('Target: sidebar').waitFor({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  it('relationship display reflects the canonical relationship result (header above footer) as derived evidence', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item', { hasText: fixture.observationId });
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      await page.getByText('header').first().waitFor({ timeout: 10_000 });
      const relationshipsText = await page.locator('.relationships-section').textContent();
      expect(relationshipsText).toContain('above');
      expect(relationshipsText).toContain('Derived evidence');

      // A relationship connector line was actually drawn between the two geometric targets.
      expect(await page.locator('line.target-overlay-svg__relationship').count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('screenshot and SVG overlay remain aligned (same aspect ratio as the canonical viewport) after the viewer display is resized', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.goto(server.url);
      const item = page.locator('.evidence-list__item', { hasText: fixture.observationId });
      await item.waitFor({ timeout: 10_000 });
      await item.click();
      await page.locator('.target-overlay-svg image').waitFor({ timeout: 10_000 });

      const svg = page.locator('.target-overlay-svg');
      const before = await svg.boundingBox();
      expect(before).not.toBeNull();

      await page.setViewportSize({ width: 1400, height: 900 });
      await page.waitForTimeout(200);
      const after = await svg.boundingBox();
      expect(after).not.toBeNull();

      // The fixture's canonical viewport is 800x600 (aspect ratio 4:3 ≈ 1.333). The SVG's own viewBox preserves that
      // ratio regardless of the surrounding window size, so the rendered box's aspect ratio must remain stable.
      const ratioBefore = before!.width / before!.height;
      const ratioAfter = after!.width / after!.height;
      expect(Math.abs(ratioBefore - ratioAfter)).toBeLessThan(0.05);
      expect(Math.abs(ratioBefore - 800 / 600)).toBeLessThan(0.05);
    } finally {
      await page.close();
    }
  });
});
