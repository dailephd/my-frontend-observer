import { describe, expect, it } from 'vitest';
import { normalizeRequest } from '../../src/request/request.js';

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
});
