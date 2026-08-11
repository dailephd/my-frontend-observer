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
  SchemaValidationResult,
} from './domain/schema.js';
export { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME, getProducerInfo, isValidObservationArtifact } from './domain/schema.js';

export { buildRequestIdentity, buildObservationIdentity } from './domain/identity.js';

export type {
  NamedTarget,
  Viewport,
  ReadinessCondition,
  ReadinessConfig,
  NormalizedObservationRequest,
  RawObservationRequest,
  NormalizeRequestResult,
} from './request/request.js';
export { normalizeRequest } from './request/request.js';

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
