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
