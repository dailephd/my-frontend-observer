/**
 * v0.7 Prompt 1 external-reference artifact family, extended in Prompt 2
 * with explicit, additive, optional reference regions (identity, provenance,
 * bounded image metadata, two-state lifecycle, forward-only supersession -
 * see the Prompt 1 report for that foundation; region geometry/relationship
 * derivation lives in externalReferenceRegions.ts /
 * externalReferenceRegionRelationships.ts). This module still implements
 * neither design requirements, tolerances, reference-region/runtime binding,
 * nor reference-vs-candidate evaluation - see docs/ARCHITECTURE.md.
 *
 * An external reference is desired-design evidence, not an earlier browser
 * observation: this module never reuses ARTIFACT_KIND/SCHEMA_VERSION
 * (observation), COMPARISON_ARTIFACT_KIND, or CONTRACT_ARTIFACT_KIND, and
 * adds no field to any of those existing types.
 */
import type { Diagnostic } from './diagnostics.js';
import type { CompletionState } from './completion.js';
import { PRODUCER_NAME } from './schema.js';
import type { ExternalReferenceImageFormat } from './externalReferenceImage.js';
import { isExternalReferenceImageFormat, isValidExternalReferenceImageDimensions } from './externalReferenceImage.js';
import type { ReferenceRegion } from './externalReferenceRegions.js';
import { isValidReferenceRegions } from './externalReferenceRegions.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export const EXTERNAL_REFERENCE_ARTIFACT_KIND = 'my-frontend-observer/external-reference' as const;
export const EXTERNAL_REFERENCE_SCHEMA_VERSION = '1.0.0' as const;

// --- Image reference (owned media, on an 'imported' artifact) -----------------

export interface ExternalReferenceImageReference {
  /** Bare relative filename within the artifact's own directory - never an absolute path. */
  path: string;
  format: ExternalReferenceImageFormat;
  width: number;
  height: number;
  byteLength: number;
  /** sha256 hex digest of the raw image bytes - identity-bearing (see externalReferenceIdentity.ts). */
  sha256: string;
}

export function isValidExternalReferenceImageReference(value: unknown): value is ExternalReferenceImageReference {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.path) || value.path.includes('/') || value.path.includes('\\')) return false;
  if (!isExternalReferenceImageFormat(value.format)) return false;
  if (typeof value.width !== 'number' || typeof value.height !== 'number') return false;
  if (!isValidExternalReferenceImageDimensions({ width: value.width, height: value.height })) return false;
  if (typeof value.byteLength !== 'number' || !Number.isInteger(value.byteLength) || value.byteLength <= 0) return false;
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) return false;
  return true;
}

// --- Source reference (points back to the owning 'imported' artifact, on an 'approved' artifact) ---

/**
 * Enough logical identity to trace an approved reference back to the
 * imported artifact that owns its image, without ever re-copying the image
 * bytes - mirrors ComparisonSourceObservationReference's
 * {id, requestId, producer, schemaVersion, screenshot: {path}} shape exactly.
 */
export interface ExternalReferenceSourceReference {
  referenceId: string;
  referenceRequestId: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  schemaVersion: typeof EXTERNAL_REFERENCE_SCHEMA_VERSION;
  image: ExternalReferenceImageReference;
}

export function isValidExternalReferenceSourceReference(value: unknown): value is ExternalReferenceSourceReference {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.referenceId) || !isNonEmptyString(value.referenceRequestId)) return false;
  if (!isPlainObject(value.producer) || value.producer.name !== PRODUCER_NAME || !isNonEmptyString(value.producer.version)) return false;
  if (value.schemaVersion !== EXTERNAL_REFERENCE_SCHEMA_VERSION) return false;
  return isValidExternalReferenceImageReference(value.image);
}

// --- Lifecycle ------------------------------------------------------------------

/**
 * Exactly two persisted states. There is no literal 'superseded' variant:
 * supersession is represented only as a forward-declared relationship (a
 * newer artifact's `supersedesReferenceId` pointing at an older artifact's
 * `referenceId`) so that an existing persisted artifact's own lifecycle field
 * is never rewritten - "old evidence remains immutable, no hidden rewrite"
 * holds unconditionally rather than depending on careful mutation discipline.
 */
export type ExternalReferenceLifecycleState = { state: 'imported' } | { state: 'approved'; approvedAt: string };

export function isValidExternalReferenceLifecycleState(value: unknown): value is ExternalReferenceLifecycleState {
  if (!isPlainObject(value)) return false;
  if (value.state === 'imported') return Object.keys(value).length === 1;
  if (value.state === 'approved') return Object.keys(value).length === 2 && isNonEmptyString(value.approvedAt);
  return false;
}

// --- Provenance -------------------------------------------------------------------

export interface ExternalReferenceProvenance {
  importedAt: string;
  /** Optional caller-supplied human label - pure provenance, never identity-bearing (see externalReferenceIdentity.ts). */
  label?: string;
}

export function isValidExternalReferenceProvenance(value: unknown): value is ExternalReferenceProvenance {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.importedAt)) return false;
  if ('label' in value && value.label !== undefined && !isNonEmptyString(value.label)) return false;
  return true;
}

// --- External reference artifact ---------------------------------------------------

interface ExternalReferenceArtifactBase {
  artifactKind: typeof EXTERNAL_REFERENCE_ARTIFACT_KIND;
  schemaVersion: typeof EXTERNAL_REFERENCE_SCHEMA_VERSION;
  /** Deterministic logical identity - see buildExternalReferenceRequestIdentity. Shared by an imported artifact and every artifact produced by approving it. */
  referenceRequestId: string;
  /** Fresh per-persisted-instance identity - see buildExternalReferenceInstanceIdentity. */
  referenceId: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  provenance: ExternalReferenceProvenance;
  /** Explicit, forward-only supersession of a prior reference's referenceId - never inferred from image/content similarity. */
  supersedesReferenceId?: string;
  /**
   * v0.7 Prompt 2 addition (additive, optional - a Prompt 1 artifact predates
   * this field entirely and remains valid without it, so no schema version
   * bump was needed). Explicit, user/configuration-authored reference-image
   * rectangles - identity-bearing wherever present (see
   * externalReferenceIdentity.ts). Never mutated in place: changing region
   * content produces a new referenceRequestId/referenceId, never a rewrite of
   * this array on an existing persisted artifact.
   */
  regions?: ReferenceRegion[];
  diagnostics: Diagnostic[];
  completion: CompletionState;
}

export interface ImportedExternalReferenceArtifact extends ExternalReferenceArtifactBase {
  lifecycle: { state: 'imported' };
  image: ExternalReferenceImageReference;
}

export interface ApprovedExternalReferenceArtifact extends ExternalReferenceArtifactBase {
  lifecycle: { state: 'approved'; approvedAt: string };
  sourceReference: ExternalReferenceSourceReference;
}

export type ExternalReferenceArtifact = ImportedExternalReferenceArtifact | ApprovedExternalReferenceArtifact;

/** User-defined type guards: TypeScript does not narrow a union of `extends`-based interfaces purely from a nested `artifact.lifecycle.state` comparison, so callers needing the narrowed shape (the writer, the application service) use these instead of re-deriving the check. */
export function isImportedExternalReferenceArtifact(artifact: ExternalReferenceArtifact): artifact is ImportedExternalReferenceArtifact {
  return artifact.lifecycle.state === 'imported';
}

export function isApprovedExternalReferenceArtifact(artifact: ExternalReferenceArtifact): artifact is ApprovedExternalReferenceArtifact {
  return artifact.lifecycle.state === 'approved';
}

export type ExternalReferenceValidationResult = { valid: true } | { valid: false; reason: string };

function isValidDiagnosticArray(value: unknown): value is Diagnostic[] {
  return (
    Array.isArray(value) &&
    value.every(
      (d: unknown) =>
        isPlainObject(d) &&
        typeof d.code === 'string' &&
        (d.severity === 'error' || d.severity === 'warning') &&
        typeof d.message === 'string' &&
        d.message.length > 0,
    )
  );
}

function isValidCompletionState(value: unknown): value is CompletionState {
  if (!isPlainObject(value)) return false;
  if (value.state === 'complete') return Object.keys(value).length === 1;
  if (value.state === 'partial' || value.state === 'warning' || value.state === 'invalid-request' || value.state === 'fatal') {
    return Object.keys(value).length === 2 && isValidDiagnosticArray(value.diagnostics);
  }
  return false;
}

/**
 * Structural validator for ExternalReferenceArtifact. The single gate used by
 * both the writer and the reader (artifacts/externalReferenceArtifactWriter.ts
 * / externalReferenceArtifactReader.ts) - never a second validator. Rejects a
 * value that mixes the two lifecycle-variant-specific fields (an 'imported'
 * artifact must never carry sourceReference; an 'approved' artifact must
 * never carry image), fails closed on an unsupported schemaVersion, and never
 * re-parses raw image bytes (that already happened before this object was
 * built - see application/externalReferencePersistenceService.ts).
 */
export function isValidExternalReferenceArtifact(value: unknown): ExternalReferenceValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'artifact must be an object' };
  if (value.artifactKind !== EXTERNAL_REFERENCE_ARTIFACT_KIND) return { valid: false, reason: 'artifactKind mismatch' };
  if (value.schemaVersion !== EXTERNAL_REFERENCE_SCHEMA_VERSION) return { valid: false, reason: 'schemaVersion mismatch' };
  if (!isNonEmptyString(value.referenceRequestId)) return { valid: false, reason: 'referenceRequestId must be a non-empty string' };
  if (!isNonEmptyString(value.referenceId)) return { valid: false, reason: 'referenceId must be a non-empty string' };
  if (!isPlainObject(value.producer) || value.producer.name !== PRODUCER_NAME || typeof value.producer.version !== 'string' || value.producer.version.length === 0) {
    return { valid: false, reason: 'producer must be { name: "my-frontend-observer", version: string }' };
  }
  if (!isValidExternalReferenceProvenance(value.provenance)) return { valid: false, reason: 'provenance is invalid' };
  if ('supersedesReferenceId' in value && value.supersedesReferenceId !== undefined && !isNonEmptyString(value.supersedesReferenceId)) {
    return { valid: false, reason: 'supersedesReferenceId must be a non-empty string when present' };
  }
  if (!isValidDiagnosticArray(value.diagnostics)) return { valid: false, reason: 'diagnostics must be an array of valid Diagnostic values' };
  if (!isValidCompletionState(value.completion)) return { valid: false, reason: 'completion is invalid' };
  if (isPlainObject(value.completion) && value.completion.state === 'complete' && (value.diagnostics as unknown[]).length > 0) {
    return { valid: false, reason: 'completion "complete" requires an empty diagnostics array' };
  }
  if (!isValidExternalReferenceLifecycleState(value.lifecycle)) return { valid: false, reason: 'lifecycle is invalid' };

  const lifecycle = value.lifecycle as ExternalReferenceLifecycleState;
  const hasImage = 'image' in value && value.image !== undefined;
  const hasSourceReference = 'sourceReference' in value && value.sourceReference !== undefined;

  let imageWidth: number;
  let imageHeight: number;

  if (lifecycle.state === 'imported') {
    if (hasSourceReference) return { valid: false, reason: 'an "imported" artifact must not carry sourceReference' };
    if (!hasImage || !isValidExternalReferenceImageReference(value.image)) return { valid: false, reason: 'an "imported" artifact must carry a valid image reference' };
    const image = value.image as ExternalReferenceImageReference;
    imageWidth = image.width;
    imageHeight = image.height;
  } else {
    // lifecycle.state === 'approved'
    if (hasImage) return { valid: false, reason: 'an "approved" artifact must not carry image (it never owns a copy of the reference image)' };
    if (!hasSourceReference || !isValidExternalReferenceSourceReference(value.sourceReference)) {
      return { valid: false, reason: 'an "approved" artifact must carry a valid sourceReference' };
    }
    const sourceReference = value.sourceReference as ExternalReferenceSourceReference;
    imageWidth = sourceReference.image.width;
    imageHeight = sourceReference.image.height;
  }

  if ('regions' in value && value.regions !== undefined) {
    const regionsValidation = isValidReferenceRegions(value.regions, imageWidth, imageHeight);
    if (!regionsValidation.valid) return { valid: false, reason: `regions: ${regionsValidation.reason}` };
  }

  return { valid: true };
}
