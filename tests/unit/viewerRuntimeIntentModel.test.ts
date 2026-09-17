import { describe, expect, it } from 'vitest';
import {
  EMPTY_RUNTIME_INTENT_FORM,
  MOVE_MAPPING,
  RESIZE_MAPPING,
  RUNTIME_AUTHORED_CATEGORIES,
  RUNTIME_OPERATIONS,
  UNBOUND_CHANGE_MESSAGE,
  applyRuntimeItemEdit,
  buildRuntimeIntent,
  confirmCandidate,
  describePrimitive,
  reconcileRuntimeIntentWithAssociation,
  runtimePromotionStatus,
  withRuntimeIntentCandidate,
} from '../../viewer/src/annotation/runtimeIntent.js';
import type { RuntimeIntentForm } from '../../viewer/src/annotation/runtimeIntent.js';
import { isValidVisualAnnotationContent } from '../../src/domain/visualAnnotation.js';
import { SCHEMA_VERSION } from '../../src/domain/schema.js';
import type { VisualAnnotationItem, VisualAnnotationSource } from '../../src/domain/visualAnnotation.js';

const SOURCE: VisualAnnotationSource = {
  kind: 'runtime-observation',
  observationId: 'obs-1',
  requestId: 'req-1',
  observationSchemaVersion: SCHEMA_VERSION,
  screenshot: { path: 'screenshot.png' },
  coordinateSpace: { kind: 'runtime-css-px', width: 800, height: 600 },
};

const TARGET = { kind: 'runtime-target' as const, target: 'workspace' };
const PAIRWISE = { kind: 'runtime-relationship' as const, relationshipKind: 'above' as const, subjectTarget: 'header', relatedTarget: 'footer' };
const PAGE_LEVEL = { kind: 'runtime-relationship' as const, relationshipKind: 'document-width-fits-viewport' as const };

function form(overrides: Partial<RuntimeIntentForm>): RuntimeIntentForm {
  return { ...EMPTY_RUNTIME_INTENT_FORM, ...overrides };
}

function arrowRight(association?: VisualAnnotationItem['association']): VisualAnnotationItem {
  return { annotationItemId: 'arrow-1', mark: { kind: 'arrow', start: { x: 10, y: 100 }, end: { x: 400, y: 100 } }, ...(association === undefined ? {} : { association }), interpretation: { state: 'uninterpreted' } };
}

function built(f: RuntimeIntentForm, association: VisualAnnotationItem['association']) {
  const result = buildRuntimeIntent(f, association);
  if (!result.ok) throw new Error(result.reason);
  return result.intent;
}

describe('runtime intent vocabulary', () => {
  it('offers exactly the frozen operations and the four authored categories, never unexpected', () => {
    expect(RUNTIME_OPERATIONS).toEqual(['inspect', 'move', 'resize', 'remove', 'preserve']);
    expect(RUNTIME_AUTHORED_CATEGORIES).toEqual(['requested', 'expected-dependent', 'protected', 'preserved']);
    expect(RUNTIME_AUTHORED_CATEGORIES as readonly string[]).not.toContain('unexpected');
    const refused = buildRuntimeIntent(form({ operation: 'move', moveDirection: 'right', category: 'unexpected' }), TARGET);
    expect(refused.ok).toBe(false);
  });
});

describe('move and resize mappings', () => {
  it('maps every move direction to the planner-owned primitive on the associated target', () => {
    expect(MOVE_MAPPING).toEqual({
      right: { kind: 'property-increases', property: 'x' },
      left: { kind: 'property-decreases', property: 'x' },
      down: { kind: 'property-increases', property: 'y' },
      up: { kind: 'property-decreases', property: 'y' },
    });
    for (const [direction, mapping] of Object.entries(MOVE_MAPPING)) {
      expect(built(form({ operation: 'move', moveDirection: direction as RuntimeIntentForm['moveDirection'], category: 'requested' }), TARGET)).toEqual({
        kind: 'change',
        operation: 'move',
        category: 'requested',
        contractPrimitive: { kind: mapping.kind, target: 'workspace', property: mapping.property },
      });
    }
  });

  it('maps every resize direction to the planner-owned primitive with no minimum delta', () => {
    expect(RESIZE_MAPPING).toEqual({
      wider: { kind: 'property-increases', property: 'width' },
      narrower: { kind: 'property-decreases', property: 'width' },
      taller: { kind: 'property-increases', property: 'height' },
      shorter: { kind: 'property-decreases', property: 'height' },
    });
    for (const [direction, mapping] of Object.entries(RESIZE_MAPPING)) {
      const intent = built(form({ operation: 'resize', resizeDirection: direction as RuntimeIntentForm['resizeDirection'], category: 'protected' }), TARGET);
      expect(intent).toEqual({ kind: 'change', operation: 'resize', category: 'protected', contractPrimitive: { kind: mapping.kind, target: 'workspace', property: mapping.property } });
    }
  });

  it('never reads mark geometry: an arrow pointing right with explicit move left maps to property-decreases x', () => {
    const item = arrowRight(TARGET);
    const intent = built(form({ operation: 'move', moveDirection: 'left', category: 'requested' }), item.association);
    expect(intent).toMatchObject({ contractPrimitive: { kind: 'property-decreases', property: 'x' } });
    expect(arrowRight().interpretation).toEqual({ state: 'uninterpreted' });
  });
});

describe('preserve, remove, and inspect', () => {
  it('builds property-unchanged-within-tolerance for a target with the contract tolerance vocabulary', () => {
    expect(built(form({ operation: 'preserve', category: 'preserved', preserveProperty: 'width', toleranceKind: 'absolute-px', toleranceAmount: '2' }), { kind: 'runtime-target', target: 'sidebar' })).toEqual({
      kind: 'change',
      operation: 'preserve',
      category: 'preserved',
      contractPrimitive: { kind: 'property-unchanged-within-tolerance', target: 'sidebar', property: 'width', tolerance: { kind: 'absolute-px', amount: 2 } },
    });
    expect(buildRuntimeIntent(form({ operation: 'preserve', category: 'preserved', preserveProperty: 'width', toleranceKind: 'percent', toleranceAmount: '101' }), TARGET).ok).toBe(false);
    expect(buildRuntimeIntent(form({ operation: 'preserve', category: 'preserved', preserveProperty: 'width' }), TARGET).ok).toBe(false);
  });

  it('builds relationship-unchanged from pairwise and page-level relationship associations without inventing targets', () => {
    expect(built(form({ operation: 'preserve', category: 'protected' }), PAIRWISE)).toEqual({
      kind: 'change',
      operation: 'preserve',
      category: 'protected',
      contractPrimitive: { kind: 'relationship-unchanged', relationshipKind: 'above', subjectTarget: 'header', relatedTarget: 'footer' },
    });
    const page = built(form({ operation: 'preserve', category: 'protected' }), PAGE_LEVEL);
    expect(page).toEqual({ kind: 'change', operation: 'preserve', category: 'protected', contractPrimitive: { kind: 'relationship-unchanged', relationshipKind: 'document-width-fits-viewport' } });
  });

  it('builds remove without any contract primitive and inspect with no subject', () => {
    expect(built(form({ operation: 'remove', category: 'requested' }), TARGET)).toEqual({ kind: 'change', operation: 'remove', category: 'requested' });
    expect(built(form({ operation: 'inspect' }), undefined)).toEqual({ kind: 'inspect' });
  });

  it('enforces the expected-dependent mode rule', () => {
    expect(buildRuntimeIntent(form({ operation: 'move', moveDirection: 'up', category: 'expected-dependent' }), TARGET)).toMatchObject({ ok: false });
    expect(built(form({ operation: 'move', moveDirection: 'up', category: 'expected-dependent', expectedDependentMode: 'permitted' }), TARGET)).toMatchObject({ expectedDependentMode: 'permitted' });
    expect('expectedDependentMode' in built(form({ operation: 'move', moveDirection: 'up', category: 'requested', expectedDependentMode: 'permitted' }), TARGET)).toBe(false);
  });

  it('refuses unbound change intent and incompatible association/operation combinations', () => {
    for (const operation of ['move', 'resize', 'remove', 'preserve'] as const) {
      expect(buildRuntimeIntent(form({ operation, moveDirection: 'right', resizeDirection: 'wider', category: 'requested', preserveProperty: 'x', toleranceKind: 'exact' }), undefined)).toEqual({ ok: false, reason: UNBOUND_CHANGE_MESSAGE });
    }
    for (const operation of ['move', 'resize', 'remove'] as const) {
      expect(buildRuntimeIntent(form({ operation, moveDirection: 'right', resizeDirection: 'wider', category: 'requested' }), PAIRWISE).ok).toBe(false);
    }
    expect(buildRuntimeIntent(form({ operation: 'move', moveDirection: 'right', category: 'requested' }), { kind: 'reference-region', regionId: 'hero' }).ok).toBe(false);
  });

  it('produces items the canonical annotation validator accepts', () => {
    const items: VisualAnnotationItem[] = [
      withRuntimeIntentCandidate(arrowRight(TARGET), built(form({ operation: 'move', moveDirection: 'right', category: 'requested' }), TARGET)),
      { ...withRuntimeIntentCandidate(arrowRight(PAIRWISE), built(form({ operation: 'preserve', category: 'protected' }), PAIRWISE)), annotationItemId: 'b' },
      { ...confirmCandidate(withRuntimeIntentCandidate(arrowRight(TARGET), built(form({ operation: 'remove', category: 'requested' }), TARGET)), 'at'), annotationItemId: 'c' },
    ];
    expect(isValidVisualAnnotationContent(SOURCE, items)).toEqual({ valid: true });
  });
});

describe('association reconciliation and confirmation invalidation', () => {
  const moveRight = () => withRuntimeIntentCandidate(arrowRight(TARGET), built(form({ operation: 'move', moveDirection: 'right', category: 'requested' }), TARGET));

  it('retargets the primitive and withdraws confirmation when the associated target changes', () => {
    const confirmed = confirmCandidate(moveRight(), '2026-09-17T00:00:00.000Z');
    const retargeted = applyRuntimeItemEdit(confirmed, (item) => ({ ...item, association: { kind: 'runtime-target', target: 'sidebar' } }));
    expect(retargeted.interpretation).toEqual({ state: 'candidate', intent: { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'sidebar', property: 'x' } } });
  });

  it('rewrites a relationship primitive from a changed relationship association', () => {
    const preserve = confirmCandidate(withRuntimeIntentCandidate(arrowRight(PAIRWISE), built(form({ operation: 'preserve', category: 'protected' }), PAIRWISE)), 'at');
    const changed = applyRuntimeItemEdit(preserve, (item) => ({ ...item, association: PAGE_LEVEL }));
    expect(changed.interpretation).toEqual({ state: 'candidate', intent: { kind: 'change', operation: 'preserve', category: 'protected', contractPrimitive: { kind: 'relationship-unchanged', relationshipKind: 'document-width-fits-viewport' } } });
  });

  it('clears an incompatible or unbound change interpretation instead of coercing it', () => {
    expect(reconcileRuntimeIntentWithAssociation({ ...confirmCandidate(moveRight(), 'at'), association: PAIRWISE }).interpretation).toEqual({ state: 'uninterpreted' });
    const { association: _removed, ...unbound } = confirmCandidate(moveRight(), 'at');
    void _removed;
    expect(reconcileRuntimeIntentWithAssociation(unbound).interpretation).toEqual({ state: 'uninterpreted' });
    const preserveProperty = withRuntimeIntentCandidate(arrowRight(TARGET), built(form({ operation: 'preserve', category: 'preserved', preserveProperty: 'x', toleranceKind: 'exact' }), TARGET));
    expect(reconcileRuntimeIntentWithAssociation({ ...preserveProperty, association: PAIRWISE }).interpretation).toEqual({ state: 'uninterpreted' });
  });

  it('withdraws confirmation on a mark move or intent change and keeps it on a no-op edit', () => {
    const confirmed = confirmCandidate(moveRight(), 'at');
    expect(applyRuntimeItemEdit(confirmed, (item) => ({ ...item, mark: { kind: 'arrow', start: { x: 20, y: 100 }, end: { x: 410, y: 100 } } })).interpretation.state).toBe('candidate');
    expect(applyRuntimeItemEdit(confirmed, (item) => withRuntimeIntentCandidate(item, built(form({ operation: 'move', moveDirection: 'left', category: 'requested' }), TARGET))).interpretation.state).toBe('candidate');
    expect(applyRuntimeItemEdit(confirmed, (item) => ({ ...item })).interpretation).toEqual(confirmed.interpretation);
    const note: VisualAnnotationItem = confirmCandidate({ ...moveRight(), mark: { kind: 'note', anchor: { x: 1, y: 1 }, text: 'a' } }, 'at');
    expect(applyRuntimeItemEdit(note, (item) => (item.mark.kind === 'note' ? { ...item, mark: { ...item.mark, text: 'b' } } : item)).interpretation.state).toBe('candidate');
  });

  it('reports promotion eligibility for confirmed move/resize/preserve only', () => {
    expect(runtimePromotionStatus(moveRight())).toMatchObject({ promotable: false });
    expect(runtimePromotionStatus(confirmCandidate(moveRight(), 'at'))).toEqual({ promotable: true });
    const remove = confirmCandidate(withRuntimeIntentCandidate(arrowRight(TARGET), built(form({ operation: 'remove', category: 'requested' }), TARGET)), 'at');
    expect(runtimePromotionStatus(remove)).toEqual({ promotable: false, reason: 'Confirmed but not canonically promotable: the current frontend-contract vocabulary has no target-absent primitive.' });
    expect(runtimePromotionStatus(confirmCandidate(withRuntimeIntentCandidate(arrowRight(), { kind: 'inspect' }), 'at'))).toMatchObject({ promotable: false });
    const mismatched: VisualAnnotationItem = { ...confirmCandidate(moveRight(), 'at'), association: { kind: 'runtime-target', target: 'other' } };
    expect(runtimePromotionStatus(mismatched)).toMatchObject({ promotable: false });
    expect(describePrimitive({ kind: 'property-increases', target: 'workspace', property: 'x' })).toBe('property-increases workspace.x');
  });
});
