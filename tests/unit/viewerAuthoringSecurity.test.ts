import { describe, expect, it, afterEach } from 'vitest';
import { readdir } from 'node:fs/promises';
import {
  MAX_ANNOTATION_AUTHORING_BODY_BYTES,
  VIEWER_AUTHORING_TOKEN_BYTES,
  VIEWER_AUTHORING_TOKEN_HEADER,
  createViewerAuthoringToken,
  isAcceptedJsonContentType,
} from '../../src/viewerServer/authoringSecurity.js';
import { VIEWER_PROTOCOL_VERSION } from '../../src/viewerServer/httpServer.js';
import { projectAnnotationsRoot } from '../../src/projectWorkflow/projectPaths.js';
import type { RunningViewer } from '../support/annotationAuthoringFixtures.js';
import { TestResources, authoringHeaders, fetchAuthoringToken, rawRequest, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';

const resources = new TestResources();
afterEach(async () => resources.cleanup());

async function authoringViewer(): Promise<{ viewer: RunningViewer; token: string; projectRoot: string }> {
  const project = await writeInitializedProject(resources);
  const viewer = await resources.startViewer({ root: project.root, authoringProjectRoot: project.projectRoot });
  return { viewer, token: await fetchAuthoringToken(viewer), projectRoot: project.projectRoot };
}

/** A request that reaches body validation but can never persist anything (unknown source handle). */
const PROBE_BODY = JSON.stringify({ sourceHandle: 'observation:does-not-exist', items: [] });

function post(viewer: RunningViewer, headers: Record<string, string>, body: string | Buffer = PROBE_BODY, path = '/api/annotations') {
  return rawRequest(viewer, { method: 'POST', path, headers, body });
}

function without(headers: Record<string, string>, name: string): Record<string, string> {
  const copy = { ...headers };
  delete copy[name];
  return copy;
}

async function annotationsWritten(projectRoot: string): Promise<string[]> {
  return readdir(projectAnnotationsRoot(projectRoot)).catch(() => []);
}

describe('authoring security constants and helpers', () => {
  it('freezes the planner-owned constants and the protocol version', () => {
    expect(VIEWER_AUTHORING_TOKEN_BYTES).toBe(32);
    expect(VIEWER_AUTHORING_TOKEN_HEADER).toBe('x-frontend-observer-authoring-token');
    expect(MAX_ANNOTATION_AUTHORING_BODY_BYTES).toBe(262144);
    expect(VIEWER_PROTOCOL_VERSION).toBe('1.1.0');
  });

  it('generates fresh 64-character lowercase hex tokens', () => {
    const first = createViewerAuthoringToken();
    const second = createViewerAuthoringToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });

  it('accepts only JSON media types with an optional UTF-8 charset', () => {
    for (const accepted of ['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8', ' application/json ;  charset = "utf-8" ']) {
      expect(isAcceptedJsonContentType(accepted), accepted).toBe(true);
    }
    for (const rejected of [undefined, '', 'text/plain', 'application/json-patch+json', 'application/json; charset=latin1', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      expect(isAcceptedJsonContentType(rejected), String(rejected)).toBe(false);
    }
  });
});

describe('GET /api/authoring/session', () => {
  it('reports disabled for a read-only viewer and exposes no token or path', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await resources.startViewer({ root: project.root });
    const response = await fetch(`${viewer.url}/api/authoring/session`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, enabled: false });
  });

  it('returns only enabled plus the session token for a project-aware viewer, and never on an unexpected Host', async () => {
    const { viewer, token, projectRoot } = await authoringViewer();
    const response = await fetch(`${viewer.url}/api/authoring/session`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ok: true, enabled: true, token });
    expect(text).not.toContain(projectRoot.split('\\').join('\\\\'));
    expect(text).not.toContain('frontend-observer');

    const rebound = await rawRequest(viewer, { method: 'GET', path: '/api/authoring/session', headers: { host: `attacker.example:${viewer.port}` } });
    expect(rebound.status).toBe(403);
    expect(rebound.text).not.toContain(token);
  });

  it('Q: gives separate viewer sessions different tokens that are not valid across sessions', async () => {
    const first = await authoringViewer();
    const second = await authoringViewer();
    expect(first.token).not.toBe(second.token);

    const crossSession = await post(second.viewer, authoringHeaders(second.viewer, first.token, PROBE_BODY));
    expect(crossSession.status).toBe(403);
    const sameSession = await post(second.viewer, authoringHeaders(second.viewer, second.token, PROBE_BODY));
    expect(sameSession.status).toBe(404);
  });
});

describe('POST /api/annotations security boundary', () => {
  it('rejects every write on a read-only viewer with 403', async () => {
    const project = await writeInitializedProject(resources);
    const viewer = await resources.startViewer({ root: project.root });
    const response = await post(viewer, authoringHeaders(viewer, 'a'.repeat(64), PROBE_BODY));
    expect(response.status).toBe(403);
    expect(await annotationsWritten(project.projectRoot)).toEqual([]);
  });

  it('A-E: rejects a missing token, wrong token, missing Origin, wrong Origin, and wrong Host with 403', async () => {
    const { viewer, token, projectRoot } = await authoringViewer();
    const valid = authoringHeaders(viewer, token, PROBE_BODY);
    const wrongToken = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    const cases: [string, Record<string, string>][] = [
      ['A missing token', without(valid, VIEWER_AUTHORING_TOKEN_HEADER)],
      ['B wrong token', { ...valid, [VIEWER_AUTHORING_TOKEN_HEADER]: wrongToken }],
      ['B short token', { ...valid, [VIEWER_AUTHORING_TOKEN_HEADER]: 'abc' }],
      ['C missing Origin', without(valid, 'origin')],
      ['D wrong Origin', { ...valid, origin: 'http://evil.example' }],
      ['D localhost Origin', { ...valid, origin: `http://localhost:${viewer.port}` }],
      ['D null Origin', { ...valid, origin: 'null' }],
      ['E wrong Host', { ...valid, host: `localhost:${viewer.port}` }],
      ['E rebinding Host', { ...valid, host: `attacker.example:${viewer.port}` }],
    ];
    for (const [label, headers] of cases) {
      const response = await post(viewer, headers);
      expect(response.status, label).toBe(403);
      expect(response.text, label).not.toContain(token);
    }
    expect(await annotationsWritten(projectRoot)).toEqual([]);
  });

  it('F: correct Host, Origin, and token reach request-body validation', async () => {
    const { viewer, token } = await authoringViewer();
    const response = await post(viewer, authoringHeaders(viewer, token, PROBE_BODY));
    expect(response.status).toBe(404);
    expect(JSON.parse(response.text)).toMatchObject({ ok: false, error: 'unknown source evidence handle' });
  });

  it('G and H: rejects non-JSON media types and compressed bodies with 415', async () => {
    const { viewer, token } = await authoringViewer();
    const valid = authoringHeaders(viewer, token, PROBE_BODY);
    expect((await post(viewer, { ...valid, 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(viewer, without(valid, 'content-type'))).status).toBe(415);
    expect((await post(viewer, { ...valid, 'content-encoding': 'gzip' })).status).toBe(415);
    expect((await post(viewer, { ...valid, 'content-encoding': 'identity' })).status).toBe(404);
  });

  it('I and J: accepts a body of exactly 262144 bytes and rejects a larger one with 413', async () => {
    const { viewer, token } = await authoringViewer();
    const padded = PROBE_BODY + ' '.repeat(MAX_ANNOTATION_AUTHORING_BODY_BYTES - Buffer.byteLength(PROBE_BODY));
    expect(Buffer.byteLength(padded)).toBe(262144);
    const atLimit = await post(viewer, authoringHeaders(viewer, token, padded), padded);
    expect(atLimit.status).toBe(404);

    const oversized = padded + ' ';
    const declared = await post(viewer, authoringHeaders(viewer, token, oversized), oversized);
    expect(declared.status).toBe(413);

    // Chunked transfer (no Content-Length): collection stops once the limit is exceeded.
    const chunkedHeaders = without(authoringHeaders(viewer, token, oversized), 'content-length');
    const chunked = await rawRequest(viewer, { method: 'POST', path: '/api/annotations', headers: { ...chunkedHeaders, 'transfer-encoding': 'chunked' }, body: oversized });
    expect(chunked.status).toBe(413);
  });

  it('K and L: rejects malformed JSON and unknown top-level fields with 400', async () => {
    const { viewer, token, projectRoot } = await authoringViewer();
    const malformed = '{ "sourceHandle": ';
    expect((await post(viewer, authoringHeaders(viewer, token, malformed), malformed)).status).toBe(400);
    for (const payload of [
      { sourceHandle: 'observation:x', items: [], extra: true },
      { sourceHandle: 'observation:x', items: [], annotationId: 'spoofed' },
      [],
      'text',
      { items: [] },
      { sourceHandle: '', items: [] },
      { sourceHandle: 'observation:x' },
      { sourceHandle: 'observation:x', items: {} },
      { sourceHandle: 'observation:x', parentAnnotationHandle: '', items: [] },
    ]) {
      const body = JSON.stringify(payload);
      expect((await post(viewer, authoringHeaders(viewer, token, body), body)).status, body).toBe(400);
    }
    expect(await annotationsWritten(projectRoot)).toEqual([]);
  });

  it('M-P: keeps PUT, PATCH, DELETE unsupported everywhere and blocks POST on every other route', async () => {
    const { viewer, token } = await authoringViewer();
    const headers = authoringHeaders(viewer, token, PROBE_BODY);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/api/annotations', '/api/index', '/api/authoring/session', '/']) {
        const response = await rawRequest(viewer, { method, path, headers, body: PROBE_BODY });
        expect(response.status, `${method} ${path}`).toBe(405);
      }
    }
    for (const path of ['/api/index', '/api/status', '/api/authoring/session', '/api/artifacts/x', '/api/annotations/x/view', '/api/annotations/x/promote-contract', '/api/annotations/x/materialize-reference', '/api/media/x/screenshot', '/']) {
      const response = await post(viewer, headers, PROBE_BODY, path);
      expect(response.status, `POST ${path}`).toBe(405);
      expect(response.headers.allow).toBe('GET, HEAD');
    }
    const getSave = await rawRequest(viewer, { method: 'GET', path: '/api/annotations', headers: { host: headers.host! } });
    expect(getSave.status).toBe(405);
    expect(getSave.headers.allow).toBe('POST');
  });

  it('keeps existing read-only routes answering GET and HEAD in authoring mode', async () => {
    const { viewer } = await authoringViewer();
    for (const path of ['/api/status', '/api/index', '/api/context']) {
      expect((await fetch(`${viewer.url}${path}`)).status, path).toBe(200);
      expect((await fetch(`${viewer.url}${path}`, { method: 'HEAD' })).status, path).toBe(200);
    }
    const status = (await (await fetch(`${viewer.url}/api/status`)).json()) as { viewerProtocolVersion: string };
    expect(status.viewerProtocolVersion).toBe('1.1.0');
  });
});
