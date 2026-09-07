/**
 * Batch 5: type-only re-exports of the canonical Node-side external-reference
 * domain types, so the viewer never redefines reference/region/requirement
 * shapes. Erased entirely at build time (`import type`).
 */
export type {
  ExternalReferenceArtifact,
  ImportedExternalReferenceArtifact,
  ApprovedExternalReferenceArtifact,
  ExternalReferenceImageReference,
  ExternalReferenceSourceReference,
  ExternalReferenceLifecycleState,
  ExternalReferenceProvenance,
} from '../../../src/domain/externalReference.js';

export type { ReferenceRegion, ReferenceRegionRectangle, ReferenceRegionGeometry } from '../../../src/domain/externalReferenceRegions.js';

export type { ReferenceRegionRelationship, ReferenceRegionRelationshipGraph } from '../../../src/domain/externalReferenceRegionRelationships.js';

export type {
  ExternalReferenceRequirement,
  ReferenceRequirementSubject,
  RegionPropertyRequirementSubject,
  RegionRelationshipRequirementSubject,
  RegionMeasurementRequirementSubject,
  ReferenceRequirementTolerance,
  ReferenceRequirementAdequacy,
  ReferenceRequirementAdequacyReason,
} from '../../../src/domain/externalReferenceRequirements.js';

export type { ExternalReferenceApplicability, ApplicableViewport } from '../../../src/domain/externalReferenceApplicability.js';

export type { ReferenceCandidateCompatibilityResult } from '../../../src/domain/externalReferenceCompatibility.js';

export type { ComparabilityResult, ComparabilityReason } from '../../../src/domain/comparison.js';
