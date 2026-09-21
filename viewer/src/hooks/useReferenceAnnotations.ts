import { useSourceAnnotations } from './useRuntimeAnnotations.js';
import type { SourceAnnotationsState } from './useRuntimeAnnotations.js';

/**
 * v0.9 Batch 4: saved annotations for one selected external reference
 * (imported or approved). Candidates come from `/api/index` by
 * `relatedIds.sourceReferenceId`; each is kept only when its server-resolved
 * source is exactly this reference's family and handle. An annotation made on
 * an approved reference is never shown under its owning imported reference,
 * or the other way round, and labels, image dimensions, or region ids never
 * attach an annotation to a different reference.
 */
export function useReferenceAnnotations(
  referenceHandle: string,
  referenceFamily: 'external-reference-imported' | 'external-reference-approved',
  referenceId: string,
): SourceAnnotationsState & { reload: () => void } {
  return useSourceAnnotations(referenceHandle, referenceFamily, 'sourceReferenceId', referenceId);
}
