import { describe, expect, it } from 'vitest';
import {
  CONTRACT_ARTIFACT_KIND,
  CONTRACT_SCHEMA_VERSION,
  AUTHORED_CHANGE_SCOPE_CATEGORIES,
  CHANGE_SCOPE_CLASSIFICATIONS,
  isAuthoredChangeScopeCategory,
  CONTRACT_TOLERANCE_ABSOLUTE_PX_MIN,
  CONTRACT_TOLERANCE_ABSOLUTE_PX_MAX,
  CONTRACT_TOLERANCE_PERCENT_MIN,
  CONTRACT_TOLERANCE_PERCENT_MAX,
  isValidContractTolerance,
  CONTRACT_PRIMITIVE_KINDS,
  isValidContractPrimitive,
  isValidBaselineClause,
  isValidPerChangeClause,
  isValidFrontendContractObservationReference,
  isValidPersistentBaselineContract,
  isValidPerChangeContract,
  CLAUSE_RESULT_STATUSES,
  isValidClauseEvaluationResult,
  OVERALL_VERDICTS,
  type ContractPrimitive,
  type PersistentBaselineContract,
  type PerChangeContract,
  type PerChangeClause,
  type FrontendContractObservationReference,
} from '../../src/domain/frontendContracts.js';
import { PAIRWISE_RELATIONSHIP_KINDS, PAGE_LEVEL_RELATIONSHIP_KINDS } from '../../src/domain/relationships.js';
import { DEPENDENCY_PROPERTIES } from '../../src/domain/comparison.js';
import { ARTIFACT_KIND, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import { COMPARISON_ARTIFACT_KIND, COMPARISON_SCHEMA_VERSION, isValidComparisonConfig, isValidComparisonArtifact } from '../../src/domain/comparison.js';

function sourceObservation(): FrontendContractObservationReference {
  return {
    observationId: 'obs-1',
    requestId: 'req-1',
    producer: { name: PRODUCER_NAME, version: '0.4.0' },
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  };
}

function visiblePrimitive(target = 'workspace'): ContractPrimitive {
  return { kind: 'target-visible', target };
}

function baselineContract(overrides: Partial<PersistentBaselineContract> = {}): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-1',
    sourceObservation: sourceObservation(),
    clauses: [{ clauseId: 'clause-1', primitive: visiblePrimitive(), supportingEvidence: [] }],
    provenance: { approvedAt: '2026-08-13T00:00:00.000Z' },
    ...overrides,
  };
}

function changeClause(overrides: Partial<PerChangeClause> = {}): PerChangeClause {
  return {
    clauseId: 'clause-req-1',
    primitive: visiblePrimitive('sidebar'),
    supportingEvidence: [],
    category: 'requested',
    ...overrides,
  };
}

function changeContract(overrides: Partial<PerChangeContract> = {}): PerChangeContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'change',
    contractId: 'change-1',
    contractRequestId: 'change-request-1',
    activeBaselineIds: [],
    clauses: [changeClause()],
    ...overrides,
  };
}

// TST-001
describe('isValidPersistentBaselineContract', () => {
  it('accepts a representative valid baseline contract', () => {
    expect(isValidPersistentBaselineContract(baselineContract())).toEqual({ valid: true });
  });

  it('rejects a baseline missing sourceObservation', () => {
    const rest: Record<string, unknown> = { ...baselineContract() };
    delete rest.sourceObservation;
    const result = isValidPersistentBaselineContract(rest);
    expect(result.valid).toBe(false);
  });
});

// TST-002, TST-003
describe('isValidPerChangeContract / authored category vocabulary', () => {
  it('accepts a contract with one clause per authored category (TST-002)', () => {
    const contract = changeContract({
      clauses: [
        changeClause({ clauseId: 'c-requested', category: 'requested' }),
        changeClause({ clauseId: 'c-expected', category: 'expected-dependent', expectedDependentMode: 'required' }),
        changeClause({ clauseId: 'c-protected', category: 'protected' }),
        changeClause({ clauseId: 'c-preserved', category: 'preserved' }),
      ],
    });
    expect(isValidPerChangeContract(contract)).toEqual({ valid: true });
  });

  it('has exactly 4 authored categories, never including "unexpected" (TST-003)', () => {
    expect(AUTHORED_CHANGE_SCOPE_CATEGORIES).toHaveLength(4);
    expect(AUTHORED_CHANGE_SCOPE_CATEGORIES).not.toContain('unexpected');
    expect(CHANGE_SCOPE_CLASSIFICATIONS).toHaveLength(5);
    expect(CHANGE_SCOPE_CLASSIFICATIONS).toContain('unexpected');
  });

  it('rejects a clause authored with category "unexpected" (TST-003)', () => {
    expect(isAuthoredChangeScopeCategory('unexpected')).toBe(false);
    const clause = changeClause({ category: 'unexpected' as unknown as PerChangeClause['category'] });
    expect(isValidPerChangeClause(clause)).toBe(false);
    const contract = changeContract({ clauses: [clause] });
    expect(isValidPerChangeContract(contract)).toEqual({ valid: false, reason: expect.any(String) });
  });
});

// TST-004
describe('expectedDependentMode gating (INV-003)', () => {
  it('accepts expected-dependent with a valid mode', () => {
    const clause = changeClause({ category: 'expected-dependent', expectedDependentMode: 'permitted' });
    expect(isValidPerChangeClause(clause)).toBe(true);
  });

  it('rejects expected-dependent with mode omitted', () => {
    const clause = changeClause({ category: 'expected-dependent' });
    expect(isValidPerChangeClause(clause)).toBe(false);
  });

  it('rejects a non-expected-dependent category carrying a mode', () => {
    const clause = changeClause({ category: 'requested', expectedDependentMode: 'required' });
    expect(isValidPerChangeClause(clause)).toBe(false);
  });
});

// TST-005
describe('supersedesBaselineClauseIds (INV-006)', () => {
  it('accepts the field omitted', () => {
    expect(isValidPerChangeClause(changeClause())).toBe(true);
  });

  it('accepts a non-empty array', () => {
    expect(isValidPerChangeClause(changeClause({ supersedesBaselineClauseIds: ['clause-1'] }))).toBe(true);
  });

  it('rejects an empty array', () => {
    expect(isValidPerChangeClause(changeClause({ supersedesBaselineClauseIds: [] }))).toBe(false);
  });
});

// TST-006
describe('baseline supersession history (INV-007)', () => {
  it('lets a new baseline reference a prior baseline without mutating it', () => {
    const baselineA = baselineContract({ baselineId: 'baseline-a' });
    const snapshotBefore = JSON.parse(JSON.stringify(baselineA));
    const baselineB = baselineContract({ baselineId: 'baseline-b', supersedesBaselineId: baselineA.baselineId });
    expect(isValidPersistentBaselineContract(baselineA)).toEqual({ valid: true });
    expect(isValidPersistentBaselineContract(baselineB)).toEqual({ valid: true });
    expect(baselineA).toEqual(snapshotBefore);
    expect(baselineB.supersedesBaselineId).toBe('baseline-a');
  });
});

// TST-007
describe('isValidContractTolerance (INV-008)', () => {
  it('accepts exact and in-bound absolute-px/percent values', () => {
    expect(isValidContractTolerance({ kind: 'exact' })).toBe(true);
    expect(isValidContractTolerance({ kind: 'absolute-px', amount: CONTRACT_TOLERANCE_ABSOLUTE_PX_MIN })).toBe(true);
    expect(isValidContractTolerance({ kind: 'absolute-px', amount: CONTRACT_TOLERANCE_ABSOLUTE_PX_MAX })).toBe(true);
    expect(isValidContractTolerance({ kind: 'absolute-px', amount: 50 })).toBe(true);
    expect(isValidContractTolerance({ kind: 'percent', amount: CONTRACT_TOLERANCE_PERCENT_MIN })).toBe(true);
    expect(isValidContractTolerance({ kind: 'percent', amount: CONTRACT_TOLERANCE_PERCENT_MAX })).toBe(true);
  });

  it('rejects out-of-range, non-finite, and unrecognized-kind values (fail closed)', () => {
    expect(isValidContractTolerance({ kind: 'absolute-px', amount: CONTRACT_TOLERANCE_ABSOLUTE_PX_MIN - 1 })).toBe(false);
    expect(isValidContractTolerance({ kind: 'absolute-px', amount: CONTRACT_TOLERANCE_ABSOLUTE_PX_MAX + 1 })).toBe(false);
    expect(isValidContractTolerance({ kind: 'percent', amount: Number.NaN })).toBe(false);
    expect(isValidContractTolerance({ kind: 'percent', amount: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidContractTolerance({ kind: 'bogus', amount: 1 })).toBe(false);
  });
});

// TST-008
describe('isValidContractPrimitive - full CONTRACT_PRIMITIVE_KINDS coverage', () => {
  const representative: Record<(typeof CONTRACT_PRIMITIVE_KINDS)[number], ContractPrimitive> = {
    'target-visible': { kind: 'target-visible', target: 'workspace' },
    'target-not-clipped': { kind: 'target-not-clipped', target: 'workspace' },
    'target-width-within-bound': { kind: 'target-width-within-bound', target: 'workspace', minPx: 100, maxPx: 400 },
    'targets-do-not-overlap': { kind: 'targets-do-not-overlap', targetA: 'nav', targetB: 'workspace' },
    'target-wider-than': { kind: 'target-wider-than', targetA: 'workspace', targetB: 'sidebar' },
    'target-follows-vertically': { kind: 'target-follows-vertically', targetA: 'footer', targetB: 'workspace' },
    'target-fits-inside': { kind: 'target-fits-inside', target: 'card', container: 'workspace' },
    'document-width-fits-viewport': { kind: 'document-width-fits-viewport' },
    'scroll-owner-is-document': { kind: 'scroll-owner-is-document' },
    'target-does-not-own-scroll': { kind: 'target-does-not-own-scroll', target: 'workspace' },
    'target-begins-below-initial-viewport': { kind: 'target-begins-below-initial-viewport', target: 'footer' },
    'relationship-unchanged': { kind: 'relationship-unchanged', relationshipKind: PAIRWISE_RELATIONSHIP_KINDS[0] },
    'property-unchanged-within-tolerance': {
      kind: 'property-unchanged-within-tolerance',
      target: 'workspace',
      property: DEPENDENCY_PROPERTIES[0],
      tolerance: { kind: 'exact' },
    },
    'property-increases': { kind: 'property-increases', target: 'workspace', property: DEPENDENCY_PROPERTIES[0] },
    'property-decreases': { kind: 'property-decreases', target: 'workspace', property: DEPENDENCY_PROPERTIES[0] },
  };

  it('has exactly 15 frozen kinds', () => {
    expect(CONTRACT_PRIMITIVE_KINDS).toHaveLength(15);
  });

  for (const kind of CONTRACT_PRIMITIVE_KINDS) {
    it(`accepts a representative "${kind}" primitive`, () => {
      expect(isValidContractPrimitive(representative[kind])).toBe(true);
    });
  }

  it('accepts every PAIRWISE_RELATIONSHIP_KINDS and PAGE_LEVEL_RELATIONSHIP_KINDS value in relationship-unchanged', () => {
    for (const relationshipKind of [...PAIRWISE_RELATIONSHIP_KINDS, ...PAGE_LEVEL_RELATIONSHIP_KINDS]) {
      expect(isValidContractPrimitive({ kind: 'relationship-unchanged', relationshipKind })).toBe(true);
    }
  });

  it('accepts every DEPENDENCY_PROPERTIES value in property-increases/decreases', () => {
    for (const property of DEPENDENCY_PROPERTIES) {
      expect(isValidContractPrimitive({ kind: 'property-increases', target: 'workspace', property })).toBe(true);
      expect(isValidContractPrimitive({ kind: 'property-decreases', target: 'workspace', property })).toBe(true);
    }
  });

  it('rejects an unrecognized kind', () => {
    expect(isValidContractPrimitive({ kind: 'bogus-primitive', target: 'workspace' })).toBe(false);
  });
});

// TST-009
describe('EvidenceReference reuse', () => {
  it('accepts a valid evidence reference on a clause', () => {
    const clause = { clauseId: 'c-1', primitive: visiblePrimitive(), supportingEvidence: [{ path: 'targetEvidence.workspace.geometry' }] };
    expect(isValidBaselineClause(clause)).toBe(true);
  });

  it('rejects a malformed evidence reference (missing/empty path)', () => {
    const missingPath = { clauseId: 'c-1', primitive: visiblePrimitive(), supportingEvidence: [{}] };
    const emptyPath = { clauseId: 'c-1', primitive: visiblePrimitive(), supportingEvidence: [{ path: '' }] };
    expect(isValidBaselineClause(missingPath)).toBe(false);
    expect(isValidBaselineClause(emptyPath)).toBe(false);
  });
});

// TST-010
describe('ClauseEvaluationResult and OverallVerdict vocabulary', () => {
  it('accepts valid pass/fail/unavailable/conflict variants', () => {
    expect(isValidClauseEvaluationResult({ clauseId: 'c-1', status: 'pass', supportingEvidence: [] })).toBe(true);
    expect(isValidClauseEvaluationResult({ clauseId: 'c-1', status: 'fail', supportingEvidence: [] })).toBe(true);
    expect(isValidClauseEvaluationResult({ clauseId: 'c-1', status: 'unavailable', reason: 'evidence missing', supportingEvidence: [] })).toBe(true);
    expect(
      isValidClauseEvaluationResult({
        clauseId: 'c-1',
        status: 'conflict',
        reason: 'two active requirements disagree',
        conflictingClauseIds: ['c-1', 'c-2'],
        supportingEvidence: [],
      }),
    ).toBe(true);
  });

  it('rejects unavailable without a reason (INV-004: never fabricate pass)', () => {
    expect(isValidClauseEvaluationResult({ clauseId: 'c-1', status: 'unavailable', supportingEvidence: [] })).toBe(false);
  });

  it('rejects conflict with fewer than 2 conflicting clause ids (INV-005)', () => {
    expect(
      isValidClauseEvaluationResult({ clauseId: 'c-1', status: 'conflict', reason: 'x', conflictingClauseIds: ['c-1'], supportingEvidence: [] }),
    ).toBe(false);
  });

  it('rejects pass/fail carrying a reason field', () => {
    expect(isValidClauseEvaluationResult({ clauseId: 'c-1', status: 'pass', reason: 'should not be here', supportingEvidence: [] })).toBe(false);
  });

  it('freezes exactly PASS/FAIL as the overall verdict vocabulary', () => {
    expect(OVERALL_VERDICTS).toEqual(['PASS', 'FAIL']);
  });

  it('has exactly the 4 clause result statuses', () => {
    expect(CLAUSE_RESULT_STATUSES).toEqual(['pass', 'fail', 'unavailable', 'conflict']);
  });
});

// TST-011
describe('artifact/schema family separation (INV-009)', () => {
  it('uses a distinct artifactKind from observation and comparison', () => {
    expect(CONTRACT_ARTIFACT_KIND).not.toBe(ARTIFACT_KIND);
    expect(CONTRACT_ARTIFACT_KIND).not.toBe(COMPARISON_ARTIFACT_KIND);
  });

  it('leaves observation and comparison schema versions unchanged', () => {
    expect(OBSERVATION_SCHEMA_VERSION).toBe('1.2.0');
    expect(COMPARISON_SCHEMA_VERSION).toBe('1.0.0');
    expect(CONTRACT_SCHEMA_VERSION).toBe('1.0.0');
  });
});

// TST-012
describe('v0.4 ComparisonConfig/ComparisonArtifact remain evidence-only (INV-009)', () => {
  it('still rejects v0.5 change-scope keys on ComparisonConfig', () => {
    const withExtraKeys = { geometryTolerancePx: 0.5, requestedChanges: [] };
    expect(isValidComparisonConfig(withExtraKeys)).toBe(false);
  });

  it('still validates a representative v0.4 ComparisonArtifact unchanged', () => {
    const artifact = {
      artifactKind: COMPARISON_ARTIFACT_KIND,
      schemaVersion: COMPARISON_SCHEMA_VERSION,
      comparisonId: 'cmp-1',
      comparisonRequestId: 'cmp-req-1',
      producer: { name: PRODUCER_NAME, version: '0.4.0' },
      provenance: { comparedAt: '2026-08-13T00:00:00.000Z' },
      before: {
        observationId: 'obs-before',
        requestId: 'req-1',
        producer: { name: PRODUCER_NAME, version: '0.4.0' },
        observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
        screenshot: { path: 'before.png' },
      },
      after: {
        observationId: 'obs-after',
        requestId: 'req-1',
        producer: { name: PRODUCER_NAME, version: '0.4.0' },
        observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
        screenshot: { path: 'after.png' },
      },
      config: { geometryTolerancePx: 0.5 },
      comparability: { state: 'comparable', reasons: [] },
      configurationChanges: [],
      relationshipsBefore: {
        observationId: 'obs-before',
        requestId: 'req-1',
        geometryTolerancePx: 0.5,
        targets: [],
        unresolvedTargets: [],
        pairwiseRelationships: [],
        pageRelationships: [],
      },
      relationshipsAfter: {
        observationId: 'obs-after',
        requestId: 'req-1',
        geometryTolerancePx: 0.5,
        targets: [],
        unresolvedTargets: [],
        pairwiseRelationships: [],
        pageRelationships: [],
      },
      differences: [],
      relationshipChanges: [],
      expectedDependencyEvidence: [],
      diagnostics: [],
      limits: { truncated: false, omittedFields: [], omittedTargetPairs: [] },
    };
    expect(isValidComparisonArtifact(artifact)).toEqual({ valid: true });
  });
});

// TST-014
describe('closed-vocabulary validators reject open-ended/generic input', () => {
  it('rejects an expression-shaped ContractPrimitive', () => {
    expect(isValidContractPrimitive({ kind: 'expression', code: '1+1' })).toBe(false);
  });

  it('rejects a ContractPrimitive with an extra unexpected evaluate field', () => {
    expect(isValidContractPrimitive({ kind: 'target-visible', target: 'workspace', evaluate: '1+1' })).toBe(false);
  });

  it('rejects a formula-shaped ContractTolerance', () => {
    expect(isValidContractTolerance({ kind: 'formula', expression: 'x * 2' })).toBe(false);
  });

  it('rejects an invented ClauseEvaluationResult status', () => {
    expect(isValidClauseEvaluationResult({ clauseId: 'c-1', status: 'partial-pass', supportingEvidence: [] })).toBe(false);
  });
});

// FrontendContractObservationReference structural check (supports TST-001)
describe('isValidFrontendContractObservationReference', () => {
  it('accepts a well-formed reference', () => {
    expect(isValidFrontendContractObservationReference(sourceObservation())).toBe(true);
  });

  it('rejects a mismatched observationSchemaVersion', () => {
    expect(isValidFrontendContractObservationReference({ ...sourceObservation(), observationSchemaVersion: '9.9.9' })).toBe(false);
  });
});
