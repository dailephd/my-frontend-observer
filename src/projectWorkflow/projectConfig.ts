import { readFile } from 'node:fs/promises';
import type { RawNamedTarget } from '../request/request.js';
import { normalizeRequest } from '../request/request.js';

export const PROJECT_CONFIG_FILENAME = 'frontend-observer.json' as const;
export const PROJECT_CONFIG_SCHEMA_VERSION = '1.0.0' as const;
export const OBSERVATION_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const RESERVED_OBSERVATION_ALIASES = new Set(['current']);

export interface FrontendObserverProjectConfig {
  schemaVersion: typeof PROJECT_CONFIG_SCHEMA_VERSION;
  url: string;
  viewport: { width: number; height: number };
  targets: RawNamedTarget[];
  defaultBaseline: string;
}

export type ProjectConfigReadResult =
  | { ok: true; config: FrontendObserverProjectConfig }
  | { ok: false; reason: string };

export function validateObservationAlias(alias: string, allowReserved = false): { ok: true } | { ok: false; reason: 'invalid' | 'reserved' } {
  if (!OBSERVATION_ALIAS_PATTERN.test(alias) || alias.includes('..')) return { ok: false, reason: 'invalid' };
  if (!allowReserved && RESERVED_OBSERVATION_ALIASES.has(alias)) return { ok: false, reason: 'reserved' };
  return { ok: true };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateProjectConfig(value: unknown): ProjectConfigReadResult {
  if (!isObject(value)) return { ok: false, reason: 'project configuration root must be an object' };
  const allowed = new Set(['schemaVersion', 'url', 'viewport', 'targets', 'defaultBaseline']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) return { ok: false, reason: `project configuration has unsupported field(s): ${unknown.join(', ')}` };
  if (value.schemaVersion !== PROJECT_CONFIG_SCHEMA_VERSION) return { ok: false, reason: `unsupported project configuration schema version: ${String(value.schemaVersion)}` };
  if (typeof value.defaultBaseline !== 'string') return { ok: false, reason: 'defaultBaseline must be a string' };
  const alias = validateObservationAlias(value.defaultBaseline);
  if (!alias.ok) return { ok: false, reason: alias.reason === 'reserved' ? 'defaultBaseline uses the reserved alias "current"' : 'defaultBaseline has invalid alias syntax' };
  const normalized = normalizeRequest({
    targetUrl: value.url,
    viewport: value.viewport,
    targets: value.targets,
    outputLocation: '.frontend-observer/evidence/_validation',
  });
  if (!normalized.ok) return { ok: false, reason: normalized.diagnostics.map((entry) => entry.message).join('; ') };
  return {
    ok: true,
    config: {
      schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
      url: normalized.request.targetUrl,
      viewport: normalized.request.viewport,
      targets: value.targets as RawNamedTarget[],
      defaultBaseline: value.defaultBaseline,
    },
  };
}

export async function readProjectConfig(configPath: string): Promise<ProjectConfigReadResult> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
  } catch (error) {
    return { ok: false, reason: `project configuration could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  return validateProjectConfig(value);
}
