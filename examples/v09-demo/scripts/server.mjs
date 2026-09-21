#!/usr/bin/env node
// Deterministic loopback demo server for the my-frontend-observer v0.9 demo.
//
// This is demonstration infrastructure, not product code. It is never
// imported by `src/`, never shipped inside the npm package, and deliberately
// duplicates nothing from the Observer viewer server: it serves one small
// static demo application and nothing else.
//
// Contract:
//   - binds 127.0.0.1 only, never 0.0.0.0 and never a non-loopback address;
//   - the port is always chosen by the caller, never hardcoded;
//   - `GET /health` answers a bounded, deterministic JSON readiness document
//     with no current time and no random run identity;
//   - `GET /` (optionally `?state=<state>`) answers the demo application with
//     the requested state frozen into the served HTML;
//   - an unknown state fails closed with HTTP 400 and an explicit
//     invalid-state document, never a silently substituted other state;
//   - every other path is resolved inside the demo application directory and
//     restricted to an allowlist of static asset types; anything else is 404.
//
// Usage: node server.mjs --port <1-65535> [--app-root <dir>]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Stable identity of this demo. Frozen: later tutorial tooling reads it. */
export const DEMO_ID = 'my-frontend-observer-v09-demo';

/** Version of this demo's own readiness/identity document, not any Observer artifact schema. */
export const DEMO_SCHEMA_VERSION = '1.0.0';

/** The canonical viewport the demo's geometry is frozen for. */
export const DEMO_CANONICAL_VIEWPORT = { width: 1440, height: 900 };

/** The frozen demo state vocabulary, in documentation order. */
export const DEMO_STATES = [
  'baseline',
  'move-hero',
  'wider-sidebar',
  'changed-spacing',
  'move-footer',
  'removed-card',
  'changed-asset',
  'multi-change',
  'reference',
];

export const DEMO_DEFAULT_STATE = 'baseline';

export const DEMO_HOST = '127.0.0.1';
export const DEMO_PORT_MIN = 1;
export const DEMO_PORT_MAX = 65535;

/**
 * Strict validation for an explicit `--port` value: an integer inside the
 * valid TCP port range. `0` is rejected on the command line so a caller can
 * never believe it selected a port it did not actually select. In-process
 * callers (tests, and the reference-image generator) may still pass `port: 0`
 * to `startDemoServer` to get an OS-assigned ephemeral port, mirroring the
 * repository's existing viewer port contract in `src/viewerServer/port.ts`.
 */
export function isValidDemoPortArgument(value) {
  return Number.isInteger(value) && value >= DEMO_PORT_MIN && value <= DEMO_PORT_MAX;
}

export function isDemoState(value) {
  return typeof value === 'string' && DEMO_STATES.includes(value);
}

/** Bounded allowlist: anything outside it is 404, never served by guessing a type. */
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.json', 'application/json; charset=utf-8'],
]);

const serverDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The demo application directory. A materialized target root holds
 * `server.mjs` beside `app/`; the tracked source template holds
 * `scripts/server.mjs` beside `../app/`. Both are resolved deterministically,
 * and an explicit `--app-root` always wins over either.
 */
export function defaultAppRoot() {
  const beside = path.join(serverDir, 'app');
  if (existsSync(beside)) return beside;
  return path.resolve(serverDir, '..', 'app');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolves one request path inside the demo application directory. Returns
 * `undefined` for any traversal, escape, separator or encoding attempt -
 * callers must treat that as "not found" and must never attempt a fallback
 * resolution.
 */
export function resolveContainedAppFile(appRoot, requestPath) {
  if (typeof requestPath !== 'string' || requestPath.includes('\0')) return undefined;
  if (requestPath.includes('\\')) return undefined;
  const segments = requestPath.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return undefined;
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return undefined;
  }
  const resolvedRoot = path.resolve(appRoot);
  const candidate = path.resolve(resolvedRoot, ...segments);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (!candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

function healthDocument() {
  return {
    ok: true,
    demoId: DEMO_ID,
    schemaVersion: DEMO_SCHEMA_VERSION,
    canonicalViewport: DEMO_CANONICAL_VIEWPORT,
    defaultState: DEMO_DEFAULT_STATE,
    states: DEMO_STATES,
  };
}

/**
 * Freezes the requested state into the served document. The template ships
 * with the baseline state already written, so the tracked `app/index.html` is
 * a valid standalone document; only the single frozen attribute occurrence is
 * rewritten, and only ever to a member of DEMO_STATES.
 */
export function applyStateToTemplate(template, state) {
  const marker = `data-demo-state="${DEMO_DEFAULT_STATE}"`;
  if (!template.includes(marker)) {
    throw new Error(`demo template is missing the required ${marker} attribute`);
  }
  return template.replace(marker, `data-demo-state="${state}"`);
}

function invalidStateDocument(requested) {
  const safe = escapeHtml(requested);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <title>Invalid demo state</title>',
    '    <link rel="stylesheet" href="styles.css" />',
    '  </head>',
    `  <body class="invalid-state" data-demo-invalid-state="${safe}">`,
    '    <h1 data-testid="demo-invalid-state">Invalid demo state</h1>',
    `    <p>The requested state <code>${safe}</code> is not part of this demo's frozen state vocabulary.</p>`,
    `    <p>Supported states: <code>${DEMO_STATES.join(', ')}</code>.</p>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function sendBytes(res, status, contentType, bytes) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': bytes.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}

async function handle(req, res, appRoot) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'text/plain; charset=utf-8', 'method not allowed\n');
    return;
  }

  let url;
  try {
    // The base is only a parsing base; no request is ever made to it.
    url = new URL(req.url ?? '/', `http://${DEMO_HOST}`);
  } catch {
    send(res, 400, 'text/plain; charset=utf-8', 'malformed request target\n');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    send(res, 400, 'text/plain; charset=utf-8', 'malformed request target\n');
    return;
  }

  if (pathname === '/health') {
    send(res, 200, 'application/json; charset=utf-8', `${JSON.stringify(healthDocument(), null, 2)}\n`);
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    const requested = url.searchParams.get('state');
    if (requested !== null && !isDemoState(requested)) {
      send(res, 400, 'text/html; charset=utf-8', invalidStateDocument(requested));
      return;
    }
    const state = requested ?? DEMO_DEFAULT_STATE;
    const templatePath = path.join(path.resolve(appRoot), 'index.html');
    let template;
    try {
      template = await readFile(templatePath, 'utf8');
    } catch {
      send(res, 500, 'text/plain; charset=utf-8', 'demo application template is unavailable\n');
      return;
    }
    send(res, 200, 'text/html; charset=utf-8', applyStateToTemplate(template, state));
    return;
  }

  const filePath = resolveContainedAppFile(appRoot, pathname);
  if (filePath === undefined) {
    send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
    return;
  }

  const contentType = CONTENT_TYPES.get(path.extname(filePath).toLowerCase());
  if (contentType === undefined) {
    send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
    return;
  }

  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
    return;
  }
  sendBytes(res, 200, contentType, bytes);
}

/**
 * Starts the demo server on loopback. `port: 0` asks the OS for an ephemeral
 * port and is intended for in-process automation; command-line callers always
 * pass a real port.
 */
export function startDemoServer({ port, appRoot } = {}) {
  const resolvedAppRoot = path.resolve(appRoot ?? defaultAppRoot());
  const server = createServer((req, res) => {
    handle(req, res, resolvedAppRoot).catch(() => {
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'internal demo server error\n');
      else res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, DEMO_HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('demo server did not receive a TCP address'));
        return;
      }
      resolve({
        port: address.port,
        host: DEMO_HOST,
        /** The address the listener actually bound, read back from the OS - not the requested constant. */
        boundAddress: address.address,
        baseUrl: `http://${DEMO_HOST}:${address.port}`,
        appRoot: resolvedAppRoot,
        close: () =>
          new Promise((closed, failed) => {
            server.close((err) => (err ? failed(err) : closed(undefined)));
          }),
      });
    });
  });
}

function parseArgs(argv) {
  const errors = [];
  let port;
  let appRoot;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port') {
      const value = argv[(index += 1)];
      const parsed = value === undefined ? Number.NaN : Number(value);
      if (!isValidDemoPortArgument(parsed)) {
        errors.push(`--port must be an integer between ${DEMO_PORT_MIN} and ${DEMO_PORT_MAX}; got ${JSON.stringify(value)}`);
      } else {
        port = parsed;
      }
    } else if (arg === '--app-root') {
      const value = argv[(index += 1)];
      if (value === undefined) errors.push('--app-root requires a directory path argument');
      else appRoot = value;
    } else {
      errors.push(`unrecognized argument: ${arg}`);
    }
  }
  if (port === undefined && errors.length === 0) errors.push('--port is required');
  return { errors, port, appRoot };
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { errors, port, appRoot } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    for (const error of errors) console.error(`demo server: ${error}`);
    console.error('usage: node server.mjs --port <1-65535> [--app-root <dir>]');
    process.exitCode = 1;
  } else {
    const started = await startDemoServer({ port, ...(appRoot === undefined ? {} : { appRoot }) });
    console.log(`demo server listening on ${started.baseUrl} (app root: ${started.appRoot})`);
    console.log(`health: ${started.baseUrl}/health`);
  }
}
