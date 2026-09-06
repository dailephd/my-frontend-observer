/** Minimal, hand-built valid image-header fixtures for v0.7 Prompt 1 tests - never real photos, just enough bytes for detectExternalReferenceImageFormat/readExternalReferenceImageDimensions to parse deterministically. Shared across externalReferenceImage/externalReference/externalReferenceArtifactWriter/externalReferencePersistenceService/cliExternalReference tests to avoid re-deriving the same byte layouts five times. */

function writeUInt32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUInt16BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeUInt24LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function writeUInt32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function ascii(text: string): number[] {
  return Array.from(text).map((char) => char.charCodeAt(0));
}

/** 8-byte signature + one IHDR chunk (length/tag/width/height/5 metadata bytes) + 4 arbitrary CRC bytes. */
export function buildMinimalPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(41);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  writeUInt32BE(bytes, 8, 13);
  bytes.set(ascii('IHDR'), 12);
  writeUInt32BE(bytes, 16, width);
  writeUInt32BE(bytes, 20, height);
  bytes.set([8, 6, 0, 0, 0], 24); // bit depth, color type, compression, filter, interlace - arbitrary but plausible
  bytes.set([0xde, 0xad, 0xbe, 0xef], 37); // CRC - never checked by our header-only parser
  return bytes;
}

/** A PNG whose IHDR chunk is present but the buffer is truncated before width/height are fully readable. */
export function buildTruncatedPng(): Uint8Array {
  const full = buildMinimalPng(37, 41);
  return full.slice(0, 18); // stops partway through the width field
}

/** SOI immediately followed by a minimal SOF0 segment carrying height/width - enough for readJpegDimensions to return on its very first marker. */
export function buildMinimalJpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes[0] = 0xff;
  bytes[1] = 0xd8; // SOI
  bytes[2] = 0xff;
  bytes[3] = 0xc0; // SOF0
  writeUInt16BE(bytes, 4, 11); // segment length (not relied upon - SOF is found before it would matter)
  bytes[6] = 0x08; // precision
  writeUInt16BE(bytes, 7, height);
  writeUInt16BE(bytes, 9, width);
  bytes[11] = 0x01; // numComponents
  bytes.set([0x01, 0x11, 0x00], 12); // one component descriptor
  return bytes;
}

/** A JPEG with a plausible SOI but no SOF marker anywhere before the buffer ends. */
export function buildTruncatedJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]);
}

/** RIFF/WEBP/VP8X container: the simplest chunk layout that directly encodes width-1/height-1 as 24-bit little-endian fields. */
export function buildMinimalWebp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(ascii('RIFF'), 0);
  writeUInt32LE(bytes, 4, 22);
  bytes.set(ascii('WEBP'), 8);
  bytes.set(ascii('VP8X'), 12);
  writeUInt32LE(bytes, 16, 10);
  bytes[20] = 0; // flags
  bytes.set([0, 0, 0], 21); // reserved
  writeUInt24LE(bytes, 24, width - 1);
  writeUInt24LE(bytes, 27, height - 1);
  return bytes;
}

/** A RIFF/WEBP container whose chunk id is neither VP8 , VP8L, nor VP8X. */
export function buildUnsupportedWebpChunk(): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(ascii('RIFF'), 0);
  writeUInt32LE(bytes, 4, 22);
  bytes.set(ascii('WEBP'), 8);
  bytes.set(ascii('ANIM'), 12);
  return bytes;
}

export function buildUnrecognizedBytes(): Uint8Array {
  return new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
}
