import { useEffect, useState } from 'react';
import { useEvidenceIndex } from '../hooks/useEvidenceIndex.js';
import { useReferenceView, useReferenceCandidateView, useReferenceBindings } from '../hooks/useReferenceView.js';
import { useArtifactDetail } from '../hooks/useArtifactDetail.js';
import { useZoomPan } from '../hooks/useZoomPan.js';
import type { ZoomPanState } from '../hooks/useZoomPan.js';
import { ReferenceRegionOverlaySvg } from './ReferenceRegionOverlaySvg.js';
import type { ReferenceOverlayToggles } from './ReferenceRegionOverlaySvg.js';
import { ReferenceInspector } from './ReferenceInspector.js';
import { ComparisonObservationPane } from './ComparisonObservationPane.js';
import { ZoomControls } from './ZoomControls.js';
import { ReferenceFidelityPanel } from './ReferenceFidelityPanel.js';
import type { OverlayToggles } from './TargetOverlaySvg.js';
import type { ExternalReferenceArtifact, ExternalReferenceRequirement, ApprovedExternalReferenceArtifact, ImportedExternalReferenceArtifact } from '../types/reference.js';
import type { FrontendContractEvaluationArtifact } from '../types/contracts.js';
import type { ObservationArtifact } from '../types/observation.js';

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

const FITTED_ZOOM: ZoomPanState['scale'] = 1;

/**
 * Batch 6: extends Batch 5's read-only side-by-side reference/candidate
 * inspection with explicit-binding cross-selection, independent bounded
 * zoom/pan, conditional view lock, and on-demand fidelity evaluation - none
 * of which change the read-only, no-inference invariants Batch 5 already
 * established (task §21/§30): cross-selection uses ONLY canonical
 * `ReferenceRuntimeBindingResult.referenceRegion`/`.runtimeTarget` fields
 * from the existing `evaluateReferenceRuntimeBindings`, never name/geometry/
 * order/image similarity. Zoom/pan is presentation-only (never rewrites
 * evidence coordinates - task §24). View lock reuses the exact canonical
 * `deriveCoordinateScale` (exposed from `externalReferenceFidelity.ts`) as
 * its sole source-space mapping - never a second aspect-ratio/scale
 * implementation. Fidelity is evaluated only on explicit user action
 * (`ReferenceFidelityPanel`), never automatically.
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

  const [locked, setLocked] = useState(false);
  const [fidelityHighlight, setFidelityHighlight] = useState<{ regions: string[]; targets: string[] }>({ regions: [], targets: [] });

  useEffect(() => {
    setSelectedRegionId(undefined);
    setCandidateHandle(undefined);
    setSelectedTarget(undefined);
    setSelectedEvaluationHandle(undefined);
    setLocked(false);
    setFidelityHighlight({ regions: [], targets: [] });
  }, [handle]);

  useEffect(() => {
    setSelectedTarget(undefined);
    setSelectedEvaluationHandle(undefined);
    setLocked(false);
    setFidelityHighlight({ regions: [], targets: [] });
  }, [candidateHandle]);

  const candidateView = useReferenceCandidateView(handle, candidateHandle);
  const evaluationDetail = useArtifactDetail(selectedEvaluationHandle);
  const bindingsView = useReferenceBindings(handle, candidateHandle);
  const candidateDetail = useArtifactDetail(candidateHandle);

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
  const candidateArtifact = candidateDetail.state === 'available' ? (candidateDetail.artifact as ObservationArtifact) : undefined;
  const candidateViewport = candidateArtifact?.requestConfig.viewport ?? { width: 1, height: 1 };

  const coordinateMapping = candidateView.state === 'available' ? candidateView.coordinateMapping : undefined;
  const lockEligible =
    candidateHandle !== undefined && candidateView.state === 'available' && candidateView.compatibility.compatibility.state !== 'incomparable' && coordinateMapping?.ok === true;

  useEffect(() => {
    if (locked && !lockEligible) setLocked(false);
  }, [locked, lockEligible]);

  // --- Batch 6 zoom/pan: always-controlled, single-owner state per pane (task §29/§34/§35) ---
  const [refZoom, setRefZoom] = useState<ZoomPanState>({ scale: FITTED_ZOOM, focalX: imageWidth / 2, focalY: imageHeight / 2 });
  const [candZoom, setCandZoom] = useState<ZoomPanState>({ scale: FITTED_ZOOM, focalX: candidateViewport.width / 2, focalY: candidateViewport.height / 2 });

  useEffect(() => {
    setRefZoom({ scale: FITTED_ZOOM, focalX: imageWidth / 2, focalY: imageHeight / 2 });
  }, [imageWidth, imageHeight]);

  useEffect(() => {
    setCandZoom({ scale: FITTED_ZOOM, focalX: candidateViewport.width / 2, focalY: candidateViewport.height / 2 });
  }, [candidateViewport.width, candidateViewport.height]);

  function handleRefZoomChange(next: ZoomPanState): void {
    setRefZoom(next);
    if (locked && coordinateMapping?.ok) {
      setCandZoom({ scale: next.scale, focalX: next.focalX / coordinateMapping.scale.scaleX, focalY: next.focalY / coordinateMapping.scale.scaleY });
    }
  }
  function handleCandZoomChange(next: ZoomPanState): void {
    setCandZoom(next);
    if (locked && coordinateMapping?.ok) {
      setRefZoom({ scale: next.scale, focalX: next.focalX * coordinateMapping.scale.scaleX, focalY: next.focalY * coordinateMapping.scale.scaleY });
    }
  }

  const refZoomPan = useZoomPan(imageWidth, imageHeight, { state: refZoom, onChange: handleRefZoomChange });
  const candZoomPan = useZoomPan(candidateViewport.width, candidateViewport.height, { state: candZoom, onChange: handleCandZoomChange });

  function toggleLock(): void {
    if (locked) {
      setLocked(false);
      return;
    }
    if (!lockEligible || !coordinateMapping?.ok) return;
    setCandZoom({ scale: refZoom.scale, focalX: refZoom.focalX / coordinateMapping.scale.scaleX, focalY: refZoom.focalY / coordinateMapping.scale.scaleY });
    setLocked(true);
  }

  // --- Batch 6 explicit-binding cross-selection (task §19/§20/§21) - canonical fields only ---
  const bindingResults = bindingsView.state === 'available' ? bindingsView.evaluation.bindings : [];

  const candidateHighlightNames = new Set<string>(fidelityHighlight.targets);
  if (selectedRegionId !== undefined) {
    const bound = bindingResults.find((b) => b.status === 'bound' && b.referenceRegion.toLowerCase() === selectedRegionId.toLowerCase());
    if (bound !== undefined) candidateHighlightNames.add(bound.runtimeTarget);
  }

  const regionHighlightIds = new Set<string>(fidelityHighlight.regions);
  if (selectedTarget !== undefined) {
    for (const b of bindingResults) {
      if (b.status === 'bound' && b.runtimeTarget.toLowerCase() === selectedTarget.toLowerCase()) regionHighlightIds.add(b.referenceRegion);
    }
  }

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
          <ZoomControls scale={refZoomPan.scale} onZoomIn={refZoomPan.zoomIn} onZoomOut={refZoomPan.zoomOut} onFit={refZoomPan.fit} onReset={refZoomPan.reset} label="reference" />
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
              highlightRegionIds={regionHighlightIds}
              zoomPan={refZoomPan}
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
              <ZoomControls scale={candZoomPan.scale} onZoomIn={candZoomPan.zoomIn} onZoomOut={candZoomPan.zoomOut} onFit={candZoomPan.fit} onReset={candZoomPan.reset} label="candidate" />
              <div className="reference-workspace__lock">
                <button type="button" onClick={toggleLock} disabled={!lockEligible && !locked} aria-pressed={locked}>
                  {locked ? 'Unlock view' : 'Lock view'}
                </button>
                {!lockEligible && !locked ? (
                  <span className="placeholder-note">
                    Lock unavailable:{' '}
                    {candidateView.state !== 'available'
                      ? 'evaluating compatibility…'
                      : candidateView.compatibility.compatibility.state === 'incomparable'
                        ? 'reference and candidate are incompatible.'
                        : coordinateMapping?.ok === false
                          ? coordinateMapping.reason
                          : 'canonical coordinate mapping unavailable.'}
                  </span>
                ) : null}
              </div>
              <ComparisonObservationPane
                label="Candidate"
                link={{ status: 'resolved', handle: candidateHandle }}
                selectedTarget={selectedTarget}
                onSelectTarget={(name) => {
                  setSelectedTarget(name);
                  setFidelityHighlight({ regions: [], targets: [] });
                }}
                relationships={undefined}
                toggles={candidateToggles}
                highlightNames={candidateHighlightNames}
                zoomPan={candZoomPan}
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

                <h4>Explicit reference-region ↔ runtime-target bindings</h4>
                {bindingsView.state === 'idle' || bindingsView.state === 'loading' ? (
                  <p className="placeholder-note">Evaluating bindings…</p>
                ) : bindingsView.state === 'error' ? (
                  <p className="inspector__error" role="alert">
                    Could not evaluate bindings: {bindingsView.message}
                  </p>
                ) : bindingResults.length === 0 ? (
                  <p className="placeholder-note">
                    {candidateView.compatibility.compatibility.state === 'incomparable'
                      ? 'No binding declarations are evaluated for an incompatible candidate.'
                      : 'No binding declarations were supplied to this viewer session (start it with --bindings-file to declare explicit reference-region ↔ runtime-target correspondences).'}
                  </p>
                ) : (
                  <ul className="clause-list">
                    {bindingResults.map((b) => (
                      <li key={`${b.referenceRegion}:${b.runtimeTarget}`} className={`clause-row clause-row--${b.status === 'bound' ? 'pass' : b.status === 'ambiguous' ? 'conflict' : 'unavailable'}`}>
                        <span className="clause-row__id">
                          {b.referenceRegion} → {b.runtimeTarget}
                        </span>
                        <span className="clause-row__status">{b.status}</span>
                        <p className="clause-row__primitive">
                          {b.reasonCode !== undefined ? `${b.reasonCode}: ` : ''}
                          {b.detail}
                          {b.targetResolutionStatus !== undefined ? ` (targetResolutionStatus: ${b.targetResolutionStatus})` : ''}
                          {b.targetVisible !== undefined ? `, targetVisible: ${b.targetVisible}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

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
                    Frontend contract (from selected existing evaluation): <strong>{evaluationArtifact.overallVerdict}</strong>
                  </div>
                )}

                <h4>Reference fidelity (on demand)</h4>
                <ReferenceFidelityPanel
                  referenceHandle={handle}
                  candidateHandle={candidateHandle}
                  onHighlight={(regionIds, targetNames) => setFidelityHighlight({ regions: regionIds, targets: targetNames })}
                />

                {evaluationArtifact !== undefined ? (
                  <p className="reference-workspace__independence-note">
                    Reference fidelity does not override the active frontend-contract {evaluationArtifact.overallVerdict === 'FAIL' ? 'failure' : 'result'}. These are two separate, independent evidence dimensions - neither is
                    recomputed from the other.
                  </p>
                ) : null}
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
