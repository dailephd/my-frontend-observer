import type { ArtifactDetailState } from '../hooks/useArtifactDetail.js';
import type { EvidenceMetadataRecord } from '../hooks/useEvidenceIndex.js';
import type { ObservationArtifact } from '../types/observation.js';
import type { ComparisonArtifact } from '../types/comparison.js';
import type { FrontendContractEvaluationArtifact } from '../types/contracts.js';
import { ObservationWorkspace } from './ObservationWorkspace.js';
import { ComparisonWorkspace } from './ComparisonWorkspace.js';
import { EvaluationWorkspace } from './EvaluationWorkspace.js';

/**
 * v0.8 Batch 2 established the on-demand full-artifact loading boundary
 * (raw-JSON preview for every family). Batch 3 added a real visual workspace
 * for the `observation` family. Batch 4 adds one for `comparison`
 * (before/after side-by-side, canonical differences/relationship-changes)
 * and `contract-evaluation` (canonical clause results/overall verdict).
 * Every other family (external-reference) still shows the bounded raw-JSON
 * preview - that visualization remains out of scope until a later batch.
 */
export function ArtifactPreview({ selected, detail }: { selected: EvidenceMetadataRecord | undefined; detail: ArtifactDetailState }) {
  if (selected === undefined) {
    return <p className="placeholder-note">Select evidence from the list to load it on demand. No observation, comparison, contract, or reference viewing is implemented yet.</p>;
  }

  if (selected.supportState !== 'supported') {
    return (
      <div className="artifact-preview__unsupported" role="alert">
        <p>
          <strong>{selected.family}</strong> at <code>{selected.relativeDir}</code> is not loadable: {selected.message ?? selected.supportState}
        </p>
      </div>
    );
  }

  if (detail.state === 'idle' || detail.handle !== selected.handle) {
    return <p className="placeholder-note">Preparing to load…</p>;
  }

  if (detail.state === 'loading') {
    return <p className="placeholder-note">Loading {selected.family}…</p>;
  }

  if (detail.state === 'error') {
    return (
      <div className="artifact-preview__error" role="alert">
        Failed to load {selected.family}: {detail.message}
      </div>
    );
  }

  if (detail.family === 'observation') {
    return <ObservationWorkspace handle={detail.handle} artifact={detail.artifact as ObservationArtifact} />;
  }

  if (detail.family === 'comparison') {
    return <ComparisonWorkspace handle={detail.handle} artifact={detail.artifact as ComparisonArtifact} />;
  }

  if (detail.family === 'contract-evaluation') {
    return <EvaluationWorkspace handle={detail.handle} artifact={detail.artifact as FrontendContractEvaluationArtifact} />;
  }

  return (
    <div className="artifact-preview">
      <p className="artifact-preview__summary">
        Loaded <strong>{detail.family}</strong> ({selected.logicalId ?? selected.relativeDir}) on demand.
      </p>
      <pre className="artifact-preview__raw">{JSON.stringify(detail.artifact, null, 2)}</pre>
    </div>
  );
}
