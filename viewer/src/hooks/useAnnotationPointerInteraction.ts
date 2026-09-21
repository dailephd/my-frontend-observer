import { useCallback, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { VisualAnnotationItem, VisualAnnotationMark } from '../types/visualAnnotation.js';
import type { UseZoomPanResult, ZoomPanBinding } from './useZoomPan.js';
import { screenPointToSvgSource } from '../svg/sourceCoordinates.js';
import { buildDrawnMark, isDrawingMode, isMarkInFrame, isPointInFrame, newDraftItem, translateMark } from '../annotation/annotationGeometry.js';
import type { AnnotationDrawingMode, AnnotationInteractionMode, SourceFrame, SourcePoint } from '../annotation/annotationGeometry.js';

/** Same click-versus-drag threshold `useZoomPan` uses, so a plain click on a mark only selects it. */
const MOVE_THRESHOLD_PX = 3;

type SvgPointerEvent = PointerEvent<SVGSVGElement>;

interface DrawingGesture {
  pointerId: number;
  mode: AnnotationDrawingMode;
  start: SourcePoint;
  current: SourcePoint;
}

interface MoveGesture {
  pointerId: number;
  annotationItemId: string;
  start: SourcePoint;
  original: VisualAnnotationMark;
  startClientX: number;
  startClientY: number;
  active: boolean;
}

const NO_OP = (): void => undefined;

/**
 * v0.9 Batch 3: one exclusive pointer-interaction binding per mode for a
 * source-frame SVG. Exactly one handler set is attached at a time:
 *
 * - `pan`: the existing `useZoomPan` handlers only.
 * - drawing modes: drawing handlers only (no pan, no target or mark
 *   selection, no mark movement).
 * - `select`: mark selection/move only (the background never pans or draws).
 *
 * Every pointer position goes through the one shared
 * `screenPointToSvgSource` transform. Positions outside the source frame are
 * ignored, never clamped. Frame-agnostic, so a reference workspace can reuse
 * it later.
 */
export function useAnnotationPointerInteraction({
  mode,
  frame,
  zoomPan,
  editable,
  items,
  noteText,
  onAddItem,
  onUpdateItem,
}: {
  mode: AnnotationInteractionMode;
  frame: SourceFrame;
  zoomPan: UseZoomPanResult;
  /** False for a read-only viewer: no drawing and no moving, only selection and navigation. */
  editable: boolean;
  items: readonly VisualAnnotationItem[];
  noteText: string;
  onAddItem: (item: VisualAnnotationItem) => void;
  onUpdateItem: (annotationItemId: string, update: (item: VisualAnnotationItem) => VisualAnnotationItem) => void;
}) {
  const drawing = useRef<DrawingGesture | null>(null);
  const moving = useRef<MoveGesture | null>(null);
  const [previewMark, setPreviewMark] = useState<VisualAnnotationMark | undefined>(undefined);

  function toSource(clientX: number, clientY: number): SourcePoint | undefined {
    const svg = zoomPan.svgRef.current;
    return svg ? screenPointToSvgSource(svg, clientX, clientY) : undefined;
  }

  function capture(pointerId: number): void {
    const svg = zoomPan.svgRef.current;
    if (svg && !svg.hasPointerCapture(pointerId)) svg.setPointerCapture(pointerId);
  }

  function release(pointerId: number): void {
    const svg = zoomPan.svgRef.current;
    if (svg?.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
  }

  const clearTransient = useCallback(() => {
    drawing.current = null;
    moving.current = null;
    setPreviewMark(undefined);
  }, []);

  const drawingHandlers = {
    onPointerDown: (e: SvgPointerEvent) => {
      if (!editable || !isDrawingMode(mode) || e.button !== 0) return;
      const point = toSource(e.clientX, e.clientY);
      if (point === undefined || !isPointInFrame(point, frame)) return;
      e.preventDefault();
      drawing.current = { pointerId: e.pointerId, mode, start: point, current: point };
      capture(e.pointerId);
    },
    onPointerMove: (e: SvgPointerEvent) => {
      const gesture = drawing.current;
      if (gesture === null || gesture.pointerId !== e.pointerId) return;
      const point = toSource(e.clientX, e.clientY);
      if (point === undefined || !isPointInFrame(point, frame)) return;
      gesture.current = point;
      if (gesture.mode === 'rectangle' || gesture.mode === 'line' || gesture.mode === 'arrow') {
        setPreviewMark(buildDrawnMark(gesture.mode, gesture.start, point, ''));
      }
    },
    onPointerUp: (e: SvgPointerEvent) => {
      const gesture = drawing.current;
      if (gesture === null || gesture.pointerId !== e.pointerId) return;
      const point = toSource(e.clientX, e.clientY);
      const end = point !== undefined && isPointInFrame(point, frame) ? point : gesture.current;
      drawing.current = null;
      setPreviewMark(undefined);
      release(e.pointerId);
      const mark = buildDrawnMark(gesture.mode, gesture.start, end, noteText);
      if (mark !== undefined && isMarkInFrame(mark, frame)) onAddItem(newDraftItem(mark, () => crypto.randomUUID()));
    },
    onPointerLeave: NO_OP,
    onPointerCancel: (e: SvgPointerEvent) => {
      if (drawing.current?.pointerId !== e.pointerId) return;
      drawing.current = null;
      setPreviewMark(undefined);
      release(e.pointerId);
    },
  };

  const endMove = (e: SvgPointerEvent) => {
    if (moving.current?.pointerId !== e.pointerId) return;
    moving.current = null;
    release(e.pointerId);
  };

  const selectHandlers = {
    onPointerDown: NO_OP,
    onPointerMove: (e: SvgPointerEvent) => {
      const gesture = moving.current;
      if (gesture === null || gesture.pointerId !== e.pointerId) return;
      if (!gesture.active) {
        if (Math.hypot(e.clientX - gesture.startClientX, e.clientY - gesture.startClientY) < MOVE_THRESHOLD_PX) return;
        gesture.active = true;
        capture(e.pointerId);
      }
      const point = toSource(e.clientX, e.clientY);
      if (point === undefined) return;
      const next = translateMark(gesture.original, point.x - gesture.start.x, point.y - gesture.start.y);
      // An invalid (out-of-frame) translation is simply not applied - the mark keeps its last valid position.
      if (!isMarkInFrame(next, frame)) return;
      onUpdateItem(gesture.annotationItemId, (item) => ({ ...item, mark: next }));
    },
    onPointerUp: endMove,
    onPointerLeave: NO_OP,
    onPointerCancel: endMove,
  };

  const onItemPointerDown = (annotationItemId: string, e: PointerEvent<SVGGElement>) => {
    if (!editable || mode !== 'select') return;
    const item = items.find((candidate) => candidate.annotationItemId === annotationItemId);
    const point = toSource(e.clientX, e.clientY);
    if (item === undefined || point === undefined) return;
    moving.current = { pointerId: e.pointerId, annotationItemId, start: point, original: item.mark, startClientX: e.clientX, startClientY: e.clientY, active: false };
  };

  const pointerHandlers: UseZoomPanResult['pointerHandlers'] = mode === 'pan' ? zoomPan.pointerHandlers : isDrawingMode(mode) ? drawingHandlers : selectHandlers;

  const binding: ZoomPanBinding = {
    viewBox: zoomPan.viewBox,
    svgRef: zoomPan.svgRef,
    pointerHandlers,
    isPannable: mode === 'pan' && zoomPan.isPannable,
  };

  return {
    binding,
    previewMark,
    onItemPointerDown,
    clearTransient,
    /** Existing target selection is active only in select mode. */
    targetsInteractive: mode === 'select',
    /** Marks are selectable only in select mode, never while panning or drawing. */
    marksSelectable: mode === 'select',
  };
}
