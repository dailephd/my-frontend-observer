import type { VisualAnnotationItem, VisualAnnotationSource } from '../domain/visualAnnotation.js';
import { persistVisualAnnotation } from '../application/visualAnnotationPersistenceService.js';
import { annotationOutputLocation } from '../projectWorkflow/projectPaths.js';
import { loadArtifactByHandle } from './evidence/index.js';
import type { EvidenceArtifactDetail } from './evidence/projection.js';
import { discoverManifests } from './evidence/discovery.js';
import { classifyManifest } from './evidence/classify.js';
import { encodeArtifactHandle } from './evidence/handles.js';
import { MAX_INDEX_RECORDS } from './evidence/limits.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';

/**
 * v0.9 Batch 2 closed save request. The browser supplies only viewer handles
 * and annotation items. Source identity, output location, project root,
 * annotation identity, overlay metadata, timestamps, and producer metadata
 * are always server/application owned.
 */
export interface SaveAnnotationRequest {
  sourceHandle: string;
  parentAnnotationHandle?: string;
  items: VisualAnnotationItem[];
}

const SAVE_REQUEST_KEYS = ['sourceHandle', 'parentAnnotationHandle', 'items'] as const;

export type ParseSaveAnnotationRequestResult = { ok: true; request: SaveAnnotationRequest } | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Maximum number of annotation item ids accepted by one promotion or materialization request. */
export const MAX_AUTHORING_ITEM_IDS = 100;

/**
 * v0.9 Batch 5/6 shared `itemIds` shape rule for authoring requests that act on
 * selected items of a saved annotation: a non-empty array of at most 100
 * unique, non-empty strings.
 */
export function parseAuthoringItemIds(value: unknown): { ok: true; itemIds: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: 'itemIds must be a non-empty array' };
  if (value.length > MAX_AUTHORING_ITEM_IDS) return { ok: false, error: `itemIds must contain at most ${MAX_AUTHORING_ITEM_IDS} entries` };
  if (!value.every((id) => typeof id === 'string' && id.length > 0)) return { ok: false, error: 'every itemIds entry must be a non-empty string' };
  if (new Set(value).size !== value.length) return { ok: false, error: 'itemIds must be unique' };
  return { ok: true, itemIds: value as string[] };
}

/** Request-shape validation only. Item content is validated later by the canonical visual-annotation domain. */
export function parseSaveAnnotationRequest(value: unknown): ParseSaveAnnotationRequestResult {
  if (!isPlainObject(value)) return { ok: false, error: 'request body must be a JSON object' };
  const unknownKeys = Object.keys(value).filter((key) => !(SAVE_REQUEST_KEYS as readonly string[]).includes(key));
  if (unknownKeys.length > 0) return { ok: false, error: `unsupported request field(s): ${unknownKeys.slice(0, 10).join(', ')}` };
  if (!isNonEmptyString(value.sourceHandle)) return { ok: false, error: 'sourceHandle must be a non-empty string' };
  if ('parentAnnotationHandle' in value && !isNonEmptyString(value.parentAnnotationHandle)) {
    return { ok: false, error: 'parentAnnotationHandle must be a non-empty string when present' };
  }
  if (!Array.isArray(value.items)) return { ok: false, error: 'items must be an array' };
  return {
    ok: true,
    request: {
      sourceHandle: value.sourceHandle,
      ...(typeof value.parentAnnotationHandle === 'string' ? { parentAnnotationHandle: value.parentAnnotationHandle } : {}),
      items: value.items as VisualAnnotationItem[],
    },
  };
}

/**
 * Exact canonical source equality: every persisted source identity field must
 * match. Never a logical-id-only comparison, never alias or filesystem based.
 */
export function isSameVisualAnnotationSource(a: VisualAnnotationSource, b: VisualAnnotationSource): boolean {
  if (a.kind === 'runtime-observation' && b.kind === 'runtime-observation') {
    return (
      a.observationId === b.observationId &&
      a.requestId === b.requestId &&
      a.observationSchemaVersion === b.observationSchemaVersion &&
      a.screenshot.path === b.screenshot.path &&
      a.coordinateSpace.kind === b.coordinateSpace.kind &&
      a.coordinateSpace.width === b.coordinateSpace.width &&
      a.coordinateSpace.height === b.coordinateSpace.height
    );
  }
  if (a.kind === 'external-reference' && b.kind === 'external-reference') {
    return (
      a.referenceId === b.referenceId &&
      a.referenceRequestId === b.referenceRequestId &&
      a.referenceSchemaVersion === b.referenceSchemaVersion &&
      a.lifecycle === b.lifecycle &&
      a.imageOwnerReferenceId === b.imageOwnerReferenceId &&
      a.imageSha256 === b.imageSha256 &&
      a.coordinateSpace.kind === b.coordinateSpace.kind &&
      a.coordinateSpace.width === b.coordinateSpace.width &&
      a.coordinateSpace.height === b.coordinateSpace.height
    );
  }
  return false;
}

type SourceConstruction = { ok: true; source: VisualAnnotationSource } | { ok: false; error: string };

/** Builds the canonical annotation source from an already-loaded, already-validated artifact. Runtime frames are viewport CSS pixels, never screenshot device pixels. */
function buildAnnotationSource(detail: EvidenceArtifactDetail): SourceConstruction {
  const { family, artifact } = detail;
  if (family === 'observation' && 'observationId' in artifact) {
    const screenshot = artifact.screenshot;
    if (screenshot.state !== 'available' && screenshot.state !== 'partial') {
      return { ok: false, error: 'the source observation has no recorded screenshot to annotate' };
    }
    return {
      ok: true,
      source: {
        kind: 'runtime-observation',
        observationId: artifact.observationId,
        requestId: artifact.requestId,
        observationSchemaVersion: artifact.schemaVersion,
        screenshot: { path: screenshot.value.path },
        coordinateSpace: { kind: 'runtime-css-px', width: artifact.requestConfig.viewport.width, height: artifact.requestConfig.viewport.height },
      },
    };
  }
  if (family === 'external-reference-imported' && 'referenceId' in artifact && 'image' in artifact) {
    return {
      ok: true,
      source: {
        kind: 'external-reference',
        referenceId: artifact.referenceId,
        referenceRequestId: artifact.referenceRequestId,
        referenceSchemaVersion: artifact.schemaVersion,
        lifecycle: 'imported',
        imageOwnerReferenceId: artifact.referenceId,
        imageSha256: artifact.image.sha256,
        coordinateSpace: { kind: 'reference-image-px', width: artifact.image.width, height: artifact.image.height },
      },
    };
  }
  if (family === 'external-reference-approved' && 'referenceId' in artifact && 'sourceReference' in artifact) {
    return {
      ok: true,
      source: {
        kind: 'external-reference',
        referenceId: artifact.referenceId,
        referenceRequestId: artifact.referenceRequestId,
        referenceSchemaVersion: artifact.schemaVersion,
        lifecycle: 'approved',
        imageOwnerReferenceId: artifact.sourceReference.referenceId,
        imageSha256: artifact.sourceReference.image.sha256,
        coordinateSpace: { kind: 'reference-image-px', width: artifact.sourceReference.image.width, height: artifact.sourceReference.image.height },
      },
    };
  }
  return { ok: false, error: `"${family}" evidence cannot be annotated; only observations and external references can` };
}

export type SaveAnnotationFailureReason =
  | 'unknown-source-handle'
  | 'source-not-loadable'
  | 'source-not-annotatable'
  | 'unknown-parent-handle'
  | 'parent-not-annotation'
  | 'parent-source-mismatch'
  | 'parent-has-child'
  | 'revision-lineage-unverifiable'
  | 'invalid-annotation'
  | 'persistence-failed';

export type SaveAnnotationResult =
  | { ok: true; annotationId: string; annotationRequestId: string; handle: string }
  | { ok: false; reason: SaveAnnotationFailureReason; error: string };

type ChildScan = { status: 'none' } | { status: 'has-child' } | { status: 'unverifiable' };

/**
 * Bounded stale-revision scan: does any currently supported visual annotation
 * already supersede `parentAnnotationId`? Uses the same bounded discovery and
 * canonical classification as the index. If discovery was truncated the
 * lineage cannot be proven child-free, so the caller fails closed.
 */
async function scanForExistingChild(root: string, parentAnnotationId: string): Promise<ChildScan> {
  const discovery = await discoverManifests(root);
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'visual-annotation') continue;
    if (classified.artifact.supersedesAnnotationId === parentAnnotationId) return { status: 'has-child' };
  }
  if (discovery.truncated || discovery.manifests.length > MAX_INDEX_RECORDS) return { status: 'unverifiable' };
  return { status: 'none' };
}

/** One in-process authoring write at a time per session, so read-check-write sequences (stale revisions, contract promotion and activation) cannot interleave. */
const saveQueues = new WeakMap<ViewerAuthoringSession, Promise<unknown>>();

/** v0.9 Batch 5: runs one authoring write through the session's single in-process write queue. */
export function runSerializedAuthoringWrite<T>(session: ViewerAuthoringSession, write: () => Promise<T>): Promise<T> {
  const previous = saveQueues.get(session) ?? Promise.resolve();
  const next = previous.then(write, write);
  saveQueues.set(session, next);
  return next;
}

/**
 * The one v0.9 Batch 2 viewer save use case. Resolves the source (and optional
 * parent) through the canonical handle boundary, constructs the canonical
 * annotation source server-side, enforces the same-source and stale-revision
 * rules, and then persists exactly once through `persistVisualAnnotation`
 * into the project-managed annotation location. It never writes directly,
 * never builds identity or overlays itself, and never returns filesystem
 * paths.
 */
export function saveAnnotationFromViewer(root: string, session: ViewerAuthoringSession, request: SaveAnnotationRequest): Promise<SaveAnnotationResult> {
  return runSerializedAuthoringWrite(session, () => performSave(root, session, request));
}

async function performSave(root: string, session: ViewerAuthoringSession, request: SaveAnnotationRequest): Promise<SaveAnnotationResult> {
  const sourceLoaded = await loadArtifactByHandle(root, request.sourceHandle);
  if (!sourceLoaded.ok) {
    return sourceLoaded.reason === 'unknown-handle'
      ? { ok: false, reason: 'unknown-source-handle', error: 'unknown source evidence handle' }
      : { ok: false, reason: 'source-not-loadable', error: 'source evidence is not currently loadable' };
  }
  const built = buildAnnotationSource(sourceLoaded.detail);
  if (!built.ok) return { ok: false, reason: 'source-not-annotatable', error: built.error };
  const source = built.source;

  let supersedesAnnotationId: string | undefined;
  if (request.parentAnnotationHandle !== undefined) {
    const parentLoaded = await loadArtifactByHandle(root, request.parentAnnotationHandle);
    if (!parentLoaded.ok) {
      return parentLoaded.reason === 'unknown-handle'
        ? { ok: false, reason: 'unknown-parent-handle', error: 'unknown parent annotation handle' }
        : { ok: false, reason: 'parent-not-annotation', error: 'parent annotation is not currently loadable visual-annotation evidence' };
    }
    if (parentLoaded.detail.family !== 'visual-annotation' || !('annotationId' in parentLoaded.detail.artifact)) {
      return { ok: false, reason: 'parent-not-annotation', error: 'parentAnnotationHandle does not name visual-annotation evidence' };
    }
    const parent = parentLoaded.detail.artifact;
    if (!isSameVisualAnnotationSource(parent.source, source)) {
      return { ok: false, reason: 'parent-source-mismatch', error: 'the parent annotation was made over a different canonical source' };
    }
    const childScan = await scanForExistingChild(root, parent.annotationId);
    if (childScan.status === 'has-child') {
      return { ok: false, reason: 'parent-has-child', error: 'the parent annotation already has a saved revision; reload before revising' };
    }
    if (childScan.status === 'unverifiable') {
      return { ok: false, reason: 'revision-lineage-unverifiable', error: 'the evidence root is too large to verify that the parent annotation has no saved revision' };
    }
    supersedesAnnotationId = parent.annotationId;
  }

  const persisted = await persistVisualAnnotation({
    source,
    items: request.items,
    outputLocation: annotationOutputLocation(),
    cwd: session.projectRoot,
    ...(supersedesAnnotationId === undefined ? {} : { supersedesAnnotationId }),
  });
  if (!persisted.ok) {
    const first = persisted.diagnostics[0];
    if (first?.code === 'invalid-request') return { ok: false, reason: 'invalid-annotation', error: first.message };
    return { ok: false, reason: 'persistence-failed', error: 'the annotation could not be persisted' };
  }

  return {
    ok: true,
    annotationId: persisted.annotationId,
    annotationRequestId: persisted.annotationRequestId,
    handle: encodeArtifactHandle('visual-annotation', `annotations/${persisted.annotationId}`),
  };
}
