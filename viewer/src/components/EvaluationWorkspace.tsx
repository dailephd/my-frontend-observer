import { useEffect, useState } from 'react';
import { useEvaluationView } from '../hooks/useLinkedEvidence.js';
import { useArtifactDetail } from '../hooks/useArtifactDetail.js';
import { ComparisonObservationPane } from './ComparisonObservationPane.js';
import { ClauseResultRow } from './ClauseResultRow.js';
import type { ClauseDefinition } from './ClauseResultRow.js';
import type { OverlayToggles } from './TargetOverlaySvg.js';
import type { FrontendContractEvaluationArtifact, PersistentBaselineContract, PerChangeContract, ClauseEvaluationResult, AuthoredChangeScopeCategory } from '../types/contracts.js';
import type { ComparisonArtifact } from '../types/comparison.js';

const CATEGORY_ORDER: AuthoredChangeScopeCategory[] = ['requested', 'expected-dependent', 'protected', 'preserved'];
const CATEGORY_LABEL: Record<AuthoredChangeScopeCategory, string> = {
  requested: 'Requested',
  'expected-dependent': 'Expected-dependent',
  protected: 'Protected',
  preserved: 'Preserved',
};

/**
 * Batch 4: displays one already-persisted `FrontendContractEvaluationArtifact`
 * exactly as canonical - `evaluateFrontendContract` is never called here.
 * `overallVerdict`/`clauseResults`/`activeBaselineClauseIds`/
 * `supersededBaselineClauseIds`/`unexpectedChanges` are the artifact's own
 * fields, rendered unchanged. Clause *definitions* (category, primitive,
 * expected-dependent mode) come from the linked baseline/per-change
 * contracts, joined to results by exact `clauseId` only (frozen plan §27) -
 * never by target/primitive-shape/position/text similarity.
 */
export function EvaluationWorkspace({ handle, artifact }: { handle: string; artifact: FrontendContractEvaluationArtifact }) {
  const view = useEvaluationView(handle);
  const baselineHandle = view.state === 'available' && view.baseline.status === 'resolved' ? view.baseline.handle : undefined;
  const changeHandle = view.state === 'available' && view.change.status === 'resolved' ? view.change.handle : undefined;
  const comparisonHandle = view.state === 'available' && view.comparison.status === 'resolved' ? view.comparison.handle : undefined;

  const baselineDetail = useArtifactDetail(baselineHandle);
  const changeDetail = useArtifactDetail(changeHandle);
  const comparisonDetail = useArtifactDetail(comparisonHandle);

  const [selectedTarget, setSelectedTarget] = useState<string | undefined>(undefined);
  const [highlightNames, setHighlightNames] = useState<Set<string>>(new Set());
  const [toggles, setToggles] = useState<OverlayToggles>({ geometry: true, labels: true, relationships: true });

  useEffect(() => {
    setSelectedTarget(undefined);
    setHighlightNames(new Set());
  }, [handle]);

  function highlight(names: string[]): void {
    setSelectedTarget(names[0]);
    setHighlightNames(new Set(names.slice(1)));
  }

  if (view.state === 'idle' || view.state === 'loading') {
    return <p className="placeholder-note">Resolving linked baseline/per-change contract, comparison, and source observations…</p>;
  }
  if (view.state === 'error') {
    return (
      <div className="inspector__error" role="alert">
        Could not resolve linked evidence: {view.message}
      </div>
    );
  }

  const baselineClauses = baselineDetail.state === 'available' ? (baselineDetail.artifact as PersistentBaselineContract).clauses : undefined;
  const changeClauses = changeDetail.state === 'available' ? (changeDetail.artifact as PerChangeContract).clauses : undefined;

  const definitions = new Map<string, ClauseDefinition>();
  for (const clause of baselineClauses ?? []) definitions.set(clause.clauseId, { source: 'baseline', clause });
  for (const clause of changeClauses ?? []) definitions.set(clause.clauseId, { source: 'change', clause });

  const activeBaselineIds = new Set(artifact.activeBaselineClauseIds);
  const supersededBaselineIds = new Set(artifact.supersededBaselineClauseIds);

  const baselineResults = artifact.clauseResults.filter((r) => definitions.get(r.clauseId)?.source === 'baseline');
  const byCategory: Record<AuthoredChangeScopeCategory, ClauseEvaluationResult[]> = { requested: [], 'expected-dependent': [], protected: [], preserved: [] };
  for (const result of artifact.clauseResults) {
    const def = definitions.get(result.clauseId);
    if (def?.source === 'change') byCategory[def.clause.category].push(result);
  }
  const unresolvedResults = artifact.clauseResults.filter((r) => !definitions.has(r.clauseId));

  const comparisonArtifact = comparisonDetail.state === 'available' ? (comparisonDetail.artifact as ComparisonArtifact) : undefined;

  return (
    <div className="evaluation-workspace">
      <div className={`overall-verdict overall-verdict--${artifact.overallVerdict}`} role={artifact.overallVerdict === 'FAIL' ? 'alert' : undefined}>
        Overall verdict: <strong>{artifact.overallVerdict}</strong>
      </div>

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
          relationships={comparisonArtifact?.relationshipsBefore}
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
          relationships={comparisonArtifact?.relationshipsAfter}
          toggles={toggles}
          highlightNames={highlightNames}
        />
      </div>

      <div className="evaluation-workspace__details">
        <section>
          <h4>Baseline clauses</h4>
          {view.baseline.status !== 'resolved' ? <p className="placeholder-note">Baseline contract {view.baseline.status}.</p> : null}
          {baselineResults.length === 0 ? (
            <p className="placeholder-note">No baseline clause results in this evaluation.</p>
          ) : (
            <ul className="clause-list">
              {baselineResults.map((r) => (
                <ClauseResultRow key={r.clauseId} result={r} definition={definitions.get(r.clauseId)} badge={activeBaselineIds.has(r.clauseId) ? 'active' : supersededBaselineIds.has(r.clauseId) ? 'superseded' : undefined} onHighlight={highlight} />
              ))}
            </ul>
          )}
        </section>

        {CATEGORY_ORDER.map((category) => (
          <section key={category}>
            <h4>{CATEGORY_LABEL[category]} clauses</h4>
            {byCategory[category].length === 0 ? (
              <p className="placeholder-note">No {CATEGORY_LABEL[category].toLowerCase()} clauses in this evaluation.</p>
            ) : (
              <ul className="clause-list">
                {byCategory[category].map((r) => (
                  <ClauseResultRow key={r.clauseId} result={r} definition={definitions.get(r.clauseId)} onHighlight={highlight} />
                ))}
              </ul>
            )}
          </section>
        ))}

        {unresolvedResults.length > 0 ? (
          <section>
            <h4>Unresolved clause definitions</h4>
            <ul className="clause-list">
              {unresolvedResults.map((r) => (
                <ClauseResultRow key={r.clauseId} result={r} definition={undefined} onHighlight={highlight} />
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h4>Unexpected changes ({artifact.unexpectedChanges.length})</h4>
          {artifact.unexpectedChanges.length === 0 ? (
            <p className="placeholder-note">No unexpected changes.</p>
          ) : (
            <ul className="comparison-list">
              {artifact.unexpectedChanges.map((u, i) => {
                const names = u.subject.type === 'target' ? [u.subject.target] : u.subject.type === 'relationship' ? [u.subject.subjectTarget, u.subject.relatedTarget].filter((v): v is string => v !== undefined) : [];
                return (
                  <li key={i}>
                    <button type="button" className="comparison-list__item" onClick={() => highlight(names)} disabled={names.length === 0}>
                      <strong>unexpected</strong> — {u.differenceKind} — {u.subject.type === 'target' ? u.subject.target : u.subject.type === 'relationship' ? u.subject.kind : 'page'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
