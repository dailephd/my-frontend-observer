import type { Diagnostic } from '../domain/diagnostics.js';

/**
 * Observer-owned result of persisting one ObservationArtifact. `artifactRoot`
 * and the file paths are absolute filesystem paths for the *caller's* local
 * use only (e.g. to print or open the result); they are never written back
 * into the persisted manifest itself, which stores only portable relative
 * references.
 */
export type PersistedObservationResult =
  | {
      ok: true;
      artifactRoot: string;
      manifestPath: string;
      screenshotPath: string;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };
