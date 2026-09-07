import { readFile, stat } from 'node:fs/promises';
import { ARTIFACT_KIND, SCHEMA_VERSION } from '../../domain/schema.js';
import type { ObservationArtifact } from '../../domain/schema.js';
import { readObservationArtifact } from '../../artifacts/artifactReader.js';
import { COMPARISON_ARTIFACT_KIND, COMPARISON_SCHEMA_VERSION } from '../../domain/comparison.js';
import type { ComparisonArtifact } from '../../domain/comparison.js';
import { readComparisonArtifact } from '../../artifacts/comparisonArtifactReader.js';
import { CONTRACT_ARTIFACT_KIND, CONTRACT_SCHEMA_VERSION } from '../../domain/frontendContracts.js';
import type { PersistentBaselineContract, PerChangeContract } from '../../domain/frontendContracts.js';
import { readPersistentBaselineContract, readPerChangeContract } from '../../artifacts/frontendContractArtifactReader.js';
import { EVALUATION_ARTIFACT_KIND, EVALUATION_SCHEMA_VERSION } from '../../domain/frontendContractEvaluationArtifact.js';
import type { FrontendContractEvaluationArtifact } from '../../domain/frontendContractEvaluationArtifact.js';
import { readFrontendContractEvaluationArtifact } from '../../artifacts/frontendContractEvaluationArtifactReader.js';
import { EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../domain/externalReference.js';
import type { ExternalReferenceArtifact } from '../../domain/externalReference.js';
import { readExternalReferenceArtifact } from '../../artifacts/externalReferenceArtifactReader.js';
import { MAX_MANIFEST_CANDIDATE_BYTES } from './limits.js';

export type ArtifactFamily =
  | 'observation'
  | 'comparison'
  | 'baseline-contract'
  | 'change-contract'
  | 'contract-evaluation'
  | 'external-reference-imported'
  | 'external-reference-approved';

/**
 * Honest, independent viewer-loading/support state - deliberately distinct
 * from any artifact's own `completion`/evidence-state semantics (see
 * ClassifiedRecord.artifact for the latter, when the kind carries one).
 */
export type ViewerSupportState = 'supported' | 'unsupported-version' | 'invalid-structure' | 'unrecognized-kind' | 'malformed-json' | 'unreadable';

type FamilyArtifact = {
  observation: ObservationArtifact;
  comparison: ComparisonArtifact;
  'baseline-contract': PersistentBaselineContract;
  'change-contract': PerChangeContract;
  'contract-evaluation': FrontendContractEvaluationArtifact;
  'external-reference-imported': ExternalReferenceArtifact;
  'external-reference-approved': ExternalReferenceArtifact;
};

/** Per-family discriminated union (not a generically-indexed field) so switching on `family` correctly narrows `artifact`'s type. */
type SupportedRecord = { [K in ArtifactFamily]: { supportState: 'supported'; family: K; artifact: FamilyArtifact[K] } }[ArtifactFamily];

export type ClassifiedRecord =
  | SupportedRecord
  | { supportState: 'unsupported-version'; family: ArtifactFamily; foundSchemaVersion: string; supportedSchemaVersion: string }
  | { supportState: 'invalid-structure'; family: ArtifactFamily | undefined; reason: string }
  | { supportState: 'unrecognized-kind'; foundArtifactKind: string | undefined }
  | { supportState: 'malformed-json'; reason: string }
  | { supportState: 'unreadable'; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Classification is not validation (frozen plan §10): this function reads
 * bounded manifest bytes, parses JSON, and peeks only `artifactKind`/
 * `schemaVersion` to decide *which* existing canonical reader to try - the
 * canonical reader's own structural validator remains the sole authority on
 * whether a candidate is actually a valid instance of that family. This
 * function never accepts a candidate that its dispatched reader rejects, and
 * never invents a result the reader did not itself produce.
 */
export async function classifyManifest(manifestPath: string): Promise<ClassifiedRecord> {
  let size: number;
  try {
    size = (await stat(manifestPath)).size;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { supportState: 'unreadable', reason: `could not stat candidate manifest: ${message}` };
  }
  if (size > MAX_MANIFEST_CANDIDATE_BYTES) {
    return { supportState: 'unreadable', reason: `candidate manifest exceeds the bounded size limit (${MAX_MANIFEST_CANDIDATE_BYTES} bytes)` };
  }

  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { supportState: 'unreadable', reason: `could not read candidate manifest: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { supportState: 'malformed-json', reason: message };
  }

  if (!isPlainObject(parsed)) {
    return { supportState: 'unrecognized-kind', foundArtifactKind: undefined };
  }

  const kind = typeof parsed.artifactKind === 'string' ? parsed.artifactKind : undefined;
  const version = typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : undefined;

  switch (kind) {
    case ARTIFACT_KIND: {
      if (version !== SCHEMA_VERSION) {
        return { supportState: 'unsupported-version', family: 'observation', foundSchemaVersion: version ?? 'unknown', supportedSchemaVersion: SCHEMA_VERSION };
      }
      const read = await readObservationArtifact(manifestPath);
      if (!read.ok) return { supportState: 'invalid-structure', family: 'observation', reason: read.reason };
      return { supportState: 'supported', family: 'observation', artifact: read.artifact };
    }

    case COMPARISON_ARTIFACT_KIND: {
      if (version !== COMPARISON_SCHEMA_VERSION) {
        return { supportState: 'unsupported-version', family: 'comparison', foundSchemaVersion: version ?? 'unknown', supportedSchemaVersion: COMPARISON_SCHEMA_VERSION };
      }
      const read = await readComparisonArtifact(manifestPath);
      if (!read.ok) return { supportState: 'invalid-structure', family: 'comparison', reason: read.reason };
      return { supportState: 'supported', family: 'comparison', artifact: read.artifact };
    }

    case CONTRACT_ARTIFACT_KIND: {
      if (version !== CONTRACT_SCHEMA_VERSION) {
        return { supportState: 'unsupported-version', family: 'baseline-contract', foundSchemaVersion: version ?? 'unknown', supportedSchemaVersion: CONTRACT_SCHEMA_VERSION };
      }
      // Two structurally distinct persisted shapes share one artifactKind/schemaVersion (contractClass discriminates) -
      // the canonical validators, not this classifier, decide which one (if either) a candidate actually is.
      const baseline = await readPersistentBaselineContract(manifestPath);
      if (baseline.ok) return { supportState: 'supported', family: 'baseline-contract', artifact: baseline.contract };
      const change = await readPerChangeContract(manifestPath);
      if (change.ok) return { supportState: 'supported', family: 'change-contract', artifact: change.contract };
      return { supportState: 'invalid-structure', family: undefined, reason: `matches neither baseline nor per-change contract shape (baseline: ${baseline.reason}; change: ${change.reason})` };
    }

    case EVALUATION_ARTIFACT_KIND: {
      if (version !== EVALUATION_SCHEMA_VERSION) {
        return { supportState: 'unsupported-version', family: 'contract-evaluation', foundSchemaVersion: version ?? 'unknown', supportedSchemaVersion: EVALUATION_SCHEMA_VERSION };
      }
      const read = await readFrontendContractEvaluationArtifact(manifestPath);
      if (!read.ok) return { supportState: 'invalid-structure', family: 'contract-evaluation', reason: read.reason };
      return { supportState: 'supported', family: 'contract-evaluation', artifact: read.artifact };
    }

    case EXTERNAL_REFERENCE_ARTIFACT_KIND: {
      if (version !== EXTERNAL_REFERENCE_SCHEMA_VERSION) {
        return {
          supportState: 'unsupported-version',
          family: 'external-reference-imported',
          foundSchemaVersion: version ?? 'unknown',
          supportedSchemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
        };
      }
      const read = await readExternalReferenceArtifact(manifestPath);
      if (!read.ok) return { supportState: 'invalid-structure', family: undefined, reason: read.reason };
      const family: ArtifactFamily = read.artifact.lifecycle.state === 'approved' ? 'external-reference-approved' : 'external-reference-imported';
      return { supportState: 'supported', family, artifact: read.artifact };
    }

    default:
      // Includes both a genuinely unknown string and the known-but-unreadered
      // `my-frontend-observer/bounded-agent-context` kind (see frozen plan
      // §8: no disk reader/writer exists for that family - inventing
      // persistence-shaped handling for it here would fabricate support that
      // does not exist).
      return { supportState: 'unrecognized-kind', foundArtifactKind: kind };
  }
}
