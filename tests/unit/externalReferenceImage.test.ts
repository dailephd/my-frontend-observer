import { describe, expect, it } from 'vitest';
import {
  detectExternalReferenceImageFormat,
  readExternalReferenceImageDimensions,
  isValidExternalReferenceImageDimensions,
  fileExtensionForFormat,
  EXTERNAL_REFERENCE_MIN_DIMENSION_PX,
  EXTERNAL_REFERENCE_MAX_DIMENSION_PX,
} from '../../src/domain/externalReferenceImage.js';
import { buildMinimalPng, buildMinimalJpeg, buildMinimalWebp, buildTruncatedPng, buildTruncatedJpeg, buildUnsupportedWebpChunk, buildUnrecognizedBytes } from './externalReferenceImageFixtures.js';

describe('externalReferenceImage', () => {
  // TST-001: format detection from magic bytes for all three supported formats.
  it('TST-001: detects png/jpeg/webp from magic bytes', () => {
    expect(detectExternalReferenceImageFormat(buildMinimalPng(10, 10))).toBe('png');
    expect(detectExternalReferenceImageFormat(buildMinimalJpeg(10, 10))).toBe('jpeg');
    expect(detectExternalReferenceImageFormat(buildMinimalWebp(10, 10))).toBe('webp');
  });

  // TST-002: unrecognized/truncated bytes never fabricate a format.
  it('TST-002: returns undefined for unrecognized or too-short bytes', () => {
    expect(detectExternalReferenceImageFormat(buildUnrecognizedBytes())).toBeUndefined();
    expect(detectExternalReferenceImageFormat(new Uint8Array([0x89, 0x50]))).toBeUndefined();
    expect(detectExternalReferenceImageFormat(new Uint8Array())).toBeUndefined();
  });

  // TST-003: dimension parsing returns the exact encoded width/height for each format.
  it('TST-003: reads exact width/height for each supported format', () => {
    expect(readExternalReferenceImageDimensions(buildMinimalPng(37, 41), 'png')).toEqual({ width: 37, height: 41 });
    expect(readExternalReferenceImageDimensions(buildMinimalJpeg(123, 456), 'jpeg')).toEqual({ width: 123, height: 456 });
    expect(readExternalReferenceImageDimensions(buildMinimalWebp(800, 600), 'webp')).toEqual({ width: 800, height: 600 });
  });

  // TST-004: truncated/malformed headers of a genuinely supported format never fabricate a 0x0 dimension.
  it('TST-004: returns undefined (never a fabricated dimension) for a truncated or unrecognized-chunk header', () => {
    expect(readExternalReferenceImageDimensions(buildTruncatedPng(), 'png')).toBeUndefined();
    expect(readExternalReferenceImageDimensions(buildTruncatedJpeg(), 'jpeg')).toBeUndefined();
    expect(readExternalReferenceImageDimensions(buildUnsupportedWebpChunk(), 'webp')).toBeUndefined();
  });

  // TST-005: dimension bounds are checked inclusively at both ends, plus non-integer rejection.
  it('TST-005: validates dimension boundaries inclusively', () => {
    expect(isValidExternalReferenceImageDimensions({ width: EXTERNAL_REFERENCE_MIN_DIMENSION_PX, height: EXTERNAL_REFERENCE_MIN_DIMENSION_PX })).toBe(true);
    expect(isValidExternalReferenceImageDimensions({ width: EXTERNAL_REFERENCE_MAX_DIMENSION_PX, height: EXTERNAL_REFERENCE_MAX_DIMENSION_PX })).toBe(true);
    expect(isValidExternalReferenceImageDimensions({ width: EXTERNAL_REFERENCE_MIN_DIMENSION_PX - 1, height: 10 })).toBe(false);
    expect(isValidExternalReferenceImageDimensions({ width: EXTERNAL_REFERENCE_MAX_DIMENSION_PX + 1, height: 10 })).toBe(false);
    expect(isValidExternalReferenceImageDimensions({ width: 10.5, height: 10 })).toBe(false);
  });

  it('fileExtensionForFormat maps jpeg to "jpg" and the others to themselves', () => {
    expect(fileExtensionForFormat('png')).toBe('png');
    expect(fileExtensionForFormat('jpeg')).toBe('jpg');
    expect(fileExtensionForFormat('webp')).toBe('webp');
  });
});
