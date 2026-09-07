import type { EvidenceField } from '../types/observation.js';

/** Honestly renders one canonical `EvidenceField<T>`: never substitutes empty/zero for `unavailable`/`not-applicable`, and always names the evidence source when a value is present. */
export function EvidenceFieldView<T>({ label, field, format }: { label: string; field: EvidenceField<T> | undefined; format?: (value: T) => string }) {
  if (field === undefined) {
    return (
      <div className="evidence-field evidence-field--absent">
        <dt>{label}</dt>
        <dd>not present in this artifact</dd>
      </div>
    );
  }

  if (field.state === 'unavailable') {
    return (
      <div className="evidence-field evidence-field--unavailable">
        <dt>{label}</dt>
        <dd>unavailable — {field.reason}</dd>
      </div>
    );
  }

  if (field.state === 'not-applicable') {
    return (
      <div className="evidence-field evidence-field--not-applicable">
        <dt>{label}</dt>
        <dd>not applicable{field.reason ? ` — ${field.reason}` : ''}</dd>
      </div>
    );
  }

  const display = format ? format(field.value) : typeof field.value === 'object' ? JSON.stringify(field.value) : String(field.value);
  return (
    <div className={`evidence-field evidence-field--${field.state}`}>
      <dt>{label}</dt>
      <dd>
        {display} <span className="evidence-field__source">({field.source}{field.state === 'partial' ? `, partial: ${field.reason}` : ''})</span>
      </dd>
    </div>
  );
}
