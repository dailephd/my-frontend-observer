import { useEffect, useState } from 'react';
import type { LayoutRelationshipGraph } from '../types/observation.js';

export type ObservationRelationshipsState = { state: 'idle' } | { state: 'loading'; handle: string } | { state: 'available'; handle: string; graph: LayoutRelationshipGraph } | { state: 'error'; handle: string; message: string };

/** Fetches the server-computed canonical relationship graph (`GET /api/observations/<handle>/relationships`) for the selected observation - never derived in the browser. */
export function useObservationRelationships(handle: string | undefined): ObservationRelationshipsState {
  const [state, setState] = useState<ObservationRelationshipsState>({ state: 'idle' });

  useEffect(() => {
    if (handle === undefined) {
      setState({ state: 'idle' });
      return;
    }
    const requestedHandle: string = handle;
    let cancelled = false;
    setState({ state: 'loading', handle: requestedHandle });

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/observations/${requestedHandle}/relationships`, { cache: 'no-store' });
        const body = (await response.json()) as { ok: boolean; graph?: LayoutRelationshipGraph; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.ok || body.graph === undefined) {
          setState({ state: 'error', handle: requestedHandle, message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', handle: requestedHandle, graph: body.graph });
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setState({ state: 'error', handle: requestedHandle, message });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return state;
}
