import { useState } from 'react';
import { useArtifactDetail } from '../hooks/useArtifactDetail.js';
import type { LinkStatus } from '../types/context.js';

/**
 * Batch 7 read-only raw structured Observer evidence panel (task §26/§60):
 * reuses the existing Batch 2 `GET /api/artifacts/<handle>` (via the
 * existing `useArtifactDetail` hook) - never a second full-artifact
 * retrieval mechanism, never a local filesystem read, never an editable
 * view. Displays the exact JSON already returned by that route, the same
 * way `ArtifactPreview.tsx`'s generic fallback already does for families
 * with no dedicated workspace.
 */
export function RawEvidenceViewer({ label, link }: { label: string; link: LinkStatus | undefined }) {
  const [open, setOpen] = useState(false);
  const handle = link?.status === 'resolved' ? link.handle : undefined;
  const detail = useArtifactDetail(open ? handle : undefined);

  if (link === undefined) return null;

  if (link.status === 'missing') {
    return (
      <p className="placeholder-note">
        {label}: no exact match found under this evidence root.
      </p>
    );
  }
  if (link.status === 'ambiguous') {
    return (
      <p className="inspector__error" role="alert">
        {label}: ambiguous ({link.count} exact matches found) - refusing to guess.
      </p>
    );
  }

  return (
    <div className="raw-evidence-viewer">
      <button type="button" onClick={() => setOpen((v) => !v)}>
        {open ? `Hide raw structured evidence: ${label}` : `View raw structured evidence: ${label}`}
      </button>
      {open ? (
        detail.state === 'loading' || detail.state === 'idle' ? (
          <p className="placeholder-note">Loading…</p>
        ) : detail.state === 'error' ? (
          <p className="inspector__error" role="alert">
            Failed to load: {detail.message}
          </p>
        ) : (
          <pre className="artifact-preview__raw">{JSON.stringify(detail.artifact, null, 2)}</pre>
        )
      ) : null}
    </div>
  );
}
