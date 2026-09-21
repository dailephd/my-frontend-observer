import { useCallback, useEffect, useState } from 'react';

export type ReferenceMaterializationState =
  | { state: 'idle' }
  | { state: 'materializing' }
  | { state: 'materialized'; referenceId: string; supersedesReferenceId: string; regionCount: number; requirementCount: number; approvalRequired: boolean }
  | { state: 'failed'; status: number | undefined; message: string };

/** Concise, bounded materialization failure text for each status family. */
export function describeMaterializationFailure(status: number | undefined, serverError: string | undefined): string {
  const detail = serverError === undefined ? '' : ` (${serverError.slice(0, 200)})`;
  switch (status) {
    case 400:
      return `Materialization rejected: the request was malformed${detail}.`;
    case 403:
      return `Materialization forbidden: annotation authoring is unavailable or this session has expired${detail}.`;
    case 404:
      return `Materialization failed: the saved annotation, its source reference, or the source image no longer exists${detail}.`;
    case 409:
      return `Materialization refused: the annotation is not an external-reference annotation for a loadable matching source${detail}.`;
    case 422:
      return `Materialization refused: the selection cannot compose a valid external-reference revision${detail}.`;
    case 500:
      return `Materialization failed: the reference revision could not be persisted${detail}.`;
    case undefined:
      return `Materialization failed: the viewer server could not be reached${detail}.`;
    default:
      return `Materialization failed with status ${status}${detail}.`;
  }
}

/**
 * v0.9 Batch 6: explicit materialization of selected confirmed reference-region
 * and reference-requirement intent from one saved external-reference
 * annotation into a new imported reference revision, through
 * `POST /api/annotations/:handle/materialize-reference` with the in-memory
 * Prompt 2 token. Failures are shown and never retried. State resets when the
 * saved annotation changes. The viewed reference is never switched.
 */
export function useAnnotationReferenceMaterialization(savedAnnotationHandle: string | undefined) {
  const [state, setState] = useState<ReferenceMaterializationState>({ state: 'idle' });

  useEffect(() => {
    setState({ state: 'idle' });
  }, [savedAnnotationHandle]);

  const materialize = useCallback(
    async (token: string, itemIds: string[]) => {
      if (savedAnnotationHandle === undefined) return;
      setState({ state: 'materializing' });
      let status: number | undefined;
      try {
        const response = await fetch(`/api/annotations/${encodeURIComponent(savedAnnotationHandle)}/materialize-reference`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': token },
          body: JSON.stringify({ itemIds }),
        });
        status = response.status;
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          referenceId?: string;
          supersedesReferenceId?: string;
          regionCount?: number;
          requirementCount?: number;
          approvalRequired?: boolean;
          error?: string;
        };
        if (response.status !== 201 || body.ok !== true || body.referenceId === undefined || body.supersedesReferenceId === undefined) {
          setState({ state: 'failed', status, message: describeMaterializationFailure(status, body.error) });
          return;
        }
        setState({
          state: 'materialized',
          referenceId: body.referenceId,
          supersedesReferenceId: body.supersedesReferenceId,
          regionCount: body.regionCount ?? 0,
          requirementCount: body.requirementCount ?? 0,
          approvalRequired: body.approvalRequired !== false,
        });
      } catch (err) {
        setState({ state: 'failed', status, message: describeMaterializationFailure(status, err instanceof Error ? err.message : String(err)) });
      }
    },
    [savedAnnotationHandle],
  );

  return { state, materialize };
}
