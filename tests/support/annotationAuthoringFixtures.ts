/**
 * v0.9 Batch 2 shared fixtures for viewer annotation evidence and authoring
 * tests. Evidence is always built through the real canonical writers and
 * application services (never hand-forged "valid" JSON), and raw HTTP
 * requests go through node:http so tests control Host, Origin, and body
 * framing exactly.
 */
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import type { ExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import type { VisualAnnotationItem, VisualAnnotationSource } from '../../src/domain/visualAnnotation.js';
import { persistVisualAnnotation } from '../../src/application/visualAnnotationPersistenceService.js';
import { initializeFrontendObserverProject } from '../../src/application/projectWorkflowService.js';
import { projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';
import { startViewer } from '../../src/viewerServer/viewerService.js';
import type { StartViewerOptions, StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeExternalReferencePairFixture, writeRichObservationFixture } from './evidenceFixtures.js';

export type RunningViewer = Extract<StartViewerResult, { ok: true }>;

export class TestResources {
  private readonly dirs: string[] = [];
  private readonly closers: (() => Promise<void>)[] = [];

  async tempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), prefix));
    this.dirs.push(dir);
    return dir;
  }

  async assetsRoot(): Promise<string> {
    const dir = await this.tempDir('mfo-annotation-assets-');
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>fixture shell</title>');
    return dir;
  }

  async startViewer(options: Omit<StartViewerOptions, 'assetsRoot' | 'port'>): Promise<RunningViewer> {
    const result = await startViewer({ ...options, port: 0, assetsRoot: await this.assetsRoot() });
    if (!result.ok) throw new Error(`expected viewer to start: ${JSON.stringify(result.diagnostics)}`);
    this.closers.push(result.close);
    return result;
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.closers.splice(0).map((close) => close()));
    await Promise.all(this.dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}

export async function readManifest<T>(artifactRoot: string): Promise<T> {
  return JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8')) as T;
}

/** Mirrors the server-side construction frozen by the Prompt 2 contract (viewport CSS pixels for runtime sources). */
export function runtimeSourceFor(observation: ObservationArtifact): VisualAnnotationSource {
  if (observation.screenshot.state !== 'available' && observation.screenshot.state !== 'partial') throw new Error('fixture observation has no screenshot');
  return {
    kind: 'runtime-observation',
    observationId: observation.observationId,
    requestId: observation.requestId,
    observationSchemaVersion: observation.schemaVersion,
    screenshot: { path: observation.screenshot.value.path },
    coordinateSpace: { kind: 'runtime-css-px', width: observation.requestConfig.viewport.width, height: observation.requestConfig.viewport.height },
  };
}

export function referenceSourceFor(reference: ExternalReferenceArtifact): VisualAnnotationSource {
  if ('image' in reference) {
    return {
      kind: 'external-reference',
      referenceId: reference.referenceId,
      referenceRequestId: reference.referenceRequestId,
      referenceSchemaVersion: reference.schemaVersion,
      lifecycle: 'imported',
      imageOwnerReferenceId: reference.referenceId,
      imageSha256: reference.image.sha256,
      coordinateSpace: { kind: 'reference-image-px', width: reference.image.width, height: reference.image.height },
    };
  }
  return {
    kind: 'external-reference',
    referenceId: reference.referenceId,
    referenceRequestId: reference.referenceRequestId,
    referenceSchemaVersion: reference.schemaVersion,
    lifecycle: 'approved',
    imageOwnerReferenceId: reference.sourceReference.referenceId,
    imageSha256: reference.sourceReference.image.sha256,
    coordinateSpace: { kind: 'reference-image-px', width: reference.sourceReference.image.width, height: reference.sourceReference.image.height },
  };
}

export function rectangleItem(annotationItemId = 'item-1', target = 'header'): VisualAnnotationItem {
  return {
    annotationItemId,
    mark: { kind: 'rectangle', x: 10, y: 20, width: 100, height: 50 },
    association: { kind: 'runtime-target', target },
    interpretation: { state: 'uninterpreted' },
  };
}

export function referencePointItem(annotationItemId = 'item-1', confirmed = false): VisualAnnotationItem {
  return {
    annotationItemId,
    mark: { kind: 'point', x: 5, y: 5 },
    interpretation: confirmed ? { state: 'confirmed', intent: { kind: 'inspect' }, confirmedAt: '2026-09-17T00:00:00.000Z' } : { state: 'uninterpreted' },
  };
}

export interface EvidenceRootFixture {
  root: string;
  observation: ObservationArtifact;
  observationRoot: string;
  imported: ExternalReferenceArtifact;
  importedRoot: string;
  approved: ExternalReferenceArtifact;
  approvedRoot: string;
}

/** One real observation (800x600 viewport, real PNG) plus one real imported/approved reference pair (32x24) under `root`. */
export async function writeAnnotatableEvidence(root: string): Promise<EvidenceRootFixture> {
  const rich = await writeRichObservationFixture(root, 'annotatable-obs');
  const pair = await writeExternalReferencePairFixture(root);
  return {
    root,
    observation: await readManifest<ObservationArtifact>(rich.artifactRoot),
    observationRoot: rich.artifactRoot,
    imported: await readManifest<ExternalReferenceArtifact>(pair.importedRoot),
    importedRoot: pair.importedRoot,
    approved: await readManifest<ExternalReferenceArtifact>(pair.approvedRoot),
    approvedRoot: pair.approvedRoot,
  };
}

/** Persists one annotation through the canonical Batch 1 service under `<root>/annotations/<annotationId>`. */
export async function persistAnnotationUnder(root: string, source: VisualAnnotationSource, items: VisualAnnotationItem[], supersedesAnnotationId?: string): Promise<{ annotationId: string; artifactRoot: string; relativeDir: string }> {
  const persisted = await persistVisualAnnotation({ source, items, outputLocation: 'annotations', cwd: root, ...(supersedesAnnotationId === undefined ? {} : { supersedesAnnotationId }) });
  if (!persisted.ok) throw new Error(`expected annotation persistence to succeed: ${JSON.stringify(persisted.diagnostics)}`);
  return { annotationId: persisted.annotationId, artifactRoot: persisted.artifactRoot, relativeDir: `annotations/${persisted.annotationId}` };
}

export interface ProjectFixture extends EvidenceRootFixture {
  projectRoot: string;
}

/** A real initialized project whose managed evidence root holds annotatable evidence. */
export async function writeInitializedProject(resources: TestResources): Promise<ProjectFixture> {
  const projectRoot = await resources.tempDir('mfo-annotation-project-');
  const initialized = await initializeFrontendObserverProject({
    projectRoot,
    url: 'http://127.0.0.1:3000',
    viewport: { width: 800, height: 600 },
    targets: [{ name: 'header', selector: '#header' }],
    replace: false,
  });
  if (!initialized.ok) throw new Error(`expected project init to succeed: ${initialized.message}`);
  const evidence = await writeAnnotatableEvidence(projectEvidenceRoot(projectRoot));
  return { projectRoot, ...evidence };
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

export interface RawRequestOptions {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

/** node:http request with full header control (including Host). Resolves with whatever response arrives, even if the server closes early. */
export function rawRequest(viewer: RunningViewer, options: RawRequestOptions): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const req = httpRequest({ host: viewer.host, port: viewer.port, method: options.method, path: options.path, headers: options.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        settled = true;
        resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', (err) => {
      if (!settled) reject(err);
    });
    if (options.body !== undefined) req.end(options.body);
    else req.end();
  });
}

export async function fetchAuthoringToken(viewer: RunningViewer): Promise<string> {
  const body = (await (await fetch(`${viewer.url}/api/authoring/session`)).json()) as { enabled: boolean; token?: string };
  if (!body.enabled || body.token === undefined) throw new Error('expected authoring to be enabled');
  return body.token;
}

/** Headers that pass every authoring check for `viewer`. */
export function authoringHeaders(viewer: RunningViewer, token: string, body: string | Buffer): Record<string, string> {
  return {
    host: `127.0.0.1:${viewer.port}`,
    origin: `http://127.0.0.1:${viewer.port}`,
    'x-frontend-observer-authoring-token': token,
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
  };
}

export async function postAnnotation(viewer: RunningViewer, token: string, payload: unknown): Promise<RawResponse & { json: Record<string, unknown> }> {
  const body = JSON.stringify(payload);
  const response = await rawRequest(viewer, { method: 'POST', path: '/api/annotations', headers: authoringHeaders(viewer, token, body), body });
  return { ...response, json: JSON.parse(response.text) as Record<string, unknown> };
}

export async function indexRecords(viewer: RunningViewer): Promise<Record<string, unknown>[]> {
  const body = (await (await fetch(`${viewer.url}/api/index`)).json()) as { records: Record<string, unknown>[] };
  return body.records;
}

export async function handleFor(viewer: RunningViewer, family: string, logicalId: string): Promise<string> {
  const record = (await indexRecords(viewer)).find((r) => r.family === family && r.logicalId === logicalId);
  if (record === undefined) throw new Error(`no ${family} record for ${logicalId}`);
  return record.handle as string;
}
