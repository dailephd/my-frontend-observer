import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { VisualChangeWorkflowArtifact, VisualChangeReferenceScope } from '../domain/visualChangeWorkflow.js';
import { VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND, VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION, isValidVisualChangeWorkflowArtifact } from '../domain/visualChangeWorkflow.js';
import { computeVisualChangeBindingsSha256, serializeVisualChangeBindings, VISUAL_CHANGE_WORKFLOW_BINDINGS_FILENAME } from './visualChangeWorkflowArtifactWriter.js';
export type ReadVisualChangeWorkflowArtifactResult = { ok: true; artifact: VisualChangeWorkflowArtifact } | { ok: false; reason: string };
export async function readVisualChangeWorkflowArtifact(manifestPath: string): Promise<ReadVisualChangeWorkflowArtifactResult> {
  let parsed: unknown; try { parsed = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { return { ok: false, reason: `failed to read or parse visual-change workflow manifest: ${error instanceof Error ? error.message : String(error)}` }; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, reason: 'visual-change workflow manifest must be an object' };
  const envelope = parsed as Record<string, unknown>;
  if (envelope.artifactKind !== VISUAL_CHANGE_WORKFLOW_ARTIFACT_KIND) return { ok: false, reason: 'visual-change workflow artifact kind mismatch' };
  if (envelope.schemaVersion !== VISUAL_CHANGE_WORKFLOW_SCHEMA_VERSION) return { ok: false, reason: `unsupported visual-change workflow schema version "${String(envelope.schemaVersion)}"` };
  const validation = isValidVisualChangeWorkflowArtifact(parsed); if (!validation.valid) return { ok: false, reason: `visual-change workflow structural validation failed: ${validation.reason}` };
  const artifact = parsed as VisualChangeWorkflowArtifact;
  if (artifact.scope.entryMode === 'reference') {
    if (artifact.bindings?.path !== VISUAL_CHANGE_WORKFLOW_BINDINGS_FILENAME) return { ok: false, reason: 'unsupported bindings path' };
    const bindingsPath = path.join(path.dirname(manifestPath), VISUAL_CHANGE_WORKFLOW_BINDINGS_FILENAME);
    try {
      const info = await lstat(bindingsPath); if (!info.isFile()) return { ok: false, reason: 'bindings.json is not a regular file' };
      const bytes = await readFile(bindingsPath); if (computeVisualChangeBindingsSha256(bytes) !== artifact.bindings.sha256) return { ok: false, reason: 'bindings.json digest mismatch' };
      const declarations = JSON.parse(bytes.toString('utf8')) as unknown;
      if (serializeVisualChangeBindings(declarations as readonly unknown[]) !== bytes.toString('utf8')) return { ok: false, reason: 'bindings.json is not canonical' };
      if (JSON.stringify(declarations) !== JSON.stringify((artifact.scope as VisualChangeReferenceScope).bindings) || !Array.isArray(declarations) || declarations.length !== artifact.bindings.declarationCount) return { ok: false, reason: 'bindings.json declarations/count do not match manifest scope' };
    } catch (error) { return { ok: false, reason: `failed to verify bindings.json: ${error instanceof Error ? error.message : String(error)}` }; }
  }
  return { ok: true, artifact };
}
