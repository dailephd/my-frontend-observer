import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importExternalReference, approveExternalReference } from '../../src/application/externalReferencePersistenceService.js';
import { EXTERNAL_REFERENCE_MAX_IMAGE_BYTES } from '../../src/domain/externalReferenceImage.js';
import { EXTERNAL_REFERENCE_MANIFEST_FILENAME } from '../../src/artifacts/externalReferenceArtifactWriter.js';
import type { ImportedExternalReferenceArtifact, ApprovedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import { buildMinimalPng, buildTruncatedPng, buildUnrecognizedBytes } from './externalReferenceImageFixtures.js';

describe('externalReferencePersistenceService', () => {
  const tempDirs: string[] = [];

  async function freshCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-external-reference-service-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // TST-009: valid import persists a complete, unapproved artifact.
  it('TST-009: imports a valid reference image as a complete, unapproved artifact', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildMinimalPng(37, 41), { outputLocation: '.', cwd, label: 'homepage hero' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.lifecycle).toEqual({ state: 'imported' });
    expect(manifest.diagnostics).toEqual([]);
    expect(manifest.completion).toEqual({ state: 'complete' });
    expect(manifest.provenance.label).toBe('homepage hero');
    expect(path.isAbsolute(manifest.image.path)).toBe(false);
  });

  // TST-010: unsupported format fails closed with the exact diagnostic code, nothing persisted.
  it('TST-010: rejects an unsupported/undetectable image format', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildUnrecognizedBytes(), { outputLocation: '.', cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('unsupported-image-format');
    await expect(readdir(cwd)).resolves.toEqual([]);
  });

  // TST-011: an over-limit byte length fails closed.
  it('TST-011: rejects an image over the maximum byte-length bound', async () => {
    const cwd = await freshCwd();
    const oversized = new Uint8Array(EXTERNAL_REFERENCE_MAX_IMAGE_BYTES + 1);
    oversized.set(buildMinimalPng(1, 1));
    const result = await importExternalReference(oversized, { outputLocation: '.', cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('image-too-large');
  });

  // TST-012: invalid/truncated dimensions fail closed.
  it('TST-012: rejects a truncated/invalid-dimension header', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildTruncatedPng(), { outputLocation: '.', cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('invalid-image-dimensions');
  });

  // TST-013: an unresolvable --supersedes target fails closed, nothing persisted.
  it('TST-013: rejects import when supersedesReferenceRoot does not resolve', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildMinimalPng(10, 10), {
      outputLocation: '.',
      cwd,
      supersedesReferenceRoot: path.join(cwd, 'does-not-exist'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('reference-not-found');
    await expect(readdir(cwd)).resolves.toEqual([]);
  });

  // TST-014: import never approves, regardless of label/supersedes.
  it('TST-014: an imported artifact is never in the approved lifecycle state', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildMinimalPng(10, 10), { outputLocation: '.', cwd, label: 'x' });
    if (!result.ok) throw new Error('expected ok result');
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.lifecycle.state).toBe('imported');
  });

  // TST-006/TST-007 (application level): identical image content from a different operational root produces the same referenceRequestId; different content produces a different one.
  it('produces the same referenceRequestId for byte-identical images from different output roots, and a different one for different content', async () => {
    const cwdA = await freshCwd();
    const cwdB = await freshCwd();
    const same = buildMinimalPng(50, 60);
    const different = buildMinimalPng(51, 60);

    const resultA = await importExternalReference(same, { outputLocation: '.', cwd: cwdA });
    const resultB = await importExternalReference(same, { outputLocation: 'nested/output', cwd: cwdB });
    const resultC = await importExternalReference(different, { outputLocation: '.', cwd: cwdA });
    if (!resultA.ok || !resultB.ok || !resultC.ok) throw new Error('expected all imports to succeed');

    expect(resultA.referenceRequestId).toBe(resultB.referenceRequestId);
    expect(resultA.referenceId).not.toBe(resultB.referenceId); // fresh instance identity even for the same logical reference
    expect(resultC.referenceRequestId).not.toBe(resultA.referenceRequestId);
  });

  // TST-015: approving an imported reference persists a distinct, sourceReference-carrying artifact, without mutating the imported one.
  it('TST-015: approves an imported reference into a new artifact instance that references, never copies, the image', async () => {
    const cwd = await freshCwd();
    const imported = await importExternalReference(buildMinimalPng(37, 41), { outputLocation: '.', cwd });
    if (!imported.ok) throw new Error('expected import to succeed');
    const importedManifestBefore = await readFile(imported.manifestPath, 'utf8');

    const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: '.', cwd });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error('expected approve to succeed');
    expect(approved.referenceId).not.toBe(imported.referenceId);
    expect(approved.referenceRequestId).toBe(imported.referenceRequestId);

    const approvedManifest = JSON.parse(await readFile(approved.manifestPath, 'utf8')) as ApprovedExternalReferenceArtifact;
    expect(approvedManifest.lifecycle.state).toBe('approved');
    expect(typeof (approvedManifest.lifecycle as { approvedAt: string }).approvedAt).toBe('string');
    expect(approvedManifest.sourceReference.referenceId).toBe(imported.referenceId);
    expect(approvedManifest.sourceReference.referenceRequestId).toBe(imported.referenceRequestId);

    const approvedFiles = await readdir(approved.artifactRoot);
    expect(approvedFiles).toEqual([EXTERNAL_REFERENCE_MANIFEST_FILENAME]);

    const importedManifestAfter = await readFile(imported.manifestPath, 'utf8');
    expect(importedManifestAfter).toBe(importedManifestBefore);
  });

  // TST-016: re-approving an already-approved artifact fails closed.
  it('TST-016: refuses to approve an artifact that is not in the "imported" state', async () => {
    const cwd = await freshCwd();
    const imported = await importExternalReference(buildMinimalPng(10, 10), { outputLocation: '.', cwd });
    if (!imported.ok) throw new Error('expected import to succeed');
    const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: '.', cwd });
    if (!approved.ok) throw new Error('expected first approval to succeed');

    const reApproved = await approveExternalReference(approved.artifactRoot, { outputLocation: '.', cwd });
    expect(reApproved.ok).toBe(false);
    if (reApproved.ok) throw new Error('expected re-approval to be rejected');
    expect(reApproved.diagnostics[0]?.code).toBe('invalid-request');
  });

  // TST-017: approving a nonexistent/unreadable target fails closed.
  it('TST-017: rejects approving a nonexistent reference root', async () => {
    const cwd = await freshCwd();
    const result = await approveExternalReference(path.join(cwd, 'nowhere'), { outputLocation: '.', cwd });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('reference-not-found');
  });

  // TST-018: explicit forward-only supersession - the new artifact points at the old one; the old one is never rewritten (no superseded-by field appears on it).
  it('TST-018: supersession is forward-pointer-only and never rewrites the superseded artifact', async () => {
    const cwd = await freshCwd();
    const x = await importExternalReference(buildMinimalPng(10, 10), { outputLocation: '.', cwd });
    if (!x.ok) throw new Error('expected import of X to succeed');
    const xApproved = await approveExternalReference(x.artifactRoot, { outputLocation: '.', cwd });
    if (!xApproved.ok) throw new Error('expected approval of X to succeed');
    const xManifestBefore = await readFile(xApproved.manifestPath, 'utf8');

    const y = await importExternalReference(buildMinimalPng(20, 20), { outputLocation: '.', cwd, supersedesReferenceRoot: xApproved.artifactRoot });
    if (!y.ok) throw new Error('expected import of Y to succeed');
    const yApproved = await approveExternalReference(y.artifactRoot, { outputLocation: '.', cwd, supersedesReferenceRoot: xApproved.artifactRoot });
    expect(yApproved.ok).toBe(true);
    if (!yApproved.ok) throw new Error('expected approval of Y to succeed');

    const yManifest = JSON.parse(await readFile(yApproved.manifestPath, 'utf8')) as ApprovedExternalReferenceArtifact;
    expect(yManifest.supersedesReferenceId).toBe(xApproved.referenceId);

    const xManifestAfter = await readFile(xApproved.manifestPath, 'utf8');
    expect(xManifestAfter).toBe(xManifestBefore);
    expect(xManifestAfter.includes('supersededBy')).toBe(false);
  });

  // v0.7 Prompt 2: importing with a valid region set persists it, and reports the correct count.
  it('imports a reference with valid regions and persists them', async () => {
    const cwd = await freshCwd();
    const regions = [
      { id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 60 } },
      { id: 'current-page-card', rectangle: { x: 28, y: 92, width: 424, height: 82 } },
    ];
    const result = await importExternalReference(buildMinimalPng(800, 600), { outputLocation: '.', cwd, regions });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.regionCount).toBe(2);

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.regions).toEqual(regions);
  });

  // Legacy compatibility (behavior S): importing without regions produces an artifact with no `regions` key at all, and behaves exactly as in Prompt 1.
  it('importing without regions produces no regions field and a regionCount of 0', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildMinimalPng(100, 100), { outputLocation: '.', cwd });
    if (!result.ok) throw new Error('expected ok result');
    expect(result.regionCount).toBe(0);

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect('regions' in manifest).toBe(false);
  });

  // Fail-closed: an invalid region set rejects the whole import, nothing persisted.
  it('rejects import when a region is out of the image bounds, and persists nothing', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildMinimalPng(100, 100), {
      outputLocation: '.',
      cwd,
      regions: [{ id: 'overflow', rectangle: { x: 90, y: 0, width: 50, height: 20 } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('invalid-reference-region');
    await expect(readdir(cwd)).resolves.toEqual([]);
  });

  it('rejects import when regions contain a duplicate id', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildMinimalPng(200, 200), {
      outputLocation: '.',
      cwd,
      regions: [
        { id: 'a', rectangle: { x: 0, y: 0, width: 10, height: 10 } },
        { id: 'a', rectangle: { x: 20, y: 20, width: 10, height: 10 } },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('invalid-reference-region');
  });

  // Approval carries regions forward unchanged - never re-validated, never re-derived, never dropped.
  it('approval carries the imported artifact\'s regions forward unchanged', async () => {
    const cwd = await freshCwd();
    const regions = [{ id: 'header', rectangle: { x: 0, y: 0, width: 100, height: 40 } }];
    const imported = await importExternalReference(buildMinimalPng(400, 300), { outputLocation: '.', cwd, regions });
    if (!imported.ok) throw new Error('expected import to succeed');

    const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: '.', cwd });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error('expected approval to succeed');
    expect(approved.regionCount).toBe(1);

    const approvedManifest = JSON.parse(await readFile(approved.manifestPath, 'utf8')) as ApprovedExternalReferenceArtifact;
    expect(approvedManifest.regions).toEqual(regions);
  });

  // Approval of a regionless import carries forward "no regions" (not an empty array, not a fabricated one).
  it('approval of a regionless import has no regions field', async () => {
    const cwd = await freshCwd();
    const imported = await importExternalReference(buildMinimalPng(100, 100), { outputLocation: '.', cwd });
    if (!imported.ok) throw new Error('expected import to succeed');

    const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: '.', cwd });
    if (!approved.ok) throw new Error('expected approval to succeed');
    expect(approved.regionCount).toBe(0);

    const approvedManifest = JSON.parse(await readFile(approved.manifestPath, 'utf8')) as ApprovedExternalReferenceArtifact;
    expect('regions' in approvedManifest).toBe(false);
  });

  // Behavior T: an already-approved historical artifact's manifest is never rewritten by any later action in this module (approval is the only writer, and it always creates a brand-new instance).
  it('an approved artifact\'s manifest is never mutated by any later import/approve call', async () => {
    const cwd = await freshCwd();
    const imported = await importExternalReference(buildMinimalPng(300, 200), {
      outputLocation: '.',
      cwd,
      regions: [{ id: 'a', rectangle: { x: 0, y: 0, width: 50, height: 50 } }],
    });
    if (!imported.ok) throw new Error('expected import to succeed');
    const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: '.', cwd });
    if (!approved.ok) throw new Error('expected approval to succeed');
    const approvedManifestBefore = await readFile(approved.manifestPath, 'utf8');

    // Unrelated later activity in the same output directory.
    await importExternalReference(buildMinimalPng(50, 50), { outputLocation: '.', cwd });

    const approvedManifestAfter = await readFile(approved.manifestPath, 'utf8');
    expect(approvedManifestAfter).toBe(approvedManifestBefore);
  });

  // v0.7 Prompt 3: importing with valid requirements persists them and reports adequacy.
  it('imports a reference with valid requirements and reports adequacy', async () => {
    const cwd = await freshCwd();
    const regions = [{ id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 60 } }];
    const requirements = [{ category: 'requested' as const, subject: { kind: 'region-property' as const, region: 'header', property: 'width' as const }, tolerance: { kind: 'exact' as const } }];
    const result = await importExternalReference(buildMinimalPng(800, 600), { outputLocation: '.', cwd, regions, requirements });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.requirementCount).toBe(1);
    expect(result.adequacy.status).toBe('adequate');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.requirements).toHaveLength(1);
    expect(manifest.requirements![0]!.requirementId).toBeTruthy();
  });

  // Legacy compatibility: importing without requirements has no requirements field and reports inadequate (zero requirements).
  it('importing without requirements has no requirements field and reports inadequate adequacy', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildMinimalPng(100, 100), { outputLocation: '.', cwd });
    if (!result.ok) throw new Error('expected ok result');
    expect(result.requirementCount).toBe(0);
    expect(result.adequacy.status).toBe('inadequate');

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect('requirements' in manifest).toBe(false);
  });

  // Fail-closed: a requirement referencing an unknown region rejects the whole import, nothing persisted.
  it('rejects import when a requirement references an unknown region, and persists nothing', async () => {
    const cwd = await freshCwd();
    const regions = [{ id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 60 } }];
    const requirements = [{ category: 'requested' as const, subject: { kind: 'region-property' as const, region: 'crawl-button', property: 'width' as const }, tolerance: { kind: 'exact' as const } }];
    const result = await importExternalReference(buildMinimalPng(800, 600), { outputLocation: '.', cwd, regions, requirements });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('invalid-reference-requirement');
    await expect(readdir(cwd)).resolves.toEqual([]);
  });

  it('rejects an authored requirementId in raw requirement input', async () => {
    const cwd = await freshCwd();
    const regions = [{ id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 60 } }];
    const requirements = [{ requirementId: 'x', category: 'requested' as const, subject: { kind: 'region-property' as const, region: 'header', property: 'width' as const }, tolerance: { kind: 'exact' as const } }] as never;
    const result = await importExternalReference(buildMinimalPng(800, 600), { outputLocation: '.', cwd, regions, requirements });
    expect(result.ok).toBe(false);
  });

  // Approval carries requirements forward unchanged.
  it('approval carries the imported artifact\'s requirements forward unchanged, with matching adequacy', async () => {
    const cwd = await freshCwd();
    const regions = [{ id: 'header', rectangle: { x: 0, y: 0, width: 800, height: 60 } }];
    const requirements = [{ category: 'requested' as const, subject: { kind: 'region-property' as const, region: 'header', property: 'width' as const }, tolerance: { kind: 'exact' as const } }];
    const imported = await importExternalReference(buildMinimalPng(800, 600), { outputLocation: '.', cwd, regions, requirements });
    if (!imported.ok) throw new Error('expected import to succeed');

    const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: '.', cwd });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error('expected approval to succeed');
    expect(approved.requirementCount).toBe(1);
    expect(approved.adequacy.status).toBe('adequate');

    const approvedManifest = JSON.parse(await readFile(approved.manifestPath, 'utf8')) as ApprovedExternalReferenceArtifact;
    expect(approvedManifest.requirements).toHaveLength(1);
  });

  // v0.7 Prompt 4: importing with valid applicability persists it and reports hasApplicability.
  it('imports a reference with valid applicability and reports hasApplicability', async () => {
    const cwd = await freshCwd();
    const applicability = { viewport: { width: 1280, height: 720 }, theme: 'dark' };
    const result = await importExternalReference(buildMinimalPng(800, 600), { outputLocation: '.', cwd, applicability });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.hasApplicability).toBe(true);

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect(manifest.applicability).toEqual(applicability);
  });

  // Legacy compatibility: importing without applicability has no applicability field and reports hasApplicability: false.
  it('importing without applicability has no applicability field and reports hasApplicability: false', async () => {
    const cwd = await freshCwd();
    const result = await importExternalReference(buildMinimalPng(100, 100), { outputLocation: '.', cwd });
    if (!result.ok) throw new Error('expected ok result');
    expect(result.hasApplicability).toBe(false);

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as ImportedExternalReferenceArtifact;
    expect('applicability' in manifest).toBe(false);
  });

  // Fail-closed: invalid applicability rejects the whole import, nothing persisted.
  it('rejects import when applicability is invalid, and persists nothing', async () => {
    const cwd = await freshCwd();
    const applicability = { viewport: { width: 10, height: 10 } };
    const result = await importExternalReference(buildMinimalPng(800, 600), { outputLocation: '.', cwd, applicability });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('invalid-reference-applicability');
    await expect(readdir(cwd)).resolves.toEqual([]);
  });

  // Approval carries applicability forward unchanged.
  it('approval carries the imported artifact\'s applicability forward unchanged', async () => {
    const cwd = await freshCwd();
    const applicability = { theme: 'dark', authenticatedState: 'authenticated' as const };
    const imported = await importExternalReference(buildMinimalPng(800, 600), { outputLocation: '.', cwd, applicability });
    if (!imported.ok) throw new Error('expected import to succeed');

    const approved = await approveExternalReference(imported.artifactRoot, { outputLocation: '.', cwd });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error('expected approval to succeed');
    expect(approved.hasApplicability).toBe(true);

    const approvedManifest = JSON.parse(await readFile(approved.manifestPath, 'utf8')) as ApprovedExternalReferenceArtifact;
    expect(approvedManifest.applicability).toEqual(applicability);
  });
});
