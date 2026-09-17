import { useEffect, useState } from 'react';
import type { ObservationArtifact } from '../types/observation.js';
import { orderedTargets } from '../observation/targetOrder.js';
import { useObservationRelationships } from '../hooks/useObservationRelationships.js';
import { useZoomPan } from '../hooks/useZoomPan.js';
import { useAuthoringSession } from '../hooks/useAuthoringSession.js';
import { useRuntimeAnnotations } from '../hooks/useRuntimeAnnotations.js';
import { useRuntimeAnnotationDraft } from '../hooks/useRuntimeAnnotationDraft.js';
import { useAnnotationContractPromotion } from '../hooks/useAnnotationContractPromotion.js';
import { useAnnotationPointerInteraction } from '../hooks/useAnnotationPointerInteraction.js';
import type { AnnotationInteractionMode } from '../annotation/annotationGeometry.js';
import { isDrawingMode } from '../annotation/annotationGeometry.js';
import { TargetList } from './TargetList.js';
import { TargetOverlaySvg } from './TargetOverlaySvg.js';
import type { OverlayToggles } from './TargetOverlaySvg.js';
import { ObservationInspector } from './ObservationInspector.js';
import { AnnotationLayer } from './AnnotationLayer.js';
import { AnnotationToolbar } from './AnnotationToolbar.js';
import { RuntimeAnnotationPanel } from './RuntimeAnnotationPanel.js';

/**
 * Batch 3 observation visual workspace: screenshot + SVG target overlay +
 * target list + inspector, all driven by the already-fetched full
 * `ObservationArtifact` (`/api/artifacts/<handle>`, Batch 2, unchanged) plus
 * one additive canonical-relationship fetch
 * (`/api/observations/<handle>/relationships`). The screenshot itself loads
 * through the existing Batch 2 media endpoint - never a local path, never
 * base64-embedded.
 *
 * v0.9 Batch 3 adds runtime annotation authoring on top of the same SVG:
 * zoom/pan controls, exclusive interaction modes, an `AnnotationLayer` in the
 * same viewBox (runtime viewport CSS pixels), and an in-memory draft that is
 * persisted only through the Prompt 2 `POST /api/annotations` API. A
 * read-only viewer keeps full inspection with navigation-only modes.
 */
export function ObservationWorkspace({ handle, artifact }: { handle: string; artifact: ObservationArtifact }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [toggles, setToggles] = useState<OverlayToggles>({ geometry: true, labels: true, relationships: true });
  const relationships = useObservationRelationships(handle);
  const frame = artifact.requestConfig.viewport;
  const zoomPan = useZoomPan(frame.width, frame.height);
  const session = useAuthoringSession();
  const editable = session.state === 'available';
  const saved = useRuntimeAnnotations(handle, artifact.observationId);
  const draftApi = useRuntimeAnnotationDraft(handle);
  const { draft } = draftApi;
  const promotion = useAnnotationContractPromotion(draft.parentAnnotationHandle);
  const [mode, setMode] = useState<AnnotationInteractionMode>('select');
  const [noteText, setNoteText] = useState('');

  const interaction = useAnnotationPointerInteraction({
    mode,
    frame,
    zoomPan,
    editable,
    items: draft.items,
    noteText,
    onAddItem: draftApi.addItem,
    onUpdateItem: draftApi.updateItem,
  });
  const { clearTransient } = interaction;

  // Selection is presentation-only state; changing observation must not carry a stale selection from a different artifact forward.
  useEffect(() => {
    setSelected(undefined);
    setMode('select');
    clearTransient();
  }, [handle, clearTransient]);

  // Drawing modes exist only while authoring is available.
  useEffect(() => {
    if (!editable && isDrawingMode(mode)) setMode('select');
  }, [editable, mode]);

  const targets = orderedTargets(artifact);
  const screenshotUrl = `/api/media/${handle}/screenshot`;
  const relationshipGraph = relationships.state === 'available' ? relationships.graph : undefined;

  function changeMode(next: AnnotationInteractionMode): void {
    clearTransient();
    setMode(next);
  }

  return (
    <div className="observation-workspace">
      <div className="observation-workspace__toolbar" role="group" aria-label="Overlay toggles">
        <label>
          <input type="checkbox" checked={toggles.geometry} onChange={(e) => setToggles((t) => ({ ...t, geometry: e.target.checked }))} />
          Target geometry
        </label>
        <label>
          <input type="checkbox" checked={toggles.labels} onChange={(e) => setToggles((t) => ({ ...t, labels: e.target.checked }))} disabled={!toggles.geometry} />
          Labels
        </label>
        <label>
          <input type="checkbox" checked={toggles.relationships} onChange={(e) => setToggles((t) => ({ ...t, relationships: e.target.checked }))} />
          Relationships
        </label>
      </div>
      <AnnotationToolbar
        mode={mode}
        onModeChange={changeMode}
        editable={editable}
        noteText={noteText}
        onNoteTextChange={setNoteText}
        zoom={{ scale: zoomPan.scale, zoomIn: zoomPan.zoomIn, zoomOut: zoomPan.zoomOut, fit: zoomPan.fit, reset: zoomPan.reset }}
      />
      <div className="observation-workspace__panes">
        <div className="observation-workspace__targets">
          <TargetList targets={targets} selected={selected} onSelect={setSelected} />
        </div>
        <div className="observation-workspace__visual" data-annotation-mode={mode}>
          <TargetOverlaySvg
            artifact={artifact}
            screenshotUrl={screenshotUrl}
            targets={targets}
            relationships={relationshipGraph}
            selected={selected}
            onSelect={setSelected}
            toggles={toggles}
            zoomPan={interaction.binding}
            targetsInteractive={interaction.targetsInteractive}
            interactionClassName={`target-overlay-svg--mode-${mode}`}
            annotationLayer={
              <AnnotationLayer
                items={draft.items}
                selectedItemId={draft.selectedItemId}
                selectable={interaction.marksSelectable}
                onSelectItem={draftApi.selectItem}
                onItemPointerDown={interaction.onItemPointerDown}
                previewMark={interaction.previewMark}
              />
            }
          />
        </div>
        <div className="observation-workspace__inspector">
          <RuntimeAnnotationPanel
            session={session}
            saved={saved}
            draft={draft}
            selectedTargetName={selected}
            relationships={relationshipGraph}
            onLoadSaved={(savedHandle) => {
              if (saved.state !== 'available') return;
              const entry = saved.annotations.find((candidate) => candidate.handle === savedHandle);
              if (entry === undefined) return;
              clearTransient();
              draftApi.loadPersisted(entry.handle, entry.annotation);
            }}
            onNewAnnotation={() => {
              clearTransient();
              draftApi.newAnnotation();
            }}
            onUpdateSelectedItem={(update) => {
              if (draft.selectedItemId !== undefined) draftApi.updateItem(draft.selectedItemId, update);
            }}
            onDeleteSelected={draftApi.deleteSelected}
            onCancelChanges={() => {
              clearTransient();
              draftApi.cancelChanges();
            }}
            onSave={() => {
              if (session.state !== 'available') return;
              void draftApi.save(session.token, saved.reload);
            }}
            onConfirmSelected={() => {
              if (draft.selectedItemId !== undefined) draftApi.confirmItem(draft.selectedItemId);
            }}
            promotion={promotion.state}
            onPromote={(itemIds, activateForCheck) => {
              if (session.state !== 'available') return;
              void promotion.promote(session.token, itemIds, activateForCheck);
            }}
          />
          <ObservationInspector artifact={artifact} selectedTargetName={selected} relationships={relationships} />
        </div>
      </div>
    </div>
  );
}
