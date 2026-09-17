import type { AuthoringSessionState } from '../hooks/useAuthoringSession.js';
import type { SourceAnnotationsState } from '../hooks/useRuntimeAnnotations.js';
import type { AnnotationDraft } from '../hooks/useRuntimeAnnotationDraft.js';

/**
 * v0.9 Batch 3/4 shared annotation panel sections, used unchanged by the
 * runtime and external-reference annotation panels: the authoring-session
 * notice, the saved-annotation list for the selected canonical source, and
 * the draft lifecycle (new, cancel, save, status).
 */
export function AnnotationSessionNotice({ session }: { session: AuthoringSessionState }) {
  return (
    <>
      {session.state === 'loading' ? <p className="placeholder-note">Checking annotation authoring…</p> : null}
      {session.state === 'read-only' ? <p className="annotation-panel__read-only">Read-only viewer: saved annotations can be inspected but not edited.</p> : null}
      {session.state === 'error' ? (
        <p className="annotation-panel__error" role="alert">
          Annotation authoring unavailable: {session.message}
        </p>
      ) : null}
    </>
  );
}

export function SavedAnnotationList({ saved, activeHandle, sourceLabel, onLoadSaved }: { saved: SourceAnnotationsState; activeHandle: string | undefined; sourceLabel: string; onLoadSaved: (handle: string) => void }) {
  return (
    <div className="annotation-panel__saved">
      <h4>Saved annotations</h4>
      {saved.state === 'loading' || saved.state === 'idle' ? <p className="placeholder-note">Loading saved annotations…</p> : null}
      {saved.state === 'error' ? (
        <p className="annotation-panel__error" role="alert">
          Saved annotations unavailable: {saved.message}
        </p>
      ) : null}
      {saved.state === 'available' && saved.annotations.length === 0 ? <p className="placeholder-note">No saved annotations for this {sourceLabel}.</p> : null}
      {saved.state === 'available' && saved.annotations.length > 0 ? (
        <ul className="annotation-panel__saved-list">
          {saved.annotations.map(({ handle, annotation }) => {
            const confirmed = annotation.items.filter((item) => item.interpretation.state === 'confirmed').length;
            const isParent = handle === activeHandle;
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
  );
}

export function DraftLifecycleSection({
  draft,
  editable,
  canSave,
  hasEmptyNote,
  onNewAnnotation,
  onCancelChanges,
  onSave,
}: {
  draft: AnnotationDraft;
  editable: boolean;
  canSave: boolean;
  hasEmptyNote: boolean;
  onNewAnnotation: () => void;
  onCancelChanges: () => void;
  onSave: () => void;
}) {
  return (
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

      {draft.save.state === 'saving' ? (
        <p className="annotation-panel__status" role="status">
          Saving…
        </p>
      ) : null}
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
  );
}
