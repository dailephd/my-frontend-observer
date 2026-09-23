import { useEffect, useState } from 'react';

export interface EvidenceMediaSummary {
  role: string;
  available: boolean;
  reason?: string;
}

export interface EvidenceMetadataRecord {
  handle: string;
  family: string;
  supportState: string;
  relativeDir: string;
  alias?: string;
  logicalId?: string;
  schemaVersion?: string;
  foundSchemaVersion?: string;
  producerVersion?: string;
  completion?: { state: string };
  lifecycleState?: string;
  contractClass?: string;
  overallVerdict?: string;
  comparability?: string;
  media?: EvidenceMediaSummary[];
  relatedIds?: Record<string, string>;
  message?: string;
  visualChangeRequestId?: string;
  visualChangeEntryMode?: 'actual-frontend' | 'reference';
  visualChangeAttemptCount?: number;
  latestVisualChangeCheckStatus?: string;
  latestVisualChangeReviewState?: string;
}

export type EvidenceIndexState =
  | { state: 'loading' }
  | { state: 'available'; records: EvidenceMetadataRecord[]; truncated: boolean }
  | { state: 'unavailable'; message: string };

/** Metadata-first evidence index (v0.8 Batch 2): fetches the bounded `/api/index` listing only - never full artifact payloads or media bytes. */
async function fetchEvidenceIndex(): Promise<EvidenceIndexState> {
  try { const response = await fetch('/api/index', { cache: 'no-store' }); if (!response.ok) throw new Error(`index endpoint returned ${response.status}`); const body = (await response.json()) as { ok: boolean; records: EvidenceMetadataRecord[]; truncated: boolean }; return { state: 'available', records: body.records, truncated: body.truncated }; }
  catch (err) { return { state: 'unavailable', message: err instanceof Error ? err.message : String(err) }; }
}

export function useEvidenceIndex(): EvidenceIndexState & { reload: () => void; refresh: () => Promise<EvidenceIndexState> } {
  const [state, setState] = useState<EvidenceIndexState>({ state: 'loading' });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ state: 'loading' });

    async function load(): Promise<void> {
      const next = await fetchEvidenceIndex(); if (!cancelled) setState(next);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [generation]);

  return { ...state, reload: () => setGeneration((g) => g + 1), refresh: async () => { setState({ state: 'loading' }); const next = await fetchEvidenceIndex(); setState(next); return next; } };
}
