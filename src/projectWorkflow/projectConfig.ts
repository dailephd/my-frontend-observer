import { readFile } from 'node:fs/promises';
import type { RawNamedTarget } from '../request/request.js';
import { normalizeRequest } from '../request/request.js';

export const PROJECT_CONFIG_FILENAME = 'frontend-observer.json' as const;
export const PROJECT_CONFIG_SCHEMA_VERSION = '1.1.0' as const;
export const SUPPORTED_PROJECT_CONFIG_SCHEMA_VERSIONS = ['1.0.0', '1.1.0'] as const;
export const OBSERVATION_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const RESERVED_OBSERVATION_ALIASES = new Set(['current']);

export interface FrontendObserverAcceptanceConfig { comparisonConfigFile?: string; contract?: { baselineArtifact: string; changeArtifact: string }; reference?: { approvedArtifact: string; bindingsFile?: string } }
export interface FrontendObserverProjectConfig {
  schemaVersion: (typeof SUPPORTED_PROJECT_CONFIG_SCHEMA_VERSIONS)[number];
  url: string;
  viewport: { width: number; height: number };
  targets: RawNamedTarget[];
  defaultBaseline: string;
  acceptance?: FrontendObserverAcceptanceConfig;
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
  const version = value.schemaVersion;
  if (!(SUPPORTED_PROJECT_CONFIG_SCHEMA_VERSIONS as readonly unknown[]).includes(version)) return { ok: false, reason: `unsupported project configuration schema version: ${String(version)}` };
  const allowed = new Set(['schemaVersion', 'url', 'viewport', 'targets', 'defaultBaseline', ...(version === '1.1.0' ? ['acceptance'] : [])]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) return { ok: false, reason: `project configuration has unsupported field(s): ${unknown.join(', ')}` };
  let acceptance: FrontendObserverAcceptanceConfig | undefined;
  if (value.acceptance !== undefined) {
    if (!isObject(value.acceptance)) return { ok: false, reason: 'acceptance must be an object' };
    if (Object.keys(value.acceptance).some((key) => !['comparisonConfigFile','contract','reference'].includes(key))) return { ok: false, reason: 'acceptance has unsupported fields' };
    const portable = (candidate: unknown): candidate is string => {
      if (typeof candidate !== 'string' || candidate.length === 0 || candidate.includes('\0') || candidate.includes('\\') || candidate.includes(':') || candidate.startsWith('/')) return false;
      return candidate.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
    };
    if (value.acceptance.comparisonConfigFile !== undefined && !portable(value.acceptance.comparisonConfigFile)) return { ok: false, reason: 'comparisonConfigFile must be a portable project-relative path' };
    const contract = value.acceptance.contract;
    if (contract !== undefined && (!isObject(contract) || Object.keys(contract).some((key) => !['baselineArtifact','changeArtifact'].includes(key)) || !portable(contract.baselineArtifact) || !portable(contract.changeArtifact))) return { ok: false, reason: 'contract requires portable baselineArtifact and changeArtifact paths' };
    const reference = value.acceptance.reference;
    if (reference !== undefined && (!isObject(reference) || Object.keys(reference).some((key) => !['approvedArtifact','bindingsFile'].includes(key)) || !portable(reference.approvedArtifact) || (reference.bindingsFile !== undefined && !portable(reference.bindingsFile)))) return { ok: false, reason: 'reference requires portable approvedArtifact and optional bindingsFile paths' };
    acceptance = value.acceptance as FrontendObserverAcceptanceConfig;
  }
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
      schemaVersion: version as FrontendObserverProjectConfig['schemaVersion'],
      url: normalized.request.targetUrl,
      viewport: normalized.request.viewport,
      targets: value.targets as RawNamedTarget[],
      defaultBaseline: value.defaultBaseline,
      ...(acceptance === undefined ? {} : { acceptance }),
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
