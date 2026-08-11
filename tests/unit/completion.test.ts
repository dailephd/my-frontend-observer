import { describe, expect, it } from 'vitest';
import { deriveCompletion } from '../../src/domain/completion.js';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITY } from '../../src/domain/diagnostics.js';
import type { Diagnostic } from '../../src/domain/diagnostics.js';

describe('deriveCompletion', () => {
  it('TST-030: pre-capture with diagnostics maps to invalid-request', () => {
    const diagnostics: Diagnostic[] = [{ code: 'invalid-request', severity: 'error', message: 'x' }];
    const result = deriveCompletion(diagnostics, 'pre-capture');
    expect(result.state).toBe('invalid-request');
  });

  it('TST-031: post-capture with an error diagnostic maps to fatal', () => {
    const diagnostics: Diagnostic[] = [{ code: 'prohibited-redirect', severity: 'error', message: 'x' }];
    const result = deriveCompletion(diagnostics, 'post-capture');
    expect(result.state).toBe('fatal');
  });

  it('TST-032: post-capture with only warning diagnostics maps to partial, never complete', () => {
    const diagnostics: Diagnostic[] = [{ code: 'target-missing', severity: 'warning', message: 'x' }];
    const result = deriveCompletion(diagnostics, 'post-capture');
    expect(result.state).toBe('partial');
  });

  it('TST-033: no diagnostics maps to complete in both phases', () => {
    expect(deriveCompletion([], 'pre-capture').state).toBe('complete');
    expect(deriveCompletion([], 'post-capture').state).toBe('complete');
  });

  it('TST-034: "warning" completion state has no producer in this batch', () => {
    for (const code of DIAGNOSTIC_CODES) {
      const diagnostics: Diagnostic[] = [{ code, severity: DIAGNOSTIC_SEVERITY[code], message: 'x' }];
      const preCapture = deriveCompletion(diagnostics, 'pre-capture').state;
      const postCapture = deriveCompletion(diagnostics, 'post-capture').state;
      expect(preCapture).not.toBe('warning');
      expect(postCapture).not.toBe('warning');
    }
  });
});
