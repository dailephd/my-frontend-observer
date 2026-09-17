import { describe, expect, it } from 'vitest';
import {
  EMPTY_REQUIREMENT_FORM,
  MAX_REFERENCE_REGIONS,
  applyReferenceItemEdit,
  buildRequirementFromForm,
  candidateRegionSummary,
  confirmCandidate,
  regionCreateBlockedReason,
  requirementRegionIds,
  syncRegionGeometry,
  withAssetSensitiveCandidate,
  withInformationalCandidate,
  withRegionCreateCandidate,
  withRegionRefineCandidate,
  withRequirementCandidate,
} from '../../viewer/src/annotation/referenceIntent.js';
import type { RequirementForm } from '../../viewer/src/annotation/referenceIntent.js';
import { annotationViewBelongsToSource } from '../../viewer/src/hooks/useRuntimeAnnotations.js';
import { describeReferenceAssociation } from '../../viewer/src/components/ReferenceAnnotationPanel.js';
import { isValidVisualAnnotationContent } from '../../src/domain/visualAnnotation.js';
import { EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import type { VisualAnnotationItem, VisualAnnotationSource } from '../../src/domain/visualAnnotation.js';
import type { ReferenceRegion } from '../../src/domain/externalReferenceRegions.js';

const REGIONS: ReferenceRegion[] = [
  { id: 'header', rectangle: { x: 0, y: 0, width: 400, height: 60 } },
  { id: 'sidebar', rectangle: { x: 0, y: 60, width: 120, height: 240 } },
];

const RELATIONSHIPS = [{ kind: 'above' as const, subjectRegion: 'header', relatedRegion: 'sidebar', evidence: [] }];

const SOURCE: VisualAnnotationSource = {
  kind: 'external-reference',
  referenceId: 'ref-1',
  referenceRequestId: 'ref-request-1',
  referenceSchemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
  lifecycle: 'imported',
  imageOwnerReferenceId: 'ref-1',
  imageSha256: 'a'.repeat(64),
  coordinateSpace: { kind: 'reference-image-px', width: 400, height: 300 },
};

function rectangle(id = 'item-1', x = 200, y = 100): VisualAnnotationItem {
  return { annotationItemId: id, mark: { kind: 'rectangle', x, y, width: 100.5, height: 50 }, interpretation: { state: 'uninterpreted' } };
}

function point(id = 'item-p'): VisualAnnotationItem {
  return { annotationItemId: id, mark: { kind: 'point', x: 10, y: 10 }, interpretation: { state: 'uninterpreted' } };
}

function form(overrides: Partial<RequirementForm>): RequirementForm {
  return { ...EMPTY_REQUIREMENT_FORM, ...overrides };
}

function expectCanonicallyValid(items: VisualAnnotationItem[]): void {
  expect(isValidVisualAnnotationContent(SOURCE, items)).toEqual({ valid: true });
}

describe('candidate regions', () => {
  it('builds a create candidate from exact rectangle geometry only', () => {
    const created = withRegionCreateCandidate(rectangle(), 'new-region');
    expect(created?.interpretation).toEqual({ state: 'candidate', intent: { kind: 'reference-region', mode: 'create', region: { id: 'new-region', rectangle: { x: 200, y: 100, width: 100.5, height: 50 } } } });
    expect(created?.association).toBeUndefined();
    expect(withRegionCreateCandidate(point(), 'new-region')).toBeUndefined();
    expectCanonicallyValid([created as VisualAnnotationItem]);
  });

  it('builds a refine candidate with the explicit association to the refined region', () => {
    const refined = withRegionRefineCandidate(rectangle(), 'sidebar');
    expect(refined?.interpretation).toEqual({ state: 'candidate', intent: { kind: 'reference-region', mode: 'refine', region: { id: 'sidebar', rectangle: { x: 200, y: 100, width: 100.5, height: 50 } } } });
    expect(refined?.association).toEqual({ kind: 'reference-region', regionId: 'sidebar' });
    expect(withRegionRefineCandidate(point(), 'sidebar')).toBeUndefined();
    expectCanonicallyValid([refined as VisualAnnotationItem]);
  });

  it('refuses obvious create id problems without rewriting the id', () => {
    const items = [withRegionCreateCandidate(rectangle('other'), 'Promo') as VisualAnnotationItem, rectangle('self')];
    expect(regionCreateBlockedReason('', REGIONS, items, 'self')).toContain('Enter');
    expect(regionCreateBlockedReason('bad id', REGIONS, items, 'self')).toContain('letters, digits');
    expect(regionCreateBlockedReason('HEADER', REGIONS, items, 'self')).toContain('already exists');
    expect(regionCreateBlockedReason('promo', REGIONS, items, 'self')).toContain('Another draft item');
    expect(regionCreateBlockedReason('fresh_id-1', REGIONS, items, 'self')).toBeUndefined();
    // An item's own existing create proposal never blocks re-creating it.
    expect(regionCreateBlockedReason('Promo', REGIONS, items, 'other')).toBeUndefined();
  });

  it('makes create unavailable at the canonical region maximum', () => {
    const full = Array.from({ length: MAX_REFERENCE_REGIONS }, (_, i) => ({ id: `r${i}`, rectangle: { x: 0, y: 0, width: 1, height: 1 } }));
    expect(regionCreateBlockedReason('another', full, [rectangle('self')], 'self')).toContain('maximum');
  });

  it('keeps region geometry synchronized with the rectangle mark', () => {
    const created = withRegionCreateCandidate(rectangle(), 'new-region') as VisualAnnotationItem;
    const moved = syncRegionGeometry({ ...created, mark: { kind: 'rectangle', x: 150, y: 90, width: 100.5, height: 50 } });
    expect(moved.interpretation).toMatchObject({ intent: { region: { id: 'new-region', rectangle: { x: 150, y: 90, width: 100.5, height: 50 } } } });
    expect(syncRegionGeometry(point())).toEqual(point());
  });

  it('summarizes source regions, candidate creates, refinements, and requirement region choices', () => {
    const items = [withRegionCreateCandidate(rectangle('a'), 'promo') as VisualAnnotationItem, withRegionRefineCandidate(rectangle('b'), 'sidebar') as VisualAnnotationItem, point()];
    expect(candidateRegionSummary(REGIONS, items)).toEqual({ sourceRegions: 2, candidateCreates: 1, candidateRefinements: 1 });
    expect(requirementRegionIds(REGIONS, items)).toEqual(['header', 'sidebar', 'promo']);
  });
});

describe('confirmation', () => {
  it('confirms only candidates and records the timestamp', () => {
    const candidate = withInformationalCandidate(point());
    expect(confirmCandidate(candidate, '2026-09-17T00:00:00.000Z').interpretation).toEqual({ state: 'confirmed', intent: { kind: 'inspect' }, confirmedAt: '2026-09-17T00:00:00.000Z' });
    expect(confirmCandidate(point(), '2026-09-17T00:00:00.000Z')).toEqual(point());
  });

  it('withdraws confirmation when a move changes region geometry, keeping the synchronized intent as a candidate', () => {
    const confirmed = confirmCandidate(withRegionCreateCandidate(rectangle(), 'new-region') as VisualAnnotationItem, 'at');
    const moved = applyReferenceItemEdit(confirmed, (item) => ({ ...item, mark: { kind: 'rectangle', x: 210, y: 100, width: 100.5, height: 50 } }));
    expect(moved.interpretation).toEqual({ state: 'candidate', intent: { kind: 'reference-region', mode: 'create', region: { id: 'new-region', rectangle: { x: 210, y: 100, width: 100.5, height: 50 } } } });
    expectCanonicallyValid([moved]);
  });

  it('withdraws confirmation when the association, note text, or asset region changes', () => {
    const confirmed = confirmCandidate(withInformationalCandidate(point()), 'at');
    expect(applyReferenceItemEdit(confirmed, (item) => ({ ...item, association: { kind: 'reference-region', regionId: 'header' } })).interpretation.state).toBe('candidate');

    const note: VisualAnnotationItem = confirmCandidate({ ...withInformationalCandidate(point()), mark: { kind: 'note', anchor: { x: 1, y: 1 }, text: 'a' } }, 'at');
    expect(applyReferenceItemEdit(note, (item) => (item.mark.kind === 'note' ? { ...item, mark: { ...item.mark, text: 'b' } } : item)).interpretation.state).toBe('candidate');

    const asset = confirmCandidate(withAssetSensitiveCandidate(point(), 'header'), 'at');
    const changed = applyReferenceItemEdit(asset, (item) => withAssetSensitiveCandidate(item, 'sidebar'));
    expect(changed.interpretation).toEqual({ state: 'candidate', intent: { kind: 'asset-sensitive', regionId: 'sidebar' } });
  });

  it('keeps confirmation when an edit does not change meaning', () => {
    const confirmed = confirmCandidate(withInformationalCandidate(point()), 'at');
    expect(applyReferenceItemEdit(confirmed, (item) => ({ ...item })).interpretation).toEqual({ state: 'confirmed', intent: { kind: 'inspect' }, confirmedAt: 'at' });
  });
});

describe('informational and asset-sensitive intent', () => {
  it('builds exact canonical shapes', () => {
    expect(withInformationalCandidate(point()).interpretation).toEqual({ state: 'candidate', intent: { kind: 'inspect' } });
    expect(withAssetSensitiveCandidate(point()).interpretation).toEqual({ state: 'candidate', intent: { kind: 'asset-sensitive' } });
    expect(withAssetSensitiveCandidate(point(), 'header').interpretation).toEqual({ state: 'candidate', intent: { kind: 'asset-sensitive', regionId: 'header' } });
    expectCanonicallyValid([withInformationalCandidate(point('a')), withAssetSensitiveCandidate(point('b'), 'header')]);
  });
});

describe('candidate requirements', () => {
  const known = ['header', 'sidebar', 'promo'];

  it('builds a region-property requirement with a reference-pixel tolerance', () => {
    const result = buildRequirementFromForm(form({ category: 'protected', subjectKind: 'region-property', region: 'header', property: 'width', toleranceKind: 'absolute-reference-px', toleranceAmount: '4' }), known, RELATIONSHIPS);
    expect(result).toEqual({ ok: true, requirement: { category: 'protected', subject: { kind: 'region-property', region: 'header', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } } });
    if (result.ok) expectCanonicallyValid([withRequirementCandidate(point(), result.requirement)]);
  });

  it('requires an expected-dependent mode and omits it for other categories', () => {
    const base = { subjectKind: 'region-measurement' as const, subjectRegion: 'header', relatedRegion: 'sidebar', measurement: 'vertical-gap' as const, toleranceKind: 'exact' as const };
    expect(buildRequirementFromForm(form({ ...base, category: 'expected-dependent' }), known, RELATIONSHIPS).ok).toBe(false);
    expect(buildRequirementFromForm(form({ ...base, category: 'expected-dependent', expectedDependentMode: 'required' }), known, RELATIONSHIPS)).toMatchObject({ ok: true, requirement: { expectedDependentMode: 'required' } });
    const requested = buildRequirementFromForm(form({ ...base, category: 'requested', expectedDependentMode: 'required' }), known, RELATIONSHIPS);
    expect(requested.ok && 'expectedDependentMode' in requested.requirement).toBe(false);
  });

  it('builds a region-relationship requirement only from a canonical relationship, with no tolerance', () => {
    const result = buildRequirementFromForm(form({ category: 'preserved', subjectKind: 'region-relationship', relationshipIndex: '0', toleranceKind: 'percent', toleranceAmount: '5' }), known, RELATIONSHIPS);
    expect(result).toEqual({ ok: true, requirement: { category: 'preserved', subject: { kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'sidebar', relationship: 'above' } } });
    expect(buildRequirementFromForm(form({ category: 'preserved', subjectKind: 'region-relationship', relationshipIndex: '7' }), known, RELATIONSHIPS).ok).toBe(false);
  });

  it('builds a region-measurement requirement between two distinct known regions without any computed value', () => {
    const result = buildRequirementFromForm(form({ category: 'requested', subjectKind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'promo', measurement: 'center-x-delta', toleranceKind: 'percent', toleranceAmount: '10' }), known, RELATIONSHIPS);
    expect(result).toEqual({ ok: true, requirement: { category: 'requested', subject: { kind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'promo', measurement: 'center-x-delta' }, tolerance: { kind: 'percent', amount: 10 } } });
    expect(buildRequirementFromForm(form({ category: 'requested', subjectKind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'header', measurement: 'center-x-delta', toleranceKind: 'exact' }), known, RELATIONSHIPS).ok).toBe(false);
    expect(buildRequirementFromForm(form({ category: 'requested', subjectKind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'unknown', measurement: 'center-x-delta', toleranceKind: 'exact' }), known, RELATIONSHIPS).ok).toBe(false);
  });

  it('bounds tolerance amounts and requires a tolerance for numeric subjects', () => {
    const base = { category: 'requested' as const, subjectKind: 'region-property' as const, region: 'header', property: 'x' as const };
    expect(buildRequirementFromForm(form({ ...base }), known, RELATIONSHIPS).ok).toBe(false);
    for (const amount of ['', '-1', '100.5', 'abc', 'Infinity']) {
      expect(buildRequirementFromForm(form({ ...base, toleranceKind: 'percent', toleranceAmount: amount }), known, RELATIONSHIPS).ok, amount).toBe(false);
    }
    expect(buildRequirementFromForm(form({ ...base, toleranceKind: 'percent', toleranceAmount: '100' }), known, RELATIONSHIPS)).toMatchObject({ ok: true, requirement: { tolerance: { kind: 'percent', amount: 100 } } });
    expect(buildRequirementFromForm(form({ ...base, toleranceKind: 'exact' }), known, RELATIONSHIPS)).toMatchObject({ ok: true, requirement: { tolerance: { kind: 'exact' } } });
  });
});

describe('reference annotation membership and labels', () => {
  it('requires the exact reference family and handle', () => {
    const view = { ok: true, annotation: {} as never, source: { status: 'available', family: 'external-reference-approved', handle: 'external-reference-approved:references%2Fa' } };
    expect(annotationViewBelongsToSource(view, 'external-reference-approved:references%2Fa', 'external-reference-approved')).toBe(true);
    expect(annotationViewBelongsToSource(view, 'external-reference-approved:references%2Fa', 'external-reference-imported')).toBe(false);
    expect(annotationViewBelongsToSource(view, 'external-reference-imported:references%2Fb', 'external-reference-approved')).toBe(false);
  });

  it('describes reference associations explicitly', () => {
    expect(describeReferenceAssociation(undefined)).toBe('No association');
    expect(describeReferenceAssociation({ kind: 'reference-region', regionId: 'hero' })).toBe('Region association: hero');
    expect(describeReferenceAssociation({ kind: 'reference-relationship', subjectRegion: 'a', relatedRegion: 'b', relationship: 'above' })).toBe('Region relationship association: above (a → b)');
  });
});
