import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { getProducerInfo } from '../domain/schema.js';

/** Batch 1 viewer protocol identity: the shape of GET /api/status. Bumped independently of package/schema versions if the status contract itself changes. */
export const VIEWER_PROTOCOL_VERSION = '1.0.0';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function mimeTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolves a requested URL pathname against the built viewer asset root,
 * refusing to leave that root under any circumstance (encoded traversal,
 * `..` segments, absolute-looking segments). Returns `undefined` when the
 * request cannot possibly map to a safe on-disk path - callers must treat
 * that as "not found", never attempt a fallback read.
 */
function resolveAssetPath(assetsRoot: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const normalized = normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = resolve(assetsRoot, normalized);
  const rootWithSep = assetsRoot.endsWith(sep) ? assetsRoot : assetsRoot + sep;
  if (candidate !== assetsRoot && !candidate.startsWith(rootWithSep)) {
    return undefined;
  }
  return candidate;
}

export interface ViewerServerState {
  /** The explicit, caller-supplied local evidence root this viewer session represents. Never interpreted as Observer evidence in Batch 1. */
  root: string;
}

export interface CreateViewerServerOptions {
  /** Absolute path to the built viewer static assets (index.html, JS/CSS bundles, manifest, icons). */
  assetsRoot: string;
  state: ViewerServerState;
}

/**
 * Builds (but does not start listening on) the loopback-only viewer HTTP
 * server. Read-only: serves only the built viewer application shell plus one
 * minimal status endpoint. Never serves the evidence root as a generic
 * static directory, never accepts write methods, and fails closed on any
 * path that would resolve outside `assetsRoot`.
 */
export function createViewerServer(options: CreateViewerServerOptions): Server {
  const { assetsRoot, state } = options;

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, assetsRoot, state);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, assetsRoot: string, state: ViewerServerState): Promise<void> {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }

  let pathname: string;
  try {
    pathname = new URL(req.url ?? '/', 'http://viewer.local').pathname;
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }

  if (pathname === '/api/status') {
    const body = JSON.stringify({
      ok: true,
      viewerProtocolVersion: VIEWER_PROTOCOL_VERSION,
      producer: getProducerInfo(),
      root: state.root,
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : JSON.stringify({ ok: false, error: 'unknown viewer API route' }));
    return;
  }

  const isAssetLikePath = extname(pathname) !== '';
  const candidatePath = resolveAssetPath(assetsRoot, pathname === '/' ? '/index.html' : pathname);

  if (candidatePath !== undefined) {
    const served = await tryServeFile(candidatePath, res, method);
    if (served) return;
    if (isAssetLikePath) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
  }

  // SPA fallback for unknown, non-asset viewer routes (e.g. future client-side navigation): serve the shell itself rather than a bare 404.
  const indexPath = join(assetsRoot, 'index.html');
  const servedIndex = await tryServeFile(indexPath, res, method);
  if (!servedIndex) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('viewer assets are not built - run the package build before starting the viewer');
  }
}

async function tryServeFile(path: string, res: ServerResponse, method: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': mimeTypeFor(path),
      'content-length': body.byteLength,
      'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}
