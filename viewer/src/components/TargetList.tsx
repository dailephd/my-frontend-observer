import type { OrderedTarget } from '../observation/targetOrder.js';

function statusLabel(target: OrderedTarget): string {
  const status = target.record?.resolution.state === 'available' ? target.record.resolution.value.selectionStatus : undefined;
  if (status === undefined) return 'unavailable';
  return status;
}

/** Left column of the observation workspace: every configured target, in the observation's own authored order, including genuinely unresolved ones - selectable without ever implying they have geometry they don't. */
export function TargetList({ targets, selected, onSelect }: { targets: OrderedTarget[]; selected: string | undefined; onSelect: (name: string) => void }) {
  if (targets.length === 0) {
    return <p className="placeholder-note">This observation has no configured targets.</p>;
  }

  return (
    <ul className="target-list">
      {targets.map((t) => {
        const status = statusLabel(t);
        const isSelected = t.name === selected;
        return (
          <li key={t.name}>
            <button
              type="button"
              className={`target-list__item target-list__item--${status}${isSelected ? ' target-list__item--selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(t.name)}
            >
              <span className="target-list__name">{t.name}</span>
              <span className="target-list__status">{t.hasGeometry ? status : `${status} (no geometry)`}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
