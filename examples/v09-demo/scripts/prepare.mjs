#!/usr/bin/env node
// Materializes the tracked my-frontend-observer v0.9 demo template into a
// caller-provided disposable target root.
//
//   tracked demo source  ->  copy/materialize  ->  disposable targetRoot
//
// The tracked template under `examples/v09-demo/` is immutable: this script
// only ever reads from it. Reset semantics are "rematerialize targetRoot" -
// the selected target root is destroyed and recreated, which is why every
// containment and safety check below runs *before* anything is removed.
//
// Usage: node examples/v09-demo/scripts/prepare.mjs <targetRoot>

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/** `examples/v09-demo` - the immutable tracked template. */
export const DEMO_SOURCE_ROOT = path.resolve(scriptDir, '..');

/** The repository root that owns the template. */
export const REPO_ROOT = path.resolve(DEMO_SOURCE_ROOT, '..', '..');

/** Exactly what a materialized target root contains, in copy order. */
export const MATERIALIZED_ENTRIES = [
  { from: path.join(DEMO_SOURCE_ROOT, 'app'), to: 'app' },
  { from: path.join(scriptDir, 'server.mjs'), to: 'server.mjs' },
];

export class PrepareDemoError extends Error {}

function isSameOrInside(candidate, ancestor) {
  const resolvedAncestor = path.resolve(ancestor);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedAncestor) return true;
  const withSep = resolvedAncestor.endsWith(path.sep) ? resolvedAncestor : resolvedAncestor + path.sep;
  return resolvedCandidate.startsWith(withSep);
}

/**
 * Validates a caller-selected target root before any destructive reset.
 *
 * Fails closed on: a missing/empty argument, a filesystem or drive root, a
 * path with fewer than two segments below its root, the user's home
 * directory, the repository root, the immutable demo template (or anything
 * inside it), and any path that would contain the repository or the template
 * (which a reset would therefore destroy).
 */
export function validateTargetRoot(rawTargetRoot) {
  if (typeof rawTargetRoot !== 'string' || rawTargetRoot.trim().length === 0) {
    throw new PrepareDemoError('an explicit target root is required: node prepare.mjs <targetRoot>');
  }
  if (rawTargetRoot.includes('\0')) {
    throw new PrepareDemoError('target root must not contain a null byte');
  }

  const target = path.resolve(rawTargetRoot);
  const { root } = path.parse(target);

  if (target === root || path.dirname(target) === target) {
    throw new PrepareDemoError(`refusing to materialize into a filesystem root: ${target}`);
  }

  const belowRoot = target.slice(root.length).split(path.sep).filter((segment) => segment.length > 0);
  if (belowRoot.length < 2) {
    throw new PrepareDemoError(`refusing to materialize into a root-like target: ${target}`);
  }

  if (target === path.resolve(homedir())) {
    throw new PrepareDemoError(`refusing to materialize into the home directory: ${target}`);
  }
  if (target === REPO_ROOT) {
    throw new PrepareDemoError(`refusing to materialize into the repository root: ${target}`);
  }
  if (isSameOrInside(target, DEMO_SOURCE_ROOT)) {
    throw new PrepareDemoError(`refusing to materialize into the immutable demo template: ${target}`);
  }
  if (isSameOrInside(REPO_ROOT, target)) {
    throw new PrepareDemoError(`refusing to materialize into a directory that contains the repository: ${target}`);
  }

  return target;
}

/**
 * Destroys and recreates `targetRoot`, then copies exactly the demo files a
 * target needs in order to serve the application on its own. Nothing is
 * written anywhere else, and nothing is ever written back into the template.
 */
export async function prepareDemoTarget(rawTargetRoot) {
  const target = validateTargetRoot(rawTargetRoot);

  const sourceState = await stat(DEMO_SOURCE_ROOT).catch(() => undefined);
  if (sourceState === undefined || !sourceState.isDirectory()) {
    throw new PrepareDemoError(`demo template is missing: ${DEMO_SOURCE_ROOT}`);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const written = [];
  for (const entry of MATERIALIZED_ENTRIES) {
    const destination = path.join(target, entry.to);
    await cp(entry.from, destination, { recursive: true, errorOnExist: false, force: true });
    written.push(destination);
  }

  return { targetRoot: target, sourceRoot: DEMO_SOURCE_ROOT, written };
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const [rawTargetRoot, ...rest] = process.argv.slice(2);
  if (rest.length > 0) {
    console.error(`prepare demo: unexpected extra arguments: ${rest.join(' ')}`);
    console.error('usage: node examples/v09-demo/scripts/prepare.mjs <targetRoot>');
    process.exitCode = 1;
  } else {
    try {
      const result = await prepareDemoTarget(rawTargetRoot);
      console.log(`demo materialized into ${result.targetRoot}`);
      for (const entry of result.written) console.log(`  ${entry}`);
      console.log(`start it with: node ${path.join(result.targetRoot, 'server.mjs')} --port <1-65535>`);
    } catch (error) {
      console.error(`prepare demo: ${error instanceof Error ? error.message : String(error)}`);
      console.error('usage: node examples/v09-demo/scripts/prepare.mjs <targetRoot>');
      process.exitCode = 1;
    }
  }
}
