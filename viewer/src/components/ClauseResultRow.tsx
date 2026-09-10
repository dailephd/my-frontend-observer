import type { ClauseEvaluationResult, BaselineClause, PerChangeClause } from '../types/contracts.js';
import { primitiveTargetNames } from '../contract/clauseTargets.js';

export type ClauseDefinition = { source: 'baseline'; clause: BaselineClause } | { source: 'change'; clause: PerChangeClause };

function statusLabel(result: ClauseEvaluationResult): string {
  switch (result.status) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'unavailable':
      return `unavailable — ${result.reason}`;
    case 'conflict':
      return `conflict with [${result.conflictingClauseIds.join(', ')}] — ${result.reason}`;
  }
}

/** One clause result joined to its exact-clauseId definition (frozen plan §27) - never joined by target/primitive-shape/position/text similarity. An unresolved definition is shown honestly, never fabricated. */
export function ClauseResultRow({
  result,
  definition,
  badge,
  onHighlight,
}: {
  result: ClauseEvaluationResult;
  definition: ClauseDefinition | undefined;
  badge?: string | undefined;
  onHighlight: (names: string[]) => void;
}) {
  const names = definition !== undefined ? primitiveTargetNames(definition.clause.primitive) : [];
  const category = definition?.source === 'change' ? definition.clause.category : definition?.source === 'baseline' ? 'baseline' : undefined;
  const mode = definition?.source === 'change' ? definition.clause.expectedDependentMode : undefined;

  return (
    <li className={`clause-row clause-row--${result.status}`}>
      <button type="button" className="clause-row__button" onClick={() => onHighlight(names)} disabled={names.length === 0}>
        <span className="clause-row__id">{result.clauseId}</span>
        {badge ? <span className={`clause-row__badge clause-row__badge--${badge}`}>{badge}</span> : null}
        {category ? <span className="clause-row__category">{category}</span> : null}
        {mode ? <span className="clause-row__mode">({mode})</span> : null}
        <span className="clause-row__status">{statusLabel(result)}</span>
      </button>
      {definition === undefined ? <p className="clause-row__unresolved">Clause definition not found among loaded baseline/per-change contracts (unresolved clauseId).</p> : null}
      {definition !== undefined ? <p className="clause-row__primitive">{JSON.stringify(definition.clause.primitive)}</p> : null}
    </li>
  );
}
