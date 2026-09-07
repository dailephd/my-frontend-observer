import type {
  ExternalReferenceArtifact,
  ApprovedExternalReferenceArtifact,
  ImportedExternalReferenceArtifact,
  ReferenceRegion,
  ReferenceRegionRelationshipGraph,
  ExternalReferenceRequirement,
  ReferenceRequirementAdequacy,
} from '../types/reference.js';

const CATEGORY_LABEL: Record<string, string> = { requested: 'Requested', 'expected-dependent': 'Expected-dependent', protected: 'Protected', preserved: 'Preserved' };

/** Local, presentation-only narrowing - see ReferenceWorkspace.tsx's identical helper for why this is not imported at runtime from src/domain. */
function isApproved(artifact: ExternalReferenceArtifact): artifact is ApprovedExternalReferenceArtifact {
  return artifact.lifecycle.state === 'approved';
}
function isImported(artifact: ExternalReferenceArtifact): artifact is ImportedExternalReferenceArtifact {
  return artifact.lifecycle.state === 'imported';
}

function requirementSubjectRegionIds(subject: ExternalReferenceRequirement['subject']): string[] {
  return subject.kind === 'region-property' ? [subject.region] : [subject.subjectRegion, subject.relatedRegion];
}

function toleranceLabel(tolerance: ExternalReferenceRequirement['tolerance']): string {
  if (tolerance === undefined) return 'n/a (categorical relationship)';
  if (tolerance.kind === 'exact') return 'exact';
  if (tolerance.kind === 'absolute-reference-px') return `±${tolerance.amount} reference px`;
  return `±${tolerance.amount}%`;
}

/**
 * Right-column inspector for the reference side: reference-level metadata
 * (lifecycle, provenance, image ownership, applicability, diagnostics,
 * requirement adequacy) when nothing is selected; a selected region's
 * canonical rectangle/derived geometry, relationships involving it, and
 * requirements that reference it, otherwise. Every displayed value comes
 * from the already-fetched artifact/region-relationship-graph/adequacy - no
 * candidate fidelity is ever implied here (task §27/§33).
 */
export function ReferenceInspector({
  artifact,
  selectedRegionId,
  regionRelationships,
  requirementAdequacy,
}: {
  artifact: ExternalReferenceArtifact;
  selectedRegionId: string | undefined;
  regionRelationships: ReferenceRegionRelationshipGraph | undefined;
  requirementAdequacy: ReferenceRequirementAdequacy | undefined;
}) {
  const regions = artifact.regions ?? [];
  const requirements = artifact.requirements ?? [];
  const region: ReferenceRegion | undefined = regions.find((r) => r.id === selectedRegionId);

  if (region === undefined) {
    const approved = isApproved(artifact);
    const approvedAt = isApproved(artifact) ? artifact.lifecycle.approvedAt : undefined;
    const imageInfo = isApproved(artifact)
      ? { ownerLabel: `owned by imported source referenceId ${artifact.sourceReference.referenceId}`, image: artifact.sourceReference.image }
      : isImported(artifact)
        ? { ownerLabel: 'owned by this artifact', image: artifact.image }
        : undefined;
    return (
      <div className="inspector">
        <h3>External reference</h3>
        <dl className="inspector__fields">
          <div className="evidence-field">
            <dt>Reference id</dt>
            <dd>{artifact.referenceId}</dd>
          </div>
          <div className="evidence-field">
            <dt>Reference request id</dt>
            <dd>{artifact.referenceRequestId}</dd>
          </div>
          <div className="evidence-field">
            <dt>Lifecycle</dt>
            <dd>{approved ? `approved (${approvedAt})` : 'imported'}</dd>
          </div>
          <div className="evidence-field">
            <dt>Imported at</dt>
            <dd>{artifact.provenance.importedAt}</dd>
          </div>
          {artifact.provenance.label !== undefined ? (
            <div className="evidence-field">
              <dt>Label</dt>
              <dd>{artifact.provenance.label}</dd>
            </div>
          ) : null}
          <div className="evidence-field">
            <dt>Image</dt>
            <dd>{imageInfo === undefined ? 'unavailable' : `${imageInfo.ownerLabel} (${imageInfo.image.width}×${imageInfo.image.height} ${imageInfo.image.format})`}</dd>
          </div>
          {artifact.supersedesReferenceId !== undefined ? (
            <div className="evidence-field">
              <dt>Supersedes</dt>
              <dd>{artifact.supersedesReferenceId}</dd>
            </div>
          ) : null}
          <div className="evidence-field">
            <dt>Applicability</dt>
            <dd>
              {artifact.applicability === undefined
                ? 'not declared'
                : [
                    artifact.applicability.viewport ? `viewport ${artifact.applicability.viewport.width}×${artifact.applicability.viewport.height}` : undefined,
                    artifact.applicability.theme ? `theme "${artifact.applicability.theme}"` : undefined,
                    artifact.applicability.applicationState ? `applicationState "${artifact.applicability.applicationState}"` : undefined,
                    artifact.applicability.authenticatedState ? `authenticatedState "${artifact.applicability.authenticatedState}"` : undefined,
                  ]
                    .filter((v): v is string => v !== undefined)
                    .join(', ') || 'no dimensions declared'}
            </dd>
          </div>
          <div className="evidence-field">
            <dt>Completion</dt>
            <dd>{artifact.completion.state}</dd>
          </div>
          <div className="evidence-field">
            <dt>Diagnostics</dt>
            <dd>{artifact.diagnostics.length === 0 ? 'none' : artifact.diagnostics.map((d) => d.code).join(', ')}</dd>
          </div>
        </dl>

        <h4>Reference requirement adequacy</h4>
        {requirementAdequacy === undefined ? (
          <p className="placeholder-note">No requirements selected on this reference.</p>
        ) : (
          <div className={`reference-adequacy reference-adequacy--${requirementAdequacy.status}`}>
            <p>
              Status: <strong>{requirementAdequacy.status}</strong> ({requirementAdequacy.evaluableRequirements}/{requirementAdequacy.totalRequirements} evaluable)
            </p>
            {requirementAdequacy.reasons.length > 0 ? (
              <ul>
                {requirementAdequacy.reasons.map((r, i) => (
                  <li key={i}>
                    {r.code}
                    {r.requirementId ? ` (${r.requirementId})` : ''}
                    {r.detail ? `: ${r.detail}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        <h4>Selected requirements ({requirements.length})</h4>
        {requirements.length === 0 ? (
          <p className="placeholder-note">No design requirements selected for this reference.</p>
        ) : (
          <ul className="clause-list">
            {requirements.map((req) => (
              <li key={req.requirementId} className="clause-row">
                <div className="clause-row__id">{req.requirementId}</div>
                <div className="clause-row__category">
                  {CATEGORY_LABEL[req.category] ?? req.category}
                  {req.expectedDependentMode ? ` (${req.expectedDependentMode})` : ''}
                </div>
                <div className="clause-row__primitive">
                  {req.subject.kind === 'region-property'
                    ? `${req.subject.region}.${req.subject.property}`
                    : req.subject.kind === 'region-relationship'
                      ? `${req.subject.subjectRegion} ${req.subject.relationship} ${req.subject.relatedRegion}`
                      : `${req.subject.subjectRegion}↔${req.subject.relatedRegion} ${req.subject.measurement}`}
                  {' — tolerance: '}
                  {toleranceLabel(req.tolerance)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const geometry = {
    x: region.rectangle.x,
    y: region.rectangle.y,
    width: region.rectangle.width,
    height: region.rectangle.height,
    right: region.rectangle.x + region.rectangle.width,
    bottom: region.rectangle.y + region.rectangle.height,
    centerX: region.rectangle.x + region.rectangle.width / 2,
    centerY: region.rectangle.y + region.rectangle.height / 2,
  };
  const involvingRegion = requirements.filter((req) => requirementSubjectRegionIds(req.subject).includes(region.id));
  const relationshipsInvolving = (regionRelationships?.pairwiseRelationships ?? []).filter((r) => r.subjectRegion === region.id || r.relatedRegion === region.id);

  return (
    <div className="inspector">
      <h3>Reference region: {region.id}</h3>
      <dl className="inspector__fields">
        <div className="evidence-field">
          <dt>Rectangle</dt>
          <dd>
            x:{geometry.x} y:{geometry.y} w:{geometry.width} h:{geometry.height}
          </dd>
        </div>
        <div className="evidence-field">
          <dt>Derived geometry</dt>
          <dd>
            right:{geometry.right} bottom:{geometry.bottom} centerX:{geometry.centerX} centerY:{geometry.centerY}
          </dd>
        </div>
      </dl>

      <h4>Relationships involving this region</h4>
      {relationshipsInvolving.length === 0 ? (
        <p className="placeholder-note">No pairwise relationships involving this region.</p>
      ) : (
        <ul className="relationships-section__list">
          {relationshipsInvolving.map((r) => (
            <li key={`${r.kind}:${r.subjectRegion}:${r.relatedRegion}`}>
              <code>{r.subjectRegion}</code> <strong>{r.kind}</strong> <code>{r.relatedRegion}</code>
            </li>
          ))}
        </ul>
      )}

      <h4>Requirements involving this region</h4>
      {involvingRegion.length === 0 ? (
        <p className="placeholder-note">No selected requirements reference this region.</p>
      ) : (
        <ul className="clause-list">
          {involvingRegion.map((req) => (
            <li key={req.requirementId} className="clause-row">
              <div className="clause-row__id">{req.requirementId}</div>
              <div className="clause-row__category">{CATEGORY_LABEL[req.category] ?? req.category}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
