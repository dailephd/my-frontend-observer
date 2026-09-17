import { useCallback, useEffect, useState } from 'react';
import type { VisualAnnotationArtifact, VisualAnnotationItem } from '../types/visualAnnotation.js';
import { applyRuntimeItemEdit, confirmCandidate } from '../annotation/runtimeIntent.js';

export type DraftSaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; annotationId: string }
  | { state: 'failed'; status: number | undefined; message: string };

export interface AnnotationDraft {
  items: VisualAnnotationItem[];
  /** Handle of the persisted annotation this draft revises; undefined for a new root annotation. */
  parentAnnotationHandle: string | undefined;
  parentAnnotationId: string | undefined;
  selectedItemId: string | undefined;
  dirty: boolean;
  save: DraftSaveState;
}

/** v0.9 Batch 3 name, kept for the runtime workspace. */
export type RuntimeAnnotationDraft = AnnotationDraft;

const EMPTY_DRAFT: AnnotationDraft = { items: [], parentAnnotationHandle: undefined, parentAnnotationId: undefined, selectedItemId: undefined, dirty: false, save: { state: 'idle' } };

/** Concise, bounded save failure text for each Prompt 2 status family. Server detail is appended only as a short hint. */
export function describeSaveFailure(status: number | undefined, serverError: string | undefined): string {
  const detail = serverError === undefined ? '' : ` (${serverError.slice(0, 200)})`;
  switch (status) {
    case 403:
      return `Save forbidden: annotation authoring is unavailable or this session has expired${detail}.`;
    case 404:
      return `Save failed: the selected source evidence or parent annotation no longer exists${detail}.`;
    case 409:
      return `Save conflict: this annotation was already revised elsewhere, or its source changed. Your draft was kept; reload the saved annotations before revising${detail}.`;
    case 413:
      return `Save failed: the annotation is too large to send${detail}.`;
    case 422:
      return `Save rejected: the annotation failed canonical validation${detail}.`;
    case 500:
      return `Save failed: the annotation could not be persisted${detail}.`;
    case undefined:
      return `Save failed: the viewer server could not be reached${detail}.`;
    default:
      return `Save failed with status ${status}${detail}.`;
  }
}

/**
 * v0.9 Batch 3 in-memory annotation draft for one source handle (a runtime
 * observation, or since Batch 4 an external reference). The draft never
 * touches browser storage and is discarded on reload. Saving posts only
 * `{ sourceHandle, parentAnnotationHandle?, items }` to the Prompt 2 API; on
 * 201 the canonical saved annotation is re-read from the server and becomes
 * both the draft content and the new parent. Failures keep the draft, are
 * never retried automatically, and never fall back to a new root annotation.
 */
export function useAnnotationDraft(sourceHandle: string) {
  const [draft, setDraft] = useState<AnnotationDraft>(EMPTY_DRAFT);
  const [baselineItems, setBaselineItems] = useState<VisualAnnotationItem[]>([]);

  // A different source never inherits another source's draft.
  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setBaselineItems([]);
  }, [sourceHandle]);

  const newAnnotation = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setBaselineItems([]);
  }, []);

  const loadPersisted = useCallback((handle: string, annotation: VisualAnnotationArtifact) => {
    setDraft({ items: annotation.items, parentAnnotationHandle: handle, parentAnnotationId: annotation.annotationId, selectedItemId: undefined, dirty: false, save: { state: 'idle' } });
    setBaselineItems(annotation.items);
  }, []);

  const addItem = useCallback((item: VisualAnnotationItem) => {
    setDraft((d) => ({ ...d, items: [...d.items, item], selectedItemId: item.annotationItemId, dirty: true, save: d.save.state === 'saving' ? d.save : { state: 'idle' } }));
  }, []);

  const updateItem = useCallback((annotationItemId: string, update: (item: VisualAnnotationItem) => VisualAnnotationItem) => {
    setDraft((d) => ({ ...d, items: d.items.map((item) => (item.annotationItemId === annotationItemId ? update(item) : item)), dirty: true }));
  }, []);

  const selectItem = useCallback((annotationItemId: string | undefined) => {
    setDraft((d) => ({ ...d, selectedItemId: annotationItemId }));
  }, []);

  const deleteSelected = useCallback(() => {
    setDraft((d) => (d.selectedItemId === undefined ? d : { ...d, items: d.items.filter((item) => item.annotationItemId !== d.selectedItemId), selectedItemId: undefined, dirty: true }));
  }, []);

  const cancelChanges = useCallback(() => {
    setDraft((d) => ({ ...d, items: baselineItems, selectedItemId: undefined, dirty: false, save: { state: 'idle' } }));
  }, [baselineItems]);

  const save = useCallback(
    async (token: string, onSaved: () => void) => {
      const current = draft;
      setDraft((d) => ({ ...d, save: { state: 'saving' } }));
      let status: number | undefined;
      try {
        const response = await fetch('/api/annotations', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': token },
          body: JSON.stringify({ sourceHandle, ...(current.parentAnnotationHandle === undefined ? {} : { parentAnnotationHandle: current.parentAnnotationHandle }), items: current.items }),
        });
        status = response.status;
        const body = (await response.json().catch(() => ({}))) as { ok?: boolean; handle?: string; error?: string };
        if (response.status !== 201 || body.ok !== true || typeof body.handle !== 'string') {
          setDraft((d) => ({ ...d, save: { state: 'failed', status, message: describeSaveFailure(status, body.error) } }));
          return;
        }

        const viewResponse = await fetch(`/api/annotations/${encodeURIComponent(body.handle)}/view`, { cache: 'no-store' });
        const view = (await viewResponse.json()) as { ok?: boolean; annotation?: VisualAnnotationArtifact };
        if (!viewResponse.ok || view.ok !== true || view.annotation === undefined) {
          setDraft((d) => ({ ...d, save: { state: 'failed', status: viewResponse.status, message: 'The annotation was saved, but the saved artifact could not be reloaded. Reload the saved annotations list.' } }));
          onSaved();
          return;
        }
        const saved = view.annotation;
        setDraft({ items: saved.items, parentAnnotationHandle: body.handle, parentAnnotationId: saved.annotationId, selectedItemId: undefined, dirty: false, save: { state: 'saved', annotationId: saved.annotationId } });
        setBaselineItems(saved.items);
        onSaved();
      } catch (err) {
        setDraft((d) => ({ ...d, save: { state: 'failed', status, message: describeSaveFailure(status, err instanceof Error ? err.message : String(err)) } }));
      }
    },
    [draft, sourceHandle],
  );

  return { draft, newAnnotation, loadPersisted, addItem, updateItem, selectItem, deleteSelected, cancelChanges, save };
}

export type UseAnnotationDraftResult = ReturnType<typeof useAnnotationDraft>;

/**
 * v0.9 Batch 3/5 runtime observation draft: the generic draft lifecycle, plus
 * Batch 5 runtime intent rules. Every edit (moves, note text, association
 * changes, intent changes) passes through `applyRuntimeItemEdit`, so a change
 * primitive always follows its explicit association and a confirmed item
 * whose meaning changes goes back to candidate. Confirmation is explicit.
 */
export function useRuntimeAnnotationDraft(observationHandle: string) {
  const draftApi = useAnnotationDraft(observationHandle);
  const { updateItem: rawUpdateItem } = draftApi;

  const updateItem = useCallback(
    (annotationItemId: string, update: (item: VisualAnnotationItem) => VisualAnnotationItem) => {
      rawUpdateItem(annotationItemId, (item) => applyRuntimeItemEdit(item, update));
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

export type UseRuntimeAnnotationDraftResult = ReturnType<typeof useRuntimeAnnotationDraft>;
