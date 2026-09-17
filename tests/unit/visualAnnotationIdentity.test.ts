import { describe, expect, it } from 'vitest';
import { buildVisualAnnotationRequestIdentity, buildVisualAnnotationInstanceIdentity } from '../../src/domain/visualAnnotationIdentity.js';
import type { VisualAnnotationItem, VisualAnnotationSource } from '../../src/domain/visualAnnotation.js';
import { referenceSource, runtimeRectangleItem, runtimeSource } from './visualAnnotationFixtures.js';

function twoItems(): VisualAnnotationItem[] {
  return [
    runtimeRectangleItem('item-1'),
    { annotationItemId: 'item-2', mark: { kind: 'point', x: 10, y: 10 }, interpretation: { state: 'candidate', intent: { kind: 'inspect' } } },
  ];
}

describe('visualAnnotationIdentity', () => {
  it('produces a lowercase SHA-256 hex request identity', () => {
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('identical semantic content produces the identical request identity', () => {
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems())).toBe(buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems()));
    expect(buildVisualAnnotationRequestIdentity(referenceSource(), [])).toBe(buildVisualAnnotationRequestIdentity(referenceSource(), []));
  });

  it('object property insertion order does not change identity', () => {
    const source = runtimeSource();
    const reorderedSource: VisualAnnotationSource = {
      coordinateSpace: { height: 720, width: 1280, kind: 'runtime-css-px' },
      screenshot: { path: 'screenshot.png' },
      observationSchemaVersion: source.observationSchemaVersion,
      requestId: source.requestId,
      observationId: source.observationId,
      kind: 'runtime-observation',
    };
    const reorderedItem: VisualAnnotationItem = {
      interpretation: { state: 'uninterpreted' },
      association: { target: 'hero', kind: 'runtime-target' },
      mark: { height: 200, width: 300, y: 50, x: 100, kind: 'rectangle' },
      annotationItemId: 'item-1',
    };
    expect(buildVisualAnnotationRequestIdentity(reorderedSource, [reorderedItem])).toBe(buildVisualAnnotationRequestIdentity(source, [runtimeRectangleItem('item-1')]));
  });

  it('item array order changes identity', () => {
    const items = twoItems();
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), [...items].reverse())).not.toBe(buildVisualAnnotationRequestIdentity(runtimeSource(), items));
  });

  it('source identity changes identity', () => {
    const base = buildVisualAnnotationRequestIdentity(runtimeSource(), []);
    expect(buildVisualAnnotationRequestIdentity({ ...runtimeSource(), observationId: 'another-observation' }, [])).not.toBe(base);
    expect(buildVisualAnnotationRequestIdentity({ ...runtimeSource(), coordinateSpace: { kind: 'runtime-css-px', width: 1024, height: 720 } }, [])).not.toBe(base);
    expect(buildVisualAnnotationRequestIdentity(referenceSource(), [])).not.toBe(base);
  });

  it('coordinate changes change identity', () => {
    const base = buildVisualAnnotationRequestIdentity(runtimeSource(), [runtimeRectangleItem()]);
    const moved: VisualAnnotationItem = { ...runtimeRectangleItem(), mark: { kind: 'rectangle', x: 101, y: 50, width: 300, height: 200 } };
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), [moved])).not.toBe(base);
  });

  it('association changes change identity', () => {
    const base = buildVisualAnnotationRequestIdentity(runtimeSource(), [runtimeRectangleItem()]);
    const retargeted: VisualAnnotationItem = { ...runtimeRectangleItem(), association: { kind: 'runtime-target', target: 'footer' } };
    const { association: _omitted, ...unbound } = runtimeRectangleItem();
    void _omitted;
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), [retargeted])).not.toBe(base);
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), [unbound])).not.toBe(base);
  });

  it('interpretation changes change identity', () => {
    const base = buildVisualAnnotationRequestIdentity(runtimeSource(), [runtimeRectangleItem()]);
    const candidate: VisualAnnotationItem = { ...runtimeRectangleItem(), interpretation: { state: 'candidate', intent: { kind: 'inspect' } } };
    const confirmed: VisualAnnotationItem = { ...runtimeRectangleItem(), interpretation: { state: 'confirmed', intent: { kind: 'inspect' }, confirmedAt: '2026-09-17T00:00:00.000Z' } };
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), [candidate])).not.toBe(base);
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), [confirmed])).not.toBe(buildVisualAnnotationRequestIdentity(runtimeSource(), [candidate]));
  });

  it('supersedesAnnotationId changes identity', () => {
    const base = buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems());
    const revision = buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems(), 'previous-annotation');
    expect(revision).not.toBe(base);
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems(), 'another-previous-annotation')).not.toBe(revision);
    expect(buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems(), undefined)).toBe(base);
  });

  it('operational output location and timestamps do not participate in identity', async () => {
    const before = buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems());
    // The function accepts no path, cwd, alias, port, or timestamp; calling it at a different time
    // (and conceptually for a different output location) must yield the same identity.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const after = buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems());
    expect(after).toBe(before);
    expect(buildVisualAnnotationRequestIdentity.length).toBe(3);
  });

  it('instance identity is fresh per call and prefixed by the request identity', () => {
    const requestId = buildVisualAnnotationRequestIdentity(runtimeSource(), twoItems());
    const first = buildVisualAnnotationInstanceIdentity(requestId);
    const second = buildVisualAnnotationInstanceIdentity(requestId);
    expect(first).not.toBe(second);
    expect(first).toMatch(new RegExp(`^${requestId}-[0-9a-f]{32}$`));
    expect(second).toMatch(new RegExp(`^${requestId}-[0-9a-f]{32}$`));
  });
});
