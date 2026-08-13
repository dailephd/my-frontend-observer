import { readFile } from 'node:fs/promises';
import type { PersistentBaselineContract, PerChangeContract } from '../domain/frontendContracts.js';
import { isValidPersistentBaselineContract, isValidPerChangeContract } from '../domain/frontendContracts.js';

export type ReadPersistentBaselineContractResult = { ok: true; contract: PersistentBaselineContract } | { ok: false; reason: string };
export type ReadPerChangeContractResult = { ok: true; contract: PerChangeContract } | { ok: false; reason: string };

async function readJson(manifestPath: string): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `failed to read artifact manifest at "${manifestPath}": ${message}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `artifact manifest at "${manifestPath}" is not valid JSON: ${message}` };
  }
}

/**
 * Narrow canonical reader counterpart to `frontendContractArtifactWriter.ts#writePersistentBaselineContract`:
 * reads one `manifest.json`, parses it, and validates it through the same
 * `isValidPersistentBaselineContract` structural gate the writer uses - never
 * a second validator, never a schema upgrade, never a guessed missing field.
 */
export async function readPersistentBaselineContract(manifestPath: string): Promise<ReadPersistentBaselineContractResult> {
  const parsed = await readJson(manifestPath);
  if (!parsed.ok) return parsed;
  const validation = isValidPersistentBaselineContract(parsed.value);
  if (!validation.valid) {
    return { ok: false, reason: `baseline contract manifest at "${manifestPath}" failed structural validation: ${validation.reason}` };
  }
  return { ok: true, contract: parsed.value as PersistentBaselineContract };
}

/** Narrow canonical reader counterpart to `frontendContractArtifactWriter.ts#writePerChangeContract`. */
export async function readPerChangeContract(manifestPath: string): Promise<ReadPerChangeContractResult> {
  const parsed = await readJson(manifestPath);
  if (!parsed.ok) return parsed;
  const validation = isValidPerChangeContract(parsed.value);
  if (!validation.valid) {
    return { ok: false, reason: `per-change contract manifest at "${manifestPath}" failed structural validation: ${validation.reason}` };
  }
  return { ok: true, contract: parsed.value as PerChangeContract };
}
