import { describe, expect, it } from 'vitest';
import {
  COMPARISON_ARTIFACT_KIND,
  COMPARISON_SCHEMA_VERSION,
  GEOMETRY_TOLERANCE_DEFAULT_PX,
  GEOMETRY_TOLERANCE_MIN_PX,
  GEOMETRY_TOLERANCE_MAX_PX,
  isValidGeometryTolerancePx,
  DIFFERENCE_KINDS,
  DEPENDENCY_PROPERTIES,
  DEPENDENCY_DIRECTIONS,
  DEPENDENCY_EVIDENCE_OUTCOMES,
  isValidExpectedDependencyDeclaration,
  isValidExpectedDependencyEvidence,
  isValidComparabilityResult,
  isValidComparisonDifference,
  isValidComparisonConfig,
  isValidComparisonArtifact,
} from '../../src/domain/comparison.js';
import type { ComparisonArtifact, ExpectedDependencyDeclaration } from '../../src/domain/comparison.js';
import { PRODUCER_NAME, SCHEMA_VERSION as OBSERVATION_SCHEMA_VERSION } from '../../src/domain/schema.js';
import type { LayoutRelationshipGraph } from '../../src/domain/relationships.js';

function baseRelationshipGraph(overrides: Partial<LayoutRelationshipGraph> = {}): LayoutRelationshipGraph {
  return {
    observationId: 'obs-1',
    requestId: 'req-1',
    geometryTolerancePx: 0.5,
    targets: [],
    unresolvedTargets: [],
    pairwiseRelationships: [],
    pageRelationships: [],
    ...overrides,
  };
}

function baseSourceReference(observationId: string) {
  return {
    observationId,
    requestId: `req-${observationId}`,
    producer: { name: PRODUCER_NAME, version: '0.3.0' },
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    screenshot: { path: 'screenshot.png' },
  };
}

function minimalValidComparisonArtifact(overrides: Partial<ComparisonArtifact> = {}): ComparisonArtifact {
  return {
    artifactKind: COMPARISON_ARTIFACT_KIND,
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    comparisonId: 'cmp-1',
    comparisonRequestId: 'cmp-req-1',
    producer: { name: PRODUCER_NAME, version: '0.3.0' },
    provenance: { comparedAt: new Date(0).toISOString() },
    before: baseSourceReference('obs-before'),
    after: baseSourceReference('obs-after'),
    config: { geometryTolerancePx: 0.5 },
    comparability: { state: 'comparable', reasons: [] },
    configurationChanges: [],
    relationshipsBefore: baseRelationshipGraph({ observationId: 'obs-before' }),
    relationshipsAfter: baseRelationshipGraph({ observationId: 'obs-after' }),
    differences: [],
    relationshipChanges: [],
    expectedDependencyEvidence: [],
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargetPairs: [] },
    ...overrides,
  };
}

describe('comparison artifact constants', () => {
  it('freezes the comparison artifact kind and schema version', () => {
    expect(COMPARISON_ARTIFACT_KIND).toBe('my-frontend-observer/comparison');
    expect(COMPARISON_SCHEMA_VERSION).toBe('1.0.0');
  });

  it('does not change the observation schema version', () => {
    expect(OBSERVATION_SCHEMA_VERSION).toBe('1.2.0');
  });
});

describe('geometry tolerance', () => {
  it('freezes the default at 0.5', () => {
    expect(GEOMETRY_TOLERANCE_DEFAULT_PX).toBe(0.5);
  });

  it('accepts the boundary values 0 and 10', () => {
    expect(isValidGeometryTolerancePx(GEOMETRY_TOLERANCE_MIN_PX)).toBe(true);
    expect(isValidGeometryTolerancePx(GEOMETRY_TOLERANCE_MAX_PX)).toBe(true);
  });

  it('rejects negative values, values above 10, NaN, and Infinity', () => {
    expect(isValidGeometryTolerancePx(-0.1)).toBe(false);
    expect(isValidGeometryTolerancePx(10.1)).toBe(false);
    expect(isValidGeometryTolerancePx(Number.NaN)).toBe(false);
    expect(isValidGeometryTolerancePx(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidGeometryTolerancePx(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe('isValidComparisonConfig', () => {
  it('accepts a config with only the tolerance', () => {
    expect(isValidComparisonConfig({ geometryTolerancePx: 0.5 })).toBe(true);
  });

  it('rejects a forbidden v0.5-scope field', () => {
    expect(isValidComparisonConfig({ geometryTolerancePx: 0.5, requestedChanges: [] })).toBe(false);
    expect(isValidComparisonConfig({ geometryTolerancePx: 0.5, protected: [] })).toBe(false);
    expect(isValidComparisonConfig({ geometryTolerancePx: 0.5, baseline: 'x' })).toBe(false);
  });

  it('rejects an out-of-range tolerance', () => {
    expect(isValidComparisonConfig({ geometryTolerancePx: 11 })).toBe(false);
  });
});

describe('expected dependency declarations', () => {
  function declaration(overrides: Partial<ExpectedDependencyDeclaration> = {}): ExpectedDependencyDeclaration {
    return {
      cause: { target: 'navigation', property: 'width', direction: 'decrease' },
      effect: { target: 'workspace', property: 'width', direction: 'increase' },
      source: 'explicit-config',
      ...overrides,
    };
  }

  it('validates the full property and direction vocabulary', () => {
    for (const property of DEPENDENCY_PROPERTIES) {
      expect(isValidExpectedDependencyDeclaration(declaration({ cause: { target: 'navigation', property, direction: 'change' } }))).toBe(true);
    }
    for (const direction of DEPENDENCY_DIRECTIONS) {
      expect(isValidExpectedDependencyDeclaration(declaration({ effect: { target: 'workspace', property: 'width', direction } }))).toBe(true);
    }
  });

  it('requires an explicit source marker', () => {
    expect(isValidExpectedDependencyDeclaration({ ...declaration(), source: undefined })).toBe(false);
    expect(isValidExpectedDependencyDeclaration({ ...declaration(), source: 'co-change-inference' })).toBe(false);
  });

  it('validates target references syntactically without requiring the target to exist', () => {
    expect(isValidExpectedDependencyDeclaration(declaration({ cause: { target: 'some-not-yet-configured-target', property: 'x', direction: 'change' } }))).toBe(
      true,
    );
  });

  it('rejects a malformed target name', () => {
    expect(isValidExpectedDependencyDeclaration(declaration({ cause: { target: 'bad name!', property: 'x', direction: 'change' } }))).toBe(false);
  });

  it('rejects an unsupported property or direction', () => {
    expect(isValidExpectedDependencyDeclaration(declaration({ cause: { target: 'navigation', property: 'color' as never, direction: 'change' } }))).toBe(false);
    expect(isValidExpectedDependencyDeclaration(declaration({ effect: { target: 'workspace', property: 'width', direction: 'flip' as never } }))).toBe(false);
  });
});

describe('dependency evidence outcomes', () => {
  const declaration: ExpectedDependencyDeclaration = {
    cause: { target: 'navigation', property: 'width', direction: 'decrease' },
    effect: { target: 'workspace', property: 'width', direction: 'increase' },
    source: 'explicit-config',
  };

  it('validates every frozen outcome', () => {
    for (const outcome of DEPENDENCY_EVIDENCE_OUTCOMES) {
      expect(isValidExpectedDependencyEvidence({ declaration, outcome, supportingEvidence: [] })).toBe(true);
    }
  });

  it('rejects a causal-verdict vocabulary substitute', () => {
    for (const forbidden of ['PASS', 'FAIL', 'approved', 'regression', 'allowed', 'protected']) {
      expect(isValidExpectedDependencyEvidence({ declaration, outcome: forbidden, supportingEvidence: [] })).toBe(false);
    }
  });
});

describe('comparability', () => {
  it('validates the three frozen states with consistent blocking-reason invariants', () => {
    expect(isValidComparabilityResult({ state: 'comparable', reasons: [] })).toBe(true);
    expect(
      isValidComparabilityResult({
        state: 'comparable-with-warnings',
        reasons: [{ code: 'producer-version-mismatch', severity: 'warning', message: 'producer version differs' }],
      }),
    ).toBe(true);
    expect(
      isValidComparabilityResult({
        state: 'incomparable',
        reasons: [{ code: 'viewport-mismatch', severity: 'blocking', message: 'viewport differs' }],
      }),
    ).toBe(true);
  });

  it('rejects "incomparable" without a blocking reason', () => {
    expect(isValidComparabilityResult({ state: 'incomparable', reasons: [] })).toBe(false);
  });

  it('rejects a blocking reason paired with a non-incomparable state', () => {
    expect(
      isValidComparabilityResult({
        state: 'comparable',
        reasons: [{ code: 'viewport-mismatch', severity: 'blocking', message: 'viewport differs' }],
      }),
    ).toBe(false);
  });

  it('rejects a reason whose severity does not match its frozen code mapping', () => {
    expect(
      isValidComparabilityResult({
        state: 'incomparable',
        reasons: [{ code: 'viewport-mismatch', severity: 'warning', message: 'x' }],
      }),
    ).toBe(false);
  });

  it('accepts an unassessed-dimension reason without forcing incomparability', () => {
    expect(
      isValidComparabilityResult({
        state: 'comparable-with-warnings',
        reasons: [{ code: 'theme-unassessed', severity: 'unassessed', message: 'theme identity is not modeled' }],
      }),
    ).toBe(true);
  });
});

describe('difference vocabulary', () => {
  function baseDifference(kind: (typeof DIFFERENCE_KINDS)[number]) {
    return {
      kind,
      subject: { type: 'target' as const, target: 'workspace' },
      before: 1,
      after: 2,
      classification: 'changed',
      beforeObservationId: 'obs-before',
      afterObservationId: 'obs-after',
      evidence: [],
    };
  }

  it('validates every frozen difference kind', () => {
    for (const kind of DIFFERENCE_KINDS) {
      expect(isValidComparisonDifference(baseDifference(kind))).toBe(true);
    }
  });

  it('rejects an unsupported difference category', () => {
    expect(isValidComparisonDifference({ ...baseDifference('moved'), kind: 'looks-worse' })).toBe(false);
  });

  it('rejects a difference missing observation identity or classification', () => {
    expect(isValidComparisonDifference({ ...baseDifference('moved'), beforeObservationId: '' })).toBe(false);
    expect(isValidComparisonDifference({ ...baseDifference('moved'), classification: '' })).toBe(false);
  });

  it('accepts a relationship-subject difference', () => {
    expect(
      isValidComparisonDifference({
        ...baseDifference('relationship-changed'),
        subject: { type: 'relationship', kind: 'left-of', subjectTarget: 'navigation', relatedTarget: 'workspace' },
      }),
    ).toBe(true);
  });

  it('accepts a page-subject difference', () => {
    expect(isValidComparisonDifference({ ...baseDifference('page-size-changed'), subject: { type: 'page' } })).toBe(true);
  });
});

describe('isValidComparisonArtifact', () => {
  it('accepts a minimal valid artifact', () => {
    expect(isValidComparisonArtifact(minimalValidComparisonArtifact())).toEqual({ valid: true });
  });

  it('rejects a mismatched artifact kind or schema version', () => {
    expect(isValidComparisonArtifact({ ...minimalValidComparisonArtifact(), artifactKind: 'my-frontend-observer/observation' }).valid).toBe(false);
    expect(isValidComparisonArtifact({ ...minimalValidComparisonArtifact(), schemaVersion: '2.0.0' }).valid).toBe(false);
  });

  it('never accepts an ObservationArtifact-shaped value', () => {
    const observationShaped = {
      artifactKind: 'my-frontend-observer/observation',
      schemaVersion: '1.2.0',
      observationId: 'obs-1',
      requestId: 'req-1',
    };
    expect(isValidComparisonArtifact(observationShaped).valid).toBe(false);
  });

  it('rejects a malformed source observation reference', () => {
    expect(isValidComparisonArtifact({ ...minimalValidComparisonArtifact(), before: { observationId: 'x' } }).valid).toBe(false);
  });

  it('rejects a malformed config', () => {
    expect(isValidComparisonArtifact({ ...minimalValidComparisonArtifact(), config: { geometryTolerancePx: 99 } }).valid).toBe(false);
  });

  it('rejects malformed relationship graphs', () => {
    expect(
      isValidComparisonArtifact({
        ...minimalValidComparisonArtifact(),
        relationshipsBefore: { ...baseRelationshipGraph(), targets: ['a', 'a'] },
      }).valid,
    ).toBe(false);
  });

  it('rejects a malformed difference entry', () => {
    expect(
      isValidComparisonArtifact({
        ...minimalValidComparisonArtifact(),
        differences: [{ kind: 'not-a-real-kind' }],
      }).valid,
    ).toBe(false);
  });

  it('rejects malformed limits', () => {
    expect(
      isValidComparisonArtifact({
        ...minimalValidComparisonArtifact(),
        limits: { truncated: false, omittedFields: [], omittedTargetPairs: [1] },
      }).valid,
    ).toBe(false);
  });

  it('accepts a fully populated artifact with configuration changes, relationship changes, and dependency evidence', () => {
    const artifact = minimalValidComparisonArtifact({
      configurationChanges: [{ kind: 'removed', target: 'sidebar' }],
      relationshipChanges: [
        {
          scope: 'pairwise',
          kind: 'left-of',
          subjectTarget: 'navigation',
          relatedTarget: 'workspace',
          before: 'left-of',
          after: 'horizontally-overlapping',
          beforeObservationId: 'obs-before',
          afterObservationId: 'obs-after',
        },
      ],
      expectedDependencyEvidence: [
        {
          declaration: {
            cause: { target: 'navigation', property: 'width', direction: 'decrease' },
            effect: { target: 'workspace', property: 'width', direction: 'increase' },
            source: 'explicit-config',
          },
          outcome: 'consistent',
          supportingEvidence: [{ path: 'differences.0' }],
        },
      ],
    });
    expect(isValidComparisonArtifact(artifact)).toEqual({ valid: true });
  });
});
