import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NormalizedObservationRequest } from '../../src/request/request.js';
import { runBrowserCapture } from '../../src/application/browserCaptureService.js';
import { buildObservationArtifact } from '../../src/application/observationPersistence.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import { EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import type { ApprovedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import { CONTRACT_ARTIFACT_KIND, CONTRACT_SCHEMA_VERSION } from '../../src/domain/frontendContracts.js';
import type { PersistentBaselineContract, PerChangeContract } from '../../src/domain/frontendContracts.js';
import { prepareReferenceCorrection, reviewReferenceCorrectionAttempt } from '../../src/domain/referenceCorrectionWorkflow.js';
import type { ReferenceCorrectionAttemptResult } from '../../src/domain/referenceCorrectionWorkflow.js';

/**
 * v0.7 Prompt 8 real-Chromium end-to-end proof. Everything under this
 * directory - the disposable target copy, the loopback file server, and
 * the "controlled external actor" edit function - is TEST HARNESS code:
 * none of it ships in `dist/`, none of it is imported by `src/cli.ts` or
 * any other observer production module. This is the deliberate proof that
 * observer product code never edits target source: only this test-only
 * `applyControlledExternalEdit` function ever writes to the disposable
 * target file, and it lives entirely outside `src/`.
 */

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TEMPLATE_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'referenceCorrectionTarget.template.html');
const DISPOSABLE_ROOT = path.join(REPO_ROOT, '.my-dev-kit-workflow', 'prompt8-disposable-target');

type ControlledEdit = 'fix-width' | 'fix-width-break-protected';

/**
 * The controlled external implementation actor for this proof. It reads
 * the disposable copy (never the tracked template), applies a deterministic
 * text edit (never a DOM/CSS parse - the smallest possible "source edit"
 * simulation), and writes the result back to the *same disposable path* -
 * exactly mirroring how a real external coding agent would edit a real
 * source file on disk. my-frontend-observer's own production code never
 * calls this function or anything like it.
 */
async function applyControlledExternalEdit(disposablePath: string, edit: ControlledEdit): Promise<void> {
  let html = await readFile(disposablePath, 'utf8');
  html = html.replace('/*POPUP_WIDTH_PX*/223px', '/*POPUP_WIDTH_PX*/212px');
  if (edit === 'fix-width-break-protected') {
    html = html.replace('/*DESTINATION_DISPLAY*/block', '/*DESTINATION_DISPLAY*/none');
  }
  await writeFile(disposablePath, html, 'utf8');
}

async function createDisposableTarget(): Promise<{ dir: string; filePath: string }> {
  const dir = path.join(DISPOSABLE_ROOT, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'index.html');
  await copyFile(TEMPLATE_PATH, filePath);
  return { dir, filePath };
}

/** Reads the disposable file fresh on every request - no restart is ever needed to observe an edit, matching this prompt's "prefer reload without restart" guidance. */
async function startDisposableTargetServer(filePath: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    readFile(filePath, 'utf8')
      .then((html) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html);
      })
      .catch(() => {
        res.writeHead(500);
        res.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('disposable target server failed to bind a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

const VIEWPORT = { width: 480, height: 620 };

function baseRequest(overrides: Partial<NormalizedObservationRequest> = {}): NormalizedObservationRequest {
  return {
    targetUrl: '',
    viewport: VIEWPORT,
    targets: [
      { name: 'popup-current-page', locators: [{ kind: 'css', selector: '#popup-current-page' }] },
      { name: 'destination-control', locators: [{ kind: 'css', selector: '#destination-control' }] },
    ],
    outputLocation: 'observations',
    timeoutMs: 30000,
    readiness: { condition: 'load', timeoutMs: 10000 },
    ...overrides,
  };
}

async function captureRealObservation(targetUrl: string): Promise<ObservationArtifact> {
  const request = baseRequest({ targetUrl });
  const capture = await runBrowserCapture(request);
  if (!capture.ok) throw new Error(`expected a successful real-Chromium capture, got diagnostics: ${JSON.stringify(capture.diagnostics)}`);
  return buildObservationArtifact(capture, request);
}

/** The approved external reference: a 960x1240 design representing a 480x620 CSS-pixel viewport, selecting the popup-current-page width (424 reference px, +-4 tolerance) as a requested requirement and destination-control visibility as a protected v0.5 baseline invariant (declared separately, on the baseline contract). */
function approvedReference(): ApprovedExternalReferenceArtifact {
  const image = { path: 'reference.png', format: 'png' as const, width: 960, height: 1240, byteLength: 41, sha256: 'a'.repeat(64) };
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: 'ref-req-e2e-1',
    referenceId: 'ref-req-e2e-1-instance-2',
    producer: { name: 'my-frontend-observer', version: '0.7.0' },
    provenance: { importedAt: '2026-01-01T00:00:00.000Z' },
    sourceReference: {
      referenceId: 'ref-req-e2e-1-instance-1',
      referenceRequestId: 'ref-req-e2e-1',
      producer: { name: 'my-frontend-observer', version: '0.7.0' },
      schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
      image,
    },
    lifecycle: { state: 'approved', approvedAt: '2026-01-02T00:00:00.000Z' },
    diagnostics: [],
    completion: { state: 'complete' },
    regions: [{ id: 'current-page-card', rectangle: { x: 0, y: 0, width: 424, height: 100 } }],
    requirements: [
      {
        requirementId: 'req-current-page-card-width',
        category: 'requested',
        subject: { kind: 'region-property', region: 'current-page-card', property: 'width' },
        tolerance: { kind: 'absolute-reference-px', amount: 4 },
      },
    ],
    applicability: { viewport: { width: 480, height: 620 } },
  };
}

function baselineContract(sourceObservationId: string): PersistentBaselineContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'baseline',
    baselineId: 'baseline-e2e-1',
    sourceObservation: { observationId: sourceObservationId, requestId: 'req-e2e-1', producer: { name: 'my-frontend-observer', version: '0.7.0' }, observationSchemaVersion: '1.2.0' },
    clauses: [{ clauseId: 'destination-control-visible', primitive: { kind: 'target-visible', target: 'destination-control' }, supportingEvidence: [] }],
    provenance: { approvedAt: '2026-08-20T00:00:00.000Z' },
  };
}

function changeContract(): PerChangeContract {
  return {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'change',
    contractId: 'change-e2e-1',
    contractRequestId: 'change-request-e2e-1',
    activeBaselineIds: ['baseline-e2e-1'],
    clauses: [
      {
        clauseId: 'popup-current-page-width-decreases',
        primitive: { kind: 'property-decreases', target: 'popup-current-page', property: 'width' },
        category: 'expected-dependent',
        expectedDependentMode: 'permitted',
        supportingEvidence: [],
      },
    ],
  };
}

describe('v0.7 Prompt 8 real-Chromium reference correction workflow', () => {
  const activeDirs: string[] = [];
  const activeServers: { close: () => Promise<void> }[] = [];

  afterEach(async () => {
    await Promise.all(activeServers.splice(0).map((s) => s.close()));
    await Promise.all(activeDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await rm(DISPOSABLE_ROOT, { recursive: true, force: true }).catch(() => undefined);
  });

  it('Proof A: initial reference mismatch, external correction, fresh Chromium observation, overall PASS - the source edit happens outside observer product code', async () => {
    const templateBefore = await readFile(TEMPLATE_PATH, 'utf8');

    const { dir, filePath } = await createDisposableTarget();
    activeDirs.push(dir);
    const server = await startDisposableTargetServer(filePath);
    activeServers.push(server);

    const reference = approvedReference();
    const baselineObservation = await captureRealObservation(server.baseUrl);
    const baselineC = baselineContract(baselineObservation.observationId);
    const changeC = changeContract();
    const bindings = [{ referenceRegion: 'current-page-card', runtimeTarget: 'popup-current-page' }];

    const prep = prepareReferenceCorrection({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      currentObservation: baselineObservation,
      generatedAt: '2026-08-20T00:00:00.000Z',
      producerVersion: '0.7.0',
      projectionProfile: 'frontend-change-review',
    });
    expect(prep.ok).toBe(true);
    if (!prep.ok) throw new Error('expected ok');
    // Behavior A: the pre-change candidate genuinely fails reference fidelity - this is the real, Chromium-measured design mismatch.
    expect(prep.status).toBe('handoff-ready');
    if (prep.status !== 'handoff-ready') throw new Error('expected handoff-ready');
    const mismatch = prep.handoff.boundedContext.fidelity?.mismatches.find((m) => m.requirementId === 'req-current-page-card-width');
    expect(mismatch).toMatchObject({ status: 'fail', referenceValue: 424 });
    expect(mismatch?.candidateValue).toBeGreaterThan(424 + 4);

    // Section 46: the controlled external actor actually reads/asserts the generated handoff before acting - proving the bounded context genuinely reached the implementation boundary.
    expect(mismatch?.boundRuntimeTargets).toContain('popup-current-page');
    const targetedRequirement = prep.handoff.boundedContext.fidelity?.mismatches.find((m) => m.boundRuntimeTargets.includes('popup-current-page'));
    expect(targetedRequirement).toBeDefined();

    await applyControlledExternalEdit(filePath, 'fix-width');

    const candidateObservation = await captureRealObservation(server.baseUrl);
    const review = reviewReferenceCorrectionAttempt({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      reviewRequestId: prep.reviewRequestId,
      candidateObservation,
    });
    expect(review.ok).toBe(true);
    if (!review.ok) throw new Error('expected ok');
    expect(review.attempt.fidelity.state).toBe('pass');
    expect(review.attempt.contractEvaluation.overallVerdict).toBe('PASS');
    expect(review.attempt.overallState).toBe('pass');
    expect(review.attempt.approvalEligible).toBe(true);

    // The tracked template must remain byte-identical - only the disposable copy was ever edited.
    const templateAfter = await readFile(TEMPLATE_PATH, 'utf8');
    expect(templateAfter).toBe(templateBefore);
  }, 60000);

  it('Proof B: the external actor satisfies the reference but introduces a protected regression - overall FAIL', async () => {
    const { dir, filePath } = await createDisposableTarget();
    activeDirs.push(dir);
    const server = await startDisposableTargetServer(filePath);
    activeServers.push(server);

    const reference = approvedReference();
    const baselineObservation = await captureRealObservation(server.baseUrl);
    const baselineC = baselineContract(baselineObservation.observationId);
    const changeC = changeContract();
    const bindings = [{ referenceRegion: 'current-page-card', runtimeTarget: 'popup-current-page' }];

    const prep = prepareReferenceCorrection({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      currentObservation: baselineObservation,
      generatedAt: '2026-08-20T00:00:00.000Z',
      producerVersion: '0.7.0',
      projectionProfile: 'frontend-change-review',
    });
    if (!prep.ok) throw new Error('expected ok');

    await applyControlledExternalEdit(filePath, 'fix-width-break-protected');

    const candidateObservation = await captureRealObservation(server.baseUrl);
    const review = reviewReferenceCorrectionAttempt({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      reviewRequestId: prep.reviewRequestId,
      candidateObservation,
    });
    expect(review.ok).toBe(true);
    if (!review.ok) throw new Error('expected ok');

    // Reference now matches (real Chromium geometry proves it)...
    expect(review.attempt.fidelity.state).toBe('pass');
    // ...but the real candidate observation shows destination-control is no longer visible - a genuine protected-clause regression.
    const protectedClause = review.attempt.contractEvaluation.clauseResults.find((c) => c.clauseId === 'destination-control-visible');
    expect(protectedClause?.status).toBe('fail');
    expect(review.attempt.contractEvaluation.overallVerdict).toBe('FAIL');
    // Matching the design reference is necessary but not sufficient:
    expect(review.attempt.overallState).toBe('fail');
    expect(review.attempt.approvalEligible).toBe(false);
  }, 60000);

  it('Proof C: correction iteration - attempt 1 remains reference-FAIL, a fresh handoff is derived, attempt 2 passes; both attempts stay traceable and evaluate against the same baseline', async () => {
    const { dir, filePath } = await createDisposableTarget();
    activeDirs.push(dir);
    const server = await startDisposableTargetServer(filePath);
    activeServers.push(server);

    const reference = approvedReference();
    const baselineObservation = await captureRealObservation(server.baseUrl);
    const baselineC = baselineContract(baselineObservation.observationId);
    const changeC = changeContract();
    const bindings = [{ referenceRegion: 'current-page-card', runtimeTarget: 'popup-current-page' }];

    const prep = prepareReferenceCorrection({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      currentObservation: baselineObservation,
      generatedAt: '2026-08-20T00:00:00.000Z',
      producerVersion: '0.7.0',
      projectionProfile: 'frontend-change-review',
    });
    if (!prep.ok) throw new Error('expected ok');

    // Attempt 1: no correction applied yet - candidate is identical to the unedited baseline, so reference fidelity still fails.
    const attempt1Candidate = await captureRealObservation(server.baseUrl);
    const attempt1 = reviewReferenceCorrectionAttempt({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      reviewRequestId: prep.reviewRequestId,
      candidateObservation: attempt1Candidate,
    });
    if (!attempt1.ok) throw new Error('expected ok');
    expect(attempt1.attempt.fidelity.state).toBe('fail');
    expect(attempt1.attempt.overallState).toBe('fail');

    // Fresh bounded correction context is derived from the failed attempt 1 candidate, not stale attempt-0 evidence.
    const correctionPrep = prepareReferenceCorrection({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      currentObservation: attempt1Candidate,
      generatedAt: '2026-08-20T00:05:00.000Z',
      producerVersion: '0.7.0',
      projectionProfile: 'frontend-change-review',
    });
    if (!correctionPrep.ok) throw new Error('expected ok');
    expect(correctionPrep.status).toBe('handoff-ready');
    if (correctionPrep.status !== 'handoff-ready') throw new Error('expected handoff-ready');
    expect(correctionPrep.handoff.currentObservationId).toBe(attempt1Candidate.observationId);
    expect(correctionPrep.handoff.currentObservationId).not.toBe(baselineObservation.observationId);

    // External actor applies the correction.
    await applyControlledExternalEdit(filePath, 'fix-width');
    const attempt2Candidate = await captureRealObservation(server.baseUrl);
    const attempt2 = reviewReferenceCorrectionAttempt({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      reviewRequestId: prep.reviewRequestId,
      priorAttemptId: attempt1.attempt.attemptId,
      candidateObservation: attempt2Candidate,
    });
    if (!attempt2.ok) throw new Error('expected ok');
    expect(attempt2.attempt.fidelity.state).toBe('pass');
    expect(attempt2.attempt.overallState).toBe('pass');

    // Both attempts share the same review and the same approved baseline; attempt 1 is not overwritten and remains distinct/traceable.
    expect(attempt1.attempt.reviewRequestId).toBe(attempt2.attempt.reviewRequestId);
    expect(attempt1.attempt.baselineObservationId).toBe(attempt2.attempt.baselineObservationId);
    expect(attempt1.attempt.attemptId).not.toBe(attempt2.attempt.attemptId);
    expect(attempt2.attempt.priorAttemptId).toBe(attempt1.attempt.attemptId);
    const attempts: ReferenceCorrectionAttemptResult[] = [attempt1.attempt, attempt2.attempt];
    expect(attempts.map((a) => a.overallState)).toEqual(['fail', 'pass']);
  }, 90000);

  it('Blocking proof: an incompatible reference/candidate viewport never fabricates a normal fidelity result or an overall PASS', async () => {
    const { dir, filePath } = await createDisposableTarget();
    activeDirs.push(dir);
    const server = await startDisposableTargetServer(filePath);
    activeServers.push(server);

    const reference = approvedReference(); // applicability.viewport is 480x620
    const incompatibleRequest = baseRequest({ targetUrl: server.baseUrl, viewport: { width: 1024, height: 768 } });
    const capture = await runBrowserCapture(incompatibleRequest);
    if (!capture.ok) throw new Error('expected a successful capture');
    const baselineObservation = buildObservationArtifact(capture, incompatibleRequest);
    const baselineC = baselineContract(baselineObservation.observationId);
    const changeC = changeContract();
    const bindings = [{ referenceRegion: 'current-page-card', runtimeTarget: 'popup-current-page' }];

    const prep = prepareReferenceCorrection({
      reference,
      baselineObservation,
      baselineContract: baselineC,
      changeContract: changeC,
      bindingDeclarations: bindings,
      currentObservation: baselineObservation,
      generatedAt: '2026-08-20T00:00:00.000Z',
      producerVersion: '0.7.0',
      projectionProfile: 'frontend-change-review',
    });
    expect(prep.ok).toBe(true);
    if (!prep.ok) throw new Error('expected ok');
    expect(prep.status).toBe('blocked-not-evaluated');
    expect(prep.fidelity.blockedBy).toBe('incompatible');
    if (prep.status === 'handoff-ready') throw new Error('must never produce a handoff for an incompatible pair');
  }, 60000);
});
