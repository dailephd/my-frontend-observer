import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { classifyManifest } from './classify.js';
import { decodeArtifactHandle } from './handles.js';
import { resolveContainedDir } from './pathSafety.js';
import { discoverManifests } from './discovery.js';
import { encodeArtifactHandle } from './handles.js';
import { MAX_INDEX_RECORDS } from './limits.js';
import { deriveReferenceRegionRelationships } from '../../domain/externalReferenceRegionRelationships.js';
import type { ReferenceRegionRelationshipGraph } from '../../domain/externalReferenceRegionRelationships.js';
import { deriveReferenceRequirementAdequacy } from '../../domain/externalReferenceRequirements.js';
import type { ReferenceRequirementAdequacy } from '../../domain/externalReferenceRequirements.js';
import { evaluateReferenceCandidateCompatibility } from '../../domain/externalReferenceCompatibility.js';
import type { ReferenceCandidateCompatibilityResult } from '../../domain/externalReferenceCompatibility.js';
import type { ExternalReferenceArtifact } from '../../domain/externalReference.js';
import type { ObservationArtifact } from '../../domain/schema.js';
import type { FrontendContractObservationReference } from '../../domain/frontendContracts.js';

export type ReferenceViewResult =
  | { ok: true; regionRelationships: ReferenceRegionRelationshipGraph | undefined; requirementAdequacy: ReferenceRequirementAdequacy | undefined }
  | { ok: false; reason: 'unknown-handle' }
  | { ok: false; reason: 'not-a-reference' }
  | { ok: false; reason: 'not-currently-loadable' };

async function loadDirAndClassify(root: string, handle: string) {
  const decoded = decodeArtifactHandle(handle);
  if (!decoded.ok) return { ok: false as const, reason: 'unknown-handle' as const };

  const dir = resolveContainedDir(root, decoded.relativeDir);
  if (dir === undefined) return { ok: false as const, reason: 'unknown-handle' as const };

  try {
    const dirInfo = await stat(dir);
    if (!dirInfo.isDirectory()) return { ok: false as const, reason: 'unknown-handle' as const };
  } catch {
    return { ok: false as const, reason: 'unknown-handle' as const };
  }

  const classified = await classifyManifest(join(dir, 'manifest.json'));
  return { ok: true as const, decoded, classified };
}

/**
 * Batch 5's one additive server-side computation for a selected external
 * reference on its own (no candidate yet): derives the reference's own
 * region-relationship graph (`deriveReferenceRegionRelationships`) and
 * requirement adequacy (`deriveReferenceRequirementAdequacy`) - both pure
 * functions over the artifact's own already-persisted `regions`/
 * `requirements`, never persisted themselves, never a second derivation
 * engine. Mirrors observationView.ts's server-side-derivation pattern
 * (Batch 3) rather than re-deriving in the browser.
 */
export async function getReferenceView(root: string, handle: string): Promise<ReferenceViewResult> {
  const loaded = await loadDirAndClassify(root, handle);
  if (!loaded.ok) return loaded;
  const { classified } = loaded;

  if (classified.supportState !== 'supported') return { ok: false, reason: 'not-currently-loadable' };
  if (classified.family !== 'external-reference-imported' && classified.family !== 'external-reference-approved') {
    return { ok: false, reason: 'not-a-reference' };
  }

  const artifact = classified.artifact as ExternalReferenceArtifact;
  const regions = artifact.regions ?? [];
  const requirements = artifact.requirements ?? [];

  let regionRelationships: ReferenceRegionRelationshipGraph | undefined;
  if (regions.length > 0) {
    const derived = deriveReferenceRegionRelationships(artifact.referenceRequestId, regions);
    regionRelationships = derived.ok ? derived.graph : undefined;
  }

  const requirementAdequacy = requirements.length > 0 || regions.length > 0 ? deriveReferenceRequirementAdequacy(regions, requirements) : undefined;

  return { ok: true, regionRelationships, requirementAdequacy };
}

export type ReferenceCandidateViewResult =
  | { ok: true; compatibility: ReferenceCandidateCompatibilityResult; evaluationHandles: string[] }
  | { ok: false; reason: 'unknown-reference-handle' }
  | { ok: false; reason: 'unknown-candidate-handle' }
  | { ok: false; reason: 'not-a-reference' }
  | { ok: false; reason: 'not-an-observation' }
  | { ok: false; reason: 'not-currently-loadable' };

function candidateReferencesMatch(ref: FrontendContractObservationReference, candidate: ObservationArtifact): boolean {
  return ref.observationId === candidate.observationId && ref.requestId === candidate.requestId && ref.producer.version === candidate.producer.version && ref.observationSchemaVersion === candidate.schemaVersion;
}

/**
 * Batch 5's reference/candidate computation: evaluates page/state-level
 * compatibility through the existing canonical
 * `evaluateReferenceCandidateCompatibility` (never a second, viewer-owned
 * compatibility model), and separately lists every existing
 * `FrontendContractEvaluationArtifact` whose own persisted `after` reference
 * exactly identifies this candidate (frozen plan/task §29) - for the caller
 * to offer as an explicit, never-auto-selected optional context. Neither
 * `evaluateReferenceRuntimeBindings` nor `evaluateReferenceCandidateFidelity`
 * is called anywhere in this module.
 */
export async function getReferenceCandidateView(root: string, referenceHandle: string, candidateHandle: string): Promise<ReferenceCandidateViewResult> {
  const referenceLoaded = await loadDirAndClassify(root, referenceHandle);
  if (!referenceLoaded.ok) return { ok: false, reason: 'unknown-reference-handle' };
  if (referenceLoaded.classified.supportState !== 'supported') return { ok: false, reason: 'not-currently-loadable' };
  if (referenceLoaded.classified.family !== 'external-reference-imported' && referenceLoaded.classified.family !== 'external-reference-approved') {
    return { ok: false, reason: 'not-a-reference' };
  }
  const reference = referenceLoaded.classified.artifact as ExternalReferenceArtifact;

  const candidateLoaded = await loadDirAndClassify(root, candidateHandle);
  if (!candidateLoaded.ok) return { ok: false, reason: 'unknown-candidate-handle' };
  if (candidateLoaded.classified.supportState !== 'supported') return { ok: false, reason: 'not-currently-loadable' };
  if (candidateLoaded.classified.family !== 'observation') return { ok: false, reason: 'not-an-observation' };
  const candidate = candidateLoaded.classified.artifact;

  const compatibility = evaluateReferenceCandidateCompatibility(reference, candidate);

  const discovery = await discoverManifests(root);
  const evaluationHandles: string[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'contract-evaluation') continue;
    if (candidateReferencesMatch(classified.artifact.after, candidate)) {
      evaluationHandles.push(encodeArtifactHandle('contract-evaluation', manifest.relativeDir));
    }
  }

  return { ok: true, compatibility, evaluationHandles };
}
