import type { ObservationArtifact, LayoutRelationshipGraph } from '../types/observation.js';
import type { ObservationRelationshipsState } from '../hooks/useObservationRelationships.js';
import { EvidenceFieldView } from './EvidenceFieldView.js';

function pageField<T>(artifact: ObservationArtifact, key: string) {
  const field = artifact.pageEvidence[key];
  return field as import('../types/observation.js').EvidenceField<T> | undefined;
}

function RelationshipsSection({ relationships, focusTarget }: { relationships: ObservationRelationshipsState; focusTarget: string | undefined }) {
  if (relationships.state === 'idle' || relationships.state === 'loading') {
    return <p className="placeholder-note">Loading relationships…</p>;
  }
  if (relationships.state === 'error') {
    return (
      <p className="inspector__error" role="alert">
        Relationships unavailable: {relationships.message}
      </p>
    );
  }

  const graph: LayoutRelationshipGraph = relationships.graph;
  const pairwise = focusTarget === undefined ? graph.pairwiseRelationships : graph.pairwiseRelationships.filter((r) => r.subjectTarget === focusTarget || r.relatedTarget === focusTarget);

  return (
    <div className="relationships-section">
      <p className="relationships-section__note">Derived evidence (not directly observed) — geometry tolerance {graph.geometryTolerancePx}px.</p>
      {pairwise.length === 0 ? (
        <p className="placeholder-note">No pairwise relationships{focusTarget ? ' involving this target' : ''}.</p>
      ) : (
        <ul className="relationships-section__list">
          {pairwise.map((r) => (
            <li key={`${r.kind}:${r.subjectTarget}:${r.relatedTarget}`}>
              <code>{r.subjectTarget}</code> <strong>{r.kind}</strong> <code>{r.relatedTarget}</code>
            </li>
          ))}
        </ul>
      )}
      {graph.pageRelationships.length > 0 ? (
        <ul className="relationships-section__list">
          {graph.pageRelationships.map((r) => (
            <li key={r.kind}>
              page: <strong>{r.kind}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {graph.unresolvedTargets.length > 0 ? (
        <p className="relationships-section__unresolved">Excluded (no usable geometry): {graph.unresolvedTargets.map((u) => `${u.target} (${u.reason})`).join(', ')}</p>
      ) : null}
    </div>
  );
}

/** Right column: observation-level evidence when nothing is selected; the selected target's full canonical evidence plus its relationships otherwise. Every field honest via EvidenceFieldView - never a fabricated placeholder for missing evidence. */
export function ObservationInspector({
  artifact,
  selectedTargetName,
  relationships,
}: {
  artifact: ObservationArtifact;
  selectedTargetName: string | undefined;
  relationships: ObservationRelationshipsState;
}) {
  const record = selectedTargetName !== undefined ? artifact.targetEvidence[selectedTargetName] : undefined;

  if (selectedTargetName === undefined || record === undefined) {
    return (
      <div className="inspector">
        <h3>Observation</h3>
        <dl className="inspector__fields">
          <div className="evidence-field">
            <dt>Observation id</dt>
            <dd>{artifact.observationId}</dd>
          </div>
          <div className="evidence-field">
            <dt>Request id</dt>
            <dd>{artifact.requestId}</dd>
          </div>
          <div className="evidence-field">
            <dt>Schema version</dt>
            <dd>{artifact.schemaVersion}</dd>
          </div>
          <div className="evidence-field">
            <dt>Producer</dt>
            <dd>
              {artifact.producer.name} {artifact.producer.version}
            </dd>
          </div>
          <div className="evidence-field">
            <dt>Viewport</dt>
            <dd>
              {artifact.requestConfig.viewport.width} × {artifact.requestConfig.viewport.height}
            </dd>
          </div>
          <EvidenceFieldView label="Page title" field={pageField<string>(artifact, 'title')} />
          <EvidenceFieldView label="Requested URL" field={pageField<string>(artifact, 'requestedUrl')} />
          <EvidenceFieldView label="Final URL" field={pageField<string>(artifact, 'finalUrl')} />
          <EvidenceFieldView label="Device pixel ratio" field={pageField<number>(artifact, 'devicePixelRatio')} />
          <EvidenceFieldView label="Document width" field={pageField<number>(artifact, 'documentWidth')} />
          <EvidenceFieldView label="Document height" field={pageField<number>(artifact, 'documentHeight')} />
          <EvidenceFieldView label="Window scroll X" field={pageField<number>(artifact, 'windowScrollX')} />
          <EvidenceFieldView label="Window scroll Y" field={pageField<number>(artifact, 'windowScrollY')} />
          <div className="evidence-field">
            <dt>Completion</dt>
            <dd>{artifact.completion.state}</dd>
          </div>
          <div className="evidence-field">
            <dt>Diagnostics</dt>
            <dd>{artifact.diagnostics.length === 0 ? 'none' : artifact.diagnostics.map((d) => d.code).join(', ')}</dd>
          </div>
        </dl>
        {artifact.scrollScenarioEvidence !== undefined ? (
          <div className="inspector__scroll">
            <h4>Scroll scenario</h4>
            <p>
              Window scroll: ({artifact.scrollScenarioEvidence.transition.windowScrollX.before}, {artifact.scrollScenarioEvidence.transition.windowScrollY.before}) → (
              {artifact.scrollScenarioEvidence.transition.windowScrollX.after}, {artifact.scrollScenarioEvidence.transition.windowScrollY.after})
              {artifact.scrollScenarioEvidence.transition.windowScrollX.changed || artifact.scrollScenarioEvidence.transition.windowScrollY.changed ? '' : ' (unchanged)'}
            </p>
            <EvidenceFieldView label="Scroll owner" field={artifact.scrollScenarioEvidence.scrollOwner} format={(v) => (v.kind === 'target' ? `target: ${v.target}` : v.kind)} />
          </div>
        ) : (
          <p className="placeholder-note">No scroll scenario was configured for this observation.</p>
        )}
        <h4>Relationships</h4>
        <RelationshipsSection relationships={relationships} focusTarget={undefined} />
      </div>
    );
  }

  const resolutionStatus = record.resolution.state === 'available' ? record.resolution.value.selectionStatus : undefined;

  return (
    <div className="inspector">
      <h3>Target: {selectedTargetName}</h3>
      <dl className="inspector__fields">
        <div className="evidence-field">
          <dt>Resolution status</dt>
          <dd>{resolutionStatus ?? 'unavailable'}</dd>
        </div>
        <EvidenceFieldView label="Tag" field={record.tag} />
        <EvidenceFieldView label="Semantics" field={record.semantics} format={(v) => [v.role, v.name].filter(Boolean).join(' / ') || '(no role/name)'} />
        <EvidenceFieldView label="Semantic state" field={record.semanticState} format={(v) => JSON.stringify(v)} />
        <EvidenceFieldView label="Landmark" field={record.landmark} />
        <EvidenceFieldView label="Geometry" field={record.geometry} format={(v) => `x:${v.x} y:${v.y} w:${v.width} h:${v.height}`} />
        <EvidenceFieldView label="Style" field={record.style} format={(v) => `display:${v.display} position:${v.position} overflow-x:${v.overflowX} overflow-y:${v.overflowY}`} />
        <EvidenceFieldView label="Layout metrics" field={record.layout} format={(v) => `scroll:${v.scrollWidth}x${v.scrollHeight} client:${v.clientWidth}x${v.clientHeight} top:${v.scrollTop} left:${v.scrollLeft}`} />
        <EvidenceFieldView label="Visibility" field={record.visibility} format={(v) => (v.visible ? 'visible' : 'not visible')} />
        <EvidenceFieldView label="Containment" field={record.containment} format={(v) => `contained by: ${v.containedByTargetIds.join(', ') || 'none'}`} />
      </dl>
      <h4>Relationships involving this target</h4>
      <RelationshipsSection relationships={relationships} focusTarget={selectedTargetName} />
    </div>
  );
}
