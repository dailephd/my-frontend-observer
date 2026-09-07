import { useState } from 'react';
import { useViewerStatus } from './hooks/useViewerStatus.js';
import { useEvidenceIndex } from './hooks/useEvidenceIndex.js';
import type { EvidenceMetadataRecord } from './hooks/useEvidenceIndex.js';
import { useArtifactDetail } from './hooks/useArtifactDetail.js';
import { StatusBanner } from './components/StatusBanner.js';
import { InstallButton } from './components/InstallButton.js';
import { EvidenceList } from './components/EvidenceList.js';
import { ArtifactPreview } from './components/ArtifactPreview.js';

/**
 * Batch 1 established the shell/session foundation. Batch 2 adds the
 * metadata-first evidence index and on-demand artifact loading proved here -
 * still no screenshot/SVG/comparison/reference visualization (Batch 3+).
 */
export default function App() {
  const status = useViewerStatus();
  const index = useEvidenceIndex();
  const [selected, setSelected] = useState<EvidenceMetadataRecord | undefined>(undefined);
  const detail = useArtifactDetail(selected?.supportState === 'supported' ? selected.handle : undefined);

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__identity">
          <span className="app-shell__title">my-frontend-observer</span>
          <span className="app-shell__subtitle">Local Observation Viewer</span>
        </div>
        <InstallButton />
      </header>

      <StatusBanner status={status} />

      <div className="app-shell__body">
        <nav className="app-shell__nav" aria-label="Evidence navigation">
          <EvidenceList index={index} selectedHandle={selected?.handle} onSelect={setSelected} />
        </nav>

        <main className="app-shell__workspace" aria-label="Visual inspection workspace">
          <ArtifactPreview selected={selected} detail={detail} />
        </main>

        <aside className="app-shell__details" aria-label="Details and diagnostics">
          {selected === undefined ? (
            <p className="placeholder-note">Details and diagnostics for the selected evidence will appear here.</p>
          ) : (
            <dl className="evidence-details">
              <dt>Family</dt>
              <dd>{selected.family}</dd>
              <dt>Support state</dt>
              <dd>{selected.supportState}</dd>
              {selected.schemaVersion !== undefined ? (
                <>
                  <dt>Schema version</dt>
                  <dd>{selected.schemaVersion}</dd>
                </>
              ) : null}
              {selected.completion !== undefined ? (
                <>
                  <dt>Completion</dt>
                  <dd>{selected.completion.state}</dd>
                </>
              ) : null}
              {selected.media !== undefined && selected.media.length > 0 ? (
                <>
                  <dt>Media</dt>
                  <dd>{selected.media.map((m) => `${m.role}: ${m.available ? 'available' : 'unavailable'}`).join(', ')}</dd>
                </>
              ) : null}
              {selected.relatedIds !== undefined ? (
                <>
                  <dt>Related evidence</dt>
                  <dd>
                    {Object.entries(selected.relatedIds).map(([key, value]) => (
                      <div key={key}>
                        {key}: {value}
                      </div>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
          )}
        </aside>
      </div>
    </div>
  );
}
