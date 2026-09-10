import { discoverManifests } from './discovery.js';
import { classifyManifest } from './classify.js';
import { encodeArtifactHandle } from './handles.js';
import { MAX_INDEX_RECORDS } from './limits.js';
import type { ComparisonSourceObservationReference } from '../../domain/comparison.js';
import type { FrontendContractObservationReference } from '../../domain/frontendContracts.js';

export type LinkStatus = { status: 'resolved'; handle: string } | { status: 'missing' } | { status: 'ambiguous'; count: number };

type ObservationReferenceLike = ComparisonSourceObservationReference | FrontendContractObservationReference;

function referencesMatch(ref: ObservationReferenceLike, candidateObservationId: string, candidateRequestId: string, candidateProducerVersion: string, candidateSchemaVersion: string): boolean {
  return ref.observationId === candidateObservationId && ref.requestId === candidateRequestId && ref.producer.version === candidateProducerVersion && ref.observationSchemaVersion === candidateSchemaVersion;
}

/**
 * Batch 4 exact-identity linked-evidence resolution: every lookup here walks
 * the bounded evidence tree once (mirroring the exact pattern Batch 2's
 * `evidence/index.ts#findImportedReferenceDir` already established for the
 * approved-external-reference case) and matches by exact canonical identity
 * only - never by folder name, screenshot filename, URL, target-set
 * similarity, or geometry similarity (frozen plan §11). Zero matches ->
 * `missing`; two or more exact matches -> `ambiguous` (never silently pick
 * one). No caller of this module ever calls `compareObservations` or
 * `evaluateFrontendContract` - it only locates and identity-checks already-
 * persisted, already-validated artifacts.
 */
export async function resolveObservationByReference(root: string, ref: ObservationReferenceLike): Promise<LinkStatus> {
  const discovery = await discoverManifests(root);
  const matches: string[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'observation') continue;
    const { artifact } = classified;
    if (referencesMatch(ref, artifact.observationId, artifact.requestId, artifact.producer.version, artifact.schemaVersion)) {
      matches.push(encodeArtifactHandle('observation', manifest.relativeDir));
    }
  }
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  return { status: 'resolved', handle: matches[0] as string };
}

export async function resolveComparisonByIdentity(root: string, comparisonId: string, comparisonRequestId: string): Promise<LinkStatus> {
  const discovery = await discoverManifests(root);
  const matches: string[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'comparison') continue;
    if (classified.artifact.comparisonId === comparisonId && classified.artifact.comparisonRequestId === comparisonRequestId) {
      matches.push(encodeArtifactHandle('comparison', manifest.relativeDir));
    }
  }
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  return { status: 'resolved', handle: matches[0] as string };
}

export async function resolveBaselineContractById(root: string, baselineId: string): Promise<LinkStatus> {
  const discovery = await discoverManifests(root);
  const matches: string[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'baseline-contract') continue;
    if (classified.artifact.baselineId === baselineId) {
      matches.push(encodeArtifactHandle('baseline-contract', manifest.relativeDir));
    }
  }
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  return { status: 'resolved', handle: matches[0] as string };
}

export async function resolveChangeContractById(root: string, contractId: string): Promise<LinkStatus> {
  const discovery = await discoverManifests(root);
  const matches: string[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'change-contract') continue;
    if (classified.artifact.contractId === contractId) {
      matches.push(encodeArtifactHandle('change-contract', manifest.relativeDir));
    }
  }
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  return { status: 'resolved', handle: matches[0] as string };
}

/**
 * Batch 7 addition: resolves an observation by bare `observationId` alone
 * (exact match, never a substring/pathname heuristic) - the only identity a
 * `BoundedAgentContextArtifact.sources.observationIds` entry actually
 * carries (unlike the compound `{observationId, requestId, producer,
 * observationSchemaVersion}` reference `resolveObservationByReference`
 * consumes for Batch 4/5 cross-artifact references). Same missing/ambiguous
 * discipline as every other resolver in this module.
 */
export async function resolveObservationById(root: string, observationId: string): Promise<LinkStatus> {
  const discovery = await discoverManifests(root);
  const matches: string[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'observation') continue;
    if (classified.artifact.observationId === observationId) {
      matches.push(encodeArtifactHandle('observation', manifest.relativeDir));
    }
  }
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  return { status: 'resolved', handle: matches[0] as string };
}

/** Batch 7 addition: resolves a `FrontendContractEvaluationArtifact` by its own exact `evaluationId`+`evaluationRequestId` (a bounded-agent-context source reference, never resolved via the `after` observation the way Batch 5's candidate-context lookup works). */
export async function resolveEvaluationByIdentity(root: string, evaluationId: string, evaluationRequestId: string): Promise<LinkStatus> {
  const discovery = await discoverManifests(root);
  const matches: string[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || classified.family !== 'contract-evaluation') continue;
    if (classified.artifact.evaluationId === evaluationId && classified.artifact.evaluationRequestId === evaluationRequestId) {
      matches.push(encodeArtifactHandle('contract-evaluation', manifest.relativeDir));
    }
  }
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  return { status: 'resolved', handle: matches[0] as string };
}

/** Batch 7 addition: resolves an `ExternalReferenceArtifact` (imported or approved) by its own exact `referenceId`+`referenceRequestId` - a bounded-agent-context source reference. Matches either lifecycle family; never assumes which one. */
export async function resolveReferenceByIdentity(root: string, referenceId: string, referenceRequestId: string): Promise<LinkStatus> {
  const discovery = await discoverManifests(root);
  const matches: { handle: string }[] = [];
  for (const manifest of discovery.manifests.slice(0, MAX_INDEX_RECORDS)) {
    const classified = await classifyManifest(manifest.absolutePath);
    if (classified.supportState !== 'supported' || (classified.family !== 'external-reference-imported' && classified.family !== 'external-reference-approved')) continue;
    if (classified.artifact.referenceId === referenceId && classified.artifact.referenceRequestId === referenceRequestId) {
      matches.push({ handle: encodeArtifactHandle(classified.family, manifest.relativeDir) });
    }
  }
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  return { status: 'resolved', handle: matches[0]!.handle };
}
