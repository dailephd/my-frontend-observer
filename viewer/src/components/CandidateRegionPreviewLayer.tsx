import type { ReferenceRegion } from '../types/reference.js';
import type { VisualAnnotationItem } from '../types/visualAnnotation.js';
import { regionIntentOf } from '../annotation/referenceIntent.js';

/**
 * v0.9 Batch 4: display-only preview of candidate region proposals inside the
 * reference SVG (reference-image pixels). A create proposal shows its
 * candidate rectangle. A refine proposal shows the persisted source region's
 * original rectangle and the candidate replacement side by side, with
 * distinct classes and text, so the proposed change is auditable. It never
 * intercepts pointer input and never changes the source regions.
 */
export function CandidateRegionPreviewLayer({ items, sourceRegions }: { items: readonly VisualAnnotationItem[]; sourceRegions: readonly ReferenceRegion[] }) {
  const byId = new Map(sourceRegions.map((region) => [region.id, region] as const));
  return (
    <g className="candidate-region-preview" aria-hidden="true">
      {items.map((item) => {
        const intent = regionIntentOf(item);
        if (intent === undefined) return null;
        const { rectangle } = intent.region;
        const state = item.interpretation.state;
        const original = intent.mode === 'refine' ? byId.get(intent.region.id) : undefined;
        return (
          <g key={item.annotationItemId} data-candidate-region-id={intent.region.id} data-candidate-mode={intent.mode} data-candidate-state={state}>
            {original === undefined ? null : (
              <rect
                className="candidate-region-preview__rect candidate-region-preview__rect--refine-original"
                data-preview-role="original"
                x={original.rectangle.x}
                y={original.rectangle.y}
                width={original.rectangle.width}
                height={original.rectangle.height}
              />
            )}
            <rect
              className={`candidate-region-preview__rect candidate-region-preview__rect--${intent.mode === 'create' ? 'create' : 'refine-candidate'}`}
              data-preview-role="candidate"
              x={rectangle.x}
              y={rectangle.y}
              width={rectangle.width}
              height={rectangle.height}
            />
            <text className="candidate-region-preview__label" x={rectangle.x + 2} y={rectangle.y + rectangle.height - 4}>
              {intent.mode === 'create' ? 'candidate new' : 'candidate refine'} {intent.region.id} ({state})
            </text>
          </g>
        );
      })}
    </g>
  );
}
