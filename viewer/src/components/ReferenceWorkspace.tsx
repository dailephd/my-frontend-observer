import { useEffect, useState } from 'react';
import { useEvidenceIndex } from '../hooks/useEvidenceIndex.js';
import { useReferenceView, useReferenceCandidateView } from '../hooks/useReferenceView.js';
import { useArtifactDetail } from '../hooks/useArtifactDetail.js';
import { ReferenceRegionOverlaySvg } from './ReferenceRegionOverlaySvg.js';
import type { ReferenceOverlayToggles } from './ReferenceRegionOverlaySvg.js';
import { ReferenceInspector } from './ReferenceInspector.js';
import { ComparisonObservationPane } from './ComparisonObservationPane.js';
import type { OverlayToggles } from './TargetOverlaySvg.js';
import type { ExternalReferenceArtifact, ExternalReferenceRequirement, ApprovedExternalReferenceArtifact, ImportedExternalReferenceArtifact } from '../types/reference.js';
import type { FrontendContractEvaluationArtifact } from '../types/contracts.js';

function requirementSubjectRegionIds(subject: ExternalReferenceRequirement['subject']): string[] {
  return subject.kind === 'region-property' ? [subject.region] : [subject.subjectRegion, subject.relatedRegion];
}

/** Local, presentation-only narrowing (mirrors externalReference.ts's own isApprovedExternalReferenceArtifact - not imported at runtime to keep this module type-only-coupled to src/domain, per the rest of viewer/src/types/*). */
function isApproved(artifact: ExternalReferenceArtifact): artifact is ApprovedExternalReferenceArtifact {
  return artifact.lifecycle.state === 'approved';
}
function isImported(artifact: ExternalReferenceArtifact): artifact is ImportedExternalReferenceArtifact {
  return artifact.lifecycle.state === 'imported';
}

/**
 * Batch 5: read-only side-by-side reference/candidate inspection. Left pane
 * renders the reference image in its own pixel coordinate domain with
 * region overlays (`ReferenceRegionOverlaySvg`); right pane, once a
 * candidate observation is EXPLICITLY selected (never auto-selected - task
 * §22), reuses Batch 3/4's exact `ComparisonObservationPane`/
 * `TargetOverlaySvg` runtime-coordinate machinery unchanged. Reference-
 * region selection and runtime-target selection are two independent pieces
 * of state that are never synchronized or cross-highlighted (task §30) -
 * this is the explicit-binding boundary Batch 6 owns. Compatibility comes
 * from the existing canonical `evaluateReferenceCandidateCompatibility` via
 * `/api/references/<handle>/candidate/<handle>/view`; fidelity is never
 * computed here (task §32/§33) - only an honest "not evaluated" state, or,
 * if the developer explicitly picks one of the exactly-matching existing
 * evaluation artifacts, that artifact's own already-persisted verdict.
 */
export function ReferenceWorkspace({ handle, artifact }: { handle: string; artifact: ExternalReferenceArtifact }) {
  const referenceView = useReferenceView(handle);
  const index = useEvidenceIndex();

  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);
  const [referenceToggles, setReferenceToggles] = useState<ReferenceOverlayToggles>({ regions: true, labels: true, relationships: true });

  const [candidateHandle, setCandidateHandle] = useState<string | undefined>(undefined);
  const [selectedTarget, setSelectedTarget] = useState<string | undefined>(undefined);
  const [candidateToggles, setCandidateToggles] = useState<OverlayToggles>({ geometry: true, labels: true, relationships: true });
  const [selectedEvaluationHandle, setSelectedEvaluationHandle] = useState<string | undefined>(undefined);

  useEffect(() => {
    setSelectedRegionId(undefined);
    setCandidateHandle(undefined);
    setSelectedTarget(undefined);
    setSelectedEvaluationHandle(undefined);
  }, [handle]);

  useEffect(() => {
    setSelectedTarget(undefined);
    setSelectedEvaluationHandle(undefined);
  }, [candidateHandle]);

  const candidateView = useReferenceCandidateView(handle, candidateHandle);
  const evaluationDetail = useArtifactDetail(selectedEvaluationHandle);

  const approved = isApproved(artifact);
  const imported = isImported(artifact);
  const imageWidth = approved ? artifact.sourceReference.image.width : imported ? artifact.image.width : 0;
  const imageHeight = approved ? artifact.sourceReference.image.height : imported ? artifact.image.height : 0;
  const imageUrl = `/api/media/${handle}/${approved ? 'source-image' : 'image'}`;
  const regions = artifact.regions ?? [];

  const requirementRegionIds = new Set<string>();
  for (const req of artifact.requirements ?? []) for (const id of requirementSubjectRegionIds(req.subject)) requirementRegionIds.add(id);

  const candidateRecords = index.state === 'available' ? index.records.filter((r) => r.family === 'observation' && r.supportState === 'supported') : [];

  const regionRelationships = referenceView.state === 'available' ? referenceView.regionRelationships : undefined;
  const requirementAdequacy = referenceView.state === 'available' ? referenceView.requirementAdequacy : undefined;

  const evaluationArtifact = evaluationDetail.state === 'available' ? (evaluationDetail.artifact as FrontendContractEvaluationArtifact) : undefined;

  return (
    <div className="reference-workspace">
      <div className="reference-workspace__panes">
        <div className="reference-pane">
          <h4 className="comparison-pane__label">Reference{approved ? ' (approved)' : ' (imported)'}</h4>
          <div className="observation-workspace__toolbar" role="group" aria-label="Reference overlay toggles">
            <label>
              <input type="checkbox" checked={referenceToggles.regions} onChange={(e) => setReferenceToggles((t) => ({ ...t, regions: e.target.checked }))} />
              Regions
            </label>
            <label>
              <input type="checkbox" checked={referenceToggles.labels} onChange={(e) => setReferenceToggles((t) => ({ ...t, labels: e.target.checked }))} disabled={!referenceToggles.regions} />
              Labels
            </label>
            <label>
              <input type="checkbox" checked={referenceToggles.relationships} onChange={(e) => setReferenceToggles((t) => ({ ...t, relationships: e.target.checked }))} />
              Relationships
            </label>
          </div>
          <div className="comparison-pane">
            <ReferenceRegionOverlaySvg
              imageUrl={imageUrl}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              regions={regions}
              relationships={regionRelationships}
              selected={selectedRegionId}
              onSelect={setSelectedRegionId}
              toggles={referenceToggles}
              requirementRegionIds={requirementRegionIds}
            />
          </div>
        </div>

        <div className="reference-pane">
          <div className="reference-workspace__candidate-select">
            <label htmlFor="reference-candidate-select">Select candidate observation explicitly</label>
            <select id="reference-candidate-select" value={candidateHandle ?? ''} onChange={(e) => setCandidateHandle(e.target.value.length === 0 ? undefined : e.target.value)}>
              <option value="">(none selected)</option>
              {candidateRecords.map((r) => (
                <option key={r.handle} value={r.handle}>
                  {r.logicalId ?? r.relativeDir}
                </option>
              ))}
            </select>
          </div>

          {candidateHandle === undefined ? (
            <p className="placeholder-note">No candidate selected. Compatibility and side-by-side inspection are not evaluated until you explicitly choose one.</p>
          ) : (
            <>
              <div className="observation-workspace__toolbar" role="group" aria-label="Candidate overlay toggles">
                <label>
                  <input type="checkbox" checked={candidateToggles.geometry} onChange={(e) => setCandidateToggles((t) => ({ ...t, geometry: e.target.checked }))} />
                  Targets
                </label>
                <label>
                  <input type="checkbox" checked={candidateToggles.labels} onChange={(e) => setCandidateToggles((t) => ({ ...t, labels: e.target.checked }))} disabled={!candidateToggles.geometry} />
                  Labels
                </label>
                <label>
                  <input type="checkbox" checked={candidateToggles.relationships} onChange={(e) => setCandidateToggles((t) => ({ ...t, relationships: e.target.checked }))} />
                  Relationships
                </label>
              </div>
              <ComparisonObservationPane
                label="Candidate"
                link={{ status: 'resolved', handle: candidateHandle }}
                selectedTarget={selectedTarget}
                onSelectTarget={setSelectedTarget}
                relationships={undefined}
                toggles={candidateToggles}
              />
            </>
          )}
        </div>
      </div>

      <div className="reference-workspace__details comparison-workspace__details">
        {candidateHandle !== undefined ? (
          <section>
            <h4>Reference/candidate compatibility</h4>
            {candidateView.state === 'idle' || candidateView.state === 'loading' ? (
              <p className="placeholder-note">Evaluating compatibility…</p>
            ) : candidateView.state === 'error' ? (
              <p className="inspector__error" role="alert">
                Could not evaluate compatibility: {candidateView.message}
              </p>
            ) : (
              <>
                <div className={`comparability-banner comparability-banner--${candidateView.compatibility.compatibility.state}`} role={candidateView.compatibility.compatibility.state === 'incomparable' ? 'alert' : undefined}>
                  <strong>{candidateView.compatibility.compatibility.state}</strong>
                  {candidateView.compatibility.compatibility.reasons.length > 0 ? (
                    <ul>
                      {candidateView.compatibility.compatibility.reasons.map((r, i) => (
                        <li key={i} className={`comparability-reason--${r.severity}`}>
                          [{r.code}] {r.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <h4>Optional contract/evaluation context</h4>
                {candidateView.evaluationHandles.length === 0 ? (
                  <p className="placeholder-note">No existing evaluation artifact's "after" observation exactly identifies this candidate.</p>
                ) : (
                  <div className="reference-workspace__evaluation-select">
                    <label htmlFor="reference-evaluation-select">
                      {candidateView.evaluationHandles.length > 1 ? `${candidateView.evaluationHandles.length} matching evaluations found — select one explicitly` : 'One matching evaluation found — select to view'}
                    </label>
                    <select id="reference-evaluation-select" value={selectedEvaluationHandle ?? ''} onChange={(e) => setSelectedEvaluationHandle(e.target.value.length === 0 ? undefined : e.target.value)}>
                      <option value="">(not selected)</option>
                      {candidateView.evaluationHandles.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {selectedEvaluationHandle === undefined ? (
                  <p className="placeholder-note">Candidate contract status: not selected/not available. (Never treated as PASS by default.)</p>
                ) : evaluationArtifact === undefined ? (
                  <p className="placeholder-note">Loading evaluation…</p>
                ) : (
                  <div className={`overall-verdict overall-verdict--${evaluationArtifact.overallVerdict}`} role={evaluationArtifact.overallVerdict === 'FAIL' ? 'alert' : undefined}>
                    Overall verdict (from selected existing evaluation): <strong>{evaluationArtifact.overallVerdict}</strong>
                  </div>
                )}

                <p className="placeholder-note">
                  Fidelity: not evaluated in this batch — on-demand reference/candidate fidelity evaluation is Batch 6. Compatibility {candidateView.compatibility.compatibility.state === 'incomparable' ? 'blocked' : 'passing'} above is not
                  a fidelity result.
                </p>
              </>
            )}
          </section>
        ) : null}

        <section>
          <ReferenceInspector artifact={artifact} selectedRegionId={selectedRegionId} regionRelationships={regionRelationships} requirementAdequacy={requirementAdequacy} />
        </section>
      </div>
    </div>
  );
}
