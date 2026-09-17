import { describe, expect, it, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverManifests } from '../../src/viewerServer/evidence/discovery.js';
import { buildEvidenceIndexMetadata } from '../../src/viewerServer/evidence/index.js';
import { persistVisualAnnotation } from '../../src/application/visualAnnotationPersistenceService.js';
import { runtimeSourceFor, writeAnnotatableEvidence } from '../support/annotationAuthoringFixtures.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mfo-discovery-tmp-'));
  roots.push(root);
  return root;
}

describe('v0.9 Batch 5: writer temporary directories are never discovered', () => {
  it('skips a valid-looking artifact inside .tmp-* at any depth, and discovers the same artifact once renamed to its final directory', async () => {
    const root = await makeRoot();
    const evidence = await writeAnnotatableEvidence(root);
    const observationManifest = await readFile(path.join(evidence.observationRoot, 'manifest.json'), 'utf8');

    for (const relative of ['.tmp-top', 'annotations/.tmp-abc', 'contracts/.tmp-def', 'references/nested/.tmp-ghi']) {
      const dir = path.join(root, ...relative.split('/'));
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'manifest.json'), observationManifest);
    }

    const discovered = await discoverManifests(root);
    expect(discovered.manifests.some((m) => m.relativeDir.split('/').some((segment) => segment.startsWith('.tmp-')))).toBe(false);
    const index = await buildEvidenceIndexMetadata(root);
    expect(index.records.some((r) => r.relativeDir.includes('.tmp-'))).toBe(false);

    await rename(path.join(root, 'annotations', '.tmp-abc'), path.join(root, 'annotations', 'final-abc'));
    const afterRename = await discoverManifests(root);
    expect(afterRename.manifests.map((m) => m.relativeDir)).toContain('annotations/final-abc');
    // Directories merely containing ".tmp-" later in the name are ordinary evidence.
    await mkdir(path.join(root, 'annotations', 'x.tmp-y'));
    await writeFile(path.join(root, 'annotations', 'x.tmp-y', 'manifest.json'), observationManifest);
    expect((await discoverManifests(root)).manifests.map((m) => m.relativeDir)).toContain('annotations/x.tmp-y');
  });

  it('keeps atomic annotation saves succeeding while the evidence index is refreshed continuously', async () => {
    const root = await makeRoot();
    const evidence = await writeAnnotatableEvidence(root);
    const source = runtimeSourceFor(evidence.observation);

    let saving = true;
    let refreshes = 0;
    const refresher = (async () => {
      while (saving) {
        await buildEvidenceIndexMetadata(root);
        refreshes += 1;
      }
    })();

    const failures: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const result = await persistVisualAnnotation({
        source,
        items: [{ annotationItemId: `item-${i}`, mark: { kind: 'point', x: i, y: i }, interpretation: { state: 'uninterpreted' } }],
        outputLocation: 'annotations',
        cwd: root,
      });
      if (!result.ok) failures.push(result.diagnostics.map((d) => d.message).join('; '));
    }
    saving = false;
    await refresher;

    expect(failures).toEqual([]);
    expect(refreshes).toBeGreaterThan(0);
    expect((await buildEvidenceIndexMetadata(root)).records.filter((r) => r.family === 'visual-annotation')).toHaveLength(25);
  });
});
