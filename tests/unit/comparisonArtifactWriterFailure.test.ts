import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetGeometry, TargetEvidenceRecord } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(async (filePath: unknown, ...rest: unknown[]) => {
      if (String(filePath).endsWith('manifest.json')) {
        throw new Error('simulated disk failure writing comparison manifest.json');
      }
      return (actual.writeFile as (...args: unknown[]) => Promise<void>)(filePath, ...rest);
    }),
  };
});

const { writeComparisonArtifact } = await import('../../src/artifacts/comparisonArtifactWriter.js');

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

describe('writeComparisonArtifact (simulated mid-write filesystem failure)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('leaves no partially completed comparison directory and reports artifact-write-failure', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-comparison-fail-'));
    tempDirs.push(dir);

    const before = observation('obs-before', [target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) });
    const after = observation('obs-after', [target('a')], { a: matchedTarget(rect(30, 0, 100, 50)) });
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');

    const result = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the write to fail');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.diagnostics[0]?.message).toContain('simulated disk failure');

    const finalRoot = path.join(dir, 'comparisons', compared.artifact.comparisonId);
    await expect(access(finalRoot)).rejects.toBeDefined();

    const tempRoot = path.join(dir, 'comparisons', `.tmp-${compared.artifact.comparisonId}`);
    await expect(access(tempRoot)).rejects.toBeDefined();
  });
});
