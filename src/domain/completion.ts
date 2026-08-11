import type { Diagnostic } from './diagnostics.js';
import { orderDiagnostics } from './diagnostics.js';

/**
 * The "warning" variant is reserved for a future non-blocking diagnostic
 * class; no DiagnosticCode frozen in v0.1 Batch 1 maps to it (see
 * deriveCompletion below - every warning-severity diagnostic produces
 * "partial", never "warning").
 */
export type CompletionState =
  | { state: 'complete' }
  | { state: 'partial'; diagnostics: Diagnostic[] }
  | { state: 'warning'; diagnostics: Diagnostic[] }
  | { state: 'invalid-request'; diagnostics: Diagnostic[] }
  | { state: 'fatal'; diagnostics: Diagnostic[] };

export type RequestPhase = 'pre-capture' | 'post-capture';

/**
 * pre-capture + any diagnostic -> invalid-request (capture never attempted).
 * post-capture + any error-severity diagnostic -> fatal.
 * post-capture + only warning-severity diagnostics -> partial (never silently complete).
 * no diagnostics, either phase -> complete.
 */
export function deriveCompletion(diagnostics: readonly Diagnostic[], requestPhase: RequestPhase): CompletionState {
  const ordered = orderDiagnostics(diagnostics);
  if (ordered.length === 0) {
    return { state: 'complete' };
  }
  if (requestPhase === 'pre-capture') {
    return { state: 'invalid-request', diagnostics: ordered };
  }
  const hasError = ordered.some((diagnostic) => diagnostic.severity === 'error');
  if (hasError) {
    return { state: 'fatal', diagnostics: ordered };
  }
  return { state: 'partial', diagnostics: ordered };
}
