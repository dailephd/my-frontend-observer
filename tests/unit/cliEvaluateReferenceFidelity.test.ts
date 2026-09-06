import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../../src/cli.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import { EXTERNAL_REFERENCE_MANIFEST_FILENAME } from '../../src/artifacts/externalReferenceArtifactWriter.js';
import type { ImportedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import { buildMinimalPng } from './externalReferenceImageFixtures.js';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { io: { stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text) }, stdout: () => stdout.join(''), stderr: () => stderr.join('') };
}

async function runCliInDir(dir: string, args: readonly string[], io: ReturnType<typeof capture>['io']): Promise<number> {
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await runCli(args, io);
  } finally {
    process.chdir(originalCwd);
  }
}

const tempDirs: string[] = [];
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Writes a valid, already-constructed ObservationArtifact manifest directly to disk - no Chromium, no observe(), mirroring this repository's existing "write a real manifest.json for a CLI reader test" precedent. */
async function writeCandidateObservation(dir: string, targetName: string, geometry: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): Promise<string> {
  const artifact: ObservationArtifact = {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: 'obs-fixture-1',
    requestId: 'req-fixture-1',
    producer: { name: PRODUCER_NAME, version: '0.7.0' },
    browser: { state: 'not-applicable' },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport,
      targets: [{ name: targetName, locators: [{ kind: 'css', selector: `#${targetName}` }] }],
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence: {
      [targetName]: {
        resolution: {
          state: 'available',
          source: 'derived',
          value: {
            selectionMethod: 'ordered-locators',
            selectionStatus: 'matched',
            selectedLocatorKind: 'css',
            selectedLocatorIndex: 0,
            usedFallback: false,
            confidence: 'exact',
            attempts: [{ locatorIndex: 0, locatorKind: 'css', status: 'matched', matchCount: 1 }],
          },
          derivedFrom: ['locator-attempts'],
        },
        tag: { state: 'available', source: 'browser', value: 'div' },
        geometry: { state: 'available', source: 'browser', value: { ...geometry, right: geometry.x + geometry.width, bottom: geometry.y + geometry.height } },
        style: { state: 'available', source: 'computed-browser', value: { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
        layout: { state: 'available', source: 'browser', value: { scrollWidth: geometry.width, scrollHeight: geometry.height, clientWidth: geometry.width, clientHeight: geometry.height, scrollTop: 0, scrollLeft: 0 } },
        visibility: { state: 'available', source: 'derived', value: { visible: true }, derivedFrom: ['style.display'] },
        semantics: { state: 'not-applicable' },
        semanticState: { state: 'not-applicable' },
        landmark: { state: 'not-applicable' },
        containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
      },
    },
    screenshot: { state: 'not-applicable' },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [],
  };
  const root = path.join(dir, 'candidate');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(artifact), 'utf8');
  return root;
}

describe('cli evaluate-reference-fidelity', () => {
  it('prints help', async () => {
    const out = capture();
    expect(await runCli(['evaluate-reference-fidelity', '--help'], out.io)).toBe(0);
    expect(out.stdout()).toContain('evaluate-reference-fidelity');
    expect(out.stdout()).toContain('--bindings-file');
  });

  it('is documented in top-level help', async () => {
    const out = capture();
    expect(await runCli(['--help'], out.io)).toBe(0);
    expect(out.stdout()).toContain('evaluate-reference-fidelity');
  });

  it('requires --reference and --candidate', async () => {
    const out = capture();
    const code = await runCli(['evaluate-reference-fidelity'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--reference is required');
    expect(out.stderr()).toContain('--candidate is required');
  });

  it('reports a clear error for a missing --reference root', async () => {
    const out = capture();
    const code = await runCli(['evaluate-reference-fidelity', '--reference', '/does/not/exist-ref', '--candidate', '/does/not/exist-cand'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--reference external-reference artifact');
  });

  it('reports a clear error for a missing --candidate root', async () => {
    const dir = await makeTempDir('mfo-cli-fidelity-missing-candidate-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));
    const importOut = capture();
    await runCliInDir(dir, ['import-reference', imagePath, '--output', '.'], importOut.io);
    const referenceRoot = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '))!
      .slice('Artifact: '.length);

    const out = capture();
    const code = await runCliInDir(dir, ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', '/does/not/exist-cand'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--candidate observation artifact');
  });

  it('exits nonzero for a malformed --bindings-file (bad JSON, wrong root shape, unknown top-level field)', async () => {
    const dir = await makeTempDir('mfo-cli-fidelity-bad-bindings-file-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(100, 100));
    const importOut = capture();
    await runCliInDir(dir, ['import-reference', imagePath, '--output', '.'], importOut.io);
    const referenceRoot = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '))!
      .slice('Artifact: '.length);
    const candidateRoot = await writeCandidateObservation(dir, 't', { x: 0, y: 0, width: 10, height: 10 }, { width: 480, height: 620 });

    const badJsonPath = path.join(dir, 'bad.json');
    await writeFile(badJsonPath, '{ not valid json', 'utf8');
    const badJsonOut = capture();
    expect(
      await runCliInDir(dir, ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', candidateRoot, '--bindings-file', badJsonPath], badJsonOut.io),
    ).toBe(1);
    expect(badJsonOut.stderr()).toContain('not valid JSON');

    const arrayRootPath = path.join(dir, 'array-root.json');
    await writeFile(arrayRootPath, '[]', 'utf8');
    const arrayRootOut = capture();
    expect(
      await runCliInDir(dir, ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', candidateRoot, '--bindings-file', arrayRootPath], arrayRootOut.io),
    ).toBe(1);
    expect(arrayRootOut.stderr()).toContain('root must be a JSON object');

    const unknownFieldPath = path.join(dir, 'unknown-field.json');
    await writeFile(unknownFieldPath, JSON.stringify({ bindings: [], extra: true }), 'utf8');
    const unknownFieldOut = capture();
    expect(
      await runCliInDir(dir, ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', candidateRoot, '--bindings-file', unknownFieldPath], unknownFieldOut.io),
    ).toBe(1);
    expect(unknownFieldOut.stderr()).toContain('unsupported top-level field');
  });

  it('end-to-end: evaluates a passing candidate and exits 0, with and without --enforce', async () => {
    const dir = await makeTempDir('mfo-cli-fidelity-e2e-pass-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(960, 1240));
    const regionsPath = path.join(dir, 'regions.json');
    await writeFile(regionsPath, JSON.stringify({ regions: [{ id: 'card', rectangle: { x: 0, y: 0, width: 424, height: 100 } }] }), 'utf8');
    const requirementsPath = path.join(dir, 'requirements.json');
    await writeFile(
      requirementsPath,
      JSON.stringify({ requirements: [{ category: 'requested', subject: { kind: 'region-property', region: 'card', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } }] }),
      'utf8',
    );
    const applicabilityPath = path.join(dir, 'applicability.json');
    await writeFile(applicabilityPath, JSON.stringify({ viewport: { width: 480, height: 620 } }), 'utf8');

    const importOut = capture();
    const importCode = await runCliInDir(
      dir,
      ['import-reference', imagePath, '--output', '.', '--regions-file', regionsPath, '--requirements-file', requirementsPath, '--applicability-file', applicabilityPath],
      importOut.io,
    );
    expect(importCode).toBe(0);
    const referenceRoot = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '))!
      .slice('Artifact: '.length);
    const referenceManifest = JSON.parse(await readFile(path.join(referenceRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME), 'utf8')) as ImportedExternalReferenceArtifact;
    expect(referenceManifest.applicability).toEqual({ viewport: { width: 480, height: 620 } });

    // 214 CSS px * scaleX(2) = 428 reference px; delta from 424 = 4 <= tolerance 4 => pass.
    const candidateRoot = await writeCandidateObservation(dir, 'popup-current-page', { x: 0, y: 0, width: 214, height: 50 }, { width: 480, height: 620 });
    const bindingsPath = path.join(dir, 'bindings.json');
    await writeFile(bindingsPath, JSON.stringify({ bindings: [{ referenceRegion: 'card', runtimeTarget: 'popup-current-page' }] }), 'utf8');

    const out = capture();
    const code = await runCliInDir(dir, ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', candidateRoot, '--bindings-file', bindingsPath], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: pass');
    expect(out.stdout()).toContain('Requirements: 1 (pass: 1, fail: 0, unavailable: 0)');
    expect(out.stdout()).toContain('Enforced: no');

    const enforceOut = capture();
    const enforceCode = await runCliInDir(
      dir,
      ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', candidateRoot, '--bindings-file', bindingsPath, '--enforce'],
      enforceOut.io,
    );
    expect(enforceCode).toBe(0);
    expect(enforceOut.stdout()).toContain('Enforced: yes');
  });

  it('end-to-end: a failing candidate exits 0 by default and nonzero with --enforce', async () => {
    const dir = await makeTempDir('mfo-cli-fidelity-e2e-fail-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(960, 1240));
    const regionsPath = path.join(dir, 'regions.json');
    await writeFile(regionsPath, JSON.stringify({ regions: [{ id: 'card', rectangle: { x: 0, y: 0, width: 424, height: 100 } }] }), 'utf8');
    const requirementsPath = path.join(dir, 'requirements.json');
    await writeFile(
      requirementsPath,
      JSON.stringify({ requirements: [{ category: 'requested', subject: { kind: 'region-property', region: 'card', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } }] }),
      'utf8',
    );
    const applicabilityPath = path.join(dir, 'applicability.json');
    await writeFile(applicabilityPath, JSON.stringify({ viewport: { width: 480, height: 620 } }), 'utf8');

    const importOut = capture();
    await runCliInDir(
      dir,
      ['import-reference', imagePath, '--output', '.', '--regions-file', regionsPath, '--requirements-file', requirementsPath, '--applicability-file', applicabilityPath],
      importOut.io,
    );
    const referenceRoot = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '))!
      .slice('Artifact: '.length);

    // 223 CSS px * scaleX(2) = 446 reference px; delta from 424 = 22 > tolerance 4 => fail (the exact worked example).
    const candidateRoot = await writeCandidateObservation(dir, 'popup-current-page', { x: 0, y: 0, width: 223, height: 50 }, { width: 480, height: 620 });
    const bindingsPath = path.join(dir, 'bindings.json');
    await writeFile(bindingsPath, JSON.stringify({ bindings: [{ referenceRegion: 'card', runtimeTarget: 'popup-current-page' }] }), 'utf8');

    const out = capture();
    const code = await runCliInDir(dir, ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', candidateRoot, '--bindings-file', bindingsPath], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: fail');

    const enforceOut = capture();
    const enforceCode = await runCliInDir(
      dir,
      ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', candidateRoot, '--bindings-file', bindingsPath, '--enforce'],
      enforceOut.io,
    );
    expect(enforceCode).toBe(1);
    expect(enforceOut.stdout()).toContain('State: fail');
  });

  it('end-to-end: an incompatible candidate viewport produces a not-evaluated state and always exits 0', async () => {
    const dir = await makeTempDir('mfo-cli-fidelity-e2e-incompatible-');
    const imagePath = path.join(dir, 'design.png');
    await writeFile(imagePath, buildMinimalPng(960, 1240));
    const regionsPath = path.join(dir, 'regions.json');
    await writeFile(regionsPath, JSON.stringify({ regions: [{ id: 'card', rectangle: { x: 0, y: 0, width: 424, height: 100 } }] }), 'utf8');
    const requirementsPath = path.join(dir, 'requirements.json');
    await writeFile(
      requirementsPath,
      JSON.stringify({ requirements: [{ category: 'requested', subject: { kind: 'region-property', region: 'card', property: 'width' }, tolerance: { kind: 'absolute-reference-px', amount: 4 } }] }),
      'utf8',
    );
    const applicabilityPath = path.join(dir, 'applicability.json');
    await writeFile(applicabilityPath, JSON.stringify({ viewport: { width: 480, height: 620 } }), 'utf8');

    const importOut = capture();
    await runCliInDir(
      dir,
      ['import-reference', imagePath, '--output', '.', '--regions-file', regionsPath, '--requirements-file', requirementsPath, '--applicability-file', applicabilityPath],
      importOut.io,
    );
    const referenceRoot = importOut
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('Artifact: '))!
      .slice('Artifact: '.length);

    const candidateRoot = await writeCandidateObservation(dir, 'popup-current-page', { x: 0, y: 0, width: 214, height: 50 }, { width: 375, height: 812 });
    const bindingsPath = path.join(dir, 'bindings.json');
    await writeFile(bindingsPath, JSON.stringify({ bindings: [{ referenceRegion: 'card', runtimeTarget: 'popup-current-page' }] }), 'utf8');

    const out = capture();
    const code = await runCliInDir(
      dir,
      ['evaluate-reference-fidelity', '--reference', referenceRoot, '--candidate', candidateRoot, '--bindings-file', bindingsPath, '--enforce'],
      out.io,
    );
    expect(code).toBe(0);
    expect(out.stdout()).toContain('State: not-evaluated');
    expect(out.stdout()).toContain('Blocked by: incompatible');
  });
});
