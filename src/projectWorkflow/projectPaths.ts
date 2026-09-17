import path from 'node:path';
import { PROJECT_CONFIG_FILENAME } from './projectConfig.js';

export const PROJECT_STATE_DIRECTORY = '.frontend-observer' as const;
export const ALIAS_CATALOG_FILENAME = 'catalog.json' as const;

export function projectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_CONFIG_FILENAME);
}

export function projectStateRoot(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_STATE_DIRECTORY);
}

export function aliasCatalogPath(projectRoot: string): string {
  return path.join(projectStateRoot(projectRoot), ALIAS_CATALOG_FILENAME);
}

export function projectEvidenceRoot(projectRoot: string): string {
  return path.join(projectStateRoot(projectRoot), 'evidence');
}

export function projectObservationsRoot(projectRoot: string): string {
  return path.join(projectEvidenceRoot(projectRoot), 'observations');
}

export function observationOutputLocation(alias: string): string {
  return `${PROJECT_STATE_DIRECTORY}/evidence/observations/${alias}`;
}

export function projectAnnotationsRoot(projectRoot: string): string {
  return path.join(projectEvidenceRoot(projectRoot), 'annotations');
}

/** Portable project-relative output location for visual-annotation artifacts. Created lazily by the annotation writer. */
export function annotationOutputLocation(): string {
  return `${PROJECT_STATE_DIRECTORY}/evidence/annotations`;
}
