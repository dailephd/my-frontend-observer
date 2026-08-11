import { describe, expect, it } from 'vitest';
import { ARTIFACT_KIND, SCHEMA_VERSION, getProducerInfo, isValidObservationArtifact } from '../../src/domain/schema.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';

function minimalValidArtifact(): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: 'req-nonce',
    requestId: 'req',
    producer: { name: 'my-frontend-observer', version: '0.0.0' },
    browser: { state: 'not-applicable' },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport: { width: 1280, height: 720 },
      targets: [],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
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

describe('isValidObservationArtifact', () => {
  it('TST-017: enforces artifactKind and schemaVersion literals', () => {
    expect(isValidObservationArtifact(minimalValidArtifact())).toEqual({ valid: true });
    expect(isValidObservationArtifact({ ...minimalValidArtifact(), artifactKind: 'other/kind' }).valid).toBe(false);
    expect(isValidObservationArtifact({ ...minimalValidArtifact(), schemaVersion: '1.0.1' }).valid).toBe(false);
  });

  it('TST-018: schemaVersion is fixed at "1.1.0" independent of the package version', () => {
    const producerInfo = getProducerInfo();
    expect(SCHEMA_VERSION).toBe('1.1.0');
    expect(typeof producerInfo.version).toBe('string');
    expect(producerInfo.version.length).toBeGreaterThan(0);
  });

  it('TST-019: rejects "complete" completion paired with non-empty diagnostics', () => {
    const artifact = { ...minimalValidArtifact(), diagnostics: [{ code: 'partial-evidence', severity: 'warning', message: 'x' }] };
    expect(isValidObservationArtifact(artifact).valid).toBe(false);
  });

  it('TST-020: rejects diagnostics with an unknown code or a mismatched severity', () => {
    const unknownCode = {
      ...minimalValidArtifact(),
      diagnostics: [{ code: 'not-a-real-code', severity: 'error', message: 'x' }],
      completion: { state: 'fatal', diagnostics: [{ code: 'not-a-real-code', severity: 'error', message: 'x' }] },
    };
    const wrongSeverity = {
      ...minimalValidArtifact(),
      diagnostics: [{ code: 'readiness-timeout', severity: 'error', message: 'x' }],
      completion: { state: 'fatal', diagnostics: [{ code: 'readiness-timeout', severity: 'error', message: 'x' }] },
    };
    expect(isValidObservationArtifact(unknownCode).valid).toBe(false);
    expect(isValidObservationArtifact(wrongSeverity).valid).toBe(false);
  });

  it('TST-021: rejects an invalid pageEvidence entry', () => {
    const artifact = { ...minimalValidArtifact(), pageEvidence: { title: { state: 'available', source: 'browser' } } };
    expect(isValidObservationArtifact(artifact).valid).toBe(false);
  });

  it('TST-022: rejects malformed screenshot or artifactReferences shapes', () => {
    const badScreenshot = { ...minimalValidArtifact(), screenshot: { engine: 'chromium' } };
    const badReference = { ...minimalValidArtifact(), artifactReferences: [{ path: 'a.png' }] };
    expect(isValidObservationArtifact(badScreenshot).valid).toBe(false);
    expect(isValidObservationArtifact(badReference).valid).toBe(false);
  });

  it('TST-023: rejects a non-boolean limits.truncated', () => {
    const artifact = { ...minimalValidArtifact(), limits: { truncated: 'yes', omittedFields: [], omittedTargets: [] } };
    expect(isValidObservationArtifact(artifact).valid).toBe(false);
  });

  describe('v0.2 target resolution evidence', () => {
    function withResolution(resolutionValue: unknown) {
      return {
        ...minimalValidArtifact(),
        targetEvidence: {
          header: {
            resolution: { state: 'available', source: 'derived', value: resolutionValue, derivedFrom: ['locator-attempts'] },
            tag: { state: 'not-applicable' },
            geometry: { state: 'not-applicable' },
            style: { state: 'not-applicable' },
            layout: { state: 'not-applicable' },
            visibility: { state: 'not-applicable' },
            semantics: { state: 'not-applicable' },
          },
        },
      };
    }

    it('produces schemaVersion 1.1.0 for a freshly built artifact', () => {
      expect(minimalValidArtifact().schemaVersion).toBe('1.1.0');
    });

    it('accepts a valid matched resolution with a selected locator', () => {
      const artifact = withResolution({
        selectionMethod: 'ordered-locators',
        selectionStatus: 'matched',
        selectedLocatorKind: 'css',
        selectedLocatorIndex: 1,
        usedFallback: true,
        confidence: 'exact',
        attempts: [
          { locatorIndex: 0, locatorKind: 'role', status: 'not-found' },
          { locatorIndex: 1, locatorKind: 'css', status: 'matched', matchCount: 1 },
        ],
      });
      expect(isValidObservationArtifact(artifact).valid).toBe(true);
    });

    it('accepts a valid not-found resolution with no selected locator', () => {
      const artifact = withResolution({
        selectionMethod: 'ordered-locators',
        selectionStatus: 'not-found',
        usedFallback: false,
        confidence: 'none',
        attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'not-found', matchCount: 0 }],
      });
      expect(isValidObservationArtifact(artifact).valid).toBe(true);
    });

    it('rejects a numeric or otherwise malformed confidence', () => {
      const artifact = withResolution({
        selectionMethod: 'ordered-locators',
        selectionStatus: 'not-found',
        usedFallback: false,
        confidence: 0.83,
        attempts: [],
      });
      expect(isValidObservationArtifact(artifact).valid).toBe(false);
    });

    it('rejects selectedLocatorKind/selectedLocatorIndex present when not matched', () => {
      const artifact = withResolution({
        selectionMethod: 'ordered-locators',
        selectionStatus: 'not-found',
        selectedLocatorKind: 'css',
        selectedLocatorIndex: 0,
        usedFallback: false,
        confidence: 'none',
        attempts: [],
      });
      expect(isValidObservationArtifact(artifact).valid).toBe(false);
    });

    it('rejects a matched resolution missing selectedLocatorKind/selectedLocatorIndex', () => {
      const artifact = withResolution({
        selectionMethod: 'ordered-locators',
        selectionStatus: 'matched',
        usedFallback: false,
        confidence: 'exact',
        attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'matched', matchCount: 1 }],
      });
      expect(isValidObservationArtifact(artifact).valid).toBe(false);
    });

    it('rejects usedFallback inconsistent with selectedLocatorIndex', () => {
      const artifact = withResolution({
        selectionMethod: 'ordered-locators',
        selectionStatus: 'matched',
        selectedLocatorKind: 'css',
        selectedLocatorIndex: 1,
        usedFallback: false,
        confidence: 'exact',
        attempts: [
          { locatorIndex: 0, locatorKind: 'css', status: 'not-found', matchCount: 0 },
          { locatorIndex: 1, locatorKind: 'css', status: 'matched', matchCount: 1 },
        ],
      });
      expect(isValidObservationArtifact(artifact).valid).toBe(false);
    });

    it('rejects malformed attempt evidence (unknown status, non-increasing locatorIndex)', () => {
      const badStatus = withResolution({
        selectionMethod: 'ordered-locators',
        selectionStatus: 'not-found',
        usedFallback: false,
        confidence: 'none',
        attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'bogus-status' }],
      });
      const badOrder = withResolution({
        selectionMethod: 'ordered-locators',
        selectionStatus: 'not-found',
        usedFallback: false,
        confidence: 'none',
        attempts: [
          { locatorIndex: 1, locatorKind: 'css', status: 'not-found' },
          { locatorIndex: 0, locatorKind: 'css', status: 'not-found' },
        ],
      });
      expect(isValidObservationArtifact(badStatus).valid).toBe(false);
      expect(isValidObservationArtifact(badOrder).valid).toBe(false);
    });
  });
});
