import { describe, expect, it } from 'vitest';
import { buildComparisonIdentity, buildComparisonRequestIdentity } from '../../src/domain/comparisonIdentity.js';
import type { ComparisonConfig } from '../../src/domain/comparison.js';

function baseConfig(overrides: Partial<ComparisonConfig> = {}): ComparisonConfig {
  return { geometryTolerancePx: 0.5, ...overrides };
}

describe('buildComparisonRequestIdentity', () => {
  it('is deterministic for the same before/after observation and config', () => {
    const a = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig());
    const b = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig());
    expect(a).toBe(b);
  });

  it('changes when the before observation changes', () => {
    const a = buildComparisonRequestIdentity('obs-before-1', 'obs-after', baseConfig());
    const b = buildComparisonRequestIdentity('obs-before-2', 'obs-after', baseConfig());
    expect(a).not.toBe(b);
  });

  it('changes when the after observation changes', () => {
    const a = buildComparisonRequestIdentity('obs-before', 'obs-after-1', baseConfig());
    const b = buildComparisonRequestIdentity('obs-before', 'obs-after-2', baseConfig());
    expect(a).not.toBe(b);
  });

  it('is direction-sensitive: swapping before/after changes the identity', () => {
    const forward = buildComparisonRequestIdentity('obs-a', 'obs-b', baseConfig());
    const reversed = buildComparisonRequestIdentity('obs-b', 'obs-a', baseConfig());
    expect(forward).not.toBe(reversed);
  });

  it('changes when the geometry tolerance changes', () => {
    const a = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig({ geometryTolerancePx: 0.5 }));
    const b = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig({ geometryTolerancePx: 1 }));
    expect(a).not.toBe(b);
  });

  it('changes when expected dependency declarations change', () => {
    const withoutDeps = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig());
    const withDeps = buildComparisonRequestIdentity(
      'obs-before',
      'obs-after',
      baseConfig({
        expectedDependencies: [
          {
            cause: { target: 'navigation', property: 'width', direction: 'decrease' },
            effect: { target: 'workspace', property: 'width', direction: 'increase' },
            source: 'explicit-config',
          },
        ],
      }),
    );
    expect(withoutDeps).not.toBe(withDeps);
  });

  it('is not affected by operational filesystem-path-like values passed elsewhere (no path field exists to include)', () => {
    // The function signature has no path/outputLocation parameter at all - this
    // test documents that guarantee rather than exercising a code branch.
    const a = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig());
    const b = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig());
    expect(a).toBe(b);
  });

  it('produces canonical object-key-ordering-independent output', () => {
    const config1 = { geometryTolerancePx: 0.5, expectedDependencies: undefined } as ComparisonConfig;
    const config2 = { expectedDependencies: undefined, geometryTolerancePx: 0.5 } as ComparisonConfig;
    expect(buildComparisonRequestIdentity('obs-before', 'obs-after', config1)).toBe(buildComparisonRequestIdentity('obs-before', 'obs-after', config2));
  });
});

describe('buildComparisonIdentity', () => {
  it('is fresh and never timestamp-shaped, across 1000 calls', () => {
    const requestIdentity = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig());
    const isoTimestampRe = /^\d{4}-\d{2}-\d{2}T/;
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = buildComparisonIdentity(requestIdentity);
      expect(isoTimestampRe.test(id)).toBe(false);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });

  it('does not collide across two calls within the same millisecond and both incorporate the request identity', () => {
    const requestIdentity = buildComparisonRequestIdentity('obs-before', 'obs-after', baseConfig());
    const first = buildComparisonIdentity(requestIdentity);
    const second = buildComparisonIdentity(requestIdentity);
    expect(first.startsWith(requestIdentity)).toBe(true);
    expect(second.startsWith(requestIdentity)).toBe(true);
    expect(first).not.toBe(second);
  });
});
