import type { EvidenceIndexState, EvidenceMetadataRecord } from '../hooks/useEvidenceIndex.js';

function supportLabel(record: EvidenceMetadataRecord): string {
  switch (record.supportState) {
    case 'supported':
      return 'supported';
    case 'unsupported-version':
      return `unsupported version (found ${record.foundSchemaVersion ?? '?'})`;
    case 'invalid-structure':
      return 'invalid structure';
    case 'unrecognized-kind':
      return 'unrecognized';
    case 'malformed-json':
      return 'malformed JSON';
    case 'unreadable':
      return 'unreadable';
    default:
      return record.supportState;
  }
}

/**
 * v0.8 Batch 2: bounded evidence navigation surface, consuming only the
 * metadata-first `/api/index` response - no full artifact payload, no
 * screenshot/image bytes, no visualization. Every honest support state is
 * shown as-is, never silently hidden or reinterpreted as "supported".
 */
export function EvidenceList({ index, selectedHandle, onSelect }: { index: EvidenceIndexState; selectedHandle: string | undefined; onSelect: (record: EvidenceMetadataRecord) => void }) {
  if (index.state === 'loading') {
    return <p className="placeholder-note">Loading evidence index…</p>;
  }
  if (index.state === 'unavailable') {
    return (
      <div className="evidence-list__error" role="alert">
        Evidence index unavailable: {index.message}
      </div>
    );
  }
  if (index.records.length === 0) {
    return <p className="placeholder-note">No recognized Observer evidence found under this root yet.</p>;
  }

  return (
    <ul className="evidence-list">
      {index.truncated ? <li className="evidence-list__truncated-note">Evidence list is bounded - not every item under this root may be shown.</li> : null}
      {index.records.map((record) => (
        <li key={record.handle}>
          <button type="button" className={`evidence-list__item evidence-list__item--${record.supportState}${record.handle === selectedHandle ? ' evidence-list__item--selected' : ''}`} onClick={() => onSelect(record)}>
            <span className="evidence-list__family">{record.family}</span>
            <span className="evidence-list__id">{record.logicalId ?? record.relativeDir}</span>
            <span className={`evidence-list__state evidence-list__state--${record.supportState}`}>{supportLabel(record)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
