import { access } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_CONFIG_FILENAME } from './projectConfig.js';

export type DiscoverProjectResult = { ok: true; projectRoot: string; configPath: string } | { ok: false; reason: 'project-not-initialized' };

export async function discoverFrontendObserverProject(startDirectory: string): Promise<DiscoverProjectResult> {
  let current = path.resolve(startDirectory);
  for (;;) {
    const configPath = path.join(current, PROJECT_CONFIG_FILENAME);
    try {
      await access(configPath);
      return { ok: true, projectRoot: current, configPath };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return { ok: false, reason: 'project-not-initialized' };
      current = parent;
    }
  }
}
