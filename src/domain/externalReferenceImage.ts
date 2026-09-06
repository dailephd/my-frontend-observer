/**
 * v0.7 Prompt 1 external-reference image boundary. Pure, dependency-free,
 * header/magic-byte-only parsing for the three formats
 * EXTERNAL_REFERENCE_SUPPORTED_IMAGE_FORMATS freezes below - no image-processing
 * framework, no OCR, no raster decoding, no computer vision. Every function
 * here reads only bounded header bytes and never trusts a caller-declared
 * file extension or MIME type.
 */

export const EXTERNAL_REFERENCE_SUPPORTED_IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type ExternalReferenceImageFormat = (typeof EXTERNAL_REFERENCE_SUPPORTED_IMAGE_FORMATS)[number];

export function isExternalReferenceImageFormat(value: unknown): value is ExternalReferenceImageFormat {
  return typeof value === 'string' && (EXTERNAL_REFERENCE_SUPPORTED_IMAGE_FORMATS as readonly string[]).includes(value);
}

/** Deliberately generous but bounded - reference images are design mockups/screenshots, never arbitrary large media. */
export const EXTERNAL_REFERENCE_MAX_IMAGE_BYTES = 20_000_000;
export const EXTERNAL_REFERENCE_MIN_DIMENSION_PX = 1;
export const EXTERNAL_REFERENCE_MAX_DIMENSION_PX = 8192;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function bytesStartWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return '';
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(bytes[offset + index]!);
  }
  return result;
}

/**
 * Detects one of the three frozen formats from magic bytes only - never from a
 * caller-supplied file extension or MIME type. Returns undefined for anything
 * else, including a truncated/corrupted header of a genuinely supported
 * format's signature bytes.
 */
export function detectExternalReferenceImageFormat(bytes: Uint8Array): ExternalReferenceImageFormat | undefined {
  if (bytesStartWith(bytes, PNG_SIGNATURE)) return 'png';
  if (bytesStartWith(bytes, JPEG_SIGNATURE)) return 'jpeg';
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'webp';
  return undefined;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset + 3]! << 24) | (bytes[offset + 2]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset]!) >>> 0;
}

/** PNG: the IHDR chunk is always the first chunk, immediately after the 8-byte signature, with a fixed 4-byte length + "IHDR" + width + height layout. */
function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24) return undefined;
  if (asciiAt(bytes, 12, 4) !== 'IHDR') return undefined;
  return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
}

/**
 * JPEG: scan marker segments starting after the SOI (0xFFD8) for the first
 * start-of-frame marker (every SOFn except the reserved/DHT/DAC 0xC4/0xC8/0xCC),
 * which always carries height then width as two big-endian uint16s beginning
 * 5 bytes into the segment payload. Bounded scan: stops at the end of the
 * buffer rather than looping indefinitely on a truncated/malformed file.
 */
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const segmentLength = readUInt16BE(bytes, offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: readUInt16BE(bytes, offset + 5), width: readUInt16BE(bytes, offset + 7) };
    }
    if (segmentLength < 2) return undefined;
    offset += 2 + segmentLength;
  }
  return undefined;
}

/**
 * WebP: the simple-lossy (VP8), simple-lossless (VP8L), and extended (VP8X)
 * chunk layouts each encode dimensions differently. Only these three
 * documented chunk shapes are parsed; anything else is honestly unsupported.
 */
function readWebpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const chunkId = asciiAt(bytes, 12, 4);
  if (chunkId === 'VP8 ') {
    if (bytes.length < 30) return undefined;
    return { width: readUInt16BE(bytes, 26) & 0x3fff, height: readUInt16BE(bytes, 28) & 0x3fff };
  }
  if (chunkId === 'VP8L') {
    if (bytes.length < 25) return undefined;
    if (bytes[20] !== 0x2f) return undefined;
    const bits = readUInt32LE(bytes, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunkId === 'VP8X') {
    if (bytes.length < 30) return undefined;
    const width = ((bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) >>> 0) + 1;
    const height = ((bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) >>> 0) + 1;
    return { width, height };
  }
  return undefined;
}

/**
 * Reads width/height from already-detected-format header bytes only - never
 * decodes pixel data. Returns undefined (never a fabricated 0x0) for a
 * truncated header or an unrecognized chunk layout within a genuinely
 * supported container (e.g. an unrecognized WebP chunk kind).
 */
export function readExternalReferenceImageDimensions(bytes: Uint8Array, format: ExternalReferenceImageFormat): ImageDimensions | undefined {
  switch (format) {
    case 'png':
      return readPngDimensions(bytes);
    case 'jpeg':
      return readJpegDimensions(bytes);
    case 'webp':
      return readWebpDimensions(bytes);
  }
}

export function isValidExternalReferenceImageDimensions(dimensions: ImageDimensions): boolean {
  return (
    Number.isInteger(dimensions.width) &&
    Number.isInteger(dimensions.height) &&
    dimensions.width >= EXTERNAL_REFERENCE_MIN_DIMENSION_PX &&
    dimensions.height >= EXTERNAL_REFERENCE_MIN_DIMENSION_PX &&
    dimensions.width <= EXTERNAL_REFERENCE_MAX_DIMENSION_PX &&
    dimensions.height <= EXTERNAL_REFERENCE_MAX_DIMENSION_PX
  );
}

export function fileExtensionForFormat(format: ExternalReferenceImageFormat): string {
  switch (format) {
    case 'png':
      return 'png';
    case 'jpeg':
      return 'jpg';
    case 'webp':
      return 'webp';
  }
}
