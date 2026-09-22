import type { VisualChangeAgentHandoff } from './visualChangeAgentHandoff.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

export function serializeVisualChangeAgentHandoffCanonical(handoff: VisualChangeAgentHandoff): string {
  return `${JSON.stringify(canonical(handoff), null, 2)}\n`;
}
