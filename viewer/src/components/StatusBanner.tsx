import type { ViewerStatusState } from '../hooks/useViewerStatus.js';

/** Honest server/session status - never renders as if a session/root were active when the local viewer server cannot be reached. */
export function StatusBanner({ status }: { status: ViewerStatusState }) {
  if (status.state === 'loading') {
    return <div className="status-banner status-banner--loading">Connecting to local viewer server…</div>;
  }

  if (status.state === 'unavailable') {
    return (
      <div className="status-banner status-banner--error" role="alert">
        Local viewer server unavailable ({status.message}). Start it with{' '}
        <code>my-frontend-observer view --root &lt;evidence-root&gt;</code> and reload this page.
      </div>
    );
  }

  return (
    <div className="status-banner status-banner--ok">
      <span className="status-banner__root">Root: {status.status.root}</span>
      <span className="status-banner__version">
        {status.status.producer.name} {status.status.producer.version} · viewer protocol {status.status.viewerProtocolVersion}
      </span>
    </div>
  );
}
