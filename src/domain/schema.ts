import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { EvidenceField } from './evidence.js';
import { isValidEvidenceField } from './evidence.js';
import type { Diagnostic, DiagnosticCode } from './diagnostics.js';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITY } from './diagnostics.js';
import type { CompletionState } from './completion.js';
import type { NormalizedObservationRequest } from '../request/request.js';

export const ARTIFACT_KIND = 'my-frontend-observer/observation' as const;
export const SCHEMA_VERSION = '1.0.0' as const;
export const PRODUCER_NAME = 'my-frontend-observer' as const;

export interface ArtifactReference {
  path: string;
  kind: string;
}

export interface TargetGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface TargetComputedStyle {
  display: string;
  position: string;
  overflowX: string;
  overflowY: string;
}

export interface TargetLayoutMetrics {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  scrollTop: number;
  scrollLeft: number;
}

export interface TargetVisibility {
  visible: boolean;
}

export interface TargetSemantics {
  role?: string;
  name?: string;
}

/**
 * Batch 1 froze the wrapper (EvidenceField<T>) and the category names
 * (resolution/geometry/style) but deliberately left geometry/style typed
 * `unknown`, deferring the concrete rendered-evidence shapes to whichever
 * batch actually captures them. Batch 3 fills that in and adds the
 * remaining v0.1 target-evidence categories (tag/layout/visibility/
 * semantics) additively: nothing in the repository constructs a
 * TargetEvidenceRecord yet (only `{}` empty records exist in tests), so no
 * existing caller loses a field.
 */
export interface TargetEvidenceRecord {
  resolution: EvidenceField<{ selectionMethod: string; selectionStatus: string }>;
  tag: EvidenceField<string>;
  geometry: EvidenceField<TargetGeometry>;
  style: EvidenceField<TargetComputedStyle>;
  layout: EvidenceField<TargetLayoutMetrics>;
  visibility: EvidenceField<TargetVisibility>;
  semantics: EvidenceField<TargetSemantics>;
}

export interface ObservationArtifact {
  artifactKind: typeof ARTIFACT_KIND;
  schemaVersion: typeof SCHEMA_VERSION;
  observationId: string;
  requestId: string;
  producer: { name: typeof PRODUCER_NAME; version: string };
  browser: EvidenceField<{ engine: string; version: string }>;
  requestConfig: NormalizedObservationRequest;
  provenance: { capturedAt: string; observationMethod: string };
  pageEvidence: Record<string, EvidenceField<unknown>>;
  targetEvidence: Record<string, TargetEvidenceRecord>;
  screenshot: EvidenceField<{ path: string }>;
  completion: CompletionState;
  diagnostics: Diagnostic[];
  limits: { truncated: boolean; omittedFields: string[]; omittedTargets: string[] };
  artifactReferences: ArtifactReference[];
}

export type SchemaValidationResult = { valid: true } | { valid: false; reason: string };

function readPackageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.join(here, '..', '..', 'package.json');
  const raw = readFileSync(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('package.json is missing a string "version" field');
  }
  return parsed.version;
}

/**
 * producer.version is read independently from package.json; it is never
 * equal to schemaVersion by construction - the two are different fields with
 * unrelated value spaces.
 */
export function getProducerInfo(): { name: typeof PRODUCER_NAME; version: string } {
  return { name: PRODUCER_NAME, version: readPackageVersion() };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDiagnostic(value: unknown): value is Diagnostic {
  if (!isPlainObject(value)) return false;
  const code = value.code;
  if (typeof code !== 'string' || !(DIAGNOSTIC_CODES as readonly string[]).includes(code)) return false;
  const expectedSeverity = DIAGNOSTIC_SEVERITY[code as DiagnosticCode];
  if (value.severity !== expectedSeverity) return false;
  if (typeof value.message !== 'string') return false;
  if ('targetName' in value && value.targetName !== undefined && typeof value.targetName !== 'string') return false;
  return true;
}

function isValidCompletionState(value: unknown): value is CompletionState {
  if (!isPlainObject(value)) return false;
  const state = value.state;
  if (state === 'complete') {
    if (!('diagnostics' in value) || value.diagnostics === undefined) return true;
    return Array.isArray(value.diagnostics) && value.diagnostics.length === 0;
  }
  if (state === 'partial' || state === 'warning' || state === 'invalid-request' || state === 'fatal') {
    return Array.isArray(value.diagnostics) && value.diagnostics.every((d: unknown) => isValidDiagnostic(d));
  }
  return false;
}

/** Structural validator for the frozen schema-1.0.0 ObservationArtifact contract. Treats `value` as arbitrary/unknown input. */
export function isValidObservationArtifact(value: unknown): SchemaValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'artifact must be an object' };
  if (value.artifactKind !== ARTIFACT_KIND) return { valid: false, reason: 'artifactKind mismatch' };
  if (value.schemaVersion !== SCHEMA_VERSION) return { valid: false, reason: 'schemaVersion mismatch' };
  if (typeof value.observationId !== 'string' || value.observationId.length === 0) {
    return { valid: false, reason: 'observationId must be a non-empty string' };
  }
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    return { valid: false, reason: 'requestId must be a non-empty string' };
  }
  if (
    !isPlainObject(value.producer) ||
    value.producer.name !== PRODUCER_NAME ||
    typeof value.producer.version !== 'string' ||
    value.producer.version.length === 0
  ) {
    return { valid: false, reason: 'producer must be { name: "my-frontend-observer", version: string }' };
  }
  if (!isValidEvidenceField(value.browser)) return { valid: false, reason: 'browser evidence field is invalid' };
  if (!isPlainObject(value.pageEvidence) || !Object.values(value.pageEvidence).every((v) => isValidEvidenceField(v))) {
    return { valid: false, reason: 'pageEvidence entries must be valid evidence fields' };
  }
  if (!isPlainObject(value.targetEvidence)) return { valid: false, reason: 'targetEvidence must be an object' };
  for (const target of Object.values(value.targetEvidence)) {
    if (
      !isPlainObject(target) ||
      !isValidEvidenceField(target.resolution) ||
      !isValidEvidenceField(target.tag) ||
      !isValidEvidenceField(target.geometry) ||
      !isValidEvidenceField(target.style) ||
      !isValidEvidenceField(target.layout) ||
      !isValidEvidenceField(target.visibility) ||
      !isValidEvidenceField(target.semantics)
    ) {
      return {
        valid: false,
        reason: 'targetEvidence entries must have valid resolution/tag/geometry/style/layout/visibility/semantics evidence fields',
      };
    }
  }
  if (!isValidEvidenceField(value.screenshot)) return { valid: false, reason: 'screenshot evidence field is invalid' };
  if (!isValidCompletionState(value.completion)) return { valid: false, reason: 'completion state is invalid' };
  if (!Array.isArray(value.diagnostics) || !value.diagnostics.every((d: unknown) => isValidDiagnostic(d))) {
    return { valid: false, reason: 'diagnostics must be an array of valid Diagnostic values' };
  }
  if (isPlainObject(value.completion) && value.completion.state === 'complete' && value.diagnostics.length > 0) {
    return { valid: false, reason: 'completion "complete" requires an empty diagnostics array' };
  }
  const limits = value.limits;
  if (
    !isPlainObject(limits) ||
    typeof limits.truncated !== 'boolean' ||
    !Array.isArray(limits.omittedFields) ||
    !limits.omittedFields.every((f: unknown) => typeof f === 'string') ||
    !Array.isArray(limits.omittedTargets) ||
    !limits.omittedTargets.every((f: unknown) => typeof f === 'string')
  ) {
    return { valid: false, reason: 'limits must be { truncated: boolean; omittedFields: string[]; omittedTargets: string[] }' };
  }
  if (
    !Array.isArray(value.artifactReferences) ||
    !value.artifactReferences.every((r: unknown) => isPlainObject(r) && typeof r.path === 'string' && typeof r.kind === 'string')
  ) {
    return { valid: false, reason: 'artifactReferences must be an array of { path: string; kind: string }' };
  }
  return { valid: true };
}
