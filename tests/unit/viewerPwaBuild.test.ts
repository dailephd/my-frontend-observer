import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');
const manifestPath = path.join(viewerDist, 'manifest.webmanifest');

/**
 * Build/integration level (13.6/13.8): validates the actual Vite-built PWA
 * output, not a hand-written approximation of it. Builds the viewer once
 * up front if it is not already present, so this test is correct regardless
 * of whether it runs before or after `npm run build` in the validation
 * sequence.
 */
beforeAll(() => {
  if (!existsSync(manifestPath)) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }
}, 120_000);

describe('viewer PWA build output', () => {
  it('produces a valid web app manifest with standalone display and stable identity', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(manifest.name).toBe('my-frontend-observer Viewer');
    expect(manifest.short_name).toBe('Observer Viewer');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  it('declares required installability icons and every referenced icon file exists in the built output', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { icons: { src: string; sizes: string }[] };
    expect(Array.isArray(manifest.icons)).toBe(true);
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    for (const icon of manifest.icons) {
      expect(existsSync(path.join(viewerDist, icon.src))).toBe(true);
    }
  });

  it('produces a service-worker/installability output referencing the manifest from the built shell', async () => {
    expect(existsSync(path.join(viewerDist, 'sw.js'))).toBe(true);
    const indexHtml = await readFile(path.join(viewerDist, 'index.html'), 'utf8');
    expect(indexHtml).toContain('manifest.webmanifest');
  });

  it('precaches only the application shell and declares no generic evidence/API runtime-caching route', async () => {
    const swSource = await readFile(path.join(viewerDist, 'sw.js'), 'utf8');

    // Exactly one registerRoute call: the SPA navigation fallback, explicitly denylisting /api/.
    // No second registerRoute call exists to cache arbitrary future evidence/media/API responses.
    const registerRouteCalls = swSource.match(/registerRoute\(/g) ?? [];
    expect(registerRouteCalls.length).toBe(1);
    expect(swSource).toContain('NavigationRoute');
    expect(swSource).toMatch(/denylist:\[\/\^\\\/api\\\/\/]/);

    const precacheMatch = /precacheAndRoute\(\[(.*?)],\{}\)/.exec(swSource);
    expect(precacheMatch).not.toBeNull();
    const precacheEntries = precacheMatch?.[1] ?? '';
    expect(precacheEntries).not.toContain('/api');
    // Only app-shell asset kinds are precached.
    for (const url of precacheEntries.match(/url:"([^"]+)"/g) ?? []) {
      expect(url).toMatch(/\.(js|css|html|png|webmanifest)"$/);
    }
  });
});
