import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { rm, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCli } from '../../src/cli.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import { isValidObservationArtifact } from '../../src/domain/schema.js';
import { startFixtureServer, type FixtureServer, OBSERVATION_FIXTURE_SELECTORS, OBSERVATION_FIXTURE_BUTTON_GEOMETRY } from '../fixtures/server.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

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

describe('runCli observe - real Chromium end-to-end (Batch 5)', () => {
  let fixtures: FixtureServer;
  // Relative to the repository root (process.cwd() under vitest) and under the already-gitignored
  // observations/ convention, so the CLI's own portable-relative --output contract is exercised
  // for real rather than worked around.
  const outputLocations: string[] = [];

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  afterEach(async () => {
    await Promise.all(outputLocations.splice(0).map((loc) => rm(path.resolve(process.cwd(), loc), { recursive: true, force: true })));
  });

  function freshOutputLocation(): string {
    const loc = `observations/mfo-cli-test-${randomUUID()}`;
    outputLocations.push(loc);
    return loc;
  }

  // B5-TST-016..023: the real CLI, against the real deterministic fixture, produces one valid,
  // consistent, portable artifact - the key Batch 5 integration proof.
  it('B5-TST-016..023: observe creates a valid real artifact with page/target evidence, honest missing/ambiguous semantics, and clean cleanup', async () => {
    const outputLocation = freshOutputLocation();
    const targetUrl = `${fixtures.baseUrl}/observation`;
    const beforeHtml = await fetch(targetUrl).then((r) => r.text());

    const out = capture();
    const code = await runCli(
      [
        'observe',
        '--url',
        targetUrl,
        '--viewport',
        '800x600',
        '--target',
        `button=${OBSERVATION_FIXTURE_SELECTORS.button}`,
        '--target',
        `ghost=${OBSERVATION_FIXTURE_SELECTORS.missing}`,
        '--target',
        `dup=${OBSERVATION_FIXTURE_SELECTORS.duplicate}`,
        '--output',
        outputLocation,
      ],
      out.io,
    );

    // B5-TST-011/017 (exit + output).
    expect(code).toBe(0);
    expect(out.stdout()).toMatch(/^Observation: .+\n/);
    expect(out.stdout()).toContain('State: partial'); // missing+ambiguous targets are warning-severity diagnostics.
    expect(out.stdout()).toContain('Targets: 3');
    expect(out.stdout()).toContain('Diagnostics: 2\n'); // exactly target-missing + target-ambiguous; the valid button target adds none.

    // B5-TST-021: observation ID / artifact path reported correspond to the real persisted artifact.
    const observationIdLine = out.stdout().split('\n').find((line) => line.startsWith('Observation: '));
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    expect(observationIdLine).toBeDefined();
    expect(artifactLine).toBeDefined();
    const observationId = observationIdLine!.slice('Observation: '.length);
    const artifactRoot = artifactLine!.slice('Artifact: '.length);
    expect(path.basename(artifactRoot)).toBe(observationId);

    // B5-TST-016,017: real artifact with the current (not stale) file contract.
    const manifestPath = path.join(artifactRoot, 'manifest.json');
    const screenshotPath = path.join(artifactRoot, 'screenshot.png');
    await expect(access(manifestPath)).resolves.toBeUndefined();
    await expect(access(screenshotPath)).resolves.toBeUndefined();
    await expect(access(path.join(artifactRoot, 'evidence.json'))).rejects.toBeDefined();

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ObservationArtifact;
    expect(isValidObservationArtifact(manifest)).toEqual({ valid: true });
    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(manifest.observationId).toBe(observationId);

    // B5-TST-018: real, non-empty viewport PNG.
    const screenshotBytes = await readFile(screenshotPath);
    expect(screenshotBytes.length).toBeGreaterThan(0);
    expect(isPngSignature(new Uint8Array(screenshotBytes))).toBe(true);

    // B5-TST-019: page evidence present.
    expect(manifest.pageEvidence.finalUrl).toMatchObject({ state: 'available', value: targetUrl });
    expect(manifest.pageEvidence.viewportWidth).toMatchObject({ value: 800 });
    expect(manifest.pageEvidence.viewportHeight).toMatchObject({ value: 600 });

    // B5-TST-020: target evidence present, including preserved missing/ambiguous semantics.
    expect(Object.keys(manifest.targetEvidence).sort()).toEqual(['button', 'dup', 'ghost']);
    expect(manifest.targetEvidence.button?.geometry).toMatchObject({ state: 'available', value: OBSERVATION_FIXTURE_BUTTON_GEOMETRY });
    expect(manifest.targetEvidence.ghost?.resolution).toMatchObject({ value: { selectionStatus: 'not-found' } });
    expect(manifest.targetEvidence.ghost?.geometry.state).toBe('unavailable');
    expect(manifest.targetEvidence.dup?.resolution).toMatchObject({ value: { selectionStatus: 'ambiguous' } });
    expect(manifest.diagnostics.some((d) => d.code === 'target-missing' && d.targetName === 'ghost')).toBe(true);
    expect(manifest.diagnostics.some((d) => d.code === 'target-ambiguous' && d.targetName === 'dup')).toBe(true);

    // B5-TST-022: the observed fixture/target source is untouched by the CLI workflow.
    const afterHtml = await fetch(targetUrl).then((r) => r.text());
    expect(afterHtml).toBe(beforeHtml);
  });

  // B5-TST-012: invalid request never creates an artifact.
  it('B5-TST-012: an unsafe URL is rejected before browser launch and creates no artifact', async () => {
    const outputLocation = freshOutputLocation();
    const out = capture();

    const code = await runCli(['observe', '--url', 'http://example.com/', '--output', outputLocation], out.io);

    expect(code).toBe(1);
    expect(out.stderr()).toContain('[unsafe-url]');
    await expect(access(path.resolve(process.cwd(), outputLocation))).rejects.toBeDefined();
  });
});
