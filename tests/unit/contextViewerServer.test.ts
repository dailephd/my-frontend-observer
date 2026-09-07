import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewerServer/viewerService.js';
import { classifyContextFileContent } from '../../src/viewerServer/context.js';
import { writeBoundedContextEvidenceFixture } from '../support/evidenceFixtures.js';
import { BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND, BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION } from '../../src/domain/boundedAgentContext.js';

const cleanupDirs: string[] = [];
const cleanupClosers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanupClosers.splice(0).map((close) => close()));
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-'));
  cleanupDirs.push(dir);
  return dir;
}

async function makeAssetsRoot(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-assets-'));
  cleanupDirs.push(parent);
  await writeFile(path.join(parent, 'index.html'), '<!doctype html><title>fixture shell</title>');
  return parent;
}

async function startFor(root: string, context?: import('../../src/viewerServer/context.js').ContextSessionState): Promise<{ url: string }> {
  const assetsRoot = await makeAssetsRoot();
  const result = await startViewer({ root, port: 0, assetsRoot, context });
  if (!result.ok) throw new Error(`expected server to start: ${JSON.stringify(result.diagnostics)}`);
  cleanupClosers.push(result.close);
  return { url: result.url };
}

describe('writeBoundedContextEvidenceFixture (canonical builder verification)', () => {
  it('produces genuine adequate/correlated/ambiguous/unavailable/fidelity states through the real canonical functions', async () => {
    const root = await makeRoot();
    const fixture = await writeBoundedContextEvidenceFixture(root);

    expect(fixture.baseContext.adequacy.state).toBe('adequate');
    expect(fixture.correlatedContext.correlations?.[0]?.status).toBe('correlated');
    expect(fixture.correlatedContext.correlations?.[0]?.candidates).toHaveLength(1);
    expect(fixture.ambiguousContext.correlations?.[0]?.status).toBe('ambiguous');
    expect(fixture.ambiguousContext.correlations?.[0]?.candidates.length).toBeGreaterThanOrEqual(2);
    expect(fixture.unavailableContext.correlations?.[0]?.status).toBe('unavailable');
    expect(fixture.unavailableContext.correlations?.[0]?.candidates).toEqual([]);
    expect(fixture.baseContext.correlations).toBeUndefined();

    expect(fixture.requiredOmissionContext.adequacy.state).not.toBe('adequate');
    expect(fixture.requiredOmissionContext.omissions.some((o) => o.subject.includes('nonexistent-target') && o.required)).toBe(true);

    const truncation = fixture.requiredTruncationContext.truncations.find((t) => t.subject === 'target:header.relationshipEvidence');
    expect(truncation).toBeDefined();
    expect(truncation?.actualCount).toBeGreaterThan(10);
    expect(truncation?.required).toBe(true);
    expect(fixture.requiredTruncationContext.adequacy.state).not.toBe('adequate');

    expect(fixture.baseContext.fidelity?.state).toBe('pass');
    expect(fixture.fidelityMismatchContext.fidelity?.state).toBe('fail');
    expect(fixture.fidelityMismatchContext.fidelity?.mismatches.length).toBeGreaterThan(0);
    expect(fixture.blockedFidelityContext.fidelity?.state).toBe('not-evaluated');
    expect(fixture.blockedFidelityContext.fidelity?.blockedBy).toBe('incompatible');
  });
});

describe('classifyContextFileContent', () => {
  it('accepts a real canonical context through isValidBoundedAgentContextArtifact', async () => {
    const root = await makeRoot();
    const fixture = await writeBoundedContextEvidenceFixture(root);
    const result = classifyContextFileContent(fixture.correlatedContext);
    expect(result).toEqual({ ok: true, state: { status: 'valid', artifact: fixture.correlatedContext } });
  });

  it('rejects the wrong artifactKind', () => {
    const result = classifyContextFileContent({ artifactKind: 'my-frontend-observer/observation', schemaVersion: '1.0.0' });
    expect(result.ok).toBe(false);
  });

  it('reports unsupported-version for a recognized kind with a future schema version, never as a failure', () => {
    const result = classifyContextFileContent({ artifactKind: BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND, schemaVersion: '2.0.0' });
    expect(result).toEqual({ ok: true, state: { status: 'unsupported-version', foundSchemaVersion: '2.0.0' } });
  });

  it('rejects a structurally invalid current-schema context', () => {
    const result = classifyContextFileContent({ artifactKind: BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND, schemaVersion: BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object root', () => {
    expect(classifyContextFileContent([1, 2, 3]).ok).toBe(false);
    expect(classifyContextFileContent('a string').ok).toBe(false);
    expect(classifyContextFileContent(null).ok).toBe(false);
  });
});

describe('GET /api/context', () => {
  it('reports status "none" when no --context-file was supplied', async () => {
    const root = await makeRoot();
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/context`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'none' });
  });

  it('reports status "unsupported-version" honestly, distinct from "none" and from a validated context', async () => {
    const root = await makeRoot();
    const { url } = await startFor(root, { status: 'unsupported-version', foundSchemaVersion: '2.0.0' });
    const response = await fetch(`${url}/api/context`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'unsupported-version', foundSchemaVersion: '2.0.0' });
  });

  it('returns the exact validated context artifact plus real exact-identity source resolution', async () => {
    const root = await makeRoot();
    const fixture = await writeBoundedContextEvidenceFixture(root);
    const { url } = await startFor(root, { status: 'valid', artifact: fixture.correlatedContext });

    const response = await fetch(`${url}/api/context`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      status: string;
      artifact: unknown;
      sourceResolution: {
        observations: { observationId: string; link: { status: string; handle?: string } }[];
        comparison?: { status: string; handle?: string };
        baselineContract?: { status: string; handle?: string };
        changeContract?: { status: string; handle?: string };
        evaluation?: { status: string; handle?: string };
        reference?: { status: string; handle?: string };
      };
    };
    expect(body.status).toBe('valid');
    expect(body.artifact).toEqual(fixture.correlatedContext);
    expect(body.sourceResolution.observations).toHaveLength(2);
    for (const o of body.sourceResolution.observations) expect(o.link.status).toBe('resolved');
    expect(body.sourceResolution.comparison?.status).toBe('resolved');
    expect(body.sourceResolution.baselineContract?.status).toBe('resolved');
    expect(body.sourceResolution.changeContract?.status).toBe('resolved');
    expect(body.sourceResolution.evaluation?.status).toBe('resolved');
    expect(body.sourceResolution.reference?.status).toBe('resolved');
  });

  it('reports a missing source honestly (never searches outside the evidence root, never fabricates a match)', async () => {
    const root = await makeRoot();
    const fixture = await writeBoundedContextEvidenceFixture(root);
    await rm(fixture.afterRoot, { recursive: true, force: true });
    const { url } = await startFor(root, { status: 'valid', artifact: fixture.baseContext });

    const response = await fetch(`${url}/api/context`);
    const body = (await response.json()) as { sourceResolution: { observations: { observationId: string; link: { status: string } }[] } };
    const afterLink = body.sourceResolution.observations.find((o) => o.observationId === 'ctx-after');
    expect(afterLink?.link.status).toBe('missing');
    const beforeLink = body.sourceResolution.observations.find((o) => o.observationId === 'ctx-before');
    expect(beforeLink?.link.status).toBe('resolved');
  });

  it('rejects write methods (405)', async () => {
    const root = await makeRoot();
    const { url } = await startFor(root);
    const response = await fetch(`${url}/api/context`, { method: 'POST' });
    expect(response.status).toBe(405);
  });
});
