import { mkdir, writeFile, rename, rm, access } from 'node:fs/promises';
import path from 'node:path';
import type { ComparisonArtifact } from '../domain/comparison.js';
import { isValidComparisonArtifact } from '../domain/comparison.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';

export const COMPARISON_MANIFEST_FILENAME = 'manifest.json';

/**
 * Observer-owned result of persisting one ComparisonArtifact. Mirrors
 * `PersistedObservationResult`'s shape/semantics but is its own type: a
 * comparison directory has no screenshot file, and this writer never touches
 * `src/artifacts/artifactWriter.ts` or its observation-persistence
 * guarantees.
 */
export type PersistedComparisonResult =
  | {
      ok: true;
      artifactRoot: string;
      manifestPath: string;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };

function writeFailure(message: string, details?: Record<string, unknown>): PersistedComparisonResult {
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

export interface WriteComparisonArtifactOptions {
  /** Base directory that `outputLocation` is resolved against. Defaults to `process.cwd()`. */
  cwd?: string;
}

/**
 * Persists one already-assembled, already-validated `ComparisonArtifact` as
 * one portable artifact directory: `<outputLocation>/<comparisonId>/manifest.json`
 * only - no screenshot is copied (the manifest's `before`/`after.screenshot`
 * fields already point back to the source observations; see
 * `domain/comparisonEngine.ts#sourceReference`), and no `relationships.json`/
 * `differences.json`/`diff.png` side files are produced.
 *
 * Follows the same atomic-write discipline as
 * `artifacts/artifactWriter.ts#writeObservationArtifact` (sibling temporary
 * directory, then one atomic rename onto the final name) without sharing its
 * implementation - a comparison directory has a different, smaller content
 * shape, and this function never touches observation persistence. A fresh
 * `comparisonId` per execution normally prevents collisions; an existing
 * directory at the final path is treated as a genuine collision and
 * rejected rather than overwritten, so prior comparison evidence is never
 * destructively replaced.
 */
export async function writeComparisonArtifact(
  artifact: ComparisonArtifact,
  outputLocation: string,
  options: WriteComparisonArtifactOptions = {},
): Promise<PersistedComparisonResult> {
  const validation = isValidComparisonArtifact(artifact);
  if (!validation.valid) {
    return writeFailure(`refusing to persist an invalid ComparisonArtifact: ${validation.reason}`);
  }

  const cwd = options.cwd ?? process.cwd();
  const outputRoot = path.resolve(cwd, outputLocation);
  const finalRoot = path.join(outputRoot, artifact.comparisonId);
  const tempRoot = path.join(outputRoot, `.tmp-${artifact.comparisonId}`);

  if (await pathExists(finalRoot)) {
    return writeFailure(`a comparison artifact already exists at "${artifact.comparisonId}"; refusing to overwrite it`, {
      artifactRoot: finalRoot,
    });
  }

  try {
    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(tempRoot, { recursive: true });

    await writeFile(path.join(tempRoot, COMPARISON_MANIFEST_FILENAME), JSON.stringify(artifact, null, 2), 'utf8');

    await rename(tempRoot, finalRoot);

    return {
      ok: true,
      artifactRoot: finalRoot,
      manifestPath: path.join(finalRoot, COMPARISON_MANIFEST_FILENAME),
    };
  } catch (err) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return writeFailure(`failed to persist comparison artifact: ${message}`);
  }
}
