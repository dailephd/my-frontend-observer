import { useEffect, useState } from 'react';
import type { ObservationArtifact } from '../types/observation.js';
import { orderedTargets } from '../observation/targetOrder.js';
import { useObservationRelationships } from '../hooks/useObservationRelationships.js';
import { TargetList } from './TargetList.js';
import { TargetOverlaySvg } from './TargetOverlaySvg.js';
import type { OverlayToggles } from './TargetOverlaySvg.js';
import { ObservationInspector } from './ObservationInspector.js';

/**
 * Batch 3 observation visual workspace: screenshot + SVG target overlay +
 * target list + inspector, all driven by the already-fetched full
 * `ObservationArtifact` (`/api/artifacts/<handle>`, Batch 2, unchanged) plus
 * one additive canonical-relationship fetch
 * (`/api/observations/<handle>/relationships`). The screenshot itself loads
 * through the existing Batch 2 media endpoint - never a local path, never
 * base64-embedded.
 */
export function ObservationWorkspace({ handle, artifact }: { handle: string; artifact: ObservationArtifact }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [toggles, setToggles] = useState<OverlayToggles>({ geometry: true, labels: true, relationships: true });
  const relationships = useObservationRelationships(handle);

  // Selection is presentation-only state; changing observation must not carry a stale selection from a different artifact forward.
  useEffect(() => {
    setSelected(undefined);
  }, [handle]);

  const targets = orderedTargets(artifact);
  const screenshotUrl = `/api/media/${handle}/screenshot`;

  return (
    <div className="observation-workspace">
      <div className="observation-workspace__toolbar" role="group" aria-label="Overlay toggles">
        <label>
          <input type="checkbox" checked={toggles.geometry} onChange={(e) => setToggles((t) => ({ ...t, geometry: e.target.checked }))} />
          Target geometry
        </label>
        <label>
          <input type="checkbox" checked={toggles.labels} onChange={(e) => setToggles((t) => ({ ...t, labels: e.target.checked }))} disabled={!toggles.geometry} />
          Labels
        </label>
        <label>
          <input type="checkbox" checked={toggles.relationships} onChange={(e) => setToggles((t) => ({ ...t, relationships: e.target.checked }))} />
          Relationships
        </label>
      </div>
      <div className="observation-workspace__panes">
        <div className="observation-workspace__targets">
          <TargetList targets={targets} selected={selected} onSelect={setSelected} />
        </div>
        <div className="observation-workspace__visual">
          <TargetOverlaySvg
            artifact={artifact}
            screenshotUrl={screenshotUrl}
            targets={targets}
            relationships={relationships.state === 'available' ? relationships.graph : undefined}
            selected={selected}
            onSelect={setSelected}
            toggles={toggles}
          />
        </div>
        <div className="observation-workspace__inspector">
          <ObservationInspector artifact={artifact} selectedTargetName={selected} relationships={relationships} />
        </div>
      </div>
    </div>
  );
}
