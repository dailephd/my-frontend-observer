import { mkdir, writeFile, rename, rm, access } from 'node:fs/promises';
import path from 'node:path';
import type { FrontendContractEvaluationArtifact } from '../domain/frontendContractEvaluationArtifact.js';
import { isValidFrontendContractEvaluationArtifact } from '../domain/frontendContractEvaluationArtifact.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';

export const EVALUATION_MANIFEST_FILENAME = 'manifest.json';

export type PersistedFrontendContractEvaluationResult =
  | { ok: true; artifactRoot: string; manifestPath: string }
  | { ok: false; diagnostics: Diagnostic[] };

function writeFailure(message: string, details?: Record<string, unknown>): PersistedFrontendContractEvaluationResult {
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

export interface WriteFrontendContractEvaluationArtifactOptions {
  /** Base directory that `outputLocation` is resolved against. Defaults to `process.cwd()`. */
  cwd?: string;
}

/**
 * Persists one already-built, already-valid `FrontendContractEvaluationArtifact`
 * as `<outputLocation>/<evaluationId>/manifest.json` only - no screenshot is
 * copied (the artifact's `before`/`after` fields already point back to the
 * source observations). Same atomic-write discipline as
 * `artifactWriter.ts#writeObservationArtifact`/`comparisonArtifactWriter.ts#writeComparisonArtifact`
 * without sharing their implementation: sibling temporary directory, then one
 * atomic rename. `evaluationId` is fresh per execution (see
 * `frontendContractIdentity.ts#buildFrontendContractInstanceIdentity`), so an
 * existing directory at the final path is a genuine collision and is
 * rejected rather than overwritten - a legitimate PASS or FAIL evaluation
 * result is never silently replaced. A `FAIL` verdict is a legitimate,
 * persistable evaluation result, not a write failure; only an unpersistable
 * artifact (invalid shape, or a real filesystem error) is reported as
 * `ok: false`.
 */
export async function writeFrontendContractEvaluationArtifact(
  artifact: FrontendContractEvaluationArtifact,
  outputLocation: string,
  options: WriteFrontendContractEvaluationArtifactOptions = {},
): Promise<PersistedFrontendContractEvaluationResult> {
  const validation = isValidFrontendContractEvaluationArtifact(artifact);
  if (!validation.valid) return writeFailure(`refusing to persist an invalid FrontendContractEvaluationArtifact: ${validation.reason}`);

  const cwd = options.cwd ?? process.cwd();
  const outputRoot = path.resolve(cwd, outputLocation);
  const finalRoot = path.join(outputRoot, artifact.evaluationId);
  const tempRoot = path.join(outputRoot, `.tmp-${artifact.evaluationId}`);

  if (await pathExists(finalRoot)) {
    return writeFailure(`an evaluation artifact already exists at "${artifact.evaluationId}"; refusing to overwrite it`, { artifactRoot: finalRoot });
  }

  try {
    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(tempRoot, { recursive: true });

    await writeFile(path.join(tempRoot, EVALUATION_MANIFEST_FILENAME), JSON.stringify(artifact, null, 2), 'utf8');

    await rename(tempRoot, finalRoot);

    return { ok: true, artifactRoot: finalRoot, manifestPath: path.join(finalRoot, EVALUATION_MANIFEST_FILENAME) };
  } catch (err) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return writeFailure(`failed to persist evaluation artifact: ${message}`);
  }
}
