import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { captureViewportInternal } from '../../src/browser/chromiumAdapter.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import type { TargetEvidenceRecord, TargetGeometry, TargetLandmarkRole } from '../../src/domain/schema.js';
import { startDemoServer, DEMO_STATES, DEMO_CANONICAL_VIEWPORT } from '../../examples/v09-demo/scripts/server.mjs';

const appRoot = path.resolve(__dirname, '../../examples/v09-demo/app');

/** The frozen stable-target vocabulary the demo promises to every consumer. */
const DEMO_TARGETS = [
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
] as const;
type DemoTarget = (typeof DEMO_TARGETS)[number];

interface Started {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

type StateEvidence = Record<DemoTarget, TargetEvidenceRecord>;

function request(targetUrl: string): NormalizedObservationRequest {
  return {
    targetUrl,
    viewport: DEMO_CANONICAL_VIEWPORT,
    targets: DEMO_TARGETS.map((name) => ({ name, locators: [{ kind: 'css', selector: `[data-demo-target="${name}"]` }] })),
    outputLocation: 'observations',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
  };
}

function geometryOf(evidence: StateEvidence, target: DemoTarget): TargetGeometry {
  const record = evidence[target];
  expect(record.resolution.state, `${target} resolution evidence`).toBe('available');
  if (record.resolution.state !== 'available') throw new Error('unreachable');
  expect(record.resolution.value.selectionStatus, `${target} selection status`).toBe('matched');
  expect(record.geometry.state, `${target} geometry evidence`).toBe('available');
  if (record.geometry.state !== 'available') throw new Error('unreachable');
  return record.geometry.value;
}

function landmarkOf(evidence: StateEvidence, target: DemoTarget): TargetLandmarkRole | undefined {
  const record = evidence[target];
  return record.landmark.state === 'available' ? record.landmark.value : undefined;
}

/**
 * v0.9 demo foundation: real Chromium proof that the demo's frozen state
 * vocabulary actually produces the geometry differences later tutorials
 * describe. Every measurement below comes from the repository's one canonical
 * observation path (`captureViewportInternal`), not from a second screenshot
 * or measurement engine, and every number is real browser geometry rather
 * than a value read back out of the stylesheet.
 */
describe('v0.9 demo - real-Chromium geometry at the canonical tutorial viewport', () => {
  let server: Started;
  const captured = new Map<string, StateEvidence>();

  beforeAll(async () => {
    server = (await startDemoServer({ port: 0, appRoot })) as Started;
    for (const state of DEMO_STATES) {
      const { result } = await captureViewportInternal(request(`${server.baseUrl}/?state=${state}`));
      if (!result.ok) throw new Error(`capture of state ${state} failed: ${JSON.stringify(result.diagnostics)}`);
      captured.set(state, result.targetEvidence as StateEvidence);
    }
  }, 300_000);

  afterAll(async () => {
    await server.close();
  });

  function evidence(state: string): StateEvidence {
    const found = captured.get(state);
    if (found === undefined) throw new Error(`state ${state} was not captured`);
    return found;
  }

  it('captures every required demo target in the baseline state', () => {
    const baseline = evidence('baseline');
    for (const target of DEMO_TARGETS) {
      const geometry = geometryOf(baseline, target);
      expect(geometry.width, `${target} width`).toBeGreaterThan(0);
      expect(geometry.height, `${target} height`).toBeGreaterThan(0);
    }
  });

  it('renders the baseline at exactly the canonical viewport with no scrollable overflow', () => {
    const baseline = evidence('baseline');
    const header = geometryOf(baseline, 'header');
    const footer = geometryOf(baseline, 'footer');
    expect(header.x).toBe(0);
    expect(header.y).toBe(0);
    expect(header.width).toBe(DEMO_CANONICAL_VIEWPORT.width);
    expect(footer.width).toBe(DEMO_CANONICAL_VIEWPORT.width);
    expect(footer.bottom).toBe(DEMO_CANONICAL_VIEWPORT.height);
  });

  it('move-hero increases the hero x without resizing it, and changes nothing else', () => {
    const baseline = evidence('baseline');
    const moved = evidence('move-hero');
    const before = geometryOf(baseline, 'hero');
    const after = geometryOf(moved, 'hero');

    expect(after.x).toBeGreaterThan(before.x);
    expect(after.x - before.x).toBe(160);
    expect(after.width).toBe(before.width);
    expect(after.y).toBe(before.y);
    expect(after.height).toBe(before.height);

    for (const target of DEMO_TARGETS.filter((name) => name !== 'hero')) {
      expect(geometryOf(moved, target), `${target} must be unchanged by move-hero`).toEqual(geometryOf(baseline, target));
    }
  });

  it('wider-sidebar increases the sidebar width, and moves the footer and header not at all', () => {
    const baseline = evidence('baseline');
    const wider = evidence('wider-sidebar');
    const before = geometryOf(baseline, 'sidebar');
    const after = geometryOf(wider, 'sidebar');

    expect(after.width).toBeGreaterThan(before.width);
    expect(after.width - before.width).toBe(140);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.height).toBe(before.height);

    expect(geometryOf(wider, 'header')).toEqual(geometryOf(baseline, 'header'));
    expect(geometryOf(wider, 'footer')).toEqual(geometryOf(baseline, 'footer'));
  });

  it('changed-spacing widens the measured gap between the sidebar and the content region', () => {
    const baseline = evidence('baseline');
    const spaced = evidence('changed-spacing');

    const gapBefore = geometryOf(baseline, 'content').x - geometryOf(baseline, 'sidebar').right;
    const gapAfter = geometryOf(spaced, 'content').x - geometryOf(spaced, 'sidebar').right;

    expect(gapBefore).toBe(24);
    expect(gapAfter).toBe(96);
    expect(gapAfter).toBeGreaterThan(gapBefore);

    // A relationship changed, not either region's own size, and nothing moved vertically.
    expect(geometryOf(spaced, 'sidebar').width).toBe(geometryOf(baseline, 'sidebar').width);
    for (const target of DEMO_TARGETS) {
      expect(geometryOf(spaced, target).y, `${target} y must be unchanged by changed-spacing`).toBe(geometryOf(baseline, target).y);
    }
  });

  it('move-footer moves the footer vertically and leaves every other region where it was', () => {
    const baseline = evidence('baseline');
    const moved = evidence('move-footer');
    const before = geometryOf(baseline, 'footer');
    const after = geometryOf(moved, 'footer');

    expect(after.y).not.toBe(before.y);
    expect(before.y - after.y).toBe(64);
    expect(after.x).toBe(before.x);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);

    for (const target of DEMO_TARGETS.filter((name) => name !== 'footer')) {
      expect(geometryOf(moved, target), `${target} must be unchanged by move-footer`).toEqual(geometryOf(baseline, target));
    }
  });

  it('removed-card genuinely removes card-2 from the document while card-1 stays put', () => {
    const baseline = evidence('baseline');
    const removed = evidence('removed-card');

    const record = removed['card-2'];
    expect(record.resolution.state).toBe('available');
    if (record.resolution.state !== 'available') throw new Error('unreachable');
    expect(record.resolution.value.selectionStatus).toBe('not-found');
    // Absent evidence stays absent: no fabricated geometry for a region that is not there.
    expect(record.geometry.state).not.toBe('available');

    expect(geometryOf(removed, 'card-1')).toEqual(geometryOf(baseline, 'card-1'));
    for (const target of DEMO_TARGETS.filter((name) => name !== 'card-2')) {
      expect(geometryOf(removed, target), `${target} must be unchanged by removed-card`).toEqual(geometryOf(baseline, target));
    }
  });

  it('changed-asset keeps the asset container geometry stable', () => {
    const baseline = evidence('baseline');
    const changed = evidence('changed-asset');
    expect(geometryOf(changed, 'asset')).toEqual(geometryOf(baseline, 'asset'));
    for (const target of DEMO_TARGETS) {
      expect(geometryOf(changed, target), `${target} must be geometrically unchanged by changed-asset`).toEqual(
        geometryOf(baseline, target),
      );
    }
  });

  it('multi-change applies several differences at once', () => {
    const baseline = evidence('baseline');
    const multi = evidence('multi-change');

    expect(geometryOf(multi, 'hero').x).toBeGreaterThan(geometryOf(baseline, 'hero').x);
    expect(geometryOf(multi, 'sidebar').width).toBeGreaterThan(geometryOf(baseline, 'sidebar').width);
    expect(geometryOf(multi, 'footer').y).toBeLessThan(geometryOf(baseline, 'footer').y);

    const removedCard = multi['card-2'];
    expect(removedCard.resolution.state).toBe('available');
    if (removedCard.resolution.state !== 'available') throw new Error('unreachable');
    expect(removedCard.resolution.value.selectionStatus).toBe('not-found');
  });

  it('reference presents the intended controlled design differences from baseline', () => {
    const baseline = evidence('baseline');
    const reference = evidence('reference');

    // Region geometry differs.
    expect(geometryOf(reference, 'sidebar').width).toBeGreaterThan(geometryOf(baseline, 'sidebar').width);
    expect(geometryOf(reference, 'hero').x).toBeGreaterThan(geometryOf(baseline, 'hero').x);

    // A measured relationship differs.
    const gapBefore = geometryOf(baseline, 'content').x - geometryOf(baseline, 'sidebar').right;
    const gapAfter = geometryOf(reference, 'content').x - geometryOf(reference, 'sidebar').right;
    expect(gapAfter).toBeGreaterThan(gapBefore);

    // The overall page frame is unchanged, so the reference stays comparable.
    expect(geometryOf(reference, 'header')).toEqual(geometryOf(baseline, 'header'));
    expect(geometryOf(reference, 'footer')).toEqual(geometryOf(baseline, 'footer'));

    // Every region is still present: the reference is a desired design, not a removal.
    for (const target of DEMO_TARGETS) {
      expect(geometryOf(reference, target).width, `${target} present in reference`).toBeGreaterThan(0);
    }
  });

  it('keeps every stable demo target present, unique and matched in every state except the intentionally removed card', () => {
    for (const state of DEMO_STATES) {
      const stateEvidence = evidence(state);
      const expectAbsent = state === 'removed-card' || state === 'multi-change';
      for (const target of DEMO_TARGETS) {
        const record = stateEvidence[target];
        expect(record, `${state}/${target} evidence record`).toBeDefined();
        expect(record.resolution.state, `${state}/${target} resolution`).toBe('available');
        if (record.resolution.state !== 'available') throw new Error('unreachable');
        const expected = expectAbsent && target === 'card-2' ? 'not-found' : 'matched';
        // 'ambiguous' would mean the selector matched more than one element:
        // the vocabulary must stay unique in every state.
        expect(record.resolution.value.selectionStatus, `${state}/${target} selection status`).toBe(expected);
      }
    }
  });

  it('exposes the major structural regions as real landmarks, in every state', () => {
    const expectedLandmarks: Partial<Record<DemoTarget, TargetLandmarkRole>> = {
      header: 'banner',
      navigation: 'navigation',
      sidebar: 'complementary',
      content: 'main',
      footer: 'contentinfo',
    };
    for (const state of DEMO_STATES) {
      const stateEvidence = evidence(state);
      for (const [target, role] of Object.entries(expectedLandmarks) as [DemoTarget, TargetLandmarkRole][]) {
        expect(landmarkOf(stateEvidence, target), `${state}/${target} landmark role`).toBe(role);
      }
    }
  });
});

/**
 * DOM-level facts the canonical observation evidence deliberately does not
 * carry (attribute values, test ids). Uses one real Chromium page rather than
 * a parsed copy of the tracked source, so what is asserted is what a browser
 * actually rendered.
 */
describe('v0.9 demo - real-Chromium DOM identity and offline rendering', () => {
  let server: Started;
  let browser: Browser;
  let page: Page;
  const requestedOrigins = new Set<string>();

  beforeAll(async () => {
    server = (await startDemoServer({ port: 0, appRoot })) as Started;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: DEMO_CANONICAL_VIEWPORT });
    page = await context.newPage();
    page.on('request', (req) => requestedOrigins.add(new URL(req.url()).origin));
  }, 120_000);

  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  it('swaps only the asset source in changed-asset, and keeps the primary asset elsewhere', async () => {
    const sourceFor = async (state: string) => {
      await page.goto(`${server.baseUrl}/?state=${state}`, { waitUntil: 'load' });
      return page.getAttribute('[data-testid="demo-asset-image"]', 'src');
    };

    const baseline = await sourceFor('baseline');
    const changed = await sourceFor('changed-asset');
    expect(baseline).toBe('assets/asset-primary.svg');
    expect(changed).toBe('assets/asset-alternate.svg');
    expect(changed).not.toBe(baseline);

    expect(await sourceFor('move-hero')).toBe(baseline);
    expect(await sourceFor('reference')).toBe('assets/asset-alternate.svg');
  });

  it('keeps every tutorial-critical test id present and unique in every state', async () => {
    for (const state of DEMO_STATES) {
      await page.goto(`${server.baseUrl}/?state=${state}`, { waitUntil: 'load' });
      for (const testId of ['demo-state-badge', 'demo-cta-button', 'demo-asset-image', `demo-nav-${state}`]) {
        expect(await page.locator(`[data-testid="${testId}"]`).count(), `${state}/${testId}`).toBe(1);
      }
      expect(await page.textContent('[data-testid="demo-state-badge"]'), `${state} badge`).toBe(state);
      expect(await page.getAttribute(`[data-testid="demo-nav-${state}"]`, 'aria-current'), `${state} nav current`).toBe('page');
    }
  });

  it('renders the invalid-state page for an unknown state without rendering the application', async () => {
    const response = await page.goto(`${server.baseUrl}/?state=definitely-not-a-state`, { waitUntil: 'load' });
    expect(response?.status()).toBe(400);
    expect(await page.locator('[data-testid="demo-invalid-state"]').count()).toBe(1);
    expect(await page.locator('[data-demo-target]').count()).toBe(0);
  });

  it('requires no remote origin to render any state', async () => {
    for (const state of DEMO_STATES) {
      await page.goto(`${server.baseUrl}/?state=${state}`, { waitUntil: 'load' });
    }
    expect([...requestedOrigins]).toEqual([server.baseUrl]);
  });

  it('never needs a scrollbar, so the layout width is the viewport width in every state', async () => {
    for (const state of DEMO_STATES) {
      await page.goto(`${server.baseUrl}/?state=${state}`, { waitUntil: 'load' });
      const metrics = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      expect(metrics, `${state} layout metrics`).toEqual({
        innerWidth: DEMO_CANONICAL_VIEWPORT.width,
        scrollWidth: DEMO_CANONICAL_VIEWPORT.width,
        scrollHeight: DEMO_CANONICAL_VIEWPORT.height,
      });
    }
  });
});
