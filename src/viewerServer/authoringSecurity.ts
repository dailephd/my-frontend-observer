import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * v0.9 Batch 2 viewer authoring security boundary (frozen plan section 9).
 * The loopback viewer server stays read-only unless it was started for a
 * validated initialized project. In that mode one in-memory session token is
 * generated per server session, never persisted (not in project config,
 * catalog, artifacts, cookies, localStorage, service-worker cache, or URLs),
 * and it expires when the server exits. Every authoring POST must present it
 * together with the exact expected loopback Host and Origin.
 *
 * This is a same-machine, same-origin capability check - not an
 * authentication system for remote users.
 */

export const VIEWER_AUTHORING_TOKEN_BYTES = 32;

export const VIEWER_AUTHORING_TOKEN_HEADER = 'x-frontend-observer-authoring-token' as const;

export const MAX_ANNOTATION_AUTHORING_BODY_BYTES = 256 * 1024;

export interface ViewerAuthoringSession {
  /** Canonical absolute project root. Server-owned; never sent to the browser. */
  projectRoot: string;
  /** 64 lowercase hex characters. Memory-only. */
  token: string;
  /** `127.0.0.1:<actualPort>`, set once the listener is bound. Empty until then, which matches no request. */
  expectedHost: string;
  /** `http://127.0.0.1:<actualPort>`, set once the listener is bound. Empty until then, which matches no request. */
  expectedOrigin: string;
}

export function createViewerAuthoringToken(): string {
  return randomBytes(VIEWER_AUTHORING_TOKEN_BYTES).toString('hex');
}

export type AuthoringCheckResult = { ok: true } | { ok: false; status: 403 | 413 | 415; error: string };

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** True only for the exact expected loopback Host. An unset expectation never matches. */
export function isExpectedAuthoringHost(req: IncomingMessage, session: ViewerAuthoringSession): boolean {
  return session.expectedHost.length > 0 && singleHeader(req.headers.host) === session.expectedHost;
}

function tokensMatch(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(presentedBytes, expectedBytes);
}

/** `application/json`, optionally with exactly a UTF-8 charset parameter; case-insensitive with normal optional whitespace. */
export function isAcceptedJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const [mediaType, ...parameters] = value.split(';').map((part) => part.trim());
  if (mediaType === undefined || mediaType.toLowerCase() !== 'application/json') return false;
  return parameters.filter((parameter) => parameter.length > 0).every((parameter) => /^charset\s*=\s*"?utf-8"?$/i.test(parameter));
}

/**
 * Header-level checks for one authoring POST, in this order: Host, Origin,
 * session token, JSON content type, and content encoding (compressed bodies
 * are not accepted). Failure messages never reveal which part of a token
 * differed.
 */
export function checkAuthoringRequestHeaders(req: IncomingMessage, session: ViewerAuthoringSession): AuthoringCheckResult {
  if (!isExpectedAuthoringHost(req, session)) return { ok: false, status: 403, error: 'authoring request rejected: unexpected Host' };

  const origin = singleHeader(req.headers.origin);
  if (session.expectedOrigin.length === 0 || origin !== session.expectedOrigin) return { ok: false, status: 403, error: 'authoring request rejected: unexpected or missing Origin' };

  if (!tokensMatch(singleHeader(req.headers[VIEWER_AUTHORING_TOKEN_HEADER]), session.token)) {
    return { ok: false, status: 403, error: 'authoring request rejected: missing or invalid authoring session token' };
  }

  if (!isAcceptedJsonContentType(singleHeader(req.headers['content-type']))) {
    return { ok: false, status: 415, error: 'authoring request body must be application/json' };
  }

  const encoding = singleHeader(req.headers['content-encoding']);
  if (req.headers['content-encoding'] !== undefined && (encoding === undefined || encoding.trim().toLowerCase() !== 'identity')) {
    return { ok: false, status: 415, error: 'compressed authoring request bodies are not supported' };
  }

  return { ok: true };
}

export type ReadAuthoringBodyResult = { ok: true; body: Buffer } | { ok: false; status: 400 | 413; error: string };

/**
 * Collects at most `maxBytes` of raw request body. A declared Content-Length
 * above the limit is refused before any body byte is read. An undeclared
 * body that grows past the limit stops being collected immediately.
 */
export function readBoundedAuthoringBody(req: IncomingMessage, maxBytes: number = MAX_ANNOTATION_AUTHORING_BODY_BYTES): Promise<ReadAuthoringBodyResult> {
  const declared = singleHeader(req.headers['content-length']);
  if (declared !== undefined) {
    const declaredLength = Number(declared);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) return Promise.resolve({ ok: false, status: 400, error: 'invalid Content-Length' });
    if (declaredLength > maxBytes) return Promise.resolve({ ok: false, status: 413, error: `authoring request body exceeds ${maxBytes} bytes` });
  }

  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const settle = (result: ReadAuthoringBodyResult): void => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      resolvePromise(result);
    };
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > maxBytes) {
        chunks.length = 0;
        settle({ ok: false, status: 413, error: `authoring request body exceeds ${maxBytes} bytes` });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => settle({ ok: true, body: Buffer.concat(chunks) });
    const onError = (): void => settle({ ok: false, status: 400, error: 'authoring request body could not be read' });
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}
