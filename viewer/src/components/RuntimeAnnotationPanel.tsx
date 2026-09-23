import { useEffect, useState } from 'react';
import type { LayoutRelationshipGraph } from '../types/observation.js';
import type { RuntimeAnnotationAssociation, VisualAnnotationItem } from '../types/visualAnnotation.js';
import type { AuthoringSessionState } from '../hooks/useAuthoringSession.js';
import type { RuntimeAnnotationsState } from '../hooks/useRuntimeAnnotations.js';
import type { RuntimeAnnotationDraft } from '../hooks/useRuntimeAnnotationDraft.js';
import { ANNOTATION_NOTE_MAX_LENGTH } from '../annotation/annotationGeometry.js';
import { AnnotationSessionNotice, DraftLifecycleSection, SavedAnnotationList } from './AnnotationPanelSections.js';
import type { ContractPromotionState } from '../hooks/useAnnotationContractPromotion.js';
import type { RuntimeVisualChangeStartState } from '../hooks/useRuntimeVisualChangeStart.js';
import {
  CONTRACT_TOLERANCE_KINDS,
  EMPTY_RUNTIME_INTENT_FORM,
  MOVE_DIRECTIONS,
  PRESERVE_PROPERTIES,
  REMOVE_NOT_PROMOTABLE_REASON,
  RESIZE_DIRECTIONS,
  RUNTIME_AUTHORED_CATEGORIES,
  RUNTIME_EXPECTED_DEPENDENT_MODES,
  RUNTIME_OPERATIONS,
  buildRuntimeIntent,
  describePrimitive,
  runtimePromotionStatus,
  withRuntimeIntentCandidate,
} from '../annotation/runtimeIntent.js';
import type { RuntimeIntentForm } from '../annotation/runtimeIntent.js';

function promotionDisplay(item: VisualAnnotationItem): string {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted') return 'Promotion: no intent';
  const intent = interpretation.intent;
  if (intent.kind === 'inspect') return 'Promotion: informational only, never a contract clause';
  if (intent.kind !== 'change') return 'Promotion: not runtime change intent';
  if (intent.operation === 'remove') {
    return interpretation.state === 'confirmed' ? `Confirmed but not canonically promotable: ${REMOVE_NOT_PROMOTABLE_REASON}` : `Not canonically promotable: ${REMOVE_NOT_PROMOTABLE_REASON}`;
  }
  if (interpretation.state === 'candidate') return 'Promotion: requires explicit confirmation first';
  const status = runtimePromotionStatus(item);
  return status.promotable ? 'Promotion: canonically promotable' : `Promotion: ${status.reason}`;
}

function RuntimeIntentSection({ item, onUpdate, onConfirm }: { item: VisualAnnotationItem; onUpdate: (update: (item: VisualAnnotationItem) => VisualAnnotationItem) => void; onConfirm: () => void }) {
  const [form, setForm] = useState<RuntimeIntentForm>(EMPTY_RUNTIME_INTENT_FORM);
  useEffect(() => {
    setForm(EMPTY_RUNTIME_INTENT_FORM);
  }, [item.annotationItemId]);
  const built = buildRuntimeIntent(form, item.association);
  function setField<K extends keyof RuntimeIntentForm>(key: K, value: RuntimeIntentForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }
  const needsCategory = form.operation !== '' && form.operation !== 'inspect';

  return (
    <fieldset className="annotation-panel__group">
      <legend>Runtime intent</legend>
      <div className="annotation-panel__requirement-form">
        <label>
          Operation
          <select aria-label="Runtime intent operation" value={form.operation} onChange={(e) => setField('operation', e.target.value as RuntimeIntentForm['operation'])}>
            <option value="">Choose…</option>
            {RUNTIME_OPERATIONS.map((operation) => (
              <option key={operation} value={operation}>
                {operation}
              </option>
            ))}
          </select>
        </label>
        {form.operation === 'move' ? (
          <label>
            Direction
            <select aria-label="Move direction" value={form.moveDirection} onChange={(e) => setField('moveDirection', e.target.value as RuntimeIntentForm['moveDirection'])}>
              <option value="">Choose…</option>
              {MOVE_DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {direction}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {form.operation === 'resize' ? (
          <label>
            Direction
            <select aria-label="Resize direction" value={form.resizeDirection} onChange={(e) => setField('resizeDirection', e.target.value as RuntimeIntentForm['resizeDirection'])}>
              <option value="">Choose…</option>
              {RESIZE_DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {direction}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {needsCategory ? (
          <label>
            Category
            <select aria-label="Intent category" value={form.category} onChange={(e) => setField('category', e.target.value)}>
              <option value="">Choose…</option>
              {RUNTIME_AUTHORED_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {needsCategory && form.category === 'expected-dependent' ? (
          <label>
            Mode
            <select aria-label="Intent expected-dependent mode" value={form.expectedDependentMode} onChange={(e) => setField('expectedDependentMode', e.target.value)}>
              <option value="">Choose…</option>
              {RUNTIME_EXPECTED_DEPENDENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {form.operation === 'preserve' && item.association?.kind === 'runtime-target' ? (
          <>
            <label>
              Property
              <select aria-label="Preserved property" value={form.preserveProperty} onChange={(e) => setField('preserveProperty', e.target.value as RuntimeIntentForm['preserveProperty'])}>
                <option value="">Choose…</option>
                {PRESERVE_PROPERTIES.map((property) => (
                  <option key={property} value={property}>
                    {property}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tolerance
              <select aria-label="Contract tolerance" value={form.toleranceKind} onChange={(e) => setField('toleranceKind', e.target.value as RuntimeIntentForm['toleranceKind'])}>
                <option value="">Choose…</option>
                {CONTRACT_TOLERANCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === 'absolute-px' ? 'absolute-px (runtime CSS pixels)' : kind}
                  </option>
                ))}
              </select>
            </label>
            {form.toleranceKind === 'absolute-px' || form.toleranceKind === 'percent' ? (
              <label>
                Amount
                <input aria-label="Contract tolerance amount" type="number" min={0} max={100} step="any" value={form.toleranceAmount} onChange={(e) => setField('toleranceAmount', e.target.value)} />
              </label>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          disabled={!built.ok}
          onClick={() => {
            if (built.ok) onUpdate((current) => withRuntimeIntentCandidate(current, built.intent));
          }}
        >
          Set candidate intent
        </button>
        {built.ok ? null : <span className="annotation-panel__hint">{built.reason}</span>}
      </div>
      <p className="annotation-panel__promotion-status" data-promotion-status="true">
        {promotionDisplay(item)}
      </p>
      <button type="button" disabled={item.interpretation.state !== 'candidate'} onClick={onConfirm}>
        Confirm runtime intent
      </button>
    </fieldset>
  );
}

function RuntimeContractPromotionSection({
  draft,
  promotion,
  onPromote,
  visualChangeStart,
  onCreateVisualChange,
}: {
  draft: RuntimeAnnotationDraft;
  promotion: ContractPromotionState;
  onPromote: (itemIds: string[], activateForCheck: boolean) => void;
  visualChangeStart: RuntimeVisualChangeStartState;
  onCreateVisualChange: (itemIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activate, setActivate] = useState(false);
  useEffect(() => {
    setSelectedIds([]);
    setActivate(false);
  }, [draft.parentAnnotationHandle]);
  // A successful promotion clears the selection, so the same items are never promoted again by accident.
  const promotedContractId = promotion.state === 'promoted' ? promotion.contractId : undefined;
  useEffect(() => {
    if (promotedContractId !== undefined) setSelectedIds([]);
  }, [promotedContractId]);

  const saved = draft.parentAnnotationHandle !== undefined && !draft.dirty;
  const changeItems = draft.items.filter((item) => item.interpretation.state === 'confirmed' && item.interpretation.intent.kind === 'change');
  const promotableIds = new Set(changeItems.filter((item) => runtimePromotionStatus(item).promotable).map((item) => item.annotationItemId));
  const effectiveSelection = selectedIds.filter((id) => promotableIds.has(id));
  const mutationPending = promotion.state === 'promoting' || visualChangeStart.state === 'starting';
  const canPromote = saved && effectiveSelection.length > 0 && !mutationPending;

  return (
    <div className="annotation-panel__promotion">
      <h4>Confirmed contract intent</h4>
      {!saved ? (
        <p className="annotation-panel__hint" data-promotion-blocked="true">
          Save the annotation before promoting contract intent.
        </p>
      ) : changeItems.length === 0 ? (
        <p className="placeholder-note">No confirmed runtime change intent in this saved annotation.</p>
      ) : (
        <ul className="annotation-panel__proposal-list">
          {changeItems.map((item) => {
            const status = runtimePromotionStatus(item);
            const intent = item.interpretation.state === 'confirmed' && item.interpretation.intent.kind === 'change' ? item.interpretation.intent : undefined;
            if (intent === undefined) return null;
            return (
              <li key={item.annotationItemId} data-promotion-item-id={item.annotationItemId}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Promote annotation item ${item.annotationItemId}`}
                    disabled={!status.promotable}
                    checked={effectiveSelection.includes(item.annotationItemId)}
                    onChange={(e) => {
                      const { checked } = e.target;
                      setSelectedIds((current) => (checked ? [...current.filter((id) => id !== item.annotationItemId), item.annotationItemId] : current.filter((id) => id !== item.annotationItemId)));
                    }}
                  />
                  {intent.operation} · {intent.category}
                  {intent.expectedDependentMode === undefined ? '' : ` (${intent.expectedDependentMode})`} · {describePrimitive(intent.contractPrimitive)}
                </label>
                {status.promotable ? null : <span className="annotation-panel__hint"> {status.reason}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <label>
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        Activate this change contract for project check
      </label>
      <button type="button" disabled={!canPromote} onClick={() => onPromote(effectiveSelection, activate)}>
        Promote selected to change contract
      </button>
      <button type="button" disabled={!canPromote} onClick={() => onCreateVisualChange(effectiveSelection)}>{visualChangeStart.state === 'starting' ? 'Creating visual change…' : 'Create visual change'}</button>
      {promotion.state === 'promoting' ? (
        <p className="annotation-panel__status" role="status">
          Promoting…
        </p>
      ) : null}
      {promotion.state === 'promoted' ? (
        <p className="annotation-panel__status annotation-panel__status--success" role="status" data-promoted-contract-id={promotion.contractId} data-activation-state={promotion.activation.state}>
          Promoted change contract {promotion.contractId} with {promotion.clauseCount} clause{promotion.clauseCount === 1 ? '' : 's'}.{' '}
          {promotion.activation.state === 'activated'
            ? 'Activation: activated. It is now configured for project check.'
            : promotion.activation.state === 'not-configured'
              ? 'Activation: not configured. The contract was persisted but is not active for project check.'
              : promotion.activation.state === 'failed'
                ? `Activation: failed. The contract exists, but project activation failed${promotion.activation.reason === undefined ? '' : ` (${promotion.activation.reason})`}.`
                : 'Activation: not requested.'}
        </p>
      ) : null}
      {promotion.state === 'failed' ? (
        <p className="annotation-panel__error" role="alert" data-promotion-status-code={promotion.status ?? 'network'}>
          {promotion.message}
        </p>
      ) : null}
      {visualChangeStart.state === 'created' ? <p className="annotation-panel__status annotation-panel__status--success" role="status">Visual change created. Contract: {visualChangeStart.contractId}. Workflow: {visualChangeStart.visualChangeWorkflowId}. Activation: not yet activated.</p> : null}
      {visualChangeStart.state === 'failed' ? <p className="annotation-panel__error" role="alert">{visualChangeStart.message}</p> : null}
    </div>
  );
}

interface RelationshipOption {
  key: string;
  label: string;
  association: Extract<RuntimeAnnotationAssociation, { kind: 'runtime-relationship' }>;
}

/** Options come only from the server's canonical relationship graph - nothing is derived here. */
function relationshipOptions(graph: LayoutRelationshipGraph | undefined): RelationshipOption[] {
  if (graph === undefined) return [];
  return [
    ...graph.pairwiseRelationships.map((r, index) => ({
      key: `pairwise:${index}`,
      label: `${r.subjectTarget} ${r.kind} ${r.relatedTarget}`,
      association: { kind: 'runtime-relationship' as const, relationshipKind: r.kind, subjectTarget: r.subjectTarget, relatedTarget: r.relatedTarget },
    })),
    ...graph.pageRelationships.map((r, index) => ({
      key: `page:${index}`,
      label: `page ${r.kind}`,
      association: { kind: 'runtime-relationship' as const, relationshipKind: r.kind },
    })),
  ];
}

export function describeAssociation(association: VisualAnnotationItem['association']): string {
  if (association === undefined) return 'No association';
  switch (association.kind) {
    case 'runtime-target':
      return `Target association: ${association.target}`;
    case 'runtime-relationship':
      return association.subjectTarget !== undefined && association.relatedTarget !== undefined
        ? `Relationship association: ${association.relationshipKind} (${association.subjectTarget} → ${association.relatedTarget})`
        : `Relationship association: ${association.relationshipKind}`;
    default:
      return 'Unsupported association for runtime evidence';
  }
}

/**
 * v0.9 Batch 3 runtime annotation panel: saved annotations for the selected
 * canonical observation, the in-memory draft's lifecycle actions, and
 * explicit association of the selected draft item. Association and
 * interpretation are never inferred; new items stay uninterpreted.
 *
 * v0.9 Batch 5 adds explicit runtime intent (inspect/move/resize/remove/
 * preserve), the exact candidate structure, explicit confirmation, and
 * explicit promotion of selected confirmed items of a saved annotation into a
 * canonical change contract. Mark geometry never decides intent.
 */
export function RuntimeAnnotationPanel({
  session,
  saved,
  draft,
  selectedTargetName,
  relationships,
  onLoadSaved,
  onNewAnnotation,
  onUpdateSelectedItem,
  onDeleteSelected,
  onCancelChanges,
  onSave,
  onConfirmSelected,
  promotion,
  onPromote,
  visualChangeStart,
  onCreateVisualChange,
}: {
  session: AuthoringSessionState;
  saved: RuntimeAnnotationsState;
  draft: RuntimeAnnotationDraft;
  selectedTargetName: string | undefined;
  relationships: LayoutRelationshipGraph | undefined;
  onLoadSaved: (handle: string) => void;
  onNewAnnotation: () => void;
  onUpdateSelectedItem: (update: (item: VisualAnnotationItem) => VisualAnnotationItem) => void;
  onDeleteSelected: () => void;
  onCancelChanges: () => void;
  onSave: () => void;
  /** v0.9 Batch 5: explicit confirmation of the selected item's candidate runtime intent. */
  onConfirmSelected: () => void;
  /** v0.9 Batch 5: promotion state for the currently loaded saved annotation. */
  promotion: ContractPromotionState;
  onPromote: (itemIds: string[], activateForCheck: boolean) => void;
  visualChangeStart: RuntimeVisualChangeStartState;
  onCreateVisualChange: (itemIds: string[]) => void;
}) {
  const [relationshipKey, setRelationshipKey] = useState('');
  const editable = session.state === 'available';
  const selectedItem = draft.items.find((item) => item.annotationItemId === draft.selectedItemId);
  const options = relationshipOptions(relationships);
  const chosenRelationship = options.find((option) => option.key === relationshipKey);
  const hasEmptyNote = draft.items.some((item) => item.mark.kind === 'note' && item.mark.text.length === 0);
  const canSave = editable && draft.dirty && !hasEmptyNote && draft.save.state !== 'saving';

  return (
    <section className="annotation-panel" aria-label="Runtime annotations">
      <h3 className="annotation-panel__title">Annotations</h3>

      <AnnotationSessionNotice session={session} />
      <SavedAnnotationList saved={saved} activeHandle={draft.parentAnnotationHandle} sourceLabel="observation" onLoadSaved={onLoadSaved} />
      <DraftLifecycleSection
        draft={draft}
        editable={editable}
        canSave={canSave}
        hasEmptyNote={hasEmptyNote}
        onNewAnnotation={onNewAnnotation}
        onCancelChanges={onCancelChanges}
        onSave={onSave}
      />

      {selectedItem === undefined ? null : (
        <div className="annotation-panel__item" data-selected-annotation-item-id={selectedItem.annotationItemId}>
          <h4>Selected {selectedItem.mark.kind}</h4>
          <p className="annotation-panel__association" data-association-kind={selectedItem.association?.kind ?? 'none'}>
            {describeAssociation(selectedItem.association)}
          </p>
          <p className="annotation-panel__interpretation" data-interpretation-state={selectedItem.interpretation.state}>
            Interpretation: {selectedItem.interpretation.state}
            {selectedItem.interpretation.state === 'confirmed' ? ` at ${selectedItem.interpretation.confirmedAt}` : ''}
          </p>
          {selectedItem.interpretation.state === 'uninterpreted' ? null : (
            <pre className="annotation-panel__intent" data-runtime-intent="true" aria-label="Structured runtime intent">
              {JSON.stringify(selectedItem.interpretation.intent, null, 2)}
            </pre>
          )}

          {editable && selectedItem.mark.kind === 'note' ? (
            <label className="annotation-panel__note-editor">
              Note text
              <textarea
                value={selectedItem.mark.text}
                maxLength={ANNOTATION_NOTE_MAX_LENGTH}
                aria-label="Selected note text"
                onChange={(e) => {
                  const text = e.target.value.slice(0, ANNOTATION_NOTE_MAX_LENGTH);
                  onUpdateSelectedItem((item) => (item.mark.kind === 'note' ? { ...item, mark: { ...item.mark, text } } : item));
                }}
              />
            </label>
          ) : null}

          {editable ? (
            <div className="annotation-panel__association-actions">
              <button
                type="button"
                disabled={selectedTargetName === undefined}
                onClick={() => {
                  if (selectedTargetName === undefined) return;
                  onUpdateSelectedItem((item) => ({ ...item, association: { kind: 'runtime-target', target: selectedTargetName } }));
                }}
              >
                Associate target{selectedTargetName === undefined ? '' : ` ${selectedTargetName}`}
              </button>
              <label>
                Relationship
                <select value={relationshipKey} onChange={(e) => setRelationshipKey(e.target.value)} aria-label="Canonical relationship to associate">
                  <option value="">Choose a relationship…</option>
                  {options.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={chosenRelationship === undefined}
                onClick={() => {
                  if (chosenRelationship === undefined) return;
                  onUpdateSelectedItem((item) => ({ ...item, association: chosenRelationship.association }));
                }}
              >
                Associate relationship
              </button>
              <button
                type="button"
                disabled={selectedItem.association === undefined}
                onClick={() =>
                  onUpdateSelectedItem((item) => {
                    const { association: _removed, ...rest } = item;
                    void _removed;
                    return rest;
                  })
                }
              >
                Clear association
              </button>
              <button type="button" className="annotation-panel__delete" onClick={onDeleteSelected}>
                Delete draft item
              </button>
            </div>
          ) : null}
          {editable ? <RuntimeIntentSection item={selectedItem} onUpdate={onUpdateSelectedItem} onConfirm={onConfirmSelected} /> : null}
        </div>
      )}

      {editable ? <RuntimeContractPromotionSection draft={draft} promotion={promotion} onPromote={onPromote} visualChangeStart={visualChangeStart} onCreateVisualChange={onCreateVisualChange} /> : null}
    </section>
  );
}
