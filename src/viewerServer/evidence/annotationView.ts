import { findExternalReferenceByIdentity, findObservationByIdentity, loadArtifactByHandle } from './index.js';
import type { VisualAnnotationArtifact } from '../../domain/visualAnnotation.js';

export type AnnotationSourceView =
  | {
      status: 'available';
      handle: string;
      family: 'observation' | 'external-reference-imported' | 'external-reference-approved';
      mediaRole: 'screenshot' | 'image' | 'source-image';
    }
  | {
      status: 'unavailable';
      reason: string;
    };

export type GetAnnotationViewResult =
  | {
      ok: true;
      annotation: VisualAnnotationArtifact;
      source: AnnotationSourceView;
    }
  | {
      ok: false;
      reason: 'unknown-handle' | 'not-an-annotation' | 'not-currently-loadable';
    };

/**
 * v0.9 Batch 2 inspection-only projection: loads one visual annotation through
 * the canonical handle boundary and resolves its source evidence by exact
 * canonical identity (observationId + requestId, or referenceId +
 * referenceRequestId) within the current evidence root. Never searches by
 * alias or filename, never reinterprets annotation intent, and never lets a
 * missing source invalidate the annotation itself - a missing or ambiguous
 * source is reported as explicitly unavailable.
 */
export async function getAnnotationView(root: string, annotationHandle: string): Promise<GetAnnotationViewResult> {
  const loaded = await loadArtifactByHandle(root, annotationHandle);
  if (!loaded.ok) {
    if (loaded.reason === 'unknown-handle') return { ok: false, reason: 'unknown-handle' };
    return loaded.metadata.family === 'visual-annotation' ? { ok: false, reason: 'not-currently-loadable' } : { ok: false, reason: 'not-an-annotation' };
  }
  if (loaded.detail.family !== 'visual-annotation') return { ok: false, reason: 'not-an-annotation' };

  const annotation = loaded.detail.artifact as VisualAnnotationArtifact;
  return { ok: true, annotation, source: await resolveAnnotationSource(root, annotation) };
}

async function resolveAnnotationSource(root: string, annotation: VisualAnnotationArtifact): Promise<AnnotationSourceView> {
  const { source } = annotation;
  if (source.kind === 'runtime-observation') {
    const match = await findObservationByIdentity(root, source.observationId, source.requestId);
    if (match === undefined) {
      return { status: 'unavailable', reason: 'the source observation is not present, or not uniquely identifiable, under the current evidence root' };
    }
    return { status: 'available', handle: match.handle, family: 'observation', mediaRole: 'screenshot' };
  }

  const match = await findExternalReferenceByIdentity(root, source.referenceId, source.referenceRequestId);
  if (match === undefined) {
    return { status: 'unavailable', reason: 'the source external reference is not present, or not uniquely identifiable, under the current evidence root' };
  }
  return {
    status: 'available',
    handle: match.handle,
    family: match.family,
    mediaRole: match.family === 'external-reference-approved' ? 'source-image' : 'image',
  };
}
