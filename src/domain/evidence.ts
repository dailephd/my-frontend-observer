export type EvidenceState = 'available' | 'unavailable' | 'not-applicable' | 'partial';

export type EvidenceSource = 'browser' | 'computed-browser' | 'derived';

export type EvidenceField<T> =
  | { state: 'available'; source: EvidenceSource; value: T; derivedFrom?: string[] }
  | { state: 'partial'; source: EvidenceSource; value: T; reason: string; derivedFrom?: string[] }
  | { state: 'unavailable'; reason: string }
  | { state: 'not-applicable'; reason?: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const EVIDENCE_SOURCES = ['browser', 'computed-browser', 'derived'] as const;

function isEvidenceSource(value: unknown): value is EvidenceSource {
  return typeof value === 'string' && (EVIDENCE_SOURCES as readonly string[]).includes(value);
}

function isDerivedFrom(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string');
}

/**
 * Structural validator for the frozen EvidenceField<T> contract. Enforces the
 * per-state field-combination invariants (available/partial require
 * source+value; unavailable/not-applicable forbid both) and the
 * derivedFrom-iff-derived-source invariant.
 */
export function isValidEvidenceField<T = unknown>(field: unknown): field is EvidenceField<T> {
  if (!isPlainObject(field)) return false;
  const state = field.state;

  if (state === 'available' || state === 'partial') {
    if (!isEvidenceSource(field.source)) return false;
    if (!('value' in field) || field.value === undefined) return false;
    if (state === 'partial' && (typeof field.reason !== 'string' || field.reason.length === 0)) return false;
    if (field.source === 'derived') {
      if (!isDerivedFrom(field.derivedFrom)) return false;
    } else if ('derivedFrom' in field && field.derivedFrom !== undefined) {
      return false;
    }
    return true;
  }

  if (state === 'unavailable') {
    if ('value' in field && field.value !== undefined) return false;
    if ('source' in field && field.source !== undefined) return false;
    return typeof field.reason === 'string' && field.reason.length > 0;
  }

  if (state === 'not-applicable') {
    if ('value' in field && field.value !== undefined) return false;
    if ('source' in field && field.source !== undefined) return false;
    if ('reason' in field && field.reason !== undefined && typeof field.reason !== 'string') return false;
    return true;
  }

  return false;
}

/** Extracts an `EvidenceField<T>`'s value when meaningfully present (`available`/`partial`), `undefined` otherwise - never a fabricated default for `unavailable`/`not-applicable`. */
export function evidenceValue<T>(field: EvidenceField<T>): T | undefined {
  return field.state === 'available' || field.state === 'partial' ? field.value : undefined;
}
