/**
 * v0.8 Batch 7: resolves a validated `BoundedAgentContextArtifact.sources`
 * block against the current evidence root by exact canonical identity only
 * (never pathname/name/similarity heuristics), reusing `linkedEvidence.ts`'s
 * established resolver pattern (Batch 4/5) - every lookup here is a bounded
 * discovery walk that matches on the exact identity fields the source
 * reference actually carries. Never calls `compareObservations`,
 * `evaluateFrontendContract`, `projectBoundedAgentContext`, or any
 * correlation-derivation function.
 */
import type { BoundedAgentContextSourceReferences } from '../../domain/boundedAgentContext.js';
import type { LinkStatus } from './linkedEvidence.js';
import { resolveObservationById, resolveComparisonByIdentity, resolveBaselineContractById, resolveChangeContractById, resolveEvaluationByIdentity, resolveReferenceByIdentity } from './linkedEvidence.js';

export interface ContextSourceResolution {
  /** One resolution per `sources.observationIds` entry, in the same order. */
  observations: { observationId: string; link: LinkStatus }[];
  comparison?: LinkStatus;
  baselineContract?: LinkStatus;
  changeContract?: LinkStatus;
  evaluation?: LinkStatus;
  reference?: LinkStatus;
}

export async function resolveContextSources(root: string, sources: BoundedAgentContextSourceReferences): Promise<ContextSourceResolution> {
  const [observationLinks, comparison, baselineContract, changeContract, evaluation, reference] = await Promise.all([
    Promise.all(sources.observationIds.map(async (observationId) => ({ observationId, link: await resolveObservationById(root, observationId) }))),
    sources.comparisonId !== undefined && sources.comparisonRequestId !== undefined ? resolveComparisonByIdentity(root, sources.comparisonId, sources.comparisonRequestId) : Promise.resolve(undefined),
    sources.baselineContractId !== undefined ? resolveBaselineContractById(root, sources.baselineContractId) : Promise.resolve(undefined),
    sources.changeContractId !== undefined ? resolveChangeContractById(root, sources.changeContractId) : Promise.resolve(undefined),
    sources.evaluationId !== undefined && sources.evaluationRequestId !== undefined ? resolveEvaluationByIdentity(root, sources.evaluationId, sources.evaluationRequestId) : Promise.resolve(undefined),
    sources.referenceId !== undefined && sources.referenceRequestId !== undefined ? resolveReferenceByIdentity(root, sources.referenceId, sources.referenceRequestId) : Promise.resolve(undefined),
  ]);

  return {
    observations: observationLinks,
    ...(comparison !== undefined ? { comparison } : {}),
    ...(baselineContract !== undefined ? { baselineContract } : {}),
    ...(changeContract !== undefined ? { changeContract } : {}),
    ...(evaluation !== undefined ? { evaluation } : {}),
    ...(reference !== undefined ? { reference } : {}),
  };
}
