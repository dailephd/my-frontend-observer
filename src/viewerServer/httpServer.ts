import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { getProducerInfo } from '../domain/schema.js';
import { buildEvidenceIndexMetadata, loadArtifactByHandle } from './evidence/index.js';
import { resolveMedia } from './evidence/mediaResolver.js';
import { getObservationRelationships } from './evidence/observationView.js';
import { getComparisonView } from './evidence/comparisonView.js';
import { getEvaluationView } from './evidence/evaluationView.js';

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

  if (pathname === '/api/index') {
    const result = await buildEvidenceIndexMetadata(state.root);
    const body = JSON.stringify({ ok: true, records: result.records, truncated: result.truncated });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  const artifactMatch = /^\/api\/artifacts\/([^/]+)$/.exec(pathname);
  if (artifactMatch) {
    const handle = decodeURIComponentSafe(artifactMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed artifact handle');
      return;
    }
    const result = await loadArtifactByHandle(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const body: Record<string, unknown> =
        result.reason === 'unknown-handle' ? { ok: false, error: 'unknown viewer artifact handle' } : { ok: false, error: 'artifact is not currently loadable', metadata: result.metadata };
      writeJsonBody(res, method, status, body);
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, handle: result.detail.handle, family: result.detail.family, artifact: result.detail.artifact });
    return;
  }

  const mediaMatch = /^\/api\/media\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (mediaMatch) {
    const handle = decodeURIComponentSafe(mediaMatch[1] as string);
    const role = decodeURIComponentSafe(mediaMatch[2] as string);
    if (handle === undefined || role === undefined) {
      writeJsonError(res, method, 400, 'malformed media request');
      return;
    }
    const resolution = await resolveMedia(state.root, handle, role);
    if (!resolution.ok) {
      writeJsonError(res, method, 404, resolution.reason);
      return;
    }
    await streamFile(resolution.absolutePath, resolution.mimeType, res, method);
    return;
  }

  const relationshipsMatch = /^\/api\/observations\/([^/]+)\/relationships$/.exec(pathname);
  if (relationshipsMatch) {
    const handle = decodeURIComponentSafe(relationshipsMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed observation handle');
      return;
    }
    const result = await getObservationRelationships(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const error =
        result.reason === 'unknown-handle'
          ? 'unknown viewer artifact handle'
          : result.reason === 'not-an-observation'
            ? 'relationships are only defined for observation evidence'
            : result.reason === 'not-currently-loadable'
              ? 'observation is not currently loadable'
              : `relationship derivation failed: ${result.detail}`;
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, graph: result.graph });
    return;
  }

  const comparisonViewMatch = /^\/api\/comparisons\/([^/]+)\/view$/.exec(pathname);
  if (comparisonViewMatch) {
    const handle = decodeURIComponentSafe(comparisonViewMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed comparison handle');
      return;
    }
    const result = await getComparisonView(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const error =
        result.reason === 'unknown-handle' ? 'unknown viewer artifact handle' : result.reason === 'not-a-comparison' ? 'view is only defined for comparison evidence' : 'comparison is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, before: result.before, after: result.after });
    return;
  }

  const evaluationViewMatch = /^\/api\/evaluations\/([^/]+)\/view$/.exec(pathname);
  if (evaluationViewMatch) {
    const handle = decodeURIComponentSafe(evaluationViewMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed evaluation handle');
      return;
    }
    const result = await getEvaluationView(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const error =
        result.reason === 'unknown-handle' ? 'unknown viewer artifact handle' : result.reason === 'not-an-evaluation' ? 'view is only defined for contract-evaluation evidence' : 'evaluation is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, comparison: result.comparison, baseline: result.baseline, change: result.change, before: result.before, after: result.after });
    return;
  }

  if (pathname.startsWith('/api/')) {
    writeJsonError(res, method, 404, 'unknown viewer API route');
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

function decodeURIComponentSafe(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function writeJsonBody(res: ServerResponse, method: string, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(method === 'HEAD' ? undefined : JSON.stringify(body));
}

function writeJsonError(res: ServerResponse, method: string, status: number, error: string): void {
  writeJsonBody(res, method, status, { ok: false, error });
}

/** Streams one already-resolved, already-contained media file. Never used for arbitrary paths - callers must have gone through mediaResolver.ts's handle/role validation first. */
async function streamFile(absolutePath: string, mimeType: string, res: ServerResponse, method: string): Promise<void> {
  let size: number;
  try {
    size = (await stat(absolutePath)).size;
  } catch {
    writeJsonError(res, method, 404, 'media file not found on disk');
    return;
  }
  res.writeHead(200, { 'content-type': mimeType, 'content-length': size, 'cache-control': 'no-store' });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on('error', reject);
    stream.on('end', resolvePromise);
    stream.pipe(res);
  });
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
