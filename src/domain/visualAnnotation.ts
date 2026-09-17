/**
 * v0.9 Batch 1 visual-annotation artifact family (frozen by
 * docs/plans/v0.9-implementation-plan.md sections 3 and 4). A visual
 * annotation is structured human intent drawn over exactly one existing
 * source: a runtime observation screenshot (viewport CSS pixels) or an
 * external reference image (reference-image pixels). The two coordinate and
 * identity domains are never collapsed.
 *
 * This module owns the types, the one canonical structural validator
 * (`isValidVisualAnnotationArtifact`, used by both the writer and the
 * reader), and the one pure deterministic overlay renderer
 * (`renderVisualAnnotationOverlaySvg`). It never reads the filesystem, never
 * resolves whether an associated target/region exists in another artifact,
 * never promotes intent into a contract, and never materializes reference
 * regions/requirements - those belong to later v0.9 batches.
 *
 * Observations and external references remain immutable evidence: this
 * module adds no field to ObservationArtifact, ExternalReferenceArtifact,
 * ComparisonArtifact, or any contract artifact.
 */
import { PRODUCER_NAME, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION } from './schema.js';
import { EXTERNAL_REFERENCE_SCHEMA_VERSION } from './externalReference.js';
import type { PairwiseRelationshipKind, PageLevelRelationshipKind } from './relationships.js';
import { PAIRWISE_RELATIONSHIP_KINDS, PAGE_LEVEL_RELATIONSHIP_KINDS } from './relationships.js';
import type { AuthoredChangeScopeCategory, ExpectedDependentMode, ContractPrimitive } from './frontendContracts.js';
import { isAuthoredChangeScopeCategory, isValidExpectedDependentMode, isValidContractPrimitive } from './frontendContracts.js';
import type { ReferenceRegion } from './externalReferenceRegions.js';
import { isValidReferenceRegions } from './externalReferenceRegions.js';
import type { RawReferenceRequirement } from './externalReferenceRequirements.js';
import { isValidRawReferenceRequirement } from './externalReferenceRequirements.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Rejects extra keys beyond the given allowlist, keeping every annotation shape closed rather than an open bag of fields. */
function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isPresent(value: Record<string, unknown>, key: string): boolean {
  return key in value && value[key] !== undefined;
}

/**
 * A single portable path segment: no separators, no drive/stream colon, no
 * NUL, never "." or "..". Used for the runtime screenshot reference (same
 * bare-filename convention as observation `screenshot.path` and
 * external-reference `image.path`) and for `annotationId`, which names the
 * artifact's own directory.
 */
function isSafeBareSegment(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  if (value === '.' || value === '..') return false;
  return !value.includes('/') && !value.includes('\\') && !value.includes(':') && !value.includes(String.fromCharCode(0));
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const VISUAL_ANNOTATION_ARTIFACT_KIND = 'my-frontend-observer/visual-annotation' as const;

export const VISUAL_ANNOTATION_SCHEMA_VERSION = '1.0.0' as const;

export const MAX_VISUAL_ANNOTATION_ITEMS = 100;
export const MAX_VISUAL_ANNOTATION_NOTE_LENGTH = 2000;

/** The one owned derived overlay filename (frozen plan section 3.12). */
export const VISUAL_ANNOTATION_OVERLAY_PATH = 'annotation-overlay.svg' as const;

export type VisualAnnotationValidationResult = { valid: true } | { valid: false; reason: string };

const VALID: VisualAnnotationValidationResult = { valid: true };

function invalid(reason: string): VisualAnnotationValidationResult {
  return { valid: false, reason };
}

// --- Source -----------------------------------------------------------------------

/**
 * Exactly two source contexts. Canonical source identity only - never a
 * mutable project alias, absolute artifact path, viewer evidence handle,
 * viewer URL, or viewer port.
 */
export type VisualAnnotationSource =
  | {
      kind: 'runtime-observation';

      observationId: string;
      requestId: string;

      observationSchemaVersion: typeof OBSERVATION_SCHEMA_VERSION;

      screenshot: {
        path: string;
      };

      coordinateSpace: {
        kind: 'runtime-css-px';
        width: number;
        height: number;
      };
    }
  | {
      kind: 'external-reference';

      referenceId: string;
      referenceRequestId: string;

      referenceSchemaVersion: typeof EXTERNAL_REFERENCE_SCHEMA_VERSION;

      lifecycle: 'imported' | 'approved';

      imageOwnerReferenceId: string;
      imageSha256: string;

      coordinateSpace: {
        kind: 'reference-image-px';
        width: number;
        height: number;
      };
    };

function validateCoordinateSpace(value: unknown, expectedKind: 'runtime-css-px' | 'reference-image-px'): VisualAnnotationValidationResult {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['kind', 'width', 'height'])) return invalid('source.coordinateSpace must be { kind, width, height }');
  if (value.kind !== expectedKind) return invalid(`source.coordinateSpace.kind must be "${expectedKind}" for this source kind`);
  if (!isFiniteNumber(value.width) || value.width <= 0) return invalid('source.coordinateSpace.width must be a finite number greater than 0');
  if (!isFiniteNumber(value.height) || value.height <= 0) return invalid('source.coordinateSpace.height must be a finite number greater than 0');
  return VALID;
}

function validateSource(value: unknown): VisualAnnotationValidationResult {
  if (!isPlainObject(value)) return invalid('source must be an object');

  if (value.kind === 'runtime-observation') {
    if (!hasOnlyKeys(value, ['kind', 'observationId', 'requestId', 'observationSchemaVersion', 'screenshot', 'coordinateSpace'])) {
      return invalid('runtime-observation source contains unsupported fields');
    }
    if (!isNonEmptyString(value.observationId)) return invalid('source.observationId must be a non-empty string');
    if (!isNonEmptyString(value.requestId)) return invalid('source.requestId must be a non-empty string');
    if (value.observationSchemaVersion !== OBSERVATION_SCHEMA_VERSION) return invalid(`source.observationSchemaVersion must be "${OBSERVATION_SCHEMA_VERSION}"`);
    if (!isPlainObject(value.screenshot) || !hasOnlyKeys(value.screenshot, ['path']) || !isSafeBareSegment(value.screenshot.path)) {
      return invalid('source.screenshot.path must be a safe bare artifact-relative filename');
    }
    return validateCoordinateSpace(value.coordinateSpace, 'runtime-css-px');
  }

  if (value.kind === 'external-reference') {
    if (
      !hasOnlyKeys(value, ['kind', 'referenceId', 'referenceRequestId', 'referenceSchemaVersion', 'lifecycle', 'imageOwnerReferenceId', 'imageSha256', 'coordinateSpace'])
    ) {
      return invalid('external-reference source contains unsupported fields');
    }
    if (!isNonEmptyString(value.referenceId)) return invalid('source.referenceId must be a non-empty string');
    if (!isNonEmptyString(value.referenceRequestId)) return invalid('source.referenceRequestId must be a non-empty string');
    if (value.referenceSchemaVersion !== EXTERNAL_REFERENCE_SCHEMA_VERSION) return invalid(`source.referenceSchemaVersion must be "${EXTERNAL_REFERENCE_SCHEMA_VERSION}"`);
    if (value.lifecycle !== 'imported' && value.lifecycle !== 'approved') return invalid('source.lifecycle must be "imported" or "approved"');
    if (!isNonEmptyString(value.imageOwnerReferenceId)) return invalid('source.imageOwnerReferenceId must be a non-empty string');
    // Mirrors the external-reference lifecycle model: an imported reference owns its own image;
    // an approved reference never owns a copy and points back to the imported artifact that does.
    if (value.lifecycle === 'imported' && value.imageOwnerReferenceId !== value.referenceId) {
      return invalid('source.imageOwnerReferenceId must equal source.referenceId for an "imported" reference');
    }
    if (value.lifecycle === 'approved' && value.imageOwnerReferenceId === value.referenceId) {
      return invalid('source.imageOwnerReferenceId must name the owning imported reference, not the approved reference itself');
    }
    if (typeof value.imageSha256 !== 'string' || !SHA256_HEX_PATTERN.test(value.imageSha256)) {
      return invalid('source.imageSha256 must be a lowercase 64-character SHA-256 hex digest');
    }
    return validateCoordinateSpace(value.coordinateSpace, 'reference-image-px');
  }

  return invalid('source.kind must be "runtime-observation" or "external-reference"');
}

// --- Marks --------------------------------------------------------------------------

export type VisualAnnotationMark =
  | {
      kind: 'point';
      x: number;
      y: number;
    }
  | {
      kind: 'rectangle';
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: 'line';
      start: {
        x: number;
        y: number;
      };
      end: {
        x: number;
        y: number;
      };
    }
  | {
      kind: 'arrow';
      start: {
        x: number;
        y: number;
      };
      end: {
        x: number;
        y: number;
      };
    }
  | {
      kind: 'note';
      anchor: {
        x: number;
        y: number;
      };
      text: string;
    };

interface Frame {
  width: number;
  height: number;
}

/**
 * Saved annotation geometry must lie inside its source frame (inclusive
 * edges). Never clamped, rounded, or scaled by devicePixelRatio. This rule
 * applies to annotation geometry only - existing runtime target evidence may
 * still legitimately extend outside the captured viewport.
 */
function validateCoordinate(x: unknown, y: unknown, frame: Frame, label: string): VisualAnnotationValidationResult {
  if (!isFiniteNumber(x)) return invalid(`${label}.x must be a finite number`);
  if (!isFiniteNumber(y)) return invalid(`${label}.y must be a finite number`);
  if (x < 0 || x > frame.width) return invalid(`${label}.x must be within 0..${frame.width}`);
  if (y < 0 || y > frame.height) return invalid(`${label}.y must be within 0..${frame.height}`);
  return VALID;
}

function validatePointObject(value: unknown, frame: Frame, label: string): VisualAnnotationValidationResult {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['x', 'y'])) return invalid(`${label} must be { x, y }`);
  return validateCoordinate(value.x, value.y, frame, label);
}

function validateMark(value: unknown, frame: Frame, label: string): VisualAnnotationValidationResult {
  if (!isPlainObject(value)) return invalid(`${label} must be an object`);
  switch (value.kind) {
    case 'point':
      if (!hasOnlyKeys(value, ['kind', 'x', 'y'])) return invalid(`${label} (point) contains unsupported fields`);
      return validateCoordinate(value.x, value.y, frame, label);
    case 'rectangle': {
      if (!hasOnlyKeys(value, ['kind', 'x', 'y', 'width', 'height'])) return invalid(`${label} (rectangle) contains unsupported fields`);
      const origin = validateCoordinate(value.x, value.y, frame, label);
      if (!origin.valid) return origin;
      if (!isFiniteNumber(value.width) || value.width <= 0) return invalid(`${label}.width must be a finite number greater than 0`);
      if (!isFiniteNumber(value.height) || value.height <= 0) return invalid(`${label}.height must be a finite number greater than 0`);
      if ((value.x as number) + value.width > frame.width) return invalid(`${label} right edge must not exceed ${frame.width}`);
      if ((value.y as number) + value.height > frame.height) return invalid(`${label} bottom edge must not exceed ${frame.height}`);
      return VALID;
    }
    case 'line':
    case 'arrow': {
      if (!hasOnlyKeys(value, ['kind', 'start', 'end'])) return invalid(`${label} (${value.kind}) contains unsupported fields`);
      const start = validatePointObject(value.start, frame, `${label}.start`);
      if (!start.valid) return start;
      return validatePointObject(value.end, frame, `${label}.end`);
    }
    case 'note': {
      if (!hasOnlyKeys(value, ['kind', 'anchor', 'text'])) return invalid(`${label} (note) contains unsupported fields`);
      const anchor = validatePointObject(value.anchor, frame, `${label}.anchor`);
      if (!anchor.valid) return anchor;
      if (!isNonEmptyString(value.text)) return invalid(`${label}.text must be a non-empty string`);
      if (value.text.length > MAX_VISUAL_ANNOTATION_NOTE_LENGTH) return invalid(`${label}.text must be at most ${MAX_VISUAL_ANNOTATION_NOTE_LENGTH} characters`);
      return VALID;
    }
    default:
      return invalid(`${label}.kind must be one of point, rectangle, line, arrow, note`);
  }
}

// --- Associations -----------------------------------------------------------------------

export type RuntimeAnnotationAssociation =
  | {
      kind: 'runtime-target';
      target: string;
    }
  | {
      kind: 'runtime-relationship';
      relationshipKind: PairwiseRelationshipKind | PageLevelRelationshipKind;
      subjectTarget?: string;
      relatedTarget?: string;
    };

export type ReferenceAnnotationAssociation =
  | {
      kind: 'reference-region';
      regionId: string;
    }
  | {
      kind: 'reference-relationship';
      subjectRegion: string;
      relatedRegion: string;
      relationship: PairwiseRelationshipKind;
    };

/**
 * Structured association shape only. Whether the named target/region exists
 * in the source artifact is resolved by later viewer/application integration,
 * never here, and never inferred from geometry or names.
 */
function validateRuntimeAssociation(value: Record<string, unknown>, label: string): VisualAnnotationValidationResult {
  if (value.kind === 'runtime-target') {
    if (!hasOnlyKeys(value, ['kind', 'target'])) return invalid(`${label} (runtime-target) contains unsupported fields`);
    if (!isNonEmptyString(value.target)) return invalid(`${label}.target must be a non-empty string`);
    return VALID;
  }
  if (value.kind === 'runtime-relationship') {
    if (!hasOnlyKeys(value, ['kind', 'relationshipKind', 'subjectTarget', 'relatedTarget'])) return invalid(`${label} (runtime-relationship) contains unsupported fields`);
    const relationshipKind = value.relationshipKind;
    const hasSubject = isPresent(value, 'subjectTarget');
    const hasRelated = isPresent(value, 'relatedTarget');
    if (typeof relationshipKind === 'string' && (PAIRWISE_RELATIONSHIP_KINDS as readonly string[]).includes(relationshipKind)) {
      // Mirrors PairwiseLayoutRelationship: two distinct, non-empty target identities.
      if (!isNonEmptyString(value.subjectTarget) || !isNonEmptyString(value.relatedTarget)) {
        return invalid(`${label} pairwise relationship requires non-empty subjectTarget and relatedTarget`);
      }
      if (value.subjectTarget === value.relatedTarget) return invalid(`${label} pairwise relationship requires two distinct targets`);
      return VALID;
    }
    if (typeof relationshipKind === 'string' && (PAGE_LEVEL_RELATIONSHIP_KINDS as readonly string[]).includes(relationshipKind)) {
      // Mirrors PageLevelLayoutRelationship: a page-level relationship has no target pair.
      if (hasSubject || hasRelated) return invalid(`${label} page-level relationship must not carry subjectTarget/relatedTarget`);
      return VALID;
    }
    return invalid(`${label}.relationshipKind must be an existing pairwise or page-level relationship kind`);
  }
  return invalid(`${label}.kind "${String(value.kind)}" is not a runtime association`);
}

function validateReferenceAssociation(value: Record<string, unknown>, label: string): VisualAnnotationValidationResult {
  if (value.kind === 'reference-region') {
    if (!hasOnlyKeys(value, ['kind', 'regionId'])) return invalid(`${label} (reference-region) contains unsupported fields`);
    if (!isNonEmptyString(value.regionId)) return invalid(`${label}.regionId must be a non-empty string`);
    return VALID;
  }
  if (value.kind === 'reference-relationship') {
    if (!hasOnlyKeys(value, ['kind', 'subjectRegion', 'relatedRegion', 'relationship'])) return invalid(`${label} (reference-relationship) contains unsupported fields`);
    if (!isNonEmptyString(value.subjectRegion) || !isNonEmptyString(value.relatedRegion)) {
      return invalid(`${label} requires non-empty subjectRegion and relatedRegion`);
    }
    if (value.subjectRegion === value.relatedRegion) return invalid(`${label} requires two distinct region ids`);
    if (typeof value.relationship !== 'string' || !(PAIRWISE_RELATIONSHIP_KINDS as readonly string[]).includes(value.relationship)) {
      return invalid(`${label}.relationship must be an existing pairwise relationship kind`);
    }
    return VALID;
  }
  return invalid(`${label}.kind "${String(value.kind)}" is not a reference association`);
}

// --- Intent and interpretation --------------------------------------------------------------

export type VisualAnnotationIntent =
  | {
      kind: 'inspect';
    }
  | {
      kind: 'change';
      operation: 'move' | 'resize' | 'remove' | 'preserve';
      category: AuthoredChangeScopeCategory;
      expectedDependentMode?: ExpectedDependentMode;
      contractPrimitive?: ContractPrimitive;
    }
  | {
      kind: 'reference-region';
      mode: 'create' | 'refine';
      region: ReferenceRegion;
    }
  | {
      kind: 'reference-requirement';
      requirement: RawReferenceRequirement;
    }
  | {
      kind: 'asset-sensitive';
      regionId?: string;
    };

export type VisualAnnotationInterpretation =
  | {
      state: 'uninterpreted';
    }
  | {
      state: 'candidate';
      intent: VisualAnnotationIntent;
    }
  | {
      state: 'confirmed';
      intent: VisualAnnotationIntent;
      confirmedAt: string;
    };

const CHANGE_OPERATIONS = ['move', 'resize', 'remove', 'preserve'] as const;

function validateIntent(value: unknown, source: VisualAnnotationSource, label: string): VisualAnnotationValidationResult {
  if (!isPlainObject(value)) return invalid(`${label} must be an object`);
  const isRuntime = source.kind === 'runtime-observation';

  switch (value.kind) {
    case 'inspect':
      if (!hasOnlyKeys(value, ['kind'])) return invalid(`${label} (inspect) contains unsupported fields`);
      return VALID;

    case 'change': {
      if (!isRuntime) return invalid(`${label} "change" intent is valid only for a runtime-observation source`);
      if (!hasOnlyKeys(value, ['kind', 'operation', 'category', 'expectedDependentMode', 'contractPrimitive'])) {
        return invalid(`${label} (change) contains unsupported fields`);
      }
      if (typeof value.operation !== 'string' || !(CHANGE_OPERATIONS as readonly string[]).includes(value.operation)) {
        return invalid(`${label}.operation must be one of ${CHANGE_OPERATIONS.join(', ')}`);
      }
      // Existing canonical authored vocabulary: 'unexpected' is not a member and can never be authored.
      if (!isAuthoredChangeScopeCategory(value.category)) return invalid(`${label}.category must be an authored change-scope category`);
      const hasMode = isPresent(value, 'expectedDependentMode');
      if (value.category === 'expected-dependent') {
        if (!hasMode || !isValidExpectedDependentMode(value.expectedDependentMode)) {
          return invalid(`${label}.expectedDependentMode is required and must be valid when category is "expected-dependent"`);
        }
      } else if (hasMode) {
        return invalid(`${label}.expectedDependentMode must be absent unless category is "expected-dependent"`);
      }
      const hasPrimitive = isPresent(value, 'contractPrimitive');
      if (value.operation === 'remove') {
        // The current contract vocabulary has no target-absent primitive; never fabricate an equivalent.
        if (hasPrimitive) return invalid(`${label} "remove" must not carry a contractPrimitive (not promotable by the current canonical contract vocabulary)`);
      } else if (hasPrimitive && !isValidContractPrimitive(value.contractPrimitive)) {
        return invalid(`${label}.contractPrimitive is not a valid ContractPrimitive`);
      }
      return VALID;
    }

    case 'reference-region': {
      if (isRuntime) return invalid(`${label} "reference-region" intent is valid only for an external-reference source`);
      if (!hasOnlyKeys(value, ['kind', 'mode', 'region'])) return invalid(`${label} (reference-region) contains unsupported fields`);
      if (value.mode !== 'create' && value.mode !== 'refine') return invalid(`${label}.mode must be "create" or "refine"`);
      const regionValidation = isValidReferenceRegions([value.region], source.coordinateSpace.width, source.coordinateSpace.height);
      if (!regionValidation.valid) return invalid(`${label}.region: ${regionValidation.reason}`);
      return VALID;
    }

    case 'reference-requirement': {
      if (isRuntime) return invalid(`${label} "reference-requirement" intent is valid only for an external-reference source`);
      if (!hasOnlyKeys(value, ['kind', 'requirement'])) return invalid(`${label} (reference-requirement) contains unsupported fields`);
      const requirementValidation = isValidRawReferenceRequirement(value.requirement);
      if (!requirementValidation.valid) return invalid(`${label}.requirement: ${requirementValidation.reason}`);
      return VALID;
    }

    case 'asset-sensitive':
      if (isRuntime) return invalid(`${label} "asset-sensitive" intent is valid only for an external-reference source`);
      if (!hasOnlyKeys(value, ['kind', 'regionId'])) return invalid(`${label} (asset-sensitive) contains unsupported fields`);
      if (isPresent(value, 'regionId') && !isNonEmptyString(value.regionId)) return invalid(`${label}.regionId must be a non-empty string when present`);
      return VALID;

    default:
      return invalid(`${label}.kind must be one of inspect, change, reference-region, reference-requirement, asset-sensitive`);
  }
}

function validateInterpretation(value: unknown, source: VisualAnnotationSource, label: string): VisualAnnotationValidationResult {
  if (!isPlainObject(value)) return invalid(`${label} must be an object`);
  switch (value.state) {
    case 'uninterpreted':
      if (!hasOnlyKeys(value, ['state']) || isPresent(value, 'intent') || isPresent(value, 'confirmedAt')) {
        return invalid(`${label} "uninterpreted" must not carry intent or confirmedAt`);
      }
      return VALID;
    case 'candidate':
      if (!hasOnlyKeys(value, ['state', 'intent']) || isPresent(value, 'confirmedAt')) return invalid(`${label} "candidate" must carry only intent`);
      return validateIntent(value.intent, source, `${label}.intent`);
    case 'confirmed':
      if (!hasOnlyKeys(value, ['state', 'intent', 'confirmedAt'])) return invalid(`${label} "confirmed" contains unsupported fields`);
      if (!isNonEmptyString(value.confirmedAt)) return invalid(`${label}.confirmedAt must be a non-empty string`);
      return validateIntent(value.intent, source, `${label}.intent`);
    default:
      return invalid(`${label}.state must be one of uninterpreted, candidate, confirmed`);
  }
}

// --- Items ------------------------------------------------------------------------------------

export interface VisualAnnotationItem {
  /** Opaque Observer-owned id, stable across revisions of the same logical item - never derived from geometry. */
  annotationItemId: string;
  mark: VisualAnnotationMark;
  association?: RuntimeAnnotationAssociation | ReferenceAnnotationAssociation;
  interpretation: VisualAnnotationInterpretation;
}

function validateItem(value: unknown, source: VisualAnnotationSource, label: string): VisualAnnotationValidationResult {
  if (!isPlainObject(value)) return invalid(`${label} must be an object`);
  if (!hasOnlyKeys(value, ['annotationItemId', 'mark', 'association', 'interpretation'])) return invalid(`${label} contains unsupported fields`);
  if (!isNonEmptyString(value.annotationItemId)) return invalid(`${label}.annotationItemId must be a non-empty string`);

  const markValidation = validateMark(value.mark, source.coordinateSpace, `${label}.mark`);
  if (!markValidation.valid) return markValidation;

  if (isPresent(value, 'association')) {
    const association = value.association;
    if (!isPlainObject(association)) return invalid(`${label}.association must be an object`);
    const associationValidation =
      source.kind === 'runtime-observation'
        ? validateRuntimeAssociation(association, `${label}.association`)
        : validateReferenceAssociation(association, `${label}.association`);
    if (!associationValidation.valid) return associationValidation;
  }

  return validateInterpretation(value.interpretation, source, `${label}.interpretation`);
}

/**
 * Validates the semantic annotation content (one source plus its bounded,
 * uniquely identified items) against the source's own coordinate domain.
 * This is the content half of `isValidVisualAnnotationArtifact`, exposed so
 * the persistence service can refuse invalid input before deriving identity
 * or rendering - it is the same validation, never a second rule set.
 */
export function isValidVisualAnnotationContent(source: unknown, items: unknown): VisualAnnotationValidationResult {
  const sourceValidation = validateSource(source);
  if (!sourceValidation.valid) return sourceValidation;
  const validSource = source as VisualAnnotationSource;

  if (!Array.isArray(items)) return invalid('items must be an array');
  if (items.length > MAX_VISUAL_ANNOTATION_ITEMS) return invalid(`items must contain at most ${MAX_VISUAL_ANNOTATION_ITEMS} entries`);

  const seenItemIds = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const itemValidation = validateItem(items[index], validSource, `items[${index}]`);
    if (!itemValidation.valid) return itemValidation;
    const itemId = (items[index] as VisualAnnotationItem).annotationItemId;
    if (seenItemIds.has(itemId)) return invalid(`duplicate annotationItemId "${itemId}"`);
    seenItemIds.add(itemId);
  }
  return VALID;
}

// --- Artifact ------------------------------------------------------------------------------------

export interface VisualAnnotationArtifact {
  artifactKind: typeof VISUAL_ANNOTATION_ARTIFACT_KIND;
  schemaVersion: typeof VISUAL_ANNOTATION_SCHEMA_VERSION;

  /** Deterministic logical identity - see visualAnnotationIdentity.ts#buildVisualAnnotationRequestIdentity. */
  annotationRequestId: string;
  /** Fresh per-persisted-instance identity - see buildVisualAnnotationInstanceIdentity. */
  annotationId: string;

  /** Explicit, forward-only revision lineage - the previous artifact is never changed. */
  supersedesAnnotationId?: string;

  producer: {
    name: typeof PRODUCER_NAME;
    version: string;
  };

  source: VisualAnnotationSource;

  items: VisualAnnotationItem[];

  overlay: {
    path: typeof VISUAL_ANNOTATION_OVERLAY_PATH;
    format: 'svg';
    width: number;
    height: number;
    sha256: string;
  };

  provenance: {
    createdAt: string;
    origin: 'viewer';
  };
}

const ARTIFACT_KEYS = [
  'artifactKind',
  'schemaVersion',
  'annotationRequestId',
  'annotationId',
  'supersedesAnnotationId',
  'producer',
  'source',
  'items',
  'overlay',
  'provenance',
] as const;

/**
 * Structural validator for VisualAnnotationArtifact. The single gate used by
 * both the writer and the reader (artifacts/visualAnnotationArtifactWriter.ts
 * / visualAnnotationArtifactReader.ts) - never a second validator. Fails
 * closed on an unsupported schemaVersion, cross-domain associations/intents,
 * out-of-frame geometry, and overlay metadata that disagrees with the source
 * frame. It never reads overlay bytes (the reader verifies the digest).
 */
export function isValidVisualAnnotationArtifact(value: unknown): VisualAnnotationValidationResult {
  if (!isPlainObject(value)) return invalid('artifact must be an object');
  if (value.artifactKind !== VISUAL_ANNOTATION_ARTIFACT_KIND) return invalid('artifactKind mismatch');
  if (value.schemaVersion !== VISUAL_ANNOTATION_SCHEMA_VERSION) return invalid('schemaVersion mismatch');
  if (!hasOnlyKeys(value, ARTIFACT_KEYS)) return invalid('artifact contains unsupported fields');
  if (!isNonEmptyString(value.annotationRequestId)) return invalid('annotationRequestId must be a non-empty string');
  if (!isSafeBareSegment(value.annotationId)) return invalid('annotationId must be a non-empty single path segment');
  if (isPresent(value, 'supersedesAnnotationId')) {
    if (!isNonEmptyString(value.supersedesAnnotationId)) return invalid('supersedesAnnotationId must be a non-empty string when present');
    if (value.supersedesAnnotationId === value.annotationId) return invalid('supersedesAnnotationId must not equal annotationId');
  }
  if (
    !isPlainObject(value.producer) ||
    !hasOnlyKeys(value.producer, ['name', 'version']) ||
    value.producer.name !== PRODUCER_NAME ||
    !isNonEmptyString(value.producer.version)
  ) {
    return invalid('producer must be { name: "my-frontend-observer", version: string }');
  }

  const contentValidation = isValidVisualAnnotationContent(value.source, value.items);
  if (!contentValidation.valid) return contentValidation;
  const source = value.source as VisualAnnotationSource;

  const overlay = value.overlay;
  if (!isPlainObject(overlay) || !hasOnlyKeys(overlay, ['path', 'format', 'width', 'height', 'sha256'])) return invalid('overlay must be { path, format, width, height, sha256 }');
  if (overlay.path !== VISUAL_ANNOTATION_OVERLAY_PATH) return invalid(`overlay.path must be exactly "${VISUAL_ANNOTATION_OVERLAY_PATH}"`);
  if (overlay.format !== 'svg') return invalid('overlay.format must be exactly "svg"');
  if (overlay.width !== source.coordinateSpace.width || overlay.height !== source.coordinateSpace.height) {
    return invalid('overlay.width/height must exactly match source.coordinateSpace dimensions');
  }
  if (typeof overlay.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(overlay.sha256)) return invalid('overlay.sha256 must be a lowercase 64-character SHA-256 hex digest');

  const provenance = value.provenance;
  if (!isPlainObject(provenance) || !hasOnlyKeys(provenance, ['createdAt', 'origin'])) return invalid('provenance must be { createdAt, origin }');
  if (!isNonEmptyString(provenance.createdAt)) return invalid('provenance.createdAt must be a non-empty string');
  if (provenance.origin !== 'viewer') return invalid('provenance.origin must be exactly "viewer"');

  return VALID;
}

// --- Deterministic overlay SVG --------------------------------------------------------------------

/** Fixed style constants: independent of annotation state, OS, theme, and locale. */
const OVERLAY_STROKE_COLOR = '#ff2d55';
const OVERLAY_STROKE_WIDTH = 2;
const OVERLAY_POINT_RADIUS = 6;
const OVERLAY_NOTE_ANCHOR_RADIUS = 4;
const OVERLAY_NOTE_TEXT_OFFSET = 8;
const OVERLAY_NOTE_FONT_SIZE = 14;
const OVERLAY_NOTE_FONT_FAMILY = 'sans-serif';
const OVERLAY_ARROWHEAD_LENGTH = 12;
const OVERLAY_ARROWHEAD_HALF_WIDTH = 6;

const STROKE_ATTRIBUTES = `fill="none" stroke="${OVERLAY_STROKE_COLOR}" stroke-width="${OVERLAY_STROKE_WIDTH}"`;
const FILL_ATTRIBUTES = `fill="${OVERLAY_STROKE_COLOR}" stroke="none"`;

/** Locale-independent shortest round-trip number formatting; never emits "-0". */
function formatNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

/**
 * XML-escapes user-controlled text so it always remains inert character data.
 * Characters that are not allowed in XML 1.0 documents are replaced with
 * U+FFFD in the overlay only (the manifest keeps the authored text verbatim
 * and remains authoritative).
 */
function isXmlDisallowedCodeUnit(code: number): boolean {
  if (code < 0x20) return code !== 0x09 && code !== 0x0a && code !== 0x0d;
  return code === 0xfffe || code === 0xffff;
}

function escapeXmlText(text: string): string {
  let allowed = '';
  for (let index = 0; index < text.length; index += 1) {
    allowed += isXmlDisallowedCodeUnit(text.charCodeAt(index)) ? '�' : text.charAt(index);
  }
  return allowed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderArrowhead(start: { x: number; y: number }, end: { x: number; y: number }): string | undefined {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return undefined;
  const ux = dx / length;
  const uy = dy / length;
  const baseX = end.x - ux * OVERLAY_ARROWHEAD_LENGTH;
  const baseY = end.y - uy * OVERLAY_ARROWHEAD_LENGTH;
  const leftX = baseX - uy * OVERLAY_ARROWHEAD_HALF_WIDTH;
  const leftY = baseY + ux * OVERLAY_ARROWHEAD_HALF_WIDTH;
  const rightX = baseX + uy * OVERLAY_ARROWHEAD_HALF_WIDTH;
  const rightY = baseY - ux * OVERLAY_ARROWHEAD_HALF_WIDTH;
  const points = [
    [end.x, end.y],
    [leftX, leftY],
    [rightX, rightY],
  ]
    .map(([px, py]) => `${formatNumber(px as number)},${formatNumber(py as number)}`)
    .join(' ');
  return `<polygon points="${points}" ${FILL_ATTRIBUTES}/>`;
}

function renderMark(mark: VisualAnnotationMark): string[] {
  switch (mark.kind) {
    case 'point':
      return [`<circle cx="${formatNumber(mark.x)}" cy="${formatNumber(mark.y)}" r="${OVERLAY_POINT_RADIUS}" ${STROKE_ATTRIBUTES}/>`];
    case 'rectangle':
      return [
        `<rect x="${formatNumber(mark.x)}" y="${formatNumber(mark.y)}" width="${formatNumber(mark.width)}" height="${formatNumber(mark.height)}" ${STROKE_ATTRIBUTES}/>`,
      ];
    case 'line':
    case 'arrow': {
      const line = `<line x1="${formatNumber(mark.start.x)}" y1="${formatNumber(mark.start.y)}" x2="${formatNumber(mark.end.x)}" y2="${formatNumber(mark.end.y)}" ${STROKE_ATTRIBUTES}/>`;
      if (mark.kind === 'line') return [line];
      const head = renderArrowhead(mark.start, mark.end);
      return head === undefined ? [line] : [line, head];
    }
    case 'note':
      return [
        `<circle cx="${formatNumber(mark.anchor.x)}" cy="${formatNumber(mark.anchor.y)}" r="${OVERLAY_NOTE_ANCHOR_RADIUS}" ${FILL_ATTRIBUTES}/>`,
        `<text x="${formatNumber(mark.anchor.x + OVERLAY_NOTE_TEXT_OFFSET)}" y="${formatNumber(mark.anchor.y - OVERLAY_NOTE_TEXT_OFFSET)}" font-family="${OVERLAY_NOTE_FONT_FAMILY}" font-size="${OVERLAY_NOTE_FONT_SIZE}" ${FILL_ATTRIBUTES}>${escapeXmlText(mark.text)}</text>`,
      ];
  }
}

/**
 * The one pure deterministic overlay renderer. Output depends only on the
 * source frame dimensions and the marks, in exact persisted `items` order -
 * never on interpretation state, timestamps, random ids, environment, locale,
 * or filesystem content. Contains only system-generated SVG elements (no
 * script, foreignObject, external references, marker ids, CSS imports, or
 * event handlers) and never embeds the source screenshot/reference image.
 * Callers must pass content already accepted by
 * `isValidVisualAnnotationContent`.
 */
export function renderVisualAnnotationOverlaySvg(source: VisualAnnotationSource, items: readonly VisualAnnotationItem[]): string {
  const width = formatNumber(source.coordinateSpace.width);
  const height = formatNumber(source.coordinateSpace.height);
  const lines = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
  for (const item of items) {
    for (const element of renderMark(item.mark)) lines.push(`  ${element}`);
  }
  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}
