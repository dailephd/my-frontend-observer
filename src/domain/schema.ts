import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { EvidenceField } from './evidence.js';
import { isValidEvidenceField } from './evidence.js';
import type { Diagnostic, DiagnosticCode } from './diagnostics.js';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITY } from './diagnostics.js';
import type { CompletionState } from './completion.js';
import type { NormalizedObservationRequest } from '../request/request.js';
import { SCROLL_DELTA_MAX_ABS } from '../request/request.js';

export const ARTIFACT_KIND = 'my-frontend-observer/observation' as const;
export const SCHEMA_VERSION = '1.2.0' as const;
export const PRODUCER_NAME = 'my-frontend-observer' as const;

export type TargetLocatorKind = 'role' | 'id' | 'data-attribute' | 'semantic-element' | 'css' | 'text';
export type TargetSelectionStatus = 'matched' | 'not-found' | 'ambiguous' | 'unavailable';
export type TargetSelectionConfidence = 'exact' | 'none';
export type TargetLocatorAttemptStatus = 'not-found' | 'ambiguous' | 'matched' | 'unavailable' | 'unsupported';

export interface TargetLocatorAttempt {
  locatorIndex: number;
  locatorKind: TargetLocatorKind;
  status: TargetLocatorAttemptStatus;
  matchCount?: number;
}

export interface TargetResolution {
  selectionMethod: string;
  selectionStatus: TargetSelectionStatus;
  selectedLocatorKind?: TargetLocatorKind;
  selectedLocatorIndex?: number;
  usedFallback: boolean;
  confidence: TargetSelectionConfidence;
  attempts: TargetLocatorAttempt[];
}

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
 * Bounded first semantic-state family (Batch 3). Each key is present only
 * when the browser exposes that state as applicable to this element (native
 * form-control property or an explicit `aria-*` attribute) - an absent key
 * means "not applicable to this element", never a guessed `false`. `checked`
 * and `pressed` additionally support the browser's tri-state `'mixed'`
 * value; `current` mirrors the `aria-current` value space (`true` for the
 * bare/`"true"` form, or the specific token).
 */
export interface TargetSemanticState {
  disabled?: boolean;
  expanded?: boolean;
  checked?: boolean | 'mixed';
  selected?: boolean;
  pressed?: boolean | 'mixed';
  current?: true | 'page' | 'step' | 'location' | 'date' | 'time';
}

export const TARGET_LANDMARK_ROLES = ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'form', 'region', 'search'] as const;
export type TargetLandmarkRole = (typeof TARGET_LANDMARK_ROLES)[number];

/** Bounded configured-target-only DOM containment (Batch 3) - not a layout/relationship graph. All arrays follow configured target order and exclude the target itself. */
export interface TargetContainment {
  containedByTargetIds: string[];
  evaluatedTargetIds: string[];
  unresolvedTargetIds: string[];
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
  resolution: EvidenceField<TargetResolution>;
  tag: EvidenceField<string>;
  geometry: EvidenceField<TargetGeometry>;
  style: EvidenceField<TargetComputedStyle>;
  layout: EvidenceField<TargetLayoutMetrics>;
  visibility: EvidenceField<TargetVisibility>;
  semantics: EvidenceField<TargetSemantics>;
  semanticState: EvidenceField<TargetSemanticState>;
  landmark: EvidenceField<TargetLandmarkRole>;
  containment: EvidenceField<TargetContainment>;
}

/**
 * v0.3 Batch 1 bounded runtime scroll/overflow evidence model. Frozen here
 * as a contract; no browser capture populates it yet (Batch 2/3), so
 * `scrollScenarioEvidence` on `ObservationArtifact` stays absent for every
 * Batch-1-era observation, including one whose `requestConfig.scrollScenario`
 * is present (see `src/browser/chromiumAdapter.ts`, which fails such a
 * request honestly rather than pretending to execute it).
 */
export interface ScrollableMetrics {
  scrollTop: number;
  scrollLeft: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

/** Distinguishes an `overflow-x`/`overflow-y` CSS declaration from actual browser-observed dimensional overflow - the two are not interchangeable (see docs/CONTRACTS.md). */
export interface OverflowEvidence {
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
  overflowX: string;
  overflowY: string;
}

export interface WindowScrollSnapshot {
  scrollX: number;
  scrollY: number;
}

/** `documentElement`/`body` are omitted (not fabricated) when the browser's own scrolling/root-element representation makes them not meaningfully distinct or not observable. */
export interface DocumentScrollSnapshot {
  root: ScrollableMetrics;
  rootOverflow: OverflowEvidence;
  documentElement?: ScrollableMetrics;
  body?: ScrollableMetrics;
}

export type VerticalViewportRelation = 'above' | 'intersecting' | 'below';

/**
 * Derived only from a target's bounding rectangle plus viewport width/height
 * - never from source styles or locator kind. A hidden/non-rendered target
 * (see `TargetVisibility`/`target-hidden`) must not receive normal
 * above/below/intersecting geometry; its `viewportRelation` field on
 * `TargetScrollRuntimeState` is `not-applicable` instead (hidden is not the
 * same claim as offscreen).
 */
export interface ViewportRelationEvidence {
  vertical: VerticalViewportRelation;
  intersectsViewport: boolean;
  fullyWithinViewport: boolean;
}

/** Bounded per-configured-target runtime scroll/overflow/viewport evidence for one snapshot (initial or final). References targets by the existing stable target `name` - never a second region identity - and never copies the full `TargetEvidenceRecord`. */
export interface TargetScrollRuntimeState {
  metrics: EvidenceField<ScrollableMetrics>;
  overflow: EvidenceField<OverflowEvidence>;
  boundingRect: EvidenceField<TargetGeometry>;
  viewportRelation: EvidenceField<ViewportRelationEvidence>;
}

/** One point-in-time bounded runtime snapshot (captured either before or after the one scroll action). */
export interface ScrollRuntimeSnapshot {
  window: WindowScrollSnapshot;
  document: DocumentScrollSnapshot;
  targets: Record<string, TargetScrollRuntimeState>;
}

export interface ScrollValueChange<T> {
  before: T;
  after: T;
  changed: boolean;
}

/**
 * `enteredViewport`/`leftViewport` are only evaluated when both the initial
 * and final `viewportRelation` evidence are valid (never derived from a
 * hidden-to-visible transition, which is a separate evidence concept - see
 * docs/CONTRACTS.md).
 */
export interface TargetScrollTransition {
  scrollTop: ScrollValueChange<number>;
  scrollLeft: ScrollValueChange<number>;
  boundingRectPosition: ScrollValueChange<{ x: number; y: number }>;
  viewportRelation: ScrollValueChange<VerticalViewportRelation>;
  enteredViewport: boolean;
  leftViewport: boolean;
}

/** Bounded explicit before/after change evidence for the one scroll action in this scenario - not a generic recursive diff engine. */
export interface ScrollScenarioTransition {
  windowScrollX: ScrollValueChange<number>;
  windowScrollY: ScrollValueChange<number>;
  targets: Record<string, TargetScrollTransition>;
}

/**
 * Conservative derived interpretation of which scrolling container actually
 * moved. Never forces a winner: `none` when nothing relevant changed,
 * `indeterminate` when more than one plausible owner changed or evidence is
 * insufficient. `target` references the existing stable target `name`.
 */
export type ScrollOwnerInterpretation = { kind: 'document' } | { kind: 'target'; target: string } | { kind: 'none' } | { kind: 'indeterminate' };

/** Top-level optional v0.3 evidence family. Present only when the request configured a `scrollScenario`; absent otherwise (never fabricated as empty/zeroed evidence). */
export interface ScrollScenarioEvidence {
  initial: ScrollRuntimeSnapshot;
  final: ScrollRuntimeSnapshot;
  transition: ScrollScenarioTransition;
  /** Always `source: 'derived'` with a non-empty `derivedFrom` (enforced by `isValidEvidenceField`/`isValidObservationArtifact`) - scroll ownership is an interpretation over browser-observed facts, never itself a direct browser observation. */
  scrollOwner: EvidenceField<ScrollOwnerInterpretation>;
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
  scrollScenarioEvidence?: ScrollScenarioEvidence;
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

const TARGET_LOCATOR_KINDS: readonly TargetLocatorKind[] = ['role', 'id', 'data-attribute', 'semantic-element', 'css', 'text'];
const TARGET_SELECTION_STATUSES: readonly TargetSelectionStatus[] = ['matched', 'not-found', 'ambiguous', 'unavailable'];
const TARGET_SELECTION_CONFIDENCES: readonly TargetSelectionConfidence[] = ['exact', 'none'];
const TARGET_LOCATOR_ATTEMPT_STATUSES: readonly TargetLocatorAttemptStatus[] = ['not-found', 'ambiguous', 'matched', 'unavailable', 'unsupported'];

function isValidTargetLocatorAttempt(value: unknown): value is TargetLocatorAttempt {
  if (!isPlainObject(value)) return false;
  if (typeof value.locatorIndex !== 'number' || !Number.isInteger(value.locatorIndex) || value.locatorIndex < 0) return false;
  if (typeof value.locatorKind !== 'string' || !(TARGET_LOCATOR_KINDS as readonly string[]).includes(value.locatorKind)) return false;
  if (typeof value.status !== 'string' || !(TARGET_LOCATOR_ATTEMPT_STATUSES as readonly string[]).includes(value.status)) return false;
  if ('matchCount' in value && value.matchCount !== undefined && (typeof value.matchCount !== 'number' || !Number.isInteger(value.matchCount) || value.matchCount < 0)) {
    return false;
  }
  return true;
}

/** Structural validator for the frozen schema-1.1.0 TargetResolution contract, including the selectedLocatorKind/selectedLocatorIndex-iff-matched and usedFallback-iff-nonzero-index invariants. */
function isValidTargetResolutionValue(value: unknown): value is TargetResolution {
  if (!isPlainObject(value)) return false;
  if (typeof value.selectionMethod !== 'string') return false;
  if (typeof value.selectionStatus !== 'string' || !(TARGET_SELECTION_STATUSES as readonly string[]).includes(value.selectionStatus)) return false;
  if (typeof value.usedFallback !== 'boolean') return false;
  if (typeof value.confidence !== 'string' || !(TARGET_SELECTION_CONFIDENCES as readonly string[]).includes(value.confidence)) return false;
  if (!Array.isArray(value.attempts) || !value.attempts.every((a: unknown) => isValidTargetLocatorAttempt(a))) return false;
  for (let i = 1; i < value.attempts.length; i += 1) {
    if ((value.attempts[i] as TargetLocatorAttempt).locatorIndex <= (value.attempts[i - 1] as TargetLocatorAttempt).locatorIndex) return false;
  }

  const isMatched = value.selectionStatus === 'matched';
  const hasSelectedKind = 'selectedLocatorKind' in value && value.selectedLocatorKind !== undefined;
  const hasSelectedIndex = 'selectedLocatorIndex' in value && value.selectedLocatorIndex !== undefined;
  if (hasSelectedKind !== isMatched || hasSelectedIndex !== isMatched) return false;
  if (isMatched) {
    if (typeof value.selectedLocatorKind !== 'string' || !(TARGET_LOCATOR_KINDS as readonly string[]).includes(value.selectedLocatorKind)) return false;
    if (typeof value.selectedLocatorIndex !== 'number' || !Number.isInteger(value.selectedLocatorIndex) || value.selectedLocatorIndex < 0) return false;
    if (value.usedFallback !== value.selectedLocatorIndex > 0) return false;
  } else if (value.usedFallback) {
    return false;
  }
  return true;
}

const TARGET_CURRENT_VALUES: readonly string[] = ['page', 'step', 'location', 'date', 'time'];

/** Structural validator for TargetSemanticState: every present key must use its exact supported value vocabulary; an absent key is valid (means "not applicable"). */
function isValidTargetSemanticState(value: unknown): value is TargetSemanticState {
  if (!isPlainObject(value)) return false;
  const keys = ['disabled', 'expanded', 'checked', 'selected', 'pressed', 'current'];
  if (!Object.keys(value).every((k) => keys.includes(k))) return false;
  if ('disabled' in value && typeof value.disabled !== 'boolean') return false;
  if ('expanded' in value && typeof value.expanded !== 'boolean') return false;
  if ('checked' in value && typeof value.checked !== 'boolean' && value.checked !== 'mixed') return false;
  if ('selected' in value && typeof value.selected !== 'boolean') return false;
  if ('pressed' in value && typeof value.pressed !== 'boolean' && value.pressed !== 'mixed') return false;
  if ('current' in value && value.current !== true && !(TARGET_CURRENT_VALUES as readonly string[]).includes(value.current as string)) return false;
  return true;
}

function isValidTargetLandmarkRole(value: unknown): value is TargetLandmarkRole {
  return typeof value === 'string' && (TARGET_LANDMARK_ROLES as readonly string[]).includes(value);
}

/** Structural validator for TargetContainment: string arrays, no duplicates, and no target ID appearing in more than one of the three arrays. */
function isValidTargetContainment(value: unknown): value is TargetContainment {
  if (!isPlainObject(value)) return false;
  const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((entry) => typeof entry === 'string');
  if (!isStringArray(value.containedByTargetIds) || !isStringArray(value.evaluatedTargetIds) || !isStringArray(value.unresolvedTargetIds)) return false;
  const containedByTargetIds = value.containedByTargetIds;
  const evaluatedTargetIds = value.evaluatedTargetIds;
  const unresolvedTargetIds = value.unresolvedTargetIds;
  const noDuplicates = (arr: string[]) => new Set(arr).size === arr.length;
  if (!noDuplicates(containedByTargetIds) || !noDuplicates(evaluatedTargetIds) || !noDuplicates(unresolvedTargetIds)) return false;
  if (!containedByTargetIds.every((id) => evaluatedTargetIds.includes(id))) return false;
  if (evaluatedTargetIds.some((id) => unresolvedTargetIds.includes(id))) return false;
  return true;
}

function isValidTargetGeometryValue(value: unknown): value is TargetGeometry {
  if (!isPlainObject(value)) return false;
  return (['x', 'y', 'width', 'height', 'right', 'bottom'] as const).every((key) => typeof value[key] === 'number');
}

/** Structural validator for the requestConfig-side scrollScenario shape (defense in depth alongside src/request/request.ts#normalizeRequest's own validation). */
function isValidRequestScrollAction(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const kind = value.kind;
  const deltaOk = (d: unknown) => typeof d === 'number' && Number.isInteger(d) && Math.abs(d) <= SCROLL_DELTA_MAX_ABS;
  if (kind === 'window-scroll-by') {
    if (!deltaOk(value.deltaX) || !deltaOk(value.deltaY)) return false;
    if (value.deltaX === 0 && value.deltaY === 0) return false;
    return Object.keys(value).length === 3;
  }
  if (kind === 'target-scroll-by') {
    if (typeof value.target !== 'string' || value.target.length === 0) return false;
    if (!deltaOk(value.deltaX) || !deltaOk(value.deltaY)) return false;
    if (value.deltaX === 0 && value.deltaY === 0) return false;
    return Object.keys(value).length === 4;
  }
  return false;
}

function isValidRequestScrollScenario(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== 1) return false;
  return isValidRequestScrollAction(value.action);
}

function isValidScrollableMetrics(value: unknown): value is ScrollableMetrics {
  if (!isPlainObject(value)) return false;
  return (['scrollTop', 'scrollLeft', 'scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight'] as const).every((key) => typeof value[key] === 'number');
}

function isValidOverflowEvidence(value: unknown): value is OverflowEvidence {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.horizontalOverflow === 'boolean' &&
    typeof value.verticalOverflow === 'boolean' &&
    typeof value.overflowX === 'string' &&
    typeof value.overflowY === 'string'
  );
}

function isValidWindowScrollSnapshot(value: unknown): value is WindowScrollSnapshot {
  return isPlainObject(value) && typeof value.scrollX === 'number' && typeof value.scrollY === 'number';
}

function isValidDocumentScrollSnapshot(value: unknown): value is DocumentScrollSnapshot {
  if (!isPlainObject(value)) return false;
  if (!isValidScrollableMetrics(value.root)) return false;
  if (!isValidOverflowEvidence(value.rootOverflow)) return false;
  if ('documentElement' in value && value.documentElement !== undefined && !isValidScrollableMetrics(value.documentElement)) return false;
  if ('body' in value && value.body !== undefined && !isValidScrollableMetrics(value.body)) return false;
  return true;
}

const VERTICAL_VIEWPORT_RELATIONS: readonly VerticalViewportRelation[] = ['above', 'intersecting', 'below'];

function isValidViewportRelationEvidence(value: unknown): value is ViewportRelationEvidence {
  if (!isPlainObject(value)) return false;
  if (!(VERTICAL_VIEWPORT_RELATIONS as readonly string[]).includes(value.vertical as string)) return false;
  return typeof value.intersectsViewport === 'boolean' && typeof value.fullyWithinViewport === 'boolean';
}

/** Validates an EvidenceField's `.value` only when the field is available/partial - not applicable/unavailable fields carry no value to check. */
function isValidEvidenceFieldValue(field: unknown, validate: (value: unknown) => boolean): boolean {
  if (!isPlainObject(field)) return false;
  if (field.state === 'available' || field.state === 'partial') {
    return validate(field.value);
  }
  return true;
}

function isValidTargetScrollRuntimeState(value: unknown): value is TargetScrollRuntimeState {
  if (!isPlainObject(value)) return false;
  if (!isValidEvidenceField(value.metrics) || !isValidEvidenceFieldValue(value.metrics, isValidScrollableMetrics)) return false;
  if (!isValidEvidenceField(value.overflow) || !isValidEvidenceFieldValue(value.overflow, isValidOverflowEvidence)) return false;
  if (!isValidEvidenceField(value.boundingRect) || !isValidEvidenceFieldValue(value.boundingRect, isValidTargetGeometryValue)) return false;
  if (!isValidEvidenceField(value.viewportRelation) || !isValidEvidenceFieldValue(value.viewportRelation, isValidViewportRelationEvidence)) return false;
  return true;
}

function isValidScrollRuntimeSnapshot(value: unknown): value is ScrollRuntimeSnapshot {
  if (!isPlainObject(value)) return false;
  if (!isValidWindowScrollSnapshot(value.window)) return false;
  if (!isValidDocumentScrollSnapshot(value.document)) return false;
  if (!isPlainObject(value.targets)) return false;
  return Object.values(value.targets).every((target) => isValidTargetScrollRuntimeState(target));
}

function isValidScrollValueChange(value: unknown, validateInner: (v: unknown) => boolean): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.changed !== 'boolean') return false;
  return validateInner(value.before) && validateInner(value.after);
}

function isValidTargetScrollTransition(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isValidScrollValueChange(value.scrollTop, (v) => typeof v === 'number')) return false;
  if (!isValidScrollValueChange(value.scrollLeft, (v) => typeof v === 'number')) return false;
  if (!isValidScrollValueChange(value.boundingRectPosition, (v) => isPlainObject(v) && typeof v.x === 'number' && typeof v.y === 'number')) return false;
  if (!isValidScrollValueChange(value.viewportRelation, (v) => (VERTICAL_VIEWPORT_RELATIONS as readonly string[]).includes(v as string))) return false;
  if (typeof value.enteredViewport !== 'boolean' || typeof value.leftViewport !== 'boolean') return false;
  if (value.enteredViewport && value.leftViewport) return false;
  return true;
}

function isValidScrollScenarioTransition(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isValidScrollValueChange(value.windowScrollX, (v) => typeof v === 'number')) return false;
  if (!isValidScrollValueChange(value.windowScrollY, (v) => typeof v === 'number')) return false;
  if (!isPlainObject(value.targets)) return false;
  return Object.values(value.targets).every((target) => isValidTargetScrollTransition(target));
}

const SCROLL_OWNER_KINDS = ['document', 'target', 'none', 'indeterminate'] as const;

function isValidScrollOwnerInterpretation(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const kind = value.kind;
  if (!(SCROLL_OWNER_KINDS as readonly string[]).includes(kind as string)) return false;
  if (kind === 'target') return typeof value.target === 'string' && value.target.length > 0 && Object.keys(value).length === 2;
  return Object.keys(value).length === 1;
}

/** Structural validator for ScrollScenarioEvidence, including the scroll-owner derived-provenance requirement (source must be 'derived', enforced alongside isValidEvidenceField's existing derivedFrom-iff-derived-source invariant). */
function isValidScrollScenarioEvidence(value: unknown): value is ScrollScenarioEvidence {
  if (!isPlainObject(value)) return false;
  if (!isValidScrollRuntimeSnapshot(value.initial)) return false;
  if (!isValidScrollRuntimeSnapshot(value.final)) return false;
  if (!isValidScrollScenarioTransition(value.transition)) return false;
  if (!isValidEvidenceField(value.scrollOwner)) return false;
  const scrollOwnerField = value.scrollOwner as Record<string, unknown>;
  if (scrollOwnerField.state === 'available' || scrollOwnerField.state === 'partial') {
    if (scrollOwnerField.source !== 'derived') return false;
    if (!isValidScrollOwnerInterpretation(scrollOwnerField.value)) return false;
  }
  return true;
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

/** Structural validator for the frozen schema-1.2.0 ObservationArtifact contract. Treats `value` as arbitrary/unknown input. */
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
      !isValidEvidenceField(target.semantics) ||
      !isValidEvidenceField(target.semanticState) ||
      !isValidEvidenceField(target.landmark) ||
      !isValidEvidenceField(target.containment)
    ) {
      return {
        valid: false,
        reason:
          'targetEvidence entries must have valid resolution/tag/geometry/style/layout/visibility/semantics/semanticState/landmark/containment evidence fields',
      };
    }
    const resolutionField = target.resolution as Record<string, unknown>;
    if (resolutionField.state === 'available' || resolutionField.state === 'partial') {
      if (!isValidTargetResolutionValue(resolutionField.value)) {
        return { valid: false, reason: 'targetEvidence resolution value must be a valid TargetResolution' };
      }
    }
    const semanticStateField = target.semanticState as Record<string, unknown>;
    if (semanticStateField.state === 'available' || semanticStateField.state === 'partial') {
      if (!isValidTargetSemanticState(semanticStateField.value)) {
        return { valid: false, reason: 'targetEvidence semanticState value must be a valid TargetSemanticState' };
      }
    }
    const landmarkField = target.landmark as Record<string, unknown>;
    if (landmarkField.state === 'available' || landmarkField.state === 'partial') {
      if (!isValidTargetLandmarkRole(landmarkField.value)) {
        return { valid: false, reason: 'targetEvidence landmark value must be a recognized landmark role' };
      }
    }
    const containmentField = target.containment as Record<string, unknown>;
    if (containmentField.state === 'available' || containmentField.state === 'partial') {
      if (!isValidTargetContainment(containmentField.value)) {
        return { valid: false, reason: 'targetEvidence containment value must be a valid TargetContainment' };
      }
    }
  }
  if (isPlainObject(value.requestConfig) && 'scrollScenario' in value.requestConfig && value.requestConfig.scrollScenario !== undefined) {
    if (!isValidRequestScrollScenario(value.requestConfig.scrollScenario)) {
      return { valid: false, reason: 'requestConfig.scrollScenario is invalid' };
    }
  }
  if ('scrollScenarioEvidence' in value && value.scrollScenarioEvidence !== undefined) {
    if (!isValidScrollScenarioEvidence(value.scrollScenarioEvidence)) {
      return { valid: false, reason: 'scrollScenarioEvidence is invalid' };
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
