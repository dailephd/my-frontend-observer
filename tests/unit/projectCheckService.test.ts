import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkProject } from '../../src/application/projectCheckService.js';
import { ALIAS_CATALOG_SCHEMA_VERSION, writeAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, projectConfigPath, projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function project(defaultBaseline = 'golden'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'observer-check-service-')); roots.push(root);
  await mkdir(projectEvidenceRoot(root), { recursive: true });
  await writeFile(projectConfigPath(root), JSON.stringify({ schemaVersion: '1.1.0', url: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 720 }, targets: [], defaultBaseline }));
  await writeAliasCatalog(aliasCatalogPath(root), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: {} });
  return root;
}

describe('project check baseline resolution', () => {
  it('uses defaultBaseline when omitted and explicit alias when supplied', async () => {
    const root = await project();
    const omitted = await checkProject(root); expect(omitted.status).toBe('BLOCKED'); expect(omitted.blockers[0]).toEqual({ code: 'baseline-alias-not-found', message: 'baseline alias "golden" was not found' });
    const explicit = await checkProject(root, 'baseline'); expect(explicit.blockers[0]).toEqual({ code: 'baseline-alias-not-found', message: 'baseline alias "baseline" was not found' });
  });

  it('blocks malformed or identity-mismatched baseline artifacts without exposing absolute paths', async () => {
    const root = await project('baseline'); const requestId = 'a'.repeat(64); const observationId = `${requestId}-${'b'.repeat(32)}`;
    await writeAliasCatalog(aliasCatalogPath(root), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { baseline: { observationId, requestId, relativeArtifactDir: `observations/baseline/${observationId}` } } });
    const artifactRoot = path.join(projectEvidenceRoot(root), 'observations', 'baseline', observationId); await mkdir(artifactRoot, { recursive: true }); await writeFile(path.join(artifactRoot, 'manifest.json'), '{}');
    const result = await checkProject(root, 'baseline'); expect(result.status).toBe('BLOCKED'); expect(result.blockers[0]?.code).toBe('baseline-artifact-invalid'); expect(JSON.stringify(result)).not.toContain(root);
  });
});
