import path from 'node:path';
import { readVisualChangeWorkflowArtifact } from '../artifacts/visualChangeWorkflowArtifactReader.js';
import type { ExternalReferenceArtifact } from '../domain/externalReference.js';
import type { PersistentBaselineContract } from '../domain/frontendContracts.js';
import type { VisualChangeReviewState, VisualChangeWorkflowArtifact } from '../domain/visualChangeWorkflow.js';
import { prepareActiveVisualChangeWorkflow, persistProjectVisualChangeWorkflowRevision } from './visualChangeProjectWorkflowService.js';

export type VisualChangeReviewDecision = Exclude<VisualChangeReviewState, 'pending'>;
export type VisualChangeReviewFailureCode = 'workflow-invalid'|'no-attempts'|'invalid-transition'|'acceptance-requires-pass'|'workflow-inactive'|'workflow-restored'|'acceptance-drift'|'baseline-drift'|'governance-requires-accepted'|'governance-mismatch'|'governance-already-recorded'|'persistence-failure';
export type VisualChangeReviewResult = { ok: true; visualChangeRequestId: string; visualChangeWorkflowId: string; visualChangeAttemptId: string; review: { state: VisualChangeReviewDecision; decidedAt: string } } | { ok: false; code: VisualChangeReviewFailureCode; reason: string };
export type VisualChangeGovernanceInput = { kind: 'baseline-approval'; artifact: PersistentBaselineContract; artifactPath: string } | { kind: 'external-reference-approval'; artifact: ExternalReferenceArtifact; artifactPath: string };
export type VisualChangeGovernanceResult = { ok: true; visualChangeRequestId: string; visualChangeWorkflowId: string; kind: VisualChangeGovernanceInput['kind']; artifactId: string } | { ok: false; code: VisualChangeReviewFailureCode; reason: string };

const fail = (code: VisualChangeReviewFailureCode, reason: string): { ok: false; code: VisualChangeReviewFailureCode; reason: string } => ({ ok: false, code, reason });
async function load(projectRoot: string, manifestPath: string): Promise<{ ok: true; workflow: VisualChangeWorkflowArtifact } | { ok: false; code: VisualChangeReviewFailureCode; reason: string }> {
  const root = path.resolve(projectRoot); const absolute = path.resolve(root, manifestPath); const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return fail('workflow-invalid', 'workflow path is outside the project');
  const read = await readVisualChangeWorkflowArtifact(absolute); return read.ok ? { ok: true, workflow: read.artifact } : fail('workflow-invalid', read.reason);
}
function readinessCode(code: string): VisualChangeReviewFailureCode { return code === 'activation-not-configured' ? 'workflow-inactive' : code === 'activation-already-restored' ? 'workflow-restored' : code === 'baseline-drift' ? 'baseline-drift' : 'acceptance-drift'; }

export async function reviewVisualChangeWorkflow(input: { projectRoot: string; workflowManifestPath: string; decision: VisualChangeReviewDecision; now?: () => string }): Promise<VisualChangeReviewResult> {
  const loaded = await load(input.projectRoot, input.workflowManifestPath); if (!loaded.ok) return loaded; const source = loaded.workflow; const latest = source.attempts.at(-1); if (latest === undefined) return fail('no-attempts', 'workflow has no attempt to review');
  const current = latest.review.state;
  const allowed = current === 'pending' ? ['correction-requested','accepted','abandoned'].includes(input.decision) : current === 'correction-requested' && input.decision === 'abandoned';
  if (!allowed) return fail('invalid-transition', `review transition ${current} -> ${input.decision} is not allowed`);
  if (input.decision === 'accepted' && latest.check.status !== 'PASS') return fail('acceptance-requires-pass', 'only the latest canonical PASS attempt may be accepted');
  if (input.decision !== 'abandoned') { const ready = await prepareActiveVisualChangeWorkflow(input.projectRoot, input.workflowManifestPath); if (!ready.ok) return fail(readinessCode(ready.code), ready.reason); }
  const decidedAt = (input.now ?? (() => new Date().toISOString()))(); const review = { state: input.decision, decidedAt } as const;
  const attempts = source.attempts.map((attempt, index) => index === source.attempts.length - 1 ? { ...attempt, review } : attempt);
  const persisted = await persistProjectVisualChangeWorkflowRevision(input.projectRoot, source, { attempts });
  return persisted.ok ? { ok: true, visualChangeRequestId: persisted.visualChangeRequestId, visualChangeWorkflowId: persisted.visualChangeWorkflowId, visualChangeAttemptId: latest.visualChangeAttemptId, review } : fail('persistence-failure', 'review revision could not be persisted');
}

export async function recordVisualChangeGovernance(input: { projectRoot: string; workflowManifestPath: string; governance: VisualChangeGovernanceInput }): Promise<VisualChangeGovernanceResult> {
  const loaded = await load(input.projectRoot, input.workflowManifestPath); if (!loaded.ok) return loaded; const source = loaded.workflow; const latest = source.attempts.at(-1);
  if (latest?.review.state !== 'accepted') return fail('governance-requires-accepted', 'governance results may be recorded only after human acceptance');
  const existing = source.governanceResults ?? {};
  if (input.governance.kind === 'baseline-approval') {
    if (existing.baselineApproval !== undefined) return fail('governance-already-recorded', 'baseline approval is already recorded');
    const origin = input.governance.artifact.sourceObservation; if (origin.observationId !== latest.candidateObservation.observationId || origin.requestId !== latest.candidateObservation.requestId) return fail('governance-mismatch', 'baseline approval does not belong to the accepted candidate');
    const artifactId = input.governance.artifact.baselineId; const persisted = await persistProjectVisualChangeWorkflowRevision(input.projectRoot, source, { governanceResults: { ...existing, baselineApproval: { artifactId, artifactPath: input.governance.artifactPath } } });
    return persisted.ok ? { ok: true, visualChangeRequestId: persisted.visualChangeRequestId, visualChangeWorkflowId: persisted.visualChangeWorkflowId, kind: input.governance.kind, artifactId } : fail('persistence-failure', 'governance revision could not be persisted');
  }
  if (source.scope.entryMode !== 'reference') return fail('governance-mismatch', 'external-reference governance requires a reference workflow');
  if (existing.externalReferenceApproval !== undefined) return fail('governance-already-recorded', 'external-reference approval is already recorded');
  if (input.governance.artifact.lifecycle.state !== 'approved' || input.governance.artifact.supersedesReferenceId !== source.scope.approvedReference.referenceId) return fail('governance-mismatch', 'approved reference does not explicitly supersede the frozen reference');
  const artifactId = input.governance.artifact.referenceId; const persisted = await persistProjectVisualChangeWorkflowRevision(input.projectRoot, source, { governanceResults: { ...existing, externalReferenceApproval: { artifactId, artifactPath: input.governance.artifactPath } } });
  return persisted.ok ? { ok: true, visualChangeRequestId: persisted.visualChangeRequestId, visualChangeWorkflowId: persisted.visualChangeWorkflowId, kind: input.governance.kind, artifactId } : fail('persistence-failure', 'governance revision could not be persisted');
}
