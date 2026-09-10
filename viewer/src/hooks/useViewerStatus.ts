import { useEffect, useState } from 'react';

export interface ViewerStatus {
  ok: true;
  viewerProtocolVersion: string;
  producer: { name: string; version: string };
  root: string;
}

export type ViewerStatusState =
  | { state: 'loading' }
  | { state: 'available'; status: ViewerStatus }
  | { state: 'unavailable'; message: string };

/**
 * Polls the Batch 1 read-only `/api/status` endpoint so the shell can show
 * an honest "local server unavailable" state instead of silently rendering
 * as if a session were active. Never fabricates evidence when the fetch
 * fails.
 */
export function useViewerStatus(pollIntervalMs = 5000): ViewerStatusState {
  const [state, setState] = useState<ViewerStatusState>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error(`status endpoint returned ${response.status}`);
        const status = (await response.json()) as ViewerStatus;
        if (!cancelled) setState({ state: 'available', status });
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setState({ state: 'unavailable', message });
        }
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollIntervalMs]);

  return state;
}
