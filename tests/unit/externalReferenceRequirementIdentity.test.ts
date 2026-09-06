import { describe, expect, it } from 'vitest';
import { buildReferenceRequirementIdentity } from '../../src/domain/externalReferenceRequirementIdentity.js';

const subjectA = { kind: 'region-property', region: 'header', property: 'width' };
const subjectB = { kind: 'region-property', region: 'header', property: 'height' };
const toleranceExact = { kind: 'exact' };
const toleranceAbs = { kind: 'absolute-reference-px', amount: 4 };

describe('externalReferenceRequirementIdentity', () => {
  it('identical content produces the identical requirement identity', () => {
    const a = buildReferenceRequirementIdentity(subjectA, 'requested', toleranceExact);
    const b = buildReferenceRequirementIdentity(subjectA, 'requested', toleranceExact);
    expect(a).toBe(b);
  });

  it('changing the subject changes the identity', () => {
    const a = buildReferenceRequirementIdentity(subjectA, 'requested', toleranceExact);
    const b = buildReferenceRequirementIdentity(subjectB, 'requested', toleranceExact);
    expect(a).not.toBe(b);
  });

  it('changing the category changes the identity', () => {
    const a = buildReferenceRequirementIdentity(subjectA, 'requested', toleranceExact);
    const b = buildReferenceRequirementIdentity(subjectA, 'protected', toleranceExact);
    expect(a).not.toBe(b);
  });

  it('changing the tolerance changes the identity', () => {
    const a = buildReferenceRequirementIdentity(subjectA, 'requested', toleranceExact);
    const b = buildReferenceRequirementIdentity(subjectA, 'requested', toleranceAbs);
    expect(a).not.toBe(b);
  });

  it('changing expectedDependentMode changes the identity', () => {
    const a = buildReferenceRequirementIdentity(subjectA, 'expected-dependent', toleranceExact, 'required');
    const b = buildReferenceRequirementIdentity(subjectA, 'expected-dependent', toleranceExact, 'permitted');
    expect(a).not.toBe(b);
  });

  it('is independent of any operational context - identical calls from "different places" still match', () => {
    const first = buildReferenceRequirementIdentity(subjectA, 'requested', toleranceAbs, undefined);
    const second = buildReferenceRequirementIdentity(subjectA, 'requested', toleranceAbs);
    expect(first).toBe(second);
  });
});
