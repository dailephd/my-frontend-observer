import { useState } from 'react';
import { useBoundedContext } from '../hooks/useBoundedContext.js';
import { useArtifactDetail } from '../hooks/useArtifactDetail.js';
import { RawEvidenceViewer } from './RawEvidenceViewer.js';
import { ReferenceFidelityPanel } from './ReferenceFidelityPanel.js';
import type { EvidenceMetadataRecord } from '../hooks/useEvidenceIndex.js';
import type {
  BoundedAgentContextArtifact,
  BoundedRuntimeTargetProjection,
  RuntimeStaticCorrelationRecord,
  OmissionRecord,
  TruncationRecord,
  LinkStatus,
  ContextSourceResolution,
} from '../types/context.js';
import type { ObservationArtifact } from '../types/observation.js';

function linkLabel(link: LinkStatus | undefined): string {
  if (link === undefined) return 'not referenced by this context';
  if (link.status === 'resolved') return 'resolved';
  if (link.status === 'ambiguous') return `ambiguous (${link.count} exact matches)`;
  return 'missing';
}

function SourceLinkRow({
  label,
  link,
  index,
  onNavigate,
}: {
  label: string;
  link: LinkStatus | undefined;
  index: EvidenceMetadataRecord[];
  onNavigate: (record: EvidenceMetadataRecord) => void;
}) {
  const record = link?.status === 'resolved' ? index.find((r) => r.handle === link.handle) : undefined;
  return (
    <div className="context-source-row">
      <span className="context-source-row__label">{label}:</span>
      <span className={`context-source-row__status context-source-row__status--${link?.status ?? 'absent'}`}>{linkLabel(link)}</span>
      {record !== undefined ? (
        <button type="button" onClick={() => onNavigate(record)}>
          Open in evidence view
        </button>
      ) : null}
      <RawEvidenceViewer label={label} link={link} />
    </div>
  );
}

/** Whether a resolved source observation's already-fetched full artifact configures the given stable target id - a plain membership check over already-loaded JSON, never a new derivation. */
function SourceObservationTargetCheck({ label, handle, targetId, onNavigate, index }: { label: string; handle: string; targetId: string; onNavigate: (record: EvidenceMetadataRecord) => void; index: EvidenceMetadataRecord[] }) {
  const detail = useArtifactDetail(handle);
  if (detail.state !== 'available') return null;
  const artifact = detail.artifact as ObservationArtifact;
  const hasTarget = artifact.targetEvidence[targetId] !== undefined;
  if (!hasTarget) return null;
  const record = index.find((r) => r.handle === handle);
  return (
    <li>
      {label} contains target "{targetId}".{' '}
      {record !== undefined ? (
        <button type="button" onClick={() => onNavigate(record)}>
          Open observation and highlight target
        </button>
      ) : null}
    </li>
  );
}

/**
 * Batch 7: dedicated bounded-agent-context/provenance inspection mode (task
 * §58). Renders EXACTLY the context the viewer session was started with
 * (`GET /api/context`) - never recomputes/rebuilds it
 * (`projectBoundedAgentContext`), never derives/re-derives correlation
 * (`deriveRuntimeStaticCorrelations`/`attachRuntimeStaticCorrelations`), and
 * never runs my-dev-kit. Source references are resolved by the server
 * through exact canonical identity only (`contextSourceView.ts`); raw
 * structured evidence reuses the existing Batch 2 artifact-detail route via
 * `RawEvidenceViewer`. All UI text is audited to avoid ownership/edit-
 * authorization language (task §63) - correlation is presented as evidence,
 * never as "owner"/"source owner"/"owned by".
 */
export function ContextWorkspace({ index, onNavigate }: { index: EvidenceMetadataRecord[]; onNavigate: (record: EvidenceMetadataRecord) => void }) {
  const context = useBoundedContext();
  const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>(undefined);

  if (context.state === 'loading') {
    return <p className="placeholder-note">Loading bounded context session state…</p>;
  }
  if (context.state === 'error') {
    return (
      <div className="inspector__error" role="alert">
        Could not load bounded context: {context.message}
      </div>
    );
  }
  if (context.state === 'none') {
    return <p className="placeholder-note">No bounded agent context was supplied to this viewer session. Start the viewer with --context-file to inspect one.</p>;
  }
  if (context.state === 'unsupported-version') {
    return (
      <div className="context-workspace">
        <p className="inspector__error" role="alert">
          The supplied context has artifactKind "my-frontend-observer/bounded-agent-context" but schemaVersion "{context.foundSchemaVersion}", which this viewer does not currently support. It is not interpreted as the current
          context shape.
        </p>
      </div>
    );
  }

  const artifact: BoundedAgentContextArtifact = context.artifact;
  const sourceResolution: ContextSourceResolution = context.sourceResolution;

  const requiredOmissions = artifact.omissions.filter((o) => o.required);
  const optionalOmissions = artifact.omissions.filter((o) => !o.required);
  const requiredTruncations = artifact.truncations.filter((t) => t.required);
  const optionalTruncations = artifact.truncations.filter((t) => !t.required);

  const correlationByTarget = new Map((artifact.correlations ?? []).map((c) => [c.runtimeTargetId, c] as const));
  const selectedCorrelation = selectedTargetId !== undefined ? correlationByTarget.get(selectedTargetId) : undefined;

  const referenceLink = sourceResolution.reference;
  const referenceHandle = referenceLink?.status === 'resolved' ? referenceLink.handle : undefined;
  const fidelityCandidateObservation = artifact.fidelity !== undefined ? sourceResolution.observations.find((o) => o.observationId === artifact.fidelity!.candidateObservationId) : undefined;
  const fidelityCandidateHandle = fidelityCandidateObservation?.link.status === 'resolved' ? fidelityCandidateObservation.link.handle : undefined;

  return (
    <div className="context-workspace">
      <section className="context-workspace__summary">
        <h3>Bounded agent context</h3>
        <dl className="context-summary-grid">
          <dt>Projection profile</dt>
          <dd>{artifact.projectionProfile}</dd>
          <dt>Adequacy</dt>
          <dd className={`context-adequacy-badge context-adequacy-badge--${artifact.adequacy.state}`}>{artifact.adequacy.state}</dd>
          <dt>Targets</dt>
          <dd>{artifact.targets.length}</dd>
          <dt>Omissions</dt>
          <dd>
            {artifact.omissions.length} ({requiredOmissions.length} required)
          </dd>
          <dt>Truncations</dt>
          <dd>
            {artifact.truncations.length} ({requiredTruncations.length} required)
          </dd>
          <dt>Correlation</dt>
          <dd>{artifact.correlations !== undefined ? `included (${artifact.correlations.length} record(s))` : 'not included'}</dd>
          <dt>Fidelity projection</dt>
          <dd>{artifact.fidelity !== undefined ? 'included' : 'not included'}</dd>
        </dl>
      </section>

      <section>
        <h4>Identity</h4>
        <dl className="inspector__fields">
          <div className="evidence-field">
            <dt>artifactKind</dt>
            <dd>{artifact.artifactKind}</dd>
          </div>
          <div className="evidence-field">
            <dt>schemaVersion</dt>
            <dd>{artifact.schemaVersion}</dd>
          </div>
          <div className="evidence-field">
            <dt>contextId</dt>
            <dd>{artifact.contextId}</dd>
          </div>
          <div className="evidence-field">
            <dt>contextRequestId</dt>
            <dd>{artifact.contextRequestId}</dd>
          </div>
          <div className="evidence-field">
            <dt>producer</dt>
            <dd>
              {artifact.producer.name} {artifact.producer.version}
            </dd>
          </div>
          <div className="evidence-field">
            <dt>provenance.generatedAt</dt>
            <dd>{artifact.provenance.generatedAt}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h4>Adequacy reasons</h4>
        {artifact.adequacy.reasons.length === 0 ? (
          <p className="placeholder-note">No adequacy reasons recorded (adequate).</p>
        ) : (
          <ul className="clause-list">
            {artifact.adequacy.reasons.map((r, i) => (
              <li key={i} className="clause-row clause-row--fail">
                <span className="clause-row__id">{r.code}</span>
                {r.detail ? <p className="clause-row__primitive">{r.detail}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>Source references</h4>
        <div className="context-sources">
          {artifact.sources.observationIds.map((observationId) => {
            const link = sourceResolution.observations.find((o) => o.observationId === observationId)?.link;
            return <SourceLinkRow key={observationId} label={`observation:${observationId}`} link={link} index={index} onNavigate={onNavigate} />;
          })}
          {artifact.sources.comparisonId !== undefined ? <SourceLinkRow label={`comparison:${artifact.sources.comparisonId}`} link={sourceResolution.comparison} index={index} onNavigate={onNavigate} /> : null}
          {artifact.sources.baselineContractId !== undefined ? (
            <SourceLinkRow label={`baselineContract:${artifact.sources.baselineContractId}`} link={sourceResolution.baselineContract} index={index} onNavigate={onNavigate} />
          ) : null}
          {artifact.sources.changeContractId !== undefined ? <SourceLinkRow label={`changeContract:${artifact.sources.changeContractId}`} link={sourceResolution.changeContract} index={index} onNavigate={onNavigate} /> : null}
          {artifact.sources.evaluationId !== undefined ? <SourceLinkRow label={`evaluation:${artifact.sources.evaluationId}`} link={sourceResolution.evaluation} index={index} onNavigate={onNavigate} /> : null}
          {artifact.sources.referenceId !== undefined ? <SourceLinkRow label={`reference:${artifact.sources.referenceId}`} link={sourceResolution.reference} index={index} onNavigate={onNavigate} /> : null}
        </div>
      </section>

      <section>
        <h4>Bounded runtime targets ({artifact.targets.length})</h4>
        <ul className="clause-list">
          {artifact.targets.map((t: BoundedRuntimeTargetProjection) => {
            const correlation = correlationByTarget.get(t.targetId);
            return (
              <li key={t.targetId} className={`clause-row ${t.targetId === selectedTargetId ? 'clause-row--pass' : ''}`}>
                <button type="button" className="clause-row__button" onClick={() => setSelectedTargetId(t.targetId === selectedTargetId ? undefined : t.targetId)}>
                  <span className="clause-row__id">{t.targetId}</span>
                  {correlation !== undefined ? <span className="clause-row__status">correlation: {correlation.status}</span> : null}
                </button>
                <p className="clause-row__primitive">
                  geometry: {t.geometry !== undefined ? `x:${t.geometry.x} y:${t.geometry.y} w:${t.geometry.width} h:${t.geometry.height}` : 'not included in this bounded context'} — visibility:{' '}
                  {t.visibility !== undefined ? (t.visibility.visible ? 'visible' : 'not visible') : 'not included in this bounded context'} — overflow:{' '}
                  {t.overflow !== undefined ? `h:${t.overflow.horizontalOverflow} v:${t.overflow.verticalOverflow}` : 'not included in this bounded context'} — scrollOwner:{' '}
                  {t.scrollOwner !== undefined ? t.scrollOwner.kind : 'not included in this bounded context'} — relationshipEvidence: {t.relationshipEvidence?.length ?? 0} ref(s) — screenshotRef:{' '}
                  {t.screenshotRef !== undefined ? t.screenshotRef.path : 'not included in this bounded context'}
                </p>
                {t.targetId === selectedTargetId ? (
                  <ul className="context-target-source-list">
                    {sourceResolution.observations
                      .filter((o) => o.link.status === 'resolved')
                      .map((o) => (
                        <SourceObservationTargetCheck key={o.observationId} label={`observation:${o.observationId}`} handle={(o.link as { handle: string }).handle} targetId={t.targetId} onNavigate={onNavigate} index={index} />
                      ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h4>Runtime/static correlation</h4>
        {artifact.correlations === undefined ? (
          <p className="placeholder-note">Static correlation not included in this context.</p>
        ) : (
          <ul className="clause-list">
            {artifact.correlations.map((c: RuntimeStaticCorrelationRecord) => (
              <li
                key={c.runtimeTargetId}
                className={`clause-row ${c.status === 'correlated' ? 'clause-row--pass' : c.status === 'ambiguous' ? 'clause-row--conflict' : 'clause-row--unavailable'} ${c.runtimeTargetId === selectedTargetId ? 'context-correlation-row--selected' : ''}`}
              >
                <button type="button" className="clause-row__button" onClick={() => setSelectedTargetId(c.runtimeTargetId === selectedTargetId ? undefined : c.runtimeTargetId)}>
                  <span className="clause-row__id">{c.runtimeTargetId}</span>
                  <span className="clause-row__status">{c.status}</span>
                </button>
                <p className="clause-row__primitive">
                  static producer: {c.staticProducer.name} {c.staticProducer.version} (indexId: {c.staticProducer.indexId})
                </p>
                {c.status === 'correlated' ? (
                  <div>
                    <p className="context-correlation-heading">Correlated candidate:</p>
                    <ul>
                      {c.candidates.map((cand) => (
                        <li key={cand.candidateId}>
                          <code>{cand.candidateId}</code> ({cand.kind}) — {cand.evidenceRefs.length} evidence ref(s)
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : c.status === 'ambiguous' ? (
                  <div>
                    <p className="context-correlation-heading">Ambiguous candidates (every bounded candidate is shown; none is chosen over the others):</p>
                    <ul>
                      {c.candidates.map((cand) => (
                        <li key={cand.candidateId}>
                          <code>{cand.candidateId}</code> ({cand.kind}) — {cand.evidenceRefs.length} evidence ref(s)
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="context-correlation-heading">No static candidate available for this correlation.</p>
                )}
                {c.evidenceBasis !== undefined ? <p className="clause-row__primitive">Evidence basis: {c.evidenceBasis}</p> : null}
                {c.omissions !== undefined && c.omissions.length > 0 ? (
                  <p className="clause-row__unresolved">Correlation-level omissions: {c.omissions.map((o) => `${o.subject} (${o.reason}${o.required ? ', required' : ''})`).join('; ')}</p>
                ) : null}
                {c.truncations !== undefined && c.truncations.length > 0 ? (
                  <p className="clause-row__unresolved">
                    Correlation-level truncations: {c.truncations.map((t) => `${t.subject} (limit ${t.limit}, actual ${t.actualCount}${t.required ? ', required' : ''})`).join('; ')}
                  </p>
                ) : null}
                <p className="clause-row__primitive">provenance.correlatedAt: {c.provenance.correlatedAt}</p>
              </li>
            ))}
          </ul>
        )}
        {selectedCorrelation === undefined && selectedTargetId !== undefined ? <p className="placeholder-note">No correlation record for the selected target.</p> : null}
      </section>

      <section>
        <h4>Omissions ({artifact.omissions.length})</h4>
        {artifact.omissions.length === 0 ? (
          <p className="placeholder-note">No omissions recorded.</p>
        ) : (
          <>
            {requiredOmissions.length > 0 ? (
              <div className="context-required-loss" role="alert">
                <strong>Required evidence loss ({requiredOmissions.length}):</strong>
                <ul>
                  {requiredOmissions.map((o: OmissionRecord, i) => (
                    <li key={i}>
                      {o.subject} — {o.reason}
                      {o.detail ? `: ${o.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {optionalOmissions.length > 0 ? (
              <div>
                <p>Optional omissions ({optionalOmissions.length}):</p>
                <ul>
                  {optionalOmissions.map((o: OmissionRecord, i) => (
                    <li key={i}>
                      {o.subject} — {o.reason}
                      {o.detail ? `: ${o.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section>
        <h4>Truncations ({artifact.truncations.length})</h4>
        {artifact.truncations.length === 0 ? (
          <p className="placeholder-note">No truncations recorded.</p>
        ) : (
          <>
            {requiredTruncations.length > 0 ? (
              <div className="context-required-loss" role="alert">
                <strong>Required truncation ({requiredTruncations.length}):</strong>
                <ul>
                  {requiredTruncations.map((t: TruncationRecord, i) => (
                    <li key={i}>
                      {t.subject} — limit {t.limit}, actual {t.actualCount}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {optionalTruncations.length > 0 ? (
              <div>
                <p>Optional truncations ({optionalTruncations.length}):</p>
                <ul>
                  {optionalTruncations.map((t: TruncationRecord, i) => (
                    <li key={i}>
                      {t.subject} — limit {t.limit}, actual {t.actualCount}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section>
        <h4>Bounded reference-fidelity projection</h4>
        {artifact.fidelity === undefined ? (
          <p className="placeholder-note">Reference fidelity not included in this bounded context.</p>
        ) : (
          <>
            <dl className="inspector__fields">
              <div className="evidence-field">
                <dt>referenceId</dt>
                <dd>{artifact.fidelity.referenceId}</dd>
              </div>
              <div className="evidence-field">
                <dt>referenceRequestId</dt>
                <dd>{artifact.fidelity.referenceRequestId}</dd>
              </div>
              <div className="evidence-field">
                <dt>candidateObservationId</dt>
                <dd>{artifact.fidelity.candidateObservationId}</dd>
              </div>
              <div className="evidence-field">
                <dt>candidateRequestId</dt>
                <dd>{artifact.fidelity.candidateRequestId}</dd>
              </div>
              <div className="evidence-field">
                <dt>adequacy</dt>
                <dd>{artifact.fidelity.adequacy.status}</dd>
              </div>
              {artifact.fidelity.compatibility !== undefined ? (
                <div className="evidence-field">
                  <dt>compatibility</dt>
                  <dd>{artifact.fidelity.compatibility.state}</dd>
                </div>
              ) : null}
            </dl>

            <div className={`reference-fidelity-state reference-fidelity-state--${artifact.fidelity.state}`} role={artifact.fidelity.state === 'fail' ? 'alert' : undefined}>
              Bounded context fidelity projection: <strong>{artifact.fidelity.state}</strong>
              {artifact.fidelity.blockedBy !== undefined ? <span> — blocked by: {artifact.fidelity.blockedBy}</span> : null}
            </div>

            <h5>Mismatches ({artifact.fidelity.mismatches.length})</h5>
            {artifact.fidelity.mismatches.length === 0 ? (
              <p className="placeholder-note">{artifact.fidelity.state === 'not-evaluated' ? 'Evaluation was blocked - this is not evidence of "no problems".' : 'No mismatches in this bounded projection.'}</p>
            ) : (
              <ul className="clause-list">
                {artifact.fidelity.mismatches.map((m) => (
                  <li key={m.requirementId} className="clause-row clause-row--fail">
                    <span className="clause-row__id">{m.requirementId}</span>
                    <span className="clause-row__category">{m.category}</span>
                    <span className="clause-row__status">{m.status}</span>
                    {m.status === 'unavailable' ? (
                      <p className="clause-row__unresolved">
                        {m.reasonCode}: {m.detail}
                      </p>
                    ) : (
                      <p className="clause-row__primitive">
                        referenceValue: {m.referenceValue ?? '(n/a)'} — candidateRawValue: {m.candidateRawValue ?? '(n/a)'} — candidateValue: {m.candidateValue ?? '(n/a)'} — delta: {m.delta ?? '(n/a)'} — expected:{' '}
                        {m.expectedRelationship ?? '(n/a)'} — actual: {m.actualRelationship ?? '(n/a)'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h5>Protected context ({artifact.fidelity.protectedContext.length})</h5>
            {artifact.fidelity.protectedContext.length === 0 ? (
              <p className="placeholder-note">No passing protected/preserved context surfaced in this bounded projection.</p>
            ) : (
              <ul className="clause-list">
                {artifact.fidelity.protectedContext.map((p) => (
                  <li key={p.requirementId} className="clause-row clause-row--pass">
                    <span className="clause-row__id">{p.requirementId}</span>
                    <span className="clause-row__category">{p.category}</span>
                  </li>
                ))}
              </ul>
            )}

            {referenceHandle !== undefined && fidelityCandidateHandle !== undefined ? (
              <>
                <h5>Current on-demand fidelity evaluation</h5>
                <p className="placeholder-note">Re-running fidelity on demand is a separate, live evaluation - it never silently replaces the bounded context projection above.</p>
                <ReferenceFidelityPanel referenceHandle={referenceHandle} candidateHandle={fidelityCandidateHandle} onHighlight={() => undefined} />
              </>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
