import { useCallback, useEffect, useState } from 'react';

export type RuntimeVisualChangeStartState = { state: 'idle' } | { state: 'starting' } | { state: 'created'; contractId: string; contractRequestId: string; clauseCount: number; visualChangeRequestId: string; visualChangeWorkflowId: string } | { state: 'failed'; status?: number; message: string; contractId?: string; contractRequestId?: string };
export function useRuntimeVisualChangeStart(savedAnnotationHandle: string | undefined) {
  const [state, setState] = useState<RuntimeVisualChangeStartState>({ state: 'idle' });
  useEffect(() => setState({ state: 'idle' }), [savedAnnotationHandle]);
  const start = useCallback(async (token: string, itemIds: string[]) => {
    if (savedAnnotationHandle === undefined) return undefined;
    setState({ state: 'starting' }); let status: number | undefined;
    try {
      const response = await fetch(`/api/annotations/${encodeURIComponent(savedAnnotationHandle)}/start-visual-change`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': token }, body: JSON.stringify({ itemIds }) }); status = response.status;
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; contractId?: string; contractRequestId?: string; clauseCount?: number; visualChangeRequestId?: string; visualChangeWorkflowId?: string };
      if (response.status !== 201 || body.ok !== true || body.contractId === undefined || body.contractRequestId === undefined || body.visualChangeRequestId === undefined || body.visualChangeWorkflowId === undefined) { setState({ state: 'failed', status, message: body.error ?? `Visual change creation failed with status ${status}.`, ...(body.contractId === undefined ? {} : { contractId: body.contractId }), ...(body.contractRequestId === undefined ? {} : { contractRequestId: body.contractRequestId }) }); return undefined; }
      setState({ state: 'created', contractId: body.contractId, contractRequestId: body.contractRequestId, clauseCount: body.clauseCount ?? 0, visualChangeRequestId: body.visualChangeRequestId, visualChangeWorkflowId: body.visualChangeWorkflowId }); return body.visualChangeWorkflowId;
    } catch (error) { setState({ state: 'failed', ...(status === undefined ? {} : { status }), message: error instanceof Error ? error.message : String(error) }); return undefined; }
  }, [savedAnnotationHandle]);
  return { state, start };
}
