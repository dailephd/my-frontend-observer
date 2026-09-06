import { mkdir, writeFile, rename, rm, access } from 'node:fs/promises';
import path from 'node:path';
import type { ExternalReferenceArtifact } from '../domain/externalReference.js';
import { isValidExternalReferenceArtifact, isImportedExternalReferenceArtifact } from '../domain/externalReference.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';

export const EXTERNAL_REFERENCE_MANIFEST_FILENAME = 'manifest.json';

/**
 * Observer-owned result of persisting one ExternalReferenceArtifact. Mirrors
 * PersistedObservationResult/PersistedComparisonResult's shape but is its own
 * type: an 'imported' artifact's directory has one owned image file; an
 * 'approved' artifact's directory has only manifest.json.
 */
export type PersistedExternalReferenceResult =
  | {
      ok: true;
      artifactRoot: string;
      manifestPath: string;
      imagePath?: string;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };

function writeFailure(message: string, details?: Record<string, unknown>): PersistedExternalReferenceResult {
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

export interface WriteExternalReferenceArtifactOptions {
  /** Base directory that `outputLocation` is resolved against. Defaults to `process.cwd()`. */
  cwd?: string;
}

/**
 * Persists one already-assembled, already-validated ExternalReferenceArtifact
 * as one portable artifact directory: `<outputLocation>/<referenceId>/`.
 * For an 'imported' artifact (which owns its reference image), `imageBytes`
 * is required and is written before manifest.json, mirroring
 * `artifacts/artifactWriter.ts#writeObservationArtifact`'s media-before-manifest
 * discipline. For an 'approved' artifact (which only ever carries a
 * `sourceReference` back to the imported artifact that owns the image - see
 * `domain/externalReference.ts`), no image bytes are written at all, mirroring
 * `artifacts/comparisonArtifactWriter.ts#writeComparisonArtifact`'s
 * manifest-only, no-media-copy persistence.
 *
 * `referenceId` is guaranteed fresh per persisted instance (see
 * `domain/externalReferenceIdentity.ts#buildExternalReferenceInstanceIdentity`'s
 * "never collides" contract), so each write targets its own unique
 * subdirectory; an existing directory at that path is treated as a genuine
 * collision and rejected rather than overwritten - no persisted evidence,
 * imported or approved, is ever destructively replaced. Writing happens in a
 * sibling temporary directory first, and the whole temporary directory is
 * only exposed under its real name via one atomic rename.
 */
export async function writeExternalReferenceArtifact(
  artifact: ExternalReferenceArtifact,
  imageBytes: Uint8Array | undefined,
  outputLocation: string,
  options: WriteExternalReferenceArtifactOptions = {},
): Promise<PersistedExternalReferenceResult> {
  const validation = isValidExternalReferenceArtifact(artifact);
  if (!validation.valid) {
    return writeFailure(`refusing to persist an invalid ExternalReferenceArtifact: ${validation.reason}`);
  }
  if (artifact.lifecycle.state === 'imported' && imageBytes === undefined) {
    return writeFailure('refusing to persist an "imported" ExternalReferenceArtifact without its image bytes');
  }

  const cwd = options.cwd ?? process.cwd();
  const outputRoot = path.resolve(cwd, outputLocation);
  const finalRoot = path.join(outputRoot, artifact.referenceId);
  const tempRoot = path.join(outputRoot, `.tmp-${artifact.referenceId}`);

  if (await pathExists(finalRoot)) {
    return writeFailure(`an external-reference artifact already exists at "${artifact.referenceId}"; refusing to overwrite it`, {
      artifactRoot: finalRoot,
    });
  }

  try {
    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(tempRoot, { recursive: true });

    if (isImportedExternalReferenceArtifact(artifact)) {
      await writeFile(path.join(tempRoot, artifact.image.path), imageBytes!);
    }
    await writeFile(path.join(tempRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME), JSON.stringify(artifact, null, 2), 'utf8');

    await rename(tempRoot, finalRoot);

    return {
      ok: true,
      artifactRoot: finalRoot,
      manifestPath: path.join(finalRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME),
      ...(isImportedExternalReferenceArtifact(artifact) ? { imagePath: path.join(finalRoot, artifact.image.path) } : {}),
    };
  } catch (err) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return writeFailure(`failed to persist external-reference artifact: ${message}`);
  }
}
