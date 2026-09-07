import { useArtifactDetail } from '../hooks/useArtifactDetail.js';
import { orderedTargets } from '../observation/targetOrder.js';
import { TargetOverlaySvg } from './TargetOverlaySvg.js';
import type { OverlayToggles } from './TargetOverlaySvg.js';
import type { ObservationArtifact, LayoutRelationshipGraph } from '../types/observation.js';
import type { LinkStatus } from '../types/contracts.js';

/**
 * Batch 4: the before/after visual pane, built entirely from Batch 3's
 * existing lower-level primitives (`useArtifactDetail`, `orderedTargets`,
 * `TargetOverlaySvg`) - no second screenshot-loading, coordinate-transform,
 * or geometry-rendering implementation. `relationships` is the comparison
 * artifact's own persisted `relationshipsBefore`/`relationshipsAfter`
 * (never recomputed via `deriveLayoutRelationships`).
 */
export function ComparisonObservationPane({
  label,
  link,
  selectedTarget,
  onSelectTarget,
  relationships,
  toggles,
  highlightNames,
}: {
  label: string;
  link: LinkStatus;
  selectedTarget: string | undefined;
  onSelectTarget: (name: string) => void;
  relationships: LayoutRelationshipGraph | undefined;
  toggles: OverlayToggles;
  highlightNames?: ReadonlySet<string> | undefined;
}) {
  const handle = link.status === 'resolved' ? link.handle : undefined;
  const detail = useArtifactDetail(handle);

  return (
    <div className="comparison-pane">
      <h4 className="comparison-pane__label">{label}</h4>
      {link.status === 'missing' ? (
        <p className="placeholder-note">Source observation not found under this evidence root.</p>
      ) : link.status === 'ambiguous' ? (
        <p className="inspector__error" role="alert">
          Source observation is ambiguous ({link.count} exact matches found) - refusing to guess.
        </p>
      ) : detail.state === 'idle' || detail.state === 'loading' || detail.handle !== handle ? (
        <p className="placeholder-note">Loading…</p>
      ) : detail.state === 'error' ? (
        <p className="inspector__error" role="alert">
          Failed to load: {detail.message}
        </p>
      ) : (
        <TargetOverlaySvg
          artifact={detail.artifact as ObservationArtifact}
          screenshotUrl={`/api/media/${handle}/screenshot`}
          targets={orderedTargets(detail.artifact as ObservationArtifact)}
          relationships={relationships}
          selected={selectedTarget}
          onSelect={onSelectTarget}
          toggles={toggles}
          highlightNames={highlightNames}
        />
      )}
    </div>
  );
}
