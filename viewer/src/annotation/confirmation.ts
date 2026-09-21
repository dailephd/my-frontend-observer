import type { VisualAnnotationItem } from '../types/visualAnnotation.js';

/**
 * v0.9 Batch 4/5 shared confirmation rules for annotation interpretation,
 * used by both the external-reference and the runtime draft models.
 * Confirmation is always an explicit action; a confirmed item whose meaning
 * changes goes back to candidate.
 */

/** Explicit confirmation of an existing candidate. Anything else is returned unchanged. */
export function confirmCandidate(item: VisualAnnotationItem, confirmedAt: string): VisualAnnotationItem {
  if (item.interpretation.state !== 'candidate') return item;
  return { ...item, interpretation: { state: 'confirmed', intent: item.interpretation.intent, confirmedAt } };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The meaning of an item: its mark, association, and intent (never `confirmedAt`). */
function meaning(item: VisualAnnotationItem): string {
  const intent = item.interpretation.state === 'uninterpreted' ? undefined : item.interpretation.intent;
  return stableStringify({ mark: item.mark, association: item.association, intent });
}

/**
 * Given an item before and after an edit: when the item was confirmed, is
 * still confirmed, and its meaning changed, the confirmation is withdrawn -
 * the intent is kept as a candidate and `confirmedAt` is removed. A no-op
 * edit keeps the confirmation.
 */
export function withdrawChangedConfirmation(before: VisualAnnotationItem, after: VisualAnnotationItem): VisualAnnotationItem {
  if (before.interpretation.state === 'confirmed' && after.interpretation.state === 'confirmed' && meaning(before) !== meaning(after)) {
    return { ...after, interpretation: { state: 'candidate', intent: after.interpretation.intent } };
  }
  return after;
}
