import { useEffect, useState } from 'react';
import { useComparisonView } from '../hooks/useLinkedEvidence.js';
import { ComparisonObservationPane } from './ComparisonObservationPane.js';
import type { OverlayToggles } from './TargetOverlaySvg.js';
import type { ComparisonArtifact, ComparisonDifference, ComparisonDifferenceSubject, RelationshipChangeRecord } from '../types/comparison.js';

function subjectTargetNames(subject: ComparisonDifferenceSubject): string[] {
  if (subject.type === 'target') return [subject.target];
  if (subject.type === 'relationship') return [subject.subjectTarget, subject.relatedTarget].filter((v): v is string => v !== undefined);
  return [];
}

function subjectLabel(subject: ComparisonDifferenceSubject): string {
  if (subject.type === 'target') return subject.target;
  if (subject.type === 'relationship') return `${subject.kind}${subject.subjectTarget ? ` (${subject.subjectTarget} ↔ ${subject.relatedTarget ?? '?'})` : ''}`;
  return 'page';
}

/**
 * Batch 4: displays one already-persisted `ComparisonArtifact` exactly as
 * canonical - `compareObservations` is never called here. Before/after
 * source observations are resolved by the additive
 * `GET /api/comparisons/<handle>/view` route (exact identity only) and
 * rendered through the same Batch 3 `TargetOverlaySvg`/`useArtifactDetail`
 * primitives `ComparisonObservationPane` wraps - no second screenshot/SVG
 * implementation.
 */
export function ComparisonWorkspace({ handle, artifact }: { handle: string; artifact: ComparisonArtifact }) {
  const view = useComparisonView(handle);
  const [selectedTarget, setSelectedTarget] = useState<string | undefined>(undefined);
  const [highlightNames, setHighlightNames] = useState<Set<string>>(new Set());
  const [toggles, setToggles] = useState<OverlayToggles>({ geometry: true, labels: true, relationships: true });

  useEffect(() => {
    setSelectedTarget(undefined);
    setHighlightNames(new Set());
  }, [handle]);

  function highlightSubject(subject: ComparisonDifferenceSubject): void {
    const names = subjectTargetNames(subject);
    setSelectedTarget(names[0]);
    setHighlightNames(new Set(names.slice(1)));
  }

  function highlightRelationshipChange(change: RelationshipChangeRecord): void {
    const names = [change.subjectTarget, change.relatedTarget].filter((v): v is string => v !== undefined);
    setSelectedTarget(names[0]);
    setHighlightNames(new Set(names.slice(1)));
  }

  if (view.state === 'idle' || view.state === 'loading') {
    return <p className="placeholder-note">Resolving before/after source observations…</p>;
  }
  if (view.state === 'error') {
    return (
      <div className="inspector__error" role="alert">
        Could not resolve linked evidence: {view.message}
      </div>
    );
  }

  return (
    <div className="comparison-workspace">
      <div className={`comparability-banner comparability-banner--${artifact.comparability.state}`} role={artifact.comparability.state === 'incomparable' ? 'alert' : undefined}>
        <strong>{artifact.comparability.state}</strong>
        {artifact.comparability.reasons.length > 0 ? (
          <ul>
            {artifact.comparability.reasons.map((r, i) => (
              <li key={i} className={`comparability-reason comparability-reason--${r.severity}`}>
                [{r.severity}] {r.code}: {r.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {artifact.limits.truncated ? (
        <div className="comparison-workspace__truncated" role="alert">
          This comparison is truncated. Omitted fields: {artifact.limits.omittedFields.join(', ') || 'none listed'}; omitted target pairs: {artifact.limits.omittedTargetPairs.join(', ') || 'none listed'}.
        </div>
      ) : null}

      <div className="observation-workspace__toolbar" role="group" aria-label="Overlay toggles">
        <label>
          <input type="checkbox" checked={toggles.geometry} onChange={(e) => setToggles((t) => ({ ...t, geometry: e.target.checked }))} />
          Target geometry
        </label>
        <label>
          <input type="checkbox" checked={toggles.labels} onChange={(e) => setToggles((t) => ({ ...t, labels: e.target.checked }))} disabled={!toggles.geometry} />
          Labels
        </label>
        <label>
          <input type="checkbox" checked={toggles.relationships} onChange={(e) => setToggles((t) => ({ ...t, relationships: e.target.checked }))} />
          Relationships
        </label>
      </div>

      <div className="comparison-workspace__panes">
        <ComparisonObservationPane
          label="Before"
          link={view.before}
          selectedTarget={selectedTarget}
          onSelectTarget={(name) => {
            setSelectedTarget(name);
            setHighlightNames(new Set());
          }}
          relationships={artifact.relationshipsBefore}
          toggles={toggles}
          highlightNames={highlightNames}
        />
        <ComparisonObservationPane
          label="After"
          link={view.after}
          selectedTarget={selectedTarget}
          onSelectTarget={(name) => {
            setSelectedTarget(name);
            setHighlightNames(new Set());
          }}
          relationships={artifact.relationshipsAfter}
          toggles={toggles}
          highlightNames={highlightNames}
        />
      </div>

      <div className="comparison-workspace__details">
        <section>
          <h4>Configuration changes</h4>
          {artifact.configurationChanges.length === 0 ? (
            <p className="placeholder-note">No target configuration changes.</p>
          ) : (
            <ul className="comparison-list">
              {artifact.configurationChanges.map((c, i) => (
                <li key={i}>
                  <strong>{c.kind}</strong> — <code>{c.target}</code>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4>Differences ({artifact.differences.length})</h4>
          {artifact.differences.length === 0 ? (
            <p className="placeholder-note">No differences recorded.</p>
          ) : (
            <ul className="comparison-list">
              {artifact.differences.map((d: ComparisonDifference, i) => (
                <li key={i}>
                  <button type="button" className="comparison-list__item" onClick={() => highlightSubject(d.subject)}>
                    <strong>{d.kind}</strong> — {subjectLabel(d.subject)}
                    <span className="comparison-list__meta">
                      {' '}
                      before: {JSON.stringify(d.before)} → after: {JSON.stringify(d.after)}
                      {d.delta !== undefined ? ` (Δ ${JSON.stringify(d.delta)})` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4>Relationship changes ({artifact.relationshipChanges.length})</h4>
          {artifact.relationshipChanges.length === 0 ? (
            <p className="placeholder-note">No relationship changes recorded.</p>
          ) : (
            <ul className="comparison-list">
              {artifact.relationshipChanges.map((r: RelationshipChangeRecord, i) => (
                <li key={i}>
                  <button type="button" className="comparison-list__item" onClick={() => highlightRelationshipChange(r)}>
                    <strong>{r.kind}</strong> ({r.scope}) {r.subjectTarget ? `${r.subjectTarget} ↔ ${r.relatedTarget}` : ''}
                    <span className="comparison-list__meta">
                      {' '}
                      {r.before} → {r.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4>Expected dependency evidence (explicit, non-causal)</h4>
          {artifact.expectedDependencyEvidence.length === 0 ? (
            <p className="placeholder-note">No declared dependency expectations.</p>
          ) : (
            <ul className="comparison-list">
              {artifact.expectedDependencyEvidence.map((e, i) => (
                <li key={i}>
                  {e.declaration.cause.target}.{e.declaration.cause.property} {e.declaration.cause.direction} → {e.declaration.effect.target}.{e.declaration.effect.property} {e.declaration.effect.direction}:{' '}
                  <strong>{e.outcome}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        {artifact.diagnostics.length > 0 ? (
          <section>
            <h4>Diagnostics</h4>
            <ul className="comparison-list">
              {artifact.diagnostics.map((d, i) => (
                <li key={i}>
                  [{d.code}] {d.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
