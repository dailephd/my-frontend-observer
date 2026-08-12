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
  SCROLL_FIXTURE_NESTED_V_CONTAINER,
  SCROLL_FIXTURE_NESTED_V_CONTENT_HEIGHT,
} from '../fixtures/server.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

const VIEWPORT = { width: 800, height: 600 };
const MAX_NESTED_V_SCROLL = SCROLL_FIXTURE_NESTED_V_CONTENT_HEIGHT - SCROLL_FIXTURE_NESTED_V_CONTAINER.height;

function baseRequest(overrides: Partial<NormalizedObservationRequest> = {}): NormalizedObservationRequest {
  return {
    targetUrl: '',
    viewport: VIEWPORT,
    targets: [],
    outputLocation: 'observations',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
    ...overrides,
  };
}

describe('v0.3 Batch 3: real target-scroll-by execution (nested/element scrolling)', () => {
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
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-target-scroll-scenario-'));
    tempDirs.push(dir);
    return dir;
  }

  it('vertical nested scroll: container.scrollTop changes, window.scrollY unchanged, owner=target, and a below-viewport child enters the viewport', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [
        { name: 'container', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.nestedVerticalContainer }] },
        { name: 'child', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.nestedVerticalChild }] },
      ],
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'container', deltaX: 0, deltaY: 500 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    expect(evidence.initial.targets.container?.metrics).toMatchObject({ state: 'available', value: { scrollTop: 0 } });
    expect(evidence.final.targets.container?.metrics).toMatchObject({ state: 'available', value: { scrollTop: 500 } });
    expect(evidence.initial.window.scrollY).toBe(0);
    expect(evidence.final.window.scrollY).toBe(0);
    expect(evidence.transition.windowScrollY).toEqual({ before: 0, after: 0, changed: false });
    expect(evidence.transition.targets.container?.scrollTop).toEqual({ before: 0, after: 500, changed: true });

    // Actual measured overflow, not inferred from the container's own overflow:auto declaration.
    expect(evidence.initial.targets.container?.overflow).toMatchObject({ value: { verticalOverflow: true } });

    // The nested child starts below the browser viewport (container top=20, child content-offset=600 -> y≈620)
    // and enters it once the container scrolls far enough (y≈120 after scrollTop=500).
    expect(evidence.initial.targets.child?.viewportRelation).toMatchObject({ value: { vertical: 'below', intersectsViewport: false } });
    expect(evidence.final.targets.child?.viewportRelation).toMatchObject({ value: { intersectsViewport: true } });
    expect(evidence.transition.targets.child?.enteredViewport).toBe(true);

    // Target-owner provenance.
    expect(evidence.scrollOwner).toMatchObject({ state: 'available', source: 'derived', value: { kind: 'target', target: 'container' } });
    if (evidence.scrollOwner.state !== 'available') throw new Error('expected available scrollOwner');
    expect(evidence.scrollOwner.derivedFrom.length).toBeGreaterThan(0);
    expect(evidence.scrollOwner.derivedFrom.every((f) => f.startsWith('container.'))).toBe(true);

    // Final ordinary evidence agrees with the final scenario state.
    expect(result.pageEvidence.windowScrollY).toMatchObject({ value: 0 });
    expect(isPngSignature(result.screenshot)).toBe(true);
  });

  it('horizontal nested scroll: container.scrollLeft changes, actual horizontal overflow is true, owner=target', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'hcontainer', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.nestedHorizontalContainer }] }],
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'hcontainer', deltaX: 300, deltaY: 0 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    expect(evidence.initial.targets.hcontainer?.metrics).toMatchObject({ value: { scrollLeft: 0 } });
    expect(evidence.final.targets.hcontainer?.metrics).toMatchObject({ value: { scrollLeft: 300 } });
    expect(evidence.initial.targets.hcontainer?.overflow).toMatchObject({ value: { horizontalOverflow: true } });
    expect(evidence.scrollOwner).toMatchObject({ value: { kind: 'target', target: 'hcontainer' } });
  });

  it('nested boundary clamp: a requested target scroll exceeding the remaining range clamps naturally without a fake failure', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'container', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.nestedVerticalContainer }] }],
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'container', deltaX: 0, deltaY: 20000 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    expect(evidence.final.targets.container?.metrics).toMatchObject({ value: { scrollTop: MAX_NESTED_V_SCROLL } });
    expect(evidence.final.targets.container?.metrics).not.toMatchObject({ value: { scrollTop: 20000 } });
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('non-scrollable target: the action executes with no position change and owner=none', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'box', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.noOverflowBox }] }],
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'box', deltaX: 0, deltaY: 100 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    expect(evidence.initial.targets.box?.overflow).toMatchObject({ value: { verticalOverflow: false } });
    expect(evidence.initial.targets.box?.metrics).toMatchObject({ value: { scrollTop: 0 } });
    expect(evidence.final.targets.box?.metrics).toMatchObject({ value: { scrollTop: 0 } });
    expect(evidence.transition.targets.box?.scrollTop.changed).toBe(false);
    expect(evidence.scrollOwner).toMatchObject({ value: { kind: 'none' } });
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('real-Chromium geometry-not-owner regression: a window-scroll-by with a nested target configured still derives owner=document, not target', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'container', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.nestedVerticalContainer }] }],
      scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 1000 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');

    // The container's own scrollTop never changes - only its viewport-relative bounding
    // rectangle, because the document itself scrolled underneath it.
    expect(evidence.transition.targets.container?.scrollTop.changed).toBe(false);
    expect(evidence.transition.targets.container?.boundingRectPosition.changed).toBe(true);
    expect(evidence.scrollOwner).toMatchObject({ value: { kind: 'document' } });
  });

  it('unresolved action target (not-found): the target scroll cannot execute, no movement is fabricated, and the existing target-missing diagnostic surfaces', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'ghost', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.missingScrollTarget }] }],
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'ghost', deltaX: 0, deltaY: 100 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.diagnostics.some((d) => d.code === 'target-missing' && d.targetName === 'ghost')).toBe(true);
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');
    expect(evidence.initial.targets.ghost?.metrics.state).toBe('unavailable');
    expect(evidence.final.targets.ghost?.metrics.state).toBe('unavailable');
    expect(evidence.transition.targets.ghost).toBeUndefined();
    expect(evidence.scrollOwner).toMatchObject({ value: { kind: 'none' } });
    expect(result.targetEvidence.ghost?.resolution).toMatchObject({ value: { selectionStatus: 'not-found' } });
  });

  it('ambiguous action target: the target scroll cannot execute and never picks an arbitrary match', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'dup', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.duplicateScrollTarget }] }],
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'dup', deltaX: 0, deltaY: 100 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.diagnostics.some((d) => d.code === 'target-ambiguous' && d.targetName === 'dup')).toBe(true);
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');
    expect(evidence.scrollOwner).toMatchObject({ value: { kind: 'none' } });
    expect(result.targetEvidence.dup?.resolution).toMatchObject({ value: { selectionStatus: 'ambiguous' } });
  });

  it('hidden action target: uniquely resolves, target-hidden warning still fires, and the (non-rendered) scroll attempt produces no movement', async () => {
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'hidden', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.hiddenTarget }] }],
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'hidden', deltaX: 0, deltaY: 100 } },
    });

    const { result } = await captureViewportInternal(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.diagnostics.some((d) => d.code === 'target-hidden' && d.targetName === 'hidden')).toBe(true);
    const evidence = result.scrollScenarioEvidence;
    if (!evidence) throw new Error('expected scrollScenarioEvidence');
    expect(evidence.initial.targets.hidden?.viewportRelation.state).toBe('not-applicable');
    expect(evidence.final.targets.hidden?.viewportRelation.state).toBe('not-applicable');
    // A hidden target's viewportRelation is always not-applicable, so it never has both
    // sides of usable evidence and is honestly omitted from transition.targets (never a
    // fabricated "unchanged" record) - see deriveTargetScrollTransition.
    expect(evidence.transition.targets.hidden).toBeUndefined();
    expect(evidence.initial.targets.hidden?.metrics).toMatchObject({ value: { scrollTop: 0 } });
    expect(evidence.final.targets.hidden?.metrics).toMatchObject({ value: { scrollTop: 0 } });
    expect(evidence.scrollOwner).toMatchObject({ value: { kind: 'none' } });
  });

  it('persists a real schema-1.2.0 target-scroll artifact, and requestId is stable across repeated identical scenario observations', async () => {
    const cwd = await freshCwd();
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/scroll`,
      targets: [{ name: 'container', locators: [{ kind: 'css', selector: SCROLL_FIXTURE_SELECTORS.nestedVerticalContainer }] }],
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'container', deltaX: 0, deltaY: 400 } },
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
    expect(manifest.requestConfig.scrollScenario).toEqual({ action: { kind: 'target-scroll-by', target: 'container', deltaX: 0, deltaY: 400 } });
    expect(manifest.scrollScenarioEvidence?.initial.targets.container).toMatchObject({ metrics: { value: { scrollTop: 0 } } });
    expect(manifest.scrollScenarioEvidence?.final.targets.container).toMatchObject({ metrics: { value: { scrollTop: 400 } } });
    expect(manifest.scrollScenarioEvidence?.transition.targets.container?.scrollTop.changed).toBe(true);
    expect(manifest.scrollScenarioEvidence?.scrollOwner).toMatchObject({ state: 'available', source: 'derived', value: { kind: 'target', target: 'container' } });
    const scrollOwner = manifest.scrollScenarioEvidence?.scrollOwner;
    if (!scrollOwner || scrollOwner.state !== 'available') throw new Error('expected available scrollOwner');
    expect(scrollOwner.derivedFrom.length).toBeGreaterThan(0);
    expect(manifest.pageEvidence.windowScrollY).toMatchObject({ value: 0 });
    expect(manifest.targetEvidence.container).toBeDefined();

    const screenshotBytes = new Uint8Array(await readFile(persisted.screenshotPath));
    expect(isPngSignature(screenshotBytes)).toBe(true);
    expect(screenshotBytes.length).toBeGreaterThan(0);

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
