import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { VisualAnnotationArtifact } from '../domain/visualAnnotation.js';
import { isValidVisualAnnotationArtifact } from '../domain/visualAnnotation.js';
import { VISUAL_ANNOTATION_OVERLAY_FILENAME, computeVisualAnnotationOverlaySha256 } from './visualAnnotationArtifactWriter.js';

export type ReadVisualAnnotationArtifactResult =
  | {
      ok: true;
      artifact: VisualAnnotationArtifact;
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Narrow canonical reader counterpart to
 * `visualAnnotationArtifactWriter.ts#writeVisualAnnotationArtifact`: reads one
 * `manifest.json`, parses it, validates it through the same
 * `isValidVisualAnnotationArtifact` gate the writer uses (never a second
 * validator), then verifies the owned sibling `annotation-overlay.svg`: it
 * must be a regular file (lstat, never following a symlink/junction) whose
 * SHA-256 equals `overlay.sha256`. Read-only: never repairs a manifest, never
 * regenerates a missing overlay, never accepts an unsupported schema version.
 */
export async function readVisualAnnotationArtifact(manifestPath: string): Promise<ReadVisualAnnotationArtifactResult> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `failed to read visual-annotation artifact manifest at "${manifestPath}": ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `visual-annotation artifact manifest at "${manifestPath}" is not valid JSON: ${message}` };
  }

  const validation = isValidVisualAnnotationArtifact(parsed);
  if (!validation.valid) {
    return { ok: false, reason: `visual-annotation artifact manifest at "${manifestPath}" failed structural validation: ${validation.reason}` };
  }
  const artifact = parsed as VisualAnnotationArtifact;

  // The validator already pins overlay.path to the exact owned filename; this re-check keeps the
  // filesystem resolution below fail-closed even if that contract ever changed.
  if (artifact.overlay.path !== VISUAL_ANNOTATION_OVERLAY_FILENAME) {
    return { ok: false, reason: `visual-annotation artifact manifest at "${manifestPath}" references an unsupported overlay path` };
  }
  const overlayPath = path.join(path.dirname(manifestPath), VISUAL_ANNOTATION_OVERLAY_FILENAME);

  try {
    const info = await lstat(overlayPath);
    if (!info.isFile()) {
      return { ok: false, reason: `visual-annotation overlay at "${overlayPath}" is not a regular file` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `visual-annotation overlay at "${overlayPath}" is missing: ${message}` };
  }

  let overlayBytes: Uint8Array;
  try {
    overlayBytes = await readFile(overlayPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `failed to read visual-annotation overlay at "${overlayPath}": ${message}` };
  }

  if (computeVisualAnnotationOverlaySha256(overlayBytes) !== artifact.overlay.sha256) {
    return { ok: false, reason: `visual-annotation overlay at "${overlayPath}" does not match overlay.sha256` };
  }

  return { ok: true, artifact };
}
