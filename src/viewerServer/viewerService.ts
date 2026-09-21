import { realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { createViewerServer } from './httpServer.js';
import { DEFAULT_VIEWER_PORT, VIEWER_HOST, isValidViewerPort } from './port.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import type { ContextSessionState } from './context.js';
import { createViewerAuthoringToken } from './authoringSecurity.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';
import { loadProjectViewerState } from '../application/projectWorkflowService.js';

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
  /**
   * v0.8 Batch 6: explicit, session-only reference-region/runtime-target
   * binding declarations, read once by the CLI at startup from an optional
   * `--bindings-file` (never re-read, never persisted, never exposed as a
   * path to the browser). Not yet validated against any specific reference
   * here - that happens per-request, once a reference is actually selected,
   * via the existing canonical `isValidReferenceRuntimeBindingDeclarations`.
   * Defaults to an empty collection.
   */
  bindingDeclarations?: readonly unknown[];
  /**
   * v0.8 Batch 7: the already-classified bounded-agent-context session
   * state, read once by the CLI at startup from an optional
   * `--context-file` (never re-read, never persisted, never exposed as a
   * path to the browser, never derived by the viewer itself). Defaults to
   * `{status:'none'}`.
   */
  context?: ContextSessionState;
  /** Ephemeral project-workflow display metadata keyed by exact POSIX evidence-relative directory. */
  aliasMetadata?: ViewerAliasMetadata;
  /**
   * v0.9 Batch 2: the initialized project root for a project-aware viewer.
   * When absent the viewer is strictly read-only. When present, the project
   * configuration and managed state must load normally and `root` must be
   * exactly that project's managed evidence root, or the viewer does not
   * start. Authoring is never inferred from `root` alone.
   */
  authoringProjectRoot?: string;
}

export interface ViewerAliasMetadata {
  observationAliasesByRelativeDir: Readonly<Record<string, string>>;
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

  let authoring: ViewerAuthoringSession | undefined;
  if (options.authoringProjectRoot !== undefined) {
    const projectState = await loadProjectViewerState(options.authoringProjectRoot);
    if (!projectState.ok) {
      diagnostics.push(diagnostic('viewer-root-invalid', `annotation authoring requires a valid initialized project (${projectState.code}): ${projectState.message}`));
      return { ok: false, diagnostics };
    }
    if (!(await isSameDirectory(options.root, projectState.root))) {
      diagnostics.push(diagnostic('viewer-root-invalid', 'annotation authoring requires the viewer root to be exactly the project\'s managed evidence root'));
      return { ok: false, diagnostics };
    }
    // expectedHost/expectedOrigin are filled in once the listener has its actual port; until then they match nothing.
    authoring = { projectRoot: projectState.projectRoot, token: createViewerAuthoringToken(), expectedHost: '', expectedOrigin: '' };
  }

  const assetsRoot = options.assetsRoot ?? defaultViewerAssetsRoot();
  const server: Server = createViewerServer({
    assetsRoot,
    state: {
      root: options.root,
      bindingDeclarations: options.bindingDeclarations ?? [],
      context: options.context ?? { status: 'none' },
      aliasMetadata: options.aliasMetadata ?? { observationAliasesByRelativeDir: {} },
      ...(authoring === undefined ? {} : { authoring }),
    },
  });

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
  if (authoring !== undefined) {
    authoring.expectedHost = `${VIEWER_HOST}:${actualPort}`;
    authoring.expectedOrigin = `http://${VIEWER_HOST}:${actualPort}`;
  }

  return {
    ok: true,
    url: `http://${VIEWER_HOST}:${actualPort}`,
    port: actualPort,
    host: VIEWER_HOST,
    root: options.root,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((err) => (err ? reject(err) : resolvePromise()));
        // `server.close()` only stops new connections and waits for existing
        // ones. A browser or service worker holding a connection open would
        // otherwise stall shutdown for as long as it kept that connection.
        server.closeAllConnections();
      }),
  };
}

/** Resolved-path equality, falling back to real-path equality (drive-letter casing, symlinked parents). */
async function isSameDirectory(a: string, b: string): Promise<boolean> {
  if (resolve(a) === resolve(b)) return true;
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return false;
  }
}
