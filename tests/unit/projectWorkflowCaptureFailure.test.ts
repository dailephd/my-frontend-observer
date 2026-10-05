import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALIAS_CATALOG_SCHEMA_VERSION, readAliasCatalog, writeAliasCatalog } from '../../src/projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, projectConfigPath, projectEvidenceRoot } from '../../src/projectWorkflow/projectPaths.js';

const observeMock = vi.fn(async () => ({ ok: false as const, diagnostics: [{ code: 'browser-runtime-failure' as const, severity: 'error' as const, message: 'fixture capture failed' }] }));
vi.mock('../../src/application/observationPersistence.js', () => ({ observe: (...args: unknown[]) => observeMock(...args) }));
const { captureCurrentObservation, captureNamedObservation } = await import('../../src/application/projectWorkflowService.js');
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('capture alias replacement transaction', () => {
  it('revalidates replay context through normalizeRequest before observing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'observer-capture-context-')); roots.push(root);
    await mkdir(projectEvidenceRoot(root), { recursive: true });
    await writeFile(projectConfigPath(root), JSON.stringify({ schemaVersion: '1.1.0', url: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 720 }, targets: [], defaultBaseline: 'baseline' }));
    await writeAliasCatalog(aliasCatalogPath(root), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: {} });
    observeMock.mockClear();
    const result = await captureCurrentObservation(root, { explicitState: { theme: 'not a valid label' } as never });
    expect(result).toMatchObject({ ok: false, code: 'project-config-invalid' });
    expect(observeMock).not.toHaveBeenCalled();
  });

  it('preserves the old alias record when the new canonical observation fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'observer-capture-failure-')); roots.push(root);
    await mkdir(projectEvidenceRoot(root), { recursive: true });
    await writeFile(projectConfigPath(root), JSON.stringify({ schemaVersion: '1.0.0', url: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 720 }, targets: [], defaultBaseline: 'baseline' }));
    const requestId = 'a'.repeat(64); const oldRecord = { observationId: `${requestId}-${'b'.repeat(32)}`, requestId, relativeArtifactDir: 'observations/baseline/old' };
    await writeAliasCatalog(aliasCatalogPath(root), { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: { baseline: oldRecord } });
    const result = await captureNamedObservation({ projectRoot: root, alias: 'baseline', replace: true });
    expect(result.ok).toBe(false); expect(observeMock).toHaveBeenCalledTimes(1);
    const after = await readAliasCatalog(aliasCatalogPath(root)); if (!after.ok) throw new Error(after.reason);
    expect(after.catalog.observations.baseline).toEqual(oldRecord);
  });
});
