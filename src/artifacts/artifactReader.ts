import { readFile } from 'node:fs/promises';
import type { ObservationArtifact } from '../domain/schema.js';
import { isValidObservationArtifact } from '../domain/schema.js';

export type ReadObservationArtifactResult = { ok: true; artifact: ObservationArtifact } | { ok: false; reason: string };

/**
 * Narrow canonical reader counterpart to `artifactWriter.ts#writeObservationArtifact`:
 * reads one `manifest.json`, parses it, and validates it through the same
 * `isValidObservationArtifact` structural gate the writer itself uses -
 * never a second validator. Read-only: never mutates the file, never
 * launches a browser, never resolves the sibling screenshot's bytes (the
 * manifest's `screenshot.path` field is returned as-is for the caller to
 * resolve if it needs to). Established here as the canonical reader ahead of
 * the Batch 4 `compare` CLI's `--before`/`--after` path arguments.
 */
export async function readObservationArtifact(manifestPath: string): Promise<ReadObservationArtifactResult> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `failed to read observation artifact manifest at "${manifestPath}": ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `observation artifact manifest at "${manifestPath}" is not valid JSON: ${message}` };
  }

  const validation = isValidObservationArtifact(parsed);
  if (!validation.valid) {
    return { ok: false, reason: `observation artifact manifest at "${manifestPath}" failed structural validation: ${validation.reason}` };
  }

  return { ok: true, artifact: parsed as ObservationArtifact };
}
