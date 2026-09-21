import { describe, expect, it, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as referencePersistence from '../../src/application/externalReferencePersistenceService.js';
import { approveExternalReference, importExternalReference } from '../../src/application/externalReferencePersistenceService.js';
import { materializeVisualAnnotationReference, referenceMaterializationBlockReason } from '../../src/application/visualAnnotationReferenceMaterializationService.js';
import type { MaterializeVisualAnnotationReferenceOptions } from '../../src/application/visualAnnotationReferenceMaterializationService.js';
import { readExternalReferenceArtifact } from '../../src/artifacts/externalReferenceArtifactReader.js';
import { deriveReferenceRegionRelationships } from '../../src/domain/externalReferenceRegionRelationships.js';
import { buildReferenceRequirement, deriveReferenceRequirementAdequacy } from '../../src/domain/externalReferenceRequirements.js';
import type { RawReferenceRequirement } from '../../src/domain/externalReferenceRequirements.js';
import type { ExternalReferenceApplicability, ExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import type { ReferenceRegion } from '../../src/domain/externalReferenceRegions.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem } from '../../src/domain/visualAnnotation.js';
import { buildRealPng } from '../support/evidenceFixtures.js';
import { persistAnnotationUnder, readManifest, referenceSourceFor, runtimeSourceFor, writeAnnotatableEvidence } from '../support/annotationAuthoringFixtures.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mfo-reference-materialization-'));
  roots.push(root);
  return root;
}

type Intent = Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>['intent'];

function confirmed(id: string, intent: Intent): VisualAnnotationItem {
  return { annotationItemId: id, mark: { kind: 'rectangle', x: 10, y: 10, width: 40, height: 30 }, interpretation: { state: 'confirmed', intent, confirmedAt: '2026-09-17T00:00:00.000Z' } };
}

function candidateItem(id: string, intent: Intent): VisualAnnotationItem {
  return { annotationItemId: id, mark: { kind: 'rectangle', x: 10, y: 10, width: 40, height: 30 }, interpretation: { state: 'candidate', intent } };
}

const createRegion = (id: string, regionId: string, x = 150, y = 100, width = 100, height = 80) => confirmed(id, { kind: 'reference-region', mode: 'create', region: { id: regionId, rectangle: { x, y, width, height } } });
const refineRegion = (id: string, regionId: string, x: number, y: number, width: number, height: number) => confirmed(id, { kind: 'reference-region', mode: 'refine', region: { id: regionId, rectangle: { x, y, width, height } } });
const requirementItem = (id: string, requirement: RawReferenceRequirement) => confirmed(id, { kind: 'reference-requirement', requirement });

const SOURCE_REGIONS: ReferenceRegion[] = [
  { id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } },
  { id: 'content', rectangle: { x: 0, y: 60, width: 120, height: 240 } },
];
const SOURCE_REQUIREMENTS: RawReferenceRequirement[] = [
  { category: 'requested', subject: { kind: 'region-property', region: 'header', property: 'height' }, tolerance: { kind: 'exact' } },
  { category: 'preserved', subject: { kind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'content', measurement: 'vertical-gap' }, tolerance: { kind: 'exact' } },
];
const APPLICABILITY: ExternalReferenceApplicability = { viewport: { width: 1200, height: 800 }, theme: 'light' };

interface SourceFixture {
  root: string;
  imageBytes: Uint8Array;
  importedRoot: string;
  imported: ExternalReferenceArtifact;
  approvedRoot: string;
  approved: ExternalReferenceArtifact;
}

async function sourceFixture(options: { regions?: ReferenceRegion[]; requirements?: RawReferenceRequirement[]; label?: string | null; applicability?: ExternalReferenceApplicability | null } = {}): Promise<SourceFixture> {
  const root = await makeRoot();
  const imageBytes = buildRealPng(400, 300, [16, 120, 90]);
  const label = options.label === undefined ? 'materialization-source' : options.label;
  const applicability = options.applicability === undefined ? APPLICABILITY : options.applicability;
  const imported = await importExternalReference(imageBytes, {
    outputLocation: 'references',
    cwd: root,
    ...(label === null ? {} : { label }),
    regions: options.regions ?? SOURCE_REGIONS,
    requirements: options.requirements ?? SOURCE_REQUIREMENTS,
    ...(applicability === null ? {} : { applicability }),
  });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: 'references', cwd: root });
  if (!approved.ok) throw new Error(JSON.stringify(approved.diagnostics));
  return {
    root,
    imageBytes,
    importedRoot: imported.artifactRoot,
    imported: await readManifest<ExternalReferenceArtifact>(imported.artifactRoot),
    approvedRoot: approved.artifactRoot,
    approved: await readManifest<ExternalReferenceArtifact>(approved.artifactRoot),
  };
}

async function annotate(fixture: SourceFixture, source: 'imported' | 'approved', items: VisualAnnotationItem[]): Promise<VisualAnnotationArtifact> {
  const saved = await persistAnnotationUnder(fixture.root, referenceSourceFor(source === 'imported' ? fixture.imported : fixture.approved), items);
  return readManifest<VisualAnnotationArtifact>(saved.artifactRoot);
}

function optionsFor(fixture: SourceFixture, source: 'imported' | 'approved', annotation: VisualAnnotationArtifact, selectedItemIds: string[]): MaterializeVisualAnnotationReferenceOptions {
  return {
    annotation,
    sourceReference: source === 'imported' ? fixture.imported : fixture.approved,
    sourceReferenceRoot: source === 'imported' ? fixture.importedRoot : fixture.approvedRoot,
    imageBytes: fixture.imageBytes,
    selectedItemIds,
    outputLocation: 'materialized',
    cwd: fixture.root,
  };
}

async function readNew(root: string, referenceId: string): Promise<ExternalReferenceArtifact> {
  const read = await readExternalReferenceArtifact(path.join(root, 'materialized', referenceId, 'manifest.json'));
  if (!read.ok) throw new Error(read.reason);
  return read.artifact;
}

async function materializedDirs(root: string): Promise<string[]> {
  return readdir(path.join(root, 'materialized')).catch(() => [] as string[]);
}

async function snapshotDir(dir: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    snapshot[path.relative(dir, full)] = createHash('sha256').update(await readFile(full)).digest('hex');
  }
  return snapshot;
}

function imageOf(reference: ExternalReferenceArtifact) {
  if (reference.lifecycle.state === 'approved') throw new Error('expected an imported reference');
  return (reference as Extract<ExternalReferenceArtifact, { image: unknown }>).image;
}

describe('materializeVisualAnnotationReference composition', () => {
  it('appends a selected create after unchanged source regions, from an imported source, through the canonical import exactly once', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [createRegion('create', 'new-region')]);
    const importSpy = vi.spyOn(referencePersistence, 'importExternalReference');
    const sourceBefore = await snapshotDir(fixture.importedRoot);

    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['create']));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(importSpy).toHaveBeenCalledTimes(1);
    const created = await readNew(fixture.root, result.referenceId);
    expect(created.lifecycle.state).toBe('imported');
    expect(created.supersedesReferenceId).toBe(fixture.imported.referenceId);
    expect(result.supersedesReferenceId).toBe(fixture.imported.referenceId);
    expect(created.regions).toEqual([...SOURCE_REGIONS, { id: 'new-region', rectangle: { x: 150, y: 100, width: 100, height: 80 } }]);
    expect(result.regionCount).toBe(3);
    expect(result.requirementCount).toBe(2);
    // Identity is exactly the canonical import output, not an annotation-derived hash.
    expect(created.referenceId).toBe(result.referenceId);
    expect(created.referenceRequestId).toBe(result.referenceRequestId);
    expect(created.referenceId).not.toBe(fixture.imported.referenceId);
    expect(await snapshotDir(fixture.importedRoot)).toEqual(sourceBefore);
    expect(fixture.imported.regions).toEqual(SOURCE_REGIONS);
  });

  it('refines a source region in place keeping its id and order, leaving the source rectangle untouched', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [refineRegion('refine', 'header', 0, 0, 400, 72)]);
    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['refine']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = await readNew(fixture.root, result.referenceId);
    expect(created.regions).toEqual([{ id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 72 } }, SOURCE_REGIONS[1]]);
    const source = await readManifest<ExternalReferenceArtifact>(fixture.importedRoot);
    expect(source.regions?.[0]).toEqual({ id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } });
  });

  it('refine matches the source region id case-insensitively and keeps the source spelling', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [refineRegion('refine', 'HEADER', 0, 0, 400, 70)]);
    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['refine']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await readNew(fixture.root, result.referenceId)).regions?.[0]?.id).toBe('header');
  });

  it('materializes a create and a requirement against it; the requirement alone is rejected without a write', async () => {
    const fixture = await sourceFixture();
    const requirement: RawReferenceRequirement = { category: 'protected', subject: { kind: 'region-property', region: 'hero-new', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } };
    const annotation = await annotate(fixture, 'imported', [createRegion('create', 'hero-new'), requirementItem('req', requirement)]);

    const alone = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['req']));
    expect(alone).toMatchObject({ ok: false, code: 'invalid-materialized-reference' });
    expect(await materializedDirs(fixture.root)).toEqual([]);

    const both = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['create', 'req']));
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    const created = await readNew(fixture.root, both.referenceId);
    expect(created.regions?.map((region) => region.id)).toEqual(['header', 'content', 'hero-new']);
    expect(created.requirements?.at(-1)).toEqual(buildReferenceRequirement(requirement));
  });

  it('keeps existing requirements first with recomputed identical ids, then selected requirements in selection order', async () => {
    const fixture = await sourceFixture();
    const first: RawReferenceRequirement = { category: 'protected', subject: { kind: 'region-property', region: 'content', property: 'width' }, tolerance: { kind: 'percent', amount: 5 } };
    const second: RawReferenceRequirement = { category: 'expected-dependent', expectedDependentMode: 'required', subject: { kind: 'region-relationship', subjectRegion: 'content', relatedRegion: 'header', relationship: 'follows-vertically' } };
    const annotation = await annotate(fixture, 'imported', [requirementItem('first', first), requirementItem('second', second)]);

    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['second', 'first']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = await readNew(fixture.root, result.referenceId);
    expect(created.requirements?.slice(0, 2)).toEqual(fixture.imported.requirements);
    expect(created.requirements?.slice(0, 2).map((r) => r.requirementId)).toEqual(fixture.imported.requirements?.map((r) => r.requirementId));
    expect(created.requirements?.slice(2)).toEqual([buildReferenceRequirement(second), buildReferenceRequirement(first)]);
  });

  it('materializes only the selected additions', async () => {
    const fixture = await sourceFixture();
    const requirement: RawReferenceRequirement = { category: 'requested', subject: { kind: 'region-property', region: 'region-a', property: 'x' }, tolerance: { kind: 'exact' } };
    const annotation = await annotate(fixture, 'imported', [createRegion('a', 'region-a', 150, 80, 50, 50), createRegion('b', 'region-b', 250, 80, 50, 50), requirementItem('c', requirement)]);
    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['a', 'c']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = await readNew(fixture.root, result.referenceId);
    expect(created.regions?.map((region) => region.id)).toEqual(['header', 'content', 'region-a']);
    expect(created.requirements).toHaveLength(3);
  });

  it('preserves applicability and label exactly, and reuses the canonical image bytes without re-encoding', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [createRegion('create', 'new-region')]);
    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['create']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = await readNew(fixture.root, result.referenceId);
    expect(created.applicability).toEqual(fixture.imported.applicability);
    expect(created.provenance.label).toBe('materialization-source');
    const sourceImage = imageOf(fixture.imported);
    const newImage = imageOf(created);
    expect({ sha256: newImage.sha256, format: newImage.format, width: newImage.width, height: newImage.height }).toEqual({ sha256: sourceImage.sha256, format: sourceImage.format, width: sourceImage.width, height: sourceImage.height });
    expect(Buffer.from(await readFile(result.imagePath)).equals(Buffer.from(fixture.imageBytes))).toBe(true);
  });

  it('does not invent a label or applicability when the source has none', async () => {
    const fixture = await sourceFixture({ label: null, applicability: null });
    const annotation = await annotate(fixture, 'imported', [createRegion('create', 'new-region')]);
    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['create']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = await readNew(fixture.root, result.referenceId);
    expect(created.provenance.label).toBeUndefined();
    expect(created.applicability).toBeUndefined();
  });

  it('from an approved source: supersedes the approved id, stays imported, reuses the owning image bytes, and changes neither source directory', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'approved', [createRegion('create', 'new-region')]);
    const approvedBefore = await snapshotDir(fixture.approvedRoot);
    const importedBefore = await snapshotDir(fixture.importedRoot);
    const referenceDirsBefore = await readdir(path.join(fixture.root, 'references'));

    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'approved', annotation, ['create']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = await readNew(fixture.root, result.referenceId);
    expect(created.lifecycle.state).toBe('imported');
    expect(created.supersedesReferenceId).toBe(fixture.approved.referenceId);
    expect(created.supersedesReferenceId).not.toBe(fixture.imported.referenceId);
    expect(imageOf(created).sha256).toBe(imageOf(fixture.imported).sha256);
    expect(await snapshotDir(fixture.approvedRoot)).toEqual(approvedBefore);
    expect(await snapshotDir(fixture.importedRoot)).toEqual(importedBefore);
    // No approved sibling: exactly one new imported artifact, nothing new among the source references.
    expect(await readdir(path.join(fixture.root, 'references'))).toEqual(referenceDirsBefore);
    expect(await materializedDirs(fixture.root)).toEqual([result.referenceId]);
  });

  it('the materialized reference is acceptable input to the existing explicit approval workflow', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [createRegion('create', 'new-region')]);
    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['create']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const approved = await approveExternalReference(result.artifactRoot, { outputLocation: 'approved-later', cwd: fixture.root });
    expect(approved.ok).toBe(true);
  });

  it('keeps the same canonical request identity and a fresh reference id for identical inputs', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [createRegion('create', 'new-region')]);
    const first = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['create']));
    const second = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['create']));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.referenceRequestId).toBe(first.referenceRequestId);
    expect(second.referenceId).not.toBe(first.referenceId);
  });

  it('exposes normal canonical relationships and adequacy for the new reference', async () => {
    const fixture = await sourceFixture();
    const requirement: RawReferenceRequirement = { category: 'expected-dependent', expectedDependentMode: 'required', subject: { kind: 'region-relationship', subjectRegion: 'content', relatedRegion: 'header', relationship: 'follows-vertically' } };
    const annotation = await annotate(fixture, 'imported', [requirementItem('rel', requirement)]);
    const result = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['rel']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = await readNew(fixture.root, result.referenceId);
    const relationships = deriveReferenceRegionRelationships(created.referenceRequestId, created.regions ?? []);
    expect(relationships.ok).toBe(true);
    if (!relationships.ok) return;
    expect(relationships.graph.pairwiseRelationships).toContainEqual(expect.objectContaining({ kind: 'follows-vertically', subjectRegion: 'content', relatedRegion: 'header' }));
    const adequacy = deriveReferenceRequirementAdequacy(created.regions ?? [], created.requirements ?? []);
    expect(adequacy.totalRequirements).toBe(3);
    expect(adequacy.status).toBe('adequate');
  });
});

describe('materializeVisualAnnotationReference rejections (no partial write)', () => {
  async function expectRejected(fixture: SourceFixture, options: MaterializeVisualAnnotationReferenceOptions, code: string): Promise<void> {
    const importSpy = vi.spyOn(referencePersistence, 'importExternalReference');
    const result = await materializeVisualAnnotationReference(options);
    expect(result).toMatchObject({ ok: false, code });
    expect(importSpy).not.toHaveBeenCalled();
    expect(await materializedDirs(fixture.root)).toEqual([]);
    importSpy.mockRestore();
  }

  it('rejects candidate, informational, uninterpreted, unknown, empty, and duplicate selections', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [
      candidateItem('candidate-region', { kind: 'reference-region', mode: 'create', region: { id: 'cand', rectangle: { x: 10, y: 10, width: 20, height: 20 } } }),
      candidateItem('candidate-req', { kind: 'reference-requirement', requirement: SOURCE_REQUIREMENTS[0] as RawReferenceRequirement }),
      confirmed('inspect', { kind: 'inspect' }),
      confirmed('asset', { kind: 'asset-sensitive', regionId: 'header' }),
      { annotationItemId: 'plain', mark: { kind: 'point', x: 5, y: 5 }, interpretation: { state: 'uninterpreted' } },
      createRegion('create', 'new-region'),
    ]);
    for (const ids of [['candidate-region'], ['candidate-req'], ['inspect'], ['asset'], ['plain'], ['missing'], [], ['create', 'create'], ['create', 'inspect']]) {
      await expectRejected(fixture, optionsFor(fixture, 'imported', annotation, ids), 'invalid-selection');
    }
    expect(referenceMaterializationBlockReason(annotation.items[2] as VisualAnnotationItem)).toMatch(/informational/);
  });

  it('rejects create collisions, duplicate refines, and create-then-refine in one request', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [
      createRegion('collide-source', 'Header', 150, 100, 50, 50),
      createRegion('new-1', 'new-region', 150, 100, 50, 50),
      createRegion('new-2', 'NEW-REGION', 250, 100, 50, 50),
      refineRegion('refine-1', 'header', 0, 0, 400, 70),
      refineRegion('refine-2', 'header', 0, 0, 400, 80),
      refineRegion('refine-new', 'new-region', 150, 100, 60, 60),
    ]);
    await expectRejected(fixture, optionsFor(fixture, 'imported', annotation, ['collide-source']), 'invalid-selection');
    await expectRejected(fixture, optionsFor(fixture, 'imported', annotation, ['new-1', 'new-2']), 'invalid-selection');
    await expectRejected(fixture, optionsFor(fixture, 'imported', annotation, ['refine-1', 'refine-2']), 'invalid-selection');
    await expectRejected(fixture, optionsFor(fixture, 'imported', annotation, ['new-1', 'refine-new']), 'invalid-selection');
  });

  it('rejects a selected relationship requirement contradicted by the final refined geometry', async () => {
    const fixture = await sourceFixture({
      regions: [
        { id: 'a', rectangle: { x: 0, y: 100, width: 100, height: 100 } },
        { id: 'b', rectangle: { x: 200, y: 100, width: 100, height: 100 } },
      ],
      requirements: [{ category: 'requested', subject: { kind: 'region-property', region: 'a', property: 'x' }, tolerance: { kind: 'exact' } }],
    });
    const leftOf: RawReferenceRequirement = { category: 'protected', subject: { kind: 'region-relationship', subjectRegion: 'a', relatedRegion: 'b', relationship: 'left-of' } };
    const annotation = await annotate(fixture, 'imported', [refineRegion('refine-a', 'a', 300, 220, 90, 60), requirementItem('left-of', leftOf)]);
    await expectRejected(fixture, optionsFor(fixture, 'imported', annotation, ['refine-a', 'left-of']), 'invalid-materialized-reference');

    // The same relationship with unchanged geometry is normal and succeeds.
    const ok = await materializeVisualAnnotationReference(optionsFor(fixture, 'imported', annotation, ['left-of']));
    expect(ok.ok).toBe(true);
  });

  it('rejects a duplicate of an existing source requirement through canonical collection validation', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [requirementItem('dup', SOURCE_REQUIREMENTS[0] as RawReferenceRequirement)]);
    await expectRejected(fixture, optionsFor(fixture, 'imported', annotation, ['dup']), 'invalid-materialized-reference');
  });

  it('rejects a runtime annotation, a mismatched source, a mismatched root, and image bytes that do not match the source SHA-256', async () => {
    const fixture = await sourceFixture();
    const annotation = await annotate(fixture, 'imported', [createRegion('create', 'new-region')]);

    const evidence = await writeAnnotatableEvidence(fixture.root);
    const runtime = await readManifest<VisualAnnotationArtifact>((await persistAnnotationUnder(fixture.root, runtimeSourceFor(evidence.observation), [{ annotationItemId: 'r', mark: { kind: 'point', x: 1, y: 1 }, interpretation: { state: 'confirmed', intent: { kind: 'inspect' }, confirmedAt: '2026-09-17T00:00:00.000Z' } }])).artifactRoot);
    await expectRejected(fixture, { ...optionsFor(fixture, 'imported', annotation, ['r']), annotation: runtime }, 'invalid-source');

    await expectRejected(fixture, { ...optionsFor(fixture, 'imported', annotation, ['create']), sourceReference: fixture.approved, sourceReferenceRoot: fixture.approvedRoot }, 'source-mismatch');
    await expectRejected(fixture, { ...optionsFor(fixture, 'imported', annotation, ['create']), sourceReferenceRoot: fixture.approvedRoot }, 'source-mismatch');
    await expectRejected(fixture, { ...optionsFor(fixture, 'imported', annotation, ['create']), imageBytes: buildRealPng(400, 300, [1, 2, 3]) }, 'source-mismatch');
  });
});
