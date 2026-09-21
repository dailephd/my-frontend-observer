#!/usr/bin/env node
// Regenerates the fixed external visual reference asset for the
// my-frontend-observer v0.9 demo.
//
// This script adds no second screenshot engine. It serves the tracked demo
// template's `reference` state on loopback and captures it through the
// repository's own canonical Chromium observation path
// (`src/browser/chromiumAdapter.ts` -> `dist/browser/chromiumAdapter.js`),
// then writes that capture's PNG bytes to the tracked reference asset.
//
// The committed PNG is a fixed demo asset. This script is explicit and
// manual on purpose: no test run regenerates it, so an intentional visual
// change to the demo is reviewed deliberately.
//
// Requires a prior `npm run build` (it reads the compiled Observer modules).
//
// Usage: node examples/v09-demo/scripts/generate-reference.mjs

import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDemoServer, DEMO_ID, DEMO_CANONICAL_VIEWPORT } from './server.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(demoRoot, '..', '..');
const appRoot = path.join(demoRoot, 'app');
const referencesDir = path.join(demoRoot, 'references');

export const REFERENCE_STATE = 'reference';
export const REFERENCE_PNG_PATH = path.join(referencesDir, 'v09-reference.png');
export const REFERENCE_PROVENANCE_PATH = path.join(referencesDir, 'v09-reference.provenance.json');

/** The demo regions captured as evidence alongside the image, so the capture is a real Observer observation rather than a bare screenshot. */
const REFERENCE_TARGETS = [
  { name: 'header', selector: '[data-demo-target="header"]' },
  { name: 'navigation', selector: '[data-demo-target="navigation"]' },
  { name: 'hero', selector: '[data-demo-target="hero"]' },
  { name: 'sidebar', selector: '[data-demo-target="sidebar"]' },
  { name: 'content', selector: '[data-demo-target="content"]' },
  { name: 'card-1', selector: '[data-demo-target="card-1"]' },
  { name: 'card-2', selector: '[data-demo-target="card-2"]' },
  { name: 'cta', selector: '[data-demo-target="cta"]' },
  { name: 'footer', selector: '[data-demo-target="footer"]' },
  { name: 'asset', selector: '[data-demo-target="asset"]' },
];

async function loadBuiltObserver() {
  const distDir = path.join(repoRoot, 'dist');
  const adapter = path.join(distDir, 'browser', 'chromiumAdapter.js');
  const request = path.join(distDir, 'request', 'request.js');
  if (!existsSync(adapter) || !existsSync(request)) {
    throw new Error(`compiled Observer modules are missing under ${distDir}; run "npm run build" first`);
  }
  const [{ captureViewportInternal }, { normalizeRequest }] = await Promise.all([
    import(pathToFileURL(adapter).href),
    import(pathToFileURL(request).href),
  ]);
  return { captureViewportInternal, normalizeRequest };
}

async function main() {
  const { captureViewportInternal, normalizeRequest } = await loadBuiltObserver();

  const server = await startDemoServer({ port: 0, appRoot });
  try {
    const targetUrl = `${server.baseUrl}/?state=${REFERENCE_STATE}`;
    const normalized = normalizeRequest({
      targetUrl,
      viewport: DEMO_CANONICAL_VIEWPORT,
      targets: REFERENCE_TARGETS,
    });
    if (!normalized.ok) {
      throw new Error(`reference capture request was rejected: ${JSON.stringify(normalized.diagnostics)}`);
    }

    const { result } = await captureViewportInternal(normalized.request);
    if (!result.ok) {
      throw new Error(`reference capture failed: ${JSON.stringify(result.diagnostics)}`);
    }

    await writeFile(REFERENCE_PNG_PATH, Buffer.from(result.screenshot));

    const provenance = {
      demoId: DEMO_ID,
      asset: path.basename(REFERENCE_PNG_PATH),
      sourceDemoState: REFERENCE_STATE,
      canonicalViewport: DEMO_CANONICAL_VIEWPORT,
      imageFormat: 'png',
      capturedWith: 'my-frontend-observer canonical Chromium observation path (src/browser/chromiumAdapter.ts)',
      regenerateWith: 'npm run build && node examples/v09-demo/scripts/generate-reference.mjs',
      intendedUse:
        'Fixed external visual reference for the v0.9 demo tutorials. Imported and approved through the canonical Observer external-reference commands inside a disposable materialized target, never committed as an approved reference artifact in this template.',
      note: 'Provenance record for a demo asset. This is not an Observer evidence artifact and defines no Observer schema.',
    };
    await writeFile(REFERENCE_PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`);

    console.log(`reference captured from ${targetUrl}`);
    console.log(`  ${REFERENCE_PNG_PATH}`);
    console.log(`  ${REFERENCE_PROVENANCE_PATH}`);
  } finally {
    await server.close();
  }
}

await main();
