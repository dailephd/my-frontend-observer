import { describe, expect, it } from 'vitest';
import { normalizeRequest, SCROLL_DELTA_MAX_ABS } from '../../src/request/request.js';

describe('normalizeRequest', () => {
  it('TST-001: applies documented defaults when only targetUrl is supplied', () => {
    const result = normalizeRequest({ targetUrl: 'http://localhost:3000/' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.request).toEqual({
      targetUrl: 'http://localhost:3000/',
      viewport: { width: 1280, height: 720 },
      targets: [],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    });
  });

  it('TST-002: rejects a non-loopback URL with unsafe-url', () => {
    const result = normalizeRequest({ targetUrl: 'https://example.com' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'unsafe-url', severity: 'error' });
  });

  it('TST-003: rejects a malformed URL with invalid-request', () => {
    const result = normalizeRequest({ targetUrl: 'not a url' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('invalid-request');
  });

  it('TST-004: enforces viewport boundaries [200,3840]', () => {
    const tooNarrow = normalizeRequest({ targetUrl: 'http://localhost/', viewport: { width: 199, height: 720 } });
    const tooWide = normalizeRequest({ targetUrl: 'http://localhost/', viewport: { width: 1280, height: 3841 } });
    const atBoundary = normalizeRequest({ targetUrl: 'http://localhost/', viewport: { width: 200, height: 3840 } });
    expect(tooNarrow.ok).toBe(false);
    expect(tooWide.ok).toBe(false);
    expect(atBoundary.ok).toBe(true);
  });

  it('TST-005: enforces target-count boundary [0,20]', () => {
    const makeTargets = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `t${i}`, selector: `.t${i}` }));
    const tooMany = normalizeRequest({ targetUrl: 'http://localhost/', targets: makeTargets(21) });
    const atLimit = normalizeRequest({ targetUrl: 'http://localhost/', targets: makeTargets(20) });
    expect(tooMany.ok).toBe(false);
    expect(atLimit.ok).toBe(true);
    if (!atLimit.ok) throw new Error('expected ok');
    expect(atLimit.request.targets).toHaveLength(20);
    expect(atLimit.request.targets.map((t) => t.name)).toEqual(makeTargets(20).map((t) => t.name));
  });

  it('TST-006: rejects case-insensitive duplicate target names without merging', () => {
    const result = normalizeRequest({
      targetUrl: 'http://localhost/',
      targets: [
        { name: 'Header', selector: '.header' },
        { name: 'header', selector: '.header2' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    const duplicate = result.diagnostics.find((d) => d.code === 'invalid-request' && d.targetName !== undefined);
    expect(duplicate).toBeDefined();
  });

  it('TST-007: enforces target selector length boundary [1,500]', () => {
    const empty = normalizeRequest({ targetUrl: 'http://localhost/', targets: [{ name: 'a', selector: '' }] });
    const tooLong = normalizeRequest({ targetUrl: 'http://localhost/', targets: [{ name: 'a', selector: 'x'.repeat(501) }] });
    expect(empty.ok).toBe(false);
    expect(tooLong.ok).toBe(false);
  });

  it('TST-008: enforces timeoutMs and readiness.timeoutMs boundaries', () => {
    const tooShort = normalizeRequest({ targetUrl: 'http://localhost/', timeoutMs: 999 });
    const tooLong = normalizeRequest({ targetUrl: 'http://localhost/', timeoutMs: 120001 });
    const readinessExceedsTimeout = normalizeRequest({
      targetUrl: 'http://localhost/',
      timeoutMs: 1000,
      readiness: { timeoutMs: 2000 },
    });
    expect(tooShort.ok).toBe(false);
    expect(tooLong.ok).toBe(false);
    expect(readinessExceedsTimeout.ok).toBe(false);
  });

  it('TST-009: rejects an unsupported readiness.condition', () => {
    const result = normalizeRequest({ targetUrl: 'http://localhost/', readiness: { condition: 'network-idle' } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.diagnostics[0]?.code).toBe('unsupported-configuration');
  });

  it('TST-010: collects all violations without short-circuiting, deterministically ordered', () => {
    const raw = {
      targetUrl: 'http://localhost/',
      viewport: { width: 1, height: 1 },
      timeoutMs: 1,
      targets: [
        { name: 'Dup', selector: '.a' },
        { name: 'dup', selector: '.b' },
      ],
    };
    const first = normalizeRequest(raw);
    const second = normalizeRequest(raw);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) throw new Error('expected failure');
    expect(first.diagnostics.length).toBeGreaterThanOrEqual(3);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });

  describe('v0.2 canonical target/locator contract', () => {
    it('normalizes legacy {name, selector} to a one-item css locator array', () => {
      const result = normalizeRequest({ targetUrl: 'http://localhost/', targets: [{ name: 'header', selector: 'header' }] });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.request.targets).toEqual([{ name: 'header', locators: [{ kind: 'css', selector: 'header' }] }]);
    });

    it('accepts a valid canonical target configuration', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [{ name: 'header', locators: [{ kind: 'role', role: 'banner' }, { kind: 'css', selector: 'header' }] }],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects a target specifying both selector and locators', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [{ name: 'header', selector: 'header', locators: [{ kind: 'css', selector: 'header' }] }],
      });
      expect(result.ok).toBe(false);
    });

    it('rejects an empty locators array', () => {
      const result = normalizeRequest({ targetUrl: 'http://localhost/', targets: [{ name: 'header', locators: [] }] });
      expect(result.ok).toBe(false);
    });

    it('rejects more than 5 locators and accepts exactly 5', () => {
      const cssLocator = (n: number) => ({ kind: 'css', selector: `.x${n}` });
      const tooMany = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [{ name: 'header', locators: [0, 1, 2, 3, 4, 5].map(cssLocator) }],
      });
      const atLimit = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [{ name: 'header', locators: [0, 1, 2, 3, 4].map(cssLocator) }],
      });
      expect(tooMany.ok).toBe(false);
      expect(atLimit.ok).toBe(true);
    });

    it('validates each frozen locator kind: required fields, empty values, over-limit values', () => {
      const cases: { locator: unknown; ok: boolean }[] = [
        { locator: { kind: 'role', role: 'button' }, ok: true },
        { locator: { kind: 'role', role: '' }, ok: false },
        { locator: { kind: 'role', role: 'x'.repeat(65) }, ok: false },
        { locator: { kind: 'role', role: 'button', name: 'x'.repeat(201) }, ok: false },
        { locator: { kind: 'id', value: 'main' }, ok: true },
        { locator: { kind: 'id', value: '' }, ok: false },
        { locator: { kind: 'id', value: 'x'.repeat(201) }, ok: false },
        { locator: { kind: 'data-attribute', attribute: 'data-testid', value: 'main' }, ok: true },
        { locator: { kind: 'data-attribute', attribute: 'not-data', value: 'main' }, ok: false },
        { locator: { kind: 'data-attribute', attribute: 'data-testid', value: '' }, ok: false },
        { locator: { kind: 'semantic-element', tag: 'nav' }, ok: true },
        { locator: { kind: 'semantic-element', tag: 'span' }, ok: false },
        { locator: { kind: 'css', selector: 'header' }, ok: true },
        { locator: { kind: 'css', selector: '' }, ok: false },
        { locator: { kind: 'css', selector: 'x'.repeat(501) }, ok: false },
        { locator: { kind: 'text', text: 'Submit' }, ok: true },
        { locator: { kind: 'text', text: '' }, ok: false },
        { locator: { kind: 'text', text: 'x'.repeat(201) }, ok: false },
        { locator: { kind: 'unsupported-kind', value: 'x' }, ok: false },
      ];
      for (const { locator, ok } of cases) {
        const result = normalizeRequest({ targetUrl: 'http://localhost/', targets: [{ name: 'header', locators: [locator] }] });
        expect(result.ok).toBe(ok);
      }
    });

    it('still enforces the existing 20-target maximum and case-insensitive dedup with canonical targets', () => {
      const makeCanonicalTargets = (count: number) =>
        Array.from({ length: count }, (_, i) => ({ name: `t${i}`, locators: [{ kind: 'css', selector: `.t${i}` }] }));
      const tooMany = normalizeRequest({ targetUrl: 'http://localhost/', targets: makeCanonicalTargets(21) });
      const atLimit = normalizeRequest({ targetUrl: 'http://localhost/', targets: makeCanonicalTargets(20) });
      expect(tooMany.ok).toBe(false);
      expect(atLimit.ok).toBe(true);

      const dup = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [
          { name: 'Header', locators: [{ kind: 'css', selector: '.a' }] },
          { name: 'header', locators: [{ kind: 'css', selector: '.b' }] },
        ],
      });
      expect(dup.ok).toBe(false);
    });
  });

  describe('v0.3 scrollScenario contract', () => {
    it('accepts a request with no scrollScenario, unchanged from v0.2', () => {
      const result = normalizeRequest({ targetUrl: 'http://localhost:3000/' });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect('scrollScenario' in result.request).toBe(false);
    });

    it('accepts a valid window-scroll-by scenario', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.request.scrollScenario).toEqual({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 400 } });
    });

    it('accepts a valid target-scroll-by scenario referencing a configured target', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [{ name: 'workspace', selector: '.workspace' }],
        scrollScenario: { action: { kind: 'target-scroll-by', target: 'workspace', deltaX: 0, deltaY: 200 } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.request.scrollScenario).toEqual({ action: { kind: 'target-scroll-by', target: 'workspace', deltaX: 0, deltaY: 200 } });
    });

    it('rejects an unsupported action kind', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'scroll-into-view', deltaX: 0, deltaY: 100 } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.diagnostics[0]?.code).toBe('invalid-request');
    });

    it('rejects a scenario missing deltaX', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaY: 100 } },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects a scenario missing deltaY', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 100 } },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects a fractional delta', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 100.5 } },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects non-number deltas (NaN, Infinity, string, null)', () => {
      const invalidDeltas: unknown[] = [NaN, Infinity, -Infinity, 'ten', null];
      for (const deltaY of invalidDeltas) {
        const result = normalizeRequest({
          targetUrl: 'http://localhost/',
          scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY } },
        });
        expect(result.ok).toBe(false);
      }
    });

    it('rejects both deltas zero', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 0 } },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects out-of-bound deltas and accepts the exact boundary', () => {
      const tooLarge = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: SCROLL_DELTA_MAX_ABS + 1 } },
      });
      const atLimit = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: SCROLL_DELTA_MAX_ABS } },
      });
      expect(tooLarge.ok).toBe(false);
      expect(atLimit.ok).toBe(true);
    });

    it('rejects target-scroll-by without a target', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [{ name: 'workspace', selector: '.workspace' }],
        scrollScenario: { action: { kind: 'target-scroll-by', deltaX: 0, deltaY: 100 } },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects target-scroll-by referencing an unknown configured target', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [{ name: 'workspace', selector: '.workspace' }],
        scrollScenario: { action: { kind: 'target-scroll-by', target: 'navigation', deltaX: 0, deltaY: 100 } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.diagnostics[0]?.code).toBe('invalid-request');
    });

    it('rejects unknown fields on the scenario or action object', () => {
      const extraScenarioField = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 100 }, waitMs: 500 },
      });
      const extraActionField = normalizeRequest({
        targetUrl: 'http://localhost/',
        scrollScenario: { action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 100, behavior: 'smooth' } },
      });
      expect(extraScenarioField.ok).toBe(false);
      expect(extraActionField.ok).toBe(false);
    });

    it('resolves a target-scroll-by target case-insensitively against the configured target name', () => {
      const result = normalizeRequest({
        targetUrl: 'http://localhost/',
        targets: [{ name: 'Workspace', selector: '.workspace' }],
        scrollScenario: { action: { kind: 'target-scroll-by', target: 'workspace', deltaX: 0, deltaY: 100 } },
      });
      expect(result.ok).toBe(true);
    });
  });
});
