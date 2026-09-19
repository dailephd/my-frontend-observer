import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  startDemoServer,
  isValidDemoPortArgument,
  resolveContainedAppFile,
  applyStateToTemplate,
  DEMO_STATES,
  DEMO_HOST,
  DEMO_ID,
  DEMO_DEFAULT_STATE,
  DEMO_CANONICAL_VIEWPORT,
  DEMO_SCHEMA_VERSION,
} from '../../examples/v09-demo/scripts/server.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../..');
const demoRoot = path.join(repoRoot, 'examples', 'v09-demo');
const appRoot = path.join(demoRoot, 'app');
const serverScript = path.join(demoRoot, 'scripts', 'server.mjs');

interface Started {
  port: number;
  host: string;
  boundAddress: string;
  baseUrl: string;
  appRoot: string;
  close: () => Promise<void>;
}

/**
 * Raw HTTP request with an unmodified request target. `fetch` normalizes
 * `..` out of a URL before it ever reaches the wire, so it cannot be used to
 * prove the server's own traversal defence.
 */
function rawGet(port: number, requestTarget: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: DEMO_HOST, port, method: 'GET', path: requestTarget }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('v0.9 demo server - pure boundaries', () => {
  it('validates an explicit --port value as an integer inside the TCP port range', () => {
    expect(isValidDemoPortArgument(1)).toBe(true);
    expect(isValidDemoPortArgument(4173)).toBe(true);
    expect(isValidDemoPortArgument(65535)).toBe(true);
    expect(isValidDemoPortArgument(0)).toBe(false);
    expect(isValidDemoPortArgument(-1)).toBe(false);
    expect(isValidDemoPortArgument(65536)).toBe(false);
    expect(isValidDemoPortArgument(4173.5)).toBe(false);
    expect(isValidDemoPortArgument(Number.NaN)).toBe(false);
  });

  it('never hardcodes a port', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(serverScript, 'utf8'));
    expect(source).not.toContain('4173');
  });

  it('rejects every traversal, separator and escape shape when resolving an application file', () => {
    expect(resolveContainedAppFile(appRoot, '/styles.css')).toBe(path.join(appRoot, 'styles.css'));
    expect(resolveContainedAppFile(appRoot, '/assets/brand-mark.svg')).toBe(path.join(appRoot, 'assets', 'brand-mark.svg'));
    expect(resolveContainedAppFile(appRoot, '/../package.json')).toBeUndefined();
    expect(resolveContainedAppFile(appRoot, '/assets/../../package.json')).toBeUndefined();
    expect(resolveContainedAppFile(appRoot, '/./styles.css')).toBeUndefined();
    expect(resolveContainedAppFile(appRoot, '\\windows\\system32')).toBeUndefined();
    expect(resolveContainedAppFile(appRoot, '/styles\0.css')).toBeUndefined();
    expect(resolveContainedAppFile(appRoot, '/')).toBeUndefined();
  });

  it('only ever rewrites the single frozen state attribute', () => {
    const template = '<html data-demo-state="baseline"><body data-x="data-demo-state=&quot;baseline&quot;"></body></html>';
    expect(applyStateToTemplate(template, 'reference')).toBe(
      '<html data-demo-state="reference"><body data-x="data-demo-state=&quot;baseline&quot;"></body></html>',
    );
    expect(() => applyStateToTemplate('<html></html>', 'baseline')).toThrow(/missing the required/);
  });
});

describe('v0.9 demo server - real HTTP against the tracked template', () => {
  let server: Started;

  beforeAll(async () => {
    server = (await startDemoServer({ port: 0, appRoot })) as Started;
  });

  afterAll(async () => {
    await server.close();
  });

  it('binds loopback only', () => {
    expect(server.host).toBe('127.0.0.1');
    expect(server.boundAddress).toBe('127.0.0.1');
    expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port}`);
  });

  it('answers /health with 2xx and a bounded deterministic document', async () => {
    const first = await fetch(`${server.baseUrl}/health`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const firstBody = await first.text();
    const second = await fetch(`${server.baseUrl}/health`);
    const secondBody = await second.text();

    // Deterministic: no current time, no per-run identity, so repeated reads are byte-identical.
    expect(secondBody).toBe(firstBody);
    expect(JSON.parse(firstBody)).toEqual({
      ok: true,
      demoId: DEMO_ID,
      schemaVersion: DEMO_SCHEMA_VERSION,
      canonicalViewport: DEMO_CANONICAL_VIEWPORT,
      defaultState: DEMO_DEFAULT_STATE,
      states: DEMO_STATES,
    });
  });

  it('does not confuse the health path with application HTML', async () => {
    const health = await fetch(`${server.baseUrl}/health`);
    expect(await health.text()).not.toContain('data-demo-target');
  });

  it('serves the baseline application HTML at the root with no state parameter', async () => {
    const response = await fetch(`${server.baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await response.text();
    expect(html).toContain(`data-demo-state="${DEMO_DEFAULT_STATE}"`);
    expect(html).toContain('data-demo-target="header"');
  });

  it('renders every required state with that state frozen into the served document', async () => {
    for (const state of DEMO_STATES) {
      const response = await fetch(`${server.baseUrl}/?state=${state}`);
      expect(response.status, `${state} status`).toBe(200);
      const html = await response.text();
      const declared = [...html.matchAll(/data-demo-state="([^"]*)"/g)].map((match) => match[1]);
      // Exactly one state attribute, and it is the requested one: no other
      // state is ever left behind in the served document.
      expect(declared, `${state} served state`).toEqual([state]);
      expect(html, `${state} document`).toContain('data-demo-target="header"');
    }
  });

  it('fails closed on an unknown state instead of substituting another one', async () => {
    const response = await fetch(`${server.baseUrl}/?state=not-a-demo-state`);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('data-demo-invalid-state="not-a-demo-state"');
    expect(html).toContain('demo-invalid-state');
    // The application itself is never rendered for an invalid state.
    expect(html).not.toContain('data-demo-target=');
    expect(html).not.toContain('data-demo-state=');
  });

  it('escapes a hostile state value into the invalid-state page', async () => {
    const response = await fetch(`${server.baseUrl}/?state=${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('serves every local asset the application needs', async () => {
    const expected: [string, string][] = [
      ['/styles.css', 'text/css; charset=utf-8'],
      ['/state.js', 'text/javascript; charset=utf-8'],
      ['/assets/brand-mark.svg', 'image/svg+xml'],
      ['/assets/asset-primary.svg', 'image/svg+xml'],
      ['/assets/asset-alternate.svg', 'image/svg+xml'],
    ];
    for (const [route, contentType] of expected) {
      const response = await fetch(`${server.baseUrl}${route}`);
      expect(response.status, `${route} status`).toBe(200);
      expect(response.headers.get('content-type'), `${route} type`).toBe(contentType);
      expect((await response.text()).length, `${route} body`).toBeGreaterThan(0);
    }
  });

  it('rejects path traversal on the wire, including percent-encoded and separator forms', async () => {
    for (const target of [
      '/../package.json',
      '/../../package.json',
      '/assets/../../package.json',
      '/%2e%2e/package.json',
      '/%2E%2E%2Fpackage.json',
      '/..%5Cpackage.json',
    ]) {
      const response = await rawGet(server.port, target);
      expect(response.status, `${target} must not be served`).toBe(404);
      expect(response.body).not.toContain('my-frontend-observer');
    }
  });

  it('serves nothing outside the small static allowlist', async () => {
    for (const target of ['/README.md', '/package.json', '/unknown.txt', '/app/index.html']) {
      const response = await rawGet(server.port, target);
      expect(response.status, `${target}`).toBe(404);
    }
  });

  it('rejects a non-read method', async () => {
    const response = await fetch(`${server.baseUrl}/`, { method: 'POST' });
    expect(response.status).toBe(405);
  });
});

describe('v0.9 demo server - materialized target and caller-selected port', () => {
  it('requires --port and rejects an out-of-range or non-integer value', async () => {
    for (const args of [[], ['--port'], ['--port', 'abc'], ['--port', '0'], ['--port', '-1'], ['--port', '65536'], ['--port', '80.5']]) {
      const failure = await execFileAsync(process.execPath, [serverScript, ...args], { cwd: repoRoot }).catch((error) => error);
      expect(failure.code, `args ${JSON.stringify(args)} must fail`).toBe(1);
      expect(String(failure.stderr)).toMatch(/--port/);
    }
  });

  it('rejects an unrecognized argument', async () => {
    const failure = await execFileAsync(process.execPath, [serverScript, '--port', '4173', '--root', 'x'], { cwd: repoRoot }).catch(
      (error) => error,
    );
    expect(failure.code).toBe(1);
    expect(String(failure.stderr)).toMatch(/unrecognized argument: --root/);
  });

  it('listens on exactly the caller-selected port', async () => {
    // Reserve a free loopback port, release it, then require the demo server to take that exact port.
    const probe = (await startDemoServer({ port: 0, appRoot })) as Started;
    const chosen = probe.port;
    await probe.close();

    const server = (await startDemoServer({ port: chosen, appRoot })) as Started;
    try {
      expect(server.port).toBe(chosen);
      expect(server.baseUrl).toBe(`http://127.0.0.1:${chosen}`);
      const health = await fetch(`${server.baseUrl}/health`);
      expect(health.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
