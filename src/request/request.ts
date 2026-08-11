import type { Diagnostic } from '../domain/diagnostics.js';
import { orderDiagnostics } from '../domain/diagnostics.js';
import { classifyUrl } from '../safety/policy.js';
import { normalizeOutputLocation } from './paths.js';

export interface NamedTarget {
  name: string;
  selector: string;
}

export interface Viewport {
  width: number;
  height: number;
}

export type ReadinessCondition = 'load' | 'domcontentloaded';

export interface ReadinessConfig {
  condition: ReadinessCondition;
  timeoutMs: number;
}

export interface NormalizedObservationRequest {
  targetUrl: string;
  viewport: Viewport;
  targets: NamedTarget[];
  outputLocation: string;
  timeoutMs: number;
  readiness: ReadinessConfig;
}

export interface RawObservationRequest {
  targetUrl?: unknown;
  viewport?: unknown;
  targets?: unknown;
  outputLocation?: unknown;
  timeoutMs?: unknown;
  readiness?: unknown;
}

export type NormalizeRequestResult = { ok: true; request: NormalizedObservationRequest } | { ok: false; diagnostics: Diagnostic[] };

const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 720 };
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_READINESS_CONDITION: ReadinessCondition = 'load';
const DEFAULT_READINESS_TIMEOUT_MS = 10000;
const DEFAULT_OUTPUT_LOCATION = 'observations';

const VIEWPORT_MIN = 200;
const VIEWPORT_MAX = 3840;
const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 120000;
const READINESS_TIMEOUT_MIN_MS = 500;
const MAX_TARGETS = 20;
const TARGET_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SELECTOR_LENGTH = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Total, never throws. Collects every applicable diagnostic before returning
 * (does not short-circuit on the first violation) so callers see every
 * problem at once, in deterministic order.
 */
export function normalizeRequest(raw: RawObservationRequest): NormalizeRequestResult {
  const diagnostics: Diagnostic[] = [];

  let targetUrl: string | undefined;
  if (typeof raw.targetUrl !== 'string' || raw.targetUrl.length === 0) {
    diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'targetUrl is required and must be a non-empty string' });
  } else {
    targetUrl = raw.targetUrl;
    const decision = classifyUrl(targetUrl);
    if (!decision.allowed) diagnostics.push(decision.diagnostic);
  }

  let viewport: Viewport = DEFAULT_VIEWPORT;
  if (raw.viewport !== undefined) {
    const candidate = raw.viewport;
    if (
      !isPlainObject(candidate) ||
      typeof candidate.width !== 'number' ||
      typeof candidate.height !== 'number' ||
      !isInRange(candidate.width, VIEWPORT_MIN, VIEWPORT_MAX) ||
      !isInRange(candidate.height, VIEWPORT_MIN, VIEWPORT_MAX)
    ) {
      diagnostics.push({
        code: 'invalid-request',
        severity: 'error',
        message: `viewport width/height must be integers in [${VIEWPORT_MIN}, ${VIEWPORT_MAX}]`,
      });
    } else {
      viewport = { width: candidate.width, height: candidate.height };
    }
  }

  const targets: NamedTarget[] = [];
  if (raw.targets !== undefined) {
    if (!Array.isArray(raw.targets)) {
      diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'targets must be an array' });
    } else if (raw.targets.length > MAX_TARGETS) {
      diagnostics.push({ code: 'invalid-request', severity: 'error', message: `targets must contain at most ${MAX_TARGETS} entries` });
    } else {
      const seenNames = new Set<string>();
      for (const rawTarget of raw.targets as unknown[]) {
        if (!isPlainObject(rawTarget) || typeof rawTarget.name !== 'string' || typeof rawTarget.selector !== 'string') {
          diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'each target requires a string name and string selector' });
          continue;
        }
        const name = rawTarget.name;
        const selector = rawTarget.selector;
        if (!TARGET_NAME_RE.test(name)) {
          diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'target name must match ^[A-Za-z0-9_-]{1,64}$', targetName: name });
        }
        if (selector.length === 0 || selector.length > MAX_SELECTOR_LENGTH) {
          diagnostics.push({
            code: 'invalid-request',
            severity: 'error',
            message: `target selector must be 1-${MAX_SELECTOR_LENGTH} characters`,
            targetName: name,
          });
        }
        const normalizedName = name.toLowerCase();
        if (seenNames.has(normalizedName)) {
          diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'duplicate target name', targetName: name });
        } else {
          seenNames.add(normalizedName);
        }
        targets.push({ name, selector });
      }
    }
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (raw.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs !== 'number' || !isInRange(raw.timeoutMs, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS)) {
      diagnostics.push({
        code: 'invalid-request',
        severity: 'error',
        message: `timeoutMs must be an integer in [${TIMEOUT_MIN_MS}, ${TIMEOUT_MAX_MS}]`,
      });
    } else {
      timeoutMs = raw.timeoutMs;
    }
  }

  let readinessCondition: ReadinessCondition = DEFAULT_READINESS_CONDITION;
  let readinessTimeoutMs = Math.min(DEFAULT_READINESS_TIMEOUT_MS, timeoutMs);
  if (raw.readiness !== undefined) {
    if (!isPlainObject(raw.readiness)) {
      diagnostics.push({ code: 'unsupported-configuration', severity: 'error', message: 'readiness must be an object' });
    } else {
      const readinessRaw = raw.readiness;
      if (readinessRaw.condition !== undefined) {
        if (readinessRaw.condition === 'load' || readinessRaw.condition === 'domcontentloaded') {
          readinessCondition = readinessRaw.condition;
        } else {
          diagnostics.push({
            code: 'unsupported-configuration',
            severity: 'error',
            message: 'readiness.condition must be "load" or "domcontentloaded"',
          });
        }
      }
      if (readinessRaw.timeoutMs !== undefined) {
        if (typeof readinessRaw.timeoutMs !== 'number' || !isInRange(readinessRaw.timeoutMs, READINESS_TIMEOUT_MIN_MS, timeoutMs)) {
          diagnostics.push({
            code: 'unsupported-configuration',
            severity: 'error',
            message: `readiness.timeoutMs must be an integer in [${READINESS_TIMEOUT_MIN_MS}, timeoutMs]`,
          });
        } else {
          readinessTimeoutMs = readinessRaw.timeoutMs;
        }
      }
    }
  }

  let outputLocation = DEFAULT_OUTPUT_LOCATION;
  if (raw.outputLocation !== undefined) {
    if (typeof raw.outputLocation !== 'string') {
      diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'outputLocation must be a string' });
    } else {
      const result = normalizeOutputLocation(raw.outputLocation);
      if (result.ok) {
        outputLocation = result.value;
      } else {
        diagnostics.push(result.diagnostic);
      }
    }
  }

  if (diagnostics.length > 0 || targetUrl === undefined) {
    return { ok: false, diagnostics: orderDiagnostics(diagnostics) };
  }

  return {
    ok: true,
    request: {
      targetUrl,
      viewport,
      targets,
      outputLocation,
      timeoutMs,
      readiness: { condition: readinessCondition, timeoutMs: readinessTimeoutMs },
    },
  };
}
