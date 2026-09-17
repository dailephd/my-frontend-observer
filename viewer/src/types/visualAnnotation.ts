/**
 * v0.9 Batch 3: type-only re-exports of the canonical visual-annotation
 * domain types, mirroring `observation.ts`. Erased at build time - the viewer
 * gains no second runtime validator, renderer, or identity implementation.
 * The server (Prompt 1/2 owners) remains the structural authority.
 */
export type {
  VisualAnnotationArtifact,
  VisualAnnotationSource,
  VisualAnnotationItem,
  VisualAnnotationMark,
  VisualAnnotationIntent,
  VisualAnnotationInterpretation,
  RuntimeAnnotationAssociation,
  ReferenceAnnotationAssociation,
} from '../../../src/domain/visualAnnotation.js';
