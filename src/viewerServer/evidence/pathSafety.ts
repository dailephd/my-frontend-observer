import { resolve, sep } from 'node:path';

/**
 * Resolves a root-relative directory string (from a decoded viewer handle,
 * never trusted on its own) against the evidence root, and verifies the
 * result is actually contained within that root. Returns `undefined` on any
 * traversal/escape attempt (`..` segments, an absolute-looking segment that
 * resolves outside root, etc.) - callers must treat that as "unknown
 * handle", never attempt a fallback resolution.
 */
export function resolveContainedDir(root: string, relativeDir: string): string | undefined {
  if (relativeDir.includes('\0')) return undefined;
  // `root` (e.g. a CLI --root argument) may use forward slashes even on win32; resolve it the same way `candidate`
  // is resolved before comparing, or a purely textual prefix mismatch (backslash-normalized candidate vs. an
  // un-normalized root string) would reject every legitimate path.
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, relativeDir);
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (candidate !== resolvedRoot && !candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

/** Same containment check for a bare filename resolved against an already-contained artifact directory (e.g. a screenshot/image sibling file). Rejects any filename containing a path separator outright - every current media reference is a bare filename by contract (see externalReference.ts's `path` field validation). */
export function resolveContainedFile(containedDir: string, bareFilename: string): string | undefined {
  if (bareFilename.length === 0 || bareFilename.includes('/') || bareFilename.includes('\\') || bareFilename.includes('\0')) return undefined;
  if (bareFilename === '.' || bareFilename === '..') return undefined;
  return resolve(containedDir, bareFilename);
}
