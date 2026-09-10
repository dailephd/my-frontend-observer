/**
 * v0.8 Batch 7: the narrowest possible viewer-session context-input
 * boundary. `BoundedAgentContextArtifact` remains programmatic-only in the
 * current product workflow (no filesystem writer/reader contract exists for
 * it as an Observer evidence-root artifact family - see
 * `src/viewerServer/evidence/classify.ts`'s own comment on the "known but
 * unreadered" kind) - this module does not change that. It only inspects
 * and validates an explicit, caller-supplied JSON value (the parsed
 * contents of an operator-supplied `--context-file`) against the existing
 * canonical `isValidBoundedAgentContextArtifact` - never a second validator,
 * never a normalization/rewrite of the supplied value, never a call to
 * `projectBoundedAgentContext` or any correlation-derivation function.
 *
 * Byte-reading and JSON parsing remain owned by `src/cli.ts` (mirroring the
 * existing `loadBindingsFile` boundary exactly); this module receives only
 * the already-parsed JSON value.
 */
import { BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND, BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION, isValidBoundedAgentContextArtifact } from '../domain/boundedAgentContext.js';
import type { BoundedAgentContextArtifact } from '../domain/boundedAgentContext.js';

/**
 * Reuses the existing Batch 2 bounded manifest-read size limit
 * (`MAX_MANIFEST_CANDIDATE_BYTES`, 2,000,000 bytes) rather than inventing a
 * second bound: a `BoundedAgentContextArtifact` is, by its own frozen
 * contract, already far smaller than that in any realistic case (at most 25
 * targets, 25 correlation records with at most 5 candidates each, 15
 * fidelity mismatches, etc. - see `src/domain/boundedAgentContext.ts`'s own
 * `MAX_*` constants) - the same "generous headroom, never an arbitrarily
 * large read" rationale applies unchanged.
 */
export const MAX_CONTEXT_FILE_BYTES = 2_000_000;

/**
 * Session state for the bounded-agent-context the viewer was explicitly
 * started with. `'none'` when no `--context-file` was supplied at all -
 * every Batch 1-6 feature remains fully available in this state, and the
 * viewer never fabricates a context nor infers one from currently-selected
 * evidence. `'unsupported-version'` is a distinct, honest state for a
 * recognized-kind context whose `schemaVersion` is not the currently
 * supported one - never coerced into (or displayed as) the current shape.
 */
export type ContextSessionState =
  | { status: 'none' }
  | { status: 'unsupported-version'; foundSchemaVersion: string }
  | { status: 'valid'; artifact: BoundedAgentContextArtifact };

export type ClassifyContextFileResult = { ok: true; state: ContextSessionState } | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Classifies one already-parsed JSON value as an explicit `--context-file`
 * root (task §12: the file *is* one `BoundedAgentContextArtifact` value
 * directly - no wrapper object). Fails closed (a startup error, per task
 * §17) on a non-object root, a wrong `artifactKind`, or a current-schema
 * artifact that is structurally invalid. A recognized kind with a
 * different, non-current `schemaVersion` is reported as the honest
 * `'unsupported-version'` state rather than a failure (task §16) - the
 * caller (`runViewCommand`) still starts the viewer in that case.
 */
export function classifyContextFileContent(parsed: unknown): ClassifyContextFileResult {
  if (!isPlainObject(parsed)) {
    return { ok: false, error: '--context-file root must be a JSON object representing one BoundedAgentContextArtifact value directly (no wrapper object)' };
  }
  if (parsed.artifactKind !== BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND) {
    return { ok: false, error: `--context-file artifactKind must be "${BOUNDED_AGENT_CONTEXT_ARTIFACT_KIND}"; found ${JSON.stringify(parsed.artifactKind)}` };
  }
  if (parsed.schemaVersion !== BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION) {
    const foundSchemaVersion = typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : 'unknown';
    return { ok: true, state: { status: 'unsupported-version', foundSchemaVersion } };
  }
  const validation = isValidBoundedAgentContextArtifact(parsed);
  if (!validation.valid) {
    return { ok: false, error: `--context-file is not a structurally valid current (schemaVersion ${BOUNDED_AGENT_CONTEXT_SCHEMA_VERSION}) bounded-agent-context artifact: ${validation.reason}` };
  }
  return { ok: true, state: { status: 'valid', artifact: parsed as unknown as BoundedAgentContextArtifact } };
}
