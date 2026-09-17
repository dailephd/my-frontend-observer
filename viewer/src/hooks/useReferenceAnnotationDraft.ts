import { useCallback } from 'react';
import type { VisualAnnotationItem } from '../types/visualAnnotation.js';
import { useAnnotationDraft } from './useRuntimeAnnotationDraft.js';
import { applyReferenceItemEdit, confirmCandidate } from '../annotation/referenceIntent.js';

/**
 * v0.9 Batch 4 external-reference annotation draft: the same generic draft
 * lifecycle Prompt 3 uses (new, load saved, select, draw, move, delete,
 * cancel, save through the Prompt 2 API, revision), with reference-side edit
 * rules layered on top:
 *
 * - every edit goes through `applyReferenceItemEdit`, so a region proposal
 *   follows its rectangle and a confirmed item whose meaning changes drops
 *   back to candidate without `confirmedAt`;
 * - confirmation is a separate, explicit action and never happens on save.
 */
export function useReferenceAnnotationDraft(referenceHandle: string) {
  const draftApi = useAnnotationDraft(referenceHandle);
  const { updateItem: rawUpdateItem } = draftApi;

  const updateItem = useCallback(
    (annotationItemId: string, update: (item: VisualAnnotationItem) => VisualAnnotationItem) => {
      rawUpdateItem(annotationItemId, (item) => applyReferenceItemEdit(item, update));
    },
    [rawUpdateItem],
  );

  const confirmItem = useCallback(
    (annotationItemId: string) => {
      rawUpdateItem(annotationItemId, (item) => confirmCandidate(item, new Date().toISOString()));
    },
    [rawUpdateItem],
  );

  return { ...draftApi, updateItem, confirmItem };
}

export type UseReferenceAnnotationDraftResult = ReturnType<typeof useReferenceAnnotationDraft>;
