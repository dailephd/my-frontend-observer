/**
 * v0.7 Prompt 4 reference/candidate compatibility - answers only "does this
 * external reference describe the same frontend state as this candidate
 * ObservationArtifact?" before any later reference-vs-candidate geometry
 * evaluation is attempted (Prompt 6+). This is page/state-level only: no
 * reference-region <-> runtime-target binding (Prompt 5), no geometry
 * difference, no fidelity PASS/FAIL, no style/image comparison.
 *
 * Deliberately reuses domain/comparison.ts's `ComparabilityResult`/
 * `ComparabilityReason`/`ComparabilityState`/`COMPARABILITY_REASON_CODES`/
 * `COMPARABILITY_REASON_SEVERITY` wholesale, and
 * domain/comparisonEngine.ts#assessOptionalComparabilityDimension (the exact
 * same pure rule v0.4's own `evaluateComparability` uses for its explicit-
 * state dimensions) rather than inventing a second compatibility model - an
 * ExternalReferenceArtifact is never treated as if it were an
 * ObservationArtifact, but the *result* and *dimension-comparison rule* are
 * shared.
 */
import type { ExternalReferenceArtifact } from './externalReference.js';
import type { ObservationArtifact } from './schema.js';
import type { ComparabilityResult, ComparabilityReason } from './comparison.js';
import { COMPARABILITY_REASON_CODES } from './comparison.js';
import { assessOptionalComparabilityDimension } from './comparisonEngine.js';

export interface ReferenceCandidateCompatibilityResult {
  referenceId: string;
  referenceRequestId: string;
  candidateObservationId: string;
  candidateRequestId: string;
  compatibility: ComparabilityResult;
}

function viewportLabel(viewport: { width: number; height: number }): string {
  return `${viewport.width}x${viewport.height}`;
}

/**
 * Pure and synchronous: same `(reference, candidate)` in, same result out,
 * every time - no browser, no filesystem, no target binding. Only evaluates
 * `reference.applicability` against `candidate.requestConfig` (viewport,
 * always present on an observation) / `candidate.requestConfig.explicitState`
 * (theme/authenticatedState/applicationState, each independently optional on
 * both sides) - reference region/requirement content is never consulted
 * here (see domain/externalReferenceRequirements.ts for that, a distinct,
 * separate concern - reference adequacy and reference/candidate
 * compatibility are never conflated).
 */
export function evaluateReferenceCandidateCompatibility(reference: ExternalReferenceArtifact, candidate: ObservationArtifact): ReferenceCandidateCompatibilityResult {
  const applicability = reference.applicability;
  const reasons: ComparabilityReason[] = [];

  const referenceViewportLabel = applicability?.viewport ? viewportLabel(applicability.viewport) : undefined;
  const candidateViewportLabel = viewportLabel(candidate.requestConfig.viewport);
  const viewportReason = assessOptionalComparabilityDimension(
    'viewport-mismatch',
    'viewport-unassessed',
    referenceViewportLabel,
    candidateViewportLabel,
    (r, c) => `reference applicable viewport ${r} differs from candidate viewport ${c}`,
    'reference does not declare an applicable viewport',
  );
  if (viewportReason) reasons.push(viewportReason);

  const candidateState = candidate.requestConfig.explicitState;

  const themeReason = assessOptionalComparabilityDimension(
    'theme-mismatch',
    'theme-unassessed',
    applicability?.theme,
    candidateState?.theme,
    (r, c) => `reference applicable theme "${r}" differs from candidate explicit theme "${c}"`,
    'theme identity is not assessed unless both the reference applicability and the candidate observation declare it',
  );
  if (themeReason) reasons.push(themeReason);

  const authReason = assessOptionalComparabilityDimension(
    'authenticated-state-mismatch',
    'authenticated-state-unassessed',
    applicability?.authenticatedState,
    candidateState?.authenticatedState,
    (r, c) => `reference applicable authenticatedState "${r}" differs from candidate explicit authenticatedState "${c}"`,
    'authenticated-state identity is not assessed unless both the reference applicability and the candidate observation declare it',
  );
  if (authReason) reasons.push(authReason);

  const appStateReason = assessOptionalComparabilityDimension(
    'application-state-mismatch',
    'application-state-unassessed',
    applicability?.applicationState,
    candidateState?.applicationState,
    (r, c) => `reference applicable applicationState "${r}" differs from candidate explicit applicationState "${c}"`,
    'application-state identity is not assessed unless both the reference applicability and the candidate observation declare it',
  );
  if (appStateReason) reasons.push(appStateReason);

  // Deterministic ordering, reusing the exact same shared code-index rule v0.4's evaluateComparability uses.
  reasons.sort((a, b) => COMPARABILITY_REASON_CODES.indexOf(a.code) - COMPARABILITY_REASON_CODES.indexOf(b.code));

  const hasBlocking = reasons.some((reason) => reason.severity === 'blocking');
  const hasWarning = reasons.some((reason) => reason.severity === 'warning');
  const state: ComparabilityResult['state'] = hasBlocking ? 'incomparable' : hasWarning ? 'comparable-with-warnings' : 'comparable';

  return {
    referenceId: reference.referenceId,
    referenceRequestId: reference.referenceRequestId,
    candidateObservationId: candidate.observationId,
    candidateRequestId: candidate.requestId,
    compatibility: { state, reasons },
  };
}
