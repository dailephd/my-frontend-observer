import { useViewerStatus } from './hooks/useViewerStatus.js';
import { StatusBanner } from './components/StatusBanner.js';
import { InstallButton } from './components/InstallButton.js';

/**
 * Batch 1 viewer shell only: identity, connection/session status, and three
 * honest placeholder regions (navigation, workspace, diagnostics). No
 * evidence indexing, artifact reading, or fabricated observation/reference
 * data exists yet - that begins in Batch 2 onward.
 */
export default function App() {
  const status = useViewerStatus();

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
          <p className="placeholder-note">Evidence navigation will appear here once indexing is implemented (v0.8 Batch 2+).</p>
        </nav>

        <main className="app-shell__workspace" aria-label="Visual inspection workspace">
          <p className="placeholder-note">Select evidence to inspect it here. No observation, comparison, contract, or reference viewing is implemented yet.</p>
        </main>

        <aside className="app-shell__details" aria-label="Details and diagnostics">
          <p className="placeholder-note">Details and diagnostics for the selected evidence will appear here in a later batch.</p>
        </aside>
      </div>
    </div>
  );
}
