import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { ComparisonConfig } from '../domain/comparison.js';
import { isValidComparisonConfig } from '../domain/comparison.js';

export type LoadBindingsFileResult = { ok: true; bindings: unknown } | { ok: false; error: string };

/** Shared wrapper parser used by both the low-level fidelity command and project check. */
export function loadBindingsFile(filePath: string): LoadBindingsFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (error) {
    return { ok: false, error: `--bindings-file could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (error) {
    return { ok: false, error: `--bindings-file is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, error: '--bindings-file root must be a JSON object' };
  const record = parsed as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter((key) => key !== 'bindings');
  if (unknownFields.length > 0) return { ok: false, error: `--bindings-file has unsupported top-level field(s): ${unknownFields.join(', ')}` };
  if (!('bindings' in record)) return { ok: false, error: '--bindings-file must have a "bindings" property' };
  return { ok: true, bindings: record.bindings };
}

export function loadComparisonConfigFile(filePath: string): { ok: true; config: ComparisonConfig } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    return { ok: false, error: `comparison config could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isValidComparisonConfig(parsed)) return { ok: false, error: 'comparison config is not a valid canonical ComparisonConfig' };
  return { ok: true, config: parsed };
}

/** Resolve an existing acceptance input only after real-path containment succeeds. */
export function resolveContainedAcceptancePath(projectRoot: string, relativePath: string): { ok: true; path: string } | { ok: false; error: string } {
  try {
    const realRoot = realpathSync(projectRoot);
    const resolved = realpathSync(path.resolve(projectRoot, relativePath));
    if (resolved !== realRoot && !resolved.startsWith(`${realRoot}${path.sep}`)) return { ok: false, error: `acceptance path escapes project root: ${relativePath}` };
    return { ok: true, path: resolved };
  } catch {
    return { ok: false, error: `acceptance path could not be resolved inside the project: ${relativePath}` };
  }
}
