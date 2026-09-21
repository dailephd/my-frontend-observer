import { useCallback, useEffect, useState } from 'react';
import type { VisualAnnotationArtifact } from '../types/visualAnnotation.js';

export interface SavedAnnotation {
  handle: string;
  annotation: VisualAnnotationArtifact;
}

export type SavedRuntimeAnnotation = SavedAnnotation;

export type SourceAnnotationsState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'available'; annotations: SavedAnnotation[]; truncated: boolean }
  | { state: 'error'; message: string };

export type RuntimeAnnotationsState = SourceAnnotationsState;

/** Bounded number of candidate annotation views fetched for one source. */
export const MAX_SOURCE_ANNOTATION_CANDIDATES = 100;
export const MAX_RUNTIME_ANNOTATION_CANDIDATES = MAX_SOURCE_ANNOTATION_CANDIDATES;

export type AnnotatableSourceFamily = 'observation' | 'external-reference-imported' | 'external-reference-approved';

interface IndexRecord {
  handle: string;
  family: string;
  supportState: string;
  relatedIds?: Record<string, string>;
}

interface AnnotationViewBody {
  ok?: boolean;
  annotation?: VisualAnnotationArtifact;
  source?: { status: string; handle?: string; family?: string };
}

/**
 * Pure membership rule: a saved annotation belongs to the selected source
 * workspace only when its server-resolved source is available, is evidence of
 * the selected source's family, and resolves to exactly the selected source
 * handle. Logical ids, aliases, directories, labels, image dimensions, and
 * region ids are never enough on their own.
 */
export function annotationViewBelongsToSource(view: AnnotationViewBody, sourceHandle: string, sourceFamily: AnnotatableSourceFamily): boolean {
  return view.ok === true && view.annotation !== undefined && view.source?.status === 'available' && view.source.family === sourceFamily && view.source.handle === sourceHandle;
}

export function annotationViewBelongsToObservation(view: AnnotationViewBody, observationHandle: string): boolean {
  return annotationViewBelongsToSource(view, observationHandle, 'observation');
}

/**
 * v0.9 Batch 3/4: discovers saved annotations for one selected source using
 * only existing Prompt 2 APIs. `/api/index` narrows candidates by family,
 * support state, and the source's related id (`sourceObservationId` or
 * `sourceReferenceId`); each candidate is then confirmed through
 * `/api/annotations/:handle/view` with the exact-handle rule above. No
 * browser-side cache or storage is used.
 */
export function useSourceAnnotations(
  sourceHandle: string,
  sourceFamily: AnnotatableSourceFamily,
  relatedIdKey: 'sourceObservationId' | 'sourceReferenceId',
  sourceLogicalId: string,
): SourceAnnotationsState & { reload: () => void } {
  const [state, setState] = useState<SourceAnnotationsState>({ state: 'idle' });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      try {
        const indexResponse = await fetch('/api/index', { cache: 'no-store' });
        if (!indexResponse.ok) throw new Error(`index endpoint returned ${indexResponse.status}`);
        const index = (await indexResponse.json()) as { records: IndexRecord[] };
        const candidates = index.records.filter((r) => r.family === 'visual-annotation' && r.supportState === 'supported' && r.relatedIds?.[relatedIdKey] === sourceLogicalId);
        const bounded = candidates.slice(0, MAX_SOURCE_ANNOTATION_CANDIDATES);

        const annotations: SavedAnnotation[] = [];
        for (const candidate of bounded) {
          const response = await fetch(`/api/annotations/${encodeURIComponent(candidate.handle)}/view`, { cache: 'no-store' });
          if (!response.ok) continue;
          const view = (await response.json()) as AnnotationViewBody;
          if (annotationViewBelongsToSource(view, sourceHandle, sourceFamily)) {
            annotations.push({ handle: candidate.handle, annotation: view.annotation as VisualAnnotationArtifact });
          }
        }
        if (!cancelled) setState({ state: 'available', annotations, truncated: candidates.length > bounded.length });
      } catch (err) {
        if (!cancelled) setState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sourceHandle, sourceFamily, relatedIdKey, sourceLogicalId, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { ...state, reload };
}

/** v0.9 Batch 3 runtime observation discovery. */
export function useRuntimeAnnotations(observationHandle: string, observationId: string): RuntimeAnnotationsState & { reload: () => void } {
  return useSourceAnnotations(observationHandle, 'observation', 'sourceObservationId', observationId);
}
