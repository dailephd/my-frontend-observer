/** Type-only re-exports of the canonical comparison domain types (erased at build time - see viewer/src/types/observation.ts for the same pattern). */
export type {
  ComparisonArtifact,
  ComparisonSourceObservationReference,
  ComparabilityResult,
  ComparabilityReason,
  ComparabilityState,
  TargetConfigurationChange,
  ComparisonDifference,
  ComparisonDifferenceSubject,
  DifferenceKind,
  RelationshipChangeRecord,
  ExpectedDependencyEvidence,
  ExpectedDependencyDeclaration,
  DependencyEvidenceOutcome,
} from '../../../src/domain/comparison.js';
