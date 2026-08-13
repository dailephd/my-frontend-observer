import { readFile } from 'node:fs/promises';
import type { FrontendContractEvaluationArtifact } from '../domain/frontendContractEvaluationArtifact.js';
import { isValidFrontendContractEvaluationArtifact } from '../domain/frontendContractEvaluationArtifact.js';

export type ReadFrontendContractEvaluationArtifactResult = { ok: true; artifact: FrontendContractEvaluationArtifact } | { ok: false; reason: string };

/**
 * Narrow canonical reader counterpart to
 * `frontendContractEvaluationArtifactWriter.ts#writeFrontendContractEvaluationArtifact`:
 * reads one `manifest.json`, parses it, and validates it through the same
 * `isValidFrontendContractEvaluationArtifact` structural gate the writer
 * uses. Read-only: never mutates the file, never recomputes or reinterprets
 * the evaluation, never repairs a malformed artifact.
 */
export async function readFrontendContractEvaluationArtifact(manifestPath: string): Promise<ReadFrontendContractEvaluationArtifactResult> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `failed to read evaluation artifact manifest at "${manifestPath}": ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `evaluation artifact manifest at "${manifestPath}" is not valid JSON: ${message}` };
  }

  const validation = isValidFrontendContractEvaluationArtifact(parsed);
  if (!validation.valid) {
    return { ok: false, reason: `evaluation artifact manifest at "${manifestPath}" failed structural validation: ${validation.reason}` };
  }

  return { ok: true, artifact: parsed as FrontendContractEvaluationArtifact };
}
