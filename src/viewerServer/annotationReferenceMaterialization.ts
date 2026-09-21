import { readFile } from 'node:fs/promises';
import type { ExternalReferenceArtifact } from '../domain/externalReference.js';
import { referenceOutputLocation } from '../projectWorkflow/projectPaths.js';
import { materializeVisualAnnotationReference } from '../application/visualAnnotationReferenceMaterializationService.js';
import type { MaterializeVisualAnnotationReferenceFailureCode } from '../application/visualAnnotationReferenceMaterializationService.js';
import { getAnnotationView } from './evidence/annotationView.js';
import { loadArtifactByHandle } from './evidence/index.js';
import { resolveMedia } from './evidence/mediaResolver.js';
import { decodeArtifactHandle, encodeArtifactHandle } from './evidence/handles.js';
import { resolveContainedDir } from './evidence/pathSafety.js';
import { parseAuthoringItemIds, runSerializedAuthoringWrite } from './annotationAuthoring.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';

/** v0.9 Batch 6 closed materialization request. The browser supplies only the selected annotation item ids. */
export interface MaterializeAnnotationReferenceRequest {
  itemIds: string[];
}

export type ParseMaterializeAnnotationReferenceRequestResult = { ok: true; request: MaterializeAnnotationReferenceRequest } | { ok: false; error: string };

export function parseMaterializeAnnotationReferenceRequest(value: unknown): ParseMaterializeAnnotationReferenceRequestResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'request body must be a JSON object' };
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== 'itemIds');
  if (unknownKeys.length > 0) return { ok: false, error: `unsupported request field(s): ${unknownKeys.slice(0, 10).join(', ')}` };
  const itemIds = parseAuthoringItemIds(record.itemIds);
  if (!itemIds.ok) return itemIds;
  return { ok: true, request: { itemIds: itemIds.itemIds } };
}

export type MaterializeAnnotationReferenceFailureReason =
  | 'unknown-annotation-handle'
  | 'not-an-annotation'
  | 'runtime-annotation'
  | 'source-unavailable'
  | 'source-image-unavailable'
  | 'image-read-failure'
  | MaterializeVisualAnnotationReferenceFailureCode;

export type MaterializeAnnotationReferenceFromViewerResult =
  | { ok: true; referenceId: string; referenceRequestId: string; handle: string; supersedesReferenceId: string; regionCount: number; requirementCount: number }
  | { ok: false; reason: MaterializeAnnotationReferenceFailureReason; error: string };

/**
 * v0.9 Batch 6 viewer materialization use case (`POST
 * /api/annotations/:handle/materialize-reference`). Resolves the saved
 * external-reference annotation and its exact canonical source reference,
 * reads the canonical image bytes only through the existing safe media
 * boundary (`image` for an imported source, `source-image` for an approved
 * one), resolves the source artifact root from its own viewer handle, and
 * calls the canonical `materializeVisualAnnotationReference` exactly once.
 * Runs through the session's single authoring write queue. Never approves,
 * never touches project configuration, and never returns filesystem paths.
 */
export function materializeAnnotationReferenceFromViewer(root: string, session: ViewerAuthoringSession, annotationHandle: string, request: MaterializeAnnotationReferenceRequest): Promise<MaterializeAnnotationReferenceFromViewerResult> {
  return runSerializedAuthoringWrite(session, () => performMaterialization(root, session, annotationHandle, request));
}

async function performMaterialization(root: string, session: ViewerAuthoringSession, annotationHandle: string, request: MaterializeAnnotationReferenceRequest): Promise<MaterializeAnnotationReferenceFromViewerResult> {
  const view = await getAnnotationView(root, annotationHandle);
  if (!view.ok) {
    return view.reason === 'unknown-handle'
      ? { ok: false, reason: 'unknown-annotation-handle', error: 'unknown annotation handle' }
      : { ok: false, reason: 'not-an-annotation', error: 'the handle does not name loadable visual-annotation evidence' };
  }
  const { annotation, source } = view;
  if (annotation.source.kind !== 'external-reference') {
    return { ok: false, reason: 'runtime-annotation', error: 'runtime-observation annotations are not materialized into external-reference revisions' };
  }
  if (source.status !== 'available' || (source.family !== 'external-reference-imported' && source.family !== 'external-reference-approved')) {
    return { ok: false, reason: 'source-unavailable', error: 'the annotation source reference is not uniquely available in this evidence root' };
  }

  const sourceLoaded = await loadArtifactByHandle(root, source.handle);
  if (!sourceLoaded.ok || sourceLoaded.detail.family !== source.family) {
    return { ok: false, reason: 'source-unavailable', error: 'the annotation source reference is no longer loadable' };
  }
  const sourceReference = sourceLoaded.detail.artifact as ExternalReferenceArtifact;

  const decoded = decodeArtifactHandle(source.handle);
  const sourceReferenceRoot = decoded.ok ? resolveContainedDir(root, decoded.relativeDir) : undefined;
  if (sourceReferenceRoot === undefined) return { ok: false, reason: 'source-unavailable', error: 'the annotation source reference directory could not be resolved' };

  const media = await resolveMedia(root, source.handle, source.family === 'external-reference-approved' ? 'source-image' : 'image');
  if (!media.ok) return { ok: false, reason: 'source-image-unavailable', error: 'the canonical source reference image is not available' };
  let imageBytes: Uint8Array;
  try {
    imageBytes = await readFile(media.absolutePath);
  } catch {
    return { ok: false, reason: 'image-read-failure', error: 'the canonical source reference image could not be read' };
  }

  const materialized = await materializeVisualAnnotationReference({
    annotation,
    sourceReference,
    sourceReferenceRoot,
    imageBytes,
    selectedItemIds: request.itemIds,
    outputLocation: referenceOutputLocation(),
    cwd: session.projectRoot,
  });
  if (!materialized.ok) {
    return { ok: false, reason: materialized.code, error: materialized.code === 'persistence-failure' ? 'the reference revision could not be persisted' : materialized.reason };
  }

  return {
    ok: true,
    referenceId: materialized.referenceId,
    referenceRequestId: materialized.referenceRequestId,
    handle: encodeArtifactHandle('external-reference-imported', `references/${materialized.referenceId}`),
    supersedesReferenceId: materialized.supersedesReferenceId,
    regionCount: materialized.regionCount,
    requirementCount: materialized.requirementCount,
  };
}
