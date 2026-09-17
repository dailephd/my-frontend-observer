import { describe, expect, it } from 'vitest';
import {
  VISUAL_ANNOTATION_ARTIFACT_KIND,
  VISUAL_ANNOTATION_SCHEMA_VERSION,
  MAX_VISUAL_ANNOTATION_ITEMS,
  MAX_VISUAL_ANNOTATION_NOTE_LENGTH,
  isValidVisualAnnotationArtifact,
  isValidVisualAnnotationContent,
  renderVisualAnnotationOverlaySvg,
} from '../../src/domain/visualAnnotation.js';
import type { VisualAnnotationItem, VisualAnnotationMark, VisualAnnotationSource } from '../../src/domain/visualAnnotation.js';
import { buildArtifact, referenceRectangleItem, referenceSource, runtimeRectangleItem, runtimeSource } from './visualAnnotationFixtures.js';

function expectValid(source: VisualAnnotationSource, items: VisualAnnotationItem[]): void {
  const result = isValidVisualAnnotationArtifact(buildArtifact(source, items));
  expect(result).toEqual({ valid: true });
}

function expectInvalid(source: VisualAnnotationSource, items: unknown[]): void {
  expect(isValidVisualAnnotationContent(source, items).valid).toBe(false);
  // The artifact-level gate must reject the same content (built without rendering, which assumes valid input).
  const artifact = { ...buildArtifact(source, []), items };
  expect(isValidVisualAnnotationArtifact(artifact).valid).toBe(false);
}

function itemWithMark(mark: unknown): VisualAnnotationItem {
  return { annotationItemId: 'item-1', mark: mark as VisualAnnotationMark, interpretation: { state: 'uninterpreted' } };
}

function itemWithInterpretation(interpretation: unknown, base: VisualAnnotationItem = runtimeRectangleItem()): VisualAnnotationItem {
  return { ...base, interpretation: interpretation as VisualAnnotationItem['interpretation'] };
}

describe('visualAnnotation domain constants', () => {
  it('freezes the artifact kind, schema version, and bounds', () => {
    expect(VISUAL_ANNOTATION_ARTIFACT_KIND).toBe('my-frontend-observer/visual-annotation');
    expect(VISUAL_ANNOTATION_SCHEMA_VERSION).toBe('1.0.0');
    expect(MAX_VISUAL_ANNOTATION_ITEMS).toBe(100);
    expect(MAX_VISUAL_ANNOTATION_NOTE_LENGTH).toBe(2000);
  });
});

describe('isValidVisualAnnotationArtifact', () => {
  // A. valid runtime artifact
  it('A: accepts a runtime-observation artifact with a rectangle and runtime-target association', () => {
    expectValid(runtimeSource(), [runtimeRectangleItem()]);
  });

  // B. valid external-reference artifact
  it('B: accepts an external-reference artifact with a reference-region association', () => {
    expectValid(referenceSource(), [referenceRectangleItem()]);
  });

  it('accepts an approved external-reference source whose image is owned by the imported reference', () => {
    expectValid({ ...referenceSource(), referenceId: 'ref-request-1-instance-2', lifecycle: 'approved' }, [referenceRectangleItem()]);
  });

  it('accepts an empty item list', () => {
    expectValid(runtimeSource(), []);
  });

  it('accepts all five mark kinds', () => {
    const marks: VisualAnnotationMark[] = [
      { kind: 'point', x: 0, y: 0 },
      { kind: 'rectangle', x: 0, y: 0, width: 1280, height: 720 },
      { kind: 'line', start: { x: 1, y: 2 }, end: { x: 1280, y: 720 } },
      { kind: 'arrow', start: { x: 10.5, y: 20.25 }, end: { x: 30, y: 40 } },
      { kind: 'note', anchor: { x: 640, y: 360 }, text: 'move this' },
    ];
    expectValid(
      runtimeSource(),
      marks.map((mark, index) => ({ annotationItemId: `item-${index}`, mark, interpretation: { state: 'uninterpreted' } })),
    );
  });

  // C. cross-domain association rejection
  it('C: rejects a runtime source with a reference association and a reference source with a runtime association', () => {
    expectInvalid(runtimeSource(), [{ ...runtimeRectangleItem(), association: { kind: 'reference-region', regionId: 'hero' } }]);
    expectInvalid(referenceSource(), [{ ...referenceRectangleItem(), association: { kind: 'runtime-target', target: 'hero' } }]);
    expectInvalid(runtimeSource(), [
      { ...runtimeRectangleItem(), association: { kind: 'reference-relationship', subjectRegion: 'a', relatedRegion: 'b', relationship: 'above' } },
    ]);
    expectInvalid(referenceSource(), [
      { ...referenceRectangleItem(), association: { kind: 'runtime-relationship', relationshipKind: 'above', subjectTarget: 'a', relatedTarget: 'b' } },
    ]);
  });

  it('validates association shapes against the canonical relationship vocabularies', () => {
    const runtime = runtimeRectangleItem();
    expectValid(runtimeSource(), [{ ...runtime, association: { kind: 'runtime-relationship', relationshipKind: 'left-of', subjectTarget: 'a', relatedTarget: 'b' } }]);
    expectValid(runtimeSource(), [{ ...runtime, association: { kind: 'runtime-relationship', relationshipKind: 'document-width-fits-viewport' } }]);
    expectInvalid(runtimeSource(), [{ ...runtime, association: { kind: 'runtime-target', target: '' } }]);
    expectInvalid(runtimeSource(), [{ ...runtime, association: { kind: 'runtime-relationship', relationshipKind: 'left-of', subjectTarget: '', relatedTarget: 'b' } }]);
    expectInvalid(runtimeSource(), [{ ...runtime, association: { kind: 'runtime-relationship', relationshipKind: 'left-of', subjectTarget: 'a' } }]);
    expectInvalid(runtimeSource(), [{ ...runtime, association: { kind: 'runtime-relationship', relationshipKind: 'left-of', subjectTarget: 'a', relatedTarget: 'a' } }]);
    expectInvalid(runtimeSource(), [{ ...runtime, association: { kind: 'runtime-relationship', relationshipKind: 'near', subjectTarget: 'a', relatedTarget: 'b' } }]);

    const reference = referenceRectangleItem();
    expectValid(referenceSource(), [{ ...reference, association: { kind: 'reference-relationship', subjectRegion: 'a', relatedRegion: 'b', relationship: 'above' } }]);
    expectInvalid(referenceSource(), [{ ...reference, association: { kind: 'reference-region', regionId: '' } }]);
    expectInvalid(referenceSource(), [{ ...reference, association: { kind: 'reference-relationship', subjectRegion: 'a', relatedRegion: 'a', relationship: 'above' } }]);
    expectInvalid(referenceSource(), [{ ...reference, association: { kind: 'reference-relationship', subjectRegion: 'a', relatedRegion: '', relationship: 'above' } }]);
    expectInvalid(referenceSource(), [
      { ...reference, association: { kind: 'reference-relationship', subjectRegion: 'a', relatedRegion: 'b', relationship: 'document-width-fits-viewport' } },
    ]);
  });

  // D. cross-domain intent rejection
  it('D: rejects runtime-only and reference-only intents in the other source context', () => {
    const region = { id: 'hero', rectangle: { x: 0, y: 0, width: 10, height: 10 } };
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'candidate', intent: { kind: 'reference-region', mode: 'create', region } })]);
    expectInvalid(runtimeSource(), [
      itemWithInterpretation({
        state: 'candidate',
        intent: { kind: 'reference-requirement', requirement: { category: 'requested', subject: { kind: 'region-property', region: 'hero', property: 'x' }, tolerance: { kind: 'exact' } } },
      }),
    ]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'candidate', intent: { kind: 'asset-sensitive' } })]);
    expectInvalid(referenceSource(), [
      itemWithInterpretation({ state: 'candidate', intent: { kind: 'change', operation: 'move', category: 'requested' } }, referenceRectangleItem()),
    ]);
  });

  it('accepts every intent that belongs to its source context', () => {
    const region = { id: 'hero', rectangle: { x: 0, y: 0, width: 10, height: 10 } };
    const confirmedAt = '2026-09-17T00:00:00.000Z';
    expectValid(runtimeSource(), [itemWithInterpretation({ state: 'confirmed', intent: { kind: 'inspect' }, confirmedAt })]);
    expectValid(runtimeSource(), [
      itemWithInterpretation({
        state: 'confirmed',
        intent: { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'hero', property: 'x' } },
        confirmedAt,
      }),
    ]);
    expectValid(runtimeSource(), [
      itemWithInterpretation({ state: 'candidate', intent: { kind: 'change', operation: 'resize', category: 'expected-dependent', expectedDependentMode: 'permitted' } }),
    ]);
    const reference = referenceRectangleItem();
    expectValid(referenceSource(), [itemWithInterpretation({ state: 'candidate', intent: { kind: 'inspect' } }, reference)]);
    expectValid(referenceSource(), [itemWithInterpretation({ state: 'confirmed', intent: { kind: 'reference-region', mode: 'create', region }, confirmedAt }, reference)]);
    expectValid(referenceSource(), [
      itemWithInterpretation(
        {
          state: 'candidate',
          intent: { kind: 'reference-requirement', requirement: { category: 'protected', subject: { kind: 'region-property', region: 'hero', property: 'width' }, tolerance: { kind: 'exact' } } },
        },
        reference,
      ),
    ]);
    expectValid(referenceSource(), [itemWithInterpretation({ state: 'candidate', intent: { kind: 'asset-sensitive', regionId: 'hero' } }, reference)]);
    expectValid(referenceSource(), [itemWithInterpretation({ state: 'candidate', intent: { kind: 'asset-sensitive' } }, reference)]);
  });

  it('delegates embedded contract primitives, regions, and requirements to their canonical validators', () => {
    const reference = referenceRectangleItem();
    expectInvalid(runtimeSource(), [
      itemWithInterpretation({ state: 'candidate', intent: { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'target-absent', target: 'hero' } } }),
    ]);
    expectInvalid(referenceSource(), [
      itemWithInterpretation({ state: 'candidate', intent: { kind: 'reference-region', mode: 'create', region: { id: 'bad id!', rectangle: { x: 0, y: 0, width: 1, height: 1 } } } }, reference),
    ]);
    expectInvalid(referenceSource(), [
      itemWithInterpretation({ state: 'candidate', intent: { kind: 'reference-region', mode: 'create', region: { id: 'hero', rectangle: { x: 1500, y: 0, width: 200, height: 1 } } } }, reference),
    ]);
    expectInvalid(referenceSource(), [
      itemWithInterpretation({ state: 'candidate', intent: { kind: 'reference-region', mode: 'replace', region: { id: 'hero', rectangle: { x: 0, y: 0, width: 1, height: 1 } } } }, reference),
    ]);
    expectInvalid(referenceSource(), [
      itemWithInterpretation(
        { state: 'candidate', intent: { kind: 'reference-requirement', requirement: { category: 'requested', subject: { kind: 'region-property', region: 'hero', property: 'x' } } } },
        reference,
      ),
    ]);
    expectInvalid(referenceSource(), [itemWithInterpretation({ state: 'candidate', intent: { kind: 'asset-sensitive', regionId: '' } }, reference)]);
    expectInvalid(runtimeSource(), [
      itemWithInterpretation({ state: 'candidate', intent: { kind: 'change', operation: 'resize', category: 'expected-dependent' } }),
    ]);
    expectInvalid(runtimeSource(), [
      itemWithInterpretation({ state: 'candidate', intent: { kind: 'change', operation: 'resize', category: 'requested', expectedDependentMode: 'required' } }),
    ]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'candidate', intent: { kind: 'change', operation: 'recolor', category: 'requested' } })]);
  });

  // E. mark bounds
  it('E: rejects out-of-frame and non-finite geometry without clamping', () => {
    const source = runtimeSource(); // 1280x720
    const invalidMarks: unknown[] = [
      { kind: 'point', x: -1, y: 10 },
      { kind: 'point', x: 10, y: -0.5 },
      { kind: 'point', x: 1280.01, y: 10 },
      { kind: 'point', x: 10, y: 721 },
      { kind: 'rectangle', x: 10, y: 10, width: 0, height: 10 },
      { kind: 'rectangle', x: 10, y: 10, width: 10, height: -5 },
      { kind: 'rectangle', x: 1200, y: 10, width: 81, height: 10 },
      { kind: 'rectangle', x: 10, y: 700, width: 10, height: 21 },
      { kind: 'line', start: { x: 0, y: 0 }, end: { x: 1281, y: 0 } },
      { kind: 'line', start: { x: -1, y: 0 }, end: { x: 10, y: 10 } },
      { kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 10, y: 800 } },
      { kind: 'note', anchor: { x: 2000, y: 10 }, text: 'outside' },
      { kind: 'point', x: Number.NaN, y: 10 },
      { kind: 'point', x: 10, y: Number.POSITIVE_INFINITY },
      { kind: 'rectangle', x: 10, y: 10, width: Number.NaN, height: 10 },
      { kind: 'arrow', start: { x: 0, y: 0 }, end: { x: Number.NEGATIVE_INFINITY, y: 0 } },
      { kind: 'freehand', points: [] },
      { kind: 'polygon', points: [] },
    ];
    for (const mark of invalidMarks) {
      expect(isValidVisualAnnotationContent(source, [itemWithMark(mark)]).valid, JSON.stringify(mark)).toBe(false);
    }
    // Rectangle touching the frame edges exactly is inside the frame.
    expectValid(source, [itemWithMark({ kind: 'rectangle', x: 1180, y: 620, width: 100, height: 100 })]);
  });

  // F. note bounds
  it('F: enforces note text bounds', () => {
    const note = (text: string): VisualAnnotationItem => itemWithMark({ kind: 'note', anchor: { x: 1, y: 1 }, text });
    expectValid(runtimeSource(), [note('x'.repeat(2000))]);
    expectInvalid(runtimeSource(), [note('x'.repeat(2001))]);
    expectInvalid(runtimeSource(), [note('')]);
  });

  // G. collection bound
  it('G: accepts exactly 100 items and rejects 101', () => {
    const items = (count: number): VisualAnnotationItem[] => Array.from({ length: count }, (_, index) => runtimeRectangleItem(`item-${index}`));
    expectValid(runtimeSource(), items(100));
    expectInvalid(runtimeSource(), items(101));
  });

  // H. duplicate annotationItemId
  it('H: rejects duplicate annotationItemId values', () => {
    expectInvalid(runtimeSource(), [runtimeRectangleItem('same'), runtimeRectangleItem('same')]);
    expectInvalid(runtimeSource(), [runtimeRectangleItem('')]);
  });

  // I. interpretation states
  it('I: validates uninterpreted, candidate, and confirmed states and rejects malformed mixtures', () => {
    const intent = { kind: 'inspect' };
    expectValid(runtimeSource(), [itemWithInterpretation({ state: 'uninterpreted' })]);
    expectValid(runtimeSource(), [itemWithInterpretation({ state: 'candidate', intent })]);
    expectValid(runtimeSource(), [itemWithInterpretation({ state: 'confirmed', intent, confirmedAt: '2026-09-17T00:00:00.000Z' })]);

    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'uninterpreted', intent })]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'uninterpreted', confirmedAt: '2026-09-17T00:00:00.000Z' })]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'candidate' })]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'candidate', intent, confirmedAt: '2026-09-17T00:00:00.000Z' })]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'confirmed', intent })]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'confirmed', intent, confirmedAt: '' })]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'confirmed', confirmedAt: '2026-09-17T00:00:00.000Z' })]);
    expectInvalid(runtimeSource(), [itemWithInterpretation({ state: 'approved', intent })]);
  });

  // J. authored `unexpected`
  it('J: never accepts "unexpected" as an authored change category', () => {
    for (const state of ['candidate', 'confirmed'] as const) {
      const interpretation = {
        state,
        intent: { kind: 'change', operation: 'move', category: 'unexpected' },
        ...(state === 'confirmed' ? { confirmedAt: '2026-09-17T00:00:00.000Z' } : {}),
      };
      expectInvalid(runtimeSource(), [itemWithInterpretation(interpretation)]);
    }
  });

  // K. remove behavior
  it('K: rejects a remove intent carrying a fabricated contract primitive and accepts remove without one', () => {
    const confirmedAt = '2026-09-17T00:00:00.000Z';
    expectInvalid(runtimeSource(), [
      itemWithInterpretation({
        state: 'confirmed',
        intent: { kind: 'change', operation: 'remove', category: 'requested', contractPrimitive: { kind: 'target-visible', target: 'hero' } },
        confirmedAt,
      }),
    ]);
    expectValid(runtimeSource(), [itemWithInterpretation({ state: 'confirmed', intent: { kind: 'change', operation: 'remove', category: 'requested' }, confirmedAt })]);
  });

  it('rejects malformed sources, including cross-domain coordinate kinds and non-canonical identity', () => {
    const cases: unknown[] = [
      { ...runtimeSource(), coordinateSpace: { kind: 'reference-image-px', width: 1280, height: 720 } },
      { ...referenceSource(), coordinateSpace: { kind: 'runtime-css-px', width: 1600, height: 900 } },
      { ...runtimeSource(), coordinateSpace: { kind: 'runtime-css-px', width: 0, height: 720 } },
      { ...runtimeSource(), coordinateSpace: { kind: 'runtime-css-px', width: 1280, height: Number.POSITIVE_INFINITY } },
      { ...runtimeSource(), observationId: '' },
      { ...runtimeSource(), requestId: '' },
      { ...runtimeSource(), observationSchemaVersion: '1.0.0' },
      { ...runtimeSource(), screenshot: { path: '../screenshot.png' } },
      { ...runtimeSource(), screenshot: { path: 'C:\\evidence\\screenshot.png' } },
      { ...runtimeSource(), screenshot: { path: '/abs/screenshot.png' } },
      { ...runtimeSource(), alias: 'baseline' },
      { ...runtimeSource(), viewerPort: 4173 },
      { ...referenceSource(), referenceSchemaVersion: '2.0.0' },
      { ...referenceSource(), lifecycle: 'superseded' },
      { ...referenceSource(), imageSha256: 'A'.repeat(64) },
      { ...referenceSource(), imageSha256: 'abc' },
      { ...referenceSource(), imageOwnerReferenceId: 'someone-else' },
      { ...referenceSource(), lifecycle: 'approved' },
      { ...referenceSource(), referenceId: '' },
      { ...runtimeSource(), kind: 'comparison' },
    ];
    for (const source of cases) {
      expect(isValidVisualAnnotationContent(source, []).valid, JSON.stringify(source)).toBe(false);
    }
  });

  it('rejects malformed artifact envelopes', () => {
    const source = runtimeSource();
    const items = [runtimeRectangleItem()];
    const base = buildArtifact(source, items);
    const cases: unknown[] = [
      { ...base, artifactKind: 'my-frontend-observer/observation' },
      { ...base, schemaVersion: '2.0.0' },
      { ...base, annotationRequestId: '' },
      { ...base, annotationId: '' },
      { ...base, annotationId: '../escape' },
      { ...base, supersedesAnnotationId: '' },
      { ...base, supersedesAnnotationId: base.annotationId },
      { ...base, producer: { name: 'someone-else', version: '1.0.0' } },
      { ...base, overlay: { ...base.overlay, path: 'overlay.svg' } },
      { ...base, overlay: { ...base.overlay, path: '../annotation-overlay.svg' } },
      { ...base, overlay: { ...base.overlay, format: 'png' } },
      { ...base, overlay: { ...base.overlay, width: 1279 } },
      { ...base, overlay: { ...base.overlay, height: 721 } },
      { ...base, overlay: { ...base.overlay, sha256: base.overlay.sha256.toUpperCase() } },
      { ...base, provenance: { createdAt: '', origin: 'viewer' } },
      { ...base, provenance: { createdAt: '2026-09-17T00:00:00.000Z', origin: 'cli' } },
      { ...base, viewerUrl: 'http://127.0.0.1:4173' },
      null,
      [],
    ];
    for (const artifact of cases) {
      expect(isValidVisualAnnotationArtifact(artifact).valid, JSON.stringify(artifact)).toBe(false);
    }
    expect(isValidVisualAnnotationArtifact({ ...base, supersedesAnnotationId: 'previous-annotation' })).toEqual({ valid: true });
  });
});

describe('renderVisualAnnotationOverlaySvg', () => {
  const allMarks: VisualAnnotationItem[] = [
    itemWithMark({ kind: 'point', x: 5, y: 6 }),
    { ...itemWithMark({ kind: 'rectangle', x: 10, y: 20, width: 30, height: 40 }), annotationItemId: 'item-2' },
    { ...itemWithMark({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }), annotationItemId: 'item-3' },
    { ...itemWithMark({ kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }), annotationItemId: 'item-4' },
    { ...itemWithMark({ kind: 'note', anchor: { x: 50, y: 60 }, text: 'Move right' }), annotationItemId: 'item-5' },
  ];

  it('uses the source frame for the root element and renders every mark kind in item order', () => {
    const svg = renderVisualAnnotationOverlaySvg(runtimeSource(), allMarks);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">')).toBe(true);
    expect(svg.endsWith('</svg>\n')).toBe(true);
    const circleIndex = svg.indexOf('<circle cx="5" cy="6"');
    const rectIndex = svg.indexOf('<rect x="10" y="20" width="30" height="40"');
    const lineIndex = svg.indexOf('<line x1="0" y1="0" x2="100" y2="0"');
    const arrowHeadIndex = svg.indexOf('<polygon points="100,0 88,6 88,-6"');
    const noteIndex = svg.indexOf('<text x="58" y="52"');
    expect([circleIndex, rectIndex, lineIndex, arrowHeadIndex, noteIndex].every((index) => index > 0)).toBe(true);
    expect(circleIndex < rectIndex && rectIndex < lineIndex && lineIndex < arrowHeadIndex && arrowHeadIndex < noteIndex).toBe(true);
    expect(svg).toContain('>Move right</text>');

    const reordered = renderVisualAnnotationOverlaySvg(runtimeSource(), [...allMarks].reverse());
    expect(reordered).not.toBe(svg);
  });

  it('is deterministic and independent of interpretation state, associations, and item ids', () => {
    const first = renderVisualAnnotationOverlaySvg(referenceSource(), [referenceRectangleItem()]);
    const second = renderVisualAnnotationOverlaySvg(referenceSource(), [referenceRectangleItem()]);
    expect(first).toBe(second);
    const reinterpreted = renderVisualAnnotationOverlaySvg(referenceSource(), [
      {
        annotationItemId: 'another-id',
        mark: referenceRectangleItem().mark,
        interpretation: { state: 'confirmed', intent: { kind: 'asset-sensitive' }, confirmedAt: '2026-09-17T00:00:00.000Z' },
      },
    ]);
    expect(reinterpreted).toBe(first);
    expect(first).toContain('viewBox="0 0 1600 900"');
  });

  it('renders marks only: no image, script, foreignObject, external reference, or event handler', () => {
    const svg = renderVisualAnnotationOverlaySvg(runtimeSource(), allMarks);
    for (const forbidden of ['<image', '<script', 'foreignObject', 'href', 'url(', '@import', 'onload', 'onclick', 'marker', 'id=', 'confirmed', 'uninterpreted', 'hero']) {
      expect(svg).not.toContain(forbidden);
    }
  });

  it('escapes user-controlled note text so it stays inert', () => {
    const svg = renderVisualAnnotationOverlaySvg(runtimeSource(), [
      itemWithMark({ kind: 'note', anchor: { x: 1, y: 1 }, text: `<script>alert("x")</script> & test 'q'` }),
    ]);
    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; test &apos;q&apos;');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('</script>');
  });

  it('omits the arrowhead for a zero-length arrow rather than producing non-finite geometry', () => {
    const svg = renderVisualAnnotationOverlaySvg(runtimeSource(), [itemWithMark({ kind: 'arrow', start: { x: 3, y: 3 }, end: { x: 3, y: 3 } })]);
    expect(svg).not.toContain('<polygon');
    expect(svg).not.toContain('NaN');
  });
});
