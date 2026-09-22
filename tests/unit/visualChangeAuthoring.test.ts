import { describe, expect, it } from 'vitest';
import { parseCreateVisualChangeRequest, parseEmptyVisualChangeRequest, VISUAL_CHANGE_FAILURE_STATUS } from '../../src/viewerServer/visualChangeAuthoring.js';
import type { VisualChangeActualScope, VisualChangeReferenceScope } from '../../src/domain/visualChangeWorkflow.js';

const observation = { artifactId: 'observation', artifactPath: '.frontend-observer/evidence/observations/observation', observationId: 'observation', requestId: 'request' };
const actual: VisualChangeActualScope = { entryMode: 'actual-frontend', annotationId: 'annotation', annotationArtifactPath: '.frontend-observer/evidence/annotations/annotation', baselineObservation: observation, changeContract: { artifactId: 'contract', artifactPath: '.frontend-observer/evidence/contracts/contract', contractId: 'contract', contractRequestId: 'contract-request' } };
const reference: VisualChangeReferenceScope = { entryMode: 'reference', annotationId: 'annotation', annotationArtifactPath: '.frontend-observer/evidence/annotations/annotation', baselineObservation: observation, approvedReference: { artifactId: 'reference', artifactPath: '.frontend-observer/evidence/references/reference', referenceId: 'reference', referenceRequestId: 'reference-request' }, bindings: [{ referenceRegion: 'hero', runtimeTarget: 'main' }] };

describe('visual-change Viewer authoring adapter', () => {
  it.each([actual, reference])('accepts the closed create shape for $entryMode scope', (scope) => expect(parseCreateVisualChangeRequest({ scope })).toEqual({ ok: true, scope }));
  it.each([null, [], {}, { scope: actual, extra: true }, { scope: { entryMode: 'unknown' } }])('rejects malformed or open create bodies', (body) => expect(parseCreateVisualChangeRequest(body).ok).toBe(false));
  it('requires empty mutation bodies', () => { expect(parseEmptyVisualChangeRequest({})).toEqual({ ok: true }); expect(parseEmptyVisualChangeRequest({ baseline: 'alias' }).ok).toBe(false); expect(parseEmptyVisualChangeRequest([]).ok).toBe(false); });
  it('preserves the frozen application failure status mapping', () => {
    expect(VISUAL_CHANGE_FAILURE_STATUS).toMatchObject({ 'activation-not-configured': 409, 'activation-already-restored': 409, 'baseline-drift': 409, 'acceptance-drift': 409, 'check-scope-mismatch': 409, 'candidate-not-produced': 409, 'duplicate-attempt': 409, 'attempt-limit-reached': 409, 'project-config-invalid': 409, 'workflow-invalid': 422, 'workflow-reference-invalid': 422, 'project-config-write-failure': 500, 'workflow-persistence-failure': 500, 'partial-state-failure': 500 });
  });
});
