import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { MAX_DIRECTORIES_VISITED, MAX_DISCOVERY_DEPTH, MAX_MANIFEST_CANDIDATES } from './limits.js';

export interface DiscoveredManifest {
  /** Absolute path to the candidate `manifest.json` file. */
  absolutePath: string;
  /** Absolute path to its containing directory (the artifact's own root). */
  absoluteDir: string;
  /** Root-relative, forward-slash-normalized directory path - display/handle material only, never trusted for filesystem access without re-resolution+containment-check. */
  relativeDir: string;
}

export interface DiscoveryResult {
  manifests: DiscoveredManifest[];
  /** True if MAX_MANIFEST_CANDIDATES, MAX_DIRECTORIES_VISITED, or MAX_DISCOVERY_DEPTH was hit before the walk completed naturally. */
  truncated: boolean;
}

function toPosixRelative(root: string, absoluteDir: string): string {
  const rel = relative(root, absoluteDir);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

/**
 * Bounded, deterministic, symlink-safe walk beneath `root` looking only for
 * files literally named `manifest.json` (the one filename every current
 * persisted artifact family uses - see src/artifacts/*Writer.ts). No other
 * filename is ever opened or classified, so arbitrary files
 * (`package.json`, `.env`, source files, unrelated JSON) can never become
 * evidence merely by existing under the root.
 *
 * Security properties:
 * - directory entries that are symbolic links or reparse points/junctions
 *   (`dirent.isSymbolicLink()`) are never followed, so discovery can never
 *   leave the resolved root via a symlink;
 * - traversal depth, directories visited, and candidate manifests found are
 *   all independently bounded (see limits.ts) - discovery always terminates
 *   and never depends on filesystem enumeration order for its *result set*
 *   (see the caller-side deterministic sort in index.ts).
 */
export async function discoverManifests(root: string): Promise<DiscoveryResult> {
  const manifests: DiscoveredManifest[] = [];
  let directoriesVisited = 0;
  let truncated = false;

  async function walk(dir: string, depth: number): Promise<void> {
    if (truncated) return;
    if (depth > MAX_DISCOVERY_DEPTH) {
      truncated = true;
      return;
    }
    if (directoriesVisited >= MAX_DIRECTORIES_VISITED) {
      truncated = true;
      return;
    }
    directoriesVisited += 1;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory (permissions, race with external deletion): skip silently, not a discovery failure.
      return;
    }

    // Deterministic child ordering regardless of filesystem enumeration order.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue; // never follow symlinks/junctions/reparse points, for files or directories

      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), depth + 1);
        continue;
      }

      if (entry.isFile() && entry.name === 'manifest.json') {
        if (manifests.length >= MAX_MANIFEST_CANDIDATES) {
          truncated = true;
          return;
        }
        manifests.push({
          absolutePath: join(dir, entry.name),
          absoluteDir: dir,
          relativeDir: toPosixRelative(root, dir),
        });
      }
    }
  }

  await walk(root, 0);

  // Final deterministic ordering of the result set itself, independent of traversal order.
  manifests.sort((a, b) => (a.relativeDir < b.relativeDir ? -1 : a.relativeDir > b.relativeDir ? 1 : 0));

  return { manifests, truncated };
}
