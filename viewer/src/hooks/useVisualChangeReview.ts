import { useEffect, useState } from 'react';

type ReviewDecision = 'correction-requested'|'accepted'|'abandoned';
export type VisualChangeReviewMutationState = { state: 'idle' } | { state: 'pending' } | { state: 'success'; workflowId: string } | { state: 'failed'; message: string };
export function useVisualChangeReview(handle: string | undefined) {
  const [state, setState] = useState<VisualChangeReviewMutationState>({ state: 'idle' }); useEffect(() => setState({ state: 'idle' }), [handle]);
  async function post(route: 'review'|'governance', token: string, body: unknown): Promise<string | undefined> { if (handle === undefined || state.state === 'pending') return; setState({ state: 'pending' }); try { const response = await fetch(`/api/visual-changes/${encodeURIComponent(handle)}/${route}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': token }, body: JSON.stringify(body) }); const result = (await response.json()) as { ok?: boolean; visualChangeWorkflowId?: string; error?: string }; if (!response.ok || result.ok !== true || result.visualChangeWorkflowId === undefined) { setState({ state: 'failed', message: result.error ?? `${route} failed with status ${response.status}` }); return; } setState({ state: 'success', workflowId: result.visualChangeWorkflowId }); return result.visualChangeWorkflowId; } catch (error) { setState({ state: 'failed', message: error instanceof Error ? error.message : String(error) }); return; } }
  return { state, review: (decision: ReviewDecision, token: string) => post('review', token, { decision }), governance: (kind: 'baseline-approval'|'external-reference-approval', approvalHandle: string, token: string) => post('governance', token, { kind, approvalHandle }) };
}
