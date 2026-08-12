export type { EvidenceState, EvidenceSource, EvidenceField } from './domain/evidence.js';
export { isValidEvidenceField } from './domain/evidence.js';

export type { DiagnosticCode, DiagnosticSeverity, Diagnostic } from './domain/diagnostics.js';
export { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITY, orderDiagnostics } from './domain/diagnostics.js';

export type { CompletionState, RequestPhase } from './domain/completion.js';
export { deriveCompletion } from './domain/completion.js';

export type {
  ObservationArtifact,
  ArtifactReference,
  TargetEvidenceRecord,
  TargetGeometry,
  TargetComputedStyle,
  TargetLayoutMetrics,
  TargetVisibility,
  TargetSemantics,
  TargetLocatorKind,
  TargetSelectionStatus,
  TargetSelectionConfidence,
  TargetLocatorAttemptStatus,
  TargetLocatorAttempt,
  TargetResolution,
  TargetSemanticState,
  TargetLandmarkRole,
  TargetContainment,
  SchemaValidationResult,
  ScrollableMetrics,
  OverflowEvidence,
  WindowScrollSnapshot,
  DocumentScrollSnapshot,
  VerticalViewportRelation,
  ViewportRelationEvidence,
  TargetScrollRuntimeState,
  ScrollRuntimeSnapshot,
  ScrollValueChange,
  TargetScrollTransition,
  ScrollScenarioTransition,
  ScrollOwnerInterpretation,
  ScrollScenarioEvidence,
} from './domain/schema.js';
export {
  ARTIFACT_KIND,
  SCHEMA_VERSION,
  PRODUCER_NAME,
  TARGET_LANDMARK_ROLES,
  getProducerInfo,
  isValidObservationArtifact,
} from './domain/schema.js';

export { buildRequestIdentity, buildObservationIdentity } from './domain/identity.js';

export type {
  NamedTarget,
  RawNamedTarget,
  TargetLocator,
  Viewport,
  ReadinessCondition,
  ReadinessConfig,
  NormalizedObservationRequest,
  RawObservationRequest,
  NormalizeRequestResult,
  ScrollAction,
  ScrollScenario,
} from './request/request.js';
export { normalizeRequest, SCROLL_DELTA_MAX_ABS } from './request/request.js';

export type { NormalizeOutputLocationResult } from './request/paths.js';
export { normalizeOutputLocation } from './request/paths.js';

export type { SafetyDecision } from './safety/policy.js';
export { classifyUrl, classifyRedirect, classifySubresource, classifyPopup, classifyDownload } from './safety/policy.js';

export type { BrowserCaptureResult, BrowserProvenance } from './browser/types.js';
export { runBrowserCapture } from './application/browserCaptureService.js';

export type { PersistedObservationResult } from './artifacts/types.js';
export { MANIFEST_FILENAME, SCREENSHOT_FILENAME } from './artifacts/artifactWriter.js';
export type { ApplicationObservationResult } from './application/observationPersistence.js';
export { buildObservationArtifact, persistBrowserCapture, observe } from './application/observationPersistence.js';

export type {
  HorizontalOrderRelationship,
  VerticalOrderRelationship,
  AreaOverlapRelationship,
  RelativeWidthRelationship,
  GeometricFitRelationship,
  VerticalSequenceRelationship,
  PageWidthRelationship,
  PairwiseRelationshipKind,
  PageLevelRelationshipKind,
  EvidenceReference,
  PairwiseLayoutRelationship,
  PageLevelLayoutRelationship,
  UnresolvedTargetReason,
  UnresolvedRelationshipTarget,
  LayoutRelationshipGraph,
  ClippingState,
  ClippingOverflowStyle,
  TargetClippingEvidence,
} from './domain/relationships.js';
export {
  HORIZONTAL_ORDER_RELATIONSHIPS,
  VERTICAL_ORDER_RELATIONSHIPS,
  AREA_OVERLAP_RELATIONSHIPS,
  RELATIVE_WIDTH_RELATIONSHIPS,
  GEOMETRIC_FIT_RELATIONSHIPS,
  VERTICAL_SEQUENCE_RELATIONSHIPS,
  PAGE_WIDTH_RELATIONSHIPS,
  PAIRWISE_RELATIONSHIP_KINDS,
  PAGE_LEVEL_RELATIONSHIP_KINDS,
  MAX_CONFIGURED_TARGETS_FOR_RELATIONSHIPS,
  MAX_PAIRWISE_RELATIONSHIP_PAIRS,
  CLIPPING_STATES,
  CLIPPING_OVERFLOW_STYLES,
  isValidEvidenceReference,
  isValidPairwiseLayoutRelationship,
  isValidPageLevelLayoutRelationship,
  isValidUnresolvedRelationshipTarget,
  isValidLayoutRelationshipGraph,
  isValidTargetClippingEvidence,
} from './domain/relationships.js';

export type {
  DependencyProperty,
  DependencyDirection,
  ExpectedDependencySource,
  DependencyTermDeclaration,
  ExpectedDependencyDeclaration,
  DependencyEvidenceOutcome,
  ExpectedDependencyEvidence,
  ComparisonConfig,
  ComparabilityState,
  ComparabilityReasonCode,
  ComparabilityReasonSeverity,
  ComparabilityReason,
  ComparabilityResult,
  TargetConfigurationChangeKind,
  TargetConfigurationChange,
  DifferenceKind,
  ComparisonDifferenceSubject,
  ComparisonDifference,
  RelationshipChangeRecord,
  ComparisonSourceObservationReference,
  ComparisonArtifact,
  ComparisonSchemaValidationResult,
} from './domain/comparison.js';
export {
  COMPARISON_ARTIFACT_KIND,
  COMPARISON_SCHEMA_VERSION,
  GEOMETRY_TOLERANCE_DEFAULT_PX,
  GEOMETRY_TOLERANCE_MIN_PX,
  GEOMETRY_TOLERANCE_MAX_PX,
  isValidGeometryTolerancePx,
  DEPENDENCY_PROPERTIES,
  DEPENDENCY_DIRECTIONS,
  EXPECTED_DEPENDENCY_SOURCES,
  isValidExpectedDependencyDeclaration,
  DEPENDENCY_EVIDENCE_OUTCOMES,
  isValidExpectedDependencyEvidence,
  isValidComparisonConfig,
  COMPARABILITY_STATES,
  COMPARABILITY_REASON_CODES,
  COMPARABILITY_REASON_SEVERITY,
  isValidComparabilityResult,
  TARGET_CONFIGURATION_CHANGE_KINDS,
  isValidTargetConfigurationChange,
  DIFFERENCE_KINDS,
  isValidComparisonDifference,
  isValidComparisonSourceObservationReference,
  isValidComparisonArtifact,
} from './domain/comparison.js';

export { buildComparisonRequestIdentity, buildComparisonIdentity } from './domain/comparisonIdentity.js';
