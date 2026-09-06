import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import { deriveCompletion } from '../domain/completion.js';
import { getProducerInfo } from '../domain/schema.js';
import {
  detectExternalReferenceImageFormat,
  readExternalReferenceImageDimensions,
  isValidExternalReferenceImageDimensions,
  fileExtensionForFormat,
  EXTERNAL_REFERENCE_MAX_IMAGE_BYTES,
} from '../domain/externalReferenceImage.js';
import type { ImportedExternalReferenceArtifact, ApprovedExternalReferenceArtifact } from '../domain/externalReference.js';
import { EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION, isImportedExternalReferenceArtifact } from '../domain/externalReference.js';
import { buildExternalReferenceRequestIdentity, buildExternalReferenceInstanceIdentity } from '../domain/externalReferenceIdentity.js';
import { normalizeOutputLocation } from '../request/paths.js';
import { writeExternalReferenceArtifact } from '../artifacts/externalReferenceArtifactWriter.js';
import type { WriteExternalReferenceArtifactOptions } from '../artifacts/externalReferenceArtifactWriter.js';
import { EXTERNAL_REFERENCE_MANIFEST_FILENAME } from '../artifacts/externalReferenceArtifactWriter.js';
import { readExternalReferenceArtifact } from '../artifacts/externalReferenceArtifactReader.js';

export interface ImportExternalReferenceOptions {
  outputLocation: string;
  cwd?: WriteExternalReferenceArtifactOptions['cwd'];
  label?: string;
  /** Root directory of a prior external-reference artifact this import explicitly supersedes. */
  supersedesReferenceRoot?: string;
}

export interface ApproveExternalReferenceOptions {
  outputLocation: string;
  cwd?: WriteExternalReferenceArtifactOptions['cwd'];
  /** Root directory of a prior external-reference artifact this approval explicitly supersedes. */
  supersedesReferenceRoot?: string;
}

export type ApplicationImportExternalReferenceResult =
  | { ok: true; referenceId: string; referenceRequestId: string; artifactRoot: string; manifestPath: string; imagePath: string }
  | { ok: false; diagnostics: Diagnostic[] };

export type ApplicationApproveExternalReferenceResult =
  | { ok: true; referenceId: string; referenceRequestId: string; artifactRoot: string; manifestPath: string }
  | { ok: false; diagnostics: Diagnostic[] };

function failure(code: Diagnostic['code'], message: string): { ok: false; diagnostics: Diagnostic[] } {
  return { ok: false, diagnostics: [{ code, severity: DIAGNOSTIC_SEVERITY[code], message }] };
}

async function resolveSupersedesReferenceId(supersedesReferenceRoot: string | undefined): Promise<{ ok: true; referenceId?: string } | { ok: false; diagnostics: Diagnostic[] }> {
  if (supersedesReferenceRoot === undefined) return { ok: true };
  const read = await readExternalReferenceArtifact(path.join(supersedesReferenceRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME));
  if (!read.ok) return failure('reference-not-found', `supersedesReferenceRoot: ${read.reason}`);
  return { ok: true, referenceId: read.artifact.referenceId };
}

/**
 * The one canonical application-level "import" use case: validates the raw
 * image bytes through the existing pure image-format/dimension boundary
 * (`domain/externalReferenceImage.ts`), resolves an optional explicit
 * supersession target through the existing reader, computes identity through
 * the existing identity module, and persists exactly once through the
 * existing writer. Never approves the result - the persisted artifact's
 * `lifecycle.state` is always `'imported'`, regardless of a supplied label or
 * supersession target (see behavior-model.txt INV-007).
 */
export async function importExternalReference(imageBytes: Uint8Array, options: ImportExternalReferenceOptions): Promise<ApplicationImportExternalReferenceResult> {
  const format = detectExternalReferenceImageFormat(imageBytes);
  if (format === undefined) return failure('unsupported-image-format', 'the supplied bytes do not match any supported reference image format (png, jpeg, webp)');

  if (imageBytes.length > EXTERNAL_REFERENCE_MAX_IMAGE_BYTES) {
    return failure('image-too-large', `reference image is ${imageBytes.length} bytes, exceeding the maximum of ${EXTERNAL_REFERENCE_MAX_IMAGE_BYTES} bytes`);
  }

  const dimensions = readExternalReferenceImageDimensions(imageBytes, format);
  if (dimensions === undefined || !isValidExternalReferenceImageDimensions(dimensions)) {
    return failure('invalid-image-dimensions', 'the supplied reference image header does not contain valid, bounded dimensions');
  }

  const supersedes = await resolveSupersedesReferenceId(options.supersedesReferenceRoot);
  if (!supersedes.ok) return supersedes;

  const normalizedOutput = normalizeOutputLocation(options.outputLocation);
  if (!normalizedOutput.ok) return { ok: false, diagnostics: [normalizedOutput.diagnostic] };

  const imageSha256 = createHash('sha256').update(imageBytes).digest('hex');
  const referenceRequestId = buildExternalReferenceRequestIdentity(imageSha256, format, dimensions.width, dimensions.height, supersedes.referenceId);
  const referenceId = buildExternalReferenceInstanceIdentity(referenceRequestId);

  const artifact: ImportedExternalReferenceArtifact = {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId,
    referenceId,
    producer: getProducerInfo(),
    provenance: { importedAt: new Date().toISOString(), ...(options.label === undefined ? {} : { label: options.label }) },
    image: {
      path: `reference.${fileExtensionForFormat(format)}`,
      format,
      width: dimensions.width,
      height: dimensions.height,
      byteLength: imageBytes.length,
      sha256: imageSha256,
    },
    lifecycle: { state: 'imported' },
    ...(supersedes.referenceId === undefined ? {} : { supersedesReferenceId: supersedes.referenceId }),
    diagnostics: [],
    completion: deriveCompletion([], 'post-capture'),
  };

  const persisted = await writeExternalReferenceArtifact(artifact, imageBytes, normalizedOutput.value, options.cwd === undefined ? {} : { cwd: options.cwd });
  if (!persisted.ok) return { ok: false, diagnostics: persisted.diagnostics };

  return {
    ok: true,
    referenceId: artifact.referenceId,
    referenceRequestId: artifact.referenceRequestId,
    artifactRoot: persisted.artifactRoot,
    manifestPath: persisted.manifestPath,
    imagePath: persisted.imagePath!,
  };
}

/**
 * The one canonical application-level "approval" use case, mirroring
 * `application/frontendContractPersistenceService.ts#approveAndPersistBaseline`'s
 * shape: reads the target through the existing reader, refuses to approve
 * anything not currently in the `'imported'` lifecycle state, resolves an
 * optional explicit supersession target through the same reader, and
 * persists a brand-new artifact instance - never mutating the imported
 * artifact's own manifest - carrying a `sourceReference` back to it instead
 * of a second copy of the image bytes.
 */
export async function approveExternalReference(importedArtifactRoot: string, options: ApproveExternalReferenceOptions): Promise<ApplicationApproveExternalReferenceResult> {
  const read = await readExternalReferenceArtifact(path.join(importedArtifactRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME));
  if (!read.ok) return failure('reference-not-found', read.reason);
  if (!isImportedExternalReferenceArtifact(read.artifact)) {
    return failure(
      'invalid-request',
      `external-reference artifact "${read.artifact.referenceId}" is not in the "imported" lifecycle state; only a freshly imported reference can be approved`,
    );
  }
  const imported = read.artifact;

  const supersedes = await resolveSupersedesReferenceId(options.supersedesReferenceRoot);
  if (!supersedes.ok) return supersedes;

  const normalizedOutput = normalizeOutputLocation(options.outputLocation);
  if (!normalizedOutput.ok) return { ok: false, diagnostics: [normalizedOutput.diagnostic] };

  const referenceId = buildExternalReferenceInstanceIdentity(imported.referenceRequestId);

  const artifact: ApprovedExternalReferenceArtifact = {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: imported.referenceRequestId,
    referenceId,
    producer: getProducerInfo(),
    provenance: { importedAt: imported.provenance.importedAt, ...(imported.provenance.label === undefined ? {} : { label: imported.provenance.label }) },
    sourceReference: {
      referenceId: imported.referenceId,
      referenceRequestId: imported.referenceRequestId,
      producer: imported.producer,
      schemaVersion: imported.schemaVersion,
      image: imported.image,
    },
    lifecycle: { state: 'approved', approvedAt: new Date().toISOString() },
    ...(supersedes.referenceId === undefined ? {} : { supersedesReferenceId: supersedes.referenceId }),
    diagnostics: [],
    completion: deriveCompletion([], 'post-capture'),
  };

  const persisted = await writeExternalReferenceArtifact(artifact, undefined, normalizedOutput.value, options.cwd === undefined ? {} : { cwd: options.cwd });
  if (!persisted.ok) return { ok: false, diagnostics: persisted.diagnostics };

  return {
    ok: true,
    referenceId: artifact.referenceId,
    referenceRequestId: artifact.referenceRequestId,
    artifactRoot: persisted.artifactRoot,
    manifestPath: persisted.manifestPath,
  };
}
