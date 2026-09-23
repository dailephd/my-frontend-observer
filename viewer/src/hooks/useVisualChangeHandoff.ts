import { useEffect, useState } from 'react';
import type { VisualChangeAgentHandoff, VisualChangeExternalCoordination } from '../../../src/domain/visualChangeAgentHandoff.js';
import { serializeVisualChangeAgentHandoffCanonical } from '../../../src/domain/visualChangeAgentHandoffSerialization.js';

export type VisualChangeHandoffState = { state: 'idle' } | { state: 'preparing' } | { state: 'ready'; handoff: VisualChangeAgentHandoff; message?: string } | { state: 'failed'; message: string };

export function useVisualChangeHandoff(handle: string | undefined) {
  const [state, setState] = useState<VisualChangeHandoffState>({ state: 'idle' });
  useEffect(() => setState({ state: 'idle' }), [handle]);
  async function prepare(token: string, coordination?: VisualChangeExternalCoordination): Promise<void> {
    if (handle === undefined || state.state === 'preparing') return; setState({ state: 'preparing' });
    try {
      const response = await fetch(`/api/visual-changes/${encodeURIComponent(handle)}/prepare-handoff`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-frontend-observer-authoring-token': token }, body: JSON.stringify(coordination === undefined ? {} : { coordination }) });
      const body = (await response.json()) as { ok?: boolean; handoff?: VisualChangeAgentHandoff; error?: string };
      if (!response.ok || body.ok !== true || body.handoff === undefined) { setState({ state: 'failed', message: body.error ?? `handoff preparation failed with status ${response.status}` }); return; }
      setState({ state: 'ready', handoff: body.handoff });
    } catch (error) { setState({ state: 'failed', message: error instanceof Error ? error.message : String(error) }); }
  }
  async function copy(): Promise<void> {
    if (state.state !== 'ready') return; try { await navigator.clipboard.writeText(serializeVisualChangeAgentHandoffCanonical(state.handoff)); setState({ ...state, message: 'Handoff copied.' }); } catch { setState({ state: 'failed', message: 'Clipboard copy failed.' }); }
  }
  function download(): void {
    if (state.state !== 'ready') return; try { const blob = new Blob([serializeVisualChangeAgentHandoffCanonical(state.handoff)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `visual-change-handoff-${state.handoff.visualChangeWorkflowId}.json`; anchor.click(); URL.revokeObjectURL(url); setState({ ...state, message: 'Handoff download started.' }); } catch { setState({ state: 'failed', message: 'Handoff download failed.' }); }
  }
  return { state, prepare, copy, download };
}
