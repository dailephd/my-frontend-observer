import { useEffect, useState } from 'react';

export type AuthoringSessionState = { state: 'loading' } | { state: 'read-only' } | { state: 'available'; token: string } | { state: 'error'; message: string };

/**
 * v0.9 Batch 3: reads the Prompt 2 session capability (`GET
 * /api/authoring/session`, `cache: no-store`). The token is kept only in React
 * memory: never written to any browser storage, URL, log, service-worker
 * message, or visible UI. A read-only viewer is a normal state, not an error.
 * A reload always re-acquires the capability from the live server.
 */
export function useAuthoringSession(): AuthoringSessionState {
  const [state, setState] = useState<AuthoringSessionState>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/authoring/session', { cache: 'no-store' });
        const body = (await response.json()) as { ok?: boolean; enabled?: boolean; token?: unknown; error?: string };
        if (cancelled) return;
        if (!response.ok || body.ok !== true) {
          setState({ state: 'error', message: body.error ?? `authoring session request failed with status ${response.status}` });
          return;
        }
        if (body.enabled === true && typeof body.token === 'string' && body.token.length > 0) {
          setState({ state: 'available', token: body.token });
          return;
        }
        setState({ state: 'read-only' });
      } catch (err) {
        if (!cancelled) setState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
