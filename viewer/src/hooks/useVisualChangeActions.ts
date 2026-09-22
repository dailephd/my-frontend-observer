import { useEffect, useState } from 'react';

export type VisualChangeActionState = { state: 'idle' } | { state: 'pending'; action: 'activate'|'check'|'restore-acceptance' } | { state: 'success'; workflowId: string } | { state: 'failed'; message: string };
export function useVisualChangeActions(handle: string | undefined) {
  const [state, setState] = useState<VisualChangeActionState>({ state: 'idle' });
  useEffect(() => setState({ state: 'idle' }), [handle]);
  async function run(action: 'activate'|'check'|'restore-acceptance', token: string): Promise<string | undefined> {
    if (handle === undefined || state.state === 'pending') return; setState({ state: 'pending', action });
    try { const response = await fetch(`/api/visual-changes/${encodeURIComponent(handle)}/${action}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': token }, body: '{}' }); const body = (await response.json()) as { ok?: boolean; visualChangeWorkflowId?: string; error?: string }; if (!response.ok || body.ok !== true || body.visualChangeWorkflowId === undefined) { setState({ state: 'failed', message: body.error ?? `operation failed with status ${response.status}` }); return; } setState({ state: 'success', workflowId: body.visualChangeWorkflowId }); return body.visualChangeWorkflowId; }
    catch (error) { setState({ state: 'failed', message: error instanceof Error ? error.message : String(error) }); return; }
  }
  return { state, run };
}
