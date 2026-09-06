import { describe, expect, it } from 'vitest';
import {
  isValidRawReferenceRequirement,
  buildReferenceRequirement,
  isValidReferenceRequirementShape,
  isValidReferenceRequirements,
  isValidReferenceRequirementTolerance,
  deriveReferenceRequirementMeasurement,
  deriveReferenceRequirementExpectation,
  deriveReferenceRequirementAdequacy,
  isValidReferenceRequirementAdequacy,
  MAX_REFERENCE_REQUIREMENTS,
  REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MIN,
  REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MAX,
  REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MIN,
  REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MAX,
} from '../../src/domain/externalReferenceRequirements.js';
import { deriveReferenceRegionGeometry } from '../../src/domain/externalReferenceRegions.js';
import type { ReferenceRegion } from '../../src/domain/externalReferenceRegions.js';
import type { RawReferenceRequirement, ExternalReferenceRequirement } from '../../src/domain/externalReferenceRequirements.js';

function region(id: string, x: number, y: number, width: number, height: number): ReferenceRegion {
  return { id, rectangle: { x, y, width, height } };
}

const header = region('header', 0, 0, 800, 60);
const card = region('current-page-card', 28, 92, 424, 82);
const regions: ReferenceRegion[] = [header, card];

function rawPropertyRequirement(overrides: Partial<RawReferenceRequirement> = {}): RawReferenceRequirement {
  return {
    category: 'requested',
    subject: { kind: 'region-property', region: 'current-page-card', property: 'width' },
    tolerance: { kind: 'absolute-reference-px', amount: 4 },
    ...overrides,
  } as RawReferenceRequirement;
}

function build(raw: RawReferenceRequirement): ExternalReferenceRequirement {
  const validation = isValidRawReferenceRequirement(raw);
  if (!validation.valid) throw new Error(`fixture is invalid: ${validation.reason}`);
  return buildReferenceRequirement(raw);
}

describe('externalReferenceRequirements', () => {
  // Behavior A: valid single-region property requirement.
  it('A: accepts a valid requested region-property requirement', () => {
    expect(isValidRawReferenceRequirement(rawPropertyRequirement())).toEqual({ valid: true });
  });

  it('accepts valid expected-dependent, protected, and preserved requirements', () => {
    expect(isValidRawReferenceRequirement(rawPropertyRequirement({ category: 'expected-dependent', expectedDependentMode: 'required' }))).toEqual({ valid: true });
    expect(isValidRawReferenceRequirement(rawPropertyRequirement({ category: 'expected-dependent', expectedDependentMode: 'permitted' }))).toEqual({ valid: true });
    expect(isValidRawReferenceRequirement(rawPropertyRequirement({ category: 'protected' }))).toEqual({ valid: true });
    expect(isValidRawReferenceRequirement(rawPropertyRequirement({ category: 'preserved' }))).toEqual({ valid: true });
  });

  // Authored 'unexpected' is impossible - not a member of AuthoredChangeScopeCategory at all.
  it('rejects an authored "unexpected" category', () => {
    expect(isValidRawReferenceRequirement(rawPropertyRequirement({ category: 'unexpected' as never })).valid).toBe(false);
  });

  it('rejects expected-dependent without a mode, and rejects a mode on any other category', () => {
    expect(isValidRawReferenceRequirement(rawPropertyRequirement({ category: 'expected-dependent' })).valid).toBe(false);
    expect(isValidRawReferenceRequirement(rawPropertyRequirement({ category: 'requested', expectedDependentMode: 'required' })).valid).toBe(false);
  });

  it('rejects an authored requirementId - it is always system-computed', () => {
    expect(isValidRawReferenceRequirement({ ...rawPropertyRequirement(), requirementId: 'x' }).valid).toBe(false);
  });

  // B: valid relationship requirement (no tolerance).
  it('B: accepts a valid region-relationship requirement with no tolerance', () => {
    const raw: RawReferenceRequirement = { category: 'requested', subject: { kind: 'region-relationship', subjectRegion: 'current-page-card', relatedRegion: 'header', relationship: 'below' } };
    expect(isValidRawReferenceRequirement(raw)).toEqual({ valid: true });
  });

  it('rejects a tolerance on a region-relationship subject', () => {
    const raw = { category: 'requested', subject: { kind: 'region-relationship', subjectRegion: 'a', relatedRegion: 'b', relationship: 'below' }, tolerance: { kind: 'exact' } };
    expect(isValidRawReferenceRequirement(raw).valid).toBe(false);
  });

  it('accepts a valid region-measurement requirement with a tolerance, and rejects one without', () => {
    const raw: RawReferenceRequirement = {
      category: 'requested',
      subject: { kind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'current-page-card', measurement: 'vertical-gap' },
      tolerance: { kind: 'absolute-reference-px', amount: 4 },
    };
    expect(isValidRawReferenceRequirement(raw)).toEqual({ valid: true });
    const withoutTolerance = { category: raw.category, subject: raw.subject };
    expect(isValidRawReferenceRequirement(withoutTolerance).valid).toBe(false);
  });

  // Unsupported property/measurement/relationship -> invalid, not silently accepted.
  it('rejects an unsupported region property, measurement, or relationship kind', () => {
    expect(isValidRawReferenceRequirement(rawPropertyRequirement({ subject: { kind: 'region-property', region: 'current-page-card', property: 'zIndex' as never } })).valid).toBe(false);
    const badMeasurement = { category: 'requested', subject: { kind: 'region-measurement', subjectRegion: 'a', relatedRegion: 'b', measurement: 'diagonal' }, tolerance: { kind: 'exact' } };
    expect(isValidRawReferenceRequirement(badMeasurement).valid).toBe(false);
    const badRelationship = { category: 'requested', subject: { kind: 'region-relationship', subjectRegion: 'a', relatedRegion: 'b', relationship: 'inside-out' } };
    expect(isValidRawReferenceRequirement(badRelationship).valid).toBe(false);
  });

  // Collection-level: unknown region id fails validation (never merely "unavailable" evidence).
  it('D: rejects a requirement referencing an unknown region id at the collection level', () => {
    const requirement = build(rawPropertyRequirement({ subject: { kind: 'region-property', region: 'crawl-button', property: 'width' } }));
    const result = isValidReferenceRequirements([requirement], regions);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('unknown region id');
  });

  // E: duplicate requirement (exact same subject) rejected.
  it('E: rejects two requirements that duplicate the exact same subject', () => {
    const first = build(rawPropertyRequirement());
    const second = build(rawPropertyRequirement({ category: 'protected' })); // same subject, different category - still rejected under the chosen rule
    const result = isValidReferenceRequirements([first, second], regions);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('duplicates the subject');
  });

  // F: "conflicting categories" on the same subject is handled by the same duplicate-subject rule (documented choice - see docs/CONTRACTS.md).
  it('F: same-subject-different-category is rejected by the duplicate-subject rule, not silently accepted', () => {
    const requested = build(rawPropertyRequirement({ category: 'requested' }));
    const protectedReq = build(rawPropertyRequirement({ category: 'protected' }));
    expect(isValidReferenceRequirements([requested, protectedReq], regions).valid).toBe(false);
  });

  it('a relationship subject is treated as the same subject regardless of which region is declared first', () => {
    const a = build({ category: 'requested', subject: { kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'current-page-card', relationship: 'above' } });
    const b = build({ category: 'requested', subject: { kind: 'region-relationship', subjectRegion: 'current-page-card', relatedRegion: 'header', relationship: 'above' } });
    expect(isValidReferenceRequirements([a, b], regions).valid).toBe(false);
  });

  // S: requirement limit - exact max accepted, one over rejected.
  it('S: accepts exactly MAX_REFERENCE_REQUIREMENTS and rejects one over', () => {
    const manyRegions: ReferenceRegion[] = Array.from({ length: MAX_REFERENCE_REQUIREMENTS }, (_, i) => region(`r${i}`, i, 0, 1, 1));
    const maxRequirements = manyRegions.map((r) => build({ category: 'requested', subject: { kind: 'region-property', region: r.id, property: 'width' }, tolerance: { kind: 'exact' } }));
    expect(isValidReferenceRequirements(maxRequirements, manyRegions)).toEqual({ valid: true });

    const overMax = [...maxRequirements, build({ category: 'requested', subject: { kind: 'region-property', region: manyRegions[0]!.id, property: 'height' }, tolerance: { kind: 'exact' } })];
    expect(isValidReferenceRequirements(overMax, manyRegions).valid).toBe(false);
  });

  it('rejects a non-array requirements value', () => {
    expect(isValidReferenceRequirements({ id: 'x' }, regions).valid).toBe(false);
  });

  // deterministic requirement identity + input/region participation + tolerance/category participation - already covered directly in externalReferenceRequirementIdentity.test.ts; spot-check via buildReferenceRequirement here.
  it('buildReferenceRequirement computes a deterministic id from content, never authored', () => {
    const raw = rawPropertyRequirement();
    const a = buildReferenceRequirement(raw);
    const b = buildReferenceRequirement(raw);
    expect(a.requirementId).toBe(b.requirementId);
    expect(a.requirementId).not.toBe('');
  });

  // Tolerance validation -------------------------------------------------------

  it('K: exact tolerance boundary behavior is deterministic (no amount field allowed)', () => {
    expect(isValidReferenceRequirementTolerance({ kind: 'exact' })).toBe(true);
    expect(isValidReferenceRequirementTolerance({ kind: 'exact', amount: 0 })).toBe(false);
  });

  it('L: absolute-reference-px tolerance accepts within bounds and rejects outside', () => {
    expect(isValidReferenceRequirementTolerance({ kind: 'absolute-reference-px', amount: REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MIN })).toBe(true);
    expect(isValidReferenceRequirementTolerance({ kind: 'absolute-reference-px', amount: REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MAX })).toBe(true);
    expect(isValidReferenceRequirementTolerance({ kind: 'absolute-reference-px', amount: REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MIN - 1 })).toBe(false);
    expect(isValidReferenceRequirementTolerance({ kind: 'absolute-reference-px', amount: REFERENCE_REQUIREMENT_TOLERANCE_ABSOLUTE_PX_MAX + 1 })).toBe(false);
  });

  it('M: percent tolerance validation is correct at and outside bounds', () => {
    expect(isValidReferenceRequirementTolerance({ kind: 'percent', amount: REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MIN })).toBe(true);
    expect(isValidReferenceRequirementTolerance({ kind: 'percent', amount: REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MAX })).toBe(true);
    expect(isValidReferenceRequirementTolerance({ kind: 'percent', amount: REFERENCE_REQUIREMENT_TOLERANCE_PERCENT_MAX + 1 })).toBe(false);
  });

  // N: invalid tolerance fails closed.
  it('N: rejects negative, non-finite, and unsupported-kind tolerances', () => {
    expect(isValidReferenceRequirementTolerance({ kind: 'absolute-reference-px', amount: -1 })).toBe(false);
    expect(isValidReferenceRequirementTolerance({ kind: 'absolute-reference-px', amount: NaN })).toBe(false);
    expect(isValidReferenceRequirementTolerance({ kind: 'absolute-reference-px', amount: Infinity })).toBe(false);
    expect(isValidReferenceRequirementTolerance({ kind: 'color-distance', amount: 1 })).toBe(false);
    expect(isValidReferenceRequirementTolerance('exact')).toBe(false);
  });

  // Measurement derivation -----------------------------------------------------

  it('derives vertical-gap/horizontal-gap correctly, and undefined when regions overlap on that axis', () => {
    const headerGeom = deriveReferenceRegionGeometry(header.rectangle);
    const cardGeom = deriveReferenceRegionGeometry(card.rectangle);
    expect(deriveReferenceRequirementMeasurement('vertical-gap', headerGeom, cardGeom)).toBe(32); // card.y(92) - header.bottom(60)
    expect(deriveReferenceRequirementMeasurement('vertical-gap', cardGeom, headerGeom)).toBe(32); // direction-agnostic result

    const overlapping = deriveReferenceRegionGeometry({ x: 0, y: 0, width: 50, height: 50 });
    const overlapping2 = deriveReferenceRegionGeometry({ x: 25, y: 25, width: 50, height: 50 });
    expect(deriveReferenceRequirementMeasurement('vertical-gap', overlapping, overlapping2)).toBeUndefined();
    expect(deriveReferenceRequirementMeasurement('horizontal-gap', overlapping, overlapping2)).toBeUndefined();
  });

  it('derives center/edge deltas as plain non-negative distances', () => {
    const a = deriveReferenceRegionGeometry({ x: 0, y: 0, width: 100, height: 100 });
    const b = deriveReferenceRegionGeometry({ x: 10, y: 20, width: 100, height: 100 });
    expect(deriveReferenceRequirementMeasurement('center-x-delta', a, b)).toBe(10);
    expect(deriveReferenceRequirementMeasurement('center-y-delta', a, b)).toBe(20);
    expect(deriveReferenceRequirementMeasurement('left-edge-delta', a, b)).toBe(10);
    expect(deriveReferenceRequirementMeasurement('right-edge-delta', a, b)).toBe(10);
  });

  // Reference expectation derivation -------------------------------------------

  it('derives a numeric expectation for a region-property subject', () => {
    const expectation = deriveReferenceRequirementExpectation({ kind: 'region-property', region: 'current-page-card', property: 'width' }, regions);
    expect(expectation).toEqual({ available: true, kind: 'numeric', value: 424 });
  });

  it('derives a numeric expectation for a region-measurement subject, and reports unavailable when geometrically undefined', () => {
    const expectation = deriveReferenceRequirementExpectation({ kind: 'region-measurement', subjectRegion: 'header', relatedRegion: 'current-page-card', measurement: 'vertical-gap' }, regions);
    expect(expectation).toEqual({ available: true, kind: 'numeric', value: 32 });

    const overlapRegions = [region('a', 0, 0, 50, 50), region('b', 25, 25, 50, 50)];
    const unavailable = deriveReferenceRequirementExpectation({ kind: 'region-measurement', subjectRegion: 'a', relatedRegion: 'b', measurement: 'vertical-gap' }, overlapRegions);
    expect(unavailable.available).toBe(false);
  });

  // C/relationship: reference expected evidence derivable for a valid relationship requirement.
  it('C: derives a matching relationship expectation when the reference actually exhibits it', () => {
    const expectation = deriveReferenceRequirementExpectation({ kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'current-page-card', relationship: 'above' }, regions);
    expect(expectation).toEqual({ available: true, kind: 'relationship', matches: true });
  });

  it('reports a non-matching relationship expectation honestly, not as available:false', () => {
    const expectation = deriveReferenceRequirementExpectation({ kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'current-page-card', relationship: 'below' }, regions);
    expect(expectation).toEqual({ available: true, kind: 'relationship', matches: false });
  });

  // 'follows-vertically' is the one family whose direction is decided by actual geometry (see
  // relationships.ts#verticalSequenceOf) rather than always matching the caller's declared order -
  // "header" is geometrically above "current-page-card", so the derivation assigns
  // subjectRegion="current-page-card" (the one that follows), the reverse of what is declared here.
  it('reports unavailable with a helpful reason when follows-vertically evidence is only derivable in the opposite region order', () => {
    const expectation = deriveReferenceRequirementExpectation({ kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'current-page-card', relationship: 'follows-vertically' }, regions);
    expect(expectation.available).toBe(false);
    if (!expectation.available) expect(expectation.reason).toContain('opposite region order');
  });

  // Adequacy --------------------------------------------------------------------

  // O: zero requirements is explicitly inadequate.
  it('O: zero requirements is explicitly inadequate, not merely absent', () => {
    const adequacy = deriveReferenceRequirementAdequacy(regions, []);
    expect(adequacy.status).toBe('inadequate');
    expect(adequacy.totalRequirements).toBe(0);
    expect(adequacy.reasons).toEqual([{ code: 'no-selected-requirements', detail: expect.any(String) }]);
  });

  // P: all requirements supported -> adequate.
  it('P: adequate when every requirement is fully evaluable', () => {
    const requirement = build(rawPropertyRequirement());
    const adequacy = deriveReferenceRequirementAdequacy(regions, [requirement]);
    expect(adequacy).toEqual({ status: 'adequate', totalRequirements: 1, evaluableRequirements: 1, unavailableRequirements: 0, reasons: [] });
  });

  // Q: one required evidence gap -> partial.
  it('Q: partial when some but not all requirements are evaluable', () => {
    const good = build(rawPropertyRequirement());
    const bad = build({ category: 'requested', subject: { kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'current-page-card', relationship: 'below' } });
    const adequacy = deriveReferenceRequirementAdequacy(regions, [good, bad]);
    expect(adequacy.status).toBe('partial');
    expect(adequacy.evaluableRequirements).toBe(1);
    expect(adequacy.unavailableRequirements).toBe(1);
  });

  it('inadequate when every requirement is unavailable', () => {
    const bad = build({ category: 'requested', subject: { kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'current-page-card', relationship: 'below' } });
    const adequacy = deriveReferenceRequirementAdequacy(regions, [bad]);
    expect(adequacy.status).toBe('inadequate');
  });

  // R: multiple failures -> deterministic reason ordering (authored order).
  it('R: reasons are ordered deterministically by authored requirement order', () => {
    const bad1 = build({ category: 'requested', subject: { kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'current-page-card', relationship: 'below' } });
    const bad2 = build({ category: 'protected', subject: { kind: 'region-relationship', subjectRegion: 'header', relatedRegion: 'current-page-card', relationship: 'left-of' } });
    const adequacy = deriveReferenceRequirementAdequacy(regions, [bad1, bad2]);
    expect(adequacy.reasons.map((r) => r.requirementId)).toEqual([bad1.requirementId, bad2.requirementId]);
  });

  it('adequacy result never includes a numeric score field', () => {
    const adequacy = deriveReferenceRequirementAdequacy(regions, [build(rawPropertyRequirement())]);
    expect(Object.keys(adequacy).sort()).toEqual(['evaluableRequirements', 'reasons', 'status', 'totalRequirements', 'unavailableRequirements']);
  });

  // Immutability
  it('never mutates the input regions or requirements', () => {
    const requirement = build(rawPropertyRequirement());
    const regionsSnapshot = JSON.parse(JSON.stringify(regions));
    const requirementSnapshot = JSON.parse(JSON.stringify(requirement));
    isValidReferenceRequirements([requirement], regions);
    deriveReferenceRequirementAdequacy(regions, [requirement]);
    expect(regions).toEqual(regionsSnapshot);
    expect(requirement).toEqual(requirementSnapshot);
  });

  it('isValidReferenceRequirementShape validates a fully-built requirement including its id', () => {
    const requirement = build(rawPropertyRequirement());
    expect(isValidReferenceRequirementShape(requirement)).toEqual({ valid: true });
    expect(isValidReferenceRequirementShape({ ...requirement, requirementId: '' }).valid).toBe(false);
  });
});

// v0.7 Prompt 7 addition: defense-in-depth structural validator for the already-frozen Prompt 3 shape.
describe('isValidReferenceRequirementAdequacy', () => {
  it('accepts a valid adequate/partial/inadequate value', () => {
    expect(isValidReferenceRequirementAdequacy({ status: 'adequate', totalRequirements: 1, evaluableRequirements: 1, unavailableRequirements: 0, reasons: [] })).toBe(true);
    expect(
      isValidReferenceRequirementAdequacy({
        status: 'inadequate',
        totalRequirements: 0,
        evaluableRequirements: 0,
        unavailableRequirements: 0,
        reasons: [{ code: 'no-selected-requirements' }],
      }),
    ).toBe(true);
    expect(
      isValidReferenceRequirementAdequacy({
        status: 'partial',
        totalRequirements: 2,
        evaluableRequirements: 1,
        unavailableRequirements: 1,
        reasons: [{ code: 'missing-reference-relationship-evidence', requirementId: 'r1', detail: 'x' }],
      }),
    ).toBe(true);
  });

  it('rejects an invalid status, negative/non-integer counts, or a malformed reason', () => {
    expect(isValidReferenceRequirementAdequacy({ status: 'bogus', totalRequirements: 0, evaluableRequirements: 0, unavailableRequirements: 0, reasons: [] })).toBe(false);
    expect(isValidReferenceRequirementAdequacy({ status: 'adequate', totalRequirements: -1, evaluableRequirements: 0, unavailableRequirements: 0, reasons: [] })).toBe(false);
    expect(isValidReferenceRequirementAdequacy({ status: 'adequate', totalRequirements: 1.5, evaluableRequirements: 0, unavailableRequirements: 0, reasons: [] })).toBe(false);
    expect(
      isValidReferenceRequirementAdequacy({ status: 'inadequate', totalRequirements: 0, evaluableRequirements: 0, unavailableRequirements: 0, reasons: [{ code: 'not-a-real-code' }] }),
    ).toBe(false);
  });

  it('rejects a non-object value', () => {
    expect(isValidReferenceRequirementAdequacy(null)).toBe(false);
    expect(isValidReferenceRequirementAdequacy('x')).toBe(false);
  });
});
