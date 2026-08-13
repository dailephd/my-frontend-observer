import path from 'node:path';
import { getProducerInfo } from '../domain/schema.js';
import { evaluateFrontendContract } from '../domain/frontendContractEvaluation.js';
import type { FrontendContractEvaluationInput } from '../domain/frontendContractEvaluation.js';
import { buildFrontendContractEvaluationArtifact } from '../domain/frontendContractEvaluationArtifact.js';
import type { OverallVerdict } from '../domain/frontendContracts.js';
import { buildFrontendContractEvaluationRequestIdentity, buildFrontendContractInstanceIdentity } from '../domain/frontendContractIdentity.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import { normalizeOutputLocation } from '../request/paths.js';
import { writeFrontendContractEvaluationArtifact } from '../artifacts/frontendContractEvaluationArtifactWriter.js';
import type { WriteFrontendContractEvaluationArtifactOptions } from '../artifacts/frontendContractEvaluationArtifactWriter.js';
import { readObservationArtifact } from '../artifacts/artifactReader.js';
import { MANIFEST_FILENAME as OBSERVATION_MANIFEST_FILENAME } from '../artifacts/artifactWriter.js';
import { readComparisonArtifact } from '../artifacts/comparisonArtifactReader.js';
import { COMPARISON_MANIFEST_FILENAME } from '../artifacts/comparisonArtifactWriter.js';
import { readPersistentBaselineContract, readPerChangeContract } from '../artifacts/frontendContractArtifactReader.js';
import { FRONTEND_CONTRACT_MANIFEST_FILENAME } from '../artifacts/frontendContractArtifactWriter.js';

export type { PersistedFrontendContractEvaluationResult } from '../artifacts/frontendContractEvaluationArtifactWriter.js';

/** Distinct from `DEFAULT_COMPARISON_OUTPUT_LOCATION`/observation `outputLocation` so evaluations never collide with source evidence. */
export const DEFAULT_EVALUATION_OUTPUT_LOCATION = 'evaluations';

export interface EvaluateAndPersistOptions {
  outputLocation?: string;
  cwd?: WriteFrontendContractEvaluationArtifactOptions['cwd'];
}

export type ApplicationFrontendContractEvaluationResult =
  | {
      ok: true;
      evaluationId: string;
      evaluationRequestId: string;
      overallVerdict: OverallVerdict;
      artifactRoot: string;
      manifestPath: string;
      clauseResultCount: number;
      unexpectedChangeCount: number;
    }
  | { ok: false; diagnostics: Diagnostic[] };

function invalidRequest(message: string): ApplicationFrontendContractEvaluationResult {
  return { ok: false, diagnostics: [{ code: 'invalid-request', severity: DIAGNOSTIC_SEVERITY['invalid-request'], message }] };
}

/**
 * The one canonical application-level frontend-contract evaluation use case:
 * takes already-validated/in-memory evidence, runs the existing pure
 * `evaluateFrontendContract` exactly once, and - only for a structurally
 * constructible result (`ok: true`, whether the verdict itself is `PASS` or
 * `FAIL`) - persists it exactly once through the existing evaluation writer.
 * Never re-evaluates, never launches Chromium, never mutates any input
 * artifact. A `{ ok: false }` evaluator result (evidence could not even be
 * constructed into an evaluation) is never persisted as a fabricated
 * successful artifact - that is an application-level `invalid-request`
 * diagnostic, distinct from a legitimate `FAIL` verdict.
 */
export async function evaluateAndPersist(input: FrontendContractEvaluationInput, options: EvaluateAndPersistOptions = {}): Promise<ApplicationFrontendContractEvaluationResult> {
  const result = evaluateFrontendContract(input);
  if (!result.ok) return invalidRequest(result.reason);

  const rawOutputLocation = options.outputLocation ?? DEFAULT_EVALUATION_OUTPUT_LOCATION;
  const normalized = normalizeOutputLocation(rawOutputLocation);
  if (!normalized.ok) return { ok: false, diagnostics: [normalized.diagnostic] };

  const evaluationRequestId = buildFrontendContractEvaluationRequestIdentity(
    input.baseline.baselineId,
    input.change.contractId,
    input.comparison.before.observationId,
    input.comparison.after.observationId,
    input.comparison.comparisonRequestId,
  );
  const evaluationId = buildFrontendContractInstanceIdentity(evaluationRequestId);

  const artifact = buildFrontendContractEvaluationArtifact({
    evaluationId,
    evaluationRequestId,
    producerVersion: getProducerInfo().version,
    evaluatedAt: new Date().toISOString(),
    baselineId: input.baseline.baselineId,
    contractId: input.change.contractId,
    before: {
      observationId: input.comparison.before.observationId,
      requestId: input.comparison.before.requestId,
      producer: input.comparison.before.producer,
      observationSchemaVersion: input.comparison.before.observationSchemaVersion,
    },
    after: {
      observationId: input.comparison.after.observationId,
      requestId: input.comparison.after.requestId,
      producer: input.comparison.after.producer,
      observationSchemaVersion: input.comparison.after.observationSchemaVersion,
    },
    comparisonId: input.comparison.comparisonId,
    comparisonRequestId: input.comparison.comparisonRequestId,
    overallVerdict: result.evaluation.overallVerdict,
    activeBaselineClauseIds: result.evaluation.activeBaselineClauseIds,
    supersededBaselineClauseIds: result.evaluation.supersededBaselineClauseIds,
    clauseResults: result.evaluation.clauseResults,
    unexpectedChanges: result.evaluation.unexpectedChanges,
  });

  const persisted = await writeFrontendContractEvaluationArtifact(artifact, normalized.value, options.cwd === undefined ? {} : { cwd: options.cwd });
  if (!persisted.ok) return { ok: false, diagnostics: persisted.diagnostics };

  return {
    ok: true,
    evaluationId: artifact.evaluationId,
    evaluationRequestId: artifact.evaluationRequestId,
    overallVerdict: artifact.overallVerdict,
    artifactRoot: persisted.artifactRoot,
    manifestPath: persisted.manifestPath,
    clauseResultCount: artifact.clauseResults.length,
    unexpectedChangeCount: artifact.unexpectedChanges.length,
  };
}

/**
 * The canonical future-CLI-facing orchestration: reads before/after
 * observations (through the existing `readObservationArtifact` reader -
 * never a second observation reader), the comparison (through the new
 * `readComparisonArtifact`), and the baseline/per-change contracts (through
 * `frontendContractArtifactReader.ts`) by their root directories, then
 * delegates to `evaluateAndPersist` exactly once. A thin wrapper only -
 * reading stays owned by the artifacts layer, evaluation stays owned by
 * `domain/frontendContractEvaluation.ts`, persistence stays owned by
 * `artifacts/frontendContractEvaluationArtifactWriter.ts`.
 */
export async function evaluateAndPersistFromArtifactRoots(
  beforeRoot: string,
  afterRoot: string,
  comparisonRoot: string,
  baselineRoot: string,
  changeRoot: string,
  options: EvaluateAndPersistOptions = {},
): Promise<ApplicationFrontendContractEvaluationResult> {
  const beforeRead = await readObservationArtifact(path.join(beforeRoot, OBSERVATION_MANIFEST_FILENAME));
  if (!beforeRead.ok) return invalidRequest(`before observation artifact: ${beforeRead.reason}`);

  const afterRead = await readObservationArtifact(path.join(afterRoot, OBSERVATION_MANIFEST_FILENAME));
  if (!afterRead.ok) return invalidRequest(`after observation artifact: ${afterRead.reason}`);

  const comparisonRead = await readComparisonArtifact(path.join(comparisonRoot, COMPARISON_MANIFEST_FILENAME));
  if (!comparisonRead.ok) return invalidRequest(`comparison artifact: ${comparisonRead.reason}`);

  const baselineRead = await readPersistentBaselineContract(path.join(baselineRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME));
  if (!baselineRead.ok) return invalidRequest(`baseline contract artifact: ${baselineRead.reason}`);

  const changeRead = await readPerChangeContract(path.join(changeRoot, FRONTEND_CONTRACT_MANIFEST_FILENAME));
  if (!changeRead.ok) return invalidRequest(`per-change contract artifact: ${changeRead.reason}`);

  return evaluateAndPersist(
    { before: beforeRead.artifact, after: afterRead.artifact, comparison: comparisonRead.artifact, baseline: baselineRead.contract, change: changeRead.contract },
    options,
  );
}
