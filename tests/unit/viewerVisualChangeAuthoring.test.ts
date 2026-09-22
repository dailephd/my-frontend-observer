import { afterEach, describe, expect, it } from 'vitest';
import { encodeArtifactHandle } from '../../src/viewerServer/evidence/handles.js';
import { persistVisualChangeWorkflow } from '../../src/application/visualChangeWorkflowPersistenceService.js';
import type { VisualChangeActualScope } from '../../src/domain/visualChangeWorkflow.js';
import { visualChangeOutputLocation } from '../../src/projectWorkflow/projectPaths.js';
import { TestResources, authoringHeaders, fetchAuthoringToken, rawRequest, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';

const resources = new TestResources(); afterEach(() => resources.cleanup());
const scope: VisualChangeActualScope = { entryMode: 'actual-frontend', annotationId: 'annotation', annotationArtifactPath: '.frontend-observer/evidence/annotations/annotation', baselineObservation: { artifactId: 'observation', observationId: 'observation', requestId: 'request', artifactPath: '.frontend-observer/evidence/observations/observation' }, changeContract: { artifactId: 'contract', contractId: 'contract', contractRequestId: 'contract-request', artifactPath: '.frontend-observer/evidence/contracts/contract' } };

async function context(authoring: boolean) {
  const project = await writeInitializedProject(resources); const saved = await persistVisualChangeWorkflow({ scope, outputLocation: visualChangeOutputLocation(), cwd: project.projectRoot }); if (!saved.ok) throw new Error('workflow fixture failed');
  const viewer = await resources.startViewer({ root: project.root, ...(authoring ? { authoringProjectRoot: project.projectRoot } : {}) });
  return { project, viewer, saved, handle: encodeArtifactHandle('visual-change-workflow', `visual-changes/${saved.visualChangeWorkflowId}`), ...(authoring ? { token: await fetchAuthoringToken(viewer) } : {}) };
}
async function post(ctx: Awaited<ReturnType<typeof context>>, path: string, payload: unknown, headers: Record<string, string> = {}) { const body = JSON.stringify(payload); return rawRequest(ctx.viewer, { method: 'POST', path, headers: { ...(ctx.token === undefined ? { 'content-type': 'application/json' } : authoringHeaders(ctx.viewer, ctx.token, body)), ...headers }, body }); }

describe('visual-change Viewer HTTP surface', () => {
  it('serves the bounded workflow projection with no-store in standalone mode and rejects unknown/wrong-family handles', async () => {
    const ctx = await context(false); const route = `/api/visual-changes/${encodeURIComponent(ctx.handle)}/view`; const response = await rawRequest(ctx.viewer, { method: 'GET', path: route }); expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store'); expect(JSON.parse(response.text)).toMatchObject({ ok: true, view: { workflow: { visualChangeWorkflowId: ctx.saved.visualChangeWorkflowId }, baselineObservation: { status: 'unavailable' } } });
    expect((await rawRequest(ctx.viewer, { method: 'GET', path: `/api/visual-changes/${encodeURIComponent('bogus')}/view` })).status).toBe(404);
    const index = JSON.parse((await rawRequest(ctx.viewer, { method: 'GET', path: '/api/index' })).text) as { records: Array<{ family: string; handle: string }> }; const observation = index.records.find((record) => record.family === 'observation'); if (observation === undefined) throw new Error('observation fixture missing'); expect((await rawRequest(ctx.viewer, { method: 'GET', path: `/api/visual-changes/${encodeURIComponent(observation.handle)}/view` })).status).toBe(409);
  });
  it('keeps every POST project-aware, token/Host/Origin/JSON guarded, closed, bounded, and no-store', async () => {
    const standalone = await context(false); for (const suffix of ['', `/${encodeURIComponent(standalone.handle)}/activate`, `/${encodeURIComponent(standalone.handle)}/check`, `/${encodeURIComponent(standalone.handle)}/restore-acceptance`, `/${encodeURIComponent(standalone.handle)}/prepare-handoff`]) expect((await post(standalone, `/api/visual-changes${suffix}`, suffix === '' ? { scope } : {})).status).toBe(403);
    const ctx = await context(true); const activate = `/api/visual-changes/${encodeURIComponent(ctx.handle)}/activate`;
    expect((await post(ctx, activate, {}, { 'x-frontend-observer-authoring-token': 'bad' })).status).toBe(403); expect((await post(ctx, activate, {}, { origin: 'http://evil.example' })).status).toBe(403); expect((await post(ctx, activate, {}, { host: 'evil.example' })).status).toBe(403); expect((await post(ctx, activate, {}, { 'content-type': 'text/plain' })).status).toBe(415); expect((await post(ctx, activate, {}, { 'content-encoding': 'gzip' })).status).toBe(415);
    expect((await post(ctx, '/api/visual-changes', { scope, extra: true })).status).toBe(400); for (const action of ['activate','check','restore-acceptance','prepare-handoff']) expect((await post(ctx, `/api/visual-changes/${encodeURIComponent(ctx.handle)}/${action}`, { extra: true })).status).toBe(400);
    const oversized = JSON.stringify({ scope, padding: 'x'.repeat(262200) }); expect((await rawRequest(ctx.viewer, { method: 'POST', path: '/api/visual-changes', headers: authoringHeaders(ctx.viewer, ctx.token!, oversized), body: oversized })).status).toBe(413);
    const delegated = await post(ctx, '/api/visual-changes', { scope }); expect(delegated.status).toBe(422); expect(delegated.headers['cache-control']).toBe('no-store'); expect(delegated.text).not.toContain(ctx.project.projectRoot);
  });
});
