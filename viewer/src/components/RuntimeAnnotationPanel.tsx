import { useState } from 'react';
import type { LayoutRelationshipGraph } from '../types/observation.js';
import type { RuntimeAnnotationAssociation, VisualAnnotationItem } from '../types/visualAnnotation.js';
import type { AuthoringSessionState } from '../hooks/useAuthoringSession.js';
import type { RuntimeAnnotationsState } from '../hooks/useRuntimeAnnotations.js';
import type { RuntimeAnnotationDraft } from '../hooks/useRuntimeAnnotationDraft.js';
import { ANNOTATION_NOTE_MAX_LENGTH } from '../annotation/annotationGeometry.js';

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

      {session.state === 'loading' ? <p className="placeholder-note">Checking annotation authoring…</p> : null}
      {session.state === 'read-only' ? <p className="annotation-panel__read-only">Read-only viewer: saved annotations can be inspected but not edited.</p> : null}
      {session.state === 'error' ? (
        <p className="annotation-panel__error" role="alert">
          Annotation authoring unavailable: {session.message}
        </p>
      ) : null}

      <div className="annotation-panel__saved">
        <h4>Saved annotations</h4>
        {saved.state === 'loading' || saved.state === 'idle' ? <p className="placeholder-note">Loading saved annotations…</p> : null}
        {saved.state === 'error' ? (
          <p className="annotation-panel__error" role="alert">
            Saved annotations unavailable: {saved.message}
          </p>
        ) : null}
        {saved.state === 'available' && saved.annotations.length === 0 ? <p className="placeholder-note">No saved annotations for this observation.</p> : null}
        {saved.state === 'available' && saved.annotations.length > 0 ? (
          <ul className="annotation-panel__saved-list">
            {saved.annotations.map(({ handle, annotation }) => {
              const confirmed = annotation.items.filter((item) => item.interpretation.state === 'confirmed').length;
              const isParent = handle === draft.parentAnnotationHandle;
              return (
                <li key={handle}>
                  <button
                    type="button"
                    className={`annotation-panel__saved-item${isParent ? ' annotation-panel__saved-item--active' : ''}`}
                    aria-pressed={isParent}
                    data-annotation-id={annotation.annotationId}
                    onClick={() => onLoadSaved(handle)}
                  >
                    <span className="annotation-panel__saved-id">{annotation.annotationId}</span>
                    <span className="annotation-panel__saved-meta">
                      {annotation.items.length} items, {confirmed} confirmed{annotation.supersedesAnnotationId === undefined ? '' : ', revision'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {saved.state === 'available' && saved.truncated ? <p className="placeholder-note">Saved annotation list is bounded; not every candidate is shown.</p> : null}
      </div>

      <div className="annotation-panel__draft">
        <h4>{draft.parentAnnotationId === undefined ? 'Draft: new annotation' : 'Draft: revision'}</h4>
        {draft.parentAnnotationId === undefined ? null : (
          <p className="annotation-panel__parent">
            Revises <code>{draft.parentAnnotationId}</code>
          </p>
        )}
        <p className="annotation-panel__draft-summary" data-draft-item-count={draft.items.length} data-draft-dirty={draft.dirty ? 'true' : 'false'}>
          {draft.items.length} draft items{draft.dirty ? ' · unsaved changes' : ''}
        </p>

        {editable ? (
          <div className="annotation-panel__actions">
            <button type="button" onClick={onNewAnnotation}>
              New annotation
            </button>
            <button type="button" onClick={onCancelChanges} disabled={!draft.dirty && draft.save.state !== 'failed'}>
              Cancel changes
            </button>
            <button type="button" className="annotation-panel__save" onClick={onSave} disabled={!canSave}>
              Save annotation
            </button>
          </div>
        ) : null}

        {draft.save.state === 'saving' ? <p className="annotation-panel__status" role="status">Saving…</p> : null}
        {draft.save.state === 'saved' ? (
          <p className="annotation-panel__status annotation-panel__status--success" role="status">
            Saved annotation {draft.save.annotationId}
          </p>
        ) : null}
        {draft.save.state === 'failed' ? (
          <p className="annotation-panel__error" role="alert" data-save-status={draft.save.status ?? 'network'}>
            {draft.save.message}
          </p>
        ) : null}
        {hasEmptyNote ? <p className="annotation-panel__error">A note needs text before the annotation can be saved.</p> : null}
      </div>

      {selectedItem === undefined ? null : (
        <div className="annotation-panel__item" data-selected-annotation-item-id={selectedItem.annotationItemId}>
          <h4>Selected {selectedItem.mark.kind}</h4>
          <p className="annotation-panel__association" data-association-kind={selectedItem.association?.kind ?? 'none'}>
            {describeAssociation(selectedItem.association)}
          </p>
          <p className="annotation-panel__interpretation">Interpretation: {selectedItem.interpretation.state}</p>

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
        </div>
      )}
    </section>
  );
}
