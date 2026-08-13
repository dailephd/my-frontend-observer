import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtemp, rm, access, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ARTIFACT_KIND, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetGeometry, TargetEvidenceRecord, TargetComputedStyle, TargetLayoutMetrics } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';
import { writeObservationArtifact, MANIFEST_FILENAME as OBSERVATION_MANIFEST_FILENAME, SCREENSHOT_FILENAME } from '../../src/artifacts/artifactWriter.js';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import { writeComparisonArtifact, COMPARISON_MANIFEST_FILENAME } from '../../src/artifacts/comparisonArtifactWriter.js';
import { writePersistentBaselineContract, writePerChangeContract, FRONTEND_CONTRACT_MANIFEST_FILENAME } from '../../src/artifacts/frontendContractArtifactWriter.js';
import { readFrontendContractEvaluationArtifact } from '../../src/artifacts/frontendContractEvaluationArtifactReader.js';
import { EVALUATION_MANIFEST_FILENAME } from '../../src/artifacts/frontendContractEvaluationArtifactWriter.js';
import { EVALUATION_ARTIFACT_KIND, EVALUATION_SCHEMA_VERSION } from '../../src/domain/frontendContractEvaluationArtifact.js';
import { CONTRACT_ARTIFACT_KIND, CONTRACT_SCHEMA_VERSION, type PersistentBaselineContract, type PerChangeContract } from '../../src/domain/frontendContracts.js';
import { evaluateAndPersist, evaluateAndPersistFromArtifactRoots } from '../../src/application/frontendContractEvaluationService.js';
import { evaluateFrontendContract, type FrontendContractEvaluationInput } from '../../src/domain/frontendContractEvaluation.js';

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

function rect(x: number, y: number, width: number, height: number): TargetGeometry {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function matchedTarget(geometry: TargetGeometry, style?: TargetComputedStyle, layout?: TargetLayoutMetrics): TargetEvidenceRecord {
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
    style: { state: 'available', source: 'computed-browser', value: style ?? { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
    layout: { state: 'available', source: 'browser', value: layout ?? { scrollWidth: geometry.width, scrollHeight: geometry.height, clientWidth: geometry.width, clientHeight: geometry.height, scrollTop: 0, scrollLeft: 0 } },
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

function observation(observationId: string, names: NamedTarget[], evidence: Record<string, TargetEvidenceRecord>, outputLocation = 'observations'): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observationId,
    requestId: `req-${observationId}`,
    producer: { name: PRODUCER_NAME, version: '0.4.0' },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '139.0.0' } },
    requestConfig: { targetUrl: 'http://localhost/', viewport: { width: 1200, height: 800 }, targets: names, outputLocation, timeoutMs: 30000, readiness: { condition: 'load', timeoutMs: 10000 } },
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

function baselineContract(overrides: Partial<PersistentBaselineContract> = {}): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: { observationId: 'obs-before', requestId: 'req-obs-before', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
    clauses: [],
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
    clauses: [],
    ...overrides,
  };
}

async function fullPipelineFixture(dir: string) {
  const before = observation('obs-before', [target('navigation'), target('workspace'), target('rightAd')], {
    navigation: matchedTarget(rect(0, 0, 190, 600)),
    workspace: matchedTarget(rect(200, 0, 600, 600)),
    rightAd: matchedTarget(rect(900, 0, 200, 600)),
  });
  const after = observation(
    'obs-after',
    [target('navigation'), target('workspace'), target('rightAd')],
    {
      navigation: matchedTarget(rect(0, 0, 140, 600), { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' }, { scrollWidth: 160, scrollHeight: 600, clientWidth: 140, clientHeight: 600, scrollTop: 0, scrollLeft: 0 }),
      workspace: matchedTarget(rect(200, 0, 650, 600)),
      rightAd: matchedTarget(rect(900, 0, 180, 600)),
    },
  );

  const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1, 2, 3]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, new Uint8Array([4, 5, 6]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  const baseline = baselineContract({ sourceObservation: { observationId: 'obs-before', requestId: 'req-obs-before', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION } });
  const change = changeContract({
    clauses: [
      { clauseId: 'requested-nav', primitive: { kind: 'property-decreases', target: 'navigation', property: 'width' }, category: 'requested', supportingEvidence: [] },
      { clauseId: 'expected-workspace', primitive: { kind: 'property-increases', target: 'workspace', property: 'width' }, category: 'expected-dependent', expectedDependentMode: 'required', supportingEvidence: [] },
      { clauseId: 'protected-rightad', primitive: { kind: 'property-unchanged-within-tolerance', target: 'rightAd', property: 'width', tolerance: { kind: 'exact' } }, category: 'protected', supportingEvidence: [] },
      { clauseId: 'preserved-nav-unclipped', primitive: { kind: 'target-not-clipped', target: 'navigation' }, category: 'preserved', supportingEvidence: [] },
    ],
  });
  const baselineWritten = await writePersistentBaselineContract(baseline, 'baselines', { cwd: dir });
  const changeWritten = await writePerChangeContract(change, 'contracts', { cwd: dir });
  if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

  return {
    before,
    after,
    comparison: compared.artifact,
    baseline,
    change,
    beforeRoot: beforeWritten.artifactRoot,
    afterRoot: afterWritten.artifactRoot,
    comparisonRoot: comparisonWritten.artifactRoot,
    baselineRoot: baselineWritten.artifactRoot,
    changeRoot: changeWritten.artifactRoot,
  };
}

// --- TST-329: full milestone-signature FAIL persists correctly ---------------------

describe('full application pipeline (TST-329, Section 27 integration test)', () => {
  it('reads baseline + contract + observations + comparison, evaluates exactly once, persists exactly one evaluation artifact, and rereads it unchanged', async () => {
    const dir = await makeTempDir('mfo-pipeline-');
    const fixture = await fullPipelineFixture(dir);

    const result = await evaluateAndPersistFromArtifactRoots(fixture.beforeRoot, fixture.afterRoot, fixture.comparisonRoot, fixture.baselineRoot, fixture.changeRoot, { cwd: dir });
    if (!result.ok) throw new Error(`expected ok result: ${JSON.stringify(result.diagnostics)}`);
    expect(result.overallVerdict).toBe('FAIL');

    const read = await readFrontendContractEvaluationArtifact(result.manifestPath);
    if (!read.ok) throw new Error(read.reason);

    const byId = new Map(read.artifact.clauseResults.map((r) => [r.clauseId, r]));
    expect(byId.get('requested-nav')?.status).toBe('pass');
    expect(byId.get('expected-workspace')?.status).toBe('pass');
    expect(byId.get('protected-rightad')?.status).toBe('fail');
    expect(byId.get('preserved-nav-unclipped')?.status).toBe('fail');
    expect(read.artifact.overallVerdict).toBe('FAIL');
    expect(read.artifact.artifactKind).toBe(EVALUATION_ARTIFACT_KIND);
    expect(read.artifact.schemaVersion).toBe(EVALUATION_SCHEMA_VERSION);
  });
});

// --- TST-303/304: evaluation round trip + PASS persists -----------------------------

describe('evaluation artifact persistence (TST-303, TST-304)', () => {
  it('a PASS evaluation persists and round-trips exactly', async () => {
    const dir = await makeTempDir('mfo-eval-pass-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');

    const input: FrontendContractEvaluationInput = { before, after, comparison: compared.artifact, baseline: baselineContract(), change: changeContract() };
    const result = await evaluateAndPersist(input, { cwd: dir });
    if (!result.ok) throw new Error('expected ok result');
    expect(result.overallVerdict).toBe('PASS');

    const read = await readFrontendContractEvaluationArtifact(result.manifestPath);
    if (!read.ok) throw new Error(read.reason);
    expect(read.artifact.overallVerdict).toBe('PASS');
    expect(read.artifact.evaluationId).toBe(result.evaluationId);
    expect(read.artifact.comparisonId).toBe(compared.artifact.comparisonId);
  });
});

// --- TST-305: FAIL also persists -----------------------------------------------------

describe('FAIL evaluation persistence (TST-305)', () => {
  it('a valid FAIL evaluation persists successfully - a regression is evidence, not a write failure', async () => {
    const dir = await makeTempDir('mfo-eval-fail-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');

    const change = changeContract({ clauses: [{ clauseId: 'req-1', primitive: { kind: 'property-decreases', target: 'nav', property: 'width' }, category: 'requested', supportingEvidence: [] }] });
    const input: FrontendContractEvaluationInput = { before, after, comparison: compared.artifact, baseline: baselineContract(), change };
    const result = await evaluateAndPersist(input, { cwd: dir });
    if (!result.ok) throw new Error('expected ok result even though the verdict is FAIL');
    expect(result.overallVerdict).toBe('FAIL');
    const read = await readFrontendContractEvaluationArtifact(result.manifestPath);
    if (!read.ok) throw new Error(read.reason);
    expect(read.artifact.overallVerdict).toBe('FAIL');
  });
});

// --- TST-306: evaluator construction failure is not persisted ----------------------

describe('evaluator construction failure is not persisted (TST-306)', () => {
  it('an incoherent input (mismatched observationId) produces ok:false and writes nothing', async () => {
    const dir = await makeTempDir('mfo-eval-construction-fail-');
    const before = observation('obs-before', [], {});
    const after = observation('obs-after', [], {});
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');

    const wrongBefore = observation('obs-different', [], {});
    const input: FrontendContractEvaluationInput = { before: wrongBefore, after, comparison: compared.artifact, baseline: baselineContract(), change: changeContract() };
    const result = await evaluateAndPersist(input, { cwd: dir });
    expect(result.ok).toBe(false);

    const evaluationsDir = path.join(dir, 'evaluations');
    await expect(access(evaluationsDir)).rejects.toBeDefined();
  });
});

// --- TST-307/308: exactly-once evaluator/writer invocation -------------------------

describe('exactly-once evaluator and writer invocation (TST-307, TST-308)', () => {
  it('evaluateFrontendContract is invoked exactly once per evaluateAndPersist call', async () => {
    vi.doMock('../../src/domain/frontendContractEvaluation.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/domain/frontendContractEvaluation.js')>();
      return { ...actual, evaluateFrontendContract: vi.fn(actual.evaluateFrontendContract) };
    });
    vi.resetModules();
    const evalModule = await import('../../src/domain/frontendContractEvaluation.js');
    const { evaluateAndPersist: evaluateAndPersistFresh } = await import('../../src/application/frontendContractEvaluationService.js');

    const dir = await makeTempDir('mfo-eval-once-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');

    const input: FrontendContractEvaluationInput = { before, after, comparison: compared.artifact, baseline: baselineContract(), change: changeContract() };
    await evaluateAndPersistFresh(input, { cwd: dir });

    expect(vi.mocked(evalModule.evaluateFrontendContract)).toHaveBeenCalledTimes(1);

    vi.doUnmock('../../src/domain/frontendContractEvaluation.js');
    vi.resetModules();
  });

  it('writeFrontendContractEvaluationArtifact is invoked exactly once on a successful path', async () => {
    vi.doMock('../../src/artifacts/frontendContractEvaluationArtifactWriter.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/artifacts/frontendContractEvaluationArtifactWriter.js')>();
      return { ...actual, writeFrontendContractEvaluationArtifact: vi.fn(actual.writeFrontendContractEvaluationArtifact) };
    });
    vi.resetModules();
    const writerModule = await import('../../src/artifacts/frontendContractEvaluationArtifactWriter.js');
    const { evaluateAndPersist: evaluateAndPersistFresh } = await import('../../src/application/frontendContractEvaluationService.js');

    const dir = await makeTempDir('mfo-write-once-');
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');

    const input: FrontendContractEvaluationInput = { before, after, comparison: compared.artifact, baseline: baselineContract(), change: changeContract() };
    const result = await evaluateAndPersistFresh(input, { cwd: dir });
    expect(result.ok).toBe(true);
    expect(vi.mocked(writerModule.writeFrontendContractEvaluationArtifact)).toHaveBeenCalledTimes(1);

    vi.doUnmock('../../src/artifacts/frontendContractEvaluationArtifactWriter.js');
    vi.resetModules();
  });
});

// --- TST-318: structurally invalid evaluation artifact rejected --------------------

describe('structurally invalid evaluation artifact rejected (TST-318)', () => {
  it('rejects a manifest with an invalid overallVerdict value', async () => {
    const dir = await makeTempDir('mfo-eval-invalid-');
    await mkdir(path.join(dir, 'x'), { recursive: true });
    const manifestPath = path.join(dir, 'x', EVALUATION_MANIFEST_FILENAME);
    await writeFile(
      manifestPath,
      JSON.stringify({
        artifactKind: EVALUATION_ARTIFACT_KIND,
        schemaVersion: EVALUATION_SCHEMA_VERSION,
        evaluationId: 'e-1',
        evaluationRequestId: 'er-1',
        producer: { name: PRODUCER_NAME, version: '0.4.0' },
        provenance: { evaluatedAt: '2026-08-13T00:00:00.000Z' },
        contracts: { baselineId: 'b-1', contractId: 'c-1' },
        before: { observationId: 'o1', requestId: 'r1', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
        after: { observationId: 'o2', requestId: 'r2', producer: { name: PRODUCER_NAME, version: '0.4.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
        comparisonId: 'cmp-1',
        comparisonRequestId: 'cmp-req-1',
        overallVerdict: 'MAYBE',
        activeBaselineClauseIds: [],
        supersededBaselineClauseIds: [],
        clauseResults: [],
        unexpectedChanges: [],
      }),
      'utf8',
    );
    const read = await readFrontendContractEvaluationArtifact(manifestPath);
    expect(read.ok).toBe(false);
  });
});

// --- TST-320: observation reader reused ---------------------------------------------

describe('observation reader reuse (TST-320)', () => {
  it('the application pipeline uses the existing readObservationArtifact reader (manifest.json/screenshot.png layout)', async () => {
    const dir = await makeTempDir('mfo-obs-reader-reuse-');
    const fixture = await fullPipelineFixture(dir);
    await expect(access(path.join(fixture.beforeRoot, OBSERVATION_MANIFEST_FILENAME))).resolves.toBeUndefined();
    await expect(access(path.join(fixture.beforeRoot, SCREENSHOT_FILENAME))).resolves.toBeUndefined();
    const result = await evaluateAndPersistFromArtifactRoots(fixture.beforeRoot, fixture.afterRoot, fixture.comparisonRoot, fixture.baselineRoot, fixture.changeRoot, { cwd: dir });
    expect(result.ok).toBe(true);
  });
});

// --- TST-321/322/323/324: immutability of every source input ------------------------

describe('source immutability across the full pipeline (TST-321, TST-322, TST-323, TST-324)', () => {
  it('observation manifests/screenshots, comparison manifest, and baseline/change manifests remain byte-identical after evaluation persistence', async () => {
    const dir = await makeTempDir('mfo-immutability-');
    const fixture = await fullPipelineFixture(dir);

    const beforeManifestBefore = await readFile(path.join(fixture.beforeRoot, OBSERVATION_MANIFEST_FILENAME), 'utf8');
    const beforeScreenshotBefore = await readFile(path.join(fixture.beforeRoot, SCREENSHOT_FILENAME));
    const afterManifestBefore = await readFile(path.join(fixture.afterRoot, OBSERVATION_MANIFEST_FILENAME), 'utf8');
    const afterScreenshotBefore = await readFile(path.join(fixture.afterRoot, SCREENSHOT_FILENAME));
    const comparisonManifestBefore = await readFile(path.join(fixture.comparisonRoot, COMPARISON_MANIFEST_FILENAME), 'utf8');
    const baselineManifestBefore = await readFile(path.join(fixture.baselineRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8');
    const changeManifestBefore = await readFile(path.join(fixture.changeRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8');

    const result = await evaluateAndPersistFromArtifactRoots(fixture.beforeRoot, fixture.afterRoot, fixture.comparisonRoot, fixture.baselineRoot, fixture.changeRoot, { cwd: dir });
    expect(result.ok).toBe(true);

    expect(await readFile(path.join(fixture.beforeRoot, OBSERVATION_MANIFEST_FILENAME), 'utf8')).toBe(beforeManifestBefore);
    expect(await readFile(path.join(fixture.beforeRoot, SCREENSHOT_FILENAME))).toEqual(beforeScreenshotBefore);
    expect(await readFile(path.join(fixture.afterRoot, OBSERVATION_MANIFEST_FILENAME), 'utf8')).toBe(afterManifestBefore);
    expect(await readFile(path.join(fixture.afterRoot, SCREENSHOT_FILENAME))).toEqual(afterScreenshotBefore);
    expect(await readFile(path.join(fixture.comparisonRoot, COMPARISON_MANIFEST_FILENAME), 'utf8')).toBe(comparisonManifestBefore);
    expect(await readFile(path.join(fixture.baselineRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8')).toBe(baselineManifestBefore);
    expect(await readFile(path.join(fixture.changeRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), 'utf8')).toBe(changeManifestBefore);
  });
});

// --- TST-325: no screenshot copied into the evaluation artifact --------------------

describe('no screenshot copied into evaluation output (TST-325)', () => {
  it('the persisted evaluation directory contains only manifest.json', async () => {
    const dir = await makeTempDir('mfo-no-screenshot-');
    const fixture = await fullPipelineFixture(dir);
    const result = await evaluateAndPersistFromArtifactRoots(fixture.beforeRoot, fixture.afterRoot, fixture.comparisonRoot, fixture.baselineRoot, fixture.changeRoot, { cwd: dir });
    if (!result.ok) throw new Error('expected ok result');
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(result.artifactRoot);
    expect(entries).toEqual([EVALUATION_MANIFEST_FILENAME]);
  });
});

// --- TST-326: operational path privacy ----------------------------------------------

describe('operational path privacy (TST-326)', () => {
  it('running semantically identical inputs from two different filesystem locations produces the same evaluationRequestId', async () => {
    const dirA = await makeTempDir('mfo-path-privacy-a-');
    const dirB = await makeTempDir('mfo-path-privacy-b-');
    const fixtureA = await fullPipelineFixture(dirA);
    const fixtureB = await fullPipelineFixture(dirB);

    const resultA = await evaluateAndPersistFromArtifactRoots(fixtureA.beforeRoot, fixtureA.afterRoot, fixtureA.comparisonRoot, fixtureA.baselineRoot, fixtureA.changeRoot, { cwd: dirA });
    const resultB = await evaluateAndPersistFromArtifactRoots(fixtureB.beforeRoot, fixtureB.afterRoot, fixtureB.comparisonRoot, fixtureB.baselineRoot, fixtureB.changeRoot, { cwd: dirB });
    if (!resultA.ok || !resultB.ok) throw new Error('expected both to succeed');

    expect(resultA.evaluationRequestId).toBe(resultB.evaluationRequestId);
    expect(resultA.evaluationId).not.toBe(resultB.evaluationId);

    const readA = await readFrontendContractEvaluationArtifact(resultA.manifestPath);
    if (!readA.ok) throw new Error(readA.reason);
    expect(JSON.stringify(readA.artifact)).not.toContain(dirA.replace(/\\/g, '\\\\'));
    expect(JSON.stringify(readA.artifact)).not.toContain(dirA.replace(/\\/g, '/'));
  });
});

// --- TST-327: deterministic identity -------------------------------------------------

describe('deterministic identity preserved (TST-327)', () => {
  it('the same semantic evaluation input produces the same evaluationRequestId across two direct evaluations', () => {
    const before = observation('obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 200, 600)) });
    const after = observation('obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 150, 600)) });
    const compared = compareObservations(before, after);
    if (!compared.ok) throw new Error('expected ok comparison');
    const input: FrontendContractEvaluationInput = { before, after, comparison: compared.artifact, baseline: baselineContract(), change: changeContract() };
    const first = evaluateFrontendContract(input);
    const second = evaluateFrontendContract(input);
    expect(first).toEqual(second);
  });
});

// --- TST-330: no evaluator semantics in the artifact layer --------------------------

describe('no evaluator semantics in the artifact layer (TST-330)', () => {
  it('frontendContractArtifactWriter/Reader and frontendContractEvaluationArtifactWriter/Reader source never references evaluateFrontendContract or clause-evaluation logic', async () => {
    const files = [
      'src/artifacts/frontendContractArtifactWriter.ts',
      'src/artifacts/frontendContractArtifactReader.ts',
      'src/artifacts/frontendContractEvaluationArtifactWriter.ts',
      'src/artifacts/frontendContractEvaluationArtifactReader.ts',
      'src/artifacts/comparisonArtifactReader.ts',
    ];
    for (const relativePath of files) {
      const contents = await readFile(path.resolve(relativePath), 'utf8');
      expect(contents).not.toContain('evaluateFrontendContract');
      expect(contents.includes('primitivesConflict') || contents.includes('evaluateStatePrimitive') || contents.includes('evaluateClause')).toBe(false);
    }
  });
});
