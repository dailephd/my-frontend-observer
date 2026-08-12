import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ApplicationComparisonResult, CompareAndPersistOptions } from '../../src/application/comparisonService.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const compareMock = vi.fn<(beforeRoot: string, afterRoot: string, options?: CompareAndPersistOptions) => Promise<ApplicationComparisonResult>>();

vi.mock('../../src/application/comparisonService.js', () => ({
  compareAndPersistFromArtifactRoots: (beforeRoot: string, afterRoot: string, options?: CompareAndPersistOptions) =>
    compareMock(beforeRoot, afterRoot, options),
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

function okResult(overrides: Partial<Extract<ApplicationComparisonResult, { ok: true }>> = {}): Extract<ApplicationComparisonResult, { ok: true }> {
  return {
    ok: true,
    comparisonId: 'cmp-req-nonce',
    comparisonRequestId: 'cmp-req',
    comparability: 'comparable',
    artifactRoot: 'Z:\\out\\comparisons\\cmp-req-nonce',
    manifestPath: 'Z:\\out\\comparisons\\cmp-req-nonce\\manifest.json',
    differenceCount: 2,
    relationshipChangeCount: 1,
    diagnosticsCount: 0,
    ...overrides,
  };
}

describe('runCli compare - application orchestration (mocked application service)', () => {
  beforeEach(() => {
    compareMock.mockReset();
  });

  it('invokes compareAndPersistFromArtifactRoots exactly once with the parsed before/after/output', async () => {
    compareMock.mockResolvedValue(okResult());
    const out = capture();

    await runCli(['compare', '--before', '/tmp/before', '--after', '/tmp/after', '--output', 'comparisons'], out.io);

    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(compareMock.mock.calls[0]).toEqual(['/tmp/before', '/tmp/after', { outputLocation: 'comparisons' }]);
  });

  it('prints only the approved concise fields and exits 0 on success', async () => {
    compareMock.mockResolvedValue(
      okResult({
        comparisonId: 'cmp-1',
        comparability: 'comparable',
        artifactRoot: 'Z:\\out\\comparisons\\cmp-1',
        differenceCount: 3,
        relationshipChangeCount: 1,
        diagnosticsCount: 0,
      }),
    );
    const out = capture();

    const code = await runCli(['compare', '--before', 'b', '--after', 'a', '--output', 'comparisons'], out.io);

    expect(code).toBe(0);
    expect(out.stdout()).toBe('Comparison: cmp-1\nState: comparable\nArtifact: Z:\\out\\comparisons\\cmp-1\nDifferences: 3\nRelationship changes: 1\nDiagnostics: 0\n');
  });

  it('a comparable-with-warnings result exits 0', async () => {
    compareMock.mockResolvedValue(okResult({ comparability: 'comparable-with-warnings' }));
    const out = capture();
    const code = await runCli(['compare', '--before', 'b', '--after', 'a', '--output', 'comparisons'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: comparable-with-warnings');
  });

  it('an incomparable result still exits 0 (a successful comparison outcome, not a failure)', async () => {
    compareMock.mockResolvedValue(okResult({ comparability: 'incomparable', differenceCount: 0, relationshipChangeCount: 0 }));
    const out = capture();
    const code = await runCli(['compare', '--before', 'b', '--after', 'a', '--output', 'comparisons'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: incomparable');
  });

  it('a domain/application failure exits nonzero and prints structured diagnostics', async () => {
    compareMock.mockResolvedValue({
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: 'error', message: '--before observation artifact: failed to read' }],
    });
    const out = capture();

    const code = await runCli(['compare', '--before', 'b', '--after', 'a', '--output', 'comparisons'], out.io);

    expect(code).toBe(1);
    expect(out.stderr()).toContain('[invalid-request]');
    expect(out.stdout()).toBe('');
  });

  it('a persistence failure exits nonzero with the existing artifact-write-failure diagnostic', async () => {
    compareMock.mockResolvedValue({
      ok: false,
      diagnostics: [{ code: 'artifact-write-failure', severity: 'error', message: 'a comparison artifact already exists' }],
    });
    const out = capture();

    const code = await runCli(['compare', '--before', 'b', '--after', 'a', '--output', 'comparisons'], out.io);

    expect(code).toBe(1);
    expect(out.stderr()).toContain('[artifact-write-failure]');
  });
});

describe('runCli compare --config-file - canonical passthrough (mocked application service)', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    compareMock.mockReset();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeConfigFile(content: unknown): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-cli-compare-config-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'config.json');
    await writeFile(filePath, JSON.stringify(content), 'utf8');
    return filePath;
  }

  it('passes the parsed config content through to the application service, not the file path', async () => {
    compareMock.mockResolvedValue(okResult());
    const configContent = { geometryTolerancePx: 2 };
    const filePath = await writeConfigFile(configContent);
    const out = capture();

    await runCli(['compare', '--before', 'b', '--after', 'a', '--output', 'comparisons', '--config-file', filePath], out.io);

    expect(compareMock).toHaveBeenCalledTimes(1);
    const options = compareMock.mock.calls[0]?.[2];
    expect(options?.config).toEqual(configContent);
    expect(JSON.stringify(options)).not.toContain(filePath);
  });

  it('omits config entirely from options when --config-file is not supplied (canonical default applies downstream)', async () => {
    compareMock.mockResolvedValue(okResult());
    const out = capture();

    await runCli(['compare', '--before', 'b', '--after', 'a', '--output', 'comparisons'], out.io);

    const options = compareMock.mock.calls[0]?.[2];
    expect(options).toEqual({ outputLocation: 'comparisons' });
  });
});
