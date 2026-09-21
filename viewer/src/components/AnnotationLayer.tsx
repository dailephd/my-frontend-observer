import type { KeyboardEvent, PointerEvent } from 'react';
import type { VisualAnnotationItem, VisualAnnotationMark } from '../types/visualAnnotation.js';
import { markAccessibleLabel } from '../annotation/annotationGeometry.js';

const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_HALF_WIDTH = 6;
const POINT_RADIUS = 6;
const NOTE_ANCHOR_RADIUS = 4;
const NOTE_TEXT_OFFSET = 8;

function arrowheadPoints(start: { x: number; y: number }, end: { x: number; y: number }): string | undefined {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return undefined;
  const ux = dx / length;
  const uy = dy / length;
  const baseX = end.x - ux * ARROWHEAD_LENGTH;
  const baseY = end.y - uy * ARROWHEAD_LENGTH;
  return `${end.x},${end.y} ${baseX - uy * ARROWHEAD_HALF_WIDTH},${baseY + ux * ARROWHEAD_HALF_WIDTH} ${baseX + uy * ARROWHEAD_HALF_WIDTH},${baseY - ux * ARROWHEAD_HALF_WIDTH}`;
}

/** Fixed, system-generated SVG for one of the five persisted mark kinds. Note text is ordinary React text content, never markup. */
function MarkShape({ mark }: { mark: VisualAnnotationMark }) {
  switch (mark.kind) {
    case 'point':
      return <circle className="annotation-layer__shape annotation-layer__shape--area" cx={mark.x} cy={mark.y} r={POINT_RADIUS} />;
    case 'rectangle':
      return <rect className="annotation-layer__shape annotation-layer__shape--area" x={mark.x} y={mark.y} width={mark.width} height={mark.height} />;
    case 'line':
      return <line className="annotation-layer__shape annotation-layer__shape--stroke" x1={mark.start.x} y1={mark.start.y} x2={mark.end.x} y2={mark.end.y} />;
    case 'arrow': {
      const head = arrowheadPoints(mark.start, mark.end);
      return (
        <>
          <line className="annotation-layer__shape annotation-layer__shape--stroke" x1={mark.start.x} y1={mark.start.y} x2={mark.end.x} y2={mark.end.y} />
          {head === undefined ? null : <polygon className="annotation-layer__shape annotation-layer__shape--filled" points={head} />}
        </>
      );
    }
    case 'note':
      return (
        <>
          <circle className="annotation-layer__shape annotation-layer__shape--filled" cx={mark.anchor.x} cy={mark.anchor.y} r={NOTE_ANCHOR_RADIUS} />
          <text className="annotation-layer__note-text" x={mark.anchor.x + NOTE_TEXT_OFFSET} y={mark.anchor.y - NOTE_TEXT_OFFSET}>
            {mark.text}
          </text>
        </>
      );
  }
}

/**
 * v0.9 Batch 3 reusable annotation presentation layer: one SVG `<g>` rendered
 * inside an existing source-frame SVG (the workspace owns the `viewBox`,
 * zoom/pan, and source media). It receives source-native marks only and knows
 * nothing about observation/reference artifacts, project paths, the authoring
 * session, the server API, or aliases.
 */
export function AnnotationLayer({
  items,
  selectedItemId,
  selectable,
  onSelectItem,
  onItemPointerDown,
  previewMark,
}: {
  items: readonly VisualAnnotationItem[];
  selectedItemId: string | undefined;
  /** When false, marks are display-only and never intercept pointer events (e.g. during pan or drawing). */
  selectable: boolean;
  onSelectItem: (annotationItemId: string) => void;
  /** Optional drag start hook for select-mode moves; the owner decides whether the item may move. */
  onItemPointerDown?: (annotationItemId: string, event: PointerEvent<SVGGElement>) => void;
  previewMark?: VisualAnnotationMark | undefined;
}) {
  return (
    <g className={`annotation-layer${selectable ? ' annotation-layer--selectable' : ''}`} data-annotation-layer="true">
      {items.map((item) => {
        const isSelected = item.annotationItemId === selectedItemId;
        return (
          <g
            key={item.annotationItemId}
            className={`annotation-layer__mark${isSelected ? ' annotation-layer__mark--selected' : ''}`}
            data-annotation-item-id={item.annotationItemId}
            data-annotation-kind={item.mark.kind}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            aria-label={markAccessibleLabel(item.mark)}
            aria-pressed={selectable ? isSelected : undefined}
            onPointerDown={
              selectable
                ? (event: PointerEvent<SVGGElement>) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    onSelectItem(item.annotationItemId);
                    onItemPointerDown?.(item.annotationItemId, event);
                  }
                : undefined
            }
            onKeyDown={
              selectable
                ? (event: KeyboardEvent<SVGGElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectItem(item.annotationItemId);
                    }
                  }
                : undefined
            }
          >
            <MarkShape mark={item.mark} />
          </g>
        );
      })}
      {previewMark === undefined ? null : (
        <g className="annotation-layer__mark annotation-layer__mark--preview" data-annotation-preview="true" aria-hidden="true">
          <MarkShape mark={previewMark} />
        </g>
      )}
    </g>
  );
}
