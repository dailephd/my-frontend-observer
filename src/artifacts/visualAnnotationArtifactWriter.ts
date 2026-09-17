import { mkdir, writeFile, rename, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { VisualAnnotationArtifact } from '../domain/visualAnnotation.js';
import { isValidVisualAnnotationArtifact, renderVisualAnnotationOverlaySvg, VISUAL_ANNOTATION_OVERLAY_PATH } from '../domain/visualAnnotation.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';

export const VISUAL_ANNOTATION_MANIFEST_FILENAME = 'manifest.json';
export const VISUAL_ANNOTATION_OVERLAY_FILENAME = VISUAL_ANNOTATION_OVERLAY_PATH;

/**
 * Observer-owned result of persisting one VisualAnnotationArtifact. Mirrors
 * PersistedExternalReferenceResult's shape: the artifact directory owns
 * exactly manifest.json and its derived annotation-overlay.svg.
 */
export type PersistedVisualAnnotationResult =
  | {
      ok: true;
      artifactRoot: string;
      manifestPath: string;
      overlayPath: string;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };

export interface WriteVisualAnnotationArtifactOptions {
  /** Base directory that `outputLocation` is resolved against. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** SHA-256 lowercase hex over the exact UTF-8 bytes of an overlay SVG - shared by the writer, reader, and persistence service. */
export function computeVisualAnnotationOverlaySha256(overlay: string | Uint8Array): string {
  return createHash('sha256')
    .update(typeof overlay === 'string' ? Buffer.from(overlay, 'utf8') : overlay)
    .digest('hex');
}

function writeFailure(message: string, details?: Record<string, unknown>): PersistedVisualAnnotationResult {
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

/**
 * Persists one already-assembled VisualAnnotationArtifact as one portable
 * artifact directory: `<outputLocation>/<annotationId>/{annotation-overlay.svg,manifest.json}`.
 *
 * The overlay is always re-derived here through the one canonical renderer
 * (`domain/visualAnnotation.ts#renderVisualAnnotationOverlaySvg`) and its
 * digest must equal `artifact.overlay.sha256`; a mismatch is refused rather
 * than persisted. Never reads or copies the source observation screenshot or
 * reference image.
 *
 * `annotationId` is fresh per persisted instance, so an existing directory at
 * the final path is treated as a genuine collision and refused rather than
 * overwritten. Writing happens in a sibling temporary directory
 * (`.tmp-<annotationId>`), owned overlay media before manifest.json
 * (manifest-last), and the whole directory is exposed under its real name
 * only via one atomic rename. The temporary directory is removed on failure.
 */
export async function writeVisualAnnotationArtifact(
  artifact: VisualAnnotationArtifact,
  outputLocation: string,
  options: WriteVisualAnnotationArtifactOptions = {},
): Promise<PersistedVisualAnnotationResult> {
  const validation = isValidVisualAnnotationArtifact(artifact);
  if (!validation.valid) {
    return writeFailure(`refusing to persist an invalid VisualAnnotationArtifact: ${validation.reason}`);
  }

  const overlaySvg = renderVisualAnnotationOverlaySvg(artifact.source, artifact.items);
  const overlayBytes = Buffer.from(overlaySvg, 'utf8');
  const overlaySha256 = computeVisualAnnotationOverlaySha256(overlayBytes);
  if (overlaySha256 !== artifact.overlay.sha256) {
    return writeFailure('refusing to persist a VisualAnnotationArtifact whose overlay.sha256 does not match the deterministically rendered overlay', {
      expectedSha256: overlaySha256,
      declaredSha256: artifact.overlay.sha256,
    });
  }

  const cwd = options.cwd ?? process.cwd();
  const outputRoot = path.resolve(cwd, outputLocation);
  const finalRoot = path.join(outputRoot, artifact.annotationId);
  const tempRoot = path.join(outputRoot, `.tmp-${artifact.annotationId}`);

  if (await pathExists(finalRoot)) {
    return writeFailure(`a visual-annotation artifact already exists at "${artifact.annotationId}"; refusing to overwrite it`, {
      artifactRoot: finalRoot,
    });
  }

  try {
    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(tempRoot, { recursive: true });

    await writeFile(path.join(tempRoot, VISUAL_ANNOTATION_OVERLAY_FILENAME), overlayBytes);
    await writeFile(path.join(tempRoot, VISUAL_ANNOTATION_MANIFEST_FILENAME), JSON.stringify(artifact, null, 2), 'utf8');

    await rename(tempRoot, finalRoot);

    return {
      ok: true,
      artifactRoot: finalRoot,
      manifestPath: path.join(finalRoot, VISUAL_ANNOTATION_MANIFEST_FILENAME),
      overlayPath: path.join(finalRoot, VISUAL_ANNOTATION_OVERLAY_FILENAME),
    };
  } catch (err) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return writeFailure(`failed to persist visual-annotation artifact: ${message}`);
  }
}
