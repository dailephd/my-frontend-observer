import { readFile } from 'node:fs/promises';
import type { ComparisonArtifact } from '../domain/comparison.js';
import { isValidComparisonArtifact } from '../domain/comparison.js';

export type ReadComparisonArtifactResult = { ok: true; artifact: ComparisonArtifact } | { ok: false; reason: string };

/**
 * v0.5 Batch 3 addition: no canonical comparison-artifact reader existed
 * before this batch (only `readObservationArtifact` did). Narrow counterpart
 * to `artifacts/comparisonArtifactWriter.ts#writeComparisonArtifact`: reads
 * one `manifest.json`, parses it, and validates it through the same
 * `isValidComparisonArtifact` structural gate the writer uses - never a
 * second validator, never a schema upgrade. Comparison schema remains
 * `1.0.0`; this reader changes no comparison semantics.
 */
export async function readComparisonArtifact(manifestPath: string): Promise<ReadComparisonArtifactResult> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `failed to read comparison artifact manifest at "${manifestPath}": ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `comparison artifact manifest at "${manifestPath}" is not valid JSON: ${message}` };
  }

  const validation = isValidComparisonArtifact(parsed);
  if (!validation.valid) {
    return { ok: false, reason: `comparison artifact manifest at "${manifestPath}" failed structural validation: ${validation.reason}` };
  }

  return { ok: true, artifact: parsed as ComparisonArtifact };
}
