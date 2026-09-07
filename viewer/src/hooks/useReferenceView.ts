import { useEffect, useState } from 'react';
import type { ReferenceRegionRelationshipGraph, ReferenceRequirementAdequacy, ReferenceCandidateCompatibilityResult } from '../types/reference.js';

export type ReferenceViewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'available'; regionRelationships: ReferenceRegionRelationshipGraph | undefined; requirementAdequacy: ReferenceRequirementAdequacy | undefined }
  | { state: 'error'; message: string };

/** Fetches the server-derived region-relationship graph and requirement adequacy for a selected reference (`GET /api/references/<handle>/view`) - never re-derives them in the browser. */
export function useReferenceView(handle: string | undefined): ReferenceViewState {
  const [state, setState] = useState<ReferenceViewState>({ state: 'idle' });

  useEffect(() => {
    if (handle === undefined) {
      setState({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/references/${handle}/view`, { cache: 'no-store' });
        const body = (await response.json()) as {
          ok: boolean;
          regionRelationships?: ReferenceRegionRelationshipGraph | null;
          requirementAdequacy?: ReferenceRequirementAdequacy | null;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.ok) {
          setState({ state: 'error', message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', regionRelationships: body.regionRelationships ?? undefined, requirementAdequacy: body.requirementAdequacy ?? undefined });
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

export type ReferenceCandidateViewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'available'; compatibility: ReferenceCandidateCompatibilityResult; evaluationHandles: string[] }
  | { state: 'error'; message: string };

/**
 * Fetches the server-derived reference/candidate compatibility (through the
 * existing canonical `evaluateReferenceCandidateCompatibility`) and the list
 * of existing evaluation artifacts whose own `after` reference exactly
 * identifies the selected candidate, for explicit optional selection - never
 * auto-selected here. Only requested once both a reference and a candidate
 * are explicitly selected.
 */
export function useReferenceCandidateView(referenceHandle: string | undefined, candidateHandle: string | undefined): ReferenceCandidateViewState {
  const [state, setState] = useState<ReferenceCandidateViewState>({ state: 'idle' });

  useEffect(() => {
    if (referenceHandle === undefined || candidateHandle === undefined) {
      setState({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/references/${referenceHandle}/candidate/${candidateHandle}/view`, { cache: 'no-store' });
        const body = (await response.json()) as { ok: boolean; compatibility?: ReferenceCandidateCompatibilityResult; evaluationHandles?: string[]; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.ok || body.compatibility === undefined || body.evaluationHandles === undefined) {
          setState({ state: 'error', message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', compatibility: body.compatibility, evaluationHandles: body.evaluationHandles });
      } catch (err) {
        if (!cancelled) setState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [referenceHandle, candidateHandle]);

  return state;
}
