/**
 * Batch 7: type-only re-exports of the canonical Node-side bounded-agent-
 * context domain types, so the viewer never redefines context/correlation/
 * fidelity-projection shapes. Erased entirely at build time (`import type`).
 */
export type {
  BoundedAgentContextArtifact,
  BoundedAgentContextSourceReferences,
  BoundedRuntimeTargetProjection,
  Adequacy,
  AdequacyState,
  AdequacyReason,
  AdequacyReasonCode,
  OmissionRecord,
  OmissionReason,
  TruncationRecord,
  RuntimeStaticCorrelationRecord,
  CorrelationStatus,
  StaticCandidateReference,
  StaticCandidateKind,
  StaticEvidenceProducerIdentity,
  BoundedReferenceFidelityProjection,
  ProjectionProfile,
} from '../../../src/domain/boundedAgentContext.js';

export type { LinkStatus } from '../types/contracts.js';

/** Mirrors `src/viewerServer/evidence/contextSourceView.ts#ContextSourceResolution` exactly - the server's own response shape for `GET /api/context`, never re-derived here. */
export interface ContextSourceResolution {
  observations: { observationId: string; link: import('../types/contracts.js').LinkStatus }[];
  comparison?: import('../types/contracts.js').LinkStatus;
  baselineContract?: import('../types/contracts.js').LinkStatus;
  changeContract?: import('../types/contracts.js').LinkStatus;
  evaluation?: import('../types/contracts.js').LinkStatus;
  reference?: import('../types/contracts.js').LinkStatus;
}
