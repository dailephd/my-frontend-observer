import type { ReferenceRegion, ReferenceRegionRelationshipGraph } from '../types/reference.js';
import type { ZoomPanBinding } from '../hooks/useZoomPan.js';

export interface ReferenceOverlayToggles {
  regions: boolean;
  labels: boolean;
  relationships: boolean;
}

/**
 * Batch 5 reference-image SVG coordinate model (task §13): the `viewBox` is
 * the reference image's own pixel dimensions - never the candidate's runtime
 * CSS viewport, never devicePixelRatio-multiplied. The reference image
 * `<image>` fills that same viewBox. Each region rectangle uses its
 * canonical `{x, y, width, height}` unchanged - a genuinely different
 * coordinate domain from `TargetOverlaySvg`'s runtime-CSS-pixel viewBox, so
 * this is a distinct component rather than a parameterization of that one
 * (reusing it would silently conflate the two domains).
 */
export function ReferenceRegionOverlaySvg({
  imageUrl,
  imageWidth,
  imageHeight,
  regions,
  relationships,
  selected,
  onSelect,
  toggles,
  requirementRegionIds,
  highlightRegionIds,
  zoomPan,
}: {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  regions: ReferenceRegion[];
  relationships: ReferenceRegionRelationshipGraph | undefined;
  selected: string | undefined;
  onSelect: (id: string) => void;
  toggles: ReferenceOverlayToggles;
  /** Region ids referenced by at least one selected requirement - presentation-only emphasis, never a fidelity pass/fail signal (task §27). */
  requirementRegionIds?: ReadonlySet<string> | undefined;
  /** Batch 6 additive, optional: every region id an explicit `bound` binding result maps to the currently-selected runtime target (many-to-one reverse cross-selection, task §20) - never the single interactive `selected` region. */
  highlightRegionIds?: ReadonlySet<string> | undefined;
  /** Batch 6 additive, optional - see TargetOverlaySvg.tsx's identical prop. */
  zoomPan?: ZoomPanBinding | undefined;
}) {
  const byId = new Map(regions.map((r) => [r.id, r] as const));

  return (
    <svg
      className={`target-overlay-svg reference-region-overlay-svg${zoomPan?.isPannable ? ' target-overlay-svg--pannable' : ''}`}
      viewBox={zoomPan?.viewBox ?? `0 0 ${imageWidth} ${imageHeight}`}
      role="img"
      aria-label={`Reference image, ${imageWidth} by ${imageHeight} pixels`}
      preserveAspectRatio="xMidYMid meet"
      ref={zoomPan?.svgRef}
      {...(zoomPan?.pointerHandlers ?? {})}
    >
      <image href={imageUrl} x={0} y={0} width={imageWidth} height={imageHeight} preserveAspectRatio="none" />

      {toggles.relationships && relationships !== undefined
        ? relationships.pairwiseRelationships.map((rel) => {
            const a = byId.get(rel.subjectRegion);
            const b = byId.get(rel.relatedRegion);
            if (a === undefined || b === undefined) return null;
            const ax = a.rectangle.x + a.rectangle.width / 2;
            const ay = a.rectangle.y + a.rectangle.height / 2;
            const bx = b.rectangle.x + b.rectangle.width / 2;
            const by = b.rectangle.y + b.rectangle.height / 2;
            return (
              <line
                key={`${rel.kind}:${rel.subjectRegion}:${rel.relatedRegion}`}
                className="target-overlay-svg__relationship"
                x1={ax}
                y1={ay}
                x2={bx}
                y2={by}
                data-relationship-kind={rel.kind}
              />
            );
          })
        : null}

      {toggles.regions
        ? regions.map((region) => {
            const isSelected = region.id === selected;
            const hasRequirement = requirementRegionIds?.has(region.id) ?? false;
            const isHighlighted = !isSelected && (highlightRegionIds?.has(region.id) ?? false);
            return (
              <g key={region.id} data-region-id={region.id}>
                <rect
                  className={`target-overlay-svg__rect reference-region-overlay-svg__rect${isSelected ? ' target-overlay-svg__rect--selected' : ''}${isHighlighted ? ' target-overlay-svg__rect--highlighted' : ''}${hasRequirement ? ' reference-region-overlay-svg__rect--has-requirement' : ''}`}
                  data-region-id={region.id}
                  x={region.rectangle.x}
                  y={region.rectangle.y}
                  width={region.rectangle.width}
                  height={region.rectangle.height}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select reference region ${region.id}${isHighlighted ? ' (highlighted: related to current selection)' : ''}`}
                  aria-pressed={isSelected}
                  data-highlighted={isHighlighted ? 'true' : undefined}
                  onClick={() => onSelect(region.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(region.id);
                    }
                  }}
                />
                {toggles.labels ? (
                  <text className="target-overlay-svg__label" x={region.rectangle.x + 2} y={region.rectangle.y > 12 ? region.rectangle.y - 4 : region.rectangle.y + 12}>
                    {region.id}
                  </text>
                ) : null}
              </g>
            );
          })
        : null}
    </svg>
  );
}
