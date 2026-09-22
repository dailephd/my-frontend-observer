import { describe, expect, it } from 'vitest';
import { BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND, BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION } from '../../src/domain/boundedAgentContext.js';
import { VISUAL_CHANGE_AGENT_HANDOFF_KIND, VISUAL_CHANGE_AGENT_HANDOFF_VERSION, isValidVisualChangeAgentHandoff, isValidVisualChangeExternalCoordination, serializeVisualChangeAgentHandoff, type VisualChangeAgentHandoff } from '../../src/domain/visualChangeAgentHandoff.js';
import { parsePrepareVisualChangeHandoffRequest } from '../../src/viewerServer/visualChangeHandoff.js';

const context = { artifactKind: BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND, schemaVersion: BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION, contextId: 'context-id', contextRequestId: 'context-request', producer: { name: 'my-frontend-observer' as const, version: '0.9.1' }, provenance: { generatedAt: '2026-09-22T00:00:00.000Z' }, projectionProfile: 'frontend-change-review' as const, sources: { observationIds: ['observation-id'] }, targets: [], adequacy: { state: 'adequate' as const, reasons: [] }, omissions: [], truncations: [] };
const handoff = (): VisualChangeAgentHandoff => ({ handoffKind: VISUAL_CHANGE_AGENT_HANDOFF_KIND, handoffVersion: VISUAL_CHANGE_AGENT_HANDOFF_VERSION, visualChangeRequestId: 'request-id', visualChangeWorkflowId: 'workflow-id', entryMode: 'actual-frontend', confirmedScope: { entryMode: 'actual-frontend', annotationId: 'annotation-id', baselineObservation: { observationId: 'observation-id', requestId: 'observation-request' }, baselineContract: { baselineId: 'baseline-id', clauses: [] }, changeContract: { contractId: 'change-id', contractRequestId: 'change-request', clauses: [] } }, boundedAgentContext: context, verificationPlan: ['Edit target source outside Observer.'], expectedPostEditCheck: { command: 'check', baselineAlias: 'baseline', json: true } });

describe('VisualChangeAgentHandoff contract', () => {
  it('uses the exact non-artifact kind/version, validates the closed bounded contract, and serializes deterministically with a newline', () => {
    const value = handoff(); expect(value.handoffKind).toBe('my-frontend-observer/visual-change-agent-handoff'); expect(value.handoffVersion).toBe('1.0.0'); expect(isValidVisualChangeAgentHandoff(value)).toBe(true);
    expect(serializeVisualChangeAgentHandoff(value)).toBe(serializeVisualChangeAgentHandoff(structuredClone(value))); expect(serializeVisualChangeAgentHandoff(value).endsWith('\n')).toBe(true);
    expect(isValidVisualChangeAgentHandoff({ ...value, projectRoot: 'C:/secret' })).toBe(false);
    expect(JSON.stringify(value)).not.toMatch(/screenshot|imageBytes|sourceText|artifactPath|token/i);
  });

  it('accepts only bounded opaque orchestrator correlation and changes no workflow semantics', () => {
    expect(isValidVisualChangeExternalCoordination({ provider: 'my-dev-kit-orchestrator', runId: 'run-123', packageVersion: '1.4.1' })).toBe(true);
    expect(isValidVisualChangeExternalCoordination({ provider: 'other', runId: 'run-123' })).toBe(false);
    expect(isValidVisualChangeExternalCoordination({ provider: 'my-dev-kit-orchestrator', runId: '../run' })).toBe(false);
    const coordinated = { ...handoff(), externalCoordination: { provider: 'my-dev-kit-orchestrator' as const, runId: 'run-123' } };
    expect(coordinated.visualChangeRequestId).toBe(handoff().visualChangeRequestId); expect(coordinated.confirmedScope).toEqual(handoff().confirmedScope);
  });

  it('parses only the closed optional coordination request', () => {
    expect(parsePrepareVisualChangeHandoffRequest({})).toEqual({ ok: true, request: {} });
    expect(parsePrepareVisualChangeHandoffRequest({ coordination: { provider: 'my-dev-kit-orchestrator', runId: 'run-1' } }).ok).toBe(true);
    expect(parsePrepareVisualChangeHandoffRequest({ projectRoot: 'C:/secret' }).ok).toBe(false);
    expect(parsePrepareVisualChangeHandoffRequest({ coordination: { provider: 'my-dev-kit-orchestrator', runId: '..\\run' } }).ok).toBe(false);
  });
});
