import type { ObservationArtifact, TargetEvidenceRecord } from '../types/observation.js';

export interface OrderedTarget {
  name: string;
  record: TargetEvidenceRecord | undefined;
  /** True only when this target's geometry evidence actually carries a usable rectangle (`available`/`partial`) - never true merely because the target is configured. */
  hasGeometry: boolean;
}

/**
 * Presentation-only reshaping (frozen plan §27: React may select/format,
 * never derive evidence): orders targets by the observation's own authored
 * configuration order (`requestConfig.targets`) - the same deterministic
 * order the artifact itself was requested in - rather than JavaScript's
 * incidental object-key iteration order over `targetEvidence`.
 */
export function orderedTargets(artifact: ObservationArtifact): OrderedTarget[] {
  return artifact.requestConfig.targets.map((configured) => {
    const record = artifact.targetEvidence[configured.name];
    const hasGeometry = record !== undefined && (record.geometry.state === 'available' || record.geometry.state === 'partial');
    return { name: configured.name, record, hasGeometry };
  });
}
