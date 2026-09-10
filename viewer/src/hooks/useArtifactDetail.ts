import { useEffect, useState } from 'react';

export type ArtifactDetailState =
  | { state: 'idle' }
  | { state: 'loading'; handle: string }
  | { state: 'available'; handle: string; family: string; artifact: unknown }
  | { state: 'error'; handle: string; message: string };

/** On-demand full-artifact loading (v0.8 Batch 2): fetches one selected artifact's full payload only when `handle` is set - never eagerly for the whole index. */
export function useArtifactDetail(handle: string | undefined): ArtifactDetailState {
  const [state, setState] = useState<ArtifactDetailState>({ state: 'idle' });

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
        const response = await fetch(`/api/artifacts/${requestedHandle}`, { cache: 'no-store' });
        const body = (await response.json()) as { ok: boolean; family?: string; artifact?: unknown; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.ok) {
          setState({ state: 'error', handle: requestedHandle, message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', handle: requestedHandle, family: body.family as string, artifact: body.artifact });
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
