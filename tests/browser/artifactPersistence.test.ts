import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureViewportInternal } from '../../src/browser/chromiumAdapter.js';
import { persistBrowserCapture } from '../../src/application/observationPersistence.js';
import { MANIFEST_FILENAME, SCREENSHOT_FILENAME } from '../../src/artifacts/artifactWriter.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import { isValidObservationArtifact } from '../../src/domain/schema.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import {
  startFixtureServer,
  type FixtureServer,
  OBSERVATION_FIXTURE_SELECTORS,
  OBSERVATION_FIXTURE_BUTTON_GEOMETRY,
} from '../fixtures/server.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

describe('artifact persistence (Batch 4, real Chromium capture to disk)', () => {
  let fixtures: FixtureServer;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-artifact-browser-'));
    tempDirs.push(dir);
    return dir;
  }

  // B4-TST-020,021,022,023,024: real capture persists successfully, with byte-identical screenshot,
  // honest missing/ambiguous target evidence, intact browser cleanup, and no earlier-batch regression.
  it('B4-TST-020..024: persists a real Batch 3 Chromium capture to disk consistently', async () => {
    const cwd = await freshCwd();
    const request: NormalizedObservationRequest = {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [
        { name: 'button', selector: OBSERVATION_FIXTURE_SELECTORS.button },
        { name: 'ghost', selector: OBSERVATION_FIXTURE_SELECTORS.missing },
        { name: 'dup', selector: OBSERVATION_FIXTURE_SELECTORS.duplicate },
      ],
      outputLocation: '.',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    };

    const { result: capture, browserConnected } = await captureViewportInternal(request);
    expect(capture.ok).toBe(true);
    if (!capture.ok) throw new Error('expected a successful browser capture');

    // B4-TST-023: browser cleanup is unaffected by the fact that this capture will also be persisted.
    expect(browserConnected).toBe(false);

    const persisted = await persistBrowserCapture(capture, request, { cwd });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw new Error('expected persistence to succeed');

    const manifest = JSON.parse(await readFile(persisted.manifestPath, 'utf8')) as ObservationArtifact;
    expect(isValidObservationArtifact(manifest)).toEqual({ valid: true });

    // B4-TST-020: consistency across provenance / final URL / viewport / target IDs / screenshot.
    expect(manifest.browser).toMatchObject({ state: 'available', source: 'browser', value: { engine: 'chromium' } });
    expect(manifest.pageEvidence.finalUrl).toMatchObject({ state: 'available', value: request.targetUrl });
    expect(manifest.pageEvidence.viewportWidth).toMatchObject({ value: 800 });
    expect(manifest.pageEvidence.viewportHeight).toMatchObject({ value: 600 });
    expect(Object.keys(manifest.targetEvidence).sort()).toEqual(['button', 'dup', 'ghost']);
    expect(manifest.targetEvidence.button?.geometry).toMatchObject({ state: 'available', value: OBSERVATION_FIXTURE_BUTTON_GEOMETRY });

    // B4-TST-021: no second screenshot was taken - persisted bytes equal the live capture's bytes.
    const persistedScreenshot = await readFile(persisted.screenshotPath);
    expect(new Uint8Array(persistedScreenshot)).toEqual(capture.screenshot);
    expect(isPngSignature(new Uint8Array(persistedScreenshot))).toBe(true);
    expect(path.basename(persisted.screenshotPath)).toBe(SCREENSHOT_FILENAME);
    expect(path.basename(persisted.manifestPath)).toBe(MANIFEST_FILENAME);

    // B4-TST-022: missing/ambiguous target semantics survive persistence honestly.
    expect(manifest.targetEvidence.ghost?.resolution).toMatchObject({ value: { selectionStatus: 'not-found' } });
    expect(manifest.targetEvidence.ghost?.geometry.state).toBe('unavailable');
    expect(manifest.targetEvidence.dup?.resolution).toMatchObject({ value: { selectionStatus: 'ambiguous' } });
    expect(manifest.targetEvidence.dup?.geometry.state).toBe('unavailable');
    expect(manifest.diagnostics.some((d) => d.code === 'target-missing' && d.targetName === 'ghost')).toBe(true);
    expect(manifest.diagnostics.some((d) => d.code === 'target-ambiguous' && d.targetName === 'dup')).toBe(true);

    // Identity: requestId is a pure deterministic function of the request (recomputing it independently must match);
    // observationId is fresh-per-call by design (domain/identity.ts), so only its presence/shape is asserted here.
    const { buildRequestIdentity } = await import('../../src/domain/identity.js');
    expect(manifest.requestId).toBe(buildRequestIdentity(request));
    expect(typeof manifest.observationId).toBe('string');
    expect(manifest.observationId.startsWith(manifest.requestId)).toBe(true);
  });

  // B4-TST-019: persisting the artifact never touches the observed fixture/target source.
  it('B4-TST-019: writing the artifact does not modify the fixture target being observed', async () => {
    const cwd = await freshCwd();
    const request: NormalizedObservationRequest = {
      targetUrl: `${fixtures.baseUrl}/observation`,
      viewport: { width: 800, height: 600 },
      targets: [],
      outputLocation: '.',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    };

    const beforeHtml = await fetch(request.targetUrl).then((r) => r.text());

    const { result: capture } = await captureViewportInternal(request);
    if (!capture.ok) throw new Error('expected a successful browser capture');
    const persisted = await persistBrowserCapture(capture, request, { cwd });
    if (!persisted.ok) throw new Error('expected persistence to succeed');

    const afterHtml = await fetch(request.targetUrl).then((r) => r.text());
    expect(afterHtml).toBe(beforeHtml);
  });
});
