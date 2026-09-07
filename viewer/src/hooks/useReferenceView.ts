import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  ReferenceRegionRelationshipGraph,
  ReferenceRequirementAdequacy,
  ReferenceCandidateCompatibilityResult,
  DeriveCoordinateScaleResult,
  ReferenceRuntimeBindingEvaluation,
  ReferenceCandidateFidelityEvaluation,
} from '../types/reference.js';

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
  | { state: 'available'; compatibility: ReferenceCandidateCompatibilityResult; evaluationHandles: string[]; coordinateMapping: DeriveCoordinateScaleResult }
  | { state: 'error'; message: string };

/**
 * Fetches the server-derived reference/candidate compatibility (through the
 * existing canonical `evaluateReferenceCandidateCompatibility`) and the list
 * of existing evaluation artifacts whose own `after` reference exactly
 * identifies the selected candidate, for explicit optional selection - never
 * auto-selected here. Batch 6 additionally carries `coordinateMapping` - the
 * server's exact `deriveCoordinateScale(reference)` result, used only to
 * gate view-lock eligibility (never a second scale/aspect-ratio check in the
 * browser). Only requested once both a reference and a candidate are
 * explicitly selected.
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
        const body = (await response.json()) as {
          ok: boolean;
          compatibility?: ReferenceCandidateCompatibilityResult;
          evaluationHandles?: string[];
          coordinateMapping?: DeriveCoordinateScaleResult;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.ok || body.compatibility === undefined || body.evaluationHandles === undefined || body.coordinateMapping === undefined) {
          setState({ state: 'error', message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', compatibility: body.compatibility, evaluationHandles: body.evaluationHandles, coordinateMapping: body.coordinateMapping });
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

export type ReferenceBindingsState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'available'; evaluation: ReferenceRuntimeBindingEvaluation }
  | { state: 'error'; message: string };

/**
 * Fetches the server-evaluated binding result (`GET
 * /api/references/<handle>/candidate/<handle>/bindings`) for the session's
 * explicit binding declarations against the selected reference/candidate -
 * through the existing canonical `evaluateReferenceRuntimeBindings`, never
 * recomputed/re-verified in the browser. Auto-loaded (not on-demand) once
 * both a reference and candidate are selected, since cross-selection depends
 * continuously on it.
 */
export function useReferenceBindings(referenceHandle: string | undefined, candidateHandle: string | undefined): ReferenceBindingsState {
  const [state, setState] = useState<ReferenceBindingsState>({ state: 'idle' });

  useEffect(() => {
    if (referenceHandle === undefined || candidateHandle === undefined) {
      setState({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/references/${referenceHandle}/candidate/${candidateHandle}/bindings`, { cache: 'no-store' });
        const body = (await response.json()) as { ok: boolean; evaluation?: ReferenceRuntimeBindingEvaluation; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.ok || body.evaluation === undefined) {
          setState({ state: 'error', message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', evaluation: body.evaluation });
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

export type ReferenceFidelityState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'available'; evaluation: ReferenceCandidateFidelityEvaluation }
  | { state: 'error'; message: string };

/**
 * On-demand (never automatic - task §37) fidelity evaluation trigger:
 * `evaluate()` fetches `GET /api/references/<handle>/candidate/<handle>/fidelity`,
 * which calls the existing canonical `evaluateReferenceCandidateFidelity`
 * exactly once server-side. Resets to `idle` whenever the reference or
 * candidate changes, so a stale result from a different pair is never shown.
 */
export function useReferenceFidelity(referenceHandle: string | undefined, candidateHandle: string | undefined): ReferenceFidelityState & { evaluate: () => void } {
  const [state, setState] = useState<ReferenceFidelityState>({ state: 'idle' });
  // Identifies the reference/candidate pair the most recent `evaluate()` call was made for - an
  // in-flight response is only ever applied while it still matches, so a stale result from a pair the
  // developer has since navigated away from can never overwrite the current selection's state.
  const requestKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    requestKeyRef.current = undefined;
    setState({ state: 'idle' });
  }, [referenceHandle, candidateHandle]);

  const evaluate = useCallback(() => {
    if (referenceHandle === undefined || candidateHandle === undefined) return;
    const key = `${referenceHandle}:${candidateHandle}`;
    requestKeyRef.current = key;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/references/${referenceHandle}/candidate/${candidateHandle}/fidelity`, { cache: 'no-store' });
        const body = (await response.json()) as { ok: boolean; evaluation?: ReferenceCandidateFidelityEvaluation; error?: string };
        if (requestKeyRef.current !== key) return;
        if (!response.ok || !body.ok || body.evaluation === undefined) {
          setState({ state: 'error', message: body.error ?? `request failed with status ${response.status}` });
          return;
        }
        setState({ state: 'available', evaluation: body.evaluation });
      } catch (err) {
        if (requestKeyRef.current === key) setState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }

    void load();
  }, [referenceHandle, candidateHandle]);

  return { ...state, evaluate };
}
