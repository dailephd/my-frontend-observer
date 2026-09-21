import type { RuntimeAnnotationAssociation, VisualAnnotationIntent, VisualAnnotationItem } from '../types/visualAnnotation.js';
import type { ContractPrimitive, ContractTolerance } from '../types/contracts.js';
import { withdrawChangedConfirmation } from './confirmation.js';

export { confirmCandidate } from './confirmation.js';

/**
 * v0.9 Batch 5: pure, presentation-side model for runtime annotation intent.
 * It builds only the already-frozen runtime `VisualAnnotationIntent` from
 * explicit user choices, using the first bounded annotation mappings onto the
 * existing `ContractPrimitive` vocabulary. It never reads mark geometry to
 * decide a direction or size, never infers a target, never persists or
 * evaluates a contract, and never calls an API.
 */

export const RUNTIME_OPERATIONS = ['inspect', 'move', 'resize', 'remove', 'preserve'] as const;
export type RuntimeOperation = (typeof RUNTIME_OPERATIONS)[number];

export const MOVE_DIRECTIONS = ['right', 'left', 'down', 'up'] as const;
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

export const RESIZE_DIRECTIONS = ['wider', 'narrower', 'taller', 'shorter'] as const;
export type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number];

type DirectionalPrimitiveKind = 'property-increases' | 'property-decreases';

/** Planner-owned move mapping. */
export const MOVE_MAPPING: Record<MoveDirection, { kind: DirectionalPrimitiveKind; property: 'x' | 'y' }> = {
  right: { kind: 'property-increases', property: 'x' },
  left: { kind: 'property-decreases', property: 'x' },
  down: { kind: 'property-increases', property: 'y' },
  up: { kind: 'property-decreases', property: 'y' },
};

/** Planner-owned resize mapping. */
export const RESIZE_MAPPING: Record<ResizeDirection, { kind: DirectionalPrimitiveKind; property: 'width' | 'height' }> = {
  wider: { kind: 'property-increases', property: 'width' },
  narrower: { kind: 'property-decreases', property: 'width' },
  taller: { kind: 'property-increases', property: 'height' },
  shorter: { kind: 'property-decreases', property: 'height' },
};

type ChangeIntent = Extract<VisualAnnotationIntent, { kind: 'change' }>;

/** Exactly the four authored categories. `unexpected` is evaluator output and is never offered. */
export const RUNTIME_AUTHORED_CATEGORIES = ['requested', 'expected-dependent', 'protected', 'preserved'] as const satisfies readonly ChangeIntent['category'][];
export const RUNTIME_EXPECTED_DEPENDENT_MODES = ['required', 'permitted'] as const satisfies readonly NonNullable<ChangeIntent['expectedDependentMode']>[];
export const PRESERVE_PROPERTIES = ['x', 'y', 'width', 'height'] as const;
export type PreserveProperty = (typeof PRESERVE_PROPERTIES)[number];
/** The frontend-contract tolerance vocabulary (CSS pixels), distinct from the reference-image `absolute-reference-px`. */
export const CONTRACT_TOLERANCE_KINDS = ['exact', 'absolute-px', 'percent'] as const satisfies readonly ContractTolerance['kind'][];

export const UNBOUND_CHANGE_MESSAGE = 'Select and explicitly associate a runtime target or relationship first.';
export const REMOVE_NOT_PROMOTABLE_REASON = 'the current frontend-contract vocabulary has no target-absent primitive.';

export interface RuntimeIntentForm {
  operation: RuntimeOperation | '';
  moveDirection: MoveDirection | '';
  resizeDirection: ResizeDirection | '';
  category: string;
  expectedDependentMode: string;
  preserveProperty: PreserveProperty | '';
  toleranceKind: ContractTolerance['kind'] | '';
  toleranceAmount: string;
}

export const EMPTY_RUNTIME_INTENT_FORM: RuntimeIntentForm = {
  operation: '',
  moveDirection: '',
  resizeDirection: '',
  category: '',
  expectedDependentMode: '',
  preserveProperty: '',
  toleranceKind: '',
  toleranceAmount: '',
};

export type BuildRuntimeIntentResult = { ok: true; intent: VisualAnnotationIntent } | { ok: false; reason: string };

function buildTolerance(form: RuntimeIntentForm): { ok: true; tolerance: ContractTolerance } | { ok: false; reason: string } {
  if (form.toleranceKind === '') return { ok: false, reason: 'Choose a tolerance.' };
  if (form.toleranceKind === 'exact') return { ok: true, tolerance: { kind: 'exact' } };
  const trimmed = form.toleranceAmount.trim();
  const amount = trimmed.length === 0 ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) return { ok: false, reason: 'Tolerance amount must be a finite number from 0 to 100.' };
  return { ok: true, tolerance: { kind: form.toleranceKind, amount } };
}

/**
 * Builds the exact runtime intent for the explicit form choices and the
 * item's explicit association. Move/resize/remove need a runtime-target
 * association; preserve needs a runtime target (property) or a runtime
 * relationship; inspect needs nothing. Incompatible combinations are refused,
 * never coerced into another mapping.
 */
export function buildRuntimeIntent(form: RuntimeIntentForm, association: VisualAnnotationItem['association']): BuildRuntimeIntentResult {
  if (form.operation === '') return { ok: false, reason: 'Choose an intent operation.' };
  if (form.operation === 'inspect') return { ok: true, intent: { kind: 'inspect' } };

  if (association === undefined || (association.kind !== 'runtime-target' && association.kind !== 'runtime-relationship')) return { ok: false, reason: UNBOUND_CHANGE_MESSAGE };
  if (!(RUNTIME_AUTHORED_CATEGORIES as readonly string[]).includes(form.category)) return { ok: false, reason: 'Choose one of the authored categories: requested, expected-dependent, protected, or preserved.' };
  const category = form.category as ChangeIntent['category'];
  let modePart: { expectedDependentMode?: NonNullable<ChangeIntent['expectedDependentMode']> } = {};
  if (category === 'expected-dependent') {
    if (!(RUNTIME_EXPECTED_DEPENDENT_MODES as readonly string[]).includes(form.expectedDependentMode)) return { ok: false, reason: 'Expected-dependent intent needs a mode: required or permitted.' };
    modePart = { expectedDependentMode: form.expectedDependentMode as NonNullable<ChangeIntent['expectedDependentMode']> };
  }
  const base = { kind: 'change' as const, category, ...modePart };

  switch (form.operation) {
    case 'move': {
      if (association.kind !== 'runtime-target') return { ok: false, reason: 'Move needs an explicit runtime target association, not a relationship.' };
      if (form.moveDirection === '') return { ok: false, reason: 'Choose a move direction.' };
      const mapping = MOVE_MAPPING[form.moveDirection];
      return { ok: true, intent: { ...base, operation: 'move', contractPrimitive: { kind: mapping.kind, target: association.target, property: mapping.property } } };
    }
    case 'resize': {
      if (association.kind !== 'runtime-target') return { ok: false, reason: 'Resize needs an explicit runtime target association, not a relationship.' };
      if (form.resizeDirection === '') return { ok: false, reason: 'Choose a resize direction.' };
      const mapping = RESIZE_MAPPING[form.resizeDirection];
      return { ok: true, intent: { ...base, operation: 'resize', contractPrimitive: { kind: mapping.kind, target: association.target, property: mapping.property } } };
    }
    case 'remove':
      if (association.kind !== 'runtime-target') return { ok: false, reason: 'Remove needs an explicit runtime target association, not a relationship.' };
      return { ok: true, intent: { ...base, operation: 'remove' } };
    case 'preserve': {
      if (association.kind === 'runtime-relationship') {
        return { ok: true, intent: { ...base, operation: 'preserve', contractPrimitive: relationshipPrimitive(association) } };
      }
      if (form.preserveProperty === '') return { ok: false, reason: 'Choose the target property to preserve.' };
      const tolerance = buildTolerance(form);
      if (!tolerance.ok) return tolerance;
      return {
        ok: true,
        intent: { ...base, operation: 'preserve', contractPrimitive: { kind: 'property-unchanged-within-tolerance', target: association.target, property: form.preserveProperty, tolerance: tolerance.tolerance } },
      };
    }
  }
}

function relationshipPrimitive(association: Extract<RuntimeAnnotationAssociation, { kind: 'runtime-relationship' }>): Extract<ContractPrimitive, { kind: 'relationship-unchanged' }> {
  return {
    kind: 'relationship-unchanged',
    relationshipKind: association.relationshipKind,
    ...(association.subjectTarget !== undefined ? { subjectTarget: association.subjectTarget } : {}),
    ...(association.relatedTarget !== undefined ? { relatedTarget: association.relatedTarget } : {}),
  };
}

export function withRuntimeIntentCandidate(item: VisualAnnotationItem, intent: VisualAnnotationIntent): VisualAnnotationItem {
  return { ...item, interpretation: { state: 'candidate', intent } };
}

function withoutInterpretation(item: VisualAnnotationItem): VisualAnnotationItem {
  return { ...item, interpretation: { state: 'uninterpreted' } };
}

/**
 * Keeps a change intent's structured subject equal to the item's explicit
 * association. A target change retargets the primitive; a relationship change
 * rewrites the relationship primitive. An association that no longer fits the
 * operation (or no association at all) clears the change interpretation, so a
 * primitive can never disagree with its association.
 */
export function reconcileRuntimeIntentWithAssociation(item: VisualAnnotationItem): VisualAnnotationItem {
  const { interpretation, association } = item;
  if (interpretation.state === 'uninterpreted' || interpretation.intent.kind !== 'change') return item;
  const intent = interpretation.intent;
  const withIntent = (next: ChangeIntent): VisualAnnotationItem => ({ ...item, interpretation: { ...interpretation, intent: next } });

  if (association === undefined) return withoutInterpretation(item);
  const primitive = intent.contractPrimitive;

  if (intent.operation === 'move' || intent.operation === 'resize' || intent.operation === 'remove') {
    if (association.kind !== 'runtime-target') return withoutInterpretation(item);
    if (primitive === undefined) return item;
    if ((primitive.kind === 'property-increases' || primitive.kind === 'property-decreases') && primitive.target !== association.target) {
      return withIntent({ ...intent, contractPrimitive: { ...primitive, target: association.target } });
    }
    return item;
  }

  // preserve
  if (association.kind === 'runtime-target') {
    if (primitive?.kind !== 'property-unchanged-within-tolerance') return withoutInterpretation(item);
    return primitive.target === association.target ? item : withIntent({ ...intent, contractPrimitive: { ...primitive, target: association.target } });
  }
  if (association.kind === 'runtime-relationship') {
    if (primitive?.kind !== 'relationship-unchanged') return withoutInterpretation(item);
    return withIntent({ ...intent, contractPrimitive: relationshipPrimitive(association) });
  }
  return withoutInterpretation(item);
}

/** Applies one runtime draft edit: reconcile the primitive with the association, then withdraw a confirmation whose meaning changed. */
export function applyRuntimeItemEdit(item: VisualAnnotationItem, edit: (item: VisualAnnotationItem) => VisualAnnotationItem): VisualAnnotationItem {
  return withdrawChangedConfirmation(item, reconcileRuntimeIntentWithAssociation(edit(item)));
}

export type RuntimePromotionStatus = { promotable: true } | { promotable: false; reason: string };

/**
 * Presentation-side promotion eligibility for the runtime panel. The server's
 * canonical promotion service repeats these checks and remains authoritative.
 */
export function runtimePromotionStatus(item: VisualAnnotationItem): RuntimePromotionStatus {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted') return { promotable: false, reason: 'No interpretation.' };
  if (interpretation.state === 'candidate') return { promotable: false, reason: 'Candidate intent must be confirmed before promotion.' };
  const intent = interpretation.intent;
  if (intent.kind === 'inspect') return { promotable: false, reason: 'Inspect intent is informational and is never a contract clause.' };
  if (intent.kind !== 'change') return { promotable: false, reason: 'Not runtime change intent.' };
  if (intent.operation === 'remove') return { promotable: false, reason: `Confirmed but not canonically promotable: ${REMOVE_NOT_PROMOTABLE_REASON}` };
  if (intent.contractPrimitive === undefined) return { promotable: false, reason: 'The confirmed intent has no contract primitive.' };
  if (item.association === undefined) return { promotable: false, reason: UNBOUND_CHANGE_MESSAGE };
  const reconciled = reconcileRuntimeIntentWithAssociation(item);
  if (JSON.stringify(reconciled.interpretation) !== JSON.stringify(item.interpretation)) return { promotable: false, reason: 'The contract primitive does not match the explicit association.' };
  return { promotable: true };
}

export function describePrimitive(primitive: ContractPrimitive | undefined): string {
  if (primitive === undefined) return 'no contract primitive';
  switch (primitive.kind) {
    case 'property-increases':
    case 'property-decreases':
      return `${primitive.kind} ${primitive.target}.${primitive.property}`;
    case 'property-unchanged-within-tolerance':
      return `${primitive.kind} ${primitive.target}.${primitive.property} (${primitive.tolerance.kind === 'exact' ? 'exact' : `${primitive.tolerance.kind} ${primitive.tolerance.amount}`})`;
    case 'relationship-unchanged':
      return primitive.subjectTarget !== undefined && primitive.relatedTarget !== undefined ? `${primitive.kind} ${primitive.subjectTarget} ${primitive.relationshipKind} ${primitive.relatedTarget}` : `${primitive.kind} ${primitive.relationshipKind}`;
    default:
      return primitive.kind;
  }
}
