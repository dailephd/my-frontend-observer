import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as persistence from '../../src/application/frontendContractPersistenceService.js';
import { promoteVisualAnnotationContract, contractPromotionBlockReason } from '../../src/application/visualAnnotationContractPromotionService.js';
import { buildClauseIdentity, buildFrontendContractRequestIdentity } from '../../src/domain/frontendContractIdentity.js';
import { readPerChangeContract } from '../../src/artifacts/frontendContractArtifactReader.js';
import { evaluateFrontendContract } from '../../src/domain/frontendContractEvaluation.js';
import { compareObservations } from '../../src/domain/comparisonEngine.js';
import type { ObservationArtifact } from '../../src/domain/schema.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem, VisualAnnotationSource } from '../../src/domain/visualAnnotation.js';
import type { PerChangeContract } from '../../src/domain/frontendContracts.js';
import { buildBaselineContract, buildChangeContract, buildObservation, matchedTarget, rect, target } from '../support/evidenceFixtures.js';
import { persistAnnotationUnder, readManifest, referenceSourceFor, runtimeSourceFor, writeAnnotatableEvidence } from '../support/annotationAuthoringFixtures.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mfo-annotation-promotion-'));
  roots.push(root);
  return root;
}

const WORKSPACE = { kind: 'runtime-target' as const, target: 'workspace' };

function confirmed(id: string, association: VisualAnnotationItem['association'], intent: Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>['intent']): VisualAnnotationItem {
  return {
    annotationItemId: id,
    mark: { kind: 'rectangle', x: 10, y: 10, width: 50, height: 40 },
    ...(association === undefined ? {} : { association }),
    interpretation: { state: 'confirmed', intent, confirmedAt: '2026-09-17T00:00:00.000Z' },
  };
}

const moveRight = (id = 'move', association: VisualAnnotationItem['association'] = WORKSPACE) =>
  confirmed(id, association, { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'workspace', property: 'x' } });
const resizeWider = (id = 'resize') =>
  confirmed(id, WORKSPACE, { kind: 'change', operation: 'resize', category: 'expected-dependent', expectedDependentMode: 'required', contractPrimitive: { kind: 'property-increases', target: 'workspace', property: 'width' } });
const preserveHeight = (id = 'preserve') =>
  confirmed(id, WORKSPACE, { kind: 'change', operation: 'preserve', category: 'protected', contractPrimitive: { kind: 'property-unchanged-within-tolerance', target: 'workspace', property: 'height', tolerance: { kind: 'absolute-px', amount: 2 } } });

async function runtimeFixture(items: VisualAnnotationItem[]) {
  const root = await makeRoot();
  const evidence = await writeAnnotatableEvidence(root);
  const saved = await persistAnnotationUnder(root, runtimeSourceFor(evidence.observation), items);
  const annotation = await readManifest<VisualAnnotationArtifact>(saved.artifactRoot);
  return { root, evidence, annotation };
}

describe('promoteVisualAnnotationContract', () => {
  it('persists one canonical PerChangeContract from selected items only, in selection order, through the canonical persistence service', async () => {
    const { root, evidence, annotation } = await runtimeFixture([moveRight(), resizeWider(), preserveHeight()]);
    const persistSpy = vi.spyOn(persistence, 'persistPerChangeContract');

    const result = await promoteVisualAnnotationContract({ annotation, sourceObservation: evidence.observation, selectedItemIds: ['preserve', 'move'], activeBaselineIds: ['baseline-1'], outputLocation: 'contracts', cwd: root });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(result.clauseCount).toBe(2);

    const read = await readPerChangeContract(result.manifestPath);
    if (!read.ok) throw new Error(read.reason);
    const contract = read.contract;
    const preservePrimitive = (preserveHeight().interpretation as { intent: { contractPrimitive: PerChangeContract['clauses'][number]['primitive'] } }).intent.contractPrimitive;
    const movePrimitive = (moveRight().interpretation as { intent: { contractPrimitive: PerChangeContract['clauses'][number]['primitive'] } }).intent.contractPrimitive;
    expect(contract).toEqual({
      artifactKind: 'my-frontend-observer/frontend-contract',
      schemaVersion: '1.0.0',
      contractClass: 'change',
      contractId: result.contractId,
      contractRequestId: buildFrontendContractRequestIdentity(evidence.observation.observationId, [{ primitive: preservePrimitive }, { primitive: movePrimitive }], []),
      activeBaselineIds: ['baseline-1'],
      clauses: [
        {
          clauseId: buildClauseIdentity(preservePrimitive),
          category: 'protected',
          primitive: preservePrimitive,
          supportingEvidence: [{ path: `visualAnnotation.${annotation.annotationId}.source` }, { path: `visualAnnotation.${annotation.annotationId}.items.preserve` }],
        },
        {
          clauseId: buildClauseIdentity(movePrimitive),
          category: 'requested',
          primitive: movePrimitive,
          supportingEvidence: [{ path: `visualAnnotation.${annotation.annotationId}.source` }, { path: `visualAnnotation.${annotation.annotationId}.items.move` }],
        },
      ],
    });
    expect(result.contractId.startsWith(`${result.contractRequestId}-`)).toBe(true);

    const again = await promoteVisualAnnotationContract({ annotation, sourceObservation: evidence.observation, selectedItemIds: ['preserve', 'move'], activeBaselineIds: ['baseline-1'], outputLocation: 'contracts', cwd: root });
    if (!again.ok) throw new Error(again.reason);
    expect(again.contractRequestId).toBe(result.contractRequestId);
    expect(again.contractId).not.toBe(result.contractId);
  });

  it('preserves expected-dependent mode and an empty activeBaselineIds list', async () => {
    const { root, evidence, annotation } = await runtimeFixture([resizeWider()]);
    const result = await promoteVisualAnnotationContract({ annotation, sourceObservation: evidence.observation, selectedItemIds: ['resize'], activeBaselineIds: [], outputLocation: 'contracts', cwd: root });
    if (!result.ok) throw new Error(result.reason);
    const read = await readPerChangeContract(result.manifestPath);
    if (!read.ok) throw new Error(read.reason);
    expect(read.contract.activeBaselineIds).toEqual([]);
    expect(read.contract.clauses[0]).toMatchObject({ category: 'expected-dependent', expectedDependentMode: 'required' });
    expect('supersedesBaselineClauseIds' in (read.contract.clauses[0] as object)).toBe(false);
  });

  it('rejects reference sources and any observation that is not the exact annotation source', async () => {
    const { root, evidence, annotation } = await runtimeFixture([moveRight()]);
    const referenceAnnotation = await persistAnnotationUnder(root, referenceSourceFor(evidence.imported), [{ annotationItemId: 'r', mark: { kind: 'point', x: 1, y: 1 }, interpretation: { state: 'uninterpreted' } }]);
    const reference = await readManifest<VisualAnnotationArtifact>(referenceAnnotation.artifactRoot);
    const options = { selectedItemIds: ['move'], activeBaselineIds: [], outputLocation: 'contracts', cwd: root };

    expect(await promoteVisualAnnotationContract({ ...options, annotation: reference, sourceObservation: evidence.observation })).toMatchObject({ ok: false, code: 'unsupported-source' });
    const other: ObservationArtifact[] = [
      { ...evidence.observation, observationId: 'another' },
      { ...evidence.observation, requestId: 'another' },
      { ...evidence.observation, requestConfig: { ...evidence.observation.requestConfig, viewport: { width: 801, height: 600 } } },
      { ...evidence.observation, screenshot: { state: 'available', source: 'browser', value: { path: 'other.png' } } },
    ];
    for (const sourceObservation of other) {
      expect(await promoteVisualAnnotationContract({ ...options, annotation, sourceObservation })).toMatchObject({ ok: false, code: 'source-mismatch' });
    }
    expect(await readdir(root)).not.toContain('contracts');
  });

  it('rejects the whole promotion for an invalid selection and never writes a partial contract', async () => {
    const candidate: VisualAnnotationItem = { ...moveRight('candidate'), interpretation: { state: 'candidate', intent: (moveRight().interpretation as { intent: never }).intent } };
    const inspect = confirmed('inspect', undefined, { kind: 'inspect' });
    const remove = confirmed('remove', WORKSPACE, { kind: 'change', operation: 'remove', category: 'requested' });
    const uninterpreted: VisualAnnotationItem = { annotationItemId: 'plain', mark: { kind: 'point', x: 1, y: 1 }, interpretation: { state: 'uninterpreted' } };
    const unbound = confirmed('unbound', undefined, { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'workspace', property: 'x' } });
    const mismatch = moveRight('mismatch', { kind: 'runtime-target', target: 'header' });
    const wrongOperation = confirmed('wrong-op', WORKSPACE, { kind: 'change', operation: 'move', category: 'requested', contractPrimitive: { kind: 'property-increases', target: 'workspace', property: 'width' } });
    const { root, evidence, annotation } = await runtimeFixture([moveRight(), candidate, inspect, remove, uninterpreted, unbound, mismatch, wrongOperation]);

    for (const selectedItemIds of [[], ['move', 'move'], ['missing'], ['move', 'candidate'], ['inspect'], ['move', 'remove'], ['plain'], ['unbound'], ['mismatch'], ['wrong-op']]) {
      const result = await promoteVisualAnnotationContract({ annotation, sourceObservation: evidence.observation, selectedItemIds, activeBaselineIds: [], outputLocation: 'contracts', cwd: root });
      expect(result, JSON.stringify(selectedItemIds)).toMatchObject({ ok: false, code: 'invalid-selection' });
    }
    expect(await readdir(root)).not.toContain('contracts');
    expect(contractPromotionBlockReason(remove)).toContain('target-absent');
  });

  it('keeps the existing evaluator authoritative: a promoted clause evaluates exactly like an equivalent hand-authored contract', async () => {
    const root = await makeRoot();
    const before = buildObservation('obs-before', [target('workspace')], { workspace: matchedTarget(rect(200, 0, 600, 600)) });
    const after = buildObservation('obs-after', [target('workspace')], { workspace: matchedTarget(rect(200, 0, 650, 600)) });
    const source: VisualAnnotationSource = runtimeSourceFor(before);
    const saved = await persistAnnotationUnder(root, source, [resizeWider('wider'), preserveHeight('keep-height')]);
    const annotation = await readManifest<VisualAnnotationArtifact>(saved.artifactRoot);
    const baseline = buildBaselineContract();

    const promoted = await promoteVisualAnnotationContract({ annotation, sourceObservation: before, selectedItemIds: ['wider', 'keep-height'], activeBaselineIds: [baseline.baselineId], outputLocation: 'contracts', cwd: root });
    if (!promoted.ok) throw new Error(promoted.reason);
    const read = await readPerChangeContract(promoted.manifestPath);
    if (!read.ok) throw new Error(read.reason);

    const manual = buildChangeContract({
      clauses: read.contract.clauses.map((clause) => ({ clauseId: clause.clauseId, category: clause.category, ...(clause.expectedDependentMode === undefined ? {} : { expectedDependentMode: clause.expectedDependentMode }), primitive: clause.primitive, supportingEvidence: [] })),
    });
    const comparison = compareObservations(before, after);
    if (!comparison.ok) throw new Error(comparison.reason);

    const fromAnnotation = evaluateFrontendContract({ before, after, comparison: comparison.artifact, baseline, change: read.contract });
    const handAuthored = evaluateFrontendContract({ before, after, comparison: comparison.artifact, baseline, change: manual });
    if (!fromAnnotation.ok || !handAuthored.ok) throw new Error('expected both evaluations to be constructible');
    expect(fromAnnotation.evaluation.overallVerdict).toBe(handAuthored.evaluation.overallVerdict);
    expect(fromAnnotation.evaluation.clauseResults.map((r) => [r.clauseId, r.status])).toEqual(handAuthored.evaluation.clauseResults.map((r) => [r.clauseId, r.status]));
    // workspace width 600 -> 650 genuinely increases; height genuinely unchanged.
    expect(fromAnnotation.evaluation.clauseResults.map((r) => r.status)).toEqual(['pass', 'pass']);
  });
});
