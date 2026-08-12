import path from 'node:path';
import type { ObservationArtifact } from '../domain/schema.js';
import type { ComparabilityState, ComparisonConfig } from '../domain/comparison.js';
import { compareObservations } from '../domain/comparisonEngine.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import { normalizeOutputLocation } from '../request/paths.js';
import { writeComparisonArtifact } from '../artifacts/comparisonArtifactWriter.js';
import type { WriteComparisonArtifactOptions } from '../artifacts/comparisonArtifactWriter.js';
import { readObservationArtifact } from '../artifacts/artifactReader.js';
import { MANIFEST_FILENAME as OBSERVATION_MANIFEST_FILENAME } from '../artifacts/artifactWriter.js';

export type { PersistedComparisonResult } from '../artifacts/comparisonArtifactWriter.js';

/** Default comparison output location, mirroring `request.ts`'s `DEFAULT_OUTPUT_LOCATION` for observations - distinct directories so comparisons never collide with source observations. */
export const DEFAULT_COMPARISON_OUTPUT_LOCATION = 'comparisons';

export interface CompareAndPersistOptions {
  config?: Partial<ComparisonConfig>;
  /** Portable, relative output location (validated the same way as an observation's `outputLocation`). Defaults to `DEFAULT_COMPARISON_OUTPUT_LOCATION`. */
  outputLocation?: string;
  cwd?: WriteComparisonArtifactOptions['cwd'];
}

/**
 * Observer-owned summary of one full compare-and-persist attempt, with just
 * enough information for a presentation layer (a future Batch 4 CLI) to
 * report a result without seeing a raw filesystem exception or persistence
 * implementation detail.
 */
export type ApplicationComparisonResult =
  | {
      ok: true;
      comparisonId: string;
      comparisonRequestId: string;
      comparability: ComparabilityState;
      artifactRoot: string;
      manifestPath: string;
      differenceCount: number;
      relationshipChangeCount: number;
      diagnosticsCount: number;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };

/**
 * The one canonical application-level comparison use case: takes two
 * already-validated/in-memory `ObservationArtifact`s, runs the existing pure
 * `compareObservations` exactly once, and - only for a structurally valid
 * result - persists it exactly once through the existing comparison
 * writer. Never launches Chromium, never re-resolves targets, never mutates
 * either source observation.
 */
export async function compareAndPersist(
  before: ObservationArtifact,
  after: ObservationArtifact,
  options: CompareAndPersistOptions = {},
): Promise<ApplicationComparisonResult> {
  const result = compareObservations(before, after, options.config ?? {});
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: DIAGNOSTIC_SEVERITY['invalid-request'], message: result.reason }],
    };
  }

  const rawOutputLocation = options.outputLocation ?? DEFAULT_COMPARISON_OUTPUT_LOCATION;
  const normalized = normalizeOutputLocation(rawOutputLocation);
  if (!normalized.ok) {
    return { ok: false, diagnostics: [normalized.diagnostic] };
  }

  const persisted = await writeComparisonArtifact(result.artifact, normalized.value, options.cwd === undefined ? {} : { cwd: options.cwd });
  if (!persisted.ok) {
    return { ok: false, diagnostics: persisted.diagnostics };
  }

  return {
    ok: true,
    comparisonId: result.artifact.comparisonId,
    comparisonRequestId: result.artifact.comparisonRequestId,
    comparability: result.artifact.comparability.state,
    artifactRoot: persisted.artifactRoot,
    manifestPath: persisted.manifestPath,
    differenceCount: result.artifact.differences.length,
    relationshipChangeCount: result.artifact.relationshipChanges.length,
    diagnosticsCount: result.artifact.diagnostics.length,
  };
}

/**
 * The canonical Batch 4 CLI-facing orchestration: reads two already-persisted
 * observation artifacts by their root directory (each expected to contain
 * `manifest.json`, mirroring `writeObservationArtifact`'s own layout) through
 * the existing `readObservationArtifact` reader, then delegates to
 * `compareAndPersist` exactly once. A thin wrapper only - artifact reading
 * stays owned by `artifacts/artifactReader.ts`, comparison stays owned by
 * `domain/comparisonEngine.ts`, and persistence stays owned by
 * `artifacts/comparisonArtifactWriter.ts`. Kept in `application/` (not
 * `artifacts/`) so `src/cli.ts` can depend on it without importing the
 * artifacts layer directly - see `tests/unit/cli.test.ts`'s import-boundary
 * assertion. Never launches a browser, never re-resolves targets.
 */
export async function compareAndPersistFromArtifactRoots(
  beforeRoot: string,
  afterRoot: string,
  options: CompareAndPersistOptions = {},
): Promise<ApplicationComparisonResult> {
  const beforeRead = await readObservationArtifact(path.join(beforeRoot, OBSERVATION_MANIFEST_FILENAME));
  if (!beforeRead.ok) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: DIAGNOSTIC_SEVERITY['invalid-request'], message: `--before observation artifact: ${beforeRead.reason}` }],
    };
  }

  const afterRead = await readObservationArtifact(path.join(afterRoot, OBSERVATION_MANIFEST_FILENAME));
  if (!afterRead.ok) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: DIAGNOSTIC_SEVERITY['invalid-request'], message: `--after observation artifact: ${afterRead.reason}` }],
    };
  }

  return compareAndPersist(beforeRead.artifact, afterRead.artifact, options);
}
