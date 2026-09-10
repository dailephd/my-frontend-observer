import { useEffect, useState } from 'react';
import type { LinkStatus } from '../types/contracts.js';

export type ComparisonViewState = { state: 'idle' } | { state: 'loading' } | { state: 'available'; before: LinkStatus; after: LinkStatus } | { state: 'error'; message: string };

/** Fetches the server-resolved before/after link status (`GET /api/comparisons/<handle>/view`) for a selected comparison - never recomputes comparison evidence itself. */
export function useComparisonView(handle: string | undefined): ComparisonViewState {
  const [state, setState] = useState<ComparisonViewState>({ state: 'idle' });

  useEffect(() => {
    if (handle === undefined) {
      setState({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/comparisons/${handle}/view`, { cache: 'no-store' });
        const body = (await response.json()) as { ok: boolean; before?: LinkStatus; after?: LinkStatus; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.ok || body.before === undefined || body.after === undefined) {
          setState({ state: 'error', message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', before: body.before, after: body.after });
      } catch (err) {
        if (!cancelled) setState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return state;
}

export type EvaluationViewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'available'; comparison: LinkStatus; baseline: LinkStatus; change: LinkStatus; before: LinkStatus; after: LinkStatus }
  | { state: 'error'; message: string };

/** Fetches the server-resolved linked-evidence status (`GET /api/evaluations/<handle>/view`) for a selected evaluation - never recomputes the evaluation itself. */
export function useEvaluationView(handle: string | undefined): EvaluationViewState {
  const [state, setState] = useState<EvaluationViewState>({ state: 'idle' });

  useEffect(() => {
    if (handle === undefined) {
      setState({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/evaluations/${handle}/view`, { cache: 'no-store' });
        const body = (await response.json()) as { ok: boolean; comparison?: LinkStatus; baseline?: LinkStatus; change?: LinkStatus; before?: LinkStatus; after?: LinkStatus; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.ok || body.comparison === undefined || body.baseline === undefined || body.change === undefined || body.before === undefined || body.after === undefined) {
          setState({ state: 'error', message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', comparison: body.comparison, baseline: body.baseline, change: body.change, before: body.before, after: body.after });
      } catch (err) {
        if (!cancelled) setState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return state;
}
