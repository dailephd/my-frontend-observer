import { mkdir, writeFile, rename, rm, access } from 'node:fs/promises';
import path from 'node:path';
import type { PersistentBaselineContract, PerChangeContract } from '../domain/frontendContracts.js';
import { isValidPersistentBaselineContract, isValidPerChangeContract } from '../domain/frontendContracts.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';

export const FRONTEND_CONTRACT_MANIFEST_FILENAME = 'manifest.json';

/**
 * Mirrors `PersistedComparisonResult`'s shape/semantics - a frontend contract
 * directory has no screenshot file either, and this writer never touches
 * `artifacts/artifactWriter.ts` or `artifacts/comparisonArtifactWriter.ts`.
 */
export type PersistedFrontendContractResult =
  | { ok: true; artifactRoot: string; manifestPath: string }
  | { ok: false; diagnostics: Diagnostic[] };

function writeFailure(message: string, details?: Record<string, unknown>): PersistedFrontendContractResult {
  const diagnostic: Diagnostic = {
    code: 'artifact-write-failure',
    severity: DIAGNOSTIC_SEVERITY['artifact-write-failure'],
    message,
    ...(details === undefined ? {} : { details }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}

async function pathExists(candidate: string): Promise<boolean> {
  return access(candidate).then(
    () => true,
    () => false,
  );
}

export interface WriteFrontendContractArtifactOptions {
  /** Base directory that `outputLocation` is resolved against. Defaults to `process.cwd()`. */
  cwd?: string;
}

/**
 * Shared atomic-write body for both contract classes, following the same
 * discipline as `writeObservationArtifact`/`writeComparisonArtifact`: sibling
 * temporary directory, single `manifest.json`, then one atomic rename. An
 * existing directory at the final identity is a genuine collision (never a
 * destructive overwrite of prior baseline/contract history) and is rejected.
 */
async function writeContractArtifact(
  value: PersistentBaselineContract | PerChangeContract,
  id: string,
  kindLabel: string,
  outputLocation: string,
  options: WriteFrontendContractArtifactOptions,
): Promise<PersistedFrontendContractResult> {
  const cwd = options.cwd ?? process.cwd();
  const outputRoot = path.resolve(cwd, outputLocation);
  const finalRoot = path.join(outputRoot, id);
  const tempRoot = path.join(outputRoot, `.tmp-${id}`);

  if (await pathExists(finalRoot)) {
    return writeFailure(`a ${kindLabel} artifact already exists at "${id}"; refusing to overwrite it`, { artifactRoot: finalRoot });
  }

  try {
    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(tempRoot, { recursive: true });

    await writeFile(path.join(tempRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME), JSON.stringify(value, null, 2), 'utf8');

    await rename(tempRoot, finalRoot);

    return { ok: true, artifactRoot: finalRoot, manifestPath: path.join(finalRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME) };
  } catch (err) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return writeFailure(`failed to persist ${kindLabel} artifact: ${message}`);
  }
}

/**
 * Persists one already-valid `PersistentBaselineContract` as
 * `<outputLocation>/<baselineId>/manifest.json`. Never mutates or removes any
 * other baseline artifact - `supersedesBaselineId` (if present) is written
 * exactly as supplied; this writer never inspects, rewrites, or deletes the
 * baseline it refers to.
 */
export async function writePersistentBaselineContract(
  contract: PersistentBaselineContract,
  outputLocation: string,
  options: WriteFrontendContractArtifactOptions = {},
): Promise<PersistedFrontendContractResult> {
  const validation = isValidPersistentBaselineContract(contract);
  if (!validation.valid) return writeFailure(`refusing to persist an invalid PersistentBaselineContract: ${validation.reason}`);
  return writeContractArtifact(contract, contract.baselineId, 'baseline contract', outputLocation, options);
}

/**
 * Persists one already-valid `PerChangeContract` as
 * `<outputLocation>/<contractId>/manifest.json`, symmetric with baseline
 * persistence above (both share `CONTRACT_ARTIFACT_KIND`/`CONTRACT_SCHEMA_VERSION`).
 */
export async function writePerChangeContract(
  contract: PerChangeContract,
  outputLocation: string,
  options: WriteFrontendContractArtifactOptions = {},
): Promise<PersistedFrontendContractResult> {
  const validation = isValidPerChangeContract(contract);
  if (!validation.valid) return writeFailure(`refusing to persist an invalid PerChangeContract: ${validation.reason}`);
  return writeContractArtifact(contract, contract.contractId, 'per-change contract', outputLocation, options);
}
