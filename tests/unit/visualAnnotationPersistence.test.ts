import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { persistVisualAnnotation } from '../../src/application/visualAnnotationPersistenceService.js';
import { readVisualAnnotationArtifact } from '../../src/artifacts/visualAnnotationArtifactReader.js';
import { buildVisualAnnotationRequestIdentity } from '../../src/domain/visualAnnotationIdentity.js';
import { getProducerInfo } from '../../src/domain/schema.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem } from '../../src/domain/visualAnnotation.js';
import { referenceRectangleItem, referenceSource, runtimeRectangleItem, runtimeSource } from './visualAnnotationFixtures.js';

describe('visualAnnotationPersistenceService', () => {
  const tempDirs: string[] = [];

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-visual-annotation-service-'));
    tempDirs.push(dir);
    return dir;
  }

  async function readManifest(manifestPath: string): Promise<VisualAnnotationArtifact> {
    return JSON.parse(await readFile(manifestPath, 'utf8')) as VisualAnnotationArtifact;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('persists a runtime-observation annotation with canonical identity, producer, provenance, and overlay metadata', async () => {
    const cwd = await freshCwd();
    const source = runtimeSource();
    const items: VisualAnnotationItem[] = [
      runtimeRectangleItem(),
      {
        annotationItemId: 'item-2',
        mark: { kind: 'arrow', start: { x: 10, y: 10 }, end: { x: 200, y: 10 } },
        association: { kind: 'runtime-target', target: 'hero' },
        interpretation: {
          state: 'confirmed',
          intent: { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'hero', property: 'x' } },
          confirmedAt: '2026-09-17T00:00:00.000Z',
        },
      },
    ];

    const result = await persistVisualAnnotation({ source, items, outputLocation: 'evidence/annotations', cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    expect(result.annotationRequestId).toBe(buildVisualAnnotationRequestIdentity(source, items));
    expect(result.annotationId.startsWith(`${result.annotationRequestId}-`)).toBe(true);
    expect(result.artifactRoot).toBe(path.join(cwd, 'evidence', 'annotations', result.annotationId));

    const manifest = await readManifest(result.manifestPath);
    expect(manifest.artifactKind).toBe('my-frontend-observer/visual-annotation');
    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(manifest.annotationId).toBe(result.annotationId);
    expect(manifest.annotationRequestId).toBe(result.annotationRequestId);
    expect(manifest.producer).toEqual(getProducerInfo());
    expect(manifest.source).toEqual(source);
    expect(manifest.items).toEqual(items);
    expect(manifest.provenance.origin).toBe('viewer');
    expect(Number.isNaN(Date.parse(manifest.provenance.createdAt))).toBe(false);
    expect('supersedesAnnotationId' in manifest).toBe(false);

    expect(manifest.overlay.path).toBe('annotation-overlay.svg');
    expect(manifest.overlay.format).toBe('svg');
    expect(manifest.overlay.width).toBe(1280);
    expect(manifest.overlay.height).toBe(720);
    const overlayBytes = await readFile(result.overlayPath);
    expect(createHash('sha256').update(overlayBytes).digest('hex')).toBe(manifest.overlay.sha256);

    const read = await readVisualAnnotationArtifact(result.manifestPath);
    expect(read).toEqual({ ok: true, artifact: manifest });
  });

  it('persists an external-reference annotation in reference-image pixels', async () => {
    const cwd = await freshCwd();
    const source = referenceSource();
    const items: VisualAnnotationItem[] = [
      {
        ...referenceRectangleItem(),
        interpretation: {
          state: 'candidate',
          intent: { kind: 'reference-region', mode: 'create', region: { id: 'hero', rectangle: { x: 10, y: 20, width: 400, height: 300 } } },
        },
      },
    ];

    const result = await persistVisualAnnotation({ source, items, outputLocation: '.', cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const manifest = await readManifest(result.manifestPath);
    expect(manifest.source).toEqual(source);
    expect(manifest.overlay.width).toBe(1600);
    expect(manifest.overlay.height).toBe(900);
    expect(await readFile(result.overlayPath, 'utf8')).toContain('viewBox="0 0 1600 900"');
    expect((await readdir(result.artifactRoot)).sort()).toEqual(['annotation-overlay.svg', 'manifest.json']);
  });

  it('derives the same request identity but a fresh annotationId for each save of identical content', async () => {
    const cwd = await freshCwd();
    const options = { source: runtimeSource(), items: [runtimeRectangleItem()], outputLocation: '.', cwd };

    const first = await persistVisualAnnotation(options);
    const second = await persistVisualAnnotation({ ...options, outputLocation: 'elsewhere' });
    if (!first.ok || !second.ok) throw new Error('expected ok results');

    expect(second.annotationRequestId).toBe(first.annotationRequestId);
    expect(second.annotationId).not.toBe(first.annotationId);

    const firstManifest = await readManifest(first.manifestPath);
    const secondManifest = await readManifest(second.manifestPath);
    expect(firstManifest.overlay.sha256).toBe(secondManifest.overlay.sha256);
  });

  it('carries supersedesAnnotationId forward unchanged and never mutates the prior artifact', async () => {
    const cwd = await freshCwd();
    const original = await persistVisualAnnotation({ source: runtimeSource(), items: [runtimeRectangleItem()], outputLocation: '.', cwd });
    if (!original.ok) throw new Error('expected ok result');
    const priorManifestBytes = await readFile(original.manifestPath);
    const priorOverlayBytes = await readFile(original.overlayPath);

    const revisedItems: VisualAnnotationItem[] = [{ ...runtimeRectangleItem(), mark: { kind: 'rectangle', x: 120, y: 50, width: 300, height: 200 } }];
    const revision = await persistVisualAnnotation({
      source: runtimeSource(),
      items: revisedItems,
      outputLocation: '.',
      cwd,
      supersedesAnnotationId: original.annotationId,
    });
    if (!revision.ok) throw new Error('expected ok result');

    const revisionManifest = await readManifest(revision.manifestPath);
    expect(revisionManifest.supersedesAnnotationId).toBe(original.annotationId);
    expect(revisionManifest.items[0]?.annotationItemId).toBe('item-1');
    expect(revision.annotationRequestId).toBe(buildVisualAnnotationRequestIdentity(runtimeSource(), revisedItems, original.annotationId));
    expect(revision.artifactRoot).not.toBe(original.artifactRoot);

    expect(await readFile(original.manifestPath)).toEqual(priorManifestBytes);
    expect(await readFile(original.overlayPath)).toEqual(priorOverlayBytes);
  });

  it('refuses invalid content and unsafe output locations before writing anything', async () => {
    const cwd = await freshCwd();

    const crossDomain = await persistVisualAnnotation({ source: runtimeSource(), items: [referenceRectangleItem()], outputLocation: '.', cwd });
    expect(crossDomain.ok).toBe(false);
    if (crossDomain.ok) throw new Error('expected failure');
    expect(crossDomain.diagnostics[0]?.code).toBe('invalid-request');

    const emptySupersedes = await persistVisualAnnotation({ source: runtimeSource(), items: [], outputLocation: '.', cwd, supersedesAnnotationId: '' });
    expect(emptySupersedes.ok).toBe(false);

    for (const outputLocation of ['../outside', '/absolute', 'C:/absolute']) {
      const unsafe = await persistVisualAnnotation({ source: runtimeSource(), items: [], outputLocation, cwd });
      expect(unsafe.ok).toBe(false);
      if (unsafe.ok) throw new Error('expected failure');
      expect(unsafe.diagnostics[0]?.code).toBe('invalid-request');
    }

    expect(await readdir(cwd)).toEqual([]);
  });
});
