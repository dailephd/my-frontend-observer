import type { VisualAnnotationItem, VisualAnnotationMark } from '../types/visualAnnotation.js';

/**
 * v0.9 Batch 3: pure, presentation-side annotation draft geometry helpers.
 * Everything here works in the source frame's own units (runtime CSS pixels
 * for an observation) and never rounds, clamps, snaps, or scales. The server
 * remains the structural authority - these helpers only keep the in-memory
 * draft from ever holding geometry the canonical validator would reject.
 */

/** The closed runtime annotation toolbar vocabulary. `select` and `pan` are interaction modes, never persisted evidence. */
export type AnnotationInteractionMode = 'select' | 'pan' | 'point' | 'rectangle' | 'line' | 'arrow' | 'note';

export const ANNOTATION_INTERACTION_MODES: readonly AnnotationInteractionMode[] = ['select', 'pan', 'point', 'rectangle', 'line', 'arrow', 'note'];

export type AnnotationDrawingMode = Extract<AnnotationInteractionMode, 'point' | 'rectangle' | 'line' | 'arrow' | 'note'>;

export function isDrawingMode(mode: AnnotationInteractionMode): mode is AnnotationDrawingMode {
  return mode === 'point' || mode === 'rectangle' || mode === 'line' || mode === 'arrow' || mode === 'note';
}

/** Same bound as the canonical `MAX_VISUAL_ANNOTATION_NOTE_LENGTH` (the server still validates). */
export const ANNOTATION_NOTE_MAX_LENGTH = 2000;

export interface SourcePoint {
  x: number;
  y: number;
}

export interface SourceFrame {
  width: number;
  height: number;
}

export function isPointInFrame(point: SourcePoint, frame: SourceFrame): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= frame.width && point.y >= 0 && point.y <= frame.height;
}

export function isMarkInFrame(mark: VisualAnnotationMark, frame: SourceFrame): boolean {
  switch (mark.kind) {
    case 'point':
      return isPointInFrame(mark, frame);
    case 'rectangle':
      return mark.width > 0 && mark.height > 0 && isPointInFrame(mark, frame) && isPointInFrame({ x: mark.x + mark.width, y: mark.y + mark.height }, frame);
    case 'line':
    case 'arrow':
      return isPointInFrame(mark.start, frame) && isPointInFrame(mark.end, frame);
    case 'note':
      return isPointInFrame(mark.anchor, frame);
  }
}

/** Rigid translation by a source-unit delta. Rectangle width/height, line length, and note text are unchanged. */
export function translateMark(mark: VisualAnnotationMark, dx: number, dy: number): VisualAnnotationMark {
  switch (mark.kind) {
    case 'point':
      return { kind: 'point', x: mark.x + dx, y: mark.y + dy };
    case 'rectangle':
      return { kind: 'rectangle', x: mark.x + dx, y: mark.y + dy, width: mark.width, height: mark.height };
    case 'line':
    case 'arrow':
      return { kind: mark.kind, start: { x: mark.start.x + dx, y: mark.start.y + dy }, end: { x: mark.end.x + dx, y: mark.end.y + dy } };
    case 'note':
      return { kind: 'note', anchor: { x: mark.anchor.x + dx, y: mark.anchor.y + dy }, text: mark.text };
  }
}

/**
 * Builds the mark for one completed drawing gesture, or `undefined` when the
 * gesture does not describe a valid mark: a rectangle with zero width or
 * height, a zero-length line/arrow, or a note without text. Rectangles are
 * direction-normalized; nothing is rounded or snapped.
 */
export function buildDrawnMark(mode: AnnotationDrawingMode, start: SourcePoint, end: SourcePoint, noteText: string): VisualAnnotationMark | undefined {
  switch (mode) {
    case 'point':
      return { kind: 'point', x: start.x, y: start.y };
    case 'note':
      if (noteText.length === 0 || noteText.length > ANNOTATION_NOTE_MAX_LENGTH) return undefined;
      return { kind: 'note', anchor: { x: start.x, y: start.y }, text: noteText };
    case 'rectangle': {
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (width <= 0 || height <= 0) return undefined;
      return { kind: 'rectangle', x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
    }
    case 'line':
    case 'arrow':
      if (start.x === end.x && start.y === end.y) return undefined;
      return { kind: mode, start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  }
}

/** A new draft item: Observer-owned random id (never derived from geometry, time, position, or target), no association, uninterpreted. */
export function newDraftItem(mark: VisualAnnotationMark, randomUuid: () => string): VisualAnnotationItem {
  return { annotationItemId: `annotation-item-${randomUuid()}`, mark, interpretation: { state: 'uninterpreted' } };
}

const ACCESSIBLE_NOTE_PREVIEW_LENGTH = 60;

export function markAccessibleLabel(mark: VisualAnnotationMark): string {
  switch (mark.kind) {
    case 'point':
      return 'Point annotation';
    case 'rectangle':
      return 'Rectangle annotation';
    case 'line':
      return 'Line annotation';
    case 'arrow':
      return 'Arrow annotation';
    case 'note': {
      const preview = mark.text.length > ACCESSIBLE_NOTE_PREVIEW_LENGTH ? `${mark.text.slice(0, ACCESSIBLE_NOTE_PREVIEW_LENGTH)}…` : mark.text;
      return `Note annotation: ${preview}`;
    }
  }
}
