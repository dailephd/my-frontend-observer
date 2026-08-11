import type { NormalizedObservationRequest } from '../request/request.js';
import { captureViewport } from '../browser/chromiumAdapter.js';
import type { BrowserCaptureResult } from '../browser/types.js';

export type { BrowserCaptureResult, BrowserProvenance } from '../browser/types.js';

/**
 * Minimum application-facing seam over the browser adapter: takes an
 * already-validated request and returns the observer-owned browser-boundary
 * result. Coordinates nothing beyond that single invocation - no page/target
 * evidence, no artifact writing, no CLI reporting. Later batches extend this
 * seam rather than calling the browser adapter directly.
 */
export async function runBrowserCapture(request: NormalizedObservationRequest): Promise<BrowserCaptureResult> {
  return captureViewport(request);
}
