import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { createViewerServer } from './httpServer.js';
import { DEFAULT_VIEWER_PORT, VIEWER_HOST, isValidViewerPort } from './port.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';

function diagnostic(code: 'viewer-root-invalid' | 'viewer-port-unavailable', message: string): Diagnostic {
  return { code, severity: DIAGNOSTIC_SEVERITY[code], message };
}

/**
 * Absolute path to the built browser viewer assets shipped inside this
 * package's own `dist/viewer` directory, resolved relative to this module's
 * own compiled location (never the caller's current working directory), so
 * it works identically whether invoked from the repo, an installed global
 * package, or a packed npm tarball.
 */
export function defaultViewerAssetsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'viewer');
}

export interface StartViewerOptions {
  /** Explicit local evidence-root filesystem trust boundary. Validated operationally (exists, is a directory) - never interpreted as Observer evidence in Batch 1. */
  root: string;
  /** Defaults to {@link DEFAULT_VIEWER_PORT}. An explicit alternate port (including 0, for deterministic ephemeral test binding) is a different web origin than the default. */
  port?: number;
  /** Overrides the built viewer assets location. Defaults to {@link defaultViewerAssetsRoot}. Exposed only for tests exercising the static-serving boundary against fixture assets. */
  assetsRoot?: string;
}

export type StartViewerResult =
  | {
      ok: true;
      url: string;
      port: number;
      host: string;
      root: string;
      /** Closes the underlying TCP listener. Safe to call once; awaits full shutdown. */
      close: () => Promise<void>;
    }
  | { ok: false; diagnostics: Diagnostic[] };

/**
 * The one application-level viewer use case for v0.8 Batch 1: validate the
 * supplied evidence root and port, then start the loopback-only Node viewer
 * server. Does not block - returns once the server is listening (or has
 * failed to start), leaving lifecycle control (in particular, shutdown) to
 * the caller. Never launches a browser, runs observation, or touches
 * Observer artifacts.
 */
export async function startViewer(options: StartViewerOptions): Promise<StartViewerResult> {
  const diagnostics: Diagnostic[] = [];

  let rootInfo;
  try {
    rootInfo = await stat(options.root);
  } catch {
    diagnostics.push(diagnostic('viewer-root-invalid', `--root does not exist or is not accessible: ${options.root}`));
    return { ok: false, diagnostics };
  }
  if (!rootInfo.isDirectory()) {
    diagnostics.push(diagnostic('viewer-root-invalid', `--root must be a directory: ${options.root}`));
    return { ok: false, diagnostics };
  }

  const requestedPort = options.port ?? DEFAULT_VIEWER_PORT;
  if (!isValidViewerPort(requestedPort)) {
    diagnostics.push(diagnostic('viewer-port-unavailable', `--port must be an integer between 0 and 65535; got ${requestedPort}`));
    return { ok: false, diagnostics };
  }

  const assetsRoot = options.assetsRoot ?? defaultViewerAssetsRoot();
  const server: Server = createViewerServer({ assetsRoot, state: { root: options.root } });

  const listenResult = await new Promise<{ ok: true } | { ok: false; message: string }>((resolvePromise) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('listening', onListening);
      resolvePromise({ ok: false, message: err.code === 'EADDRINUSE' ? `port ${requestedPort} is already in use` : (err.message ?? String(err)) });
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolvePromise({ ok: true });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(requestedPort, VIEWER_HOST);
  });

  if (!listenResult.ok) {
    diagnostics.push(
      diagnostic(
        'viewer-port-unavailable',
        `could not bind the viewer server to ${VIEWER_HOST}:${requestedPort}: ${listenResult.message}. Pass an explicit --port to use a different origin; the default port is never silently substituted.`,
      ),
    );
    return { ok: false, diagnostics };
  }

  const address = server.address();
  const actualPort = address !== null && typeof address === 'object' ? address.port : requestedPort;

  return {
    ok: true,
    url: `http://${VIEWER_HOST}:${actualPort}`,
    port: actualPort,
    host: VIEWER_HOST,
    root: options.root,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((err) => (err ? reject(err) : resolvePromise()));
      }),
  };
}
