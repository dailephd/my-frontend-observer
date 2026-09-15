import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateObservationAlias } from './projectConfig.js';

export const ALIAS_CATALOG_SCHEMA_VERSION = '1.0.0' as const;
export interface ObservationAliasRecord { observationId: string; requestId: string; relativeArtifactDir: string }
export interface AliasCatalog { schemaVersion: typeof ALIAS_CATALOG_SCHEMA_VERSION; observations: Record<string, ObservationAliasRecord> }
export type AliasCatalogReadResult = { ok: true; catalog: AliasCatalog } | { ok: false; reason: string };
const REQUEST_ID = /^[a-f0-9]{64}$/;
const OBSERVATION_ID = /^[a-f0-9]{64}-[a-f0-9]{32}$/;

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function safeRelativeDir(value: string): boolean {
  if (value.length === 0 || value.includes('\\') || path.posix.isAbsolute(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.includes(':'));
}

export function validateAliasCatalog(value: unknown): AliasCatalogReadResult {
  if (!isObject(value)) return { ok: false, reason: 'catalog root must be an object' };
  const rootUnknown = Object.keys(value).filter((key) => key !== 'schemaVersion' && key !== 'observations');
  if (rootUnknown.length > 0) return { ok: false, reason: `catalog has unsupported field(s): ${rootUnknown.join(', ')}` };
  if (value.schemaVersion !== ALIAS_CATALOG_SCHEMA_VERSION) return { ok: false, reason: `unsupported catalog schema version: ${String(value.schemaVersion)}` };
  if (!isObject(value.observations)) return { ok: false, reason: 'catalog observations must be an object' };
  const observations: Record<string, ObservationAliasRecord> = {};
  for (const [alias, raw] of Object.entries(value.observations)) {
    if (!validateObservationAlias(alias, true).ok) return { ok: false, reason: `catalog contains invalid alias: ${alias}` };
    if (!isObject(raw)) return { ok: false, reason: `catalog record for ${alias} must be an object` };
    const unknown = Object.keys(raw).filter((key) => !['observationId', 'requestId', 'relativeArtifactDir'].includes(key));
    if (unknown.length > 0) return { ok: false, reason: `catalog record for ${alias} has unsupported field(s): ${unknown.join(', ')}` };
    if (typeof raw.observationId !== 'string' || !OBSERVATION_ID.test(raw.observationId)) return { ok: false, reason: `catalog record for ${alias} has invalid observationId` };
    if (typeof raw.requestId !== 'string' || !REQUEST_ID.test(raw.requestId)) return { ok: false, reason: `catalog record for ${alias} has invalid requestId` };
    if (typeof raw.relativeArtifactDir !== 'string' || !safeRelativeDir(raw.relativeArtifactDir)) return { ok: false, reason: `catalog record for ${alias} has unsafe relativeArtifactDir` };
    observations[alias] = { observationId: raw.observationId, requestId: raw.requestId, relativeArtifactDir: raw.relativeArtifactDir };
  }
  return { ok: true, catalog: { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations } };
}

export async function readAliasCatalog(catalogPath: string): Promise<AliasCatalogReadResult> {
  try { return validateAliasCatalog(JSON.parse(await readFile(catalogPath, 'utf8')) as unknown); }
  catch (error) { return { ok: false, reason: `catalog could not be read: ${error instanceof Error ? error.message : String(error)}` }; }
}

export function serializeAliasCatalog(catalog: AliasCatalog): string {
  const observations = Object.fromEntries(Object.keys(catalog.observations).sort().map((alias) => [alias, catalog.observations[alias]]));
  return `${JSON.stringify({ schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations }, null, 2)}\n`;
}

export async function writeAliasCatalog(catalogPath: string, catalog: AliasCatalog): Promise<void> {
  const tempPath = `${catalogPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try { await writeFile(tempPath, serializeAliasCatalog(catalog), 'utf8'); await rename(tempPath, catalogPath); }
  catch (error) { await rm(tempPath, { force: true }).catch(() => undefined); throw error; }
}
