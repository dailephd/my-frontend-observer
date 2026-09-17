import { SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION } from '../../src/domain/schema.js';
import { EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import {
  VISUAL_ANNOTATION_ARTIFACT_KIND,
  VISUAL_ANNOTATION_SCHEMA_VERSION,
  renderVisualAnnotationOverlaySvg,
} from '../../src/domain/visualAnnotation.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem, VisualAnnotationSource } from '../../src/domain/visualAnnotation.js';
import { computeVisualAnnotationOverlaySha256 } from '../../src/artifacts/visualAnnotationArtifactWriter.js';

export const REFERENCE_IMAGE_SHA256 = 'a'.repeat(64);

export function runtimeSource(): Extract<VisualAnnotationSource, { kind: 'runtime-observation' }> {
  return {
    kind: 'runtime-observation',
    observationId: 'obs-request-1-instance-1',
    requestId: 'obs-request-1',
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    screenshot: { path: 'screenshot.png' },
    coordinateSpace: { kind: 'runtime-css-px', width: 1280, height: 720 },
  };
}

export function referenceSource(): Extract<VisualAnnotationSource, { kind: 'external-reference' }> {
  return {
    kind: 'external-reference',
    referenceId: 'ref-request-1-instance-1',
    referenceRequestId: 'ref-request-1',
    referenceSchemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    lifecycle: 'imported',
    imageOwnerReferenceId: 'ref-request-1-instance-1',
    imageSha256: REFERENCE_IMAGE_SHA256,
    coordinateSpace: { kind: 'reference-image-px', width: 1600, height: 900 },
  };
}

export function runtimeRectangleItem(annotationItemId = 'item-1'): VisualAnnotationItem {
  return {
    annotationItemId,
    mark: { kind: 'rectangle', x: 100, y: 50, width: 300, height: 200 },
    association: { kind: 'runtime-target', target: 'hero' },
    interpretation: { state: 'uninterpreted' },
  };
}

export function referenceRectangleItem(annotationItemId = 'item-1'): VisualAnnotationItem {
  return {
    annotationItemId,
    mark: { kind: 'rectangle', x: 10, y: 20, width: 400, height: 300 },
    association: { kind: 'reference-region', regionId: 'hero' },
    interpretation: { state: 'uninterpreted' },
  };
}

export function buildArtifact(
  source: VisualAnnotationSource,
  items: VisualAnnotationItem[],
  overrides: Partial<VisualAnnotationArtifact> = {},
): VisualAnnotationArtifact {
  return {
    artifactKind: VISUAL_ANNOTATION_ARTIFACT_KIND,
    schemaVersion: VISUAL_ANNOTATION_SCHEMA_VERSION,
    annotationRequestId: 'annotation-request-1',
    annotationId: 'annotation-request-1-instance-1',
    producer: { name: 'my-frontend-observer', version: '0.8.1' },
    source,
    items,
    overlay: {
      path: 'annotation-overlay.svg',
      format: 'svg',
      width: source.coordinateSpace.width,
      height: source.coordinateSpace.height,
      sha256: computeVisualAnnotationOverlaySha256(renderVisualAnnotationOverlaySvg(source, items)),
    },
    provenance: { createdAt: '2026-09-17T00:00:00.000Z', origin: 'viewer' },
    ...overrides,
  };
}
