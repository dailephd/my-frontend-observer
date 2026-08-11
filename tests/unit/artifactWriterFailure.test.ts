import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import type { BrowserCaptureResult } from '../../src/browser/types.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(async (filePath: unknown, ...rest: unknown[]) => {
      if (String(filePath).endsWith('manifest.json')) {
        throw new Error('simulated disk failure writing manifest.json');
      }
      return (actual.writeFile as (...args: unknown[]) => Promise<void>)(filePath, ...rest);
    }),
  };
});

const { writeObservationArtifact, MANIFEST_FILENAME, SCREENSHOT_FILENAME } = await import('../../src/artifacts/artifactWriter.js');
const { buildObservationArtifact } = await import('../../src/application/observationPersistence.js');

function baseRequest(): NormalizedObservationRequest {
  return {
    targetUrl: 'http://127.0.0.1/observation',
    viewport: { width: 800, height: 600 },
    targets: [],
    outputLocation: '.',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
  };
}

function successfulCapture(): Extract<BrowserCaptureResult, { ok: true }> {
  return {
    ok: true,
    provenance: { engine: 'chromium', version: '999.0.0.0' },
    screenshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    pageEvidence: {},
    targetEvidence: {},
    diagnostics: [],
  };
}

describe('artifactWriter (simulated mid-write filesystem failure)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // B4-TST-013,014,015: manifest-last discipline, mid-write failure, artifact-write-failure diagnostic.
  it('B4-TST-013,014,015: a manifest write failure leaves no completed artifact and reports artifact-write-failure', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-artifact-fail-'));
    tempDirs.push(dir);

    const capture = successfulCapture();
    const request = baseRequest();
    const artifact = buildObservationArtifact(capture, request);

    const result = await writeObservationArtifact(artifact, capture.screenshot, { cwd: dir });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the write to fail');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('artifact-write-failure');
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.diagnostics[0]?.message).toContain('simulated disk failure');

    // No completed artifact under its real name...
    const finalRoot = path.join(dir, artifact.observationId);
    await expect(access(finalRoot)).rejects.toBeDefined();
    await expect(access(path.join(finalRoot, MANIFEST_FILENAME))).rejects.toBeDefined();

    // ...and the temporary working directory was cleaned up, not left masquerading as anything.
    const tempRoot = path.join(dir, `.tmp-${artifact.observationId}`);
    await expect(access(tempRoot)).rejects.toBeDefined();
    await expect(access(path.join(tempRoot, SCREENSHOT_FILENAME))).rejects.toBeDefined();
  });
});
