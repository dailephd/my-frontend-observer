import path from 'node:path';
import type { PersistentBaselineContract, PerChangeContract } from '../domain/frontendContracts.js';
import { isValidPersistentBaselineContract, isValidPerChangeContract } from '../domain/frontendContracts.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import { normalizeOutputLocation } from '../request/paths.js';
import { writePersistentBaselineContract, writePerChangeContract } from '../artifacts/frontendContractArtifactWriter.js';
import type { WriteFrontendContractArtifactOptions } from '../artifacts/frontendContractArtifactWriter.js';
import { readObservationArtifact } from '../artifacts/artifactReader.js';
import { MANIFEST_FILENAME as OBSERVATION_MANIFEST_FILENAME } from '../artifacts/artifactWriter.js';

export interface PersistFrontendContractOptions {
  outputLocation: string;
  cwd?: WriteFrontendContractArtifactOptions['cwd'];
}

export type ApplicationApproveBaselineResult =
  | {
      ok: true;
      baselineId: string;
      supersedesBaselineId?: string;
      artifactRoot: string;
      manifestPath: string;
      clauseCount: number;
    }
  | { ok: false; diagnostics: Diagnostic[] };

export type ApplicationPersistChangeContractResult =
  | {
      ok: true;
      contractId: string;
      artifactRoot: string;
      manifestPath: string;
      clauseCount: number;
      supersedesBaselineClauseCount: number;
    }
  | { ok: false; diagnostics: Diagnostic[] };

function invalidRequest(message: string): { ok: false; diagnostics: Diagnostic[] } {
  return { ok: false, diagnostics: [{ code: 'invalid-request', severity: DIAGNOSTIC_SEVERITY['invalid-request'], message }] };
}

/**
 * The one canonical application-level baseline-approval use case: `approve-baseline`
 * is the *only* place a baseline is ever approved (see governing scope) - this
 * function is never called from `observe`/`compare`/`evaluate-contract`, and a
 * `PASS` evaluation never triggers it. Validates the raw (still-`unknown`,
 * freshly-parsed-JSON) baseline through the existing frozen
 * `isValidPersistentBaselineContract` structural gate (never a second
 * validator), reads the supplied observation through the existing
 * `readObservationArtifact` reader, verifies the baseline's frozen
 * `sourceObservation` reference actually corresponds to that observation's
 * stable identity, and - only then - persists exactly once through the
 * existing contract writer. Never mutates the observation. Never infers,
 * creates, or removes `supersedesBaselineId` - whatever the caller already
 * authored is preserved exactly.
 */
export async function approveAndPersistBaseline(rawContract: unknown, observationRoot: string, options: PersistFrontendContractOptions): Promise<ApplicationApproveBaselineResult> {
  const validation = isValidPersistentBaselineContract(rawContract);
  if (!validation.valid) return invalidRequest(`baseline contract is invalid: ${validation.reason}`);
  const contract = rawContract as PersistentBaselineContract;

  const observationRead = await readObservationArtifact(path.join(observationRoot, OBSERVATION_MANIFEST_FILENAME));
  if (!observationRead.ok) return invalidRequest(`observation artifact: ${observationRead.reason}`);
  const observation = observationRead.artifact;

  const ref = contract.sourceObservation;
  const matchesObservation =
    ref.observationId === observation.observationId &&
    ref.requestId === observation.requestId &&
    ref.producer.name === observation.producer.name &&
    ref.producer.version === observation.producer.version &&
    ref.observationSchemaVersion === observation.schemaVersion;
  if (!matchesObservation) {
    return invalidRequest('baseline contract sourceObservation does not match the supplied observation artifact; refusing to approve an unrelated observation');
  }

  const normalized = normalizeOutputLocation(options.outputLocation);
  if (!normalized.ok) return { ok: false, diagnostics: [normalized.diagnostic] };

  const persisted = await writePersistentBaselineContract(contract, normalized.value, options.cwd === undefined ? {} : { cwd: options.cwd });
  if (!persisted.ok) return { ok: false, diagnostics: persisted.diagnostics };

  return {
    ok: true,
    baselineId: contract.baselineId,
    ...(contract.supersedesBaselineId === undefined ? {} : { supersedesBaselineId: contract.supersedesBaselineId }),
    artifactRoot: persisted.artifactRoot,
    manifestPath: persisted.manifestPath,
    clauseCount: contract.clauses.length,
  };
}

/**
 * The one canonical application-level per-change-contract persistence use
 * case (`save-change-contract`) - persistence only, never approval
 * terminology or semantics. Validates the raw contract through the existing
 * frozen `isValidPerChangeContract` gate (which already rejects a
 * `PersistentBaselineContract` passed here, an authored `category:
 * "unexpected"`, and every other structural rule - never duplicated here),
 * then persists exactly once. `supersedesBaselineClauseIds` is preserved
 * exactly as authored; this function performs no baseline-reference
 * resolution (that remains the evaluator's responsibility).
 */
export async function persistPerChangeContract(rawContract: unknown, options: PersistFrontendContractOptions): Promise<ApplicationPersistChangeContractResult> {
  const validation = isValidPerChangeContract(rawContract);
  if (!validation.valid) return invalidRequest(`per-change contract is invalid: ${validation.reason}`);
  const contract = rawContract as PerChangeContract;

  const normalized = normalizeOutputLocation(options.outputLocation);
  if (!normalized.ok) return { ok: false, diagnostics: [normalized.diagnostic] };

  const persisted = await writePerChangeContract(contract, normalized.value, options.cwd === undefined ? {} : { cwd: options.cwd });
  if (!persisted.ok) return { ok: false, diagnostics: persisted.diagnostics };

  const supersedesBaselineClauseCount = contract.clauses.reduce((count, clause) => count + (clause.supersedesBaselineClauseIds?.length ?? 0), 0);

  return {
    ok: true,
    contractId: contract.contractId,
    artifactRoot: persisted.artifactRoot,
    manifestPath: persisted.manifestPath,
    clauseCount: contract.clauses.length,
    supersedesBaselineClauseCount,
  };
}
