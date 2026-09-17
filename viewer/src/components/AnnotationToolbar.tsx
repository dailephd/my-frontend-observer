import { ANNOTATION_INTERACTION_MODES, ANNOTATION_NOTE_MAX_LENGTH } from '../annotation/annotationGeometry.js';
import type { AnnotationInteractionMode } from '../annotation/annotationGeometry.js';
import { ZoomControls } from './ZoomControls.js';

const MODE_LABELS: Record<AnnotationInteractionMode, string> = {
  select: 'Select',
  pan: 'Pan',
  point: 'Point',
  rectangle: 'Rectangle',
  line: 'Line',
  arrow: 'Arrow',
  note: 'Note',
};

/** Navigation modes stay available in a read-only viewer; drawing modes do not. */
const READ_ONLY_MODES: readonly AnnotationInteractionMode[] = ['select', 'pan'];

/**
 * v0.9 Batch 3 observation annotation toolbar: the closed interaction-mode
 * set (plain native buttons with pressed state), the bounded note-text input
 * used by `note` mode, and the existing zoom controls. A read-only viewer
 * shows only select/pan plus an explicit "Read-only viewer" notice.
 */
export function AnnotationToolbar({
  mode,
  onModeChange,
  editable,
  noteText,
  onNoteTextChange,
  zoom,
  zoomLabel = 'observation',
}: {
  mode: AnnotationInteractionMode;
  onModeChange: (mode: AnnotationInteractionMode) => void;
  editable: boolean;
  noteText: string;
  onNoteTextChange: (text: string) => void;
  /** Optional: a workspace that already renders its own zoom controls (the reference pane) omits this. */
  zoom?: { scale: number; zoomIn: () => void; zoomOut: () => void; fit: () => void; reset: () => void } | undefined;
  zoomLabel?: string;
}) {
  const modes = editable ? ANNOTATION_INTERACTION_MODES : READ_ONLY_MODES;
  return (
    <div className="annotation-toolbar">
      <div className="annotation-toolbar__modes" role="group" aria-label="Annotation interaction mode">
        {modes.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`annotation-toolbar__mode${candidate === mode ? ' annotation-toolbar__mode--active' : ''}`}
            aria-pressed={candidate === mode}
            aria-label={`${MODE_LABELS[candidate]} mode`}
            data-annotation-mode={candidate}
            onClick={() => onModeChange(candidate)}
          >
            {MODE_LABELS[candidate]}
          </button>
        ))}
      </div>
      {editable ? (
        <label className="annotation-toolbar__note">
          Note text
          <input type="text" value={noteText} maxLength={ANNOTATION_NOTE_MAX_LENGTH} onChange={(e) => onNoteTextChange(e.target.value)} placeholder="Text for new notes" aria-label="Note text for new notes" />
        </label>
      ) : (
        <span className="annotation-toolbar__read-only">Read-only viewer</span>
      )}
      {zoom === undefined ? null : <ZoomControls scale={zoom.scale} onZoomIn={zoom.zoomIn} onZoomOut={zoom.zoomOut} onFit={zoom.fit} onReset={zoom.reset} label={zoomLabel} />}
    </div>
  );
}
