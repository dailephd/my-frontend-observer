import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtemp, rm, access, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PRODUCER_NAME, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION, ARTIFACT_KIND } from '../../src/domain/schema.js';
import {
  CONTRACT_ARTIFACT_KIND,
  CONTRACT_SCHEMA_VERSION,
  type PersistentBaselineContract,
  type PerChangeContract,
} from '../../src/domain/frontendContracts.js';
import { writePersistentBaselineContract, writePerChangeContract, FRONTEND_CONTRACT_MANIFEST_FILENAME } from '../../src/artifacts/frontendContractArtifactWriter.js';
import { readPersistentBaselineContract, readPerChangeContract } from '../../src/artifacts/frontendContractArtifactReader.js';
import { readComparisonArtifact } from '../../src/artifacts/comparisonArtifactReader.js';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import { writeComparisonArtifact, COMPARISON_MANIFEST_FILENAME } from '../../src/artifacts/comparisonArtifactWriter.js';
import { COMPARISON_SCHEMA_VERSION, COMPARISON_ARTIFACT_KIND } from '../../src/domain/comparison.js';
import type { ObservationArtifact, TargetGeometry, TargetEvidenceRecord } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';

const tempDirs: string[] = [];
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function baselineContract(overrides: Partial<PersistentBaselineContract> = {}): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: { observationId: 'obs-1', requestId: 'req-1', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
    clauses: [{ clauseId: 'clause-1', primitive: { kind: 'target-visible', target: 'nav' }, supportingEvidence: [] }],
    provenance: { approvedAt: '2026-08-13T00:00:00.000Z' },
    ...overrides,
  };
}

function changeContract(overrides: Partial<PerChangeContract> = {}): PerChangeContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'change',
    contractId: 'change-1',
    contractRequestId: 'change-request-1',
    activeBaselineIds: ['baseline-1'],
    clauses: [{ clauseId: 'c-1', primitive: { kind: 'property-decreases', target: 'nav', property: 'width' }, category: 'requested', supportingEvidence: [] }],
    ...overrides,
  };
}

// --- TST-301: baseline round trip -----------------------------------------------

describe('PersistentBaselineContract persistence (TST-301)', () => {
  it('round-trips a valid baseline contract with identical logical identity', async () => {
    const dir = await makeTempDir('mfo-baseline-');
    const contract = baselineContract();
    const written = await writePersistentBaselineContract(contract, 'baselines', { cwd: dir });
    if (!written.ok) throw new Error('expected write to succeed');
    const read = await readPersistentBaselineContract(written.manifestPath);
    if (!read.ok) throw new Error(read.reason);
    expect(read.contract).toEqual(contract);
    expect(read.contract.baselineId).toBe('baseline-1');
  });
});

// --- TST-302: per-change contract round trip -------------------------------------

describe('PerChangeContract persistence (TST-302)', () => {
  it('is part of the frozen contract artifact family (shares CONTRACT_ARTIFACT_KIND/CONTRACT_SCHEMA_VERSION) and round-trips exactly', async () => {
    const dir = await makeTempDir('mfo-change-');
    const contract = changeContract();
    const written = await writePerChangeContract(contract, 'contracts', { cwd: dir });
    if (!written.ok) throw new Error('expected write to succeed');
    const read = await readPerChangeContract(written.manifestPath);
    if (!read.ok) throw new Error(read.reason);
    expect(read.contract).toEqual(contract);
  });
});

// --- TST-309/310: baseline supersession history -------------------------------------

describe('baseline supersession history (TST-309, TST-310)', () => {
  it('a later baseline referencing an earlier one round-trips without rewriting the earlier one, which remains byte-identical on disk', async () => {
    const dir = await makeTempDir('mfo-baseline-history-');
    const baselineA = baselineContract({ baselineId: 'baseline-a' });
    const writtenA = await writePersistentBaselineContract(baselineA, 'baselines', { cwd: dir });
    if (!writtenA.ok) throw new Error('expected write A to succeed');
    const rawABefore = await readFile(writtenA.manifestPath, 'utf8');

    const baselineB = baselineContract({ baselineId: 'baseline-b', supersedesBaselineId: 'baseline-a' });
    const writtenB = await writePersistentBaselineContract(baselineB, 'baselines', { cwd: dir });
    if (!writtenB.ok) throw new Error('expected write B to succeed');

    const rawAAfter = await readFile(writtenA.manifestPath, 'utf8');
    expect(rawAAfter).toBe(rawABefore);

    const readA = await readPersistentBaselineContract(writtenA.manifestPath);
    const readB = await readPersistentBaselineContract(writtenB.manifestPath);
    if (!readA.ok || !readB.ok) throw new Error('expected both reads to succeed');
    expect(readA.contract.baselineId).toBe('baseline-a');
    expect(readA.contract.supersedesBaselineId).toBeUndefined();
    expect(readB.contract.supersedesBaselineId).toBe('baseline-a');
  });
});

// --- TST-311: no silent overwrite of a completed artifact --------------------------

describe('existing artifact collision (TST-311)', () => {
  it('a second write to the same baseline identity fails explicitly and leaves the first artifact unchanged', async () => {
    const dir = await makeTempDir('mfo-baseline-collision-');
    const contract = baselineContract();
    const first = await writePersistentBaselineContract(contract, 'baselines', { cwd: dir });
    if (!first.ok) throw new Error('expected first write to succeed');
    const rawBefore = await readFile(first.manifestPath, 'utf8');

    const second = await writePersistentBaselineContract(baselineContract({ provenance: { approvedAt: '2099-01-01T00:00:00.000Z' } }), 'baselines', { cwd: dir });
    expect(second.ok).toBe(false);

    const rawAfter = await readFile(first.manifestPath, 'utf8');
    expect(rawAfter).toBe(rawBefore);
  });
});

// --- TST-314/315/316/317: reader rejection cases ------------------------------------

describe('reader rejection cases (TST-314, TST-315, TST-316, TST-317)', () => {
  it('TST-316: malformed JSON is rejected', async () => {
    const dir = await makeTempDir('mfo-malformed-');
    await mkdir(path.join(dir, 'x'), { recursive: true });
    const manifestPath = path.join(dir, 'x', FRONTEND_CONTRACT_MANIFEST_FILENAME);
    await writeFile(manifestPath, '{ not valid json', 'utf8');
    const read = await readPersistentBaselineContract(manifestPath);
    expect(read.ok).toBe(false);
  });

  it('TST-314: wrong artifactKind (observation family) is rejected', async () => {
    const dir = await makeTempDir('mfo-wrongkind-');
    await mkdir(path.join(dir, 'x'), { recursive: true });
    const manifestPath = path.join(dir, 'x', FRONTEND_CONTRACT_MANIFEST_FILENAME);
    await writeFile(manifestPath, JSON.stringify({ artifactKind: ARTIFACT_KIND, schemaVersion: OBSERVATION_SCHEMA_VERSION }), 'utf8');
    const read = await readPersistentBaselineContract(manifestPath);
    expect(read.ok).toBe(false);
  });

  it('TST-315: unsupported schema version is rejected, never silently upgraded', async () => {
    const dir = await makeTempDir('mfo-wrongschema-');
    await mkdir(path.join(dir, 'x'), { recursive: true });
    const manifestPath = path.join(dir, 'x', FRONTEND_CONTRACT_MANIFEST_FILENAME);
    const contract = { ...baselineContract(), schemaVersion: '9.9.9' };
    await writeFile(manifestPath, JSON.stringify(contract), 'utf8');
    const read = await readPersistentBaselineContract(manifestPath);
    expect(read.ok).toBe(false);
  });

  it('TST-317: structurally invalid contract fields are rejected', async () => {
    const dir = await makeTempDir('mfo-invalidfields-');
    await mkdir(path.join(dir, 'x'), { recursive: true });
    const manifestPath = path.join(dir, 'x', FRONTEND_CONTRACT_MANIFEST_FILENAME);
    const contract = { ...baselineContract(), clauses: [{ clauseId: 'c-1', primitive: { kind: 'bogus' }, supportingEvidence: [] }] };
    await writeFile(manifestPath, JSON.stringify(contract), 'utf8');
    const read = await readPersistentBaselineContract(manifestPath);
    expect(read.ok).toBe(false);
  });
});

// --- TST-328: supersession identity survives persistence ---------------------------

describe('explicit supersession identity survives persistence (TST-328)', () => {
  it('supersedesBaselineClauseIds on a per-change contract round-trips exactly', async () => {
    const dir = await makeTempDir('mfo-supersede-clauses-');
    const contract = changeContract({
      clauses: [
        { clauseId: 'c-1', primitive: { kind: 'property-decreases', target: 'nav', property: 'width' }, category: 'requested', supportingEvidence: [], supersedesBaselineClauseIds: ['baseline-clause-1'] },
      ],
    });
    const written = await writePerChangeContract(contract, 'contracts', { cwd: dir });
    if (!written.ok) throw new Error('expected write to succeed');
    const read = await readPerChangeContract(written.manifestPath);
    if (!read.ok) throw new Error(read.reason);
    expect(read.contract.clauses[0]?.supersedesBaselineClauseIds).toEqual(['baseline-clause-1']);
  });
});

// --- TST-312/313: atomic write failure injection ------------------------------------

describe('atomic write failure behavior (TST-312, TST-313)', () => {
  it('TST-312: a mid-write failure leaves no completed final artifact and no partial temp directory', async () => {
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        writeFile: vi.fn(async (filePath: unknown, ...rest: unknown[]) => {
          if (String(filePath).endsWith(FRONTEND_CONTRACT_MANIFEST_FILENAME)) throw new Error('simulated disk failure writing contract manifest.json');
          return (actual.writeFile as (...args: unknown[]) => Promise<void>)(filePath, ...rest);
        }),
      };
    });
    vi.resetModules();
    const { writePersistentBaselineContract: writeWithFailure } = await import('../../src/artifacts/frontendContractArtifactWriter.js');

    const dir = await makeTempDir('mfo-baseline-writefail-');
    const contract = baselineContract();
    const result = await writeWithFailure(contract, 'baselines', { cwd: dir });
    expect(result.ok).toBe(false);

    const finalRoot = path.join(dir, 'baselines', contract.baselineId);
    await expect(access(finalRoot)).rejects.toBeDefined();
    const tempRoot = path.join(dir, 'baselines', `.tmp-${contract.baselineId}`);
    await expect(access(tempRoot)).rejects.toBeDefined();

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  it('TST-313: a rename (finalization) failure returns an explicit failure and leaves no valid completed artifact', async () => {
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        rename: vi.fn(async () => {
          throw new Error('simulated rename failure');
        }),
      };
    });
    vi.resetModules();
    const { writePersistentBaselineContract: writeWithFailure } = await import('../../src/artifacts/frontendContractArtifactWriter.js');

    const dir = await makeTempDir('mfo-baseline-renamefail-');
    const contract = baselineContract();
    const result = await writeWithFailure(contract, 'baselines', { cwd: dir });
    expect(result.ok).toBe(false);

    const finalRoot = path.join(dir, 'baselines', contract.baselineId);
    await expect(access(finalRoot)).rejects.toBeDefined();

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });
});

// --- TST-319: comparison artifact reader --------------------------------------------

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
    layout: { state: 'available', source: 'browser', value: { scrollWidth: geometry.width, scrollHeight: geometry.height, clientWidth: geometry.width, clientHeight: geometry.height, scrollTop: 0, scrollLeft: 0 } },
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

function observation(observationId: string, names: NamedTarget[], evidence: Record<string, TargetEvidenceRecord>): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observationId,
    requestId: `req-${observationId}`,
    producer: { name: PRODUCER_NAME, version: '0.4.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '139.0.0' } },
    requestConfig: { targetUrl: 'http://localhost/', viewport: { width: 800, height: 600 }, targets: names, outputLocation: 'observations', timeoutMs: 30000, readiness: { condition: 'load', timeoutMs: 10000 } },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence: evidence,
    screenshot: { state: 'available', source: 'browser', value: { path: 'screenshot.png' } },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
}

describe('readComparisonArtifact (TST-319)', () => {
  it('reads a valid v0.4 comparison artifact and preserves schema 1.0.0', async () => {
    expect(COMPARISON_SCHEMA_VERSION).toBe('1.0.0');
    const dir = await makeTempDir('mfo-comparison-read-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 150, 600)) });
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');
    const written = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
    if (!written.ok) throw new Error('expected comparison write to succeed');

    const read = await readComparisonArtifact(written.manifestPath);
    if (!read.ok) throw new Error(read.reason);
    expect(read.artifact.artifactKind).toBe(COMPARISON_ARTIFACT_KIND);
    expect(read.artifact.comparisonId).toBe(compared.artifact.comparisonId);
  });

  it('rejects an invalid comparison artifact', async () => {
    const dir = await makeTempDir('mfo-comparison-invalid-');
    await mkdir(path.join(dir, 'x'), { recursive: true });
    const manifestPath = path.join(dir, 'x', COMPARISON_MANIFEST_FILENAME);
    await writeFile(manifestPath, JSON.stringify({ not: 'a comparison' }), 'utf8');
    const read = await readComparisonArtifact(manifestPath);
    expect(read.ok).toBe(false);
  });
});
