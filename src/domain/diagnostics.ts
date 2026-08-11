export const DIAGNOSTIC_CODES = [
  'invalid-request',
  'unsupported-configuration',
  'unsafe-url',
  'prohibited-navigation',
  'prohibited-redirect',
  'prohibited-subresource-request',
  'readiness-timeout',
  'navigation-failure',
  'target-missing',
  'target-ambiguous',
  'browser-evidence-unavailable',
  'partial-evidence',
  'bounded-truncated-evidence',
  'artifact-write-failure',
  'browser-runtime-failure',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export type DiagnosticSeverity = 'error' | 'warning';

/** Single source of truth for code->severity; ordering/completion logic must consult this, never a duplicated mapping. */
export const DIAGNOSTIC_SEVERITY: Record<DiagnosticCode, DiagnosticSeverity> = {
  'invalid-request': 'error',
  'unsupported-configuration': 'error',
  'unsafe-url': 'error',
  'prohibited-navigation': 'error',
  'prohibited-redirect': 'error',
  'prohibited-subresource-request': 'error',
  'readiness-timeout': 'warning',
  'navigation-failure': 'error',
  'target-missing': 'warning',
  'target-ambiguous': 'warning',
  'browser-evidence-unavailable': 'warning',
  'partial-evidence': 'warning',
  'bounded-truncated-evidence': 'warning',
  'artifact-write-failure': 'error',
  'browser-runtime-failure': 'error',
};

export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  targetName?: string;
  details?: Record<string, unknown>;
}

/**
 * Deterministic ordering: error before warning, then code, then targetName
 * (absent-first). Pure - returns a new array, never mutates the input.
 */
export function orderDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const severityRank = (d: Diagnostic): number => (d.severity === 'error' ? 0 : 1);
  return [...diagnostics].sort((a, b) => {
    const rankDiff = severityRank(a) - severityRank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const targetA = a.targetName ?? '';
    const targetB = b.targetName ?? '';
    if (targetA !== targetB) return targetA < targetB ? -1 : 1;
    return 0;
  });
}
