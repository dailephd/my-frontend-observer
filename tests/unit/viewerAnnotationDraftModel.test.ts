import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_INTERACTION_MODES,
  buildDrawnMark,
  isDrawingMode,
  isMarkInFrame,
  isPointInFrame,
  markAccessibleLabel,
  newDraftItem,
  translateMark,
} from '../../viewer/src/annotation/annotationGeometry.js';
import { screenPointToSvgSource } from '../../viewer/src/svg/sourceCoordinates.js';
import { annotationViewBelongsToObservation } from '../../viewer/src/hooks/useRuntimeAnnotations.js';
import { describeSaveFailure } from '../../viewer/src/hooks/useRuntimeAnnotationDraft.js';
import { describeAssociation } from '../../viewer/src/components/RuntimeAnnotationPanel.js';

const FRAME = { width: 800, height: 600 };

describe('annotation interaction modes', () => {
  it('exposes exactly the seven frozen modes, five of which draw', () => {
    expect(ANNOTATION_INTERACTION_MODES).toEqual(['select', 'pan', 'point', 'rectangle', 'line', 'arrow', 'note']);
    expect(ANNOTATION_INTERACTION_MODES.filter(isDrawingMode)).toEqual(['point', 'rectangle', 'line', 'arrow', 'note']);
  });
});

describe('frame validity', () => {
  it('accepts inclusive frame edges and rejects outside or non-finite points without clamping', () => {
    expect(isPointInFrame({ x: 0, y: 0 }, FRAME)).toBe(true);
    expect(isPointInFrame({ x: 800, y: 600 }, FRAME)).toBe(true);
    for (const point of [{ x: -0.01, y: 0 }, { x: 0, y: 600.5 }, { x: Number.NaN, y: 1 }, { x: 1, y: Number.POSITIVE_INFINITY }]) {
      expect(isPointInFrame(point, FRAME)).toBe(false);
    }
  });

  it('checks every part of a mark against the frame', () => {
    expect(isMarkInFrame({ kind: 'rectangle', x: 700, y: 500, width: 100, height: 100 }, FRAME)).toBe(true);
    expect(isMarkInFrame({ kind: 'rectangle', x: 701, y: 500, width: 100, height: 100 }, FRAME)).toBe(false);
    expect(isMarkInFrame({ kind: 'rectangle', x: 1, y: 1, width: 0, height: 10 }, FRAME)).toBe(false);
    expect(isMarkInFrame({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 801, y: 0 } }, FRAME)).toBe(false);
    expect(isMarkInFrame({ kind: 'note', anchor: { x: 10, y: 10 }, text: 'x' }, FRAME)).toBe(true);
  });
});

describe('drawn marks', () => {
  it('normalizes rectangle direction without rounding and refuses zero-area rectangles', () => {
    expect(buildDrawnMark('rectangle', { x: 250.5, y: 220.25 }, { x: 100, y: 120 }, '')).toEqual({ kind: 'rectangle', x: 100, y: 120, width: 150.5, height: 100.25 });
    expect(buildDrawnMark('rectangle', { x: 10, y: 10 }, { x: 10, y: 50 }, '')).toBeUndefined();
  });

  it('keeps exact line and arrow endpoints and refuses zero-length gestures', () => {
    expect(buildDrawnMark('arrow', { x: 5, y: 6 }, { x: 1, y: 2 }, '')).toEqual({ kind: 'arrow', start: { x: 5, y: 6 }, end: { x: 1, y: 2 } });
    expect(buildDrawnMark('line', { x: 5, y: 6 }, { x: 5, y: 6 }, '')).toBeUndefined();
  });

  it('creates points at the gesture start and notes only with bounded non-empty text', () => {
    expect(buildDrawnMark('point', { x: 3, y: 4 }, { x: 9, y: 9 }, '')).toEqual({ kind: 'point', x: 3, y: 4 });
    expect(buildDrawnMark('note', { x: 3, y: 4 }, { x: 3, y: 4 }, '')).toBeUndefined();
    expect(buildDrawnMark('note', { x: 3, y: 4 }, { x: 3, y: 4 }, 'x'.repeat(2001))).toBeUndefined();
    expect(buildDrawnMark('note', { x: 3, y: 4 }, { x: 3, y: 4 }, 'x'.repeat(2000))).toMatchObject({ kind: 'note', text: 'x'.repeat(2000) });
  });

  it('creates new items with a random Observer-owned id, no association, and uninterpreted state', () => {
    const item = newDraftItem({ kind: 'point', x: 1, y: 2 }, () => '123e4567-e89b-42d3-a456-426614174000');
    expect(item).toEqual({ annotationItemId: 'annotation-item-123e4567-e89b-42d3-a456-426614174000', mark: { kind: 'point', x: 1, y: 2 }, interpretation: { state: 'uninterpreted' } });
    expect('association' in item).toBe(false);
  });
});

describe('mark translation', () => {
  it('translates every mark kind rigidly by the source delta', () => {
    expect(translateMark({ kind: 'point', x: 1, y: 2 }, 10, 20)).toEqual({ kind: 'point', x: 11, y: 22 });
    expect(translateMark({ kind: 'rectangle', x: 1, y: 2, width: 30, height: 40 }, 0.5, -1)).toEqual({ kind: 'rectangle', x: 1.5, y: 1, width: 30, height: 40 });
    expect(translateMark({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }, 1, 1)).toEqual({ kind: 'line', start: { x: 1, y: 1 }, end: { x: 6, y: 6 } });
    expect(translateMark({ kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }, 1, 1)).toEqual({ kind: 'arrow', start: { x: 1, y: 1 }, end: { x: 6, y: 6 } });
    expect(translateMark({ kind: 'note', anchor: { x: 2, y: 2 }, text: 'keep' }, 3, 4)).toEqual({ kind: 'note', anchor: { x: 5, y: 6 }, text: 'keep' });
  });
});

describe('shared screen-to-source transform', () => {
  it('uses the inverse screen CTM of the SVG element', () => {
    const inverse = { tag: 'inverse' };
    const fakeSvg = {
      getScreenCTM: () => ({ inverse: () => inverse }),
      createSVGPoint: () => {
        const point = {
          x: 0,
          y: 0,
          matrixTransform: (matrix: unknown) => {
            expect(matrix).toBe(inverse);
            return { x: point.x / 2, y: point.y / 2 };
          },
        };
        return point;
      },
    } as unknown as SVGSVGElement;
    expect(screenPointToSvgSource(fakeSvg, 200, 100)).toEqual({ x: 100, y: 50 });
    expect(screenPointToSvgSource({ getScreenCTM: () => null } as unknown as SVGSVGElement, 1, 1)).toBeUndefined();
  });
});

describe('saved annotation membership and messages', () => {
  const view = { ok: true, annotation: {} as never, source: { status: 'available', family: 'observation', handle: 'observation:observations%2Fa' } };

  it('requires an available observation source that resolves to exactly the selected handle', () => {
    expect(annotationViewBelongsToObservation(view, 'observation:observations%2Fa')).toBe(true);
    expect(annotationViewBelongsToObservation(view, 'observation:observations%2Fb')).toBe(false);
    expect(annotationViewBelongsToObservation({ ...view, source: { status: 'unavailable' } }, 'observation:observations%2Fa')).toBe(false);
    expect(annotationViewBelongsToObservation({ ...view, source: { ...view.source, family: 'external-reference-imported' } }, 'observation:observations%2Fa')).toBe(false);
    expect(annotationViewBelongsToObservation({ ...view, ok: false }, 'observation:observations%2Fa')).toBe(false);
  });

  it('describes each Prompt 2 failure status honestly and bounds server detail', () => {
    expect(describeSaveFailure(403, undefined)).toContain('forbidden');
    expect(describeSaveFailure(404, undefined)).toContain('no longer exists');
    expect(describeSaveFailure(409, undefined)).toContain('Save conflict');
    expect(describeSaveFailure(413, undefined)).toContain('too large');
    expect(describeSaveFailure(422, 'bad')).toContain('canonical validation');
    expect(describeSaveFailure(500, undefined)).toContain('could not be persisted');
    expect(describeSaveFailure(422, 'x'.repeat(1000)).length).toBeLessThan(400);
  });

  it('labels marks and associations without inferring anything', () => {
    expect(markAccessibleLabel({ kind: 'rectangle', x: 0, y: 0, width: 1, height: 1 })).toBe('Rectangle annotation');
    expect(markAccessibleLabel({ kind: 'note', anchor: { x: 0, y: 0 }, text: 'y'.repeat(100) })).toBe(`Note annotation: ${'y'.repeat(60)}…`);
    expect(describeAssociation(undefined)).toBe('No association');
    expect(describeAssociation({ kind: 'runtime-target', target: 'workspace' })).toBe('Target association: workspace');
    expect(describeAssociation({ kind: 'runtime-relationship', relationshipKind: 'above', subjectTarget: 'header', relatedTarget: 'workspace' })).toBe('Relationship association: above (header → workspace)');
    expect(describeAssociation({ kind: 'runtime-relationship', relationshipKind: 'document-width-fits-viewport' })).toBe('Relationship association: document-width-fits-viewport');
  });
});
