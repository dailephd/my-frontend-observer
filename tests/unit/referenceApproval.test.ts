import { afterEach, describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectConfigPath, projectReferencesRoot } from '../../src/projectWorkflow/projectPaths.js';
import { TestResources, authoringHeaders, fetchAuthoringToken, handleFor, rawRequest, writeInitializedProject } from '../support/annotationAuthoringFixtures.js';

const resources = new TestResources();
afterEach(async () => resources.cleanup());

async function context() {
  const project = await writeInitializedProject(resources);
  const viewer = await resources.startViewer({ root: project.root, authoringProjectRoot: project.projectRoot });
  const token = await fetchAuthoringToken(viewer);
  return {
    project,
    viewer,
    token,
    importedHandle: await handleFor(viewer, 'external-reference-imported', project.imported.referenceId),
    approvedHandle: await handleFor(viewer, 'external-reference-approved', project.approved.referenceId),
  };
}

async function approve(ctx: Awaited<ReturnType<typeof context>>, handle: string, authenticated = true) {
  const body = '{}';
  const response = await rawRequest(ctx.viewer, {
    method: 'POST',
    path: `/api/references/${encodeURIComponent(handle)}/approve`,
    headers: authenticated ? authoringHeaders(ctx.viewer, ctx.token, body) : { 'content-type': 'application/json', host: `127.0.0.1:${ctx.viewer.port}` },
    body,
  });
  return { ...response, json: JSON.parse(response.text) as Record<string, unknown> };
}

describe('Batch 5 imported-reference approval route', () => {
  it('returns 404 for an unknown handle, 409 for an approved reference, and requires project authoring security', async () => {
    const ctx = await context();
    expect((await approve(ctx, 'external-reference-imported:references%2Fmissing')).status).toBe(404);
    expect((await approve(ctx, ctx.approvedHandle)).status).toBe(409);
    expect((await approve(ctx, ctx.importedHandle, false)).status).toBe(403);
  });

  it('approves exactly once into one fresh immutable instance, preserves request identity, leaks no path, and leaves acceptance unchanged', async () => {
    const ctx = await context();
    const configBefore = await readFile(projectConfigPath(ctx.project.projectRoot));
    const importedBefore = await readFile(path.join(ctx.project.importedRoot, 'manifest.json'));
    const dirsBefore = await readdir(projectReferencesRoot(ctx.project.projectRoot));
    const response = await approve(ctx, ctx.importedHandle);
    expect(response.status).toBe(201);
    expect(response.json.referenceRequestId).toBe(ctx.project.imported.referenceRequestId);
    expect(response.json.referenceId).not.toBe(ctx.project.imported.referenceId);
    expect(JSON.stringify(response.json)).not.toContain(ctx.project.projectRoot);
    expect(await readFile(path.join(ctx.project.importedRoot, 'manifest.json'))).toEqual(importedBefore);
    expect(await readFile(projectConfigPath(ctx.project.projectRoot))).toEqual(configBefore);
    const dirsAfter = await readdir(projectReferencesRoot(ctx.project.projectRoot));
    expect(dirsAfter).toHaveLength(dirsBefore.length + 1);
  });

  it('fails closed when a declared predecessor cannot be uniquely resolved', async () => {
    const ctx = await context();
    const manifestPath = path.join(ctx.project.importedRoot, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, supersedesReferenceId: `${'c'.repeat(64)}-${'d'.repeat(32)}` }, null, 2)}\n`);
    expect((await approve(ctx, ctx.importedHandle)).status).toBe(409);
  });
});
