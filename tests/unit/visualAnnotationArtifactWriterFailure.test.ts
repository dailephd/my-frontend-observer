import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, rm, access, readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const failure = vi.hoisted(() => ({ mode: 'none' as 'none' | 'manifest-write' | 'rename' }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(async (filePath: unknown, ...rest: unknown[]) => {
      if (failure.mode === 'manifest-write' && String(filePath).endsWith('manifest.json')) {
        throw new Error('simulated disk failure writing manifest.json');
      }
      return (actual.writeFile as (...args: unknown[]) => Promise<void>)(filePath, ...rest);
    }),
    rename: vi.fn(async (...args: unknown[]) => {
      if (failure.mode === 'rename') throw new Error('simulated atomic rename failure');
      return (actual.rename as (...innerArgs: unknown[]) => Promise<void>)(...args);
    }),
  };
});

const { writeVisualAnnotationArtifact, VISUAL_ANNOTATION_MANIFEST_FILENAME, VISUAL_ANNOTATION_OVERLAY_FILENAME } = await import(
  '../../src/artifacts/visualAnnotationArtifactWriter.js'
);
const { readVisualAnnotationArtifact } = await import('../../src/artifacts/visualAnnotationArtifactReader.js');
const { buildArtifact, runtimeRectangleItem, runtimeSource } = await import('./visualAnnotationFixtures.js');

describe('visualAnnotationArtifactWriter / reader failure handling', () => {
  const tempDirs: string[] = [];

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-visual-annotation-fail-'));
    tempDirs.push(dir);
    return dir;
  }

  async function writeValidArtifact(cwd: string): Promise<{ manifestPath: string; overlayPath: string }> {
    const result = await writeVisualAnnotationArtifact(buildArtifact(runtimeSource(), [runtimeRectangleItem()]), '.', { cwd });
    if (!result.ok) throw new Error('expected ok result');
    return result;
  }

  afterEach(async () => {
    failure.mode = 'none';
    vi.clearAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('1: an invalid artifact is refused with artifact-write-failure and nothing is written', async () => {
    const cwd = await freshCwd();
    const artifact = { ...buildArtifact(runtimeSource(), [runtimeRectangleItem()]), schemaVersion: '9.9.9' };

    const result = await writeVisualAnnotationArtifact(artifact as never, '.', { cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(await readdir(cwd)).toEqual([]);
  });

  it('2: an existing final annotation directory is left unchanged and not overwritten', async () => {
    const cwd = await freshCwd();
    const artifact = buildArtifact(runtimeSource(), [runtimeRectangleItem()]);
    const finalRoot = path.join(cwd, artifact.annotationId);
    await mkdir(finalRoot);
    await writeFile(path.join(finalRoot, 'manifest.json'), 'pre-existing evidence');

    const result = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(await readdir(finalRoot)).toEqual(['manifest.json']);
    expect(await readFile(path.join(finalRoot, 'manifest.json'), 'utf8')).toBe('pre-existing evidence');
  });

  it('3: a manifest write failure after the overlay write exposes no artifact and cleans the temp directory', async () => {
    const cwd = await freshCwd();
    const artifact = buildArtifact(runtimeSource(), [runtimeRectangleItem()]);
    failure.mode = 'manifest-write';

    const result = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(result.diagnostics[0]?.message).toContain('simulated disk failure');

    // The overlay was written before the manifest (manifest-last discipline).
    const writtenPaths = vi.mocked(writeFile).mock.calls.map(([filePath]) => path.basename(String(filePath)));
    expect(writtenPaths).toEqual([VISUAL_ANNOTATION_OVERLAY_FILENAME, VISUAL_ANNOTATION_MANIFEST_FILENAME]);

    await expect(access(path.join(cwd, artifact.annotationId))).rejects.toBeDefined();
    await expect(access(path.join(cwd, `.tmp-${artifact.annotationId}`))).rejects.toBeDefined();
    expect(await readdir(cwd)).toEqual([]);
  });

  it('4: an atomic rename failure exposes no partial artifact and cleans the temp directory', async () => {
    const cwd = await freshCwd();
    const artifact = buildArtifact(runtimeSource(), [runtimeRectangleItem()]);
    failure.mode = 'rename';

    const result = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(result.diagnostics[0]?.message).toContain('simulated atomic rename failure');
    await expect(access(path.join(cwd, artifact.annotationId))).rejects.toBeDefined();
    await expect(access(path.join(cwd, `.tmp-${artifact.annotationId}`))).rejects.toBeDefined();
    expect(await readdir(cwd)).toEqual([]);
  });

  it('5: the reader reports malformed JSON explicitly', async () => {
    const cwd = await freshCwd();
    const manifestPath = path.join(cwd, 'manifest.json');
    await writeFile(manifestPath, '{ not json');
    const result = await readVisualAnnotationArtifact(manifestPath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toContain('not valid JSON');
  });

  it('5b: the reader reports a missing manifest explicitly', async () => {
    const cwd = await freshCwd();
    const result = await readVisualAnnotationArtifact(path.join(cwd, 'missing', 'manifest.json'));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toContain('failed to read');
  });

  it('6: the reader reports a structurally invalid or unsupported-version artifact explicitly', async () => {
    const cwd = await freshCwd();
    const { manifestPath } = await writeValidArtifact(cwd);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;

    await writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: '2.0.0' }));
    const unsupported = await readVisualAnnotationArtifact(manifestPath);
    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) throw new Error('expected failure');
    expect(unsupported.reason).toContain('failed structural validation');

    await writeFile(manifestPath, JSON.stringify({ ...manifest, items: [{ annotationItemId: 'x', mark: { kind: 'point', x: -1, y: 0 }, interpretation: { state: 'uninterpreted' } }] }));
    const invalid = await readVisualAnnotationArtifact(manifestPath);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('expected failure');
    expect(invalid.reason).toContain('failed structural validation');
  });

  it('7: the reader reports a missing overlay explicitly and never regenerates it', async () => {
    const cwd = await freshCwd();
    const { manifestPath, overlayPath } = await writeValidArtifact(cwd);
    await unlink(overlayPath);

    const result = await readVisualAnnotationArtifact(manifestPath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toContain('missing');
    await expect(access(overlayPath)).rejects.toBeDefined();
  });

  it('7b: the reader rejects an owned overlay path that is not a regular file', async () => {
    const cwd = await freshCwd();
    const { manifestPath, overlayPath } = await writeValidArtifact(cwd);
    await unlink(overlayPath);
    await mkdir(overlayPath);

    const result = await readVisualAnnotationArtifact(manifestPath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toContain('not a regular file');
  });

  it('8: the reader reports an overlay SHA-256 mismatch explicitly', async () => {
    const cwd = await freshCwd();
    const { manifestPath, overlayPath } = await writeValidArtifact(cwd);
    await writeFile(overlayPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');

    const result = await readVisualAnnotationArtifact(manifestPath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toContain('does not match overlay.sha256');
  });

  it('9: malicious note text is persisted as escaped, inert SVG text', async () => {
    const cwd = await freshCwd();
    const malicious = '<script>alert("x")</script> & test';
    const artifact = buildArtifact(runtimeSource(), [
      { annotationItemId: 'note-1', mark: { kind: 'note', anchor: { x: 20, y: 20 }, text: malicious }, interpretation: { state: 'uninterpreted' } },
    ]);

    const result = await writeVisualAnnotationArtifact(artifact, '.', { cwd });
    if (!result.ok) throw new Error('expected ok result');
    const svg = await readFile(result.overlayPath, 'utf8');
    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; test');
    expect(svg).not.toContain('<script');

    // The manifest keeps the authored text verbatim; the structured data stays authoritative.
    const read = await readVisualAnnotationArtifact(result.manifestPath);
    if (!read.ok) throw new Error('expected ok read');
    const note = read.artifact.items[0]?.mark;
    expect(note?.kind === 'note' ? note.text : undefined).toBe(malicious);
  });
});
