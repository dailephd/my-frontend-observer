import { useCallback, useEffect, useState } from 'react';
import type { VisualAnnotationArtifact } from '../types/visualAnnotation.js';

export interface SavedRuntimeAnnotation {
  handle: string;
  annotation: VisualAnnotationArtifact;
}

export type RuntimeAnnotationsState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'available'; annotations: SavedRuntimeAnnotation[]; truncated: boolean }
  | { state: 'error'; message: string };

/** Bounded number of candidate annotation views fetched for one observation. */
export const MAX_RUNTIME_ANNOTATION_CANDIDATES = 100;

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
 * Pure membership rule: a saved annotation belongs to the selected observation
 * workspace only when its server-resolved source is available, is observation
 * evidence, and resolves to exactly the selected observation handle. Logical
 * ids, aliases, directories, and labels are never enough on their own.
 */
export function annotationViewBelongsToObservation(view: AnnotationViewBody, observationHandle: string): boolean {
  return view.ok === true && view.annotation !== undefined && view.source?.status === 'available' && view.source.family === 'observation' && view.source.handle === observationHandle;
}

/**
 * v0.9 Batch 3: discovers saved annotations for one selected observation using
 * only existing Prompt 2 APIs. `/api/index` narrows candidates by family,
 * support state, and `relatedIds.sourceObservationId`; each candidate is then
 * confirmed through `/api/annotations/:handle/view` with the exact-handle
 * rule above. No browser-side cache or storage is used.
 */
export function useRuntimeAnnotations(observationHandle: string, observationId: string): RuntimeAnnotationsState & { reload: () => void } {
  const [state, setState] = useState<RuntimeAnnotationsState>({ state: 'idle' });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      try {
        const indexResponse = await fetch('/api/index', { cache: 'no-store' });
        if (!indexResponse.ok) throw new Error(`index endpoint returned ${indexResponse.status}`);
        const index = (await indexResponse.json()) as { records: IndexRecord[] };
        const candidates = index.records.filter((r) => r.family === 'visual-annotation' && r.supportState === 'supported' && r.relatedIds?.sourceObservationId === observationId);
        const bounded = candidates.slice(0, MAX_RUNTIME_ANNOTATION_CANDIDATES);

        const annotations: SavedRuntimeAnnotation[] = [];
        for (const candidate of bounded) {
          const response = await fetch(`/api/annotations/${encodeURIComponent(candidate.handle)}/view`, { cache: 'no-store' });
          if (!response.ok) continue;
          const view = (await response.json()) as AnnotationViewBody;
          if (annotationViewBelongsToObservation(view, observationHandle)) {
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
  }, [observationHandle, observationId, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { ...state, reload };
}
