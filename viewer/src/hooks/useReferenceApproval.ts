import { useCallback, useEffect, useState } from 'react';
export type ReferenceApprovalState = { state: 'idle' } | { state: 'approving' } | { state: 'approved'; referenceId: string } | { state: 'failed'; message: string };
export function useReferenceApproval(handle: string) {
  const [state, setState] = useState<ReferenceApprovalState>({ state: 'idle' }); useEffect(() => setState({ state: 'idle' }), [handle]);
  const approve = useCallback(async (token: string) => { setState({ state: 'approving' }); try { const response = await fetch(`/api/references/${encodeURIComponent(handle)}/approve`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': token }, body: '{}' }); const body = await response.json() as { ok?: boolean; referenceId?: string; error?: string }; if (response.status !== 201 || body.ok !== true || body.referenceId === undefined) { setState({ state: 'failed', message: body.error ?? `Approval failed with status ${response.status}.` }); return undefined; } setState({ state: 'approved', referenceId: body.referenceId }); return body.referenceId; } catch (error) { setState({ state: 'failed', message: error instanceof Error ? error.message : String(error) }); return undefined; } }, [handle]);
  return { state, approve };
}
