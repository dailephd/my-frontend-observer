import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureViewportInternal } from '../../src/browser/chromiumAdapter.js';
import { buildObservationArtifact, persistBrowserCapture } from '../../src/application/observationPersistence.js';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import { compareAndPersist } from '../../src/application/comparisonService.js';
import { isValidComparisonArtifact } from '../../src/domain/comparison.js';
import type { ComparisonArtifact } from '../../src/domain/comparison.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import { startFixtureServer, type FixtureServer, COMPARISON_FIXTURE_SELECTORS } from '../fixtures/server.js';

const VIEWPORT = { width: 800, height: 600 };

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

async function capture(request: NormalizedObservationRequest): Promise<ObservationArtifact> {
  const { result } = await captureViewportInternal(request);
  if (!result.ok) throw new Error(`expected ok capture, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  return buildObservationArtifact(result, request);
}

function requireOk(result: ReturnType<typeof compareObservations>): ComparisonArtifact {
  if (!result.ok) throw new Error(`expected ok comparison, got: ${result.reason}`);
  return result.artifact;
}

describe('v0.4 Batch 3: compareObservations against real ObservationArtifacts', () => {
  let fixtures: FixtureServer;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  afterEach(async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before', scrollVariant: 'no-scroll' });
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-comparison-browser-'));
    tempDirs.push(dir);
    return dir;
  }

  it('an unchanged fixture produces comparable with zero meaningful differences', async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before' });
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/comparison`,
      targets: [
        { name: 'moved', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.moved }] },
        { name: 'overlapA', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.overlapA }] },
        { name: 'overlapB', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.overlapB }] },
      ],
    });
    const before = await capture(request);
    const after = await capture(request);
    expect(before.observationId).not.toBe(after.observationId);

    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.comparability.state).toBe('comparable');
    expect(artifact.differences).toEqual([]);
    expect(artifact.relationshipChanges).toEqual([]);
    expect(artifact.configurationChanges).toEqual([]);
  });

  it('a real moved and resized target produces correct differences', async () => {
    const request = (variant: 'before' | 'after') => {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return baseRequest({
        targetUrl: `${fixtures.baseUrl}/comparison`,
        targets: [{ name: 'moved', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.moved }] }],
      });
    };
    const before = await capture(request('before'));
    const after = await capture(request('after'));

    const artifact = requireOk(compareObservations(before, after));
    const moved = artifact.differences.find((d) => d.kind === 'moved');
    const resized = artifact.differences.find((d) => d.kind === 'resized');
    expect(moved).toMatchObject({ before: { x: 100, y: 0 }, after: { x: 140, y: 0 } });
    expect(resized).toMatchObject({ before: { width: 80, height: 40 }, after: { width: 140, height: 60 } });
  });

  it('real appearance and disappearance', async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before' });
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/comparison`,
      targets: [
        { name: 'appear', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.appear }] },
        { name: 'disappear', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.disappear }] },
      ],
    });
    const before = await capture(request);
    fixtures.setComparisonFixtureState({ layoutVariant: 'after' });
    const after = await capture(request);

    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.find((d) => d.subject.type === 'target' && d.subject.target === 'appear')).toMatchObject({ kind: 'appeared' });
    expect(artifact.differences.find((d) => d.subject.type === 'target' && d.subject.target === 'disappear')).toMatchObject({ kind: 'disappeared' });
  });

  it('a configuration-only target change never fabricates appeared/disappeared', async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before' });
    const before = await capture(
      baseRequest({
        targetUrl: `${fixtures.baseUrl}/comparison`,
        targets: [{ name: 'moved', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.moved }] }],
      }),
    );
    const after = await capture(
      baseRequest({
        targetUrl: `${fixtures.baseUrl}/comparison`,
        targets: [
          { name: 'moved', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.moved }] },
          { name: 'overlapA', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.overlapA }] },
        ],
      }),
    );

    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.some((d) => d.kind === 'appeared' || d.kind === 'disappeared')).toBe(false);
    expect(artifact.configurationChanges).toEqual([{ kind: 'added', target: 'overlapA' }]);
  });

  it('a real overlap transition produces overlaps + relative-position-changed', async () => {
    const request = (variant: 'before' | 'after') => {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return baseRequest({
        targetUrl: `${fixtures.baseUrl}/comparison`,
        targets: [
          { name: 'overlapA', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.overlapA }] },
          { name: 'overlapB', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.overlapB }] },
        ],
      });
    };
    const before = await capture(request('before'));
    const after = await capture(request('after'));

    const artifact = requireOk(compareObservations(before, after));
    const overlapChange = artifact.relationshipChanges.find((c) => c.kind === 'overlaps' || c.kind === 'does-not-overlap');
    expect(overlapChange).toMatchObject({ before: 'does-not-overlap', after: 'overlaps' });
    expect(artifact.differences.some((d) => d.kind === 'relative-position-changed')).toBe(true);
  });

  it('a real geometric-fit transition produces relationship-changed while remaining DOM-contained', async () => {
    const request = (variant: 'before' | 'after') => {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return baseRequest({
        targetUrl: `${fixtures.baseUrl}/comparison`,
        targets: [
          { name: 'fitChild', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.fitChild }] },
          { name: 'fitContainer', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.fitContainer }] },
        ],
      });
    };
    const before = await capture(request('before'));
    const after = await capture(request('after'));

    expect(before.targetEvidence.fitChild?.containment).toMatchObject({ value: { containedByTargetIds: ['fitContainer'] } });
    expect(after.targetEvidence.fitChild?.containment).toMatchObject({ value: { containedByTargetIds: ['fitContainer'] } });

    const artifact = requireOk(compareObservations(before, after));
    const fitChange = artifact.relationshipChanges.find((c) => c.kind === 'fits-inside' || c.kind === 'does-not-fit-inside');
    expect(fitChange).toMatchObject({ before: 'fits-inside', after: 'does-not-fit-inside' });
    expect(artifact.differences.some((d) => d.kind === 'containment-changed')).toBe(false);
  });

  it('a real page horizontal-overflow transition produces a page relationship change', async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before' });
    const before = await capture(baseRequest({ targetUrl: `${fixtures.baseUrl}/comparison` }));
    fixtures.setComparisonFixtureState({ layoutVariant: 'after' });
    const after = await capture(baseRequest({ targetUrl: `${fixtures.baseUrl}/comparison` }));

    const artifact = requireOk(compareObservations(before, after));
    const pageChange = artifact.relationshipChanges.find((c) => c.scope === 'page');
    expect(pageChange).toMatchObject({ before: 'document-width-fits-viewport', after: 'document-width-exceeds-viewport' });
  });

  it('a real clipping transition is detected via the canonical clipping helper', async () => {
    const request = (variant: 'before' | 'after') => {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return baseRequest({
        targetUrl: `${fixtures.baseUrl}/comparison`,
        targets: [{ name: 'clipTarget', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.clipTarget }] }],
      });
    };
    const before = await capture(request('before'));
    const after = await capture(request('after'));

    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.find((d) => d.kind === 'clipping-changed')).toMatchObject({ before: 'not-clipped', after: 'clipped' });
  });

  it('a real scroll-owner transition (none -> document) with matching scenario configuration', async () => {
    const scenario = { action: { kind: 'window-scroll-by' as const, deltaX: 0, deltaY: 500 } };
    fixtures.setComparisonFixtureState({ layoutVariant: 'before', scrollVariant: 'no-scroll' });
    const before = await capture(baseRequest({ targetUrl: `${fixtures.baseUrl}/comparison`, scrollScenario: scenario }));
    fixtures.setComparisonFixtureState({ layoutVariant: 'before', scrollVariant: 'scrollable' });
    const after = await capture(baseRequest({ targetUrl: `${fixtures.baseUrl}/comparison`, scrollScenario: scenario }));

    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.comparability.state).not.toBe('incomparable');
    expect(artifact.differences.find((d) => d.kind === 'scroll-owner-changed')).toMatchObject({
      before: { kind: 'none' },
      after: { kind: 'document' },
    });
  });

  it('persists a real comparison and leaves both source observations byte-identical on disk', async () => {
    const cwd = await freshCwd();
    fixtures.setComparisonFixtureState({ layoutVariant: 'before' });
    const request = baseRequest({
      targetUrl: `${fixtures.baseUrl}/comparison`,
      targets: [{ name: 'moved', locators: [{ kind: 'css', selector: COMPARISON_FIXTURE_SELECTORS.moved }] }],
    });
    const { result: beforeCapture } = await captureViewportInternal(request);
    if (!beforeCapture.ok) throw new Error('expected ok capture');
    const beforePersisted = await persistBrowserCapture(beforeCapture, request, { cwd });
    if (!beforePersisted.ok) throw new Error('expected ok persistence');

    fixtures.setComparisonFixtureState({ layoutVariant: 'after' });
    const { result: afterCapture } = await captureViewportInternal(request);
    if (!afterCapture.ok) throw new Error('expected ok capture');
    const afterPersisted = await persistBrowserCapture(afterCapture, request, { cwd });
    if (!afterPersisted.ok) throw new Error('expected ok persistence');

    const beforeManifestBytes = await readFile(beforePersisted.manifestPath, 'utf8');
    const afterManifestBytes = await readFile(afterPersisted.manifestPath, 'utf8');
    const beforeArtifact = JSON.parse(beforeManifestBytes) as ObservationArtifact;
    const afterArtifact = JSON.parse(afterManifestBytes) as ObservationArtifact;

    const comparisonResult = await compareAndPersist(beforeArtifact, afterArtifact, { cwd });
    expect(comparisonResult.ok).toBe(true);
    if (!comparisonResult.ok) throw new Error('expected ok comparison result');

    const manifest = JSON.parse(await readFile(comparisonResult.manifestPath, 'utf8')) as ComparisonArtifact;
    expect(isValidComparisonArtifact(manifest)).toEqual({ valid: true });
    expect(manifest.before.observationId).toBe(beforeArtifact.observationId);
    expect(manifest.after.observationId).toBe(afterArtifact.observationId);
    expect(manifest.before.screenshot.path).toBe('screenshot.png');
    expect(manifest.after.screenshot.path).toBe('screenshot.png');

    // Source observations remain byte-identical after the comparison ran.
    expect(await readFile(beforePersisted.manifestPath, 'utf8')).toBe(beforeManifestBytes);
    expect(await readFile(afterPersisted.manifestPath, 'utf8')).toBe(afterManifestBytes);

    // No screenshot bytes were copied into the comparison directory.
    const { readdir } = await import('node:fs/promises');
    const comparisonEntries = await readdir(path.dirname(comparisonResult.manifestPath));
    expect(comparisonEntries).toEqual(['manifest.json']);
  });
});
