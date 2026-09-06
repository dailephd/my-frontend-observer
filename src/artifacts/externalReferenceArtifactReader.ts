import { readFile } from 'node:fs/promises';
import type { ExternalReferenceArtifact } from '../domain/externalReference.js';
import { isValidExternalReferenceArtifact } from '../domain/externalReference.js';

export type ReadExternalReferenceArtifactResult = { ok: true; artifact: ExternalReferenceArtifact } | { ok: false; reason: string };

/**
 * Narrow canonical reader counterpart to
 * `externalReferenceArtifactWriter.ts#writeExternalReferenceArtifact`: reads
 * one `manifest.json`, parses it, and validates it through the same
 * `isValidExternalReferenceArtifact` structural gate the writer itself uses -
 * never a second validator. Read-only: never mutates the file, never resolves
 * the sibling image file's bytes (an 'imported' manifest's `image.path` field
 * is returned as-is for the caller to resolve if it needs the bytes).
 */
export async function readExternalReferenceArtifact(manifestPath: string): Promise<ReadExternalReferenceArtifactResult> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `failed to read external-reference artifact manifest at "${manifestPath}": ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `external-reference artifact manifest at "${manifestPath}" is not valid JSON: ${message}` };
  }

  const validation = isValidExternalReferenceArtifact(parsed);
  if (!validation.valid) {
    return { ok: false, reason: `external-reference artifact manifest at "${manifestPath}" failed structural validation: ${validation.reason}` };
  }

  return { ok: true, artifact: parsed as ExternalReferenceArtifact };
}
