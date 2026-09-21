import { describe, expect, it } from 'vitest';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  detectExternalReferenceImageFormat,
  readExternalReferenceImageDimensions,
  isValidExternalReferenceImageDimensions,
  EXTERNAL_REFERENCE_MAX_IMAGE_BYTES,
} from '../../src/domain/externalReferenceImage.js';
// The demo server module owns the frozen demo vocabulary; the tests read it
// from there rather than restating it, so a vocabulary drift fails loudly.
import { DEMO_STATES, DEMO_CANONICAL_VIEWPORT, DEMO_ID } from '../../examples/v09-demo/scripts/server.mjs';

const repoRoot = path.resolve(__dirname, '../..');
const demoRoot = path.join(repoRoot, 'examples', 'v09-demo');
const appRoot = path.join(demoRoot, 'app');
const referencesRoot = path.join(demoRoot, 'references');

/**
 * v0.9 demo foundation: the frozen stable-target vocabulary. These are
 * product-demo identity, deliberately independent of any incidental CSS
 * class, and later tutorial scenarios bind to them.
 */
const REQUIRED_DEMO_TARGETS = [
  'header',
  'navigation',
  'hero',
  'sidebar',
  'content',
  'card-1',
  'card-2',
  'cta',
  'footer',
  'asset',
];

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursively(full)));
    else files.push(full);
  }
  return files.sort();
}

describe('v0.9 demo template - stable target identity', () => {
  it('declares every required data-demo-target exactly once in the baseline document', async () => {
    const html = await readFile(path.join(appRoot, 'index.html'), 'utf8');
    for (const target of REQUIRED_DEMO_TARGETS) {
      const occurrences = html.split(`data-demo-target="${target}"`).length - 1;
      expect(occurrences, `data-demo-target="${target}" occurrence count`).toBe(1);
    }
  });

  it('declares no demo target outside the frozen vocabulary', async () => {
    const html = await readFile(path.join(appRoot, 'index.html'), 'utf8');
    const declared = [...html.matchAll(/data-demo-target="([^"]+)"/g)].map((match) => match[1]!);
    expect([...declared].sort()).toEqual([...REQUIRED_DEMO_TARGETS].sort());
  });

  it('ships the baseline state already frozen into the template, so the tracked file is a valid standalone document', async () => {
    const html = await readFile(path.join(appRoot, 'index.html'), 'utf8');
    expect(html.split('data-demo-state="baseline"').length - 1).toBe(1);
  });

  it('adds data-testid only where stable automation identity is actually needed', async () => {
    const html = await readFile(path.join(appRoot, 'index.html'), 'utf8');
    const testIds = [...html.matchAll(/data-testid="([^"]+)"/g)].map((match) => match[1]!);
    expect(new Set(testIds).size, 'every data-testid is unique').toBe(testIds.length);
    expect(testIds).toContain('demo-state-badge');
    expect(testIds).toContain('demo-cta-button');
    expect(testIds).toContain('demo-asset-image');
    for (const state of DEMO_STATES) {
      expect(testIds, `navigation test id for ${state}`).toContain(`demo-nav-${state}`);
    }
    // Frozen count: one badge, one CTA button, one asset image, one navigation
    // link per state. Growing this set is a deliberate decision, not a
    // mechanical sweep over every element.
    expect(testIds.length).toBe(3 + DEMO_STATES.length);
  });

  it('uses semantic structural elements for the major regions', async () => {
    const html = await readFile(path.join(appRoot, 'index.html'), 'utf8');
    expect(html).toMatch(/<header[^>]*data-demo-target="header"/);
    expect(html).toMatch(/<nav[^>]*data-demo-target="navigation"/);
    expect(html).toMatch(/<aside[^>]*data-demo-target="sidebar"/);
    expect(html).toMatch(/<main[^>]*data-demo-target="content"/);
    expect(html).toMatch(/<footer[^>]*data-demo-target="footer"/);
  });
});

describe('v0.9 demo template - offline and deterministic asset policy', () => {
  it('references no remote origin from any demo application file', async () => {
    const files = await listFilesRecursively(appRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      const withoutXmlNamespace = contents.replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '');
      expect(withoutXmlNamespace, `${path.relative(repoRoot, file)} must not reference http://`).not.toContain('http://');
      expect(withoutXmlNamespace, `${path.relative(repoRoot, file)} must not reference https://`).not.toContain('https://');
      expect(withoutXmlNamespace, `${path.relative(repoRoot, file)} must not use protocol-relative URLs`).not.toContain('//fonts.');
    }
  });

  it('ships every asset the demo application references as a local committed file', async () => {
    const html = await readFile(path.join(appRoot, 'index.html'), 'utf8');
    const stateScript = await readFile(path.join(appRoot, 'state.js'), 'utf8');
    const referenced = new Set<string>([
      ...[...html.matchAll(/(?:src|href)="([^"?#]+)"/g)].map((match) => match[1]!),
      ...[...stateScript.matchAll(/'(assets\/[^']+)'/g)].map((match) => match[1]!),
    ]);
    for (const reference of referenced) {
      const resolved = path.resolve(appRoot, reference);
      const stats = await stat(resolved).catch(() => undefined);
      expect(stats?.isFile(), `${reference} must exist under examples/v09-demo/app`).toBe(true);
    }
  });

  it('uses no animation, transition, timer or randomness anywhere in the demo application', async () => {
    const files = await listFilesRecursively(appRoot);
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      const relative = path.relative(repoRoot, file);
      for (const forbidden of ['@keyframes', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'Math.random', 'Date.now', 'new Date(']) {
        expect(contents, `${relative} must not use ${forbidden}`).not.toContain(forbidden);
      }
      expect(contents, `${relative} must not animate`).not.toMatch(/\btransition\s*:/);
      expect(contents, `${relative} must not animate`).not.toMatch(/\banimation\s*:/);
    }
  });

  it('commits no generated Observer evidence inside the demo template', async () => {
    const files = await listFilesRecursively(demoRoot);
    for (const file of files) {
      expect(path.relative(repoRoot, file)).not.toContain('.frontend-observer');
    }
  });
});

describe('v0.9 demo template - fixed reference asset', () => {
  const referencePng = path.join(referencesRoot, 'v09-reference.png');

  it('commits the reference image as a non-empty regular file', async () => {
    const stats = await stat(referencePng);
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);
    expect(stats.size).toBeLessThanOrEqual(EXTERNAL_REFERENCE_MAX_IMAGE_BYTES);
  });

  it('is a supported reference image at the canonical tutorial viewport, read through the canonical Observer image boundary', async () => {
    const bytes = new Uint8Array(await readFile(referencePng));
    const format = detectExternalReferenceImageFormat(bytes);
    expect(format).toBe('png');
    const dimensions = readExternalReferenceImageDimensions(bytes, 'png');
    expect(dimensions).toBeDefined();
    expect(isValidExternalReferenceImageDimensions(dimensions!)).toBe(true);
    expect(dimensions).toEqual(DEMO_CANONICAL_VIEWPORT);
  });

  it('records honest provenance beside the image without inventing an Observer artifact schema', async () => {
    const provenance = JSON.parse(await readFile(path.join(referencesRoot, 'v09-reference.provenance.json'), 'utf8'));
    expect(provenance.demoId).toBe(DEMO_ID);
    expect(provenance.sourceDemoState).toBe('reference');
    expect(provenance.canonicalViewport).toEqual(DEMO_CANONICAL_VIEWPORT);
    expect(provenance.imageFormat).toBe('png');
    expect(typeof provenance.capturedWith).toBe('string');
    expect(typeof provenance.regenerateWith).toBe('string');
    expect(typeof provenance.intendedUse).toBe('string');
    // Not an Observer evidence artifact: it must not claim an artifact kind or schema version.
    expect(provenance.kind).toBeUndefined();
    expect(provenance.schemaVersion).toBeUndefined();
  });
});
