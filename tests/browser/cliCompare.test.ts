import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { runCli } from '../../src/cli.js';
import { isValidComparisonArtifact } from '../../src/domain/comparison.js';
import type { ComparisonArtifact } from '../../src/domain/comparison.js';
import { startFixtureServer, type FixtureServer, COMPARISON_FIXTURE_SELECTORS } from '../fixtures/server.js';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

describe('runCli compare - real end-to-end public workflow (Batch 4)', () => {
  let fixtures: FixtureServer;
  const outputLocations: string[] = [];

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  afterEach(async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before', scrollVariant: 'no-scroll' });
    await Promise.all(outputLocations.splice(0).map((loc) => rm(path.resolve(process.cwd(), loc), { recursive: true, force: true })));
  });

  function freshOutputLocation(prefix: string): string {
    const loc = `${prefix}/mfo-cli-compare-test-${randomUUID()}`;
    outputLocations.push(loc);
    return loc;
  }

  async function observeOnce(args: readonly string[]): Promise<string> {
    const out = capture();
    const code = await runCli(['observe', ...args], out.io);
    if (code !== 0) throw new Error(`expected observe to succeed: ${out.stderr()}`);
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactLine?.slice('Artifact: '.length);
    if (!artifactRoot) throw new Error('expected an Artifact: line in observe output');
    return artifactRoot;
  }

  async function compareOnce(beforeRoot: string, afterRoot: string, extra: readonly string[] = []): Promise<{ code: number; out: ReturnType<typeof capture> }> {
    const out = capture();
    const outputLocation = freshOutputLocation('comparisons');
    const code = await runCli(['compare', '--before', beforeRoot, '--after', afterRoot, '--output', outputLocation, ...extra], out.io);
    return { code, out };
  }

  async function readManifest(out: ReturnType<typeof capture>): Promise<ComparisonArtifact> {
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactLine?.slice('Artifact: '.length);
    if (!artifactRoot) throw new Error('expected an Artifact: line in compare output');
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as ComparisonArtifact;
    expect(isValidComparisonArtifact(manifest)).toEqual({ valid: true });
    return manifest;
  }

  it('an unchanged fixture produces comparable with zero meaningful differences through the public CLI', async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before' });
    const args = [
      '--url',
      `${fixtures.baseUrl}/comparison`,
      '--viewport',
      '800x600',
      '--target',
      `moved=${COMPARISON_FIXTURE_SELECTORS.moved}`,
      '--output',
      freshOutputLocation('observations'),
    ];
    const beforeRoot = await observeOnce(args);
    const afterRoot = await observeOnce(['--url', `${fixtures.baseUrl}/comparison`, '--viewport', '800x600', '--target', `moved=${COMPARISON_FIXTURE_SELECTORS.moved}`, '--output', freshOutputLocation('observations')]);

    const { code, out } = await compareOnce(beforeRoot, afterRoot);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: comparable');
    expect(out.stdout()).toContain('Differences: 0');
    expect(out.stdout()).toContain('Relationship changes: 0');

    const manifest = await readManifest(out);
    expect(manifest.differences).toEqual([]);
    expect(manifest.relationshipChanges).toEqual([]);
    expect(manifest.before.observationId).not.toBe(manifest.after.observationId);
  });

  it('real moved and resized targets are correctly evidenced through the public CLI', async () => {
    async function observeVariant(variant: 'before' | 'after'): Promise<string> {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return observeOnce([
        '--url',
        `${fixtures.baseUrl}/comparison`,
        '--viewport',
        '800x600',
        '--target',
        `moved=${COMPARISON_FIXTURE_SELECTORS.moved}`,
        '--output',
        freshOutputLocation('observations'),
      ]);
    }
    const beforeRoot = await observeVariant('before');
    const afterRoot = await observeVariant('after');

    const { code, out } = await compareOnce(beforeRoot, afterRoot);
    expect(code).toBe(0);
    const manifest = await readManifest(out);
    expect(manifest.differences.find((d) => d.kind === 'moved')).toMatchObject({ before: { x: 100, y: 0 }, after: { x: 140, y: 0 } });
    expect(manifest.differences.find((d) => d.kind === 'resized')).toMatchObject({ before: { width: 80, height: 40 }, after: { width: 140, height: 60 } });
  });

  it('real appearance and disappearance are correctly evidenced, and a configuration-only addition is never fabricated as appeared', async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before' });
    const beforeRoot = await observeOnce([
      '--url',
      `${fixtures.baseUrl}/comparison`,
      '--viewport',
      '800x600',
      '--target',
      `appear=${COMPARISON_FIXTURE_SELECTORS.appear}`,
      '--target',
      `disappear=${COMPARISON_FIXTURE_SELECTORS.disappear}`,
      '--output',
      freshOutputLocation('observations'),
    ]);
    fixtures.setComparisonFixtureState({ layoutVariant: 'after' });
    const afterRoot = await observeOnce([
      '--url',
      `${fixtures.baseUrl}/comparison`,
      '--viewport',
      '800x600',
      '--target',
      `appear=${COMPARISON_FIXTURE_SELECTORS.appear}`,
      '--target',
      `disappear=${COMPARISON_FIXTURE_SELECTORS.disappear}`,
      '--output',
      freshOutputLocation('observations'),
    ]);
    // A third, config-only-different observation (adds a target that was never configured before).
    const afterRootWithExtraTarget = await observeOnce([
      '--url',
      `${fixtures.baseUrl}/comparison`,
      '--viewport',
      '800x600',
      '--target',
      `appear=${COMPARISON_FIXTURE_SELECTORS.appear}`,
      '--target',
      `disappear=${COMPARISON_FIXTURE_SELECTORS.disappear}`,
      '--target',
      `overlapA=${COMPARISON_FIXTURE_SELECTORS.overlapA}`,
      '--output',
      freshOutputLocation('observations'),
    ]);

    const { code, out } = await compareOnce(beforeRoot, afterRoot);
    expect(code).toBe(0);
    const manifest = await readManifest(out);
    expect(manifest.differences.find((d) => d.subject.type === 'target' && d.subject.target === 'appear')).toMatchObject({ kind: 'appeared' });
    expect(manifest.differences.find((d) => d.subject.type === 'target' && d.subject.target === 'disappear')).toMatchObject({ kind: 'disappeared' });

    const configOnly = await compareOnce(beforeRoot, afterRootWithExtraTarget);
    expect(configOnly.code).toBe(0);
    const configOnlyManifest = await readManifest(configOnly.out);
    expect(configOnlyManifest.differences.some((d) => d.kind === 'appeared' && d.subject.type === 'target' && d.subject.target === 'overlapA')).toBe(false);
    expect(configOnlyManifest.configurationChanges).toContainEqual({ kind: 'added', target: 'overlapA' });
  });

  it('a real overlap transition produces overlaps + relative-position-changed through the public CLI', async () => {
    async function observeVariant(variant: 'before' | 'after'): Promise<string> {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return observeOnce([
        '--url',
        `${fixtures.baseUrl}/comparison`,
        '--viewport',
        '800x600',
        '--target',
        `overlapA=${COMPARISON_FIXTURE_SELECTORS.overlapA}`,
        '--target',
        `overlapB=${COMPARISON_FIXTURE_SELECTORS.overlapB}`,
        '--output',
        freshOutputLocation('observations'),
      ]);
    }
    const beforeRoot = await observeVariant('before');
    const afterRoot = await observeVariant('after');

    const { code, out } = await compareOnce(beforeRoot, afterRoot);
    expect(code).toBe(0);
    const manifest = await readManifest(out);
    expect(manifest.relationshipChanges.find((c) => c.kind === 'overlaps' || c.kind === 'does-not-overlap')).toMatchObject({
      before: 'does-not-overlap',
      after: 'overlaps',
    });
    expect(manifest.differences.some((d) => d.kind === 'relative-position-changed')).toBe(true);
  });

  it('a real geometric-fit transition is evidenced distinctly from DOM containment through the public CLI', async () => {
    async function observeVariant(variant: 'before' | 'after'): Promise<string> {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return observeOnce([
        '--url',
        `${fixtures.baseUrl}/comparison`,
        '--viewport',
        '800x600',
        '--target',
        `fitChild=${COMPARISON_FIXTURE_SELECTORS.fitChild}`,
        '--target',
        `fitContainer=${COMPARISON_FIXTURE_SELECTORS.fitContainer}`,
        '--output',
        freshOutputLocation('observations'),
      ]);
    }
    const beforeRoot = await observeVariant('before');
    const afterRoot = await observeVariant('after');

    const { code, out } = await compareOnce(beforeRoot, afterRoot);
    expect(code).toBe(0);
    const manifest = await readManifest(out);
    expect(manifest.relationshipChanges.find((c) => c.kind === 'fits-inside' || c.kind === 'does-not-fit-inside')).toMatchObject({
      before: 'fits-inside',
      after: 'does-not-fit-inside',
    });
    expect(manifest.differences.some((d) => d.kind === 'containment-changed')).toBe(false);
  });

  it('a real page horizontal-overflow transition is evidenced through the public CLI', async () => {
    fixtures.setComparisonFixtureState({ layoutVariant: 'before' });
    const beforeRoot = await observeOnce(['--url', `${fixtures.baseUrl}/comparison`, '--viewport', '800x600', '--output', freshOutputLocation('observations')]);
    fixtures.setComparisonFixtureState({ layoutVariant: 'after' });
    const afterRoot = await observeOnce(['--url', `${fixtures.baseUrl}/comparison`, '--viewport', '800x600', '--output', freshOutputLocation('observations')]);

    const { code, out } = await compareOnce(beforeRoot, afterRoot);
    expect(code).toBe(0);
    const manifest = await readManifest(out);
    const pageChange = manifest.relationshipChanges.find((c) => c.scope === 'page');
    expect(pageChange).toMatchObject({ before: 'document-width-fits-viewport', after: 'document-width-exceeds-viewport' });
  });

  it('a real clipping transition is evidenced through the public CLI, reusing the canonical clipping helper', async () => {
    async function observeVariant(variant: 'before' | 'after'): Promise<string> {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return observeOnce([
        '--url',
        `${fixtures.baseUrl}/comparison`,
        '--viewport',
        '800x600',
        '--target',
        `clipTarget=${COMPARISON_FIXTURE_SELECTORS.clipTarget}`,
        '--output',
        freshOutputLocation('observations'),
      ]);
    }
    const beforeRoot = await observeVariant('before');
    const afterRoot = await observeVariant('after');

    const { code, out } = await compareOnce(beforeRoot, afterRoot);
    expect(code).toBe(0);
    const manifest = await readManifest(out);
    expect(manifest.differences.find((d) => d.kind === 'clipping-changed')).toMatchObject({ before: 'not-clipped', after: 'clipped' });
  });

  it('a real scroll-owner transition (none -> document) with matching scenario configuration, through the public CLI', async () => {
    const scenarioArgs = ['--scroll-scenario-file'];
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const scenarioDir = await mkdtemp(path.join(tmpdir(), 'mfo-cli-compare-scenario-'));
    const scenarioPath = path.join(scenarioDir, 'scenario.json');
    await writeFile(scenarioPath, JSON.stringify({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 500 } }), 'utf8');

    fixtures.setComparisonFixtureState({ layoutVariant: 'before', scrollVariant: 'no-scroll' });
    const beforeRoot = await observeOnce(['--url', `${fixtures.baseUrl}/comparison`, '--viewport', '800x600', ...scenarioArgs, scenarioPath, '--output', freshOutputLocation('observations')]);
    fixtures.setComparisonFixtureState({ layoutVariant: 'before', scrollVariant: 'scrollable' });
    const afterRoot = await observeOnce(['--url', `${fixtures.baseUrl}/comparison`, '--viewport', '800x600', ...scenarioArgs, scenarioPath, '--output', freshOutputLocation('observations')]);

    await rm(scenarioDir, { recursive: true, force: true });

    const { code, out } = await compareOnce(beforeRoot, afterRoot);
    expect(code).toBe(0);
    const manifest = await readManifest(out);
    expect(manifest.comparability.state).not.toBe('incomparable');
    expect(manifest.differences.find((d) => d.kind === 'scroll-owner-changed')).toMatchObject({ before: { kind: 'none' }, after: { kind: 'document' } });
  });

  it('an explicit dependency declaration via --config-file persists a non-causal evaluation through the public CLI', async () => {
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const configDir = await mkdtemp(path.join(tmpdir(), 'mfo-cli-compare-dep-config-'));
    const configPath = path.join(configDir, 'config.json');
    const declaration = {
      cause: { target: 'overlapA', property: 'x', direction: 'unchanged' },
      effect: { target: 'overlapB', property: 'x', direction: 'decrease' },
      source: 'explicit-config',
    };
    await writeFile(configPath, JSON.stringify({ geometryTolerancePx: 0.5, expectedDependencies: [declaration] }), 'utf8');

    async function observeVariant(variant: 'before' | 'after'): Promise<string> {
      fixtures.setComparisonFixtureState({ layoutVariant: variant });
      return observeOnce([
        '--url',
        `${fixtures.baseUrl}/comparison`,
        '--viewport',
        '800x600',
        '--target',
        `overlapA=${COMPARISON_FIXTURE_SELECTORS.overlapA}`,
        '--target',
        `overlapB=${COMPARISON_FIXTURE_SELECTORS.overlapB}`,
        '--output',
        freshOutputLocation('observations'),
      ]);
    }
    const beforeRoot = await observeVariant('before');
    const afterRoot = await observeVariant('after');

    const { code, out } = await compareOnce(beforeRoot, afterRoot, ['--config-file', configPath]);
    await rm(configDir, { recursive: true, force: true });

    expect(code).toBe(0);
    const manifest = await readManifest(out);
    expect(manifest.expectedDependencyEvidence).toEqual([{ declaration, outcome: 'consistent', supportingEvidence: expect.any(Array) }]);
    const serialized = JSON.stringify(manifest);
    for (const forbidden of ['causedBy', 'causalConfidence', 'PASS', 'FAIL']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
