/**
 * v0.8 Batch 1: fixed default loopback origin for the local viewer server, so
 * an installed PWA has a stable identity across launches. No fixture or test
 * in this repository binds a fixed TCP port (see tests/fixtures/server.ts,
 * which always requests port 0 / OS-assigned), so 4319 was chosen as an
 * uncommon, unreserved default that does not collide with common local dev
 * ports (3000, 5173/4173 Vite, 8080, 8000) or any port referenced elsewhere
 * in this repository.
 */
export const DEFAULT_VIEWER_PORT = 4319;

/** The viewer server binds only to loopback - never 0.0.0.0 or any other host. */
export const VIEWER_HOST = '127.0.0.1';

export const VIEWER_PORT_MIN = 1;
export const VIEWER_PORT_MAX = 65535;

/** Strict validation for an explicit --port value: an integer in the valid TCP port range (0 is allowed only for deterministic test use - the OS assigns an ephemeral port). */
export function isValidViewerPort(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= VIEWER_PORT_MAX;
}
