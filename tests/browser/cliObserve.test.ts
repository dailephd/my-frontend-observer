import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { rm, readFile, access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCli } from '../../src/cli.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import { isValidObservationArtifact } from '../../src/domain/schema.js';
import {
  startFixtureServer,
  type FixtureServer,
  OBSERVATION_FIXTURE_SELECTORS,
  OBSERVATION_FIXTURE_BUTTON_GEOMETRY,
  OBSERVATION_FIXTURE_CONTAINMENT,
  OBSERVATION_FIXTURE_ROLE,
  OBSERVATION_FIXTURE_IDS,
} from '../fixtures/server.js';

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
    expect(manifest.schemaVersion).toBe('1.1.0');
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

describe('runCli observe --targets-file - real Chromium end-to-end (v0.2 Batch 4)', () => {
  let fixtures: FixtureServer;
  const outputLocations: string[] = [];
  const tempDirs: string[] = [];

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  afterAll(async () => {
    await fixtures.close();
  });

  afterEach(async () => {
    await Promise.all(outputLocations.splice(0).map((loc) => rm(path.resolve(process.cwd(), loc), { recursive: true, force: true })));
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function freshOutputLocation(): string {
    const loc = `observations/mfo-cli-targets-file-test-${randomUUID()}`;
    outputLocations.push(loc);
    return loc;
  }

  async function writeTargetsFile(content: unknown): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-cli-targets-file-e2e-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'targets.json');
    await writeFile(filePath, JSON.stringify(content), 'utf8');
    return filePath;
  }

  // v0.2 Batch 4: one real-Chromium observation exercising all six locator kinds, ordered
  // fallback, semantic state/landmark/containment persistence, missing/ambiguous/hidden
  // partial behavior, manifest structural validation, path privacy, and target immutability -
  // deliberately one browser launch rather than many redundant ones.
  it('a multi-target semantic --targets-file observation persists a valid, complete manifest', async () => {
    const outputLocation = freshOutputLocation();
    const targetUrl = `${fixtures.baseUrl}/observation`;
    const beforeHtml = await fetch(targetUrl).then((r) => r.text());

    const targetsFilePath = await writeTargetsFile({
      targets: [
        { name: 'appShell', locators: [{ kind: 'id', value: OBSERVATION_FIXTURE_CONTAINMENT.appShell }] },
        {
          name: 'primaryNavigation',
          locators: [
            { kind: 'role', role: OBSERVATION_FIXTURE_ROLE.navRole, name: 'Does Not Exist' },
            { kind: 'id', value: OBSERVATION_FIXTURE_CONTAINMENT.primaryNavigation },
          ],
        },
        { name: 'mainContent', locators: [{ kind: 'id', value: OBSERVATION_FIXTURE_CONTAINMENT.mainContent }] },
        { name: 'toolWorkspace', locators: [{ kind: 'id', value: OBSERVATION_FIXTURE_CONTAINMENT.toolWorkspace }] },
        { name: 'button', locators: [{ kind: 'text', text: OBSERVATION_FIXTURE_ROLE.buttonName }] },
        { name: 'footer', locators: [{ kind: 'semantic-element', tag: OBSERVATION_FIXTURE_CONTAINMENT.footer }] },
        { name: 'dataRegion', locators: [{ kind: 'data-attribute', attribute: 'data-region', value: 'workspace' }] },
        { name: 'hidden', locators: [{ kind: 'id', value: OBSERVATION_FIXTURE_IDS.hidden }] },
        { name: 'ghost', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.missing }] },
        { name: 'dup', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.duplicate }] },
      ],
    });

    const out = capture();
    const code = await runCli(
      ['observe', '--url', targetUrl, '--viewport', '800x600', '--targets-file', targetsFilePath, '--output', outputLocation],
      out.io,
    );

    // CLI result behavior: same concise format, partial because of the intentional
    // missing/ambiguous/hidden targets, still exit 0.
    expect(code).toBe(0);
    expect(out.stdout()).toMatch(/^Observation: .+\n/);
    expect(out.stdout()).toContain('State: partial');
    expect(out.stdout()).toContain('Targets: 10');
    expect(out.stdout()).toContain('Diagnostics: 3\n'); // target-missing(ghost) + target-ambiguous(dup) + target-hidden(hidden)
    expect(out.stdout()).not.toMatch(/TargetFile:|LocatorMode:|SemanticTargets:/);

    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const artifactRoot = artifactLine!.slice('Artifact: '.length);
    const manifestPath = path.join(artifactRoot, 'manifest.json');
    const screenshotPath = path.join(artifactRoot, 'screenshot.png');

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ObservationArtifact;
    expect(manifest.artifactKind).toBe('my-frontend-observer/observation');
    expect(manifest.schemaVersion).toBe('1.1.0');
    expect(isValidObservationArtifact(manifest)).toEqual({ valid: true });

    // Target/locator order preserved through JSON parse -> RawObservationRequest -> normalizeRequest -> requestConfig.
    expect(manifest.requestConfig.targets.map((t) => t.name)).toEqual([
      'appShell',
      'primaryNavigation',
      'mainContent',
      'toolWorkspace',
      'button',
      'footer',
      'dataRegion',
      'hidden',
      'ghost',
      'dup',
    ]);
    expect(manifest.requestConfig.targets.find((t) => t.name === 'primaryNavigation')?.locators).toEqual([
      { kind: 'role', role: OBSERVATION_FIXTURE_ROLE.navRole, name: 'Does Not Exist' },
      { kind: 'id', value: OBSERVATION_FIXTURE_CONTAINMENT.primaryNavigation },
    ]);
    expect(Object.keys(manifest.targetEvidence).sort()).toEqual(
      ['appShell', 'button', 'dataRegion', 'dup', 'footer', 'ghost', 'hidden', 'mainContent', 'primaryNavigation', 'toolWorkspace'].sort(),
    );

    // Fallback evidence survives CLI -> artifact.
    const navResolution = manifest.targetEvidence.primaryNavigation!.resolution;
    expect(navResolution.state === 'available' && navResolution.value).toMatchObject({
      selectionStatus: 'matched',
      selectedLocatorKind: 'id',
      selectedLocatorIndex: 1,
      usedFallback: true,
    });
    expect(navResolution.state === 'available' && navResolution.value.attempts.map((a) => a.status)).toEqual(['not-found', 'matched']);

    // Landmark evidence survives CLI -> artifact.
    const navLandmark = manifest.targetEvidence.primaryNavigation!.landmark;
    expect(navLandmark).toMatchObject({ state: 'available', source: 'derived', value: 'navigation' });
    const footerLandmark = manifest.targetEvidence.footer!.landmark;
    expect(footerLandmark).toMatchObject({ state: 'available', value: 'contentinfo' });

    // Containment evidence survives CLI -> artifact (nested + simple + partial, since ghost/dup never resolved).
    const workspaceContainment = manifest.targetEvidence.toolWorkspace!.containment;
    expect(workspaceContainment.state).toBe('partial');
    const workspaceValue = (workspaceContainment as { value: { containedByTargetIds: string[]; unresolvedTargetIds: string[] } }).value;
    expect(workspaceValue.containedByTargetIds).toEqual(['appShell', 'mainContent']);
    expect(workspaceValue.unresolvedTargetIds).toEqual(expect.arrayContaining(['ghost', 'dup']));

    // Missing target: honest partial evidence.
    expect(manifest.targetEvidence.ghost!.resolution).toMatchObject({ value: { selectionStatus: 'not-found' } });
    expect(manifest.diagnostics.some((d) => d.code === 'target-missing' && d.targetName === 'ghost')).toBe(true);

    // Ambiguous target: honest partial evidence.
    expect(manifest.targetEvidence.dup!.resolution).toMatchObject({ value: { selectionStatus: 'ambiguous' } });
    expect(manifest.diagnostics.some((d) => d.code === 'target-ambiguous' && d.targetName === 'dup')).toBe(true);

    // Hidden target: matched, visible=false, target-hidden warning - not treated as missing.
    expect(manifest.targetEvidence.hidden!.resolution).toMatchObject({ value: { selectionStatus: 'matched' } });
    const hiddenVisibility = manifest.targetEvidence.hidden!.visibility;
    expect(hiddenVisibility.state === 'available' && hiddenVisibility.value.visible).toBe(false);
    expect(manifest.diagnostics.some((d) => d.code === 'target-hidden' && d.targetName === 'hidden')).toBe(true);

    // Semantic state persisted where applicable (button has no supported state -> not-applicable, honestly).
    expect(manifest.targetEvidence.button!.semanticState.state).toBe('not-applicable');

    // Screenshot: relative reference, real non-empty PNG.
    const screenshotRef = manifest.artifactReferences.find((r) => r.kind === 'screenshot');
    expect(screenshotRef && path.isAbsolute(screenshotRef.path)).toBe(false);
    const screenshotBytes = await readFile(screenshotPath);
    expect(screenshotBytes.length).toBeGreaterThan(0);
    expect(new Uint8Array(screenshotBytes).slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // Target-file path privacy: never persisted anywhere in the manifest.
    const serializedManifest = JSON.stringify(manifest);
    expect(serializedManifest).not.toContain(targetsFilePath);
    expect(serializedManifest).not.toContain('targets.json');

    // Target application immutability: the observed fixture is untouched.
    const afterHtml = await fetch(targetUrl).then((r) => r.text());
    expect(afterHtml).toBe(beforeHtml);
  });

  it('existing legacy CSS shorthand continues to work unchanged alongside --targets-file support', async () => {
    const outputLocation = freshOutputLocation();
    const targetUrl = `${fixtures.baseUrl}/observation`;
    const out = capture();

    const code = await runCli(
      ['observe', '--url', targetUrl, '--target', `header=${OBSERVATION_FIXTURE_SELECTORS.header}`, '--output', outputLocation],
      out.io,
    );

    expect(code).toBe(0);
    const artifactLine = out.stdout().split('\n').find((line) => line.startsWith('Artifact: '));
    const manifest = JSON.parse(await readFile(path.join(artifactLine!.slice('Artifact: '.length), 'manifest.json'), 'utf8')) as ObservationArtifact;
    expect(manifest.requestConfig.targets).toEqual([{ name: 'header', locators: [{ kind: 'css', selector: OBSERVATION_FIXTURE_SELECTORS.header }] }]);
  });
});
