import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Diagnostic } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import type { VisualChangeWorkflowArtifact } from '../domain/visualChangeWorkflow.js';
import { isValidVisualChangeWorkflowArtifact } from '../domain/visualChangeWorkflow.js';
import { canonicalVisualChangeJson } from '../domain/visualChangeWorkflowIdentity.js';

export const VISUAL_CHANGE_WORKFLOW_MANIFEST_FILENAME = 'manifest.json';
export const VISUAL_CHANGE_WORKFLOW_BINDINGS_FILENAME = 'bindings.json';
export interface WriteVisualChangeWorkflowArtifactOptions { cwd?: string; beforeRename?: (tempRoot: string) => void | Promise<void> }
export type PersistedVisualChangeWorkflowResult = { ok: true; artifactRoot: string; manifestPath: string; bindingsPath?: string } | { ok: false; diagnostics: Diagnostic[] };
export function computeVisualChangeBindingsSha256(bytes: string | Uint8Array): string { return createHash('sha256').update(typeof bytes === 'string' ? Buffer.from(bytes) : bytes).digest('hex'); }
export function serializeVisualChangeBindings(bindings: readonly unknown[]): string { return `${canonicalVisualChangeJson(bindings)}\n`; }
const exists = (candidate: string) => access(candidate).then(() => true, () => false);
function failure(message: string): PersistedVisualChangeWorkflowResult { return { ok: false, diagnostics: [{ code: 'artifact-write-failure', severity: DIAGNOSTIC_SEVERITY['artifact-write-failure'], message }] }; }
export async function writeVisualChangeWorkflowArtifact(artifact: VisualChangeWorkflowArtifact, outputLocation: string, options: WriteVisualChangeWorkflowArtifactOptions = {}): Promise<PersistedVisualChangeWorkflowResult> {
  const validation = isValidVisualChangeWorkflowArtifact(artifact); if (!validation.valid) return failure(`refusing to persist an invalid VisualChangeWorkflowArtifact: ${validation.reason}`);
  const outputRoot = path.resolve(options.cwd ?? process.cwd(), outputLocation); const finalRoot = path.join(outputRoot, artifact.visualChangeWorkflowId); const tempRoot = path.join(outputRoot, `.tmp-${artifact.visualChangeWorkflowId}`);
  if (await exists(finalRoot)) return failure(`a visual-change workflow already exists at "${artifact.visualChangeWorkflowId}"; refusing to overwrite it`);
  try {
    await rm(tempRoot, { recursive: true, force: true }); await mkdir(tempRoot, { recursive: true });
    if (artifact.scope.entryMode === 'reference') {
      const content = serializeVisualChangeBindings(artifact.scope.bindings);
      if (computeVisualChangeBindingsSha256(content) !== artifact.bindings?.sha256) throw new Error('bindings digest does not match canonical declarations');
      await writeFile(path.join(tempRoot, VISUAL_CHANGE_WORKFLOW_BINDINGS_FILENAME), content, 'utf8');
    }
    await writeFile(path.join(tempRoot, VISUAL_CHANGE_WORKFLOW_MANIFEST_FILENAME), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await options.beforeRename?.(tempRoot); await rename(tempRoot, finalRoot);
    return { ok: true, artifactRoot: finalRoot, manifestPath: path.join(finalRoot, VISUAL_CHANGE_WORKFLOW_MANIFEST_FILENAME), ...(artifact.scope.entryMode === 'reference' ? { bindingsPath: path.join(finalRoot, VISUAL_CHANGE_WORKFLOW_BINDINGS_FILENAME) } : {}) };
  } catch (error) { await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined); return failure(`failed to persist visual-change workflow: ${error instanceof Error ? error.message : String(error)}`); }
}
