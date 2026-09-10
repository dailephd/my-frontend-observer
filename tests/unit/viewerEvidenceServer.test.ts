import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewerServer/viewerService.js';
import {
  writeFullPipelineFixture,
  writeExternalReferencePairFixture,
  writeMalformedJsonManifest,
  writeUnsupportedVersionManifest,
  writeObservationWithMissingScreenshot,
  writeUnrelatedFile,
} from '../support/evidenceFixtures.js';

const cleanupDirs: string[] = [];
const cleanupClosers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanupClosers.splice(0).map((close) => close()));
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-viewer-evidence-'));
  cleanupDirs.push(dir);
  return dir;
}

/** Built-viewer-assets fixture identical in shape to what tests/unit/viewerServer.test.ts uses, so this file can exercise the real HTTP routing without depending on the compiled dist/viewer output. */
async function makeAssetsRoot(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-assets-'));
  cleanupDirs.push(parent);
  await writeFile(path.join(parent, 'index.html'), '<!doctype html><title>fixture shell</title>');
  return parent;
}

async function startFor(root: string): Promise<{ url: string }> {
  const assetsRoot = await makeAssetsRoot();
  const result = await startViewer({ root, port: 0, assetsRoot });
  if (!result.ok) throw new Error(`expected server to start: ${JSON.stringify(result.diagnostics)}`);
  cleanupClosers.push(result.close);
  return { url: result.url };
}

describe('root path normalization', () => {
  it('resolves handles correctly even when --root is supplied with forward slashes on a platform whose native separator differs (regression: root/candidate separator-style mismatch previously rejected every valid handle)', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const forwardSlashRoot = root.split(path.sep).join('/');
    const { url } = await startFor(forwardSlashRoot);

    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string; logicalId?: string }[] };
    const record = index.records.find((r) => r.family === 'observation' && r.logicalId === 'obs-before');
    expect(record).toBeDefined();

    const detailResponse = await fetch(`${url}/api/artifacts/${record!.handle}`);
    expect(detailResponse.status).toBe(200);
  });
});

describe('GET /api/index', () => {
  it('returns bounded metadata for real evidence, never full payloads, and rejects write methods', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);

    const response = await fetch(`${url}/api/index`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; records: { family: string; handle: string }[]; truncated: boolean };
    expect(body.ok).toBe(true);
    expect(body.truncated).toBe(false);
    expect(body.records.some((r) => r.family === 'observation')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('targetEvidence');

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const rejected = await fetch(`${url}/api/index`, { method });
      expect(rejected.status).toBe(405);
    }
  });

  it('excludes an unrelated file even when it sits beside real evidence', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    await writeUnrelatedFile(root, 'notes.txt');
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/index`);
    const body = (await response.json()) as { records: { relativeDir: string }[] };
    expect(body.records.every((r) => !r.relativeDir.includes('notes.txt'))).toBe(true);
  });
});

describe('GET /api/artifacts/:handle', () => {
  it('loads a selected supported observation on demand, distinct from the bounded index response', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const { url } = await startFor(root);

    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string; logicalId?: string }[] };
    const observationRecord = index.records.find((r) => r.family === 'observation' && r.logicalId === 'obs-before');
    expect(observationRecord).toBeDefined();

    const detailResponse = await fetch(`${url}/api/artifacts/${observationRecord!.handle}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as { ok: boolean; family: string; artifact: { observationId: string; targetEvidence: unknown } };
    expect(detail.family).toBe('observation');
    expect(detail.artifact.observationId).toBe('obs-before');
    expect(detail.artifact.targetEvidence).toBeDefined(); // full payload only here, not in /api/index
    void fixture;
  });

  it('rejects an unknown handle with 404, never fabricating an artifact', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/artifacts/observation:does-not-exist`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('never coerces an unsupported-version candidate into a domain object', async () => {
    const root = await makeRoot();
    await writeUnsupportedVersionManifest(root, 'future');
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; supportState: string }[] };
    const record = index.records.find((r) => r.supportState === 'unsupported-version');
    expect(record).toBeDefined();
    const detailResponse = await fetch(`${url}/api/artifacts/${record!.handle}`);
    expect(detailResponse.status).toBe(409);
    const body = (await detailResponse.json()) as { ok: boolean; metadata: { supportState: string } };
    expect(body.ok).toBe(false);
    expect(body.metadata.supportState).toBe('unsupported-version');
  });

  it('a malformed candidate remains an honest error state, never a fabricated success', async () => {
    const root = await makeRoot();
    const dir = await writeMalformedJsonManifest(root, 'broken');
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; supportState: string }[] };
    const record = index.records.find((r) => r.supportState === 'malformed-json');
    expect(record).toBeDefined();
    const detailResponse = await fetch(`${url}/api/artifacts/${record!.handle}`);
    expect(detailResponse.status).toBe(409);
    void dir;
  });

  it('rejects write methods', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string }[] };
    const handle = index.records[0]!.handle;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${url}/api/artifacts/${handle}`, { method });
      expect(response.status).toBe(405);
    }
  });
});

describe('GET /api/media/:handle/:role', () => {
  it('serves an observation screenshot through its known handle', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string; logicalId?: string }[] };
    const record = index.records.find((r) => r.family === 'observation' && r.logicalId === 'obs-before');
    const response = await fetch(`${url}/api/media/${record!.handle}/screenshot`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('serves an imported external-reference image through its known handle', async () => {
    const root = await makeRoot();
    const fixture = await writeExternalReferencePairFixture(root);
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string; logicalId?: string }[] };
    const record = index.records.find((r) => r.family === 'external-reference-imported' && r.logicalId === fixture.importedReferenceId);
    expect(record).toBeDefined();
    const response = await fetch(`${url}/api/media/${record!.handle}/image`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/');
  });

  it("resolves an approved reference's source-image through the owning imported artifact, never assuming co-location", async () => {
    const root = await makeRoot();
    const fixture = await writeExternalReferencePairFixture(root);
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string; logicalId?: string }[] };
    const record = index.records.find((r) => r.family === 'external-reference-approved' && r.logicalId === fixture.approvedReferenceId);
    expect(record).toBeDefined();
    const response = await fetch(`${url}/api/media/${record!.handle}/source-image`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/');
  });

  it('an approved reference whose owning imported artifact is absent from the root reports missing media honestly', async () => {
    const root = await makeRoot();
    const isolatedImportRoot = await makeRoot();
    const imported = await writeExternalReferencePairFixture(isolatedImportRoot);
    // Copy only the approved artifact's manifest into `root`, deliberately never bringing the imported artifact along.
    const approvedDirName = path.basename(imported.approvedRoot);
    const destDir = path.join(root, 'references', approvedDirName);
    await mkdir(destDir, { recursive: true });
    const manifestBytes = await import('node:fs/promises').then((fs) => fs.readFile(path.join(imported.approvedRoot, 'manifest.json')));
    await writeFile(path.join(destDir, 'manifest.json'), manifestBytes);

    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string }[] };
    const record = index.records.find((r) => r.family === 'external-reference-approved');
    expect(record).toBeDefined();
    const response = await fetch(`${url}/api/media/${record!.handle}/source-image`);
    expect(response.status).toBe(404);
  });

  it('reports a genuinely missing screenshot honestly rather than a fabricated image', async () => {
    const root = await makeRoot();
    await writeObservationWithMissingScreenshot(root, 'obsroot');
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string }[] };
    const record = index.records.find((r) => r.family === 'observation');
    const response = await fetch(`${url}/api/media/${record!.handle}/screenshot`);
    expect(response.status).toBe(404);
  });

  it('rejects a request for an unknown media handle', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/media/observation:does-not-exist/screenshot`);
    expect(response.status).toBe(404);
  });

  it('rejects an unknown media role for an otherwise-known handle', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string }[] };
    const record = index.records.find((r) => r.family === 'observation');
    const response = await fetch(`${url}/api/media/${record!.handle}/bogus-role`);
    expect(response.status).toBe(404);
  });

  it('rejects a role that does not apply to the given family (e.g. "image" for an observation)', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string }[] };
    const record = index.records.find((r) => r.family === 'observation');
    const response = await fetch(`${url}/api/media/${record!.handle}/image`);
    expect(response.status).toBe(404);
  });
});

describe('filesystem/path security', () => {
  it('a directly-crafted handle attempting path traversal never escapes the evidence root', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);

    const traversalHandles = [
      `observation:${encodeURIComponent('../../etc')}`,
      `observation:${encodeURIComponent('..%2f..%2fetc')}`,
      `observation:${encodeURIComponent('..\\..\\windows')}`,
    ];
    for (const handle of traversalHandles) {
      const artifactResponse = await fetch(`${url}/api/artifacts/${handle}`);
      expect(artifactResponse.status).toBe(404);
      const mediaResponse = await fetch(`${url}/api/media/${handle}/screenshot`);
      expect(mediaResponse.status).toBe(404);
    }
  });

  it('an absolute-path-shaped handle is rejected, never resolved as a real filesystem path', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    const handles = [`observation:${encodeURIComponent('C:/Windows/System32')}`, `observation:${encodeURIComponent('/etc/passwd')}`];
    for (const handle of handles) {
      const response = await fetch(`${url}/api/artifacts/${handle}`);
      expect(response.status).toBe(404);
    }
  });

  it('a media role cannot be smuggled as a filename to read an arbitrary sibling file', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    await writeFile(path.join(fixture.beforeRoot, 'secret.txt'), 'must never be servable');
    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string; logicalId?: string }[] };
    const record = index.records.find((r) => r.family === 'observation' && r.logicalId === 'obs-before');
    const response = await fetch(`${url}/api/media/${record!.handle}/${encodeURIComponent('secret.txt')}`);
    expect(response.status).toBe(404);
  });

  it('the viewer never becomes a generic file server: repository/source files are never reachable through any evidence route', async () => {
    const root = await makeRoot();
    await writeFullPipelineFixture(root);
    const { url } = await startFor(root);
    for (const path_ of ['/api/artifacts/observation:..', '/api/media/observation:../..//package.json/screenshot']) {
      const response = await fetch(`${url}${path_}`);
      expect(response.status).not.toBe(200);
    }
  });

  it('a media filename that is itself a symlink/junction pointing outside the evidence root never serves the linked-to file\'s content', async () => {
    const root = await makeRoot();
    const fixture = await writeFullPipelineFixture(root);
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-viewer-symlink-outside-'));
    cleanupDirs.push(outsideDir);
    const secretPath = path.join(outsideDir, 'secret.png');
    await writeFile(secretPath, 'this must never be servable through the viewer');

    const screenshotPath = path.join(fixture.beforeRoot, 'screenshot.png');
    await rm(screenshotPath, { force: true });
    try {
      await symlink(secretPath, screenshotPath, 'file');
    } catch (err) {
      // Some CI/dev environments (notably Windows without symlink privilege) cannot create
      // file symlinks at all - in that case the escape this test targets is categorically
      // impossible on this platform, so there is nothing further to prove here.
      expect((err as NodeJS.ErrnoException).code === 'EPERM' || (err as NodeJS.ErrnoException).code === 'ENOSYS').toBe(true);
      return;
    }

    const { url } = await startFor(root);
    const index = (await (await fetch(`${url}/api/index`)).json()) as { records: { handle: string; family: string; logicalId?: string }[] };
    const record = index.records.find((r) => r.family === 'observation' && r.logicalId === 'obs-before');
    const response = await fetch(`${url}/api/media/${record!.handle}/screenshot`);
    if (response.status === 200) {
      const body = await response.text();
      expect(body).not.toContain('this must never be servable through the viewer');
    } else {
      expect(response.status).not.toBe(200);
    }
  });
});
