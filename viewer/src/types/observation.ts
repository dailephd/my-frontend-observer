/**
 * Batch 3: type-only re-exports of the canonical Node-side domain types, so
 * the viewer never redefines target/relationship/geometry shapes. Erased
 * entirely at build time (`import type`) - this adds no runtime dependency
 * on `src/`, only compile-time structural knowledge of the same canonical
 * evidence shapes the server actually sends over `/api/artifacts/<handle>`
 * and `/api/observations/<handle>/relationships`.
 */
export type {
  ObservationArtifact,
  TargetEvidenceRecord,
  TargetGeometry,
  TargetResolution,
  TargetSelectionStatus,
  TargetComputedStyle,
  TargetLayoutMetrics,
  TargetVisibility,
  TargetSemantics,
  TargetSemanticState,
  TargetLandmarkRole,
  TargetContainment,
  ScrollScenarioEvidence,
} from '../../../src/domain/schema.js';

export type { EvidenceField } from '../../../src/domain/evidence.js';

export type { LayoutRelationshipGraph, PairwiseLayoutRelationship, PageLevelLayoutRelationship, UnresolvedRelationshipTarget } from '../../../src/domain/relationships.js';
