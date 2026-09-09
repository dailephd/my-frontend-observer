/**
 * v0.8 Batch 2 shared fixture builders: real, valid Observer evidence built
 * through the existing canonical writers/application services (never
 * hand-forged JSON claiming to be a validated artifact) so viewer-indexing
 * tests exercise genuine artifact shapes. Mirrors the construction pattern
 * already established in tests/unit/cliFrontendContracts.test.ts's
 * `fullPipelineFixture`.
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { ARTIFACT_KIND, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetGeometry, TargetEvidenceRecord, TargetComputedStyle, TargetLayoutMetrics } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';
import { writeObservationArtifact } from '../../src/artifacts/artifactWriter.js';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import { writeComparisonArtifact } from '../../src/artifacts/comparisonArtifactWriter.js';
import { CONTRACT_ARTIFACT_KIND, CONTRACT_SCHEMA_VERSION } from '../../src/domain/frontendContracts.js';
import type { PersistentBaselineContract, PerChangeContract } from '../../src/domain/frontendContracts.js';
import { writePersistentBaselineContract, writePerChangeContract } from '../../src/artifacts/frontendContractArtifactWriter.js';
import { evaluateAndPersistFromArtifactRoots } from '../../src/application/frontendContractEvaluationService.js';
import { importExternalReference, approveExternalReference } from '../../src/application/externalReferencePersistenceService.js';
import { buildMinimalPng } from '../unit/externalReferenceImageFixtures.js';
import { readExternalReferenceArtifact } from '../../src/artifacts/externalReferenceArtifactReader.js';
import { EXTERNAL_REFERENCE_MANIFEST_FILENAME } from '../../src/artifacts/externalReferenceArtifactWriter.js';
import type { ApprovedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import { readFrontendContractEvaluationArtifact } from '../../src/artifacts/frontendContractEvaluationArtifactReader.js';
import { EVALUATION_MANIFEST_FILENAME } from '../../src/artifacts/frontendContractEvaluationArtifactWriter.js';
import { evaluateReferenceCandidateFidelity } from '../../src/domain/externalReferenceFidelity.js';
import type { ReferenceCandidateFidelityEvaluation } from '../../src/domain/externalReferenceFidelity.js';
import { projectBoundedAgentContext } from '../../src/domain/boundedAgentContextProjection.js';
import { deriveRuntimeStaticCorrelations, attachRuntimeStaticCorrelations } from '../../src/domain/boundedAgentContextCorrelation.js';
import type { StaticCandidateEvidenceInput } from '../../src/domain/boundedAgentContextCorrelation.js';
import type { BoundedAgentContextArtifact, StaticEvidenceProducerIdentity } from '../../src/domain/boundedAgentContext.js';

function crc32(buf: Uint8Array): number {
  const table = (crc32 as { table?: Uint32Array }).table ?? (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    (crc32 as { table?: Uint32Array }).table = t;
    return t;
  })();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (table as Uint32Array)[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, body, crcBuf]);
}

/** A real, fully decodable solid-color PNG at exactly `width`x`height` pixels - unlike `buildMinimalPng` (header-only, IHDR-only), this renders in a real browser, so real-Chromium tests can prove actual screenshot/SVG pixel alignment. */
export function buildRealPng(width: number, height: number, rgb: [number, number, number] = [30, 64, 175]): Uint8Array {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const off = rowStart + 1 + x * 3;
      raw[off] = rgb[0];
      raw[off + 1] = rgb[1];
      raw[off + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]));
}

export function rect(x: number, y: number, width: number, height: number): TargetGeometry {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

export function matchedTarget(geometry: TargetGeometry, style?: TargetComputedStyle, layout?: TargetLayoutMetrics): TargetEvidenceRecord {
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
    layout: {
      state: 'available',
      source: 'browser',
      value: layout ?? { scrollWidth: geometry.width, scrollHeight: geometry.height, clientWidth: geometry.width, clientHeight: geometry.height, scrollTop: 0, scrollLeft: 0 },
    },
    visibility: { state: 'available', source: 'derived', value: { visible: true }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
  };
}

export function target(name: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: `#${name}` }] };
}

/** Mirrors relationshipDerivation.test.ts's `unresolvedTarget`: a configured target whose selection genuinely failed - every field honestly `unavailable`, never a fabricated zero-geometry fallback. */
export function unresolvedTarget(status: 'not-found' | 'ambiguous' | 'unavailable'): TargetEvidenceRecord {
  const reason = `target ${status}`;
  return {
    resolution: {
      state: 'available',
      source: 'derived',
      value: { selectionMethod: 'ordered-locators', selectionStatus: status, usedFallback: false, confidence: 'none', attempts: [] },
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

/** Mirrors the real shape `src/browser/evidenceCapture.ts#capturePageEvidence` produces for a real Chromium capture (see the Batch 3 coordinate audit in docs/reports/v0.8-observation-svg-inspection-batch3.md). */
export function realisticPageEvidence(viewport: { width: number; height: number }) {
  return {
    requestedUrl: { state: 'available' as const, source: 'browser' as const, value: 'http://localhost/' },
    finalUrl: { state: 'available' as const, source: 'browser' as const, value: 'http://localhost/' },
    title: { state: 'available' as const, source: 'browser' as const, value: 'fixture' },
    viewportWidth: { state: 'available' as const, source: 'browser' as const, value: viewport.width },
    viewportHeight: { state: 'available' as const, source: 'browser' as const, value: viewport.height },
    devicePixelRatio: { state: 'available' as const, source: 'browser' as const, value: 1 },
    documentScrollWidth: { state: 'available' as const, source: 'browser' as const, value: viewport.width },
    documentScrollHeight: { state: 'available' as const, source: 'browser' as const, value: viewport.height },
    documentClientWidth: { state: 'available' as const, source: 'browser' as const, value: viewport.width },
    documentClientHeight: { state: 'available' as const, source: 'browser' as const, value: viewport.height },
    documentWidth: { state: 'available' as const, source: 'derived' as const, value: viewport.width, derivedFrom: ['documentScrollWidth', 'documentClientWidth'] },
    documentHeight: { state: 'available' as const, source: 'derived' as const, value: viewport.height, derivedFrom: ['documentScrollHeight', 'documentClientHeight'] },
    windowScrollX: { state: 'available' as const, source: 'browser' as const, value: 0 },
    windowScrollY: { state: 'available' as const, source: 'browser' as const, value: 0 },
  };
}

export function buildObservation(
  observationId: string,
  names: NamedTarget[],
  evidence: Record<string, TargetEvidenceRecord>,
  producerVersion = '0.7.0',
  pageEvidence: Record<string, unknown> = {},
  viewport: { width: number; height: number } = { width: 1200, height: 800 },
): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observationId,
    requestId: `req-${observationId}`,
    producer: { name: PRODUCER_NAME, version: producerVersion },
    browser: { state: 'available', source: 'browser', value: { engine: 'chromium', version: '139.0.0' } },
    requestConfig: { targetUrl: 'http://localhost/', viewport, targets: names, outputLocation: 'observations', timeoutMs: 30000, readiness: { condition: 'load', timeoutMs: 10000 } },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence,
    targetEvidence: evidence,
    screenshot: { state: 'available', source: 'browser', value: { path: 'screenshot.png' } },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
}

export interface RichObservationFixture {
  artifactRoot: string;
  observationId: string;
  viewport: { width: number; height: number };
}

/**
 * Batch 3: one observation with a real, decodable, viewport-sized PNG
 * screenshot; two geometrically resolved targets positioned to produce a
 * real canonical relationship (`header` left-of `sidebar`, both above
 * `footer`); and one genuinely unresolved (`not-found`) target - so a
 * single fixture exercises SVG rendering, relationship derivation, and the
 * honest non-geometric case together.
 */
export async function writeRichObservationFixture(dir: string, observationId = 'rich-obs'): Promise<RichObservationFixture> {
  const viewport = { width: 800, height: 600 };
  const artifact = buildObservation(
    observationId,
    [target('header'), target('sidebar'), target('footer'), target('missingWidget')],
    {
      header: matchedTarget(rect(0, 0, 800, 80)),
      sidebar: matchedTarget(rect(0, 100, 200, 400)),
      footer: matchedTarget(rect(0, 520, 800, 80)),
      missingWidget: unresolvedTarget('not-found'),
    },
    '0.7.0',
    realisticPageEvidence(viewport),
    viewport,
  );
  const written = await writeObservationArtifact(artifact, buildRealPng(viewport.width, viewport.height), { cwd: dir });
  if (!written.ok) throw new Error('expected rich observation write to succeed');
  return { artifactRoot: written.artifactRoot, observationId, viewport };
}

export function buildBaselineContract(overrides: Partial<PersistentBaselineContract> = {}): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: { observationId: 'obs-before', requestId: 'req-obs-before', producer: { name: PRODUCER_NAME, version: '0.7.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
    clauses: [],
    provenance: { approvedAt: '2026-08-13T00:00:00.000Z' },
    ...overrides,
  };
}

export function buildChangeContract(overrides: Partial<PerChangeContract> = {}): PerChangeContract {
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

export interface FullPipelineFixture {
  beforeRoot: string;
  afterRoot: string;
  comparisonRoot: string;
  baselineRoot: string;
  changeRoot: string;
  evaluationRoot: string;
}

/**
 * Writes one full, real, cross-referenced evidence pipeline (observation x2,
 * comparison, baseline contract, per-change contract, evaluation) under
 * `dir`, using the same layout every real CLI invocation produces
 * (`<dir>/observations/<id>/`, `<dir>/comparisons/<id>/`, etc.).
 */
export async function writeFullPipelineFixture(dir: string): Promise<FullPipelineFixture> {
  const before = buildObservation('obs-before', [target('navigation'), target('workspace'), target('rightAd')], {
    navigation: matchedTarget(rect(0, 0, 190, 600)),
    workspace: matchedTarget(rect(200, 0, 600, 600)),
    rightAd: matchedTarget(rect(900, 0, 200, 600)),
  });
  const after = buildObservation('obs-after', [target('navigation'), target('workspace'), target('rightAd')], {
    navigation: matchedTarget(
      rect(0, 0, 140, 600),
      { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' },
      { scrollWidth: 160, scrollHeight: 600, clientWidth: 140, clientHeight: 600, scrollTop: 0, scrollLeft: 0 },
    ),
    workspace: matchedTarget(rect(200, 0, 650, 600)),
    rightAd: matchedTarget(rect(900, 0, 180, 600)),
  });

  const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1, 2, 3]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, new Uint8Array([4, 5, 6]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  const baseline = buildBaselineContract();
  const change = buildChangeContract({
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

  const evaluated = await evaluateAndPersistFromArtifactRoots(beforeWritten.artifactRoot, afterWritten.artifactRoot, comparisonWritten.artifactRoot, baselineWritten.artifactRoot, changeWritten.artifactRoot, {
    outputLocation: 'evaluations',
    cwd: dir,
  });
  if (!evaluated.ok) throw new Error('expected evaluation to succeed');

  return {
    beforeRoot: beforeWritten.artifactRoot,
    afterRoot: afterWritten.artifactRoot,
    comparisonRoot: comparisonWritten.artifactRoot,
    baselineRoot: baselineWritten.artifactRoot,
    changeRoot: changeWritten.artifactRoot,
    evaluationRoot: evaluated.artifactRoot,
  };
}

/**
 * Batch 4: the deliberate all-pass counterpart to `writeFullPipelineFixture`
 * - same shape/clause set, but `rightAd` (protected) is genuinely unchanged
 * and `navigation` (preserved-unclipped) genuinely never becomes clipped, so
 * every clause - requested, expected-dependent, protected, preserved -
 * passes and `overallVerdict` is real, canonical `PASS` (never hand-edited).
 */
export async function writeAllPassPipelineFixture(dir: string): Promise<FullPipelineFixture> {
  const before = buildObservation('obs-before', [target('navigation'), target('workspace'), target('rightAd')], {
    navigation: matchedTarget(rect(0, 0, 190, 600)),
    workspace: matchedTarget(rect(200, 0, 600, 600)),
    rightAd: matchedTarget(rect(900, 0, 200, 600)),
  });
  const after = buildObservation('obs-after', [target('navigation'), target('workspace'), target('rightAd')], {
    navigation: matchedTarget(
      rect(0, 0, 140, 600),
      { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' },
      { scrollWidth: 140, scrollHeight: 600, clientWidth: 140, clientHeight: 600, scrollTop: 0, scrollLeft: 0 }, // scrollWidth === clientWidth: genuinely never clipped
    ),
    workspace: matchedTarget(rect(200, 0, 650, 600)),
    rightAd: matchedTarget(rect(900, 0, 200, 600)), // unchanged from before: genuinely satisfies the protected clause
  });

  const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1, 2, 3]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, new Uint8Array([4, 5, 6]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  const baseline = buildBaselineContract();
  const change = buildChangeContract({
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

  const evaluated = await evaluateAndPersistFromArtifactRoots(beforeWritten.artifactRoot, afterWritten.artifactRoot, comparisonWritten.artifactRoot, baselineWritten.artifactRoot, changeWritten.artifactRoot, {
    outputLocation: 'evaluations',
    cwd: dir,
  });
  if (!evaluated.ok) throw new Error('expected evaluation to succeed');

  return {
    beforeRoot: beforeWritten.artifactRoot,
    afterRoot: afterWritten.artifactRoot,
    comparisonRoot: comparisonWritten.artifactRoot,
    baselineRoot: baselineWritten.artifactRoot,
    changeRoot: changeWritten.artifactRoot,
    evaluationRoot: evaluated.artifactRoot,
  };
}

/**
 * Batch 4: a fixture whose baseline contract genuinely has two clauses, one
 * of which the per-change contract explicitly supersedes - so the resulting
 * evaluation artifact's `activeBaselineClauseIds`/`supersededBaselineClauseIds`
 * are real, canonical evaluator output (never hand-set) with both a
 * non-empty active and a non-empty superseded id.
 */
export async function writeBaselineSupersessionFixture(dir: string): Promise<FullPipelineFixture> {
  const before = buildObservation('obs-before', [target('navigation'), target('workspace')], {
    navigation: matchedTarget(rect(0, 0, 190, 600)),
    workspace: matchedTarget(rect(200, 0, 600, 600)),
  });
  const after = buildObservation('obs-after', [target('navigation'), target('workspace')], {
    navigation: matchedTarget(rect(0, 0, 140, 600)),
    workspace: matchedTarget(rect(200, 0, 650, 600)),
  });

  const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1, 2, 3]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, new Uint8Array([4, 5, 6]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  const baseline = buildBaselineContract({
    clauses: [
      { clauseId: 'baseline-nav-visible', primitive: { kind: 'target-visible', target: 'navigation' }, supportingEvidence: [] },
      { clauseId: 'baseline-workspace-visible', primitive: { kind: 'target-visible', target: 'workspace' }, supportingEvidence: [] },
    ],
  });
  const change = buildChangeContract({
    clauses: [
      {
        clauseId: 'requested-nav',
        primitive: { kind: 'property-decreases', target: 'navigation', property: 'width' },
        category: 'requested',
        supersedesBaselineClauseIds: ['baseline-nav-visible'],
        supportingEvidence: [],
      },
    ],
  });
  const baselineWritten = await writePersistentBaselineContract(baseline, 'baselines', { cwd: dir });
  const changeWritten = await writePerChangeContract(change, 'contracts', { cwd: dir });
  if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

  const evaluated = await evaluateAndPersistFromArtifactRoots(beforeWritten.artifactRoot, afterWritten.artifactRoot, comparisonWritten.artifactRoot, baselineWritten.artifactRoot, changeWritten.artifactRoot, {
    outputLocation: 'evaluations',
    cwd: dir,
  });
  if (!evaluated.ok) throw new Error('expected evaluation to succeed');

  return {
    beforeRoot: beforeWritten.artifactRoot,
    afterRoot: afterWritten.artifactRoot,
    comparisonRoot: comparisonWritten.artifactRoot,
    baselineRoot: baselineWritten.artifactRoot,
    changeRoot: changeWritten.artifactRoot,
    evaluationRoot: evaluated.artifactRoot,
  };
}

export interface ComparisonOnlyFixture {
  beforeRoot: string;
  afterRoot: string;
  comparisonRoot: string;
}

/**
 * Batch 4: a real comparison (no contract layer) whose `banner` target
 * genuinely appears (not-found -> matched) and whose `promo` target
 * genuinely disappears (matched -> not-found) - the same stable configured
 * target name on both sides, per `compareObservations`'s own eligibility
 * rule (never a target added/removed from configuration, which is its own
 * `configurationChanges` entry).
 */
export async function writeAppearedDisappearedComparisonFixture(dir: string): Promise<ComparisonOnlyFixture> {
  const before = buildObservation('ad-obs-before', [target('banner'), target('promo')], {
    banner: unresolvedTarget('not-found'),
    promo: matchedTarget(rect(0, 0, 300, 60)),
  });
  const after = buildObservation('ad-obs-after', [target('banner'), target('promo')], {
    banner: matchedTarget(rect(0, 0, 300, 60)),
    promo: unresolvedTarget('not-found'),
  });

  const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1, 2, 3]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, new Uint8Array([4, 5, 6]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  return { beforeRoot: beforeWritten.artifactRoot, afterRoot: afterWritten.artifactRoot, comparisonRoot: comparisonWritten.artifactRoot };
}

/**
 * Batch 4: a real comparison between two observations whose viewports
 * genuinely differ (a `viewport-mismatch` blocking reason) - `compareObservations`
 * itself decides `incomparable`, never re-derived or asserted by the viewer.
 */
export async function writeIncomparableComparisonFixture(dir: string): Promise<ComparisonOnlyFixture> {
  const before = buildObservation('ic-obs-before', [target('nav')], { nav: matchedTarget(rect(0, 0, 190, 600)) }, '0.7.0', {}, { width: 1200, height: 800 });
  const after = buildObservation('ic-obs-after', [target('nav')], { nav: matchedTarget(rect(0, 0, 190, 600)) }, '0.7.0', {}, { width: 800, height: 600 });

  const beforeWritten = await writeObservationArtifact(before, new Uint8Array([1, 2, 3]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, new Uint8Array([4, 5, 6]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  if (compared.artifact.comparability.state !== 'incomparable') {
    throw new Error(`expected an incomparable fixture, got comparability state "${compared.artifact.comparability.state}"`);
  }
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  return { beforeRoot: beforeWritten.artifactRoot, afterRoot: afterWritten.artifactRoot, comparisonRoot: comparisonWritten.artifactRoot };
}

export interface ExternalReferencePairFixture {
  importedRoot: string;
  approvedRoot: string;
  importedReferenceId: string;
  approvedReferenceId: string;
}

/** Writes one real imported external-reference artifact (owning a tiny valid PNG) plus one real approved artifact pointing back to it - the exact ownership shape mediaResolver.ts's 'source-image' role must resolve. */
export async function writeExternalReferencePairFixture(dir: string): Promise<ExternalReferencePairFixture> {
  const imageBytes = buildMinimalPng(32, 24);
  const imported = await importExternalReference(imageBytes, { outputLocation: 'references', cwd: dir, label: 'fixture' });
  if (!imported.ok) throw new Error('expected reference import to succeed');

  const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references', cwd: dir });
  if (!approved.ok) throw new Error('expected reference approval to succeed');

  return {
    importedRoot: imported.artifactRoot,
    approvedRoot: approved.artifactRoot,
    importedReferenceId: imported.referenceId,
    approvedReferenceId: approved.referenceId,
  };
}

/** Writes a manifest.json-named file that is not valid JSON at all, at `<dir>/<name>/manifest.json`. */
export async function writeMalformedJsonManifest(dir: string, name: string): Promise<string> {
  const artifactDir = path.join(dir, name);
  await mkdir(artifactDir, { recursive: true });
  const manifestPath = path.join(artifactDir, 'manifest.json');
  await writeFile(manifestPath, '{ this is not valid json ', 'utf8');
  return artifactDir;
}

/** Writes a syntactically valid JSON manifest.json that declares a recognized observation kind but an unsupported future schema version. */
export async function writeUnsupportedVersionManifest(dir: string, name: string): Promise<string> {
  const artifactDir = path.join(dir, name);
  await mkdir(artifactDir, { recursive: true });
  const manifestPath = path.join(artifactDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ artifactKind: ARTIFACT_KIND, schemaVersion: '99.0.0', observationId: 'future-obs' }, null, 2), 'utf8');
  return artifactDir;
}

/** Writes a valid observation artifact whose completion state is structurally coherent but whose backing screenshot.png is then deleted, to prove the honest "missing media" case. */
export async function writeObservationWithMissingScreenshot(dir: string, name: string): Promise<{ artifactRoot: string; observationId: string }> {
  const observationId = `obs-missing-screenshot-${name}`;
  const base = buildObservation(observationId, [target('header')], { header: matchedTarget(rect(0, 0, 100, 40)) });
  const artifact: ObservationArtifact = { ...base, requestConfig: { ...base.requestConfig, outputLocation: name } };
  const written = await writeObservationArtifact(artifact, new Uint8Array([9, 9, 9]), { cwd: dir });
  if (!written.ok) throw new Error('expected observation write to succeed');
  await unlink(written.screenshotPath);
  return { artifactRoot: written.artifactRoot, observationId };
}

/** Writes a syntactically valid JSON manifest.json with an unrecognized artifactKind (the honest "unrecognized-kind" case). */
export async function writeUnrecognizedManifest(dir: string, name: string): Promise<string> {
  const artifactDir = path.join(dir, name);
  await mkdir(artifactDir, { recursive: true });
  const manifestPath = path.join(artifactDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ hello: 'world' }, null, 2), 'utf8');
  return artifactDir;
}

/** Writes a file that is not named manifest.json at all - must never be indexed as evidence. */
export async function writeUnrelatedFile(dir: string, relativePath: string, content = 'not evidence'): Promise<string> {
  const filePath = path.join(dir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

export interface ReferenceCandidateFixture {
  importedRoot: string;
  approvedRoot: string;
  importedReferenceId: string;
  approvedReferenceId: string;
  referenceImage: { width: number; height: number };
  compatibleCandidateRoot: string;
  compatibleCandidateId: string;
  incompatibleCandidateRoot: string;
  incompatibleCandidateId: string;
}

/**
 * Batch 5: one real, decodable reference image (imported + approved pair,
 * built through the real canonical `importExternalReference`/
 * `approveExternalReference` application services - never hand-forged JSON)
 * carrying two real regions ("header", "sidebar"), one requirement per
 * authored category (requested/expected-dependent/protected/preserved) with
 * a real evaluable region-relationship/property/measurement subject, and an
 * explicit applicability declaration (viewport + theme). Also writes two
 * real candidate ObservationArtifacts: one whose viewport/theme exactly
 * match applicability (compatible) and one that deliberately mismatches both
 * (incompatible) - both built through the real `writeObservationArtifact`
 * writer. The compatible candidate deliberately also configures a runtime
 * target literally named "header" (same string as the reference region id)
 * to prove Batch 5 never treats equal names as an implied binding.
 */
export async function writeReferenceCandidateFixture(dir: string): Promise<ReferenceCandidateFixture> {
  const referenceImage = { width: 400, height: 300 };
  const imageBytes = buildRealPng(referenceImage.width, referenceImage.height, [16, 120, 90]);

  const regions = [
    { id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } },
    { id: 'sidebar', rectangle: { x: 0, y: 60, width: 120, height: 240 } },
  ];

  const requirements: import('../../src/domain/externalReferenceRequirements.js').RawReferenceRequirement[] = [
    { category: 'requested', subject: { kind: 'region-property', region: 'header', property: 'height' }, tolerance: { kind: 'exact' } },
    {
      category: 'expected-dependent',
      expectedDependentMode: 'required',
      subject: { kind: 'region-relationship', subjectRegion: 'sidebar', relatedRegion: 'header', relationship: 'follows-vertically' },
    },
    { category: 'protected', subject: { kind: 'region-property', region: 'sidebar', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } },
    {
      category: 'preserved',
      subject: { kind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'sidebar', measurement: 'vertical-gap' },
      tolerance: { kind: 'exact' },
    },
  ];

  const imported = await importExternalReference(imageBytes, {
    outputLocation: 'references',
    cwd: dir,
    label: 'candidate-fixture',
    regions,
    requirements,
    applicability: { viewport: { width: 1200, height: 800 }, theme: 'light' },
  });
  if (!imported.ok) throw new Error(`expected reference import to succeed: ${JSON.stringify(imported.diagnostics)}`);

  const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references', cwd: dir });
  if (!approved.ok) throw new Error(`expected reference approval to succeed: ${JSON.stringify(approved.diagnostics)}`);

  const compatibleBase = buildObservation(
    'rc-compatible',
    [target('header'), target('sidebar')],
    { header: matchedTarget(rect(0, 0, 400, 60)), sidebar: matchedTarget(rect(0, 60, 120, 240)) },
    '0.7.0',
    realisticPageEvidence({ width: 1200, height: 800 }),
    { width: 1200, height: 800 },
  );
  const compatibleArtifact: ObservationArtifact = { ...compatibleBase, requestConfig: { ...compatibleBase.requestConfig, explicitState: { theme: 'light' } } };
  const compatibleWritten = await writeObservationArtifact(compatibleArtifact, buildRealPng(1200, 800, [90, 40, 40]), { cwd: dir });
  if (!compatibleWritten.ok) throw new Error('expected compatible candidate write to succeed');

  const incompatibleBase = buildObservation(
    'rc-incompatible',
    [target('header')],
    { header: matchedTarget(rect(0, 0, 320, 60)) },
    '0.7.0',
    realisticPageEvidence({ width: 800, height: 600 }),
    { width: 800, height: 600 },
  );
  const incompatibleArtifact: ObservationArtifact = { ...incompatibleBase, requestConfig: { ...incompatibleBase.requestConfig, explicitState: { theme: 'dark' } } };
  const incompatibleWritten = await writeObservationArtifact(incompatibleArtifact, buildRealPng(800, 600, [40, 40, 90]), { cwd: dir });
  if (!incompatibleWritten.ok) throw new Error('expected incompatible candidate write to succeed');

  return {
    importedRoot: imported.artifactRoot,
    approvedRoot: approved.artifactRoot,
    importedReferenceId: imported.referenceId,
    approvedReferenceId: approved.referenceId,
    referenceImage,
    compatibleCandidateRoot: compatibleWritten.artifactRoot,
    compatibleCandidateId: 'rc-compatible',
    incompatibleCandidateRoot: incompatibleWritten.artifactRoot,
    incompatibleCandidateId: 'rc-incompatible',
  };
}

export interface ReferenceBindingFidelityFixture {
  approvedRoot: string;
  approvedReferenceId: string;
  referenceImage: { width: number; height: number };
  applicableViewport: { width: number; height: number };
  /** header/sidebar candidate geometry exactly matches the reference (scaled) - every requirement genuinely PASSes. */
  passCandidateRoot: string;
  passCandidateId: string;
  /** Same as pass candidate except sidebar.width is deliberately far outside the protected requirement's tolerance - a genuine FAIL. */
  failCandidateRoot: string;
  failCandidateId: string;
  /** Compatible viewport/theme, but only the "sidebar" runtime target is configured at all - "header" bindings resolve `unavailable` (runtime-target-not-configured), never fabricated as bound. */
  bindingUnavailableCandidateRoot: string;
  bindingUnavailableCandidateId: string;
  /** Compatible viewport/theme, "header" target genuinely resolves `ambiguous` (more than one DOM match). */
  bindingAmbiguousCandidateRoot: string;
  bindingAmbiguousCandidateId: string;
}

/**
 * Batch 6: a reference whose applicable viewport (1600x1200) and reference
 * image (400x300) share a genuinely coherent full-frame aspect ratio
 * (scaleX = scaleY = 0.25 exactly) - unlike `writeReferenceCandidateFixture`
 * (Batch 5, deliberately incoherent: 1200x800 vs 400x300), so
 * `deriveCoordinateScale` genuinely succeeds here, enabling real view-lock
 * eligibility and real numeric fidelity comparison. Same two regions
 * ("header"/"sidebar") and the same four requirement categories as the
 * Batch 5 fixture, reused verbatim. Four real candidates, all built through
 * the real `writeObservationArtifact` writer: one whose scaled geometry
 * exactly matches every reference requirement (real PASS), one identical
 * except a deliberately out-of-tolerance sidebar width (real FAIL), one
 * missing the "header" runtime target entirely (real binding
 * `unavailable`), and one whose "header" target genuinely resolves
 * ambiguously (real binding `ambiguous`).
 */
export async function writeReferenceBindingFidelityFixture(dir: string): Promise<ReferenceBindingFidelityFixture> {
  const referenceImage = { width: 400, height: 300 };
  const applicableViewport = { width: 1600, height: 1200 };
  const imageBytes = buildRealPng(referenceImage.width, referenceImage.height, [90, 60, 160]);

  const regions = [
    { id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } },
    { id: 'sidebar', rectangle: { x: 0, y: 60, width: 120, height: 240 } },
  ];

  const requirements: import('../../src/domain/externalReferenceRequirements.js').RawReferenceRequirement[] = [
    { category: 'requested', subject: { kind: 'region-property', region: 'header', property: 'height' }, tolerance: { kind: 'exact' } },
    {
      category: 'expected-dependent',
      expectedDependentMode: 'required',
      subject: { kind: 'region-relationship', subjectRegion: 'sidebar', relatedRegion: 'header', relationship: 'follows-vertically' },
    },
    { category: 'protected', subject: { kind: 'region-property', region: 'sidebar', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } },
    {
      category: 'preserved',
      subject: { kind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'sidebar', measurement: 'vertical-gap' },
      tolerance: { kind: 'exact' },
    },
  ];

  const imported = await importExternalReference(imageBytes, {
    outputLocation: 'references',
    cwd: dir,
    label: 'binding-fidelity-fixture',
    regions,
    requirements,
    applicability: { viewport: applicableViewport, theme: 'light' },
  });
  if (!imported.ok) throw new Error(`expected reference import to succeed: ${JSON.stringify(imported.diagnostics)}`);
  const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references', cwd: dir });
  if (!approved.ok) throw new Error(`expected reference approval to succeed: ${JSON.stringify(approved.diagnostics)}`);

  // scaleX = scaleY = 400/1600 = 300/1200 = 0.25 - candidate CSS px * 0.25 = reference-image px.
  // header candidate rect (0,0,1600,240) -> scaled (0,0,400,60): matches reference header exactly (height requirement: 60).
  // sidebar candidate rect (0,240,480,960) -> scaled (0,60,120,240): matches reference sidebar exactly (width requirement: 120; vertical-gap(header,sidebar): 60-60=0).
  const passArtifact: ObservationArtifact = {
    ...buildObservation(
      'rc-fidelity-pass',
      [target('header'), target('sidebar')],
      { header: matchedTarget(rect(0, 0, 1600, 240)), sidebar: matchedTarget(rect(0, 240, 480, 960)) },
      '0.7.0',
      realisticPageEvidence(applicableViewport),
      applicableViewport,
    ),
  };
  const passWithState: ObservationArtifact = { ...passArtifact, requestConfig: { ...passArtifact.requestConfig, explicitState: { theme: 'light' } } };
  const passWritten = await writeObservationArtifact(passWithState, buildRealPng(applicableViewport.width, applicableViewport.height, [10, 200, 10]), { cwd: dir });
  if (!passWritten.ok) throw new Error('expected pass candidate write to succeed');

  // Identical except sidebar.width = 600 CSS px -> scaled 150 reference px, vs reference 120 +/-4 tolerance: delta=30, far outside tolerance -> genuine FAIL.
  const failArtifact: ObservationArtifact = {
    ...buildObservation(
      'rc-fidelity-fail',
      [target('header'), target('sidebar')],
      { header: matchedTarget(rect(0, 0, 1600, 240)), sidebar: matchedTarget(rect(0, 240, 600, 960)) },
      '0.7.0',
      realisticPageEvidence(applicableViewport),
      applicableViewport,
    ),
  };
  const failWithState: ObservationArtifact = { ...failArtifact, requestConfig: { ...failArtifact.requestConfig, explicitState: { theme: 'light' } } };
  const failWritten = await writeObservationArtifact(failWithState, buildRealPng(applicableViewport.width, applicableViewport.height, [200, 10, 10]), { cwd: dir });
  if (!failWritten.ok) throw new Error('expected fail candidate write to succeed');

  // Only "sidebar" is configured at all - a declared "header" binding resolves runtime-target-not-configured, never fabricated as bound.
  const bindingUnavailableArtifact: ObservationArtifact = {
    ...buildObservation('rc-binding-unavailable', [target('sidebar')], { sidebar: matchedTarget(rect(0, 240, 480, 960)) }, '0.7.0', realisticPageEvidence(applicableViewport), applicableViewport),
  };
  const bindingUnavailableWithState: ObservationArtifact = { ...bindingUnavailableArtifact, requestConfig: { ...bindingUnavailableArtifact.requestConfig, explicitState: { theme: 'light' } } };
  const bindingUnavailableWritten = await writeObservationArtifact(bindingUnavailableWithState, buildRealPng(applicableViewport.width, applicableViewport.height, [120, 120, 10]), { cwd: dir });
  if (!bindingUnavailableWritten.ok) throw new Error('expected binding-unavailable candidate write to succeed');

  // "header" configured but resolves genuinely ambiguous.
  const bindingAmbiguousArtifact: ObservationArtifact = {
    ...buildObservation(
      'rc-binding-ambiguous',
      [target('header'), target('sidebar')],
      { header: unresolvedTarget('ambiguous'), sidebar: matchedTarget(rect(0, 240, 480, 960)) },
      '0.7.0',
      realisticPageEvidence(applicableViewport),
      applicableViewport,
    ),
  };
  const bindingAmbiguousWithState: ObservationArtifact = { ...bindingAmbiguousArtifact, requestConfig: { ...bindingAmbiguousArtifact.requestConfig, explicitState: { theme: 'light' } } };
  const bindingAmbiguousWritten = await writeObservationArtifact(bindingAmbiguousWithState, buildRealPng(applicableViewport.width, applicableViewport.height, [10, 120, 120]), { cwd: dir });
  if (!bindingAmbiguousWritten.ok) throw new Error('expected binding-ambiguous candidate write to succeed');

  return {
    approvedRoot: approved.artifactRoot,
    approvedReferenceId: approved.referenceId,
    referenceImage,
    applicableViewport,
    passCandidateRoot: passWritten.artifactRoot,
    passCandidateId: 'rc-fidelity-pass',
    failCandidateRoot: failWritten.artifactRoot,
    failCandidateId: 'rc-fidelity-fail',
    bindingUnavailableCandidateRoot: bindingUnavailableWritten.artifactRoot,
    bindingUnavailableCandidateId: 'rc-binding-unavailable',
    bindingAmbiguousCandidateRoot: bindingAmbiguousWritten.artifactRoot,
    bindingAmbiguousCandidateId: 'rc-binding-ambiguous',
  };
}

export interface ReferenceFidelityContractFixture {
  approvedRoot: string;
  candidateRoot: string;
  candidateId: string;
  evaluationRoot: string;
}

/**
 * Batch 6 Case J proof fixture: a reference/candidate pair whose fidelity
 * genuinely PASSes (identical geometry/scale reasoning to
 * `writeReferenceBindingFidelityFixture`'s pass candidate) AND a real,
 * separately-built contract-evaluation pipeline (comparison + baseline +
 * per-change contract + evaluation, all through the real canonical
 * `compareObservations`/`evaluateAndPersistFromArtifactRoots`) whose own
 * `after` observation reference is this EXACT candidate - producing a
 * genuine `overallVerdict: "FAIL"` (a protected clause is deliberately
 * violated) alongside the genuine fidelity PASS, so the viewer's
 * independence claim (task §48) is proven against two real, independently
 * arrived-at evidence dimensions - never two hand-authored "PASS" and
 * "FAIL" labels asserted directly.
 */
export async function writeReferenceFidelityContractFixture(dir: string): Promise<ReferenceFidelityContractFixture> {
  const referenceImage = { width: 400, height: 300 };
  const applicableViewport = { width: 1600, height: 1200 };
  const imageBytes = buildRealPng(referenceImage.width, referenceImage.height, [200, 150, 20]);

  const regions = [
    { id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } },
    { id: 'sidebar', rectangle: { x: 0, y: 60, width: 120, height: 240 } },
  ];
  const requirements: import('../../src/domain/externalReferenceRequirements.js').RawReferenceRequirement[] = [
    { category: 'requested', subject: { kind: 'region-property', region: 'header', property: 'height' }, tolerance: { kind: 'exact' } },
    { category: 'protected', subject: { kind: 'region-property', region: 'sidebar', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } },
  ];

  const imported = await importExternalReference(imageBytes, { outputLocation: 'references', cwd: dir, label: 'fidelity-contract-fixture', regions, requirements, applicability: { viewport: applicableViewport, theme: 'light' } });
  if (!imported.ok) throw new Error(`expected reference import to succeed: ${JSON.stringify(imported.diagnostics)}`);
  const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references', cwd: dir });
  if (!approved.ok) throw new Error(`expected reference approval to succeed: ${JSON.stringify(approved.diagnostics)}`);

  // before: header height 300, sidebar y 300 (width 480, matching after's width so the protected clause's own subject genuinely differs only in y - not used by the reference requirement).
  const before = buildObservation(
    'rfc-before',
    [target('header'), target('sidebar')],
    { header: matchedTarget(rect(0, 0, 1600, 300)), sidebar: matchedTarget(rect(0, 300, 480, 960)) },
    '0.7.0',
    realisticPageEvidence(applicableViewport),
    applicableViewport,
  );
  // after: identical geometry to writeReferenceBindingFidelityFixture's real PASS candidate - scaled (x0.25) exactly matches every reference requirement.
  const afterBase = buildObservation(
    'rfc-after',
    [target('header'), target('sidebar')],
    { header: matchedTarget(rect(0, 0, 1600, 240)), sidebar: matchedTarget(rect(0, 240, 480, 960)) },
    '0.7.0',
    realisticPageEvidence(applicableViewport),
    applicableViewport,
  );
  const after: ObservationArtifact = { ...afterBase, requestConfig: { ...afterBase.requestConfig, explicitState: { theme: 'light' } } };

  const beforeWritten = await writeObservationArtifact(before, buildRealPng(applicableViewport.width, applicableViewport.height, [80, 80, 200]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, buildRealPng(applicableViewport.width, applicableViewport.height, [10, 200, 10]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected before/after observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  const baseline = buildBaselineContract({ sourceObservation: { observationId: 'rfc-before', requestId: 'req-rfc-before', producer: { name: PRODUCER_NAME, version: '0.7.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION } });
  const change = buildChangeContract({
    clauses: [
      { clauseId: 'requested-header-height', primitive: { kind: 'property-decreases', target: 'header', property: 'height' }, category: 'requested', supportingEvidence: [] },
      { clauseId: 'protected-sidebar-y', primitive: { kind: 'property-unchanged-within-tolerance', target: 'sidebar', property: 'y', tolerance: { kind: 'exact' } }, category: 'protected', supportingEvidence: [] },
    ],
  });
  const baselineWritten = await writePersistentBaselineContract(baseline, 'baselines', { cwd: dir });
  const changeWritten = await writePerChangeContract(change, 'contracts', { cwd: dir });
  if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

  const evaluated = await evaluateAndPersistFromArtifactRoots(beforeWritten.artifactRoot, afterWritten.artifactRoot, comparisonWritten.artifactRoot, baselineWritten.artifactRoot, changeWritten.artifactRoot, {
    outputLocation: 'evaluations',
    cwd: dir,
  });
  if (!evaluated.ok) throw new Error('expected evaluation to succeed');
  if (evaluated.overallVerdict !== 'FAIL') throw new Error(`expected a genuine contract FAIL, got ${evaluated.overallVerdict}`);

  return { approvedRoot: approved.artifactRoot, candidateRoot: afterWritten.artifactRoot, candidateId: 'rfc-after', evaluationRoot: evaluated.artifactRoot };
}

// ---------------------------------------------------------------------------
// Batch 7: bounded-agent-context fixtures. Because BoundedAgentContextArtifact
// remains programmatic-only (task §11/§64), positive contexts are always
// built by calling the real canonical `projectBoundedAgentContext`/
// `deriveRuntimeStaticCorrelations`/`attachRuntimeStaticCorrelations` over
// real, persisted Observer evidence built through the existing writers -
// never hand-authored. Only deliberately negative/malformed fixtures
// (wrong kind, unsupported version, structurally invalid) are hand-authored.
// ---------------------------------------------------------------------------

export interface BoundedContextEvidenceFixture {
  root: string;
  beforeRoot: string;
  afterRoot: string;
  comparisonRoot: string;
  baselineRoot: string;
  changeRoot: string;
  evaluationRoot: string;
  approvedReferenceRoot: string;
  fidelityFailCandidateRoot: string;
  fidelityBlockedCandidateRoot: string;
  before: ObservationArtifact;
  after: ObservationArtifact;
  fidelityFailCandidate: ObservationArtifact;
  fidelityBlockedCandidate: ObservationArtifact;
  staticProducer: StaticEvidenceProducerIdentity;
  /** Base context (no correlations, fidelity = real PASS for `after`) - the shared starting point every other named context variant below is derived from via `attachRuntimeStaticCorrelations`, never by hand-editing fields. */
  baseContext: BoundedAgentContextArtifact;
  correlatedContext: BoundedAgentContextArtifact;
  ambiguousContext: BoundedAgentContextArtifact;
  unavailableContext: BoundedAgentContextArtifact;
  requiredOmissionContext: BoundedAgentContextArtifact;
  requiredTruncationContext: BoundedAgentContextArtifact;
  fidelityMismatchContext: BoundedAgentContextArtifact;
  blockedFidelityContext: BoundedAgentContextArtifact;
}

/**
 * The one comprehensive Batch 7 evidence+context fixture: real before/after
 * observations, a real comparison, a real baseline+per-change contract pair
 * producing a genuine `overallVerdict: "FAIL"` evaluation (a protected
 * clause is deliberately violated - mirrors `writeReferenceFidelityContractFixture`'s
 * exact geometry, task §54's historical-vs-live independence test needs a
 * real non-trivial evaluation), a real approved external reference whose
 * requirements the `after` observation genuinely satisfies (real fidelity
 * PASS), a real fidelity-FAIL candidate and a real blocked (incompatible)
 * candidate, and several named `BoundedAgentContextArtifact` variants - all
 * derived from one shared `baseContext` (itself built by the real
 * `projectBoundedAgentContext`) via the real `deriveRuntimeStaticCorrelations`/
 * `attachRuntimeStaticCorrelations` or distinct `projectBoundedAgentContext`
 * calls, never hand-edited.
 */
export async function writeBoundedContextEvidenceFixture(dir: string): Promise<BoundedContextEvidenceFixture> {
  const applicableViewport = { width: 1600, height: 1200 };

  const before = buildObservation(
    'ctx-before',
    [target('header'), target('sidebar')],
    { header: matchedTarget(rect(0, 0, 1600, 300)), sidebar: matchedTarget(rect(0, 300, 480, 960)) },
    '0.7.0',
    realisticPageEvidence(applicableViewport),
    applicableViewport,
  );
  const afterBase = buildObservation(
    'ctx-after',
    [target('header'), target('sidebar')],
    { header: matchedTarget(rect(0, 0, 1600, 240)), sidebar: matchedTarget(rect(0, 240, 480, 960)) },
    '0.7.0',
    realisticPageEvidence(applicableViewport),
    applicableViewport,
  );
  const after: ObservationArtifact = { ...afterBase, requestConfig: { ...afterBase.requestConfig, explicitState: { theme: 'light' } } };

  const beforeWritten = await writeObservationArtifact(before, buildRealPng(applicableViewport.width, applicableViewport.height, [80, 80, 200]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, buildRealPng(applicableViewport.width, applicableViewport.height, [10, 200, 10]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected before/after observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  // The main pipeline's baseline is deliberately minimal (no clauses) so the resulting projected context is
  // genuinely 'adequate' - a real required-evidence-loss/truncation demonstration uses a SEPARATE baseline
  // (below, never attached to the persisted contract-evaluation pipeline) so it does not silently make every
  // other context variant derived from `baseContext` non-adequate too.
  const baseline = buildBaselineContract({
    sourceObservation: { observationId: 'ctx-before', requestId: 'req-ctx-before', producer: { name: PRODUCER_NAME, version: '0.7.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
    clauses: [],
  });
  const change = buildChangeContract({
    clauses: [
      { clauseId: 'requested-header-height', primitive: { kind: 'property-decreases', target: 'header', property: 'height' }, category: 'requested', supportingEvidence: [] },
      { clauseId: 'protected-sidebar-y', primitive: { kind: 'property-unchanged-within-tolerance', target: 'sidebar', property: 'y', tolerance: { kind: 'exact' } }, category: 'protected', supportingEvidence: [] },
    ],
  });
  const baselineWritten = await writePersistentBaselineContract(baseline, 'baselines', { cwd: dir });
  const changeWritten = await writePerChangeContract(change, 'contracts', { cwd: dir });
  if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

  const evaluated = await evaluateAndPersistFromArtifactRoots(beforeWritten.artifactRoot, afterWritten.artifactRoot, comparisonWritten.artifactRoot, baselineWritten.artifactRoot, changeWritten.artifactRoot, {
    outputLocation: 'evaluations',
    cwd: dir,
  });
  if (!evaluated.ok) throw new Error(`expected evaluation to succeed: ${JSON.stringify(evaluated.diagnostics)}`);
  if (evaluated.overallVerdict !== 'FAIL') throw new Error(`expected a genuine contract FAIL, got ${evaluated.overallVerdict}`);
  const evaluationRead = await readFrontendContractEvaluationArtifact(path.join(evaluated.artifactRoot, EVALUATION_MANIFEST_FILENAME));
  if (!evaluationRead.ok) throw new Error(`expected to read back the evaluation artifact: ${evaluationRead.reason}`);
  const evaluationArtifact = evaluationRead.artifact;

  // Real reference whose requirements the "after" observation genuinely satisfies (real fidelity PASS) -
  // same coherent-aspect-ratio (400x300 image, 1600x1200 applicability viewport, scale 0.25) and requirement
  // shape already proven in writeReferenceBindingFidelityFixture/writeReferenceFidelityContractFixture.
  const referenceImage = { width: 400, height: 300 };
  const imageBytes = buildRealPng(referenceImage.width, referenceImage.height, [90, 60, 160]);
  const regions = [
    { id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } },
    { id: 'sidebar', rectangle: { x: 0, y: 60, width: 120, height: 240 } },
  ];
  const requirements: import('../../src/domain/externalReferenceRequirements.js').RawReferenceRequirement[] = [
    { category: 'requested', subject: { kind: 'region-property', region: 'header', property: 'height' }, tolerance: { kind: 'exact' } },
    { category: 'protected', subject: { kind: 'region-property', region: 'sidebar', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } },
  ];
  const imported = await importExternalReference(imageBytes, { outputLocation: 'references', cwd: dir, label: 'context-fixture', regions, requirements, applicability: { viewport: applicableViewport, theme: 'light' } });
  if (!imported.ok) throw new Error(`expected reference import to succeed: ${JSON.stringify(imported.diagnostics)}`);
  const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references', cwd: dir });
  if (!approved.ok) throw new Error(`expected reference approval to succeed: ${JSON.stringify(approved.diagnostics)}`);

  // Read the real persisted approved reference back through the existing canonical reader (never re-derived
  // or hand-reconstructed) - the fidelity evaluator needs the actual ExternalReferenceArtifact value.
  const approvedRead = await readExternalReferenceArtifact(path.join(approved.artifactRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME));
  if (!approvedRead.ok) throw new Error(`expected to read back the approved reference: ${approvedRead.reason}`);
  const approvedArtifact = approvedRead.artifact as ApprovedExternalReferenceArtifact;

  const bindingDeclarations = [
    { referenceRegion: 'header', runtimeTarget: 'header' },
    { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
  ];

  const passFidelityResult = evaluateReferenceCandidateFidelity(approvedArtifact, after, bindingDeclarations);
  if (!passFidelityResult.ok) throw new Error(`expected fidelity evaluation to succeed: ${passFidelityResult.reason}`);
  if (passFidelityResult.evaluation.state !== 'pass') throw new Error(`expected a genuine fidelity PASS for "after", got ${passFidelityResult.evaluation.state}`);
  const passFidelity: ReferenceCandidateFidelityEvaluation = passFidelityResult.evaluation;

  // A second candidate whose sidebar.width is deliberately far outside the protected requirement's tolerance - a genuine fidelity FAIL.
  const fidelityFailCandidateBase = buildObservation(
    'ctx-fidelity-fail',
    [target('header'), target('sidebar')],
    { header: matchedTarget(rect(0, 0, 1600, 240)), sidebar: matchedTarget(rect(0, 240, 600, 960)) },
    '0.7.0',
    realisticPageEvidence(applicableViewport),
    applicableViewport,
  );
  const fidelityFailCandidate: ObservationArtifact = { ...fidelityFailCandidateBase, requestConfig: { ...fidelityFailCandidateBase.requestConfig, explicitState: { theme: 'light' } } };
  const fidelityFailWritten = await writeObservationArtifact(fidelityFailCandidate, buildRealPng(applicableViewport.width, applicableViewport.height, [200, 10, 10]), { cwd: dir });
  if (!fidelityFailWritten.ok) throw new Error('expected fidelity-fail candidate write to succeed');
  const failFidelityResult = evaluateReferenceCandidateFidelity(approvedArtifact, fidelityFailCandidate, bindingDeclarations);
  if (!failFidelityResult.ok) throw new Error(`expected fidelity evaluation to succeed: ${failFidelityResult.reason}`);
  if (failFidelityResult.evaluation.state !== 'fail') throw new Error(`expected a genuine fidelity FAIL, got ${failFidelityResult.evaluation.state}`);

  // A third candidate whose viewport/theme are deliberately incompatible - a genuine blocked (not-evaluated) fidelity result.
  const fidelityBlockedCandidateBase = buildObservation(
    'ctx-fidelity-blocked',
    [target('header')],
    { header: matchedTarget(rect(0, 0, 320, 60)) },
    '0.7.0',
    realisticPageEvidence({ width: 800, height: 600 }),
    { width: 800, height: 600 },
  );
  const fidelityBlockedCandidate: ObservationArtifact = { ...fidelityBlockedCandidateBase, requestConfig: { ...fidelityBlockedCandidateBase.requestConfig, explicitState: { theme: 'dark' } } };
  const fidelityBlockedWritten = await writeObservationArtifact(fidelityBlockedCandidate, buildRealPng(800, 600, [40, 40, 90]), { cwd: dir });
  if (!fidelityBlockedWritten.ok) throw new Error('expected fidelity-blocked candidate write to succeed');
  const blockedFidelityResult = evaluateReferenceCandidateFidelity(approvedArtifact, fidelityBlockedCandidate, bindingDeclarations);
  if (!blockedFidelityResult.ok) throw new Error(`expected fidelity evaluation to succeed: ${blockedFidelityResult.reason}`);
  if (blockedFidelityResult.evaluation.state !== 'not-evaluated' || blockedFidelityResult.evaluation.blockedBy !== 'incompatible') {
    throw new Error(`expected a genuine blocked (incompatible) fidelity result, got ${JSON.stringify(blockedFidelityResult.evaluation)}`);
  }
  const blockedFidelity: ReferenceCandidateFidelityEvaluation = blockedFidelityResult.evaluation;
  const failFidelity: ReferenceCandidateFidelityEvaluation = failFidelityResult.evaluation;

  const staticProducer: StaticEvidenceProducerIdentity = { name: '@dailephd/my-dev-kit', version: '0.0.0-fixture', indexId: 'fixture-index-1' };
  const correlatedAt = '2026-08-13T00:00:00.000Z';

  function candidate(id: string): StaticCandidateEvidenceInput {
    return { candidateId: id, kind: 'symbol', evidenceRefs: [{ path: `symbol-evidence:${id}` }] };
  }

  async function buildContext(
    fidelity: ReferenceCandidateFidelityEvaluation | undefined,
    focusTargetIds: readonly string[],
    observation: ObservationArtifact,
    includeContractPipeline: boolean,
  ): Promise<BoundedAgentContextArtifact> {
    const result = projectBoundedAgentContext({
      generatedAt: correlatedAt,
      producerVersion: '0.7.0',
      projectionProfile: 'frontend-change-review',
      focusTargetIds,
      observation,
      ...(includeContractPipeline ? { baselineObservation: before, comparison: compared.artifact, baseline, change, evaluationArtifact } : {}),
      ...(fidelity !== undefined ? { fidelity } : {}),
    });
    if (!result.ok) throw new Error(`expected projectBoundedAgentContext to succeed: ${result.reason}`);
    return result.artifact;
  }

  const baseContext = await buildContext(passFidelity, ['header', 'sidebar'], after, true);

  async function withCorrelation(base: BoundedAgentContextArtifact, candidates: StaticCandidateEvidenceInput[]): Promise<BoundedAgentContextArtifact> {
    const derived = deriveRuntimeStaticCorrelations({
      staticProducer,
      correlatedAt,
      targets: [{ runtimeTargetId: 'header', required: true, runtimeEvidenceRefs: [{ path: 'targetEvidence.header.geometry' }], candidates, evidenceBasis: 'geometry + name proximity evidence supplied by static retrieval' }],
    });
    if (!derived.ok) throw new Error(`expected deriveRuntimeStaticCorrelations to succeed: ${derived.reason}`);
    const attached = attachRuntimeStaticCorrelations(base, derived);
    if (!attached.ok) throw new Error(`expected attachRuntimeStaticCorrelations to succeed: ${attached.reason}`);
    return attached.artifact;
  }

  const correlatedContext = await withCorrelation(baseContext, [candidate('symbol:src/components/Header.tsx#Header')]);
  const ambiguousContext = await withCorrelation(baseContext, [candidate('symbol:src/components/Header.tsx#Header'), candidate('symbol:src/legacy/OldHeader.tsx#OldHeader')]);
  const unavailableContext = await withCorrelation(baseContext, []);

  // Required omission: focus an explicit target id that the observation never configured at all -
  // projectBoundedAgentContext honestly reports it as an unavailable required target, never a fabricated geometry.
  const requiredOmissionContext = await buildContext(passFidelity, ['header', 'sidebar', 'nonexistent-target'], after, true);

  // Required truncation: a dedicated baseline with 11 clauses on "header", each contributing one distinct
  // supportingEvidence path, forces a genuine relationshipEvidence truncation (MAX_RELATIONSHIP_EVIDENCE_PER_TARGET
  // = 10) - built as its own, separate projectBoundedAgentContext call (no comparison/change/evaluation/fidelity)
  // so it never affects `baseContext`'s own genuine adequacy.
  const truncationBaselineClauses = Array.from({ length: 11 }, (_, i) => ({
    clauseId: `evidence-clause-${i}`,
    primitive: { kind: 'target-visible' as const, target: 'header' },
    supportingEvidence: [{ path: `evidence-ref-${i}` }],
  }));
  const truncationBaseline = buildBaselineContract({
    sourceObservation: { observationId: 'ctx-before', requestId: 'req-ctx-before', producer: { name: PRODUCER_NAME, version: '0.7.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
    clauses: truncationBaselineClauses,
  });
  const requiredTruncationResult = projectBoundedAgentContext({
    generatedAt: correlatedAt,
    producerVersion: '0.7.0',
    projectionProfile: 'frontend-change-review',
    focusTargetIds: ['header', 'sidebar'],
    observation: after,
    baselineObservation: before,
    baseline: truncationBaseline,
  });
  if (!requiredTruncationResult.ok) throw new Error(`expected projectBoundedAgentContext to succeed: ${requiredTruncationResult.reason}`);
  const requiredTruncationContext = requiredTruncationResult.artifact;

  // Fidelity-focused contexts intentionally omit the contract pipeline (comparison/baseline/change/evaluation are
  // all built against "after" specifically, not these separate fidelity-only candidates - see task §54's
  // historical/live independence: a context need not always carry every optional source).
  const fidelityMismatchContext = await buildContext(failFidelity, ['header', 'sidebar'], fidelityFailCandidate, false);
  const blockedFidelityContext = await buildContext(blockedFidelity, ['header'], fidelityBlockedCandidate, false);

  return {
    root: dir,
    beforeRoot: beforeWritten.artifactRoot,
    afterRoot: afterWritten.artifactRoot,
    comparisonRoot: comparisonWritten.artifactRoot,
    baselineRoot: baselineWritten.artifactRoot,
    changeRoot: changeWritten.artifactRoot,
    evaluationRoot: evaluated.artifactRoot,
    approvedReferenceRoot: approved.artifactRoot,
    fidelityFailCandidateRoot: fidelityFailWritten.artifactRoot,
    fidelityBlockedCandidateRoot: fidelityBlockedWritten.artifactRoot,
    before,
    after,
    fidelityFailCandidate,
    fidelityBlockedCandidate,
    staticProducer,
    baseContext,
    correlatedContext,
    ambiguousContext,
    unavailableContext,
    requiredOmissionContext,
    requiredTruncationContext,
    fidelityMismatchContext,
    blockedFidelityContext,
  };
}

// ---------------------------------------------------------------------------
// Batch 8: gap-closing integration fixtures (many-regions-to-one-target
// cross-selection; fidelity FAIL alongside a genuine contract PASS for the
// exact same candidate). All evidence is built through the real canonical
// writers/services, never hand-edited.
// ---------------------------------------------------------------------------

export interface ManyRegionsOneTargetFixture {
  approvedRoot: string;
  candidateRoot: string;
  candidateId: string;
}

/**
 * Batch 8 task §24/L: two distinct reference regions ("region-a"/"region-b")
 * that, once explicitly bound, both resolve `bound` against the SAME
 * runtime target ("workspace") - closing the Batch 6 many-regions-to-one-
 * target real-browser coverage gap.
 */
export async function writeManyRegionsOneTargetFixture(dir: string): Promise<ManyRegionsOneTargetFixture> {
  const applicableViewport = { width: 1200, height: 800 };
  const imageBytes = buildRealPng(400, 300, [60, 120, 200]);
  const regions = [
    { id: 'region-a', rectangle: { x: 0, y: 0, width: 400, height: 150 } },
    { id: 'region-b', rectangle: { x: 0, y: 150, width: 400, height: 150 } },
  ];
  const imported = await importExternalReference(imageBytes, { outputLocation: 'references', cwd: dir, label: 'many-regions-fixture', regions, applicability: { viewport: applicableViewport, theme: 'light' } });
  if (!imported.ok) throw new Error(`expected reference import to succeed: ${JSON.stringify(imported.diagnostics)}`);
  const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references', cwd: dir });
  if (!approved.ok) throw new Error(`expected reference approval to succeed: ${JSON.stringify(approved.diagnostics)}`);

  const candidateBase = buildObservation('many-regions-candidate', [target('workspace')], { workspace: matchedTarget(rect(0, 0, 1200, 800)) }, '0.7.0', realisticPageEvidence(applicableViewport), applicableViewport);
  const candidate: ObservationArtifact = { ...candidateBase, requestConfig: { ...candidateBase.requestConfig, explicitState: { theme: 'light' } } };
  const candidateWritten = await writeObservationArtifact(candidate, buildRealPng(applicableViewport.width, applicableViewport.height, [200, 200, 10]), { cwd: dir });
  if (!candidateWritten.ok) throw new Error('expected many-regions candidate write to succeed');

  return { approvedRoot: approved.artifactRoot, candidateRoot: candidateWritten.artifactRoot, candidateId: 'many-regions-candidate' };
}

export interface FidelityFailContractPassFixture {
  beforeRoot: string;
  afterRoot: string;
  comparisonRoot: string;
  baselineRoot: string;
  changeRoot: string;
  evaluationRoot: string;
  approvedReferenceRoot: string;
  candidateId: string;
}

/**
 * Batch 8 task §25/M: a real contract-evaluation PASS (both clauses
 * genuinely satisfied) alongside a real reference-fidelity FAIL (the
 * protected sidebar.width requirement is violated in reference terms) for
 * the exact same candidate observation - closing the Batch 6 asymmetric
 * real-browser coverage gap (only fidelity-PASS+contract-FAIL was
 * previously proven).
 */
export async function writeFidelityFailContractPassFixture(dir: string): Promise<FidelityFailContractPassFixture> {
  const applicableViewport = { width: 1600, height: 1200 };

  // sidebar.width stays 600 CSS px in both before/after (contract's "unchanged" protected clause genuinely
  // passes), but 600 CSS px scales (x0.25) to 150 reference px - outside the reference's 120±4 tolerance
  // (reference fidelity genuinely fails). header.height genuinely decreases (contract requested clause passes)
  // and exactly matches the reference's 60 reference px requirement (that one fidelity requirement passes).
  const before = buildObservation(
    'ffcp-before',
    [target('header'), target('sidebar')],
    { header: matchedTarget(rect(0, 0, 1600, 300)), sidebar: matchedTarget(rect(0, 300, 600, 960)) },
    '0.7.0',
    realisticPageEvidence(applicableViewport),
    applicableViewport,
  );
  const afterBase = buildObservation(
    'ffcp-after',
    [target('header'), target('sidebar')],
    { header: matchedTarget(rect(0, 0, 1600, 240)), sidebar: matchedTarget(rect(0, 300, 600, 960)) },
    '0.7.0',
    realisticPageEvidence(applicableViewport),
    applicableViewport,
  );
  const after: ObservationArtifact = { ...afterBase, requestConfig: { ...afterBase.requestConfig, explicitState: { theme: 'light' } } };

  const beforeWritten = await writeObservationArtifact(before, buildRealPng(applicableViewport.width, applicableViewport.height, [80, 80, 200]), { cwd: dir });
  const afterWritten = await writeObservationArtifact(after, buildRealPng(applicableViewport.width, applicableViewport.height, [10, 200, 10]), { cwd: dir });
  if (!beforeWritten.ok || !afterWritten.ok) throw new Error('expected before/after observation writes to succeed');

  const compared = compareObservations(before, after);
  if (!compared.ok) throw new Error(`expected ok comparison: ${compared.reason}`);
  const comparisonWritten = await writeComparisonArtifact(compared.artifact, 'comparisons', { cwd: dir });
  if (!comparisonWritten.ok) throw new Error('expected comparison write to succeed');

  const baseline = buildBaselineContract({
    sourceObservation: { observationId: 'ffcp-before', requestId: 'req-ffcp-before', producer: { name: PRODUCER_NAME, version: '0.7.0' }, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION },
    clauses: [],
  });
  const change = buildChangeContract({
    clauses: [
      { clauseId: 'requested-header-height', primitive: { kind: 'property-decreases', target: 'header', property: 'height' }, category: 'requested', supportingEvidence: [] },
      { clauseId: 'protected-sidebar-width', primitive: { kind: 'property-unchanged-within-tolerance', target: 'sidebar', property: 'width', tolerance: { kind: 'exact' } }, category: 'protected', supportingEvidence: [] },
    ],
  });
  const baselineWritten = await writePersistentBaselineContract(baseline, 'baselines', { cwd: dir });
  const changeWritten = await writePerChangeContract(change, 'contracts', { cwd: dir });
  if (!baselineWritten.ok || !changeWritten.ok) throw new Error('expected contract writes to succeed');

  const evaluated = await evaluateAndPersistFromArtifactRoots(beforeWritten.artifactRoot, afterWritten.artifactRoot, comparisonWritten.artifactRoot, baselineWritten.artifactRoot, changeWritten.artifactRoot, {
    outputLocation: 'evaluations',
    cwd: dir,
  });
  if (!evaluated.ok) throw new Error(`expected evaluation to succeed: ${JSON.stringify(evaluated.diagnostics)}`);
  if (evaluated.overallVerdict !== 'PASS') throw new Error(`expected a genuine contract PASS, got ${evaluated.overallVerdict}`);

  const referenceImage = { width: 400, height: 300 };
  const imageBytes = buildRealPng(referenceImage.width, referenceImage.height, [200, 90, 60]);
  const regions = [
    { id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } },
    { id: 'sidebar', rectangle: { x: 0, y: 60, width: 120, height: 240 } },
  ];
  const requirements: import('../../src/domain/externalReferenceRequirements.js').RawReferenceRequirement[] = [
    { category: 'requested', subject: { kind: 'region-property', region: 'header', property: 'height' }, tolerance: { kind: 'exact' } },
    { category: 'protected', subject: { kind: 'region-property', region: 'sidebar', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } },
  ];
  const imported = await importExternalReference(imageBytes, { outputLocation: 'references', cwd: dir, label: 'fidelity-fail-contract-pass', regions, requirements, applicability: { viewport: applicableViewport, theme: 'light' } });
  if (!imported.ok) throw new Error(`expected reference import to succeed: ${JSON.stringify(imported.diagnostics)}`);
  const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references', cwd: dir });
  if (!approved.ok) throw new Error(`expected reference approval to succeed: ${JSON.stringify(approved.diagnostics)}`);

  const approvedRead = await readExternalReferenceArtifact(path.join(approved.artifactRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME));
  if (!approvedRead.ok) throw new Error(`expected to read back the approved reference: ${approvedRead.reason}`);
  const fidelityResult = evaluateReferenceCandidateFidelity(approvedRead.artifact as ApprovedExternalReferenceArtifact, after, [
    { referenceRegion: 'header', runtimeTarget: 'header' },
    { referenceRegion: 'sidebar', runtimeTarget: 'sidebar' },
  ]);
  if (!fidelityResult.ok) throw new Error(`expected fidelity evaluation to succeed: ${fidelityResult.reason}`);
  if (fidelityResult.evaluation.state !== 'fail') throw new Error(`expected a genuine fidelity FAIL, got ${fidelityResult.evaluation.state}`);

  return {
    beforeRoot: beforeWritten.artifactRoot,
    afterRoot: afterWritten.artifactRoot,
    comparisonRoot: comparisonWritten.artifactRoot,
    baselineRoot: baselineWritten.artifactRoot,
    changeRoot: changeWritten.artifactRoot,
    evaluationRoot: evaluated.artifactRoot,
    approvedReferenceRoot: approved.artifactRoot,
    candidateId: 'ffcp-after',
  };
}
