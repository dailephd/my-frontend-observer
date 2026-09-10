import { useReferenceFidelity } from '../hooks/useReferenceView.js';
import type { ReferenceRequirementFidelityResult } from '../types/reference.js';

const REQUIREMENT_UNIT_NOTE = 'referenceValue/candidateValue/delta are in reference-image pixels; candidateRawValue is the raw candidate CSS-pixel measurement before coordinate mapping.';

function subjectLabel(subject: ReferenceRequirementFidelityResult['subject']): string {
  if (subject.kind === 'region-property') return `${subject.region}.${subject.property}`;
  if (subject.kind === 'region-relationship') return `${subject.subjectRegion} ${subject.relationship} ${subject.relatedRegion}`;
  return `${subject.subjectRegion}↔${subject.relatedRegion} ${subject.measurement}`;
}

function subjectRegionIds(subject: ReferenceRequirementFidelityResult['subject']): string[] {
  return subject.kind === 'region-property' ? [subject.region] : [subject.subjectRegion, subject.relatedRegion];
}

function toleranceLabel(tolerance: ReferenceRequirementFidelityResult['tolerance']): string {
  if (tolerance === undefined) return '';
  if (tolerance.kind === 'exact') return 'exact';
  if (tolerance.kind === 'absolute-reference-px') return `±${tolerance.amount} reference px`;
  return `±${tolerance.amount}%`;
}

/**
 * Batch 6: the explicit on-demand "Evaluate Fidelity" action (task §37) - a
 * candidate observation's fidelity against a selected reference is never
 * computed automatically merely because a candidate is selected. Renders
 * the exact canonical `evaluateReferenceCandidateFidelity` result: state
 * (not-evaluated/pass/fail), blockedBy, and every requirement result's
 * status/numeric-or-relationship fields exactly as returned - never a
 * client-computed comparison. Clicking a requirement row highlights its
 * canonical reference subject region(s) and `boundRuntimeTargets` only.
 */
export function ReferenceFidelityPanel({
  referenceHandle,
  candidateHandle,
  onHighlight,
}: {
  referenceHandle: string;
  candidateHandle: string;
  onHighlight: (regionIds: string[], targetNames: string[]) => void;
}) {
  const fidelity = useReferenceFidelity(referenceHandle, candidateHandle);

  return (
    <div className="reference-fidelity-panel">
      <div className="reference-fidelity-panel__toolbar">
        <button type="button" onClick={fidelity.evaluate} disabled={fidelity.state === 'loading'}>
          {fidelity.state === 'loading' ? 'Evaluating…' : 'Evaluate Fidelity'}
        </button>
      </div>

      {fidelity.state === 'idle' ? <p className="placeholder-note">Fidelity has not been evaluated yet for this reference/candidate pair. Click "Evaluate Fidelity" to run the canonical evaluator on demand.</p> : null}
      {fidelity.state === 'error' ? (
        <p className="inspector__error" role="alert">
          Fidelity evaluation failed: {fidelity.message}
        </p>
      ) : null}

      {fidelity.state === 'available' ? (
        <>
          <div className={`reference-fidelity-state reference-fidelity-state--${fidelity.evaluation.state}`} role={fidelity.evaluation.state === 'fail' ? 'alert' : undefined}>
            Reference fidelity: <strong>{fidelity.evaluation.state}</strong>
            {fidelity.evaluation.blockedBy !== undefined ? <span> — blocked by: {fidelity.evaluation.blockedBy}</span> : null}
          </div>

          {fidelity.evaluation.state === 'not-evaluated' ? (
            <p className="placeholder-note">
              {fidelity.evaluation.blockedBy === 'reference-inadequate'
                ? `Reference requirement adequacy is "${fidelity.evaluation.adequacy.status}" - no requirement results are evaluated.`
                : fidelity.evaluation.blockedBy === 'incompatible'
                  ? 'Reference/candidate compatibility is incomparable - no requirement results are evaluated.'
                  : 'Evaluation was blocked before any requirement results were produced.'}
            </p>
          ) : (
            <>
              <p className="reference-fidelity-panel__units">{REQUIREMENT_UNIT_NOTE}</p>
              <ul className="clause-list">
                {fidelity.evaluation.requirementResults.map((result) => (
                  <li key={result.requirementId} className={`clause-row clause-row--${result.status === 'pass' ? 'pass' : result.status === 'fail' ? 'fail' : 'unavailable'}`}>
                    <button
                      type="button"
                      className="clause-row__button"
                      onClick={() => onHighlight(subjectRegionIds(result.subject), result.boundRuntimeTargets)}
                      disabled={subjectRegionIds(result.subject).length === 0 && result.boundRuntimeTargets.length === 0}
                    >
                      <span className="clause-row__id">{subjectLabel(result.subject)}</span>
                      <span className="clause-row__category">{result.category}</span>
                      <span className="clause-row__status">{result.status}</span>
                    </button>
                    {result.status === 'unavailable' ? (
                      <p className="clause-row__unresolved">
                        {result.reasonCode}: {result.detail}
                      </p>
                    ) : result.expectedRelationship !== undefined || result.actualRelationship !== undefined ? (
                      <p className="clause-row__primitive">
                        expected: {result.expectedRelationship ?? '(none)'} — actual: {result.actualRelationship ?? '(none)'}
                      </p>
                    ) : (
                      <p className="clause-row__primitive">
                        referenceValue: {result.referenceValue ?? '(n/a)'} — candidateRawValue: {result.candidateRawValue ?? '(n/a)'} — candidateValue: {result.candidateValue ?? '(n/a)'} — delta: {result.delta ?? '(n/a)'} — tolerance:{' '}
                        {toleranceLabel(result.tolerance) || '(n/a)'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
