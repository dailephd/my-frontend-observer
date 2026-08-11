import { mkdir, writeFile, rename, rm, access } from 'node:fs/promises';
import path from 'node:path';
import type { ObservationArtifact } from '../domain/schema.js';
import { isValidObservationArtifact } from '../domain/schema.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import type { PersistedObservationResult } from './types.js';

export const MANIFEST_FILENAME = 'manifest.json';
export const SCREENSHOT_FILENAME = 'screenshot.png';

function writeFailure(message: string, details?: Record<string, unknown>): PersistedObservationResult {
  const diagnostic: Diagnostic = {
    code: 'artifact-write-failure',
    severity: DIAGNOSTIC_SEVERITY['artifact-write-failure'],
    message,
    ...(details === undefined ? {} : { details }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}

async function pathExists(candidate: string): Promise<boolean> {
  return access(candidate).then(
    () => true,
    () => false,
  );
}

export interface WriteObservationArtifactOptions {
  /** Base directory that `artifact.requestConfig.outputLocation` is resolved against. Defaults to `process.cwd()`. */
  cwd?: string;
}

/**
 * Persists one already-assembled, already-validated ObservationArtifact plus
 * its screenshot bytes as one portable artifact directory:
 * `<outputLocation>/<observationId>/{manifest.json,screenshot.png}`.
 *
 * `observationId` is guaranteed fresh per capture (see
 * domain/identity.ts#buildObservationIdentity's "never collides" contract),
 * so each write targets its own unique subdirectory - no destructive
 * overwrite decision is needed for the normal case; an existing directory at
 * that path is treated as a genuine collision and rejected rather than
 * overwritten. Writing happens in a sibling temporary directory first,
 * `screenshot.png` before `manifest.json` (manifest-last), and the whole
 * temporary directory is only exposed under its real name via one atomic
 * rename - a consumer can never observe a partially-written artifact under
 * its final name.
 */
export async function writeObservationArtifact(
  artifact: ObservationArtifact,
  screenshotBytes: Uint8Array,
  options: WriteObservationArtifactOptions = {},
): Promise<PersistedObservationResult> {
  const validation = isValidObservationArtifact(artifact);
  if (!validation.valid) {
    return writeFailure(`refusing to persist an invalid ObservationArtifact: ${validation.reason}`);
  }

  const cwd = options.cwd ?? process.cwd();
  const outputRoot = path.resolve(cwd, artifact.requestConfig.outputLocation);
  const finalRoot = path.join(outputRoot, artifact.observationId);
  const tempRoot = path.join(outputRoot, `.tmp-${artifact.observationId}`);

  if (await pathExists(finalRoot)) {
    return writeFailure(`an observation artifact already exists at "${artifact.observationId}"; refusing to overwrite it`, {
      artifactRoot: finalRoot,
    });
  }

  try {
    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(tempRoot, { recursive: true });

    await writeFile(path.join(tempRoot, SCREENSHOT_FILENAME), screenshotBytes);
    await writeFile(path.join(tempRoot, MANIFEST_FILENAME), JSON.stringify(artifact, null, 2), 'utf8');

    await rename(tempRoot, finalRoot);

    return {
      ok: true,
      artifactRoot: finalRoot,
      manifestPath: path.join(finalRoot, MANIFEST_FILENAME),
      screenshotPath: path.join(finalRoot, SCREENSHOT_FILENAME),
    };
  } catch (err) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return writeFailure(`failed to persist observation artifact: ${message}`);
  }
}
