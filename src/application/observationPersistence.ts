import type { NormalizedObservationRequest } from '../request/request.js';
import type { BrowserCaptureResult } from '../browser/types.js';
import { runBrowserCapture } from './browserCaptureService.js';
import type { ObservationArtifact } from '../domain/schema.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, getProducerInfo } from '../domain/schema.js';
import { buildRequestIdentity, buildObservationIdentity } from '../domain/identity.js';
import { deriveCompletion } from '../domain/completion.js';
import type { CompletionState } from '../domain/completion.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import { writeObservationArtifact, SCREENSHOT_FILENAME } from '../artifacts/artifactWriter.js';
import type { PersistedObservationResult } from '../artifacts/types.js';
import type { WriteObservationArtifactOptions } from '../artifacts/artifactWriter.js';

export type { PersistedObservationResult } from '../artifacts/types.js';

/**
 * Assembles the frozen ObservationArtifact shape from one already-successful
 * Batch 2/3 browser capture. Pure - no filesystem access, no Playwright
 * dependency - so it is testable independently of both Chromium and disk
 * I/O. `requestId`/`observationId` reuse the existing Batch 1 identity
 * functions verbatim; `completion` reuses the existing Batch 1
 * post-capture completion rule over the capture's own diagnostics.
 */
export function buildObservationArtifact(
  capture: Extract<BrowserCaptureResult, { ok: true }>,
  request: NormalizedObservationRequest,
): ObservationArtifact {
  const requestId = buildRequestIdentity(request);
  const observationId = buildObservationIdentity(requestId);
  const completion = deriveCompletion(capture.diagnostics, 'post-capture');

  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId,
    requestId,
    producer: getProducerInfo(),
    browser: { state: 'available', source: 'browser', value: capture.provenance },
    requestConfig: request,
    provenance: { capturedAt: new Date().toISOString(), observationMethod: 'chromium-navigate-and-capture' },
    pageEvidence: capture.pageEvidence,
    targetEvidence: capture.targetEvidence,
    ...(capture.scrollScenarioEvidence ? { scrollScenarioEvidence: capture.scrollScenarioEvidence } : {}),
    screenshot: { state: 'available', source: 'browser', value: { path: SCREENSHOT_FILENAME } },
    completion,
    diagnostics: capture.diagnostics,
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [{ path: SCREENSHOT_FILENAME, kind: 'screenshot' }],
  };
}

/**
 * Minimum application-facing persistence seam for Batch 5: combines an
 * existing successful browser capture with the artifact writer. Not wired to
 * the CLI in this batch.
 */
export async function persistBrowserCapture(
  capture: Extract<BrowserCaptureResult, { ok: true }>,
  request: NormalizedObservationRequest,
  options: WriteObservationArtifactOptions = {},
): Promise<PersistedObservationResult> {
  const artifact = buildObservationArtifact(capture, request);
  return writeObservationArtifact(artifact, capture.screenshot, options);
}

/**
 * Observer-owned summary of one full observation attempt, with just enough
 * information for a presentation layer (the Batch 5 CLI) to report a result
 * without ever seeing a Playwright object, a raw Node filesystem exception,
 * or persistence implementation detail.
 */
export type ApplicationObservationResult =
  | {
      ok: true;
      observationId: string;
      requestId: string;
      completion: CompletionState;
      artifactRoot: string;
      manifestPath: string;
      screenshotPath: string;
      targetCount: number;
      diagnostics: Diagnostic[];
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };

/**
 * The one canonical application-level observation use case: takes an
 * already-normalized request, runs the existing browser capture exactly
 * once, and - only for a successful capture - persists it exactly once
 * through the existing artifact writer. Reuses `runBrowserCapture`,
 * `buildObservationArtifact`, and `writeObservationArtifact` verbatim; it
 * does not go through `persistBrowserCapture` because that helper re-derives
 * a fresh `ObservationArtifact` (and therefore a fresh, different
 * `observationId`) internally, which would desync the identity a caller
 * inspects here from the identity actually written to disk.
 */
export async function observe(
  request: NormalizedObservationRequest,
  options: WriteObservationArtifactOptions = {},
): Promise<ApplicationObservationResult> {
  const capture = await runBrowserCapture(request);
  if (!capture.ok) {
    return { ok: false, diagnostics: capture.diagnostics };
  }

  const artifact = buildObservationArtifact(capture, request);
  const persisted = await writeObservationArtifact(artifact, capture.screenshot, options);
  if (!persisted.ok) {
    return { ok: false, diagnostics: persisted.diagnostics };
  }

  return {
    ok: true,
    observationId: artifact.observationId,
    requestId: artifact.requestId,
    completion: artifact.completion,
    artifactRoot: persisted.artifactRoot,
    manifestPath: persisted.manifestPath,
    screenshotPath: persisted.screenshotPath,
    targetCount: Object.keys(artifact.targetEvidence).length,
    diagnostics: artifact.diagnostics,
  };
}
