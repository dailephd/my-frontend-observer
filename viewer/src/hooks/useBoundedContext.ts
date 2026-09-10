import { useEffect, useState } from 'react';
import type { BoundedAgentContextArtifact, ContextSourceResolution } from '../types/context.js';

export type BoundedContextState =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'unsupported-version'; foundSchemaVersion: string }
  | { state: 'valid'; artifact: BoundedAgentContextArtifact; sourceResolution: ContextSourceResolution }
  | { state: 'error'; message: string };

/**
 * Fetches the viewer session's bounded-agent-context state exactly once
 * (`GET /api/context`) - the server-side session state established at CLI
 * startup by an optional `--context-file` (Batch 7). Never calls
 * `projectBoundedAgentContext`/`deriveRuntimeStaticCorrelations`/
 * `attachRuntimeStaticCorrelations` itself; only displays whatever the
 * server already validated and returns.
 */
export function useBoundedContext(): BoundedContextState {
  const [state, setState] = useState<BoundedContextState>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/context', { cache: 'no-store' });
        const body = (await response.json()) as {
          ok: boolean;
          status?: string;
          foundSchemaVersion?: string;
          artifact?: BoundedAgentContextArtifact;
          sourceResolution?: ContextSourceResolution;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.ok) {
          setState({ state: 'error', message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        if (body.status === 'none') {
          setState({ state: 'none' });
        } else if (body.status === 'unsupported-version') {
          setState({ state: 'unsupported-version', foundSchemaVersion: body.foundSchemaVersion ?? 'unknown' });
        } else if (body.status === 'valid' && body.artifact !== undefined && body.sourceResolution !== undefined) {
          setState({ state: 'valid', artifact: body.artifact, sourceResolution: body.sourceResolution });
        } else {
          setState({ state: 'error', message: 'unrecognized /api/context response shape' });
        }
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
