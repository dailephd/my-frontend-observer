import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ApplicationObservationResult } from '../../src/application/observationPersistence.js';
import type { NormalizedObservationRequest } from '../../src/request/request.js';

const observeMock = vi.fn<(request: NormalizedObservationRequest) => Promise<ApplicationObservationResult>>();

vi.mock('../../src/application/observationPersistence.js', () => ({
  observe: (request: NormalizedObservationRequest) => observeMock(request),
}));

const { runCli } = await import('../../src/cli.js');

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

function okResult(overrides: Partial<Extract<ApplicationObservationResult, { ok: true }>> = {}): Extract<ApplicationObservationResult, { ok: true }> {
  return {
    ok: true,
    observationId: 'req-abc-nonce',
    requestId: 'req-abc',
    completion: { state: 'complete' },
    artifactRoot: 'Z:\\out\\req-abc-nonce',
    manifestPath: 'Z:\\out\\req-abc-nonce\\manifest.json',
    screenshotPath: 'Z:\\out\\req-abc-nonce\\screenshot.png',
    targetCount: 2,
    diagnostics: [],
    ...overrides,
  };
}

describe('runCli observe - application orchestration (mocked application service)', () => {
  beforeEach(() => {
    observeMock.mockReset();
  });

  // B5-TST-004,005: repeated --target preserves order and a selector containing "=" survives intact.
  it('B5-TST-004,005: preserves target order and passes a selector containing "=" through unmodified', async () => {
    observeMock.mockResolvedValue(okResult());
    const out = capture();

    await runCli(
      [
        'observe',
        '--url',
        'http://127.0.0.1/observation',
        '--target',
        'first=#first',
        '--target',
        'action=button[data-state="active"]',
        '--target',
        'last=.last',
      ],
      out.io,
    );

    expect(observeMock).toHaveBeenCalledTimes(1);
    const request = observeMock.mock.calls[0]?.[0];
    expect(request?.targets).toEqual([
      { name: 'first', locators: [{ kind: 'css', selector: '#first' }] },
      { name: 'action', locators: [{ kind: 'css', selector: 'button[data-state="active"]' }] },
      { name: 'last', locators: [{ kind: 'css', selector: '.last' }] },
    ]);
  });

  // B5-TST-007: a valid normalized request invokes the application service exactly once.
  it('B5-TST-007: invokes the application observation service exactly once for one CLI invocation', async () => {
    observeMock.mockResolvedValue(okResult());
    const out = capture();

    await runCli(['observe', '--url', 'http://127.0.0.1/observation', '--viewport', '1024x768'], out.io);

    expect(observeMock).toHaveBeenCalledTimes(1);
    const request = observeMock.mock.calls[0]?.[0];
    expect(request?.viewport).toEqual({ width: 1024, height: 768 });
  });

  // B5-TST-010,011: success output/exit code.
  it('B5-TST-010,011: a successful persisted observation prints only the approved fields and exits 0', async () => {
    observeMock.mockResolvedValue(
      okResult({ observationId: 'obs-1', artifactRoot: 'Z:\\out\\obs-1', targetCount: 3, diagnostics: [] }),
    );
    const out = capture();

    const code = await runCli(['observe', '--url', 'http://127.0.0.1/observation'], out.io);

    expect(code).toBe(0);
    expect(out.stdout()).toBe('Observation: obs-1\nState: complete\nArtifact: Z:\\out\\obs-1\nTargets: 3\nDiagnostics: 0\n');
    expect(out.stdout()).not.toMatch(/pageEvidence|targetEvidence|screenshot.*base64/i);
  });

  // B5-TST-013: a failed browser capture (no persistable artifact) exits nonzero.
  it('B5-TST-013: a failed browser capture exits nonzero and creates no artifact reference in output', async () => {
    observeMock.mockResolvedValue({
      ok: false,
      diagnostics: [{ code: 'navigation-failure', severity: 'error', message: 'navigation failed: boom' }],
    });
    const out = capture();

    const code = await runCli(['observe', '--url', 'http://127.0.0.1/observation'], out.io);

    expect(code).toBe(1);
    expect(out.stderr()).toContain('[navigation-failure]');
    expect(out.stdout()).toBe('');
  });

  // B5-TST-014: artifact-write failure exits nonzero and emits the existing artifact-write diagnostic.
  it('B5-TST-014: an artifact-write failure exits nonzero with the existing artifact-write-failure diagnostic', async () => {
    observeMock.mockResolvedValue({
      ok: false,
      diagnostics: [{ code: 'artifact-write-failure', severity: 'error', message: 'failed to persist observation artifact: disk full' }],
    });
    const out = capture();

    const code = await runCli(['observe', '--url', 'http://127.0.0.1/observation'], out.io);

    expect(code).toBe(1);
    expect(out.stderr()).toContain('[artifact-write-failure]');
  });

  // B5-TST-015: partial/warning semantics are preserved honestly (exit 0, state truthfully reported).
  it('B5-TST-015: a persisted "partial" observation is reported honestly and still exits 0', async () => {
    observeMock.mockResolvedValue(
      okResult({
        completion: { state: 'partial', diagnostics: [{ code: 'target-missing', severity: 'warning', message: 'no match', targetName: 'ghost' }] },
        diagnostics: [{ code: 'target-missing', severity: 'warning', message: 'no match', targetName: 'ghost' }],
      }),
    );
    const out = capture();

    const code = await runCli(['observe', '--url', 'http://127.0.0.1/observation'], out.io);

    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: partial');
    expect(out.stdout()).not.toContain('State: complete');
  });

  // Defensive: a persisted-but-"fatal" completion state must not be reported as success.
  it('a persisted "fatal" completion state exits nonzero even though an artifact path exists', async () => {
    observeMock.mockResolvedValue(
      okResult({ completion: { state: 'fatal', diagnostics: [{ code: 'browser-runtime-failure', severity: 'error', message: 'x' }] } }),
    );
    const out = capture();

    const code = await runCli(['observe', '--url', 'http://127.0.0.1/observation'], out.io);

    expect(code).toBe(1);
    expect(out.stdout()).toContain('State: fatal');
  });
});
