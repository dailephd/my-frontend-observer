import { describe, expect, it } from 'vitest';
import { isValidExternalReferenceArtifact, EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import type { ImportedExternalReferenceArtifact, ApprovedExternalReferenceArtifact } from '../../src/domain/externalReference.js';

function validImported(): ImportedExternalReferenceArtifact {
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: 'req-1',
    referenceId: 'req-1-instance-1',
    producer: { name: 'my-frontend-observer', version: '0.6.0' },
    provenance: { importedAt: '2026-01-01T00:00:00.000Z' },
    image: { path: 'reference.png', format: 'png', width: 800, height: 600, byteLength: 41, sha256: 'a'.repeat(64) },
    lifecycle: { state: 'imported' },
    diagnostics: [],
    completion: { state: 'complete' },
  };
}

function validApproved(): ApprovedExternalReferenceArtifact {
  const imported = validImported();
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: imported.referenceRequestId,
    referenceId: 'req-1-instance-2',
    producer: imported.producer,
    provenance: imported.provenance,
    sourceReference: {
      referenceId: imported.referenceId,
      referenceRequestId: imported.referenceRequestId,
      producer: imported.producer,
      schemaVersion: imported.schemaVersion,
      image: imported.image,
    },
    lifecycle: { state: 'approved', approvedAt: '2026-01-02T00:00:00.000Z' },
    diagnostics: [],
    completion: { state: 'complete' },
  };
}

describe('externalReference validator', () => {
  it('accepts a valid imported artifact and a valid approved artifact', () => {
    expect(isValidExternalReferenceArtifact(validImported())).toEqual({ valid: true });
    expect(isValidExternalReferenceArtifact(validApproved())).toEqual({ valid: true });
  });

  // TST-019: an unsupported/mismatched schemaVersion fails closed, never silently coerced.
  it('TST-019: rejects a mismatched schemaVersion', () => {
    const artifact = { ...validImported(), schemaVersion: '2.0.0' };
    expect(isValidExternalReferenceArtifact(artifact)).toEqual({ valid: false, reason: 'schemaVersion mismatch' });
  });

  it('rejects a mismatched artifactKind', () => {
    const artifact = { ...validImported(), artifactKind: 'my-frontend-observer/observation' };
    expect(isValidExternalReferenceArtifact(artifact).valid).toBe(false);
  });

  // TST-020: an 'imported' artifact carrying sourceReference, and an 'approved' artifact carrying image, are both rejected.
  it('TST-020: rejects an artifact that mixes the two lifecycle-variant-specific fields', () => {
    const importedWithSourceReference = { ...validImported(), sourceReference: validApproved().sourceReference };
    expect(isValidExternalReferenceArtifact(importedWithSourceReference)).toEqual({ valid: false, reason: 'an "imported" artifact must not carry sourceReference' });

    const approvedWithImage = { ...validApproved(), image: validImported().image };
    expect(isValidExternalReferenceArtifact(approvedWithImage)).toEqual({ valid: false, reason: 'an "approved" artifact must not carry image (it never owns a copy of the reference image)' });
  });

  it('rejects out-of-bound and non-integer image dimensions', () => {
    const zeroWidth = { ...validImported(), image: { ...validImported().image, width: 0 } };
    expect(isValidExternalReferenceArtifact(zeroWidth).valid).toBe(false);

    const overLimit = { ...validImported(), image: { ...validImported().image, width: 8193 } };
    expect(isValidExternalReferenceArtifact(overLimit).valid).toBe(false);

    const nonInteger = { ...validImported(), image: { ...validImported().image, height: 10.5 } };
    expect(isValidExternalReferenceArtifact(nonInteger).valid).toBe(false);
  });

  it('rejects an image path containing a path separator (never a nested/absolute path)', () => {
    const nested = { ...validImported(), image: { ...validImported().image, path: 'sub/reference.png' } };
    expect(isValidExternalReferenceArtifact(nested).valid).toBe(false);
  });

  it('rejects a "complete" completion state paired with a non-empty diagnostics array', () => {
    const artifact = { ...validImported(), diagnostics: [{ code: 'unsupported-image-format', severity: 'error', message: 'x' }] };
    expect(isValidExternalReferenceArtifact(artifact).valid).toBe(false);
  });

  it('rejects an empty/malformed producer', () => {
    const artifact = { ...validImported(), producer: { name: 'someone-else', version: '1.0.0' } };
    expect(isValidExternalReferenceArtifact(artifact).valid).toBe(false);
  });

  it('accepts and rejects supersedesReferenceId as appropriate', () => {
    const withValid = { ...validImported(), supersedesReferenceId: 'prior-reference-id' };
    expect(isValidExternalReferenceArtifact(withValid)).toEqual({ valid: true });

    const withEmpty = { ...validImported(), supersedesReferenceId: '' };
    expect(isValidExternalReferenceArtifact(withEmpty).valid).toBe(false);
  });

  // Behavior S: a Prompt 1 artifact without a `regions` field at all remains valid - the field is purely additive/optional.
  it('a legacy (Prompt 1) artifact with no regions field at all remains valid', () => {
    const legacy = validImported();
    expect('regions' in legacy).toBe(false);
    expect(isValidExternalReferenceArtifact(legacy)).toEqual({ valid: true });
  });

  it('accepts a valid regions array on an imported artifact, bounded by that artifact\'s own image dimensions (800x600)', () => {
    const withRegions = { ...validImported(), regions: [{ id: 'header', rectangle: { x: 0, y: 0, width: 100, height: 40 } }] };
    expect(isValidExternalReferenceArtifact(withRegions)).toEqual({ valid: true });
  });

  it('accepts a valid regions array on an approved artifact, bounded by sourceReference.image dimensions', () => {
    const withRegions = { ...validApproved(), regions: [{ id: 'header', rectangle: { x: 0, y: 0, width: 100, height: 40 } }] };
    expect(isValidExternalReferenceArtifact(withRegions)).toEqual({ valid: true });
  });

  it('rejects a region extending outside the artifact\'s own image bounds', () => {
    const outOfBounds = { ...validImported(), regions: [{ id: 'overflow', rectangle: { x: 750, y: 0, width: 100, height: 50 } }] };
    const result = isValidExternalReferenceArtifact(outOfBounds);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('regions:');
  });

  it('rejects a malformed regions value (not an array)', () => {
    const malformed = { ...validImported(), regions: { id: 'x' } };
    expect(isValidExternalReferenceArtifact(malformed).valid).toBe(false);
  });

  it('rejects duplicate region ids', () => {
    const duplicate = {
      ...validImported(),
      regions: [
        { id: 'header', rectangle: { x: 0, y: 0, width: 100, height: 40 } },
        { id: 'header', rectangle: { x: 0, y: 50, width: 100, height: 40 } },
      ],
    };
    expect(isValidExternalReferenceArtifact(duplicate).valid).toBe(false);
  });
});
