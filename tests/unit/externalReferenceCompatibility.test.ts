import { describe, expect, it } from 'vitest';
import { evaluateReferenceCandidateCompatibility } from '../../src/domain/externalReferenceCompatibility.js';
import { EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import type { ImportedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import type { ExternalReferenceApplicability } from '../../src/domain/externalReferenceApplicability.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import type { ExplicitStateDimensions } from '../../src/domain/explicitState.js';

function reference(applicability?: ExternalReferenceApplicability): ImportedExternalReferenceArtifact {
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: 'ref-req-1',
    referenceId: 'ref-req-1-instance-1',
    producer: { name: 'my-frontend-observer', version: '0.6.0' },
    provenance: { importedAt: '2026-01-01T00:00:00.000Z' },
    image: { path: 'reference.png', format: 'png', width: 1920, height: 1080, byteLength: 41, sha256: 'a'.repeat(64) },
    lifecycle: { state: 'imported' },
    diagnostics: [],
    completion: { state: 'complete' },
    ...(applicability !== undefined ? { applicability } : {}),
  };
}

function candidate(viewport: { width: number; height: number } = { width: 1280, height: 720 }, explicitState?: ExplicitStateDimensions): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: 'obs-1',
    requestId: 'req-1',
    producer: { name: PRODUCER_NAME, version: '0.7.0' },
    browser: { state: 'not-applicable' },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport,
      targets: [],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
      ...(explicitState !== undefined ? { explicitState } : {}),
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence: {},
    screenshot: { state: 'not-applicable' },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [],
  };
}

describe('evaluateReferenceCandidateCompatibility', () => {
  // Behavior A: matching applicable viewport is comparable.
  it('A: matching applicable viewport is comparable with a matched viewport dimension', () => {
    const ref = reference({ viewport: { width: 1280, height: 720 } });
    const cand = candidate({ width: 1280, height: 720 });
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    expect(result.compatibility.state).toBe('comparable');
    expect(result.compatibility.reasons.some((r) => r.code === 'viewport-mismatch')).toBe(false);
  });

  // Behavior B: mismatching applicable viewport is blocking.
  it('B: mismatching applicable viewport is a blocking incompatibility', () => {
    const ref = reference({ viewport: { width: 1280, height: 720 } });
    const cand = candidate({ width: 375, height: 812 });
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    expect(result.compatibility.state).toBe('incomparable');
    const reason = result.compatibility.reasons.find((r) => r.code === 'viewport-mismatch');
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('blocking');
    expect(reason?.referenceValue).toBe('1280x720');
    expect(reason?.candidateValue).toBe('375x812');
  });

  // Behavior C: matching theme is comparable.
  it('C: matching theme is assessed as matched (no theme-mismatch reason)', () => {
    const ref = reference({ theme: 'dark' });
    const cand = candidate(undefined, { theme: 'dark' });
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    expect(result.compatibility.reasons.some((r) => r.code === 'theme-mismatch')).toBe(false);
  });

  // Behavior D: mismatching theme is blocking.
  it('D: mismatching theme is a blocking incompatibility', () => {
    const ref = reference({ theme: 'dark' });
    const cand = candidate(undefined, { theme: 'light' });
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    expect(result.compatibility.state).toBe('incomparable');
    const reason = result.compatibility.reasons.find((r) => r.code === 'theme-mismatch');
    expect(reason?.severity).toBe('blocking');
    expect(reason?.referenceValue).toBe('dark');
    expect(reason?.candidateValue).toBe('light');
  });

  // Behavior E: matching/mismatching application state, blocking on mismatch.
  it('E: matching applicationState is assessed as matched; mismatching applicationState is blocking', () => {
    const refMatch = reference({ applicationState: 'cart-empty' });
    const candMatch = candidate(undefined, { applicationState: 'cart-empty' });
    expect(evaluateReferenceCandidateCompatibility(refMatch, candMatch).compatibility.reasons.some((r) => r.code === 'application-state-mismatch')).toBe(false);

    const refMismatch = reference({ applicationState: 'cart-empty' });
    const candMismatch = candidate(undefined, { applicationState: 'cart-full' });
    const result = evaluateReferenceCandidateCompatibility(refMismatch, candMismatch);
    expect(result.compatibility.state).toBe('incomparable');
    expect(result.compatibility.reasons.find((r) => r.code === 'application-state-mismatch')?.severity).toBe('blocking');
  });

  // Behavior F: authenticatedState matching/mismatching, blocking on mismatch, closed vocabulary only.
  it('F: matching authenticatedState is assessed as matched; mismatching authenticatedState is blocking', () => {
    const refMatch = reference({ authenticatedState: 'authenticated' });
    const candMatch = candidate(undefined, { authenticatedState: 'authenticated' });
    expect(evaluateReferenceCandidateCompatibility(refMatch, candMatch).compatibility.reasons.some((r) => r.code === 'authenticated-state-mismatch')).toBe(false);

    const refMismatch = reference({ authenticatedState: 'authenticated' });
    const candMismatch = candidate(undefined, { authenticatedState: 'unauthenticated' });
    const result = evaluateReferenceCandidateCompatibility(refMismatch, candMismatch);
    expect(result.compatibility.state).toBe('incomparable');
    expect(result.compatibility.reasons.find((r) => r.code === 'authenticated-state-mismatch')?.severity).toBe('blocking');
  });

  // Behavior G: reference constrains a dimension the candidate omits entirely - fail-closed unassessed, never treated as compatible.
  it('G: reference declares a dimension the candidate entirely lacks - unassessed, not compatible-by-default', () => {
    const ref = reference({ theme: 'dark' });
    const cand = candidate(undefined, undefined);
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    const reason = result.compatibility.reasons.find((r) => r.code === 'theme-unassessed');
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('unassessed');
    expect(result.compatibility.reasons.some((r) => r.code === 'theme-mismatch')).toBe(false);
  });

  // Behavior H: reference omits a dimension (no applicable viewport declared) - never a fabricated mismatch, just unassessed.
  it('H: reference omits applicable viewport entirely - unassessed, never a fabricated viewport-mismatch', () => {
    const ref = reference(undefined);
    const cand = candidate({ width: 1280, height: 720 });
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    const reason = result.compatibility.reasons.find((r) => r.code === 'viewport-unassessed');
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('unassessed');
    expect(result.compatibility.reasons.some((r) => r.code === 'viewport-mismatch')).toBe(false);
    expect(result.compatibility.state).toBe('comparable');
  });

  // Behavior I: both sides omit a state dimension - honest unassessed, never a fabricated equality.
  it('I: both reference and candidate omit applicationState - honest unassessed, never a fabricated match', () => {
    const ref = reference({ theme: 'dark' });
    const cand = candidate(undefined, { theme: 'dark' });
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    const reason = result.compatibility.reasons.find((r) => r.code === 'application-state-unassessed');
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('unassessed');
    expect(result.compatibility.reasons.some((r) => r.code === 'application-state-mismatch')).toBe(false);
  });

  it('is fully unassessed (never fabricated compatible or incompatible) when the reference declares no applicability at all', () => {
    const ref = reference(undefined);
    const cand = candidate({ width: 1280, height: 720 }, { theme: 'dark', authenticatedState: 'authenticated', applicationState: 'cart-empty' });
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    expect(result.compatibility.state).toBe('comparable');
    const codes = result.compatibility.reasons.map((r) => r.code);
    expect(codes).toEqual(['viewport-unassessed', 'theme-unassessed', 'authenticated-state-unassessed', 'application-state-unassessed']);
  });

  it('carries reference/candidate identity through into the result, distinct from any adequacy concern', () => {
    const ref = reference({ theme: 'dark' });
    const cand = candidate();
    const result = evaluateReferenceCandidateCompatibility(ref, cand);
    expect(result.referenceId).toBe(ref.referenceId);
    expect(result.referenceRequestId).toBe(ref.referenceRequestId);
    expect(result.candidateObservationId).toBe(cand.observationId);
    expect(result.candidateRequestId).toBe(cand.requestId);
  });

  it('is a pure function - identical inputs produce identical (deep-equal) results', () => {
    const ref = reference({ viewport: { width: 1280, height: 720 }, theme: 'dark' });
    const cand = candidate({ width: 375, height: 812 }, { theme: 'light' });
    const first = evaluateReferenceCandidateCompatibility(ref, cand);
    const second = evaluateReferenceCandidateCompatibility(ref, cand);
    expect(first).toEqual(second);
  });
});
