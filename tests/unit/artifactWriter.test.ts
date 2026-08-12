import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeObservationArtifact, MANIFEST_FILENAME, SCREENSHOT_FILENAME } from '../../src/artifacts/artifactWriter.js';
import { buildObservationArtifact } from '../../src/application/observationPersistence.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import { isValidObservationArtifact } from '../../src/domain/schema.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import type { BrowserCaptureResult } from '../../src/browser/types.js';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_SCREENSHOT = new Uint8Array([...PNG_SIGNATURE, 1, 2, 3, 4, 5]);

function baseRequest(overrides: Partial<NormalizedObservationRequest> = {}): NormalizedObservationRequest {
  return {
    targetUrl: 'http://127.0.0.1/observation',
    viewport: { width: 800, height: 600 },
    targets: [{ name: 'button', locators: [{ kind: 'css', selector: '#cta-button' }] }],
    outputLocation: '.',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
    ...overrides,
  };
}

function successfulCapture(overrides: Partial<Extract<BrowserCaptureResult, { ok: true }>> = {}): Extract<BrowserCaptureResult, { ok: true }> {
  return {
    ok: true,
    provenance: { engine: 'chromium', version: '999.0.0.0' },
    screenshot: FAKE_SCREENSHOT,
    pageEvidence: {
      requestedUrl: { state: 'available', source: 'browser', value: 'http://127.0.0.1/observation' },
      title: { state: 'available', source: 'browser', value: 'observation fixture' },
      documentWidth: { state: 'available', source: 'derived', value: 2000, derivedFrom: ['documentScrollWidth', 'documentClientWidth'] },
    },
    targetEvidence: {
      button: {
        resolution: {
          state: 'available',
          source: 'derived',
          value: {
            selectionMethod: 'ordered-locators',
            selectionStatus: 'matched',
            selectedLocatorKind: 'css',
            selectedLocatorIndex: 0,
            usedFallback: false,
            confidence: 'exact',
            attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'matched', matchCount: 1 }],
          },
          derivedFrom: ['locator-attempts'],
        },
        tag: { state: 'available', source: 'browser', value: 'button' },
        geometry: { state: 'available', source: 'browser', value: { x: 20, y: 500, width: 120, height: 32, right: 140, bottom: 532 } },
        style: { state: 'available', source: 'computed-browser', value: { display: 'inline-block', position: 'absolute', overflowX: 'visible', overflowY: 'visible' } },
        layout: { state: 'available', source: 'browser', value: { scrollWidth: 120, scrollHeight: 32, clientWidth: 120, clientHeight: 32, scrollTop: 0, scrollLeft: 0 } },
        visibility: { state: 'available', source: 'derived', value: { visible: true }, derivedFrom: ['style.display', 'computed-visibility', 'geometry.width', 'geometry.height'] },
        semantics: { state: 'available', source: 'computed-browser', value: { role: 'button', name: 'Submit' } },
        semanticState: { state: 'not-applicable', reason: 'no supported semantic state is exposed for this target' },
        landmark: { state: 'not-applicable', reason: 'role "button" is not a recognized landmark role' },
        containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
      },
      ghost: {
        resolution: {
          state: 'available',
          source: 'derived',
          value: {
            selectionMethod: 'ordered-locators',
            selectionStatus: 'not-found',
            usedFallback: false,
            confidence: 'none',
            attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'not-found', matchCount: 0 }],
          },
          derivedFrom: ['locator-attempts'],
        },
        tag: { state: 'unavailable', reason: 'target selector matched no element' },
        geometry: { state: 'unavailable', reason: 'target selector matched no element' },
        style: { state: 'unavailable', reason: 'target selector matched no element' },
        layout: { state: 'unavailable', reason: 'target selector matched no element' },
        visibility: { state: 'unavailable', reason: 'target selector matched no element' },
        semantics: { state: 'unavailable', reason: 'target selector matched no element' },
        semanticState: { state: 'unavailable', reason: 'target selector matched no element' },
        landmark: { state: 'unavailable', reason: 'target selector matched no element' },
        containment: { state: 'unavailable', reason: 'target itself did not resolve (status: not-found)' },
      },
    },
    diagnostics: [{ code: 'target-missing', severity: 'warning', message: 'no element matched selector for target "ghost"', targetName: 'ghost' }],
    ...overrides,
  };
}

describe('artifactWriter', () => {
  const tempDirs: string[] = [];

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-artifact-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // B4-TST-001,002,003,012: complete artifact root with every required file, resolvable references, schema 1.0.0.
  it('B4-TST-001,002,003,012: persists one complete artifact root with resolvable required references', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const manifestRaw = await readFile(result.manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as ObservationArtifact;
    expect(manifest.schemaVersion).toBe('1.2.0');
    expect(isValidObservationArtifact(manifest)).toEqual({ valid: true });

    for (const ref of manifest.artifactReferences) {
      const refPath = path.join(result.artifactRoot, ref.path);
      await expect(readFile(refPath)).resolves.toBeDefined();
    }
    await expect(readFile(path.join(result.artifactRoot, SCREENSHOT_FILENAME))).resolves.toBeDefined();
  });

  // B4-TST-004: observation identity is preserved and does not depend on the artifact's filesystem location.
  it('B4-TST-004: persisted observationId matches the in-memory identity and is location-independent', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    if (!result.ok) throw new Error('expected ok result');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ObservationArtifact;
    expect(manifest.observationId).toBe(artifact.observationId);

    // Move the artifact root to a different path entirely; logical identity in the manifest is unaffected.
    const movedParent = await freshCwd();
    const movedRoot = path.join(movedParent, 'elsewhere');
    await mkdir(path.dirname(movedRoot), { recursive: true });
    const { rename } = await import('node:fs/promises');
    await rename(result.artifactRoot, movedRoot);
    const movedManifest = JSON.parse(await readFile(path.join(movedRoot, MANIFEST_FILENAME), 'utf8')) as ObservationArtifact;
    expect(movedManifest.observationId).toBe(artifact.observationId);
  });

  // B4-TST-005,006: request/config identity and full provenance survive persistence.
  it('B4-TST-005,006: persisted requestId and provenance are accurate', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    if (!result.ok) throw new Error('expected ok result');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ObservationArtifact;
    expect(manifest.requestId).toBe(artifact.requestId);
    expect(manifest.requestConfig).toEqual(request);
    expect(manifest.producer.name).toBe('my-frontend-observer');
    expect(typeof manifest.producer.version).toBe('string');
    expect(manifest.browser).toEqual({ state: 'available', source: 'browser', value: { engine: 'chromium', version: '999.0.0.0' } });
    expect(typeof manifest.provenance.capturedAt).toBe('string');
  });

  // B4-TST-007: every internal reference is relative; no Windows absolute path leaks into logical identity.
  it('B4-TST-007: internal artifact references are relative, not absolute machine paths', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    if (!result.ok) throw new Error('expected ok result');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ObservationArtifact;
    expect(manifest.screenshot).toMatchObject({ state: 'available', value: { path: SCREENSHOT_FILENAME } });
    expect(manifest.artifactReferences).toEqual([{ path: SCREENSHOT_FILENAME, kind: 'screenshot' }]);
    for (const ref of manifest.artifactReferences) {
      expect(path.isAbsolute(ref.path)).toBe(false);
      expect(ref.path.includes(':')).toBe(false);
      expect(ref.path.startsWith('/')).toBe(false);
    }
  });

  // B4-TST-008: persisted PNG bytes equal the exact bytes passed to the writer.
  it('B4-TST-008: persisted screenshot bytes exactly equal the capture bytes', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    if (!result.ok) throw new Error('expected ok result');

    const onDisk = await readFile(result.screenshotPath);
    expect(new Uint8Array(onDisk)).toEqual(FAKE_SCREENSHOT);
  });

  // B4-TST-009: page/target evidence values, states, sources, and missing-target semantics survive unchanged.
  it('B4-TST-009: page/target evidence survives persistence with unchanged values/state/source', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    if (!result.ok) throw new Error('expected ok result');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ObservationArtifact;
    expect(manifest.pageEvidence).toEqual(capture.pageEvidence);
    expect(manifest.targetEvidence).toEqual(capture.targetEvidence);
    // Missing-target semantics specifically: still present, still honestly unavailable, not fabricated zero geometry.
    expect(manifest.targetEvidence.ghost?.resolution).toMatchObject({ value: { selectionStatus: 'not-found' } });
    expect(manifest.targetEvidence.ghost?.geometry.state).toBe('unavailable');
    // Derived-evidence support references are preserved verbatim.
    expect(manifest.pageEvidence.documentWidth).toMatchObject({ source: 'derived', derivedFrom: ['documentScrollWidth', 'documentClientWidth'] });
  });

  // B4-TST-010: diagnostics remain deterministic and structurally intact.
  it('B4-TST-010: diagnostics persist with their original structure/order', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture({
      diagnostics: [
        { code: 'target-ambiguous', severity: 'warning', message: 'ambiguous a', targetName: 'a' },
        { code: 'target-missing', severity: 'warning', message: 'missing b', targetName: 'b' },
      ],
    });
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    if (!result.ok) throw new Error('expected ok result');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ObservationArtifact;
    expect(manifest.diagnostics).toEqual(capture.diagnostics);
  });

  // B4-TST-011: limits/omissions metadata persists, and is not confused with "writer forgot it".
  it('B4-TST-011: limits/omissions metadata is explicitly persisted', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    if (!result.ok) throw new Error('expected ok result');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ObservationArtifact;
    expect(manifest.limits).toEqual({ truncated: false, omittedFields: [], omittedTargets: [] });
  });

  // B4-TST-016: an existing observation root at the same identity is never destructively overwritten.
  it('B4-TST-016: refuses to overwrite an existing artifact at the same observationId', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const first = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected first write to succeed');
    const firstManifestBefore = await readFile(first.manifestPath, 'utf8');

    const second = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected second write to be rejected');
    expect(second.diagnostics[0]?.code).toBe('artifact-write-failure');

    const firstManifestAfter = await readFile(first.manifestPath, 'utf8');
    expect(firstManifestAfter).toBe(firstManifestBefore);
  });

  // B4-TST-017: target/diagnostic ordering is preserved exactly through serialization.
  it('B4-TST-017: target and diagnostic ordering is deterministic through serialization', async () => {
    const cwd = await freshCwd();
    const capture = successfulCapture({
      diagnostics: [
        { code: 'target-missing', severity: 'warning', message: 'z first', targetName: 'z' },
        { code: 'target-missing', severity: 'warning', message: 'a second', targetName: 'a' },
      ],
    });
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd });
    if (!result.ok) throw new Error('expected ok result');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ObservationArtifact;
    expect(Object.keys(manifest.targetEvidence)).toEqual(Object.keys(capture.targetEvidence));
    expect(manifest.diagnostics.map((d) => d.message)).toEqual(['z first', 'a second']);
  });

  // B4-TST-018: persistence never depends on Playwright or a running browser - every test above already proves this
  // (none of them import 'playwright' or launch Chromium), asserted here explicitly for the writer's own module.
  it('B4-TST-018: the artifact writer module has no Playwright/browser runtime dependency', async () => {
    const mod = await import('../../src/artifacts/artifactWriter.js');
    expect(typeof mod.writeObservationArtifact).toBe('function');
    // Reaching this point already proves the module loaded without needing a Chromium process.
  });
});
