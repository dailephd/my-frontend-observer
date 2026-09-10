import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { startViewer, defaultViewerAssetsRoot } from '../../src/viewerServer/viewerService.js';
import { DEFAULT_VIEWER_PORT, VIEWER_HOST, isValidViewerPort } from '../../src/viewerServer/port.js';

const cleanupDirs: string[] = [];
const cleanupClosers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanupClosers.splice(0).map((close) => close()));
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A minimal, self-contained fixture assets root mirroring the shape of `dist/viewer`, so server behavior is testable without depending on a real Vite build having already run. */
async function makeFixtureAssetsRoot(): Promise<{ assetsRoot: string; outsideFile: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-viewer-fixture-'));
  cleanupDirs.push(parent);
  const assetsRoot = path.join(parent, 'assets-root');
  const outsideDir = path.join(parent, 'outside');
  await mkdir(assetsRoot, { recursive: true });
  await mkdir(path.join(assetsRoot, 'nested'), { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(assetsRoot, 'index.html'), '<!doctype html><title>viewer shell fixture</title>');
  await writeFile(path.join(assetsRoot, 'manifest.webmanifest'), '{"name":"fixture"}');
  await writeFile(path.join(assetsRoot, 'nested', 'app.js'), 'console.log("fixture");');
  const outsideFile = path.join(outsideDir, 'secret.txt');
  await writeFile(outsideFile, 'must never be servable');
  return { assetsRoot, outsideFile };
}

async function makeEvidenceRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-viewer-root-'));
  cleanupDirs.push(dir);
  return dir;
}

describe('port validation', () => {
  it('accepts the fixed default port and any in-range explicit port, including 0 for ephemeral test binding', () => {
    expect(isValidViewerPort(DEFAULT_VIEWER_PORT)).toBe(true);
    expect(isValidViewerPort(0)).toBe(true);
    expect(isValidViewerPort(65535)).toBe(true);
  });

  it('rejects out-of-range or non-integer ports', () => {
    expect(isValidViewerPort(-1)).toBe(false);
    expect(isValidViewerPort(65536)).toBe(false);
    expect(isValidViewerPort(1.5)).toBe(false);
  });

  it('the default host is loopback-only', () => {
    expect(VIEWER_HOST).toBe('127.0.0.1');
  });
});

describe('startViewer - loopback-only server', () => {
  it('binds only to 127.0.0.1 on the requested port and reports a matching URL', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: 0, assetsRoot });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    cleanupClosers.push(result.close);

    expect(result.host).toBe('127.0.0.1');
    expect(result.url).toBe(`http://127.0.0.1:${result.port}`);
    expect(result.port).toBeGreaterThan(0);
  });

  it('serves the built viewer shell at the root path', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: 0, assetsRoot });
    if (!result.ok) throw new Error('expected server to start');
    cleanupClosers.push(result.close);

    const response = await fetch(`${result.url}/`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('viewer shell fixture');
  });

  it('serves nested built assets and reports their content type', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: 0, assetsRoot });
    if (!result.ok) throw new Error('expected server to start');
    cleanupClosers.push(result.close);

    const response = await fetch(`${result.url}/nested/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
  });

  it('falls back to the shell (SPA fallback) for an unknown non-asset viewer route', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: 0, assetsRoot });
    if (!result.ok) throw new Error('expected server to start');
    cleanupClosers.push(result.close);

    const response = await fetch(`${result.url}/some/future/client/route`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('viewer shell fixture');
  });

  it('404s a request for a nonexistent asset-like path rather than falling back to the shell', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: 0, assetsRoot });
    if (!result.ok) throw new Error('expected server to start');
    cleanupClosers.push(result.close);

    const response = await fetch(`${result.url}/nested/does-not-exist.js`);
    expect(response.status).toBe(404);
  });

  it('exposes minimal status/session state, including the exact supplied root, at a bounded read-only endpoint', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: 0, assetsRoot });
    if (!result.ok) throw new Error('expected server to start');
    cleanupClosers.push(result.close);

    const response = await fetch(`${result.url}/api/status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; root: string };
    expect(body.ok).toBe(true);
    expect(body.root).toBe(root);
  });

  it('rejects write methods (POST/PUT/DELETE) - the viewer server is read-only', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: 0, assetsRoot });
    if (!result.ok) throw new Error('expected server to start');
    cleanupClosers.push(result.close);

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await fetch(`${result.url}/`, { method });
      expect(response.status).toBe(405);
    }
  });
});

describe('startViewer - filesystem trust boundary', () => {
  it('never serves a file outside the built assets root via encoded traversal segments', async () => {
    const { assetsRoot, outsideFile } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: 0, assetsRoot });
    if (!result.ok) throw new Error('expected server to start');
    cleanupClosers.push(result.close);

    const traversalAttempts = ['/../outside/secret.txt', '/..%2foutside%2fsecret.txt', '/%2e%2e/outside/secret.txt', '/nested/../../outside/secret.txt'];
    for (const attempt of traversalAttempts) {
      const response = await fetch(`${result.url}${attempt}`);
      const body = await response.text();
      expect(body).not.toContain('must never be servable');
    }
    // Sanity: the file genuinely exists on disk outside the assets root, proving the above is a real boundary test.
    expect(outsideFile.startsWith(assetsRoot)).toBe(false);
  });

  it('never exposes the supplied evidence root as static content', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    await writeFile(path.join(root, 'not-servable.txt'), 'evidence-root content must never be served as a static file');
    const result = await startViewer({ root, port: 0, assetsRoot });
    if (!result.ok) throw new Error('expected server to start');
    cleanupClosers.push(result.close);

    const response = await fetch(`${result.url}/not-servable.txt`);
    expect(response.status).not.toBe(200);
  });

  it('fails closed with an actionable diagnostic when --root does not exist, without starting a listener', async () => {
    const result = await startViewer({ root: path.join(tmpdir(), 'definitely-does-not-exist-viewer-root') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('viewer-root-invalid');
  });

  it('fails closed when --root is a file, not a directory', async () => {
    const dir = await makeEvidenceRoot();
    const filePath = path.join(dir, 'file.txt');
    await writeFile(filePath, 'x');
    const result = await startViewer({ root: filePath });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('viewer-root-invalid');
  });
});

describe('startViewer - port collision', () => {
  it('fails with an actionable diagnostic (never a silent fallback port) when the requested port is already bound', async () => {
    const occupied = createServer((_req, res) => res.end('occupied'));
    await new Promise<void>((resolvePromise) => occupied.listen(0, VIEWER_HOST, resolvePromise));
    const address = occupied.address();
    if (address === null || typeof address === 'string') throw new Error('failed to bind occupying server');
    cleanupClosers.push(() => new Promise((resolvePromise, reject) => occupied.close((err) => (err ? reject(err) : resolvePromise()))));

    const root = await makeEvidenceRoot();
    const result = await startViewer({ root, port: address.port });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('viewer-port-unavailable');
    expect(result.diagnostics[0]?.message).toContain(String(address.port));
  });
});

describe('startViewer - clean shutdown', () => {
  it('close() releases the port so a subsequent bind to the same explicit port succeeds', async () => {
    const { assetsRoot } = await makeFixtureAssetsRoot();
    const root = await makeEvidenceRoot();
    const first = await startViewer({ root, port: 0, assetsRoot });
    if (!first.ok) throw new Error('expected first server to start');
    const boundPort = first.port;
    await first.close();

    const second = await startViewer({ root, port: boundPort, assetsRoot });
    expect(second.ok).toBe(true);
    if (second.ok) cleanupClosers.push(second.close);
  });
});

describe('defaultViewerAssetsRoot', () => {
  it('resolves to a "viewer" directory next to this package\'s own compiled output, not the caller\'s working directory', () => {
    const resolved = defaultViewerAssetsRoot();
    expect(path.basename(resolved)).toBe('viewer');
    expect(path.isAbsolute(resolved)).toBe(true);
  });
});
