import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const viewerRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Batch 1 viewer build: the resulting bundle is served from
 * `dist/viewer` by the Node viewer server (src/viewerServer), and packaged
 * into the npm distribution through the existing `dist` allowlist - no
 * second npm package, no separate publish boundary.
 *
 * The service worker precaches only the built application shell (HTML/JS/
 * CSS/icons/manifest). It intentionally declares no `runtimeCaching` rules:
 * Batch 1 has no evidence API yet, and later batches' evidence/media
 * endpoints must remain network/server-backed rather than silently served
 * as stale cached truth (see docs/plans/v0.8-implementation-plan.md 4.6).
 */
export default defineConfig({
  root: viewerRoot,
  base: '/',
  build: {
    outDir: '../dist/viewer',
    emptyOutDir: true,
  },
  cacheDir: process.env.VITE_CACHE_DIR ?? '../node_modules/.vite-viewer',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'my-frontend-observer Viewer',
        short_name: 'Observer Viewer',
        description: 'Local-first interactive viewer for my-frontend-observer runtime evidence.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // App-shell precache only. No runtimeCaching entries: future evidence/media
        // routes must stay network/server-backed, never silently served stale.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
