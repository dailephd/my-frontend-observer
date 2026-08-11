import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITY, orderDiagnostics } from '../../src/domain/diagnostics.js';
import type { Diagnostic } from '../../src/domain/diagnostics.js';

describe('orderDiagnostics', () => {
  it('TST-028: orders by severity then code then targetName, deterministically', () => {
    const input: Diagnostic[] = [
      { code: 'target-missing', severity: 'warning', message: 'x', targetName: 'z' },
      { code: 'unsafe-url', severity: 'error', message: 'x' },
      { code: 'target-missing', severity: 'warning', message: 'x', targetName: 'a' },
      { code: 'invalid-request', severity: 'error', message: 'x' },
    ];
    const first = orderDiagnostics(input);
    const second = orderDiagnostics([...input].reverse());
    expect(first).toEqual(second);
    expect(first.map((d) => d.severity)).toEqual(['error', 'error', 'warning', 'warning']);
    expect(first[0]?.code).toBe('invalid-request');
    expect(first[2]?.targetName).toBe('a');
  });

  it('TST-029: does not mutate its input and returns a new array', () => {
    const input: Diagnostic[] = [
      { code: 'unsafe-url', severity: 'error', message: 'x' },
      { code: 'invalid-request', severity: 'error', message: 'x' },
    ];
    const snapshot = [...input];
    const result = orderDiagnostics(input);
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });

  it('TST-040: DIAGNOSTIC_CODES and DIAGNOSTIC_SEVERITY are exactly consistent', () => {
    for (const code of DIAGNOSTIC_CODES) {
      expect(DIAGNOSTIC_SEVERITY[code]).toBeDefined();
    }
    expect(Object.keys(DIAGNOSTIC_SEVERITY).sort()).toEqual([...DIAGNOSTIC_CODES].sort());
  });

  it('v0.2: target-hidden is a warning-severity code and participates in the existing deterministic ordering', () => {
    expect(DIAGNOSTIC_SEVERITY['target-hidden']).toBe('warning');
    const input: Diagnostic[] = [
      { code: 'unsafe-url', severity: 'error', message: 'x' },
      { code: 'target-hidden', severity: 'warning', message: 'x', targetName: 'header' },
      { code: 'target-missing', severity: 'warning', message: 'x', targetName: 'other' },
    ];
    const ordered = orderDiagnostics(input);
    expect(ordered[0]?.code).toBe('unsafe-url');
    expect(ordered.map((d) => d.code)).toEqual(['unsafe-url', 'target-hidden', 'target-missing']);
  });
});
