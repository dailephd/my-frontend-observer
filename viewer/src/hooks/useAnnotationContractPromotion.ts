import { useCallback, useEffect, useState } from 'react';

export type ContractActivationState = 'not-requested' | 'activated' | 'not-configured' | 'failed';

export type ContractPromotionState =
  | { state: 'idle' }
  | { state: 'promoting' }
  | { state: 'promoted'; contractId: string; clauseCount: number; activation: { state: ContractActivationState; reason?: string } }
  | { state: 'failed'; status: number | undefined; message: string };

/** Concise, bounded promotion failure text for each status family. */
export function describePromotionFailure(status: number | undefined, serverError: string | undefined): string {
  const detail = serverError === undefined ? '' : ` (${serverError.slice(0, 200)})`;
  switch (status) {
    case 403:
      return `Promotion forbidden: annotation authoring is unavailable or this session has expired${detail}.`;
    case 404:
      return `Promotion failed: the saved annotation or its source observation no longer exists${detail}.`;
    case 409:
      return `Promotion refused: wrong annotation source, or the configured baseline contract is invalid${detail}.`;
    case 422:
      return `Promotion refused: a selected item is not canonically promotable${detail}.`;
    case 500:
      return `Promotion failed: the change contract could not be persisted${detail}.`;
    case undefined:
      return `Promotion failed: the viewer server could not be reached${detail}.`;
    default:
      return `Promotion failed with status ${status}${detail}.`;
  }
}

/**
 * v0.9 Batch 5: explicit promotion of selected confirmed runtime intent from one
 * saved annotation into a canonical change contract, through
 * `POST /api/annotations/:handle/promote-contract` with the in-memory Prompt 2
 * token. Failures are shown and never retried. State resets when the saved
 * annotation changes.
 */
export function useAnnotationContractPromotion(savedAnnotationHandle: string | undefined) {
  const [state, setState] = useState<ContractPromotionState>({ state: 'idle' });

  useEffect(() => {
    setState({ state: 'idle' });
  }, [savedAnnotationHandle]);

  const promote = useCallback(
    async (token: string, itemIds: string[], activateForCheck: boolean) => {
      if (savedAnnotationHandle === undefined) return;
      setState({ state: 'promoting' });
      let status: number | undefined;
      try {
        const response = await fetch(`/api/annotations/${encodeURIComponent(savedAnnotationHandle)}/promote-contract`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': token },
          body: JSON.stringify({ itemIds, activateForCheck }),
        });
        status = response.status;
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          contractId?: string;
          clauseCount?: number;
          activation?: { state: ContractActivationState; reason?: string };
          error?: string;
        };
        if (response.status !== 201 || body.ok !== true || body.contractId === undefined || body.activation === undefined) {
          setState({ state: 'failed', status, message: describePromotionFailure(status, body.error) });
          return;
        }
        setState({ state: 'promoted', contractId: body.contractId, clauseCount: body.clauseCount ?? 0, activation: body.activation });
      } catch (err) {
        setState({ state: 'failed', status, message: describePromotionFailure(status, err instanceof Error ? err.message : String(err)) });
      }
    },
    [savedAnnotationHandle],
  );

  return { state, promote };
}
