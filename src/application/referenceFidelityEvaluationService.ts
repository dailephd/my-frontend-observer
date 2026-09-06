import path from 'node:path';
import { readExternalReferenceArtifact } from '../artifacts/externalReferenceArtifactReader.js';
import { EXTERNAL_REFERENCE_MANIFEST_FILENAME } from '../artifacts/externalReferenceArtifactWriter.js';
import { readObservationArtifact } from '../artifacts/artifactReader.js';
import { MANIFEST_FILENAME as OBSERVATION_MANIFEST_FILENAME } from '../artifacts/artifactWriter.js';
import { evaluateReferenceCandidateFidelity } from '../domain/externalReferenceFidelity.js';
import type { EvaluateReferenceCandidateFidelityOptions, ReferenceCandidateFidelityEvaluation } from '../domain/externalReferenceFidelity.js';
import type { ReferenceRuntimeBindingDeclaration } from '../domain/externalReferenceRuntimeBinding.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';

export type EvaluateReferenceFidelityOptions = EvaluateReferenceCandidateFidelityOptions;

export type ApplicationReferenceFidelityResult = { ok: true; evaluation: ReferenceCandidateFidelityEvaluation } | { ok: false; diagnostics: Diagnostic[] };

/**
 * The canonical CLI-facing orchestration for Prompt 6, mirroring
 * `comparisonService.ts#compareAndPersistFromArtifactRoots`'s exact shape:
 * reads one already-persisted `ExternalReferenceArtifact` and one already-
 * persisted `ObservationArtifact` by their root directories through the
 * existing readers, then delegates to the pure
 * `evaluateReferenceCandidateFidelity` exactly once. A thin wrapper only -
 * artifact reading stays owned by `artifacts/`, evaluation semantics stay
 * owned by `domain/externalReferenceFidelity.ts`. Kept in `application/`
 * (not `artifacts/`) so `src/cli.ts` can depend on it without importing the
 * artifacts layer directly, matching every other command's import-boundary
 * convention. Never launches a browser, never re-resolves targets, and -
 * deliberately, per this prompt's persistence decision - never persists
 * anything: the caller receives the structured in-memory evaluation result
 * directly.
 */
export async function evaluateReferenceCandidateFidelityFromArtifactRoots(
  referenceRoot: string,
  candidateRoot: string,
  bindingDeclarations: readonly ReferenceRuntimeBindingDeclaration[],
  options: EvaluateReferenceFidelityOptions = {},
): Promise<ApplicationReferenceFidelityResult> {
  const referenceRead = await readExternalReferenceArtifact(path.join(referenceRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME));
  if (!referenceRead.ok) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: DIAGNOSTIC_SEVERITY['invalid-request'], message: `--reference external-reference artifact: ${referenceRead.reason}` }],
    };
  }

  const candidateRead = await readObservationArtifact(path.join(candidateRoot, OBSERVATION_MANIFEST_FILENAME));
  if (!candidateRead.ok) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: DIAGNOSTIC_SEVERITY['invalid-request'], message: `--candidate observation artifact: ${candidateRead.reason}` }],
    };
  }

  const result = evaluateReferenceCandidateFidelity(referenceRead.artifact, candidateRead.artifact, bindingDeclarations, options);
  if (!result.ok) {
    return { ok: false, diagnostics: [{ code: 'invalid-request', severity: DIAGNOSTIC_SEVERITY['invalid-request'], message: result.reason }] };
  }

  return { ok: true, evaluation: result.evaluation };
}
