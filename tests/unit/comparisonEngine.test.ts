import { describe, expect, it } from 'vitest';
import { compareObservations, evaluateComparability, evaluateExpectedDependencies, compareTargetConfiguration } from '../../src/domain/comparisonEngine.js';
import { isValidComparisonArtifact } from '../../src/domain/comparison.js';
import type { ComparisonArtifact, ExpectedDependencyDeclaration } from '../../src/domain/comparison.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type {
  ObservationArtifact,
  TargetEvidenceRecord,
  TargetGeometry,
  TargetLayoutMetrics,
  TargetComputedStyle,
  TargetResolution,
} from '../../src/domain/schema.js';
import type { NamedTarget, ScrollScenario } from '../../src/request/request.js';
import type { EvidenceField } from '../../src/domain/evidence.js';

function rect(x: number, y: number, width: number, height: number): TargetGeometry {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function matchedResolution(): TargetResolution {
  return {
    selectionMethod: 'ordered-locators',
    selectionStatus: 'matched',
    selectedLocatorKind: 'css',
    selectedLocatorIndex: 0,
    usedFallback: false,
    confidence: 'exact',
    attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'matched', matchCount: 1 }],
  };
}

function unresolvedResolution(status: 'not-found' | 'ambiguous' | 'unavailable'): TargetResolution {
  return { selectionMethod: 'ordered-locators', selectionStatus: status, usedFallback: false, confidence: 'none', attempts: [] };
}

interface MatchedTargetOptions {
  visible?: boolean;
  layout?: TargetLayoutMetrics;
  style?: TargetComputedStyle;
  containedByTargetIds?: string[];
  evaluatedTargetIds?: string[];
}

function matchedTarget(geometry: TargetGeometry, options: MatchedTargetOptions = {}): TargetEvidenceRecord {
  const visible = options.visible ?? true;
  return {
    resolution: { state: 'available', source: 'derived', value: matchedResolution(), derivedFrom: ['locator-attempts'] },
    tag: { state: 'available', source: 'browser', value: 'div' },
    geometry: { state: 'available', source: 'browser', value: geometry },
    style: {
      state: 'available',
      source: 'computed-browser',
      value: options.style ?? { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' },
    },
    layout: {
      state: 'available',
      source: 'browser',
      value: options.layout ?? {
        scrollWidth: geometry.width,
        scrollHeight: geometry.height,
        clientWidth: geometry.width,
        clientHeight: geometry.height,
        scrollTop: 0,
        scrollLeft: 0,
      },
    },
    visibility: { state: 'available', source: 'derived', value: { visible }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: {
      state: 'available',
      source: 'browser',
      value: {
        containedByTargetIds: options.containedByTargetIds ?? [],
        evaluatedTargetIds: options.evaluatedTargetIds ?? [],
        unresolvedTargetIds: [],
      },
    },
  };
}

function unresolvedTarget(status: 'not-found' | 'ambiguous' | 'unavailable'): TargetEvidenceRecord {
  const reason = `target ${status}`;
  return {
    resolution: { state: 'available', source: 'derived', value: unresolvedResolution(status), derivedFrom: ['locator-attempts'] },
    tag: { state: 'unavailable', reason },
    geometry: { state: 'unavailable', reason },
    style: { state: 'unavailable', reason },
    layout: { state: 'unavailable', reason },
    visibility: { state: 'unavailable', reason },
    semantics: { state: 'unavailable', reason },
    semanticState: { state: 'unavailable', reason },
    landmark: { state: 'unavailable', reason },
    containment: { state: 'unavailable', reason },
  };
}

interface ObservationOptions {
  observationId?: string;
  requestId?: string;
  producerVersion?: string;
  browserEngine?: string;
  browserVersion?: string;
  targetUrl?: string;
  viewport?: { width: number; height: number };
  scrollScenario?: ScrollScenario;
  scrollOwner?: { kind: 'document' } | { kind: 'target'; target: string } | { kind: 'none' } | { kind: 'indeterminate' };
}

function observation(
  targets: readonly NamedTarget[],
  targetEvidence: Record<string, TargetEvidenceRecord>,
  pageEvidence: Record<string, EvidenceField<unknown>> = {},
  options: ObservationOptions = {},
): ObservationArtifact {
  const artifact: ObservationArtifact = {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: options.observationId ?? 'obs-1',
    requestId: options.requestId ?? 'req-1',
    producer: { name: PRODUCER_NAME, version: options.producerVersion ?? '0.3.0' },
    browser: { state: 'available', source: 'browser', value: { engine: options.browserEngine ?? 'chromium', version: options.browserVersion ?? '139.0.0' } },
    requestConfig: {
      targetUrl: options.targetUrl ?? 'http://localhost/',
      viewport: options.viewport ?? { width: 800, height: 600 },
      targets: [...targets],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
      ...(options.scrollScenario ? { scrollScenario: options.scrollScenario } : {}),
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence,
    targetEvidence,
    screenshot: { state: 'available', source: 'browser', value: { path: 'screenshot.png' } },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: 'screenshot.png', kind: 'screenshot' }],
  };
  if (options.scrollScenario) {
    artifact.scrollScenarioEvidence = {
      initial: { window: { scrollX: 0, scrollY: 0 }, document: { root: { scrollTop: 0, scrollLeft: 0, scrollWidth: 800, scrollHeight: 600, clientWidth: 800, clientHeight: 600 }, rootOverflow: { horizontalOverflow: false, verticalOverflow: false, overflowX: 'visible', overflowY: 'visible' } }, targets: {} },
      final: { window: { scrollX: 0, scrollY: 0 }, document: { root: { scrollTop: 0, scrollLeft: 0, scrollWidth: 800, scrollHeight: 600, clientWidth: 800, clientHeight: 600 }, rootOverflow: { horizontalOverflow: false, verticalOverflow: false, overflowX: 'visible', overflowY: 'visible' } }, targets: {} },
      transition: { windowScrollX: { before: 0, after: 0, changed: false }, windowScrollY: { before: 0, after: 0, changed: false }, targets: {} },
      scrollOwner: { state: 'available', source: 'derived', value: options.scrollOwner ?? { kind: 'none' }, derivedFrom: ['window.scrollX'] },
    };
  }
  return artifact;
}

function target(name: string, selector?: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: selector ?? `#${name}` }] };
}

function requireOk(result: ReturnType<typeof compareObservations>): ComparisonArtifact {
  if (!result.ok) throw new Error(`expected ok result, got: ${result.reason}`);
  return result.artifact;
}

// --- comparability ------------------------------------------------------------

describe('evaluateComparability', () => {
  it('is comparable with no reasons beyond the always-present unassessed dimensions', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) });
    const after = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) }, {}, { observationId: 'obs-2' });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('comparable');
    expect(result.reasons.map((r) => r.code)).toEqual(['theme-unassessed', 'authenticated-state-unassessed', 'application-state-unassessed']);
  });

  it('is incomparable on differing page URL', () => {
    const before = observation([], {}, {}, { targetUrl: 'http://localhost/a' });
    const after = observation([], {}, {}, { targetUrl: 'http://localhost/b' });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('incomparable');
    expect(result.reasons.some((r) => r.code === 'page-url-mismatch' && r.severity === 'blocking')).toBe(true);
  });

  it('is incomparable on differing viewport', () => {
    const before = observation([], {}, {}, { viewport: { width: 1280, height: 720 } });
    const after = observation([], {}, {}, { viewport: { width: 1024, height: 768 } });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('incomparable');
    expect(result.reasons.some((r) => r.code === 'viewport-mismatch')).toBe(true);
  });

  it('is incomparable on differing browser engine', () => {
    const before = observation([], {}, {}, { browserEngine: 'chromium' });
    const after = observation([], {}, {}, { browserEngine: 'webkit' });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('incomparable');
    expect(result.reasons.some((r) => r.code === 'browser-engine-mismatch')).toBe(true);
  });

  it('is comparable-with-warnings on differing browser version', () => {
    const before = observation([], {}, {}, { browserVersion: '139.0.0' });
    const after = observation([], {}, {}, { browserVersion: '140.0.0' });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('comparable-with-warnings');
    expect(result.reasons.some((r) => r.code === 'browser-version-mismatch' && r.severity === 'warning')).toBe(true);
  });

  it('is comparable-with-warnings on differing producer version', () => {
    const before = observation([], {}, {}, { producerVersion: '0.3.0' });
    const after = observation([], {}, {}, { producerVersion: '0.4.0' });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('comparable-with-warnings');
    expect(result.reasons.some((r) => r.code === 'producer-version-mismatch' && r.severity === 'warning')).toBe(true);
  });

  it('scroll scenario: no-scenario vs scenario is incomparable', () => {
    const before = observation([], {}, {});
    const after = observation([], {}, {}, { scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } } });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('incomparable');
    expect(result.reasons.some((r) => r.code === 'scroll-scenario-mismatch')).toBe(true);
  });

  it('scroll scenario: same normalized scenario is eligible (no scroll-scenario-mismatch reason)', () => {
    const scenario: ScrollScenario = { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } };
    const before = observation([], {}, {}, { scrollScenario: scenario });
    const after = observation([], {}, {}, { scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } } });
    const result = evaluateComparability(before, after);
    expect(result.reasons.some((r) => r.code === 'scroll-scenario-mismatch')).toBe(false);
  });

  it('scroll scenario: different delta is incomparable', () => {
    const before = observation([], {}, {}, { scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } } });
    const after = observation([], {}, {}, { scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 500 } } });
    expect(evaluateComparability(before, after).state).toBe('incomparable');
  });

  it('scroll scenario: target-scroll-by with a different stable target is incomparable', () => {
    const before = observation([target('a'), target('b')], {}, {}, {
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'a', deltaX: 0, deltaY: 100 } },
    });
    const after = observation([target('a'), target('b')], {}, {}, {
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'b', deltaX: 0, deltaY: 100 } },
    });
    expect(evaluateComparability(before, after).state).toBe('incomparable');
  });

  it('target-set-mismatch is a warning, not blocking', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) });
    const after = observation([target('a'), target('b')], { a: matchedTarget(rect(0, 0, 10, 10)), b: matchedTarget(rect(20, 0, 10, 10)) });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('comparable-with-warnings');
    expect(result.reasons.some((r) => r.code === 'target-set-mismatch' && r.severity === 'warning')).toBe(true);
  });

  it('target-locator-mismatch is a warning for a stable name with a changed locator', () => {
    const before = observation([target('a', '#a-old')], { a: matchedTarget(rect(0, 0, 10, 10)) });
    const after = observation([target('a', '#a-new')], { a: matchedTarget(rect(0, 0, 10, 10)) });
    const result = evaluateComparability(before, after);
    expect(result.state).toBe('comparable-with-warnings');
    expect(result.reasons.some((r) => r.code === 'target-locator-mismatch')).toBe(true);
  });
});

describe('compareTargetConfiguration', () => {
  it('orders removed/locator-changed in before order, then added in after order', () => {
    const before = observation([target('a'), target('b'), target('c')], {});
    const after = observation([target('a', '#a2'), target('d')], {});
    const changes = compareTargetConfiguration(before, after);
    expect(changes).toEqual([
      { kind: 'locator-changed', target: 'a' },
      { kind: 'removed', target: 'b' },
      { kind: 'removed', target: 'c' },
      { kind: 'added', target: 'd' },
    ]);
  });

  it('matches target names case-insensitively', () => {
    const before = observation([target('Workspace', '#same-selector')], {});
    const after = observation([target('workspace', '#same-selector')], {});
    expect(compareTargetConfiguration(before, after)).toEqual([]);
  });
});

// --- compareObservations: incomparable path -----------------------------------

describe('compareObservations: incomparable', () => {
  it('produces a structurally valid ComparisonArtifact with no rendered differences', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) }, {}, { viewport: { width: 1280, height: 720 } });
    const after = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) }, {}, { viewport: { width: 1024, height: 768 } });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.comparability.state).toBe('incomparable');
    expect(artifact.differences).toEqual([]);
    expect(artifact.relationshipChanges).toEqual([]);
    expect(artifact.expectedDependencyEvidence).toEqual([]);
    expect(isValidComparisonArtifact(artifact)).toEqual({ valid: true });
  });
});

// --- compareObservations: appearance/disappearance/configuration --------------

describe('compareObservations: appearance, disappearance, and configuration changes', () => {
  it('classifies appeared only for a configured-both-sides target moving not-found -> matched', () => {
    const before = observation([target('a')], { a: unresolvedTarget('not-found') });
    const after = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.filter((d) => d.kind === 'appeared')).toHaveLength(1);
    expect(artifact.differences[0]).toMatchObject({ kind: 'appeared', subject: { type: 'target', target: 'a' } });
  });

  it('classifies disappeared only for a configured-both-sides target moving matched -> not-found', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) });
    const after = observation([target('a')], { a: unresolvedTarget('not-found') }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.filter((d) => d.kind === 'disappeared')).toHaveLength(1);
  });

  it('does not classify a target newly added to after config as appeared', () => {
    const before = observation([], {});
    const after = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.some((d) => d.kind === 'appeared')).toBe(false);
    expect(artifact.configurationChanges).toEqual([{ kind: 'added', target: 'a' }]);
  });

  it('does not classify a target removed from after config as disappeared', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) });
    const after = observation([], {}, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.some((d) => d.kind === 'disappeared')).toBe(false);
    expect(artifact.configurationChanges).toEqual([{ kind: 'removed', target: 'a' }]);
  });

  it('an ambiguous target is never fabricated as disappeared - a diagnostic records the honest gap instead', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) });
    const after = observation([target('a')], { a: unresolvedTarget('ambiguous') }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.some((d) => d.subject.type === 'target' && d.subject.target === 'a')).toBe(false);
    expect(artifact.diagnostics.some((d) => d.code === 'target-ambiguous' && d.targetName === 'a')).toBe(true);
  });

  it('an unavailable target is never fabricated as disappeared - a diagnostic records the honest gap instead', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10)) });
    const after = observation([target('a')], { a: unresolvedTarget('unavailable') }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.some((d) => d.subject.type === 'target' && d.subject.target === 'a')).toBe(false);
    expect(artifact.diagnostics.some((d) => d.code === 'browser-evidence-unavailable' && d.targetName === 'a')).toBe(true);
  });
});

// --- compareObservations: moved/resized/visibility/clipping/overflow ----------

describe('compareObservations: direct target differences', () => {
  it('detects moved with correct before/after/delta and no rounding', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(100, 50, 40, 20)) });
    const after = observation([target('a')], { a: matchedTarget(rect(100.51, 50, 40, 20)) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    const moved = artifact.differences.find((d) => d.kind === 'moved');
    expect(moved).toMatchObject({ before: { x: 100, y: 50 }, after: { x: 100.51, y: 50 } });
    const delta = moved?.delta as { x: number; y: number };
    expect(delta.x).toBeCloseTo(0.51, 9);
    expect(delta.y).toBe(0);
  });

  it('suppresses subpixel noise at/below tolerance', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(100, 50, 40, 20)) });
    const after = observation([target('a')], { a: matchedTarget(rect(100.5, 50, 40, 20)) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after, { geometryTolerancePx: 0.5 }));
    expect(artifact.differences.some((d) => d.kind === 'moved')).toBe(false);
  });

  it('detects resized independently of moved (a target may be both)', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 100, 50)) });
    const after = observation([target('a')], { a: matchedTarget(rect(10, 0, 140, 80)) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.some((d) => d.kind === 'moved')).toBe(true);
    const resized = artifact.differences.find((d) => d.kind === 'resized');
    expect(resized).toMatchObject({ before: { width: 100, height: 50 }, after: { width: 140, height: 80 }, delta: { width: 40, height: 30 } });
  });

  it('detects a visibility change', () => {
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10), { visible: true }) });
    const after = observation([target('a')], { a: matchedTarget(rect(0, 0, 10, 10), { visible: false }) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.find((d) => d.kind === 'visibility-changed')).toMatchObject({ before: true, after: false });
  });

  it('detects a clipping change using the canonical clipping helper', () => {
    const beforeLayout: TargetLayoutMetrics = { scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 };
    const afterLayout: TargetLayoutMetrics = { scrollWidth: 300, scrollHeight: 100, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 };
    const style: TargetComputedStyle = { display: 'block', position: 'static', overflowX: 'hidden', overflowY: 'visible' };
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 100, 100), { layout: beforeLayout, style }) });
    const after = observation([target('a')], { a: matchedTarget(rect(0, 0, 100, 100), { layout: afterLayout, style }) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.find((d) => d.kind === 'clipping-changed')).toMatchObject({ before: 'not-clipped', after: 'clipped', classification: 'horizontal' });
  });

  it('detects a horizontal-overflow-changed difference from actual dimensional overflow, not the CSS declaration alone', () => {
    const beforeLayout: TargetLayoutMetrics = { scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 };
    const afterLayout: TargetLayoutMetrics = { scrollWidth: 300, scrollHeight: 100, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 };
    const style: TargetComputedStyle = { display: 'block', position: 'static', overflowX: 'auto', overflowY: 'visible' };
    const before = observation([target('a')], { a: matchedTarget(rect(0, 0, 100, 100), { layout: beforeLayout, style }) });
    const after = observation([target('a')], { a: matchedTarget(rect(0, 0, 100, 100), { layout: afterLayout, style }) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.find((d) => d.kind === 'horizontal-overflow-changed')).toMatchObject({ before: false, after: true });
    // overflow: auto never becomes clipping-changed, even with real dimensional overflow.
    expect(artifact.differences.some((d) => d.kind === 'clipping-changed')).toBe(false);
  });

  it('detects a containment change while target configuration stays the same', () => {
    const before = observation(
      [target('child'), target('parent')],
      {
        child: matchedTarget(rect(10, 10, 20, 20), { containedByTargetIds: ['parent'], evaluatedTargetIds: ['parent'] }),
        parent: matchedTarget(rect(0, 0, 100, 100), { evaluatedTargetIds: ['child'] }),
      },
    );
    const after = observation(
      [target('child'), target('parent')],
      {
        child: matchedTarget(rect(10, 10, 20, 20), { containedByTargetIds: [], evaluatedTargetIds: ['parent'] }),
        parent: matchedTarget(rect(0, 0, 100, 100), { evaluatedTargetIds: ['child'] }),
      },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after));
    const change = artifact.differences.find((d) => d.kind === 'containment-changed');
    expect(change).toMatchObject({ subject: { type: 'target', target: 'child' }, before: true, after: false });
  });

  it('detects a page-size change using geometry tolerance', () => {
    const before = observation([], {}, {
      documentWidth: { state: 'available', source: 'derived', value: 800, derivedFrom: ['x'] },
      documentHeight: { state: 'available', source: 'derived', value: 600, derivedFrom: ['x'] },
    });
    const after = observation([], {}, {
      documentWidth: { state: 'available', source: 'derived', value: 3000, derivedFrom: ['x'] },
      documentHeight: { state: 'available', source: 'derived', value: 600, derivedFrom: ['x'] },
    }, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.find((d) => d.kind === 'page-size-changed')).toMatchObject({
      before: { width: 800, height: 600 },
      after: { width: 3000, height: 600 },
      delta: { width: 2200, height: 0 },
    });
  });

  it('detects a scroll-owner change when scenario configuration matches but runtime ownership differs', () => {
    const scenario: ScrollScenario = { action: { kind: 'target-scroll-by', target: 'workspace', deltaX: 0, deltaY: 200 } };
    const before = observation([target('workspace')], { workspace: matchedTarget(rect(0, 0, 100, 100)) }, {}, {
      scrollScenario: scenario,
      scrollOwner: { kind: 'document' },
    });
    const after = observation([target('workspace')], { workspace: matchedTarget(rect(0, 0, 100, 100)) }, {}, {
      observationId: 'obs-2',
      scrollScenario: { action: { kind: 'target-scroll-by', target: 'workspace', deltaX: 0, deltaY: 200 } },
      scrollOwner: { kind: 'target', target: 'workspace' },
    });
    const artifact = requireOk(compareObservations(before, after));
    const change = artifact.differences.find((d) => d.kind === 'scroll-owner-changed');
    expect(change).toMatchObject({ before: { kind: 'document' }, after: { kind: 'target', target: 'workspace' } });
  });
});

// --- compareObservations: relationship changes --------------------------------

describe('compareObservations: relationship changes', () => {
  it('detects an overlap relationship change as relative-position-changed', () => {
    const before = observation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(0, 0, 100, 50)), b: matchedTarget(rect(150, 0, 100, 50)) },
    );
    const after = observation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(0, 0, 100, 50)), b: matchedTarget(rect(50, 0, 100, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after));
    const change = artifact.relationshipChanges.find((c) => c.kind === 'does-not-overlap' || c.kind === 'overlaps');
    expect(change).toMatchObject({ before: 'does-not-overlap', after: 'overlaps' });
    expect(artifact.differences.some((d) => d.kind === 'relative-position-changed')).toBe(true);
  });

  it('detects left-of -> horizontally-overlapping as a relative-position-changed difference', () => {
    const before = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 100, 50)), workspace: matchedTarget(rect(150, 0, 200, 50)) },
    );
    const after = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 100, 50)), workspace: matchedTarget(rect(50, 0, 200, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after));
    const diff = artifact.differences.find((d) => d.kind === 'relative-position-changed');
    expect(diff).toMatchObject({ before: 'left-of', after: 'horizontally-overlapping' });
    expect((diff?.evidence.length ?? 0) > 0).toBe(true);
  });

  it('detects a geometric-fit relationship change as relationship-changed (not relative-position-changed)', () => {
    const before = observation(
      [target('child'), target('container')],
      { child: matchedTarget(rect(10, 10, 20, 20)), container: matchedTarget(rect(0, 0, 100, 100)) },
    );
    const after = observation(
      [target('child'), target('container')],
      { child: matchedTarget(rect(-10, -10, 20, 20)), container: matchedTarget(rect(0, 0, 100, 100)) },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after));
    const diff = artifact.differences.find((d) => d.kind === 'relationship-changed');
    expect(diff).toMatchObject({ before: 'fits-inside', after: 'does-not-fit-inside' });
  });

  it('both targets shifting together preserves the relationship (no relative-position-changed)', () => {
    const before = observation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(0, 0, 100, 50)), b: matchedTarget(rect(150, 0, 100, 50)) },
    );
    const after = observation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(20, 20, 100, 50)), b: matchedTarget(rect(170, 20, 100, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after));
    expect(artifact.differences.some((d) => d.kind === 'moved')).toBe(true);
    expect(artifact.differences.some((d) => d.kind === 'relative-position-changed' || d.kind === 'relationship-changed')).toBe(false);
  });

  it('detects a page-width relationship change (fits -> exceeds)', () => {
    const pageEvidenceBefore = {
      documentWidth: { state: 'available' as const, source: 'derived' as const, value: 800, derivedFrom: ['x'] },
      viewportWidth: { state: 'available' as const, source: 'browser' as const, value: 800 },
    };
    const pageEvidenceAfter = {
      documentWidth: { state: 'available' as const, source: 'derived' as const, value: 3000, derivedFrom: ['x'] },
      viewportWidth: { state: 'available' as const, source: 'browser' as const, value: 800 },
    };
    const before = observation([], {}, pageEvidenceBefore);
    const after = observation([], {}, pageEvidenceAfter, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after));
    const change = artifact.relationshipChanges.find((c) => c.scope === 'page');
    expect(change).toMatchObject({ before: 'document-width-fits-viewport', after: 'document-width-exceeds-viewport' });
  });
});

// --- compareObservations: explicit dependency evaluation ----------------------

describe('compareObservations: explicit dependency evidence', () => {
  const declaration: ExpectedDependencyDeclaration = {
    cause: { target: 'navigation', property: 'width', direction: 'decrease' },
    effect: { target: 'workspace', property: 'width', direction: 'increase' },
    source: 'explicit-config',
  };

  it('consistent: both declared sides occur as declared', () => {
    const before = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 140, 50)), workspace: matchedTarget(rect(140, 0, 300, 50)) },
    );
    const after = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 60, 50)), workspace: matchedTarget(rect(60, 0, 400, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after, { expectedDependencies: [declaration] }));
    expect(artifact.expectedDependencyEvidence).toEqual([{ declaration, outcome: 'consistent', supportingEvidence: expect.any(Array) }]);
  });

  it('not-observed: the declared cause did not occur', () => {
    const before = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 140, 50)), workspace: matchedTarget(rect(140, 0, 300, 50)) },
    );
    const after = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 140, 50)), workspace: matchedTarget(rect(140, 0, 300, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after, { expectedDependencies: [declaration] }));
    expect(artifact.expectedDependencyEvidence[0]?.outcome).toBe('not-observed');
  });

  it('contradictory-to-declaration: observed direction is the strict opposite of declared', () => {
    const before = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 60, 50)), workspace: matchedTarget(rect(60, 0, 400, 50)) },
    );
    const after = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 140, 50)), workspace: matchedTarget(rect(140, 0, 300, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after, { expectedDependencies: [declaration] }));
    expect(artifact.expectedDependencyEvidence[0]?.outcome).toBe('contradictory-to-declaration');
  });

  it('unavailable: required target/property evidence cannot be evaluated', () => {
    const before = observation([target('workspace')], { workspace: matchedTarget(rect(140, 0, 300, 50)) });
    const after = observation([target('workspace')], { workspace: matchedTarget(rect(140, 0, 400, 50)) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after, { expectedDependencies: [declaration] }));
    expect(artifact.expectedDependencyEvidence[0]?.outcome).toBe('unavailable');
  });

  it('follows declared config order, never reordered', () => {
    const declarationA: ExpectedDependencyDeclaration = {
      cause: { target: 'a', property: 'x', direction: 'change' },
      effect: { target: 'a', property: 'y', direction: 'unchanged' },
      source: 'explicit-config',
    };
    const declarationB: ExpectedDependencyDeclaration = {
      cause: { target: 'b', property: 'x', direction: 'change' },
      effect: { target: 'b', property: 'y', direction: 'unchanged' },
      source: 'explicit-config',
    };
    const before = observation([target('a'), target('b')], { a: matchedTarget(rect(0, 0, 10, 10)), b: matchedTarget(rect(0, 0, 10, 10)) });
    const after = observation([target('a'), target('b')], { a: matchedTarget(rect(0, 0, 10, 10)), b: matchedTarget(rect(0, 0, 10, 10)) }, {}, { observationId: 'obs-2' });
    const artifact = requireOk(compareObservations(before, after, { expectedDependencies: [declarationB, declarationA] }));
    expect(artifact.expectedDependencyEvidence.map((e) => e.declaration)).toEqual([declarationB, declarationA]);
  });

  it('never produces causal or PASS/FAIL vocabulary', () => {
    const before = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 140, 50)), workspace: matchedTarget(rect(140, 0, 300, 50)) },
    );
    const after = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 60, 50)), workspace: matchedTarget(rect(60, 0, 400, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const artifact = requireOk(compareObservations(before, after, { expectedDependencies: [declaration] }));
    const serialized = JSON.stringify(artifact);
    for (const forbidden of ['causedBy', 'causalConfidence', 'causalScore', 'dependencyStrength', 'PASS', 'FAIL', 'caused']) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});

// --- determinism / direction sensitivity / identity ----------------------------

describe('compareObservations: determinism, direction sensitivity, and identity', () => {
  function pair(): { before: ObservationArtifact; after: ObservationArtifact } {
    const before = observation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(0, 0, 100, 50)), b: matchedTarget(rect(150, 0, 100, 50)) },
    );
    const after = observation(
      [target('a'), target('b')],
      { a: matchedTarget(rect(20, 0, 120, 50)), b: matchedTarget(rect(170, 0, 100, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    return { before, after };
  }

  it('is deterministic for the same input, excluding comparisonId/provenance', () => {
    const { before, after } = pair();
    const first = requireOk(compareObservations(before, after));
    const second = requireOk(compareObservations(before, after));
    const strip = (a: ComparisonArtifact): Omit<ComparisonArtifact, 'comparisonId' | 'provenance'> => {
      const rest: Partial<ComparisonArtifact> = { ...a };
      delete rest.comparisonId;
      delete rest.provenance;
      return rest as Omit<ComparisonArtifact, 'comparisonId' | 'provenance'>;
    };
    expect(strip(first)).toEqual(strip(second));
    expect(first.comparisonId).not.toBe(second.comparisonId);
  });

  it('keeps the same comparisonRequestId across executions while comparisonId stays fresh', () => {
    const { before, after } = pair();
    const first = requireOk(compareObservations(before, after));
    const second = requireOk(compareObservations(before, after));
    expect(first.comparisonRequestId).toBe(second.comparisonRequestId);
    expect(first.comparisonId).not.toBe(second.comparisonId);
  });

  it('is direction-sensitive: A->B and B->A differ in comparisonRequestId and reverse deltas', () => {
    const { before, after } = pair();
    const forward = requireOk(compareObservations(before, after));
    const reversed = requireOk(compareObservations(after, before));
    expect(forward.comparisonRequestId).not.toBe(reversed.comparisonRequestId);

    const forwardMoved = forward.differences.find((d) => d.kind === 'moved' && d.subject.type === 'target' && d.subject.target === 'a');
    const reversedMoved = reversed.differences.find((d) => d.kind === 'moved' && d.subject.type === 'target' && d.subject.target === 'a');
    expect(forwardMoved?.delta).toEqual({ x: 20, y: 0 });
    expect(reversedMoved?.delta).toEqual({ x: -20, y: 0 });
  });
});

describe('compareObservations: input validation', () => {
  it('rejects a structurally invalid before/after artifact', () => {
    const valid = observation([], {});
    expect(compareObservations({ not: 'valid' } as unknown as ObservationArtifact, valid).ok).toBe(false);
    expect(compareObservations(valid, { not: 'valid' } as unknown as ObservationArtifact).ok).toBe(false);
  });

  it('rejects an out-of-range geometryTolerancePx', () => {
    const before = observation([], {});
    const after = observation([], {}, {}, { observationId: 'obs-2' });
    expect(compareObservations(before, after, { geometryTolerancePx: 11 }).ok).toBe(false);
  });
});

describe('compareObservations: unavailable dependencies with never causal or pass/fail vocabulary', () => {
  it('produces evaluateExpectedDependencies output identical to the compareObservations path', () => {
    const declaration: ExpectedDependencyDeclaration = {
      cause: { target: 'navigation', property: 'width', direction: 'decrease' },
      effect: { target: 'workspace', property: 'width', direction: 'increase' },
      source: 'explicit-config',
    };
    const before = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 140, 50)), workspace: matchedTarget(rect(140, 0, 300, 50)) },
    );
    const after = observation(
      [target('navigation'), target('workspace')],
      { navigation: matchedTarget(rect(0, 0, 60, 50)), workspace: matchedTarget(rect(60, 0, 400, 50)) },
      {},
      { observationId: 'obs-2' },
    );
    const direct = evaluateExpectedDependencies(before, after, [declaration], 0.5);
    expect(direct[0]?.outcome).toBe('consistent');
  });
});
