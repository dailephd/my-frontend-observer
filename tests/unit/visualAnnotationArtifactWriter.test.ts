import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  writeVisualAnnotationArtifact,
  VISUAL_ANNOTATION_MANIFEST_FILENAME,
  VISUAL_ANNOTATION_OVERLAY_FILENAME,
} from '../../src/artifacts/visualAnnotationArtifactWriter.js';
import { readVisualAnnotationArtifact } from '../../src/artifacts/visualAnnotationArtifactReader.js';
import { renderVisualAnnotationOverlaySvg } from '../../src/domain/visualAnnotation.js';
import { buildArtifact, referenceRectangleItem, referenceSource, runtimeRectangleItem, runtimeSource } from './visualAnnotationFixtures.js';

describe('visualAnnotationArtifactWriter / reader', () => {
  const tempDirs: string[] = [];

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-visual-annotation-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes <outputLocation>/<annotationId>/ with manifest.json and annotation-overlay.svg', async () => {
    const cwd = await freshCwd();
    const artifact = buildArtifact(runtimeSource(), [runtimeRectangleItem()]);

    const result = await writeVisualAnnotationArtifact(artifact, 'annotations', { cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    expect(result.artifactRoot).toBe(path.join(cwd, 'annotations', artifact.annotationId));
    expect(path.basename(result.artifactRoot)).toBe(artifact.annotationId);
    expect(result.manifestPath).toBe(path.join(result.artifactRoot, 'manifest.json'));
    expect(result.overlayPath).toBe(path.join(result.artifactRoot, 'annotation-overlay.svg'));
    expect(VISUAL_ANNOTATION_MANIFEST_FILENAME).toBe('manifest.json');
    expect(VISUAL_ANNOTATION_OVERLAY_FILENAME).toBe('annotation-overlay.svg');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as unknown;
    expect(manifest).toEqual(artifact);

    const overlay = await readFile(result.overlayPath);
    expect(overlay.toString('utf8')).toBe(renderVisualAnnotationOverlaySvg(artifact.source, artifact.items));
    expect(createHash('sha256').update(overlay).digest('hex')).toBe(artifact.overlay.sha256);
  });

  it('round-trips runtime and external-reference artifacts through the canonical reader', async () => {
    const cwd = await freshCwd();
    for (const artifact of [
      buildArtifact(runtimeSource(), [runtimeRectangleItem()], { annotationId: 'runtime-annotation' }),
      buildArtifact(referenceSource(), [referenceRectangleItem()], { annotationId: 'reference-annotation', supersedesAnnotationId: 'older-annotation' }),
    ]) {
      const written = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
      if (!written.ok) throw new Error('expected ok result');
      const read = await readVisualAnnotationArtifact(written.manifestPath);
      expect(read).toEqual({ ok: true, artifact });
    }
  });

  it('refuses to overwrite an existing final annotation directory', async () => {
    const cwd = await freshCwd();
    const artifact = buildArtifact(runtimeSource(), [runtimeRectangleItem()]);
    const first = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
    expect(first.ok).toBe(true);

    const second = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected refusal');
    expect(second.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(second.diagnostics[0]?.message).toContain('refusing to overwrite');
  });

  it('never copies source observation/reference bytes into the annotation directory', async () => {
    const cwd = await freshCwd();
    // A sibling "source" artifact exists next to the output; the writer must not read or copy it.
    const sourceDir = path.join(cwd, 'obs-request-1-instance-1');
    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, 'screenshot.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    for (const artifact of [
      buildArtifact(runtimeSource(), [runtimeRectangleItem()], { annotationId: 'runtime-annotation' }),
      buildArtifact(referenceSource(), [referenceRectangleItem()], { annotationId: 'reference-annotation' }),
    ]) {
      const result = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
      if (!result.ok) throw new Error('expected ok result');
      expect((await readdir(result.artifactRoot)).sort()).toEqual(['annotation-overlay.svg', 'manifest.json']);
      const overlay = await readFile(result.overlayPath, 'utf8');
      expect(overlay).not.toContain('<image');
    }
    expect(await readdir(sourceDir)).toEqual(['screenshot.png']);
  });

  it('leaves no temporary directory after success, including a stale one it owns', async () => {
    const cwd = await freshCwd();
    const artifact = buildArtifact(runtimeSource(), [runtimeRectangleItem()]);
    const staleTemp = path.join(cwd, `.tmp-${artifact.annotationId}`);
    await mkdir(staleTemp);
    await writeFile(path.join(staleTemp, 'leftover.txt'), 'stale');

    const result = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
    expect(result.ok).toBe(true);
    await expect(access(staleTemp)).rejects.toBeDefined();
    expect((await readdir(cwd)).sort()).toEqual([artifact.annotationId]);
  });

  it('leaves no temporary directory and no final artifact after a filesystem failure', async () => {
    const cwd = await freshCwd();
    const artifact = buildArtifact(runtimeSource(), [runtimeRectangleItem()]);
    // The output location is a regular file, so creating the temporary directory beneath it fails.
    await writeFile(path.join(cwd, 'not-a-directory'), 'blocking file');

    const result = await writeVisualAnnotationArtifact(artifact, 'not-a-directory', { cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(await readdir(cwd)).toEqual(['not-a-directory']);
  });

  it('refuses an artifact whose overlay.sha256 does not match the rendered overlay', async () => {
    const cwd = await freshCwd();
    const artifact = buildArtifact(runtimeSource(), [runtimeRectangleItem()]);
    const tampered = { ...artifact, overlay: { ...artifact.overlay, sha256: 'b'.repeat(64) } };

    const result = await writeVisualAnnotationArtifact(tampered, '.', { cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(await readdir(cwd)).toEqual([]);
  });
});
