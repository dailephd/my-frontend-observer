import type { Diagnostic } from '../domain/diagnostics.js';
import type { EvidenceField } from '../domain/evidence.js';
import type { TargetEvidenceRecord, ScrollScenarioEvidence } from '../domain/schema.js';

export interface BrowserProvenance {
  engine: string;
  version: string;
}

/**
 * Observer-owned result of the browser boundary. Contains no Playwright
 * object anywhere in its shape - only plain, serializable data.
 */
export type BrowserCaptureResult =
  | {
      ok: true;
      provenance: BrowserProvenance;
      screenshot: Uint8Array;
      pageEvidence: Record<string, EvidenceField<unknown>>;
      targetEvidence: Record<string, TargetEvidenceRecord>;
      diagnostics: Diagnostic[];
      /** v0.3 Batch 2: present only when the request configured a scrollScenario. */
      scrollScenarioEvidence?: ScrollScenarioEvidence;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };
