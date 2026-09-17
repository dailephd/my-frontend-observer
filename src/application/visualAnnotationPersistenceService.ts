import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import { getProducerInfo } from '../domain/schema.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem, VisualAnnotationSource } from '../domain/visualAnnotation.js';
import {
  VISUAL_ANNOTATION_ARTIFACT_KIND,
  VISUAL_ANNOTATION_SCHEMA_VERSION,
  VISUAL_ANNOTATION_OVERLAY_PATH,
  isValidVisualAnnotationContent,
  renderVisualAnnotationOverlaySvg,
} from '../domain/visualAnnotation.js';
import { buildVisualAnnotationRequestIdentity, buildVisualAnnotationInstanceIdentity } from '../domain/visualAnnotationIdentity.js';
import { normalizeOutputLocation } from '../request/paths.js';
import { writeVisualAnnotationArtifact, computeVisualAnnotationOverlaySha256 } from '../artifacts/visualAnnotationArtifactWriter.js';
import type { WriteVisualAnnotationArtifactOptions } from '../artifacts/visualAnnotationArtifactWriter.js';

export interface PersistVisualAnnotationOptions {
  source: VisualAnnotationSource;
  items: VisualAnnotationItem[];
  outputLocation: string;
  cwd?: WriteVisualAnnotationArtifactOptions['cwd'];
  /** Canonical annotationId of the previous artifact this save explicitly revises. Carried forward verbatim; lineage is not resolved here. */
  supersedesAnnotationId?: string;
}

export type ApplicationPersistVisualAnnotationResult =
  | {
      ok: true;
      annotationId: string;
      annotationRequestId: string;
      artifactRoot: string;
      manifestPath: string;
      overlayPath: string;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };

function failure(code: Diagnostic['code'], message: string): { ok: false; diagnostics: Diagnostic[] } {
  return { ok: false, diagnostics: [{ code, severity: DIAGNOSTIC_SEVERITY[code], message }] };
}

/**
 * The one canonical Batch 1 application use case for saving a visual
 * annotation: validates source/items through the canonical annotation domain,
 * normalizes the portable output location, derives the deterministic request
 * identity and a fresh instance identity, renders the deterministic overlay
 * and its SHA-256, and persists exactly once through the canonical writer.
 *
 * It never reads a viewer alias, resolves another artifact, checks revision
 * lineage, checks whether an associated target/region exists, promotes a
 * contract, materializes a reference, or modifies project configuration.
 */
export async function persistVisualAnnotation(options: PersistVisualAnnotationOptions): Promise<ApplicationPersistVisualAnnotationResult> {
  const contentValidation = isValidVisualAnnotationContent(options.source, options.items);
  if (!contentValidation.valid) return failure('invalid-request', `invalid visual annotation: ${contentValidation.reason}`);

  if (options.supersedesAnnotationId !== undefined && options.supersedesAnnotationId.length === 0) {
    return failure('invalid-request', 'supersedesAnnotationId must be a non-empty string when supplied');
  }

  const normalizedOutput = normalizeOutputLocation(options.outputLocation);
  if (!normalizedOutput.ok) return { ok: false, diagnostics: [normalizedOutput.diagnostic] };

  const { source, items } = options;
  const annotationRequestId = buildVisualAnnotationRequestIdentity(source, items, options.supersedesAnnotationId);
  const annotationId = buildVisualAnnotationInstanceIdentity(annotationRequestId);
  const overlaySha256 = computeVisualAnnotationOverlaySha256(renderVisualAnnotationOverlaySvg(source, items));

  const artifact: VisualAnnotationArtifact = {
    artifactKind: VISUAL_ANNOTATION_ARTIFACT_KIND,
    schemaVersion: VISUAL_ANNOTATION_SCHEMA_VERSION,
    annotationRequestId,
    annotationId,
    ...(options.supersedesAnnotationId === undefined ? {} : { supersedesAnnotationId: options.supersedesAnnotationId }),
    producer: getProducerInfo(),
    source,
    items,
    overlay: {
      path: VISUAL_ANNOTATION_OVERLAY_PATH,
      format: 'svg',
      width: source.coordinateSpace.width,
      height: source.coordinateSpace.height,
      sha256: overlaySha256,
    },
    provenance: {
      createdAt: new Date().toISOString(),
      origin: 'viewer',
    },
  };

  const persisted = await writeVisualAnnotationArtifact(artifact, normalizedOutput.value, options.cwd === undefined ? {} : { cwd: options.cwd });
  if (!persisted.ok) return { ok: false, diagnostics: persisted.diagnostics };

  return {
    ok: true,
    annotationId,
    annotationRequestId,
    artifactRoot: persisted.artifactRoot,
    manifestPath: persisted.manifestPath,
    overlayPath: persisted.overlayPath,
  };
}
