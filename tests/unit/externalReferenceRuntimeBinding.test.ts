import { describe, expect, it } from 'vitest';
import {
  MAX_REFERENCE_RUNTIME_BINDINGS,
  isValidReferenceRuntimeBindingDeclarations,
  evaluateReferenceRuntimeBindings,
} from '../../src/domain/externalReferenceRuntimeBinding.js';
import type { ReferenceRuntimeBindingDeclaration } from '../../src/domain/externalReferenceRuntimeBinding.js';
import { EXTERNAL_REFERENCE_ARTIFACT_KIND, EXTERNAL_REFERENCE_SCHEMA_VERSION } from '../../src/domain/externalReference.js';
import type { ImportedExternalReferenceArtifact } from '../../src/domain/externalReference.js';
import type { ReferenceRegion } from '../../src/domain/externalReferenceRegions.js';
import type { ExternalReferenceApplicability } from '../../src/domain/externalReferenceApplicability.js';
import { ARTIFACT_KIND, SCHEMA_VERSION, PRODUCER_NAME } from '../../src/domain/schema.js';
import type { ObservationArtifact, TargetEvidenceRecord, TargetResolution, TargetSelectionStatus } from '../../src/domain/schema.js';
import type { NamedTarget } from '../../src/request/request.js';
import type { ExplicitStateDimensions } from '../../src/domain/explicitState.js';

function region(id: string): ReferenceRegion {
  return { id, rectangle: { x: 0, y: 0, width: 100, height: 40 } };
}

function reference(regions: ReferenceRegion[] = [region('header')], applicability?: ExternalReferenceApplicability): ImportedExternalReferenceArtifact {
  return {
    artifactKind: EXTERNAL_REFERENCE_ARTIFACT_KIND,
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION,
    referenceRequestId: 'ref-req-1',
    referenceId: 'ref-req-1-instance-1',
    producer: { name: 'my-frontend-observer', version: '0.6.0' },
    provenance: { importedAt: '2026-01-01T00:00:00.000Z' },
    image: { path: 'reference.png', format: 'png', width: 1920, height: 1080, byteLength: 41, sha256: 'a'.repeat(64) },
    lifecycle: { state: 'imported' },
    diagnostics: [],
    completion: { state: 'complete' },
    ...(regions.length > 0 ? { regions } : {}),
    ...(applicability !== undefined ? { applicability } : {}),
  };
}

function referenceWithoutRegions(applicability?: ExternalReferenceApplicability): ImportedExternalReferenceArtifact {
  const r = reference([], applicability);
  return r;
}

function target(name: string): NamedTarget {
  return { name, locators: [{ kind: 'css', selector: `#${name}` }] };
}

function resolution(status: TargetSelectionStatus): TargetResolution {
  return {
    selectionMethod: 'ordered-locators',
    selectionStatus: status,
    ...(status === 'matched' ? { selectedLocatorKind: 'css' as const, selectedLocatorIndex: 0 } : {}),
    usedFallback: false,
    confidence: status === 'matched' ? 'exact' : 'none',
    attempts: [{ locatorIndex: 0, locatorKind: 'css', status, matchCount: status === 'matched' ? 1 : status === 'ambiguous' ? 2 : 0 }],
  };
}

function matchedTargetRecord(visible = true): TargetEvidenceRecord {
  return {
    resolution: { state: 'available', source: 'derived', value: resolution('matched'), derivedFrom: ['locator-attempts'] },
    tag: { state: 'available', source: 'browser', value: 'div' },
    geometry: { state: 'available', source: 'browser', value: { x: 0, y: 0, width: 100, height: 40, right: 100, bottom: 40 } },
    style: { state: 'available', source: 'computed-browser', value: { display: 'block', position: 'static', overflowX: 'visible', overflowY: 'visible' } },
    layout: { state: 'available', source: 'browser', value: { scrollWidth: 100, scrollHeight: 40, clientWidth: 100, clientHeight: 40, scrollTop: 0, scrollLeft: 0 } },
    visibility: { state: 'available', source: 'derived', value: { visible }, derivedFrom: ['style.display'] },
    semantics: { state: 'not-applicable' },
    semanticState: { state: 'not-applicable' },
    landmark: { state: 'not-applicable' },
    containment: { state: 'available', source: 'browser', value: { containedByTargetIds: [], evaluatedTargetIds: [], unresolvedTargetIds: [] } },
  };
}

function unresolvedTargetRecord(status: 'not-found' | 'ambiguous' | 'unavailable'): TargetEvidenceRecord {
  const reason = `target ${status}`;
  return {
    resolution: { state: 'available', source: 'derived', value: resolution(status), derivedFrom: ['locator-attempts'] },
    tag: { state: 'unavailable', reason },
    geometry: { state: 'unavailable', reason },
    style: { state: 'unavailable', reason },
    layout: { state: 'unavailable', reason },
    visibility: { state: 'unavailable', reason },
    semantics: { state: 'unavailable', reason },
    semanticState: { state: 'unavailable', reason },
    landmark: { state: 'unavailable', reason },
    containment: { state: 'unavailable', reason },
  };
}

function evidenceUnavailableRecord(): TargetEvidenceRecord {
  const reason = 'resolution evidence unavailable';
  return {
    resolution: { state: 'unavailable', reason },
    tag: { state: 'unavailable', reason },
    geometry: { state: 'unavailable', reason },
    style: { state: 'unavailable', reason },
    layout: { state: 'unavailable', reason },
    visibility: { state: 'unavailable', reason },
    semantics: { state: 'unavailable', reason },
    semanticState: { state: 'unavailable', reason },
    landmark: { state: 'unavailable', reason },
    containment: { state: 'unavailable', reason },
  };
}

function candidate(
  targets: NamedTarget[],
  targetEvidence: Record<string, TargetEvidenceRecord>,
  viewport: { width: number; height: number } = { width: 1280, height: 720 },
  explicitState?: ExplicitStateDimensions,
): ObservationArtifact {
  return {
    artifactKind: ARTIFACT_KIND,
    schemaVersion: SCHEMA_VERSION,
    observationId: 'obs-1',
    requestId: 'req-1',
    producer: { name: PRODUCER_NAME, version: '0.7.0' },
    browser: { state: 'not-applicable' },
    requestConfig: {
      targetUrl: 'http://localhost/',
      viewport,
      targets,
      outputLocation: 'observations',
      timeoutMs: 30000,
      readiness: { condition: 'load', timeoutMs: 10000 },
      ...(explicitState !== undefined ? { explicitState } : {}),
    },
    provenance: { capturedAt: new Date(0).toISOString(), observationMethod: 'test-fixture' },
    pageEvidence: {},
    targetEvidence,
    screenshot: { state: 'not-applicable' },
    completion: { state: 'complete' },
    diagnostics: [],
    limits: { truncated: false, omittedFields: [], omittedTargets: [] },
    artifactReferences: [],
  };
}

function binding(referenceRegion: string, runtimeTarget: string): ReferenceRuntimeBindingDeclaration {
  return { referenceRegion, runtimeTarget };
}

describe('isValidReferenceRuntimeBindingDeclarations', () => {
  it('accepts a valid single declaration', () => {
    expect(isValidReferenceRuntimeBindingDeclarations([binding('header', 'popup-header')], reference())).toEqual({ valid: true });
  });

  it('accepts an empty declaration collection', () => {
    expect(isValidReferenceRuntimeBindingDeclarations([], reference())).toEqual({ valid: true });
  });

  it('rejects a non-array value', () => {
    expect(isValidReferenceRuntimeBindingDeclarations({}, reference()).valid).toBe(false);
  });

  it('rejects more than MAX_REFERENCE_RUNTIME_BINDINGS declarations', () => {
    const many = Array.from({ length: MAX_REFERENCE_RUNTIME_BINDINGS + 1 }, (_, i) => binding(`r${i}`, `t${i}`));
    const ref = reference(Array.from({ length: MAX_REFERENCE_RUNTIME_BINDINGS + 1 }, (_, i) => region(`r${i}`)));
    expect(isValidReferenceRuntimeBindingDeclarations(many, ref).valid).toBe(false);
  });

  it('accepts exactly MAX_REFERENCE_RUNTIME_BINDINGS declarations', () => {
    const many = Array.from({ length: MAX_REFERENCE_RUNTIME_BINDINGS }, (_, i) => binding(`r${i}`, `t${i}`));
    const ref = reference(Array.from({ length: MAX_REFERENCE_RUNTIME_BINDINGS }, (_, i) => region(`r${i}`)));
    expect(isValidReferenceRuntimeBindingDeclarations(many, ref)).toEqual({ valid: true });
  });

  it('rejects a malformed declaration shape (missing field, wrong type, unknown field)', () => {
    expect(isValidReferenceRuntimeBindingDeclarations([{ referenceRegion: 'header' }], reference()).valid).toBe(false);
    expect(isValidReferenceRuntimeBindingDeclarations([{ referenceRegion: 1, runtimeTarget: 'x' }], reference()).valid).toBe(false);
    expect(isValidReferenceRuntimeBindingDeclarations([{ referenceRegion: 'header', runtimeTarget: 'x', extra: true }], reference()).valid).toBe(false);
  });

  // Behavior B / O: unknown reference region and a reference with no regions at all both fail closed.
  it('rejects a binding to a nonexistent reference region', () => {
    const result = isValidReferenceRuntimeBindingDeclarations([binding('does-not-exist', 'popup-header')], reference());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('does-not-exist');
  });

  it('O: fails closed for a reference with no regions declared at all', () => {
    expect(isValidReferenceRuntimeBindingDeclarations([binding('header', 'popup-header')], referenceWithoutRegions()).valid).toBe(false);
  });

  // Behavior I/J: duplicate identical and conflicting declarations are both rejected identically.
  it('I: rejects an exact duplicate declaration for the same reference region', () => {
    const result = isValidReferenceRuntimeBindingDeclarations([binding('header', 'popup-header'), binding('header', 'popup-header')], reference());
    expect(result.valid).toBe(false);
  });

  it('J: rejects a conflicting declaration mapping the same reference region to two different targets, never silently choosing the first', () => {
    const result = isValidReferenceRuntimeBindingDeclarations([binding('header', 'popup-header'), binding('header', 'other-target')], reference());
    expect(result.valid).toBe(false);
  });

  // Behavior K: multiple distinct reference regions may bind to the same runtime target.
  it('K: allows two distinct reference regions to bind to the same runtime target', () => {
    const ref = reference([region('header-logo'), region('header-nav')]);
    const result = isValidReferenceRuntimeBindingDeclarations([binding('header-logo', 'header'), binding('header-nav', 'header')], ref);
    expect(result).toEqual({ valid: true });
  });

  // Behavior P: unused regions are fine - not every region needs a binding.
  it('P: does not require every reference region to have a binding', () => {
    const ref = reference([region('header'), region('footer')]);
    expect(isValidReferenceRuntimeBindingDeclarations([binding('header', 'popup-header')], ref)).toEqual({ valid: true });
  });

  it('reference-region matching is case-insensitive, mirroring existing region-id dedup convention', () => {
    const ref = reference([region('Header')]);
    expect(isValidReferenceRuntimeBindingDeclarations([binding('header', 'popup-header')], ref)).toEqual({ valid: true });
  });
});

describe('evaluateReferenceRuntimeBindings', () => {
  // Behavior A / H: a valid explicit binding with different reference/runtime ID strings.
  it('A/H: reports bound for a valid explicit binding with different reference-region and runtime-target ids', () => {
    const ref = reference([region('current-page-card')]);
    const cand = candidate([target('popup-current-page')], { 'popup-current-page': matchedTargetRecord() });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('current-page-card', 'popup-current-page')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings).toEqual([
      expect.objectContaining({ referenceRegion: 'current-page-card', runtimeTarget: 'popup-current-page', status: 'bound' }),
    ]);
  });

  // Behavior G: identical string ids in both domains bind only because of the explicit declaration, not because the names match.
  it('G: identical reference-region and runtime-target strings bind only via explicit declaration', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('header')], { header: matchedTargetRecord() });
    const withDeclaration = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'header')]);
    expect(withDeclaration.ok).toBe(true);
    if (!withDeclaration.ok) throw new Error('expected ok');
    expect(withDeclaration.evaluation.bindings[0]?.status).toBe('bound');

    const withoutDeclaration = evaluateReferenceRuntimeBindings(ref, cand, []);
    expect(withoutDeclaration.ok).toBe(true);
    if (!withoutDeclaration.ok) throw new Error('expected ok');
    expect(withoutDeclaration.evaluation.bindings).toEqual([]);
  });

  // Behavior B: unknown reference region fails the whole evaluation closed (structural, candidate-independent).
  it('B: an unknown reference region fails the evaluation closed, never producing a bound result', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('does-not-exist', 'popup-header')]);
    expect(result.ok).toBe(false);
  });

  // Behavior C / 21: unknown runtime target (not part of the candidate's configured target set) is unavailable, never dynamically searched.
  it('C: an unknown runtime target (not configured on this candidate) is reported unavailable', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('unrelated-target')], { 'unrelated-target': matchedTargetRecord() });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings[0]).toMatchObject({ status: 'unavailable', reasonCode: 'runtime-target-not-configured' });
  });

  // Behavior D: the candidate's own configured target resolved ambiguously - never reported bound.
  it('D: an ambiguously resolved runtime target is reported ambiguous, never bound', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': unresolvedTargetRecord('ambiguous') });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings[0]).toMatchObject({ status: 'ambiguous', reasonCode: 'runtime-target-ambiguous' });
  });

  it('a configured target that resolved not-found is reported unavailable, distinct from evidence-unavailable', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': unresolvedTargetRecord('not-found') });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings[0]).toMatchObject({ status: 'unavailable', reasonCode: 'runtime-target-not-found' });
  });

  // Behavior E: unavailable target evidence (no resolution evidence at all).
  it('E: unavailable target-resolution evidence is reported unavailable', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': evidenceUnavailableRecord() });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings[0]).toMatchObject({ status: 'unavailable', reasonCode: 'runtime-target-evidence-unavailable' });
    expect(result.evaluation.bindings[0]?.targetResolutionStatus).toBeUndefined();
  });

  it('a configured target entirely missing from targetEvidence is reported unavailable', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], {});
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings[0]).toMatchObject({ status: 'unavailable', reasonCode: 'runtime-target-evidence-unavailable' });
  });

  // Behavior F: incompatible reference/candidate state blocks ordinary binding evaluation entirely.
  it('F: an incompatible reference/candidate viewport blocks ordinary binding evaluation - no bound result fabricated', () => {
    const ref = reference([region('header')], { viewport: { width: 1280, height: 720 } });
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() }, { width: 375, height: 812 });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.compatibility.state).toBe('incomparable');
    expect(result.evaluation.bindings).toEqual([]);
  });

  it('matching compatibility permits ordinary binding evaluation to proceed', () => {
    const ref = reference([region('header')], { viewport: { width: 1280, height: 720 } });
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() }, { width: 1280, height: 720 });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.compatibility.state).toBe('comparable');
    expect(result.evaluation.bindings).toHaveLength(1);
    expect(result.evaluation.bindings[0]?.status).toBe('bound');
  });

  // Q: hidden target - identity binding proceeds; visibility is provenance only.
  it('Q: a hidden but uniquely resolved runtime target is still reported bound, with targetVisible: false as provenance', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord(false) });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings[0]).toMatchObject({ status: 'bound', targetVisible: false });
  });

  // M: deterministic ordering - authored declaration order is preserved.
  it('M: preserves authored declaration order in the result', () => {
    const ref = reference([region('header'), region('footer')]);
    const cand = candidate(
      [target('popup-header'), target('popup-footer')],
      { 'popup-header': matchedTargetRecord(), 'popup-footer': matchedTargetRecord() },
    );
    const declarations = [binding('footer', 'popup-footer'), binding('header', 'popup-header')];
    const result = evaluateReferenceRuntimeBindings(ref, cand, declarations);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings.map((b) => b.referenceRegion)).toEqual(['footer', 'header']);
  });

  it('M: same input produces the same result ordering and content, repeatedly (pure function)', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() });
    const declarations = [binding('header', 'popup-header')];
    const first = evaluateReferenceRuntimeBindings(ref, cand, declarations);
    const second = evaluateReferenceRuntimeBindings(ref, cand, declarations);
    expect(first).toEqual(second);
  });

  // N: immutability of all three inputs.
  it('N: never mutates the reference artifact, the candidate observation, or the declaration input', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() });
    const declarations = [binding('header', 'popup-header')];
    const refSnapshot = JSON.parse(JSON.stringify(ref));
    const candSnapshot = JSON.parse(JSON.stringify(cand));
    const declSnapshot = JSON.parse(JSON.stringify(declarations));

    evaluateReferenceRuntimeBindings(ref, cand, declarations);

    expect(ref).toEqual(refSnapshot);
    expect(cand).toEqual(candSnapshot);
    expect(declarations).toEqual(declSnapshot);
  });

  // Runtime-target name resolution is case-insensitive, mirroring the existing target-scroll-by resolution convention.
  it('resolves a declared runtime target case-insensitively against the candidate\'s configured target name', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('Popup-Header')], { 'Popup-Header': matchedTargetRecord() });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.bindings[0]?.status).toBe('bound');
  });

  it('provides full provenance: reference/candidate identity carried through the evaluation result', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.evaluation.referenceId).toBe(ref.referenceId);
    expect(result.evaluation.referenceRequestId).toBe(ref.referenceRequestId);
    expect(result.evaluation.candidateObservationId).toBe(cand.observationId);
    expect(result.evaluation.candidateRequestId).toBe(cand.requestId);
  });

  it('fails closed for a structurally invalid reference artifact', () => {
    const ref = { ...reference(), schemaVersion: '2.0.0' } as unknown as ImportedExternalReferenceArtifact;
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(false);
  });

  it('fails closed for a structurally invalid candidate observation', () => {
    const ref = reference([region('header')]);
    const cand = { ...candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() }), schemaVersion: '9.9.9' } as unknown as ObservationArtifact;
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(false);
  });

  it('does not produce any source-ownership field on its result', () => {
    const ref = reference([region('header')]);
    const cand = candidate([target('popup-header')], { 'popup-header': matchedTargetRecord() });
    const result = evaluateReferenceRuntimeBindings(ref, cand, [binding('header', 'popup-header')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const serialized = JSON.stringify(result.evaluation);
    for (const forbidden of ['sourceOwner', 'sourceFile', 'component', 'symbol', 'causedBy']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
