import { stat } from 'node:fs/promises';
import type { CompletionState } from '../../domain/completion.js';
import type { OverallVerdict } from '../../domain/frontendContracts.js';
import type { ComparabilityState } from '../../domain/comparison.js';
import type { ArtifactFamily, ClassifiedRecord } from './classify.js';
import { encodeArtifactHandle } from './handles.js';
import { resolveContainedFile } from './pathSafety.js';

/** One bounded, UI-facing summary of one recognized media role owned/referenced by an artifact. Never the media bytes themselves. */
export interface MediaSummary {
  role: 'screenshot' | 'image' | 'source-image';
  available: boolean;
  /** Present only when unavailable, for an honest (never fabricated) reason. */
  reason?: string;
}

/**
 * Bounded, UI-facing metadata for one recognized-or-problematic evidence
 * candidate. Deliberately excludes full artifact payloads and media bytes -
 * see docs/plans/v0.8-implementation-plan.md Batch 2 "metadata-first".
 */
export interface EvidenceMetadataRecord {
  handle: string;
  family: ArtifactFamily | 'unrecognized';
  supportState: ClassifiedRecord['supportState'];
  relativeDir: string;
  logicalId?: string;
  schemaVersion?: string;
  foundSchemaVersion?: string;
  producerVersion?: string;
  completion?: CompletionState;
  lifecycleState?: 'imported' | 'approved';
  contractClass?: 'baseline' | 'change';
  overallVerdict?: OverallVerdict;
  comparability?: ComparabilityState;
  media?: MediaSummary[];
  relatedIds?: Record<string, string>;
  message?: string;
}

/** Ephemeral, non-persisted wrapper around one already-validated domain artifact, for the on-demand full-artifact API. Not a new evidence schema - selects/wraps existing canonical fields only. */
export interface EvidenceArtifactDetail {
  handle: string;
  family: ArtifactFamily;
  artifact: Extract<ClassifiedRecord, { supportState: 'supported' }>['artifact'];
}

async function fileAvailable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Builds the bounded metadata record for one classified candidate, including
 * an on-demand media-availability summary (cheap `stat` calls only - never
 * reads media bytes here). `absoluteDir` is the already-contained,
 * already-resolved directory (see discovery.ts) - never a browser-supplied
 * value.
 */
export async function buildMetadataRecord(classified: ClassifiedRecord, relativeDir: string, absoluteDir: string): Promise<EvidenceMetadataRecord> {
  if (classified.supportState === 'unrecognized-kind') {
    return {
      handle: encodeArtifactHandle('observation', relativeDir), // placeholder family slug irrelevant for an unrecognized record; handle is never dereferenced for this state
      family: 'unrecognized',
      supportState: 'unrecognized-kind',
      relativeDir,
      message: classified.foundArtifactKind === undefined ? 'manifest.json does not declare a recognized artifactKind' : `unrecognized artifactKind "${classified.foundArtifactKind}"`,
    };
  }

  if (classified.supportState === 'malformed-json') {
    return {
      handle: encodeArtifactHandle('observation', relativeDir),
      family: 'unrecognized',
      supportState: 'malformed-json',
      relativeDir,
      message: `manifest.json is not valid JSON: ${classified.reason}`,
    };
  }

  if (classified.supportState === 'unreadable') {
    return {
      handle: encodeArtifactHandle('observation', relativeDir),
      family: 'unrecognized',
      supportState: 'unreadable',
      relativeDir,
      message: classified.reason,
    };
  }

  if (classified.supportState === 'unsupported-version') {
    return {
      handle: encodeArtifactHandle(classified.family, relativeDir),
      family: classified.family,
      supportState: 'unsupported-version',
      relativeDir,
      foundSchemaVersion: classified.foundSchemaVersion,
      schemaVersion: classified.supportedSchemaVersion,
      message: `recognized "${classified.family}" evidence, but schema version "${classified.foundSchemaVersion}" is not the currently supported "${classified.supportedSchemaVersion}"`,
    };
  }

  if (classified.supportState === 'invalid-structure') {
    return {
      handle: encodeArtifactHandle(classified.family ?? 'observation', relativeDir),
      family: classified.family ?? 'unrecognized',
      supportState: 'invalid-structure',
      relativeDir,
      message: classified.reason,
    };
  }

  // supported
  const { family, artifact } = classified;
  const handle = encodeArtifactHandle(family, relativeDir);
  const base: EvidenceMetadataRecord = { handle, family, supportState: 'supported', relativeDir };

  switch (family) {
    case 'observation': {
      const screenshotPath = artifact.screenshot.state === 'available' || artifact.screenshot.state === 'partial' ? artifact.screenshot.value.path : undefined;
      const resolved = screenshotPath === undefined ? undefined : resolveContainedFile(absoluteDir, screenshotPath);
      const available = resolved !== undefined && (await fileAvailable(resolved));
      return {
        ...base,
        logicalId: artifact.observationId,
        schemaVersion: artifact.schemaVersion,
        producerVersion: artifact.producer.version,
        completion: artifact.completion,
        media: [{ role: 'screenshot', available, ...(available ? {} : { reason: screenshotPath === undefined ? 'no screenshot recorded on this observation' : 'screenshot file not found on disk' }) }],
      };
    }

    case 'comparison':
      return {
        ...base,
        logicalId: artifact.comparisonId,
        schemaVersion: artifact.schemaVersion,
        producerVersion: artifact.producer.version,
        comparability: artifact.comparability.state,
        relatedIds: { beforeObservationId: artifact.before.observationId, afterObservationId: artifact.after.observationId },
      };

    case 'baseline-contract':
      return {
        ...base,
        logicalId: artifact.baselineId,
        schemaVersion: artifact.schemaVersion,
        contractClass: 'baseline',
        relatedIds: { sourceObservationId: artifact.sourceObservation.observationId },
      };

    case 'change-contract':
      return { ...base, logicalId: artifact.contractId, schemaVersion: artifact.schemaVersion, contractClass: 'change' };

    case 'contract-evaluation':
      return {
        ...base,
        logicalId: artifact.evaluationId,
        schemaVersion: artifact.schemaVersion,
        producerVersion: artifact.producer.version,
        overallVerdict: artifact.overallVerdict,
        relatedIds: {
          beforeObservationId: artifact.before.observationId,
          afterObservationId: artifact.after.observationId,
          comparisonId: artifact.comparisonId,
          baselineId: artifact.contracts.baselineId,
          contractId: artifact.contracts.contractId,
        },
      };

    case 'external-reference-imported':
    case 'external-reference-approved': {
      const lifecycleState = artifact.lifecycle.state;
      let media: MediaSummary[];
      if (lifecycleState === 'imported' && 'image' in artifact) {
        const resolved = resolveContainedFile(absoluteDir, artifact.image.path);
        const available = resolved !== undefined && (await fileAvailable(resolved));
        media = [{ role: 'image', available, ...(available ? {} : { reason: 'image file not found on disk' }) }];
      } else {
        // 'approved': availability of the source-owned image cannot be determined without cross-referencing the imported artifact
        // by sourceReference.referenceId within the current index (see mediaResolver.ts) - reported honestly as unknown here,
        // never fabricated as available.
        media = [{ role: 'source-image', available: false, reason: 'availability determined on demand via /api/media (depends on the owning imported reference being present in this evidence root)' }];
      }
      return {
        ...base,
        logicalId: artifact.referenceId,
        schemaVersion: artifact.schemaVersion,
        producerVersion: artifact.producer.version,
        completion: artifact.completion,
        lifecycleState,
        media,
        ...(lifecycleState === 'approved' && 'sourceReference' in artifact ? { relatedIds: { sourceReferenceId: artifact.sourceReference.referenceId } } : {}),
      };
    }
  }
}

/** Ephemeral, non-persisted full-artifact projection for the on-demand API. */
export function buildArtifactDetail(family: ArtifactFamily, handle: string, artifact: Extract<ClassifiedRecord, { supportState: 'supported' }>['artifact']): EvidenceArtifactDetail {
  return { handle, family, artifact };
}
