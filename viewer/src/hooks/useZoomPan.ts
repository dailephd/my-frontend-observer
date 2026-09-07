import { useCallback, useEffect, useRef, useState } from 'react';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 1.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface ZoomPanState {
  scale: number;
  focalX: number;
  focalY: number;
}

/**
 * v0.8 Batch 6: bounded, presentation-only zoom/pan state over one SVG
 * pane's own source-coordinate frame (`frameWidth`/`frameHeight` - reference-
 * image pixels for the reference pane, candidate CSS pixels for the
 * candidate pane). Never rewrites reference region coordinates, runtime
 * target coordinates, reference image dimensions, or candidate viewport -
 * this hook only computes an SVG `viewBox` string over the SAME unchanged
 * source geometry the leaf SVG components already render (task §24). Pan
 * and zoom are expressed as one `{scale, focalX, focalY}` triple in source
 * units, which is exactly what Batch 6's view-lock feature needs to map one
 * pane's focal point into the other pane's coordinate domain (see
 * `deriveCoordinateScale` reuse in `ReferenceWorkspace.tsx`) - no second
 * scale/offset representation exists anywhere in this hook.
 *
 * Panning uses the SVG element's own `getScreenCTM()` to convert a pointer's
 * screen-space delta into source-space delta, so it is correct regardless of
 * the pane's actual rendered/letterboxed size - this reuses the browser's
 * native SVG coordinate transform rather than reimplementing aspect-ratio-
 * aware pixel math.
 *
 * Optional `controlled` argument: when supplied, this pane's zoom/pan state
 * is READ from `controlled.state` and every would-be internal update calls
 * `controlled.onChange` instead of an internal `setState` - the same
 * controlled/uncontrolled pattern React inputs use. View-lock
 * (`ReferenceWorkspace.tsx`) uses this to give both panes a single shared
 * source of truth (one `sharedLock` state, converted per-pane via the exact
 * canonical `deriveCoordinateScale`) instead of two independent states
 * synchronized by a pair of reactive effects - which would risk a feedback
 * loop. Uncontrolled (the default) is unchanged from Batch 6's original
 * per-pane-independent behavior.
 */
export function useZoomPan(frameWidth: number, frameHeight: number, controlled?: { state: ZoomPanState; onChange: (next: ZoomPanState) => void }) {
  const [internalZoom, setInternalZoom] = useState<ZoomPanState>({ scale: ZOOM_MIN, focalX: frameWidth / 2, focalY: frameHeight / 2 });
  const zoom = controlled?.state ?? internalZoom;
  const setZoom = useCallback(
    (updater: ZoomPanState | ((prev: ZoomPanState) => ZoomPanState)) => {
      if (controlled) {
        controlled.onChange(typeof updater === 'function' ? updater(controlled.state) : updater);
      } else {
        setInternalZoom(updater);
      }
    },
    [controlled?.onChange, controlled?.state],
  );
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragState = useRef<{ pointerId: number; active: boolean; startClientX: number; startClientY: number; startSourceX: number; startSourceY: number; startFocalX: number; startFocalY: number } | null>(null);

  // Re-fits whenever the frame's own source dimensions change (e.g. the candidate's real viewport
  // arrives after an initial placeholder, or a different reference/candidate is selected) - a stale
  // zoom/pan state computed against a prior frame size is never carried forward silently. Skipped in
  // controlled mode: the owner of `controlled.state` is responsible for its own fit/reset semantics.
  useEffect(() => {
    if (controlled) return;
    setInternalZoom({ scale: ZOOM_MIN, focalX: frameWidth / 2, focalY: frameHeight / 2 });
  }, [frameWidth, frameHeight, controlled === undefined]);

  const viewWidth = frameWidth / zoom.scale;
  const viewHeight = frameHeight / zoom.scale;
  const viewBox = `${zoom.focalX - viewWidth / 2} ${zoom.focalY - viewHeight / 2} ${viewWidth} ${viewHeight}`;

  const setScaleClamped = useCallback(
    (next: number, focalX?: number, focalY?: number) => {
      setZoom((prev) => ({ scale: clamp(next, ZOOM_MIN, ZOOM_MAX), focalX: focalX ?? prev.focalX, focalY: focalY ?? prev.focalY }));
    },
    [setZoom],
  );

  const zoomIn = useCallback(() => setScaleClamped(zoom.scale * ZOOM_STEP), [setScaleClamped, zoom.scale]);
  const zoomOut = useCallback(() => setScaleClamped(zoom.scale / ZOOM_STEP), [setScaleClamped, zoom.scale]);
  const fit = useCallback(() => setZoom({ scale: ZOOM_MIN, focalX: frameWidth / 2, focalY: frameHeight / 2 }), [frameWidth, frameHeight, setZoom]);
  // v0.8 Batch 6 (task §26): Reset is equivalent to Fit - no second presentation-only default exists.
  const reset = fit;

  function screenToSource(clientX: number, clientY: number): { x: number; y: number } | undefined {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const ctm = svg.getScreenCTM();
    if (!ctm) return undefined;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  // A plain click (pointerdown+pointerup with no real movement) must never be treated as a pan, or it
  // would hijack region/target selection clicks via setPointerCapture redirecting the click's effective
  // target. Panning - and pointer capture - only begins once the pointer has moved past this small
  // screen-pixel threshold from its down position.
  const DRAG_THRESHOLD_PX = 3;

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (zoom.scale <= ZOOM_MIN) return; // panning is only meaningful once zoomed past the fitted frame
      const source = screenToSource(e.clientX, e.clientY);
      if (!source) return;
      dragState.current = {
        pointerId: e.pointerId,
        active: false,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startSourceX: source.x,
        startSourceY: source.y,
        startFocalX: zoom.focalX,
        startFocalY: zoom.focalY,
      };
    },
    [zoom.scale, zoom.focalX, zoom.focalY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragState.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (!drag.active) {
        const movedPx = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
        if (movedPx < DRAG_THRESHOLD_PX) return;
        drag.active = true;
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      const current = screenToSource(e.clientX, e.clientY);
      if (!current) return;
      const dx = current.x - drag.startSourceX;
      const dy = current.y - drag.startSourceY;
      setZoom((prev) => ({ ...prev, focalX: clamp(drag.startFocalX - dx, 0, frameWidth), focalY: clamp(drag.startFocalY - dy, 0, frameHeight) }));
    },
    [frameWidth, frameHeight, setZoom],
  );

  const endDrag = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    dragState.current = null;
  }, []);

  return {
    scale: zoom.scale,
    focalX: zoom.focalX,
    focalY: zoom.focalY,
    viewBox,
    svgRef,
    zoomIn,
    zoomOut,
    fit,
    reset,
    setFocal: (focalX: number, focalY: number) => setZoom((prev) => ({ ...prev, focalX, focalY })),
    setScale: (scale: number) => setScaleClamped(scale),
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerLeave: endDrag,
      onPointerCancel: endDrag,
    },
    isPannable: zoom.scale > ZOOM_MIN,
  };
}

export type UseZoomPanResult = ReturnType<typeof useZoomPan>;

/** The exact subset a leaf SVG component (`TargetOverlaySvg`/`ReferenceRegionOverlaySvg`) needs to render under zoom/pan - deliberately not the full `UseZoomPanResult` (no zoomIn/zoomOut/etc leak into rendering-only components). */
export interface ZoomPanBinding {
  viewBox: string;
  svgRef: React.Ref<SVGSVGElement>;
  pointerHandlers: UseZoomPanResult['pointerHandlers'];
  isPannable: boolean;
}
