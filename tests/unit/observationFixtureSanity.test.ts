import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeRichObservationFixture } from '../support/evidenceFixtures.js';

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('writeRichObservationFixture sanity', () => {
  it('produces a real decodable PNG at exactly the viewport pixel dimensions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-rich-obs-'));
    cleanupDirs.push(dir);
    const fixture = await writeRichObservationFixture(dir);
    const pngBytes = await readFile(path.join(fixture.artifactRoot, 'screenshot.png'));
    expect(pngBytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const ihdr = pngBytes.subarray(16, 24);
    const width = ihdr.readUInt32BE(0);
    const height = ihdr.readUInt32BE(4);
    expect(width).toBe(fixture.viewport.width);
    expect(height).toBe(fixture.viewport.height);
  });
});
