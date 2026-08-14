export type { EvidenceState, EvidenceSource, EvidenceField } from './domain/evidence.js';
export { isValidEvidenceField, evidenceValue } from './domain/evidence.js';

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
  DeriveLayoutRelationshipsOptions,
  DeriveLayoutRelationshipsResult,
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
  PAIRWISE_RELATIONSHIP_FAMILY_COUNT,
  MAX_PAIRWISE_RELATIONSHIP_RECORDS,
  CLIPPING_STATES,
  CLIPPING_OVERFLOW_STYLES,
  isValidEvidenceReference,
  isValidPairwiseLayoutRelationship,
  isValidPageLevelLayoutRelationship,
  isValidUnresolvedRelationshipTarget,
  isValidLayoutRelationshipGraph,
  isValidTargetClippingEvidence,
  deriveTargetClipping,
  deriveLayoutRelationships,
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

export type {
  AuthoredChangeScopeCategory,
  ChangeScopeClassification,
  ExpectedDependentMode,
  ContractTolerance,
  ContractPrimitiveKind,
  ContractPrimitive,
  FrontendContractClauseBase,
  BaselineClause,
  PerChangeClause,
  FrontendContractObservationReference,
  PersistentBaselineContract,
  FrontendContractValidationResult,
  PerChangeContract,
  ClauseResultStatus,
  ClauseEvaluationResult,
  OverallVerdict,
} from './domain/frontendContracts.js';
export {
  CONTRACT_ARTIFACT_KIND,
  CONTRACT_SCHEMA_VERSION,
  AUTHORED_CHANGE_SCOPE_CATEGORIES,
  isAuthoredChangeScopeCategory,
  CHANGE_SCOPE_CLASSIFICATIONS,
  EXPECTED_DEPENDENT_MODES,
  isValidExpectedDependentMode,
  CONTRACT_TOLERANCE_ABSOLUTE_PX_MIN,
  CONTRACT_TOLERANCE_ABSOLUTE_PX_MAX,
  CONTRACT_TOLERANCE_PERCENT_MIN,
  CONTRACT_TOLERANCE_PERCENT_MAX,
  isValidContractTolerance,
  CONTRACT_PRIMITIVE_KINDS,
  isValidContractPrimitive,
  isValidBaselineClause,
  isValidPerChangeClause,
  isValidFrontendContractObservationReference,
  isValidPersistentBaselineContract,
  isValidPerChangeContract,
  CLAUSE_RESULT_STATUSES,
  isValidClauseEvaluationResult,
  OVERALL_VERDICTS,
} from './domain/frontendContracts.js';

export { buildFrontendContractRequestIdentity, buildFrontendContractInstanceIdentity, buildClauseIdentity } from './domain/frontendContractIdentity.js';

export type { FrontendContractEvaluationInput, UnexpectedChangeResult, FrontendContractEvaluationResult, EvaluateFrontendContractResult } from './domain/frontendContractEvaluation.js';
export { evaluateFrontendContract } from './domain/frontendContractEvaluation.js';

export { buildFrontendContractEvaluationRequestIdentity } from './domain/frontendContractIdentity.js';

export type {
  FrontendContractEvaluationSourceReference,
  FrontendContractEvaluationArtifact,
  FrontendContractEvaluationArtifactValidationResult,
  BuildFrontendContractEvaluationArtifactInput,
} from './domain/frontendContractEvaluationArtifact.js';
export {
  EVALUATION_ARTIFACT_KIND,
  EVALUATION_SCHEMA_VERSION,
  isValidFrontendContractEvaluationArtifact,
  buildFrontendContractEvaluationArtifact,
} from './domain/frontendContractEvaluationArtifact.js';

export type { PersistedFrontendContractResult, WriteFrontendContractArtifactOptions } from './artifacts/frontendContractArtifactWriter.js';
export { FRONTEND_CONTRACT_MANIFEST_FILENAME, writePersistentBaselineContract, writePerChangeContract } from './artifacts/frontendContractArtifactWriter.js';

export type { ReadPersistentBaselineContractResult, ReadPerChangeContractResult } from './artifacts/frontendContractArtifactReader.js';
export { readPersistentBaselineContract, readPerChangeContract } from './artifacts/frontendContractArtifactReader.js';

export type { ReadComparisonArtifactResult } from './artifacts/comparisonArtifactReader.js';
export { readComparisonArtifact } from './artifacts/comparisonArtifactReader.js';

export type { PersistedFrontendContractEvaluationResult, WriteFrontendContractEvaluationArtifactOptions } from './artifacts/frontendContractEvaluationArtifactWriter.js';
export { EVALUATION_MANIFEST_FILENAME, writeFrontendContractEvaluationArtifact } from './artifacts/frontendContractEvaluationArtifactWriter.js';

export type { ReadFrontendContractEvaluationArtifactResult } from './artifacts/frontendContractEvaluationArtifactReader.js';
export { readFrontendContractEvaluationArtifact } from './artifacts/frontendContractEvaluationArtifactReader.js';

export type { EvaluateAndPersistOptions, ApplicationFrontendContractEvaluationResult } from './application/frontendContractEvaluationService.js';
export { DEFAULT_EVALUATION_OUTPUT_LOCATION, evaluateAndPersist, evaluateAndPersistFromArtifactRoots } from './application/frontendContractEvaluationService.js';

export type { PersistFrontendContractOptions, ApplicationApproveBaselineResult, ApplicationPersistChangeContractResult } from './application/frontendContractPersistenceService.js';
export { approveAndPersistBaseline, persistPerChangeContract } from './application/frontendContractPersistenceService.js';

export type { CompareObservationsResult } from './domain/comparisonEngine.js';
export { compareObservations, evaluateComparability, evaluateExpectedDependencies, compareTargetConfiguration } from './domain/comparisonEngine.js';

export type {
  ProjectionProfile,
  AdequacyState,
  AdequacyReasonCode,
  AdequacyReason,
  Adequacy,
  OmissionReason,
  OmissionRecord,
  TruncationRecord,
  BoundedAgentContextSourceReferences,
  BoundedRuntimeTargetProjection,
  CorrelationStatus,
  StaticCandidateKind,
  StaticEvidenceProducerIdentity,
  StaticCandidateReference,
  RuntimeStaticCorrelationRecord,
  BoundedAgentContextArtifact,
  BoundedAgentContextValidationResult,
} from './domain/boundedAgentContext.js';
export {
  BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND,
  BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION,
  PROJECTION_PROFILES,
  MAX_RUNTIME_TARGETS,
  MAX_RELATIONSHIP_EVIDENCE_PER_TARGET,
  MAX_OMISSIONS,
  MAX_TRUNCATIONS,
  MAX_CORRELATION_RECORDS,
  MAX_STATIC_CANDIDATES_PER_TARGET,
  MAX_TEXT_SUMMARY_CHARS,
  MAX_EVIDENCE_REFS_PER_CORRELATION_FIELD,
  ADEQUACY_STATES,
  ADEQUACY_REASON_CODES,
  OMISSION_REASONS,
  CORRELATION_STATUSES,
  STATIC_CANDIDATE_KINDS,
  isValidBoundedAgentContextArtifact,
} from './domain/boundedAgentContext.js';

export { buildBoundedAgentContextRequestIdentity, buildBoundedAgentContextInstanceIdentity } from './domain/boundedAgentContextIdentity.js';

export type { ProjectBoundedAgentContextInput, ProjectBoundedAgentContextResult } from './domain/boundedAgentContextProjection.js';
export { projectBoundedAgentContext } from './domain/boundedAgentContextProjection.js';

export type { PersistedComparisonResult, WriteComparisonArtifactOptions } from './artifacts/comparisonArtifactWriter.js';
export { COMPARISON_MANIFEST_FILENAME, writeComparisonArtifact } from './artifacts/comparisonArtifactWriter.js';

export type { ReadObservationArtifactResult } from './artifacts/artifactReader.js';
export { readObservationArtifact } from './artifacts/artifactReader.js';

export type { CompareAndPersistOptions, ApplicationComparisonResult } from './application/comparisonService.js';
export { DEFAULT_COMPARISON_OUTPUT_LOCATION, compareAndPersist, compareAndPersistFromArtifactRoots } from './application/comparisonService.js';
