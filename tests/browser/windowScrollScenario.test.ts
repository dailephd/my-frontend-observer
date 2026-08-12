import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureViewportInternal } from '../../src/browser/chromiumAdapter.js';
import { persistBrowserCapture } from '../../src/application/observationPersistence.js';
import { buildRequestIdentity } from '../../src/domain/identity.js';
import { isValidObservationArtifact } from '../../src/domain/schema.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import {
  startFixtureServer,
  type FixtureServer,
  SCROLL_FIXTURE_SELECTORS,
  SCROLL_FIXTURE_BELOW_TARGET_INITIAL_TOP,
  SCROLL_FIXTURE_DOCUMENT_SIZE,
} from '../fixtures/server.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

const VIEWPORT = { width: 800, height: 600 };
// scrollHeight/scrollWidth (3000) - clientHeight/clientWidth (viewport) = maximum real scroll distance per axis.
const MAX_SCROLL = SCROLL_FIXTURE_DOCUMENT_SIZE - VIEWPORT.height;

function baseRequest(overrides: Partial<NormalizedObservationRequest> = {}): NormalizedObservationRequest {
  return {
    targetUrl: '', // set per-test once fixtures.baseUrl is known
    viewport: VIEWPORT,
    targets: [],
    outputLocation: 'observations',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
    ...overrides,
  };
}

describe('v0.3 Batch 2: real window-scroll-by execution', () => {
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
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-scroll-scenario-'));
    tempDirs.push(dir);
    return dir;
  }

  it('no scenario: v0.2 behavior is unchanged - no scrollScenarioEvidence, page never scrolls, one lifecycle', async () => {
    const request = baseRequest({ targetUrl: `${fixtures.baseUrl}/scroll` });
    const { result, browserConnected } = await captureViewportInternal(request);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect('scrollScenarioEvidence' in result).toBe(false);
    expect(result.pageEvidence.windowScrollY).toMatchObject({ value: 0 });
    expect(result.pageEvidence.windowScrollX).toMatchObject({ value: 0 });
    // Single Chromium lifecycle: cleanly closed after the one capture, same as every v0.2 request.
    expect(browserConnected).toBe(false);
  });

  it('vertical window scroll: real overflow, viewport transitions, and final-state alignment', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [
        { name: 'above', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.aboveTarget }] },
        { name: 'below', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.belowTarget }] },
        { name: 'noOverflow', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.noOverflowBox }] },
        { name: 'hidden', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.hiddenTarget }] },
      ],
      scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 1000 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    expect(evidence).toBeDefined();
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    // Requested vs. observed window movement (well within bounds - no clamping expected here).
    expect(evidence.initial.window).toEqual({ scrollX: 0, scrollY: 0 });
    expect(evidence.final.window).toEqual({ scrollX: 0, scrollY: 1000 });
    expect(evidence.transition.windowScrollX).toEqual({ before: 0, after: 0, changed: false });
    expect(evidence.transition.windowScrollY).toEqual({ before: 0, after: 1000, changed: true });

    // Actual measured document overflow (3000x3000 body vs. 800x600 viewport), distinct from any CSS declaration.
    expect(evidence.initial.document.rootOverflow.horizontalOverflow).toBe(true);
    expect(evidence.initial.document.rootOverflow.verticalOverflow).toBe(true);
    expect(evidence.final.document.rootOverflow.horizontalOverflow).toBe(true);
    expect(evidence.final.document.rootOverflow.verticalOverflow).toBe(true);

    // below-target starts below the viewport (top=1400 >= 600) and enters it after the scroll (1400-1000=400 < 600).
    const belowInitial = evidence.initial.targets.below?.viewportRelation;
    const belowFinal = evidence.final.targets.below?.viewportRelation;
    expect(belowInitial).toMatchObject({ state: 'available', value: { vertical: 'below', intersectsViewport: false } });
    expect(belowFinal).toMatchObject({ state: 'available', value: { vertical: 'intersecting', intersectsViewport: true } });
    expect(evidence.transition.targets.below?.enteredViewport).toBe(true);
    expect(evidence.transition.targets.below?.leftViewport).toBe(false);

    // above-target starts inside the viewport (top=20) and leaves it after the scroll (20-1000=-980 < 0).
    const aboveInitial = evidence.initial.targets.above?.viewportRelation;
    const aboveFinal = evidence.final.targets.above?.viewportRelation;
    expect(aboveInitial).toMatchObject({ state: 'available', value: { vertical: 'intersecting', intersectsViewport: true } });
    expect(aboveFinal).toMatchObject({ state: 'available', value: { vertical: 'above', intersectsViewport: false } });
    expect(evidence.transition.targets.above?.leftViewport).toBe(true);
    expect(evidence.transition.targets.above?.enteredViewport).toBe(false);

    // Declares overflow: auto but its content fits exactly - no actual dimensional overflow.
    const noOverflowInitial = evidence.initial.targets.noOverflow?.overflow;
    expect(noOverflowInitial).toMatchObject({ state: 'available', value: { horizontalOverflow: false, verticalOverflow: false, overflowX: 'auto', overflowY: 'auto' } });

    // Hidden vs. offscreen: a display:none target's viewportRelation is honestly not-applicable, never a fabricated above/below/intersecting.
    expect(evidence.initial.targets.hidden?.viewportRelation.state).toBe('not-applicable');
    expect(evidence.final.targets.hidden?.viewportRelation.state).toBe('not-applicable');
    expect(result.diagnostics.some((d) => d.code === 'target-hidden' && d.targetName === 'hidden')).toBe(true);

    // Window-only scenario: no configured target's own scroll position competes, so ownership resolves to document.
    expect(evidence.scrollOwner).toMatchObject({ state: 'available', source: 'derived', value: { kind: 'document' } });
    if (evidence.scrollOwner.state !== 'available') throw new Error('expected available scrollOwner');
    expect(evidence.scrollOwner.derivedFrom.length).toBeGreaterThan(0);

    // Final-state alignment / screenshot-sequencing proof: ordinary pageEvidence and targetEvidence are captured
    // after the scroll+stabilization+final-snapshot block (see chromiumAdapter.ts), with no page mutation in
    // between the screenshot() call and these captures - so agreement here proves the screenshot is final-state too.
    expect(result.pageEvidence.windowScrollX).toMatchObject({ value: evidence.final.window.scrollX });
    expect(result.pageEvidence.windowScrollY).toMatchObject({ value: evidence.final.window.scrollY });
    const belowGeometry = result.targetEvidence.below?.geometry;
    expect(belowGeometry).toMatchObject({
      state: 'available',
      value: { y: SCROLL_FIXTURE_BELOW_TARGET_INITIAL_TOP - 1000 },
    });

    expect(isPngSignature(result.screenshot)).toBe(true);
    expect(result.screenshot.length).toBeGreaterThan(0);
  });

  it('horizontal window scroll: real horizontal overflow and window.scrollX movement', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 500, deltaY: 0 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    expect(evidence.initial.document.rootOverflow.horizontalOverflow).toBe(true);
    expect(evidence.initial.window.scrollX).toBe(0);
    expect(evidence.final.window.scrollX).toBe(500);
    expect(evidence.transition.windowScrollX).toEqual({ before: 0, after: 500, changed: true });
    expect(result.pageEvidence.windowScrollX).toMatchObject({ value: 500 });
  });

  it('boundary clamp: a requested delta exceeding the remaining scroll distance clamps naturally without a fake failure', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 20000 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    expect(evidence.final.window.scrollY).toBe(MAX_SCROLL);
    expect(evidence.final.window.scrollY).toBeLessThan(20000);
    expect(evidence.transition.windowScrollY).toEqual({ before: 0, after: MAX_SCROLL, changed: true });
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('no movement at boundary: a request that cannot move further executes successfully with no fake action-failure diagnostic', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: -500 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    expect(evidence.initial.window.scrollY).toBe(0);
    expect(evidence.final.window.scrollY).toBe(0);
    expect(evidence.transition.windowScrollY).toEqual({ before: 0, after: 0, changed: false });
    expect(evidence.transition.windowScrollX).toEqual({ before: 0, after: 0, changed: false });
    expect(evidence.scrollOwner).toMatchObject({ value: { kind: 'none' } });
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('persists a real schema-1.2.0 scenario artifact, and requestId is stable across repeated identical scenario observations', async () => {
    const cwd = await freshCwd();
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'below', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.belowTarget }] }],
      scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 900 } },
    });

    const first = await captureViewportInternal(request);
    expect(first.result.ok).toBe(true);
    if (!first.result.ok) throw new Error('expected ok');
    const persisted = await persistBrowserCapture(first.result, request, { cwd });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw new Error('expected persistence to succeed');

    const manifest = JSON.parse(await readFile(persisted.manifestPath, 'utf8')) as ObservationArtifact;
    expect(manifest.schemaVersion).toBe('1.2.0');
    expect(isValidObservationArtifact(manifest)).toEqual({ valid: true });
    expect(manifest.scrollScenarioEvidence).toBeDefined();
    expect(manifest.scrollScenarioEvidence?.initial.window).toEqual({ scrollX: 0, scrollY: 0 });
    expect(manifest.scrollScenarioEvidence?.final.window).toEqual({ scrollX: 0, scrollY: 900 });
    expect(manifest.scrollScenarioEvidence?.transition.windowScrollY.changed).toBe(true);
    expect(manifest.requestConfig.scrollScenario).toEqual({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 900 } });
    expect(manifest.artifactReferences.find((r) => r.kind === 'screenshot')?.path).toBe('screenshot.png');

    const screenshotBytes = new Uint8Array(await readFile(persisted.screenshotPath));
    expect(isPngSignature(screenshotBytes)).toBe(true);
    expect(screenshotBytes.length).toBeGreaterThan(0);

    // A second, separately-run real observation with the identical configuration.
    const second = await captureViewportInternal(request);
    expect(second.result.ok).toBe(true);
    if (!second.result.ok) throw new Error('expected ok');
    const persistedSecond = await persistBrowserCapture(second.result, request, { cwd });
    expect(persistedSecond.ok).toBe(true);
    if (!persistedSecond.ok) throw new Error('expected persistence to succeed');
    const manifestSecond = JSON.parse(await readFile(persistedSecond.manifestPath, 'utf8')) as ObservationArtifact;

    expect(manifestSecond.requestId).toBe(manifest.requestId);
    expect(manifestSecond.requestId).toBe(buildRequestIdentity(request));
    expect(manifestSecond.observationId).not.toBe(manifest.observationId);
  });
});
