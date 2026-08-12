import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeComparisonArtifact, COMPARISON_MANIFEST_FILENAME } from '../../src/artifacts/comparisonArtifactWriter.js';
import { compareAndPersist, DEFAULT_COMPARISON_OUTPUT_LOCATION } from '../../src/application/comparisonService.js';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import { isValidComparisonArtifact } from '../../src/domain/comparison.js';
import type { ComparisonArtifact } from '../../src/domain/comparison.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetGeometry, TargetEvidenceRecord } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';

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

function target(name: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: `#${name}` }] };
}

function observation(observationId: string, targets: NamedTarget[], targetEvidence: Record<string, TargetEvidenceRecord>): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId,
    requestId: `req-${observationId}`,
    producer: { name: PRODUCER_NAME, version: '0.3.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '139.0.0' } },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport: { width: 800, height: 600 },
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

function makeComparisonArtifact(): ComparisonArtifact {
  const before = observation('obs-before', [target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) });
  const after = observation('obs-after', [target('a')], { a: matchedTarget(rect(20, 0, 100, 50)) });
  const result = compareObservations(before, after);
  if (!result.ok) throw new Error(`expected ok comparison: ${result.reason}`);
  return result.artifact;
}

describe('writeComparisonArtifact', () => {
  const tempDirs: string[] = [];

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-comparison-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('persists exactly one manifest.json under <outputLocation>/<comparisonId>/, validating', async () => {
    const cwd = await freshCwd();
    const artifact = makeComparisonArtifact();

    const result = await writeComparisonArtifact(artifact, 'comparisons', { cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    expect(result.artifactRoot).toBe(path.join(cwd, 'comparisons', artifact.comparisonId));
    expect(result.manifestPath).toBe(path.join(result.artifactRoot, COMPARISON_MANIFEST_FILENAME));

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ComparisonArtifact;
    expect(isValidComparisonArtifact(manifest)).toEqual({ valid: true });
    expect(manifest.comparisonId).toBe(artifact.comparisonId);
    expect(manifest.before.observationId).toBe('obs-before');
    expect(manifest.after.observationId).toBe('obs-after');
    expect(manifest.before.screenshot).toEqual({ path: 'screenshot.png' });
    expect(manifest.after.screenshot).toEqual({ path: 'screenshot.png' });

    // No screenshot bytes/side files copied into the comparison directory - manifest.json only.
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(result.artifactRoot);
    expect(entries).toEqual([COMPARISON_MANIFEST_FILENAME]);
  });

  it('refuses to overwrite an existing comparison directory at the same comparisonId', async () => {
    const cwd = await freshCwd();
    const artifact = makeComparisonArtifact();

    const first = await writeComparisonArtifact(artifact, 'comparisons', { cwd });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected first write to succeed');
    const before = await readFile(first.manifestPath, 'utf8');

    const second = await writeComparisonArtifact(artifact, 'comparisons', { cwd });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected second write to be rejected');
    expect(second.diagnostics[0]?.code).toBe('artifact-write-failure');

    const after = await readFile(first.manifestPath, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a structurally invalid ComparisonArtifact before touching the filesystem', async () => {
    const cwd = await freshCwd();
    const invalid = { ...makeComparisonArtifact(), artifactKind: 'wrong-kind' } as unknown as ComparisonArtifact;
    const result = await writeComparisonArtifact(invalid, 'comparisons', { cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    await expect(access(path.join(cwd, 'comparisons'))).rejects.toBeDefined();
  });

  it('has no Playwright/browser runtime dependency', async () => {
    const mod = await import('../../src/artifacts/comparisonArtifactWriter.js');
    expect(typeof mod.writeComparisonArtifact).toBe('function');
  });
});

describe('compareAndPersist', () => {
  const tempDirs: string[] = [];

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-compare-and-persist-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('runs the pure comparison exactly once and persists exactly once, defaulting to the "comparisons" output location', async () => {
    const cwd = await freshCwd();
    const before = observation('obs-before', [target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) });
    const after = observation('obs-after', [target('a')], { a: matchedTarget(rect(30, 0, 100, 50)) });

    const result = await compareAndPersist(before, after, { cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.comparability).toBe('comparable');
    expect(result.differenceCount).toBeGreaterThan(0);
    expect(result.artifactRoot).toBe(path.join(cwd, DEFAULT_COMPARISON_OUTPUT_LOCATION, result.comparisonId));

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ComparisonArtifact;
    expect(isValidComparisonArtifact(manifest)).toEqual({ valid: true });
  });

  it('never mutates or modifies either source observation on disk', async () => {
    const cwd = await freshCwd();
    const before = observation('obs-before', [target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) });
    const after = observation('obs-after', [target('a')], { a: matchedTarget(rect(30, 0, 100, 50)) });
    const beforeSnapshot = JSON.stringify(before);
    const afterSnapshot = JSON.stringify(after);

    const result = await compareAndPersist(before, after, { cwd });
    expect(result.ok).toBe(true);

    expect(JSON.stringify(before)).toBe(beforeSnapshot);
    expect(JSON.stringify(after)).toBe(afterSnapshot);
  });

  it('propagates a comparison-engine failure as a diagnostic without persisting anything', async () => {
    const cwd = await freshCwd();
    const before = observation('obs-before', [target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) });
    const invalidAfter = { ...before, targetEvidence: 'not-an-object' } as unknown as ObservationArtifact;

    const result = await compareAndPersist(before, invalidAfter, { cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('invalid-request');
    await expect(access(path.join(cwd, DEFAULT_COMPARISON_OUTPUT_LOCATION))).rejects.toBeDefined();
  });
});
