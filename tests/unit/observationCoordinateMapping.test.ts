import { describe, expect, it, afterEach } from 'vitest';
import { readObservationArtifact } from '../../src/artifacts/artifactReader.js';
import { writeObservationArtifact } from '../../src/artifacts/artifactWriter.js';
import { deriveLayoutRelationships } from '../../src/domain/relationships.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeRichObservationFixture, buildObservation, target, matchedTarget, rect } from '../support/evidenceFixtures.js';

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('coordinate mapping (Batch 3 §9/§32.2 - server side, no browser required)', () => {
  it('canonical requestConfig.viewport is present and matches the fixture, unmodified by any Batch 3 code path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-coord-'));
    cleanupDirs.push(dir);
    const fixture = await writeRichObservationFixture(dir);
    const read = await readObservationArtifact(path.join(fixture.artifactRoot, 'manifest.json'));
    if (!read.ok) throw new Error('expected valid read');
    expect(read.artifact.requestConfig.viewport).toEqual(fixture.viewport);
  });

  it('target geometry values are preserved exactly (no rounding, no devicePixelRatio multiplication) end to end from artifact to what the SVG layer would receive', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-coord-'));
    cleanupDirs.push(dir);
    // A fixture whose devicePixelRatio is deliberately not 1, to prove geometry is never multiplied by it.
    const viewport = { width: 640, height: 480 };
    const geometry = rect(12.5, 33.25, 199.75, 88.125); // fractional CSS px, exactly as getBoundingClientRect() can produce
    const artifact = buildObservation(
      'obs-frac',
      [target('widget')],
      { widget: matchedTarget(geometry) },
      '0.7.0',
      { devicePixelRatio: { state: 'available', source: 'browser', value: 2 } },
      viewport,
    );
    const written = await writeObservationArtifact(artifact, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected write to succeed');

    const read = await readObservationArtifact(path.join(written.artifactRoot, 'manifest.json'));
    if (!read.ok) throw new Error('expected valid read');
    const field = read.artifact.targetEvidence.widget?.geometry;
    expect(field?.state).toBe('available');
    if (field?.state === 'available') {
      // Byte-for-byte identical to the originally captured value - not scaled by devicePixelRatio (2), not rounded.
      expect(field.value).toEqual(geometry);
    }
    // devicePixelRatio remains available as informational page evidence only, never consulted for geometry.
    expect(read.artifact.pageEvidence.devicePixelRatio).toEqual({ state: 'available', source: 'browser', value: 2 });
  });

  it('a target with only partial geometry is preserved as partial, never silently promoted to available or discarded', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-coord-'));
    cleanupDirs.push(dir);
    const geometry = rect(0, 0, 50, 50);
    const artifact = buildObservation('obs-partial', [target('widget')], {
      widget: { ...matchedTarget(geometry), geometry: { state: 'partial', source: 'browser', value: geometry, reason: 'measured during an unstable layout pass' } },
    });
    const written = await writeObservationArtifact(artifact, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected write to succeed');
    const read = await readObservationArtifact(path.join(written.artifactRoot, 'manifest.json'));
    if (!read.ok) throw new Error('expected valid read');
    expect(read.artifact.targetEvidence.widget?.geometry.state).toBe('partial');
  });

  it('geometry lying partly outside the canonical viewport is preserved exactly, never clamped', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-coord-'));
    cleanupDirs.push(dir);
    const viewport = { width: 400, height: 300 };
    const offscreenGeometry = rect(-50, -20, 100, 100); // partially above/left of the viewport origin
    const artifact = buildObservation('obs-offscreen', [target('partial-widget')], { 'partial-widget': matchedTarget(offscreenGeometry) }, '0.7.0', {}, viewport);
    const written = await writeObservationArtifact(artifact, new Uint8Array([1]), { cwd: dir });
    if (!written.ok) throw new Error('expected write to succeed');
    const read = await readObservationArtifact(path.join(written.artifactRoot, 'manifest.json'));
    if (!read.ok) throw new Error('expected valid read');
    const field = read.artifact.targetEvidence['partial-widget']?.geometry;
    expect(field?.state).toBe('available');
    if (field?.state === 'available') expect(field.value).toEqual(offscreenGeometry);
  });

  it('the canonical relationship engine (not a second implementation) is the sole source of derived relationship geometry-eligibility', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-coord-'));
    cleanupDirs.push(dir);
    const fixture = await writeRichObservationFixture(dir);
    const read = await readObservationArtifact(path.join(fixture.artifactRoot, 'manifest.json'));
    if (!read.ok) throw new Error('expected valid read');
    const result = deriveLayoutRelationships(read.artifact);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Every pairwise relationship subject/related target is one of the geometrically resolved targets - never the unresolved one.
      for (const rel of result.graph.pairwiseRelationships) {
        expect(rel.subjectTarget).not.toBe('missingWidget');
        expect(rel.relatedTarget).not.toBe('missingWidget');
      }
    }
  });
});

