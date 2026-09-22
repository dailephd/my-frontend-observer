import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { getProducerInfo } from '../domain/schema.js';
import { buildEvidenceIndexMetadata, loadArtifactByHandle } from './evidence/index.js';
import { resolveMedia } from './evidence/mediaResolver.js';
import { getObservationRelationships } from './evidence/observationView.js';
import { getComparisonView } from './evidence/comparisonView.js';
import { getEvaluationView } from './evidence/evaluationView.js';
import { getReferenceView, getReferenceCandidateView, getReferenceBindings, getReferenceFidelity } from './evidence/referenceView.js';
import { resolveContextSources } from './evidence/contextSourceView.js';
import { getAnnotationView } from './evidence/annotationView.js';
import { checkAuthoringRequestHeaders, isExpectedAuthoringHost, readBoundedAuthoringBody } from './authoringSecurity.js';
import type { ViewerAuthoringSession } from './authoringSecurity.js';
import { parseSaveAnnotationRequest, saveAnnotationFromViewer } from './annotationAuthoring.js';
import type { SaveAnnotationFailureReason } from './annotationAuthoring.js';
import { parsePromoteAnnotationContractRequest, promoteAnnotationContractFromViewer } from './annotationContractPromotion.js';
import type { PromoteAnnotationContractFailureReason } from './annotationContractPromotion.js';
import { materializeAnnotationReferenceFromViewer, parseMaterializeAnnotationReferenceRequest } from './annotationReferenceMaterialization.js';
import type { MaterializeAnnotationReferenceFailureReason } from './annotationReferenceMaterialization.js';
import { createVisualChangeFromViewer, mutateVisualChangeFromViewer, parseCreateVisualChangeRequest, parseEmptyVisualChangeRequest } from './visualChangeAuthoring.js';
import { getVisualChangeWorkflowView } from './evidence/visualChangeWorkflowView.js';
import { parseStartRuntimeVisualChangeRequest, startRuntimeVisualChangeFromViewer } from './runtimeVisualChangeAuthoring.js';
import type { StartRuntimeVisualChangeFailureReason } from './runtimeVisualChangeAuthoring.js';
import { approveReferenceFromViewer, parseApproveReferenceRequest } from './referenceApproval.js';
import { parseStartReferenceVisualChangeRequest, startReferenceVisualChangeFromViewer } from './referenceVisualChangeAuthoring.js';
import { parsePrepareVisualChangeHandoffRequest, prepareVisualChangeHandoffFromViewer } from './visualChangeHandoff.js';
import { parseVisualChangeGovernanceRequest, parseVisualChangeReviewRequest, recordVisualChangeGovernanceFromViewer, reviewVisualChangeFromViewer } from './visualChangeReview.js';
import type { ContextSessionState } from './context.js';
import type { ViewerAliasMetadata } from './viewerService.js';

/**
 * Viewer protocol identity, reported by GET /api/status and bumped
 * independently of package/schema versions. 1.1.0 (v0.9 Batch 2) adds the
 * visual-annotation family, annotation metadata, the annotation-overlay media
 * role, GET /api/annotations/:handle/view, GET /api/authoring/session, and
 * POST /api/annotations. 1.2.0 (v0.9 Batch 5) adds
 * POST /api/annotations/:handle/promote-contract and its response contract.
 * 1.3.0 (v0.9 Batch 6) adds POST /api/annotations/:handle/materialize-reference.
 */
export const VIEWER_PROTOCOL_VERSION = '1.3.0';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function mimeTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolves a requested URL pathname against the built viewer asset root,
 * refusing to leave that root under any circumstance (encoded traversal,
 * `..` segments, absolute-looking segments). Returns `undefined` when the
 * request cannot possibly map to a safe on-disk path - callers must treat
 * that as "not found", never attempt a fallback read.
 */
function resolveAssetPath(assetsRoot: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const normalized = normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = resolve(assetsRoot, normalized);
  const rootWithSep = assetsRoot.endsWith(sep) ? assetsRoot : assetsRoot + sep;
  if (candidate !== assetsRoot && !candidate.startsWith(rootWithSep)) {
    return undefined;
  }
  return candidate;
}

export interface ViewerServerState {
  /** The explicit, caller-supplied local evidence root this viewer session represents. Never interpreted as Observer evidence in Batch 1. */
  root: string;
  /** v0.8 Batch 6: explicit, session-only binding declarations loaded once at CLI startup from an optional `--bindings-file`. Not yet validated against any specific reference - see `referenceView.ts`. */
  bindingDeclarations: readonly unknown[];
  /** v0.8 Batch 7: explicit, session-only bounded-agent-context state loaded once at CLI startup from an optional `--context-file`. Defaults to `{status:'none'}` - see `context.ts`. */
  context: ContextSessionState;
  aliasMetadata?: ViewerAliasMetadata;
  /** v0.9 Batch 2: present only for a validated project-aware viewer session. Absent means the server is strictly read-only. */
  authoring?: ViewerAuthoringSession;
}

export interface CreateViewerServerOptions {
  /** Absolute path to the built viewer static assets (index.html, JS/CSS bundles, manifest, icons). */
  assetsRoot: string;
  state: ViewerServerState;
}

/**
 * Builds (but does not start listening on) the loopback-only viewer HTTP
 * server. Read-only: serves only the built viewer application shell plus one
 * minimal status endpoint. Never serves the evidence root as a generic
 * static directory, never accepts write methods, and fails closed on any
 * path that would resolve outside `assetsRoot`.
 */
export function createViewerServer(options: CreateViewerServerOptions): Server {
  const { assetsRoot, state } = options;

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, assetsRoot, state);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, assetsRoot: string, state: ViewerServerState): Promise<void> {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }

  let pathname: string;
  try {
    pathname = new URL(req.url ?? '/', 'http://viewer.local').pathname;
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }

  // v0.9 Batch 2/5/6: POST exists for exactly three authoring routes. Every other path keeps the read-only GET/HEAD method set.
  if (pathname === ANNOTATION_SAVE_PATH) {
    if (method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' });
      res.end('method not allowed');
      return;
    }
    await handleAnnotationSave(req, res, state);
    return;
  }
  if (pathname === VISUAL_CHANGE_CREATE_PATH) {
    if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' }); res.end('method not allowed'); return; }
    await handleVisualChangeCreate(req, res, state); return;
  }
  const visualMutation = VISUAL_CHANGE_MUTATION_PATH.exec(pathname);
  if (visualMutation) {
    if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' }); res.end('method not allowed'); return; }
    await handleVisualChangeMutation(req, res, state, visualMutation[1] as string, visualMutation[2] as 'activate'|'check'|'restore-acceptance'); return;
  }
  const handoffMatch = VISUAL_CHANGE_HANDOFF_PATH.exec(pathname);
  if (handoffMatch) {
    if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' }); res.end('method not allowed'); return; }
    await handleVisualChangeHandoff(req, res, state, handoffMatch[1] as string); return;
  }
  const reviewMatch = VISUAL_CHANGE_REVIEW_PATH.exec(pathname);
  if (reviewMatch) { if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' }); res.end('method not allowed'); return; } await handleVisualChangeReview(req, res, state, reviewMatch[1] as string); return; }
  const governanceMatch = VISUAL_CHANGE_GOVERNANCE_PATH.exec(pathname);
  if (governanceMatch) { if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' }); res.end('method not allowed'); return; } await handleVisualChangeGovernance(req, res, state, governanceMatch[1] as string); return; }
  const promoteMatch = ANNOTATION_PROMOTE_CONTRACT_PATH.exec(pathname);
  if (promoteMatch) {
    if (method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' });
      res.end('method not allowed');
      return;
    }
    await handleAnnotationContractPromotion(req, res, state, promoteMatch[1] as string);
    return;
  }
  const startVisualChangeMatch = ANNOTATION_START_VISUAL_CHANGE_PATH.exec(pathname);
  if (startVisualChangeMatch) {
    if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' }); res.end('method not allowed'); return; }
    await handleRuntimeVisualChangeStart(req, res, state, startVisualChangeMatch[1] as string); return;
  }
  const materializeMatch = ANNOTATION_MATERIALIZE_REFERENCE_PATH.exec(pathname);
  if (materializeMatch) {
    if (method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' });
      res.end('method not allowed');
      return;
    }
    await handleAnnotationReferenceMaterialization(req, res, state, materializeMatch[1] as string);
    return;
  }
  const approveReferenceMatch = REFERENCE_APPROVE_PATH.exec(pathname);
  if (approveReferenceMatch) {
    if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' }); res.end('method not allowed'); return; }
    await handleReferenceApproval(req, res, state, approveReferenceMatch[1] as string); return;
  }
  const startReferenceMatch = REFERENCE_START_VISUAL_CHANGE_PATH.exec(pathname);
  if (startReferenceMatch) {
    if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' }); res.end('method not allowed'); return; }
    await handleReferenceVisualChangeStart(req, res, state, startReferenceMatch[1] as string); return;
  }
  if (method === 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }

  if (pathname === '/api/status') {
    const body = JSON.stringify({
      ok: true,
      viewerProtocolVersion: VIEWER_PROTOCOL_VERSION,
      producer: getProducerInfo(),
      root: state.root,
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  if (pathname === '/api/index') {
    const result = await buildEvidenceIndexMetadata(state.root, state.aliasMetadata?.observationAliasesByRelativeDir ?? {});
    const body = JSON.stringify({ ok: true, records: result.records, truncated: result.truncated });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  const artifactMatch = /^\/api\/artifacts\/([^/]+)$/.exec(pathname);
  if (artifactMatch) {
    const handle = decodeURIComponentSafe(artifactMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed artifact handle');
      return;
    }
    const result = await loadArtifactByHandle(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const body: Record<string, unknown> =
        result.reason === 'unknown-handle' ? { ok: false, error: 'unknown viewer artifact handle' } : { ok: false, error: 'artifact is not currently loadable', metadata: result.metadata };
      writeJsonBody(res, method, status, body);
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, handle: result.detail.handle, family: result.detail.family, artifact: result.detail.artifact });
    return;
  }

  const mediaMatch = /^\/api\/media\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (mediaMatch) {
    const handle = decodeURIComponentSafe(mediaMatch[1] as string);
    const role = decodeURIComponentSafe(mediaMatch[2] as string);
    if (handle === undefined || role === undefined) {
      writeJsonError(res, method, 400, 'malformed media request');
      return;
    }
    const resolution = await resolveMedia(state.root, handle, role);
    if (!resolution.ok) {
      writeJsonError(res, method, 404, resolution.reason);
      return;
    }
    await streamFile(resolution.absolutePath, resolution.mimeType, res, method);
    return;
  }

  const relationshipsMatch = /^\/api\/observations\/([^/]+)\/relationships$/.exec(pathname);
  if (relationshipsMatch) {
    const handle = decodeURIComponentSafe(relationshipsMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed observation handle');
      return;
    }
    const result = await getObservationRelationships(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const error =
        result.reason === 'unknown-handle'
          ? 'unknown viewer artifact handle'
          : result.reason === 'not-an-observation'
            ? 'relationships are only defined for observation evidence'
            : result.reason === 'not-currently-loadable'
              ? 'observation is not currently loadable'
              : `relationship derivation failed: ${result.detail}`;
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, graph: result.graph });
    return;
  }

  const comparisonViewMatch = /^\/api\/comparisons\/([^/]+)\/view$/.exec(pathname);
  if (comparisonViewMatch) {
    const handle = decodeURIComponentSafe(comparisonViewMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed comparison handle');
      return;
    }
    const result = await getComparisonView(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const error =
        result.reason === 'unknown-handle' ? 'unknown viewer artifact handle' : result.reason === 'not-a-comparison' ? 'view is only defined for comparison evidence' : 'comparison is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, before: result.before, after: result.after });
    return;
  }

  const evaluationViewMatch = /^\/api\/evaluations\/([^/]+)\/view$/.exec(pathname);
  if (evaluationViewMatch) {
    const handle = decodeURIComponentSafe(evaluationViewMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed evaluation handle');
      return;
    }
    const result = await getEvaluationView(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const error =
        result.reason === 'unknown-handle' ? 'unknown viewer artifact handle' : result.reason === 'not-an-evaluation' ? 'view is only defined for contract-evaluation evidence' : 'evaluation is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, comparison: result.comparison, baseline: result.baseline, change: result.change, before: result.before, after: result.after });
    return;
  }

  const referenceViewMatch = /^\/api\/references\/([^/]+)\/view$/.exec(pathname);
  if (referenceViewMatch) {
    const handle = decodeURIComponentSafe(referenceViewMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed reference handle');
      return;
    }
    const result = await getReferenceView(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const error = result.reason === 'unknown-handle' ? 'unknown viewer artifact handle' : result.reason === 'not-a-reference' ? 'view is only defined for external-reference evidence' : 'reference is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, regionRelationships: result.regionRelationships ?? null, requirementAdequacy: result.requirementAdequacy ?? null });
    return;
  }

  const referenceCandidateViewMatch = /^\/api\/references\/([^/]+)\/candidate\/([^/]+)\/view$/.exec(pathname);
  if (referenceCandidateViewMatch) {
    const referenceHandle = decodeURIComponentSafe(referenceCandidateViewMatch[1] as string);
    const candidateHandle = decodeURIComponentSafe(referenceCandidateViewMatch[2] as string);
    if (referenceHandle === undefined || candidateHandle === undefined) {
      writeJsonError(res, method, 400, 'malformed reference/candidate request');
      return;
    }
    const result = await getReferenceCandidateView(state.root, referenceHandle, candidateHandle);
    if (!result.ok) {
      const status = result.reason === 'unknown-reference-handle' || result.reason === 'unknown-candidate-handle' ? 404 : 409;
      const error =
        result.reason === 'unknown-reference-handle'
          ? 'unknown viewer reference handle'
          : result.reason === 'unknown-candidate-handle'
            ? 'unknown viewer candidate handle'
            : result.reason === 'not-a-reference'
              ? 'the first handle is not external-reference evidence'
              : result.reason === 'not-an-observation'
                ? 'the second handle is not observation evidence'
                : 'reference or candidate is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, compatibility: result.compatibility, evaluationHandles: result.evaluationHandles, coordinateMapping: result.coordinateMapping });
    return;
  }

  const referenceBindingsMatch = /^\/api\/references\/([^/]+)\/candidate\/([^/]+)\/bindings$/.exec(pathname);
  if (referenceBindingsMatch) {
    const referenceHandle = decodeURIComponentSafe(referenceBindingsMatch[1] as string);
    const candidateHandle = decodeURIComponentSafe(referenceBindingsMatch[2] as string);
    if (referenceHandle === undefined || candidateHandle === undefined) {
      writeJsonError(res, method, 400, 'malformed reference/candidate binding request');
      return;
    }
    const result = await getReferenceBindings(state.root, referenceHandle, candidateHandle, state.bindingDeclarations);
    if (!result.ok) {
      const status = result.reason === 'unknown-reference-handle' || result.reason === 'unknown-candidate-handle' ? 404 : result.reason === 'invalid-bindings' ? 422 : 409;
      const error =
        result.reason === 'unknown-reference-handle'
          ? 'unknown viewer reference handle'
          : result.reason === 'unknown-candidate-handle'
            ? 'unknown viewer candidate handle'
            : result.reason === 'not-a-reference'
              ? 'the first handle is not external-reference evidence'
              : result.reason === 'not-an-observation'
                ? 'the second handle is not observation evidence'
                : result.reason === 'invalid-bindings'
                  ? `the session's binding declarations are invalid for this reference: ${result.detail}`
                  : 'reference or candidate is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, evaluation: result.evaluation });
    return;
  }

  const referenceFidelityMatch = /^\/api\/references\/([^/]+)\/candidate\/([^/]+)\/fidelity$/.exec(pathname);
  if (referenceFidelityMatch) {
    const referenceHandle = decodeURIComponentSafe(referenceFidelityMatch[1] as string);
    const candidateHandle = decodeURIComponentSafe(referenceFidelityMatch[2] as string);
    if (referenceHandle === undefined || candidateHandle === undefined) {
      writeJsonError(res, method, 400, 'malformed reference/candidate fidelity request');
      return;
    }
    const result = await getReferenceFidelity(state.root, referenceHandle, candidateHandle, state.bindingDeclarations);
    if (!result.ok) {
      const status = result.reason === 'unknown-reference-handle' || result.reason === 'unknown-candidate-handle' ? 404 : result.reason === 'invalid-bindings' ? 422 : 409;
      const error =
        result.reason === 'unknown-reference-handle'
          ? 'unknown viewer reference handle'
          : result.reason === 'unknown-candidate-handle'
            ? 'unknown viewer candidate handle'
            : result.reason === 'not-a-reference'
              ? 'the first handle is not external-reference evidence'
              : result.reason === 'not-an-observation'
                ? 'the second handle is not observation evidence'
                : result.reason === 'invalid-bindings'
                  ? `the session's binding declarations are invalid for this reference: ${result.detail}`
                  : 'reference or candidate is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, evaluation: result.evaluation });
    return;
  }

  if (pathname === '/api/authoring/session') {
    const session = state.authoring;
    if (session === undefined) {
      writeJsonBody(res, method, 200, { ok: true, enabled: false });
      return;
    }
    // Defense in depth against DNS rebinding: the capability is only handed out on the exact expected loopback Host.
    if (!isExpectedAuthoringHost(req, session)) {
      writeJsonError(res, method, 403, 'authoring session is only available on the viewer origin');
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, enabled: true, token: session.token });
    return;
  }

  const annotationViewMatch = /^\/api\/annotations\/([^/]+)\/view$/.exec(pathname);
  if (annotationViewMatch) {
    const handle = decodeURIComponentSafe(annotationViewMatch[1] as string);
    if (handle === undefined) {
      writeJsonError(res, method, 400, 'malformed annotation handle');
      return;
    }
    const result = await getAnnotationView(state.root, handle);
    if (!result.ok) {
      const status = result.reason === 'unknown-handle' ? 404 : 409;
      const error =
        result.reason === 'unknown-handle' ? 'unknown viewer artifact handle' : result.reason === 'not-an-annotation' ? 'view is only defined for visual-annotation evidence' : 'annotation is not currently loadable';
      writeJsonBody(res, method, status, { ok: false, error });
      return;
    }
    writeJsonBody(res, method, 200, { ok: true, annotation: result.annotation, source: result.source });
    return;
  }
  const visualChangeViewMatch = /^\/api\/visual-changes\/([^/]+)\/view$/.exec(pathname);
  if (visualChangeViewMatch) {
    const handle = decodeURIComponentSafe(visualChangeViewMatch[1] as string); if (handle === undefined) { writeJsonError(res, method, 400, 'malformed workflow handle'); return; }
    const result = await getVisualChangeWorkflowView(state.root, handle);
    if (!result.ok) { const status = result.reason === 'unknown-handle' ? 404 : 409; writeJsonError(res, method, status, result.reason === 'unknown-handle' ? 'unknown viewer artifact handle' : 'workflow view is not currently available'); return; }
    writeJsonBody(res, method, 200, { ok: true, view: result.view }); return;
  }

  if (pathname === '/api/context') {
    if (state.context.status === 'none') {
      writeJsonBody(res, method, 200, { ok: true, status: 'none' });
      return;
    }
    if (state.context.status === 'unsupported-version') {
      writeJsonBody(res, method, 200, { ok: true, status: 'unsupported-version', foundSchemaVersion: state.context.foundSchemaVersion });
      return;
    }
    const sourceResolution = await resolveContextSources(state.root, state.context.artifact.sources);
    writeJsonBody(res, method, 200, { ok: true, status: 'valid', artifact: state.context.artifact, sourceResolution });
    return;
  }

  if (pathname.startsWith('/api/')) {
    writeJsonError(res, method, 404, 'unknown viewer API route');
    return;
  }

  const isAssetLikePath = extname(pathname) !== '';
  const candidatePath = resolveAssetPath(assetsRoot, pathname === '/' ? '/index.html' : pathname);

  if (candidatePath !== undefined) {
    const served = await tryServeFile(candidatePath, res, method);
    if (served) return;
    if (isAssetLikePath) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
  }

  // SPA fallback for unknown, non-asset viewer routes (e.g. future client-side navigation): serve the shell itself rather than a bare 404.
  const indexPath = join(assetsRoot, 'index.html');
  const servedIndex = await tryServeFile(indexPath, res, method);
  if (!servedIndex) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('viewer assets are not built - run the package build before starting the viewer');
  }
}

const ANNOTATION_SAVE_PATH = '/api/annotations';
const VISUAL_CHANGE_CREATE_PATH = '/api/visual-changes';
const VISUAL_CHANGE_MUTATION_PATH = /^\/api\/visual-changes\/([^/]+)\/(activate|check|restore-acceptance)$/;
const VISUAL_CHANGE_HANDOFF_PATH = /^\/api\/visual-changes\/([^/]+)\/prepare-handoff$/;
const VISUAL_CHANGE_REVIEW_PATH = /^\/api\/visual-changes\/([^/]+)\/review$/;
const VISUAL_CHANGE_GOVERNANCE_PATH = /^\/api\/visual-changes\/([^/]+)\/governance$/;
const ANNOTATION_PROMOTE_CONTRACT_PATH = /^\/api\/annotations\/([^/]+)\/promote-contract$/;
const ANNOTATION_START_VISUAL_CHANGE_PATH = /^\/api\/annotations\/([^/]+)\/start-visual-change$/;

const ANNOTATION_MATERIALIZE_REFERENCE_PATH = /^\/api\/annotations\/([^/]+)\/materialize-reference$/;
const REFERENCE_APPROVE_PATH = /^\/api\/references\/([^/]+)\/approve$/;
const REFERENCE_START_VISUAL_CHANGE_PATH = /^\/api\/references\/([^/]+)\/start-visual-change$/;

const MATERIALIZE_FAILURE_STATUS: Record<MaterializeAnnotationReferenceFailureReason, number> = {
  'unknown-annotation-handle': 404,
  'not-an-annotation': 409,
  'runtime-annotation': 409,
  'source-unavailable': 404,
  'source-image-unavailable': 404,
  'image-read-failure': 500,
  'invalid-source': 409,
  'source-mismatch': 409,
  'invalid-selection': 422,
  'invalid-materialized-reference': 422,
  'persistence-failure': 500,
};

const PROMOTE_FAILURE_STATUS: Record<PromoteAnnotationContractFailureReason, number> = {
  'unknown-annotation-handle': 404,
  'not-an-annotation': 409,
  'reference-annotation': 409,
  'source-unavailable': 404,
  'project-config-invalid': 409,
  'configured-baseline-invalid': 409,
  'invalid-annotation': 409,
  'unsupported-source': 409,
  'source-mismatch': 409,
  'invalid-selection': 422,
  'persistence-failed': 500,
};
const START_VISUAL_CHANGE_FAILURE_STATUS: Record<StartRuntimeVisualChangeFailureReason, number> = {
  'unknown-annotation-handle': 404, 'source-unavailable': 404,
  'not-an-annotation': 409, 'reference-annotation': 409, 'source-mismatch': 409, 'project-config-invalid': 409, 'contract-not-configured': 409, 'configured-baseline-invalid': 409, 'baseline-alias-missing': 409,
  'invalid-selection': 422,
  'contract-persistence-failed': 500, 'workflow-persistence-failed': 500,
};

const SAVE_FAILURE_STATUS: Record<SaveAnnotationFailureReason, number> = {
  'unknown-source-handle': 404,
  'source-not-loadable': 409,
  'source-not-annotatable': 409,
  'unknown-parent-handle': 404,
  'parent-not-annotation': 409,
  'parent-source-mismatch': 409,
  'parent-has-child': 409,
  'revision-lineage-unverifiable': 409,
  'invalid-annotation': 422,
  'persistence-failed': 500,
};

/**
 * POST /api/annotations. Order: authoring enabled, then Host/Origin/token/
 * content-type/content-encoding, then bounded body, JSON, closed request
 * shape, and finally the canonical save use case. Responses never include
 * filesystem paths, the project root, the session token, or stack traces, and
 * nothing here logs request bodies or tokens.
 */
async function handleAnnotationSave(req: IncomingMessage, res: ServerResponse, state: ViewerServerState): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state);
  if (authoring === undefined) return;
  const { session, parsed } = authoring;

  const request = parseSaveAnnotationRequest(parsed);
  if (!request.ok) {
    writeJsonError(res, 'POST', 400, request.error);
    return;
  }

  try {
    const saved = await saveAnnotationFromViewer(state.root, session, request.request);
    if (!saved.ok) {
      writeJsonError(res, 'POST', SAVE_FAILURE_STATUS[saved.reason], saved.error);
      return;
    }
    writeJsonBody(res, 'POST', 201, { ok: true, annotationId: saved.annotationId, annotationRequestId: saved.annotationRequestId, handle: saved.handle });
  } catch {
    writeJsonError(res, 'POST', 500, 'the annotation could not be saved');
  }
}

async function handleVisualChangeCreate(req: IncomingMessage, res: ServerResponse, state: ViewerServerState): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state); if (authoring === undefined) return;
  const parsed = parseCreateVisualChangeRequest(authoring.parsed); if (!parsed.ok) { writeJsonError(res, 'POST', 400, parsed.error); return; }
  try { const result = await createVisualChangeFromViewer(authoring.session, parsed.scope); writeJsonBody(res, 'POST', result.status, result.body); }
  catch { writeJsonError(res, 'POST', 500, 'visual-change workflow creation failed'); }
}

async function handleVisualChangeMutation(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string, routeOperation: 'activate'|'check'|'restore-acceptance'): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state); if (authoring === undefined) return;
  const parsed = parseEmptyVisualChangeRequest(authoring.parsed); if (!parsed.ok) { writeJsonError(res, 'POST', 400, parsed.error); return; }
  const handle = decodeURIComponentSafe(encodedHandle); if (handle === undefined) { writeJsonError(res, 'POST', 400, 'malformed workflow handle'); return; }
  try {
    const result = await mutateVisualChangeFromViewer(state.root, authoring.session, handle, routeOperation === 'restore-acceptance' ? 'restore' : routeOperation);
    if (!result.ok && 'error' in result) { writeJsonError(res, 'POST', result.status, result.error); return; }
    writeJsonBody(res, 'POST', result.status, result.body);
  } catch { writeJsonError(res, 'POST', 500, 'visual-change workflow operation failed'); }
}

async function handleVisualChangeHandoff(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state); if (authoring === undefined) return;
  const parsed = parsePrepareVisualChangeHandoffRequest(authoring.parsed); if (!parsed.ok) { writeJsonError(res, 'POST', 400, parsed.error); return; }
  const handle = decodeURIComponentSafe(encodedHandle); if (handle === undefined) { writeJsonError(res, 'POST', 400, 'malformed workflow handle'); return; }
  try {
    const result = await prepareVisualChangeHandoffFromViewer(state.root, authoring.session, state.context, handle, parsed.request);
    if (!result.ok) {
      const status = result.code === 'unknown-handle' ? 404 : result.code === 'wrong-family' || ['workflow-inactive','workflow-restored','acceptance-drift','baseline-drift','unsupported-context','context-mismatch','review-required','workflow-accepted','workflow-abandoned'].includes(result.code) ? 409 : result.code === 'invalid-handoff' ? 500 : 422;
      writeJsonBody(res, 'POST', status, { ok: false, code: result.code, error: result.error }); return;
    }
    writeJsonBody(res, 'POST', 200, { ok: true, handoff: result.handoff });
  } catch { writeJsonError(res, 'POST', 500, 'visual-change handoff preparation failed'); }
}

async function handleVisualChangeReview(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state); if (authoring === undefined) return; const parsed = parseVisualChangeReviewRequest(authoring.parsed); if (!parsed.ok) { writeJsonError(res, 'POST', 400, parsed.error); return; } const handle = decodeURIComponentSafe(encodedHandle); if (handle === undefined) { writeJsonError(res, 'POST', 400, 'malformed workflow handle'); return; }
  try { const result = await reviewVisualChangeFromViewer(state.root, authoring.session, handle, parsed.decision); if (!result.ok) { if ('status' in result) writeJsonError(res, 'POST', result.status, result.error); else writeJsonBody(res, 'POST', result.code === 'persistence-failure' ? 500 : 409, { ok: false, code: result.code, error: result.reason }); return; } writeJsonBody(res, 'POST', 200, result); } catch { writeJsonError(res, 'POST', 500, 'visual-change review failed'); }
}

async function handleVisualChangeGovernance(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state); if (authoring === undefined) return; const parsed = parseVisualChangeGovernanceRequest(authoring.parsed); if (!parsed.ok) { writeJsonError(res, 'POST', 400, parsed.error); return; } const handle = decodeURIComponentSafe(encodedHandle); if (handle === undefined) { writeJsonError(res, 'POST', 400, 'malformed workflow handle'); return; }
  try { const result = await recordVisualChangeGovernanceFromViewer(state.root, authoring.session, handle, parsed.request); if (!result.ok) { if ('status' in result) writeJsonError(res, 'POST', result.status, result.error); else writeJsonBody(res, 'POST', result.code === 'persistence-failure' ? 500 : 409, { ok: false, code: result.code, error: result.reason }); return; } writeJsonBody(res, 'POST', 200, result); } catch { writeJsonError(res, 'POST', 500, 'visual-change governance recording failed'); }
}

/**
 * The one shared authoring POST gate (v0.9 Batch 2, reused unchanged by Batch
 * 5): authoring enabled, then Host/Origin/token/content-type/content-encoding,
 * then the bounded body and JSON parsing. Returns undefined when it has
 * already written the rejection response.
 */
async function readAuthoringJsonRequest(req: IncomingMessage, res: ServerResponse, state: ViewerServerState): Promise<{ session: ViewerAuthoringSession; parsed: unknown } | undefined> {
  const session = state.authoring;
  if (session === undefined) {
    rejectAuthoringRequest(res, 403, 'annotation authoring is not enabled for this viewer session');
    return undefined;
  }

  const headerCheck = checkAuthoringRequestHeaders(req, session);
  if (!headerCheck.ok) {
    rejectAuthoringRequest(res, headerCheck.status, headerCheck.error);
    return undefined;
  }

  const body = await readBoundedAuthoringBody(req);
  if (!body.ok) {
    rejectAuthoringRequest(res, body.status, body.error);
    return undefined;
  }

  try {
    return { session, parsed: JSON.parse(body.body.toString('utf8')) as unknown };
  } catch {
    writeJsonError(res, 'POST', 400, 'request body is not valid JSON');
    return undefined;
  }
}

/**
 * POST /api/annotations/:handle/promote-contract (v0.9 Batch 5). Same shared
 * authoring gate as the save route, then a closed request shape, then the one
 * canonical promotion use case. The route itself never builds clauses or
 * contract identity and never returns filesystem paths.
 */
async function handleAnnotationContractPromotion(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state);
  if (authoring === undefined) return;
  const { session, parsed } = authoring;

  const handle = decodeURIComponentSafe(encodedHandle);
  if (handle === undefined) {
    writeJsonError(res, 'POST', 400, 'malformed annotation handle');
    return;
  }

  const request = parsePromoteAnnotationContractRequest(parsed);
  if (!request.ok) {
    writeJsonError(res, 'POST', 400, request.error);
    return;
  }

  try {
    const promoted = await promoteAnnotationContractFromViewer(state.root, session, handle, request.request);
    if (!promoted.ok) {
      writeJsonError(res, 'POST', PROMOTE_FAILURE_STATUS[promoted.reason], promoted.error);
      return;
    }
    writeJsonBody(res, 'POST', 201, {
      ok: true,
      contractId: promoted.contractId,
      contractRequestId: promoted.contractRequestId,
      handle: promoted.handle,
      clauseCount: promoted.clauseCount,
      activation: promoted.activation,
    });
  } catch {
    writeJsonError(res, 'POST', 500, 'the change contract could not be promoted');
  }
}

async function handleRuntimeVisualChangeStart(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state); if (authoring === undefined) return;
  const handle = decodeURIComponentSafe(encodedHandle); if (handle === undefined) { writeJsonError(res, 'POST', 400, 'malformed annotation handle'); return; }
  const request = parseStartRuntimeVisualChangeRequest(authoring.parsed); if (!request.ok) { writeJsonError(res, 'POST', 400, request.error); return; }
  try {
    const result = await startRuntimeVisualChangeFromViewer(state.root, authoring.session, handle, request.request);
    if (!result.ok) { writeJsonBody(res, 'POST', START_VISUAL_CHANGE_FAILURE_STATUS[result.reason], { ok: false, code: result.reason, error: result.error, ...(result.contractId === undefined ? {} : { contractId: result.contractId }), ...(result.contractRequestId === undefined ? {} : { contractRequestId: result.contractRequestId }) }); return; }
    writeJsonBody(res, 'POST', 201, { ok: true, contractId: result.contractId, contractRequestId: result.contractRequestId, clauseCount: result.clauseCount, visualChangeRequestId: result.visualChangeRequestId, visualChangeWorkflowId: result.visualChangeWorkflowId });
  } catch { writeJsonError(res, 'POST', 500, 'the visual change could not be created'); }
}

/**
 * POST /api/annotations/:handle/materialize-reference (v0.9 Batch 6). Same
 * shared authoring gate, a closed `{ itemIds }` body, then the one canonical
 * materialization use case. The route never composes regions, requirements,
 * or reference identity and never returns filesystem paths.
 */
async function handleAnnotationReferenceMaterialization(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state);
  if (authoring === undefined) return;
  const { session, parsed } = authoring;

  const handle = decodeURIComponentSafe(encodedHandle);
  if (handle === undefined) {
    writeJsonError(res, 'POST', 400, 'malformed annotation handle');
    return;
  }

  const request = parseMaterializeAnnotationReferenceRequest(parsed);
  if (!request.ok) {
    writeJsonError(res, 'POST', 400, request.error);
    return;
  }

  try {
    const materialized = await materializeAnnotationReferenceFromViewer(state.root, session, handle, request.request);
    if (!materialized.ok) {
      writeJsonError(res, 'POST', MATERIALIZE_FAILURE_STATUS[materialized.reason], materialized.error);
      return;
    }
    writeJsonBody(res, 'POST', 201, {
      ok: true,
      referenceId: materialized.referenceId,
      referenceRequestId: materialized.referenceRequestId,
      handle: materialized.handle,
      lifecycle: 'imported',
      supersedesReferenceId: materialized.supersedesReferenceId,
      regionCount: materialized.regionCount,
      requirementCount: materialized.requirementCount,
      approvalRequired: true,
    });
  } catch {
    writeJsonError(res, 'POST', 500, 'the reference revision could not be materialized');
  }
}

async function handleReferenceApproval(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state); if (authoring === undefined) return;
  const handle = decodeURIComponentSafe(encodedHandle); if (handle === undefined) { writeJsonError(res, 'POST', 400, 'malformed reference handle'); return; }
  const parsed = parseApproveReferenceRequest(authoring.parsed); if (!parsed.ok) { writeJsonError(res, 'POST', 400, parsed.error); return; }
  try {
    const result = await approveReferenceFromViewer(state.root, authoring.session, handle);
    if (!result.ok) { writeJsonError(res, 'POST', result.reason === 'unknown-handle' ? 404 : result.reason === 'approval-failed' ? 500 : 409, result.error); return; }
    writeJsonBody(res, 'POST', 201, { ok: true, referenceId: result.referenceId, referenceRequestId: result.referenceRequestId, handle: result.handle, regionCount: result.regionCount, requirementCount: result.requirementCount, adequacy: result.adequacy });
  } catch { writeJsonError(res, 'POST', 500, 'the reference could not be approved'); }
}

async function handleReferenceVisualChangeStart(req: IncomingMessage, res: ServerResponse, state: ViewerServerState, encodedHandle: string): Promise<void> {
  const authoring = await readAuthoringJsonRequest(req, res, state); if (authoring === undefined) return;
  const handle = decodeURIComponentSafe(encodedHandle); if (handle === undefined) { writeJsonError(res, 'POST', 400, 'malformed reference handle'); return; }
  const parsed = parseStartReferenceVisualChangeRequest(authoring.parsed); if (!parsed.ok) { writeJsonError(res, 'POST', 400, parsed.error); return; }
  try {
    const result = await startReferenceVisualChangeFromViewer(state.root, authoring.session, handle, parsed.request);
    if (!result.ok) { writeJsonBody(res, 'POST', result.reason === 'unknown-handle' || result.reason === 'baseline-invalid' ? 404 : result.reason.includes('invalid') || result.reason === 'intent-not-represented' || result.reason.startsWith('binding') ? 422 : 409, { ok: false, code: result.reason, error: result.error }); return; }
    writeJsonBody(res, 'POST', 201, result);
  } catch { writeJsonError(res, 'POST', 500, 'the reference visual change could not be created'); }
}

/** Rejects before (or instead of) consuming the request body; `connection: close` stops the server from collecting any further body bytes. */
function rejectAuthoringRequest(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
  res.end(JSON.stringify({ ok: false, error }));
}

function decodeURIComponentSafe(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function writeJsonBody(res: ServerResponse, method: string, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(method === 'HEAD' ? undefined : JSON.stringify(body));
}

function writeJsonError(res: ServerResponse, method: string, status: number, error: string): void {
  writeJsonBody(res, method, status, { ok: false, error });
}

/** Streams one already-resolved, already-contained media file. Never used for arbitrary paths - callers must have gone through mediaResolver.ts's handle/role validation first. */
async function streamFile(absolutePath: string, mimeType: string, res: ServerResponse, method: string): Promise<void> {
  let size: number;
  try {
    size = (await stat(absolutePath)).size;
  } catch {
    writeJsonError(res, method, 404, 'media file not found on disk');
    return;
  }
  res.writeHead(200, {
    'content-type': mimeType,
    'content-length': size,
    'cache-control': 'no-store',
    // v0.9 Batch 2: an annotation overlay is image/svg+xml served from the viewer origin. Even if navigated to directly,
    // it can never run script or load resources in that origin.
    ...(mimeType === 'image/svg+xml' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'x-content-type-options': 'nosniff' } : {}),
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on('error', reject);
    stream.on('end', resolvePromise);
    stream.pipe(res);
  });
}

async function tryServeFile(path: string, res: ServerResponse, method: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': mimeTypeFor(path),
      'content-length': body.byteLength,
      'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}
