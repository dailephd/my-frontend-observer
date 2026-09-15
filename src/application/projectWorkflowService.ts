import { access, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Diagnostic } from '../domain/diagnostics.js';
import type { RawNamedTarget } from '../request/request.js';
import { normalizeRequest } from '../request/request.js';
import { observe } from './observationPersistence.js';
import { PROJECT_CONFIG_SCHEMA_VERSION, readProjectConfig, validateObservationAlias, validateProjectConfig } from '../projectWorkflow/projectConfig.js';
import { ALIAS_CATALOG_SCHEMA_VERSION, readAliasCatalog, writeAliasCatalog } from '../projectWorkflow/aliasCatalog.js';
import { aliasCatalogPath, observationOutputLocation, projectConfigPath, projectEvidenceRoot } from '../projectWorkflow/projectPaths.js';

export type ProjectWorkflowErrorCode = 'project-not-initialized' | 'project-config-exists' | 'project-config-invalid' | 'project-catalog-invalid' | 'alias-invalid' | 'alias-reserved' | 'alias-exists' | 'project-state-write-failure' | 'observation-failure';
type WorkflowFailure = { ok: false; code: ProjectWorkflowErrorCode; message: string; diagnostics?: readonly Diagnostic[] };
export interface InitializeProjectInput { projectRoot: string; url: string; viewport: { width: number; height: number }; targets: RawNamedTarget[]; defaultBaseline?: string; replace: boolean }

async function exists(file: string): Promise<boolean> { return access(file).then(() => true, () => false); }
async function atomicTextWrite(file: string, text: string): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try { await writeFile(temp, text, 'utf8'); await rename(temp, file); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
}

export async function initializeFrontendObserverProject(input: InitializeProjectInput): Promise<{ ok: true; configPath: string } | WorkflowFailure> {
  const root = path.resolve(input.projectRoot);
  const configPath = projectConfigPath(root);
  if ((await exists(configPath)) && !input.replace) return { ok: false, code: 'project-config-exists', message: 'frontend-observer.json already exists; pass --replace to replace configuration only' };
  const candidate = { schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION, url: input.url, viewport: input.viewport, targets: input.targets, defaultBaseline: input.defaultBaseline ?? 'baseline' };
  const validated = validateProjectConfig(candidate);
  if (!validated.ok) return { ok: false, code: 'project-config-invalid', message: validated.reason };
  try {
    await mkdir(projectEvidenceRoot(root), { recursive: true });
    await atomicTextWrite(configPath, `${JSON.stringify(validated.config, null, 2)}\n`);
    const catalogPath = aliasCatalogPath(root);
    if (!(await exists(catalogPath))) await writeAliasCatalog(catalogPath, { schemaVersion: ALIAS_CATALOG_SCHEMA_VERSION, observations: {} });
    const ignorePath = path.join(root, '.gitignore');
    const existing = await readFile(ignorePath, 'utf8').catch(() => '');
    if (!existing.split(/\r?\n/).some((line) => line.trim() === '.frontend-observer/')) {
      const prefix = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
      await writeFile(ignorePath, `${prefix}.frontend-observer/\n`, 'utf8');
    }
    return { ok: true, configPath };
  } catch (error) { return { ok: false, code: 'project-state-write-failure', message: error instanceof Error ? error.message : String(error) }; }
}

export interface CaptureNamedObservationInput { projectRoot: string; alias: string; replace: boolean }
export type CaptureNamedObservationResult = { ok: true; alias: string; observationId: string; requestId: string; artifactRoot: string; completionState: string; diagnostics: readonly Diagnostic[] } | WorkflowFailure;
export async function captureNamedObservation(input: CaptureNamedObservationInput): Promise<CaptureNamedObservationResult> {
  const aliasValidation = validateObservationAlias(input.alias);
  if (!aliasValidation.ok) return { ok: false, code: aliasValidation.reason === 'reserved' ? 'alias-reserved' : 'alias-invalid', message: aliasValidation.reason === 'reserved' ? 'alias "current" is reserved for a later workflow command' : 'alias must match ^[a-z0-9][a-z0-9._-]{0,63}$ and must not be a traversal expression' };
  const config = await readProjectConfig(projectConfigPath(input.projectRoot));
  if (!config.ok) return { ok: false, code: 'project-config-invalid', message: config.reason };
  const catalogResult = await readAliasCatalog(aliasCatalogPath(input.projectRoot));
  if (!catalogResult.ok) return { ok: false, code: 'project-catalog-invalid', message: catalogResult.reason };
  if (catalogResult.catalog.observations[input.alias] !== undefined && !input.replace) return { ok: false, code: 'alias-exists', message: `alias "${input.alias}" already exists; pass --replace to point it at a new observation` };
  const normalized = normalizeRequest({ targetUrl: config.config.url, viewport: config.config.viewport, targets: config.config.targets, outputLocation: observationOutputLocation(input.alias) });
  if (!normalized.ok) return { ok: false, code: 'project-config-invalid', message: normalized.diagnostics.map((entry) => entry.message).join('; ') };
  const result = await observe(normalized.request, { cwd: input.projectRoot });
  if (!result.ok) return { ok: false, code: 'observation-failure', message: 'observation failed', diagnostics: result.diagnostics };
  const relative = path.relative(projectEvidenceRoot(input.projectRoot), result.artifactRoot).split(path.sep).join('/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) return { ok: false, code: 'project-state-write-failure', message: 'persisted observation path escaped the managed evidence root' };
  const updated = { ...catalogResult.catalog, observations: { ...catalogResult.catalog.observations, [input.alias]: { observationId: result.observationId, requestId: result.requestId, relativeArtifactDir: relative } } };
  try { await writeAliasCatalog(aliasCatalogPath(input.projectRoot), updated); }
  catch (error) { return { ok: false, code: 'project-state-write-failure', message: `observation persisted, but alias catalog update failed: ${error instanceof Error ? error.message : String(error)}` }; }
  return { ok: true, alias: input.alias, observationId: result.observationId, requestId: result.requestId, artifactRoot: result.artifactRoot, completionState: result.completion.state, diagnostics: result.diagnostics };
}

export async function loadProjectViewerState(projectRoot: string): Promise<{ ok: true; root: string; aliases: Readonly<Record<string, string>> } | WorkflowFailure> {
  const config = await readProjectConfig(projectConfigPath(projectRoot));
  if (!config.ok) return { ok: false, code: 'project-config-invalid', message: config.reason };
  const catalog = await readAliasCatalog(aliasCatalogPath(projectRoot));
  if (!catalog.ok) return { ok: false, code: 'project-catalog-invalid', message: catalog.reason };
  const aliases: Record<string, string> = {};
  for (const [alias, record] of Object.entries(catalog.catalog.observations)) aliases[record.relativeArtifactDir] = alias;
  return { ok: true, root: projectEvidenceRoot(projectRoot), aliases };
}
