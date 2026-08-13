import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../../src/cli.js';
import { isValidComparisonArtifact } from '../../src/domain/comparison.js';
import type { ComparisonArtifact } from '../../src/domain/comparison.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetGeometry, TargetEvidenceRecord } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';

const runBrowserCaptureMock = vi.fn();
vi.mock('../../src/application/browserCaptureService.js', () => ({
  runBrowserCapture: (...args: unknown[]) => {
    runBrowserCaptureMock(...args);
    throw new Error('runBrowserCapture must never be invoked by the compare command');
  },
}));

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

function rect(x: number, y: number, width: number, height: number): TargetGeometry {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function matchedTarget(geometry: TargetGeometry): TargetEvidenceRecord {
  return {
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
    tag: { state: 'available', source: 'browser', value: 'div' },
    geometry: { state: 'available', source: 'browser', value: geometry },
    style: { state: 'available', source: 'computed-browser', value: { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
    layout: {
      state: 'available',
      source: 'browser',
      value: { scrollWidth: geometry.width, scrollHeight: geometry.height, clientWidth: geometry.width, clientHeight: geometry.height, scrollTop: 0, scrollLeft: 0 },
    },
    visibility: { state: 'available', source: 'derived', value: { visible: true }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
  };
}

function unresolvedTarget(): TargetEvidenceRecord {
  const reason = 'no configured locator matched an element';
  return {
    resolution: {
      state: 'available',
      source: 'derived',
      value: { selectionMethod: 'ordered-locators', selectionStatus: 'not-found', usedFallback: false, confidence: 'none', attempts: [] },
      derivedFrom: ['locator-attempts'],
    },
    tag: { state: 'unavailable', reason },
    geometry: { state: 'unavailable', reason },
    style: { state: 'unavailable', reason },
    layout: { state: 'unavailable', reason },
    visibility: { state: 'unavailable', reason },
    semantics: { state: 'unavailable', reason },
    semanticState: { state: 'unavailable', reason },
    landmark: { state: 'unavailable', reason },
    containment: { state: 'unavailable', reason },
  };
}

function target(name: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: `#${name}` }] };
}

interface ObservationOptions {
  observationId?: string;
  producerVersion?: string;
  browserVersion?: string;
  viewport?: { width: number; height: number };
}

function buildObservation(targets: NamedTarget[], targetEvidence: Record<string, TargetEvidenceRecord>, options: ObservationOptions = {}): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: options.observationId ?? 'obs-1',
    requestId: `req-${options.observationId ?? 'obs-1'}`,
    producer: { name: PRODUCER_NAME, version: options.producerVersion ?? '0.3.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: options.browserVersion ?? '139.0.0' } },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport: options.viewport ?? { width: 800, height: 600 },
      targets,
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence,
    screenshot: { state: 'available', source: 'browser', value: { path: 'screenshot.png' } },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
}

async function writeObservationRoot(dir: string, name: string, artifact: ObservationArtifact): Promise<string> {
  const root = path.join(dir, name);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(artifact, null, 2), 'utf8');
  await writeFile(path.join(root, 'screenshot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return root;
}

describe('runCli compare - real end-to-end (synthetic observation artifacts, no Chromium)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    runBrowserCaptureMock.mockClear();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function freshDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-cli-compare-e2e-'));
    tempDirs.push(dir);
    return dir;
  }

  /**
   * `--output` must be a portable, relative location (`normalizeOutputLocation`
   * rejects absolute paths/drive letters, matching the observation writer's
   * own rule) - so these tests run with `dir` as the working directory and
   * pass relative output locations, restoring the real cwd afterward.
   */
  async function runCompareInDir(dir: string, args: readonly string[], io: ReturnType<typeof capture>['io']): Promise<number> {
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      return await runCli(args, io);
    } finally {
      process.chdir(originalCwd);
    }
  }

  it('never invokes runBrowserCapture during a compare invocation', async () => {
    const dir = await freshDir();
    const before = buildObservation([target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) }, { observationId: 'obs-before' });
    const after = buildObservation([target('a')], { a: matchedTarget(rect(20, 0, 100, 50)) }, { observationId: 'obs-after' });
    const beforeRoot = await writeObservationRoot(dir, 'before', before);
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);

    expect(code).toBe(0);
    expect(runBrowserCaptureMock).not.toHaveBeenCalled();
  });

  it('reports incomparable and still persists a valid artifact, exiting 0', async () => {
    const dir = await freshDir();
    const before = buildObservation([], {}, { observationId: 'obs-before', viewport: { width: 1280, height: 720 } });
    const after = buildObservation([], {}, { observationId: 'obs-after', viewport: { width: 1024, height: 768 } });
    const beforeRoot = await writeObservationRoot(dir, 'before', before);
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);

    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: incomparable');
    const artifactRootLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactRootLine?.slice('Artifact: '.length) ?? '';
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as ComparisonArtifact;
    expect(isValidComparisonArtifact(manifest)).toEqual({ valid: true });
    expect(manifest.comparability.reasons.some((r) => r.code === 'viewport-mismatch')).toBe(true);
    expect(manifest.differences).toEqual([]);
  });

  it('reports comparable-with-warnings for a browser-version-only difference and exits 0', async () => {
    const dir = await freshDir();
    const before = buildObservation([], {}, { observationId: 'obs-before', browserVersion: '139.0.0' });
    const after = buildObservation([], {}, { observationId: 'obs-after', browserVersion: '140.0.0' });
    const beforeRoot = await writeObservationRoot(dir, 'before', before);
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);

    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: comparable-with-warnings');
  });

  it('proves appearance and disappearance through the public CLI', async () => {
    const dir = await freshDir();
    const before = buildObservation(
      [target('appears'), target('disappears')],
      { appears: unresolvedTarget(), disappears: matchedTarget(rect(0, 0, 50, 50)) },
      { observationId: 'obs-before' },
    );
    const after = buildObservation(
      [target('appears'), target('disappears')],
      { appears: matchedTarget(rect(0, 0, 50, 50)), disappears: unresolvedTarget() },
      { observationId: 'obs-after' },
    );
    const beforeRoot = await writeObservationRoot(dir, 'before', before);
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);
    expect(code).toBe(0);

    const artifactRoot = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length) ?? '';
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as ComparisonArtifact;
    expect(manifest.differences.find((d) => d.subject.type === 'target' && d.subject.target === 'appears')).toMatchObject({ kind: 'appeared' });
    expect(manifest.differences.find((d) => d.subject.type === 'target' && d.subject.target === 'disappears')).toMatchObject({ kind: 'disappeared' });
  });

  it('a configuration-only target change is recorded separately and never fabricates appeared/disappeared', async () => {
    const dir = await freshDir();
    const before = buildObservation([target('a')], { a: matchedTarget(rect(0, 0, 50, 50)) }, { observationId: 'obs-before' });
    const after = buildObservation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(0, 0, 50, 50)), b: matchedTarget(rect(100, 0, 50, 50)) },
      { observationId: 'obs-after' },
    );
    const beforeRoot = await writeObservationRoot(dir, 'before', before);
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);
    expect(code).toBe(0);

    const artifactRoot = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length) ?? '';
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as ComparisonArtifact;
    expect(manifest.differences.some((d) => d.kind === 'appeared' || d.kind === 'disappeared')).toBe(false);
    expect(manifest.configurationChanges).toEqual([{ kind: 'added', target: 'b' }]);
  });

  it('an explicit dependency declaration from --config-file persists its evaluation, never causal, never PASS/FAIL', async () => {
    const dir = await freshDir();
    const before = buildObservation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 140, 50)), workspace: matchedTarget(rect(140, 0, 300, 50)) },
      { observationId: 'obs-before' },
    );
    const after = buildObservation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 60, 50)), workspace: matchedTarget(rect(60, 0, 400, 50)) },
      { observationId: 'obs-after' },
    );
    const beforeRoot = await writeObservationRoot(dir, 'before', before);
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const configPath = path.join(dir, 'config.json');
    const declaration = {
      cause: { target: 'navigation', property: 'width', direction: 'decrease' },
      effect: { target: 'workspace', property: 'width', direction: 'increase' },
      source: 'explicit-config',
    };
    await writeFile(configPath, JSON.stringify({ geometryTolerancePx: 0.5, expectedDependencies: [declaration] }), 'utf8');
    const out = capture();

    const code = await runCompareInDir(
      dir,
      ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons', '--config-file', configPath],
      out.io,
    );
    expect(code).toBe(0);

    const artifactRoot = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length) ?? '';
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as ComparisonArtifact;
    expect(manifest.expectedDependencyEvidence).toEqual([{ declaration, outcome: 'consistent', supportingEvidence: expect.any(Array) }]);
    const serialized = JSON.stringify(manifest);
    for (const forbidden of ['causedBy', 'causalConfidence', 'PASS', 'FAIL', 'caused']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('path privacy: absolute before/after/config/output paths never leak into the persisted manifest, and comparisonRequestId is unaffected by relocation', async () => {
    const dirA = await freshDir();
    const dirB = await freshDir();
    const before = buildObservation([target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) }, { observationId: 'obs-before' });
    const after = buildObservation([target('a')], { a: matchedTarget(rect(30, 0, 100, 50)) }, { observationId: 'obs-after' });

    const beforeRootA = await writeObservationRoot(dirA, 'before', before);
    const afterRootA = await writeObservationRoot(dirA, 'after', after);
    const configPathA = path.join(dirA, 'config.json');
    await writeFile(configPathA, JSON.stringify({ geometryTolerancePx: 0.5 }), 'utf8');
    const outA = capture();
    const codeA = await runCompareInDir(
      dirA,
      ['compare', '--before', beforeRootA, '--after', afterRootA, '--output', 'comparisons', '--config-file', configPathA],
      outA.io,
    );
    expect(codeA).toBe(0);
    const artifactRootA = outA.stdout().split('\n').find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length) ?? '';
    const manifestA = JSON.parse(await readFile(path.join(artifactRootA, 'manifest.json'), 'utf8')) as ComparisonArtifact;

    // Relocate identical semantic content to a completely different filesystem location.
    const beforeRootB = await writeObservationRoot(dirB, 'before', before);
    const afterRootB = await writeObservationRoot(dirB, 'after', after);
    const configPathB = path.join(dirB, 'config.json');
    await writeFile(configPathB, JSON.stringify({ geometryTolerancePx: 0.5 }), 'utf8');
    const outB = capture();
    const codeB = await runCompareInDir(
      dirB,
      ['compare', '--before', beforeRootB, '--after', afterRootB, '--output', 'comparisons', '--config-file', configPathB],
      outB.io,
    );
    expect(codeB).toBe(0);
    const artifactRootB = outB.stdout().split('\n').find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length) ?? '';
    const manifestB = JSON.parse(await readFile(path.join(artifactRootB, 'manifest.json'), 'utf8')) as ComparisonArtifact;

    expect(manifestA.comparisonRequestId).toBe(manifestB.comparisonRequestId);
    expect(manifestA.comparisonId).not.toBe(manifestB.comparisonId);

    const serialized = JSON.stringify(manifestA);
    expect(serialized).not.toContain(dirA);
    expect(serialized).not.toContain(beforeRootA);
    expect(serialized).not.toContain(afterRootA);
    expect(serialized).not.toContain(configPathA);
  });

  it('direction sensitivity: swapping --before/--after changes comparisonRequestId and reverses deltas', async () => {
    const dir = await freshDir();
    const obsA = buildObservation([target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) }, { observationId: 'obs-a' });
    const obsB = buildObservation([target('a')], { a: matchedTarget(rect(30, 0, 100, 50)) }, { observationId: 'obs-b' });
    const rootA = await writeObservationRoot(dir, 'a', obsA);
    const rootB = await writeObservationRoot(dir, 'b', obsB);

    const forwardOut = capture();
    await runCompareInDir(dir, ['compare', '--before', rootA, '--after', rootB, '--output', 'comparisons-forward'], forwardOut.io);
    const forwardArtifactRoot = forwardOut.stdout().split('\n').find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length) ?? '';
    const forwardManifest = JSON.parse(await readFile(path.join(forwardArtifactRoot, 'manifest.json'), 'utf8')) as ComparisonArtifact;

    const reversedOut = capture();
    await runCompareInDir(dir, ['compare', '--before', rootB, '--after', rootA, '--output', 'comparisons-reversed'], reversedOut.io);
    const reversedArtifactRoot = reversedOut.stdout().split('\n').find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length) ?? '';
    const reversedManifest = JSON.parse(await readFile(path.join(reversedArtifactRoot, 'manifest.json'), 'utf8')) as ComparisonArtifact;

    expect(forwardManifest.comparisonRequestId).not.toBe(reversedManifest.comparisonRequestId);
    const forwardMoved = forwardManifest.differences.find((d) => d.kind === 'moved');
    const reversedMoved = reversedManifest.differences.find((d) => d.kind === 'moved');
    expect((forwardMoved?.delta as { x: number })?.x).toBe(30);
    expect((reversedMoved?.delta as { x: number })?.x).toBe(-30);
  });

  it('screenshot references are retained and no screenshot bytes are copied into the comparison directory', async () => {
    const dir = await freshDir();
    const before = buildObservation([], {}, { observationId: 'obs-before' });
    const after = buildObservation([], {}, { observationId: 'obs-after' });
    const beforeRoot = await writeObservationRoot(dir, 'before', before);
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);
    expect(code).toBe(0);

    const artifactRoot = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '))?.slice('Artifact: '.length) ?? '';
    const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as ComparisonArtifact;
    expect(manifest.before.screenshot).toEqual({ path: 'screenshot.png' });
    expect(manifest.after.screenshot).toEqual({ path: 'screenshot.png' });

    const { readdir } = await import('node:fs/promises');
    expect(await readdir(artifactRoot)).toEqual(['manifest.json']);
  });

  it('source observations remain byte-identical after comparison', async () => {
    const dir = await freshDir();
    const before = buildObservation([target('a')], { a: matchedTarget(rect(0, 0, 50, 50)) }, { observationId: 'obs-before' });
    const after = buildObservation([target('a')], { a: matchedTarget(rect(10, 0, 50, 50)) }, { observationId: 'obs-after' });
    const beforeRoot = await writeObservationRoot(dir, 'before', before);
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const beforeManifestBefore = await readFile(path.join(beforeRoot, 'manifest.json'), 'utf8');
    const afterManifestBefore = await readFile(path.join(afterRoot, 'manifest.json'), 'utf8');
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);
    expect(code).toBe(0);

    expect(await readFile(path.join(beforeRoot, 'manifest.json'), 'utf8')).toBe(beforeManifestBefore);
    expect(await readFile(path.join(afterRoot, 'manifest.json'), 'utf8')).toBe(afterManifestBefore);
  });

  it('rejects a malformed before manifest (invalid JSON) before persisting anything', async () => {
    const dir = await freshDir();
    const after = buildObservation([], {}, { observationId: 'obs-after' });
    const beforeRoot = path.join(dir, 'before');
    await mkdir(beforeRoot, { recursive: true });
    await writeFile(path.join(beforeRoot, 'manifest.json'), '{ not valid json', 'utf8');
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);

    expect(code).toBe(1);
    expect(out.stderr()).toContain('--before observation artifact');
    expect(out.stderr()).toContain('not valid JSON');

    const { access } = await import('node:fs/promises');
    await expect(access(path.join(dir, 'comparisons'))).rejects.toBeDefined();
  });

  it('rejects a structurally invalid ObservationArtifact before persisting anything', async () => {
    const dir = await freshDir();
    const after = buildObservation([], {}, { observationId: 'obs-after' });
    const beforeRoot = path.join(dir, 'before');
    await mkdir(beforeRoot, { recursive: true });
    await writeFile(path.join(beforeRoot, 'manifest.json'), JSON.stringify({ not: 'an observation' }), 'utf8');
    const afterRoot = await writeObservationRoot(dir, 'after', after);
    const out = capture();

    const code = await runCompareInDir(dir, ['compare', '--before', beforeRoot, '--after', afterRoot, '--output', 'comparisons'], out.io);

    expect(code).toBe(1);
    expect(out.stderr()).toContain('failed structural validation');
  });
});
