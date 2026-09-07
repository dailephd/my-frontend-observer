import type { ObservationArtifact, LayoutRelationshipGraph, TargetGeometry } from '../types/observation.js';
import type { OrderedTarget } from '../observation/targetOrder.js';

export interface OverlayToggles {
  geometry: boolean;
  labels: boolean;
  relationships: boolean;
}

function geometryOf(target: OrderedTarget): TargetGeometry | undefined {
  if (!target.hasGeometry || target.record === undefined) return undefined;
  const field = target.record.geometry;
  return field.state === 'available' || field.state === 'partial' ? field.value : undefined;
}

/**
 * SVG coordinate model (Batch 3 coordinate audit -
 * docs/reports/v0.8-observation-svg-inspection-batch3.md): the `viewBox` is
 * the observation's own canonical requested viewport
 * (`requestConfig.viewport`, CSS pixels) - the exact coordinate frame
 * `getBoundingClientRect()` already used when this evidence was captured.
 * The screenshot `<image>` is placed to exactly fill that same viewBox.
 * Target rectangles use `geometry.x/y/width/height` completely unchanged -
 * no rounding, no devicePixelRatio multiplication, no clamping. Geometry
 * partially outside the viewBox is drawn at its real coordinates; the SVG
 * root's default `overflow: hidden` clips the *display* only, never the
 * underlying evidence value.
 */
export function TargetOverlaySvg({
  artifact,
  screenshotUrl,
  targets,
  relationships,
  selected,
  onSelect,
  toggles,
}: {
  artifact: ObservationArtifact;
  screenshotUrl: string;
  targets: OrderedTarget[];
  relationships: LayoutRelationshipGraph | undefined;
  selected: string | undefined;
  onSelect: (name: string) => void;
  toggles: OverlayToggles;
}) {
  const { width, height } = artifact.requestConfig.viewport;

  const geometryByName = new Map<string, TargetGeometry>();
  for (const t of targets) {
    const g = geometryOf(t);
    if (g !== undefined) geometryByName.set(t.name, g);
  }

  return (
    <svg
      className="target-overlay-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Observation viewport, ${width} by ${height} CSS pixels`}
      preserveAspectRatio="xMidYMid meet"
    >
      <image href={screenshotUrl} x={0} y={0} width={width} height={height} preserveAspectRatio="none" />

      {toggles.relationships && relationships !== undefined
        ? relationships.pairwiseRelationships.map((rel) => {
            const a = geometryByName.get(rel.subjectTarget);
            const b = geometryByName.get(rel.relatedTarget);
            if (a === undefined || b === undefined) return null; // never fabricate geometry for a non-geometric relationship
            const ax = a.x + a.width / 2;
            const ay = a.y + a.height / 2;
            const bx = b.x + b.width / 2;
            const by = b.y + b.height / 2;
            return (
              <line
                key={`${rel.kind}:${rel.subjectTarget}:${rel.relatedTarget}`}
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

      {toggles.geometry
        ? targets.map((t) => {
            const g = geometryOf(t);
            if (g === undefined) return null;
            const isSelected = t.name === selected;
            return (
              <g key={t.name} data-target-name={t.name}>
                <rect
                  className={`target-overlay-svg__rect${isSelected ? ' target-overlay-svg__rect--selected' : ''}`}
                  data-target-name={t.name}
                  x={g.x}
                  y={g.y}
                  width={g.width}
                  height={g.height}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select target ${t.name}`}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(t.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(t.name);
                    }
                  }}
                />
                {toggles.labels ? (
                  <text className="target-overlay-svg__label" x={g.x + 2} y={g.y > 12 ? g.y - 4 : g.y + 12}>
                    {t.name}
                  </text>
                ) : null}
              </g>
            );
          })
        : null}
    </svg>
  );
}
