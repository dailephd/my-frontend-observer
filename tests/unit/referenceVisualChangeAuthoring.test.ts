import { describe, expect, it } from 'vitest';
import { parseApproveReferenceRequest } from '../../src/viewerServer/referenceApproval.js';
import { parseStartReferenceVisualChangeRequest } from '../../src/viewerServer/referenceVisualChangeAuthoring.js';
import { buildVisualChangeRequestIdentity } from '../../src/domain/visualChangeWorkflowIdentity.js';
import type { VisualChangeReferenceScope } from '../../src/domain/visualChangeWorkflow.js';

const scope = (): VisualChangeReferenceScope => ({ entryMode: 'reference', annotationId: 'annotation-1', annotationArtifactPath: '.frontend-observer/evidence/annotations/annotation-1', baselineObservation: { artifactId: 'observation-1', observationId: 'observation-1', requestId: 'observation-request-1', artifactPath: '.frontend-observer/evidence/observations/observation-1' }, approvedReference: { artifactId: 'reference-1', referenceId: 'reference-1', referenceRequestId: 'reference-request-1', artifactPath: '.frontend-observer/evidence/references/reference-1' }, bindings: [{ referenceRegion: 'hero', runtimeTarget: 'main' }] });

describe('Batch 5 closed reference authoring requests', () => {
  it('accepts only the empty approval object', () => {
    expect(parseApproveReferenceRequest({})).toEqual({ ok: true });
    expect(parseApproveReferenceRequest({ projectRoot: 'x' }).ok).toBe(false);
    expect(parseApproveReferenceRequest([]).ok).toBe(false);
  });

  it('accepts exactly the four start fields and rejects activation/path injection', () => {
    const request = { annotationHandle: 'visual-annotation:a', itemIds: ['item-1'], baselineObservationHandle: 'observation:b', bindings: [{ referenceRegion: 'hero', runtimeTarget: 'main' }] };
    expect(parseStartReferenceVisualChangeRequest(request)).toEqual({ ok: true, request });
    expect(parseStartReferenceVisualChangeRequest({ ...request, activate: true }).ok).toBe(false);
    expect(parseStartReferenceVisualChangeRequest({ ...request, projectRoot: 'C:/secret' }).ok).toBe(false);
    expect(parseStartReferenceVisualChangeRequest({ ...request, itemIds: [] }).ok).toBe(false);
  });
});

describe('Batch 5 request identity proofs', () => {
  it.each([
    ['approved reference', (value: VisualChangeReferenceScope) => ({ ...value, approvedReference: { ...value.approvedReference, artifactId: 'reference-2', referenceId: 'reference-2' } })],
    ['binding', (value: VisualChangeReferenceScope) => ({ ...value, bindings: [{ referenceRegion: 'hero', runtimeTarget: 'content' }] })],
    ['baseline observation', (value: VisualChangeReferenceScope) => ({ ...value, baselineObservation: { ...value.baselineObservation, artifactId: 'observation-2', observationId: 'observation-2' } })],
    ['annotation revision', (value: VisualChangeReferenceScope) => ({ ...value, annotationId: 'annotation-2', annotationArtifactPath: '.frontend-observer/evidence/annotations/annotation-2' })],
  ])('changes identity when %s changes', (_label, mutate) => {
    const initial = scope();
    expect(buildVisualChangeRequestIdentity(mutate(initial))).not.toBe(buildVisualChangeRequestIdentity(initial));
  });
});
