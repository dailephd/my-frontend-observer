import type { Diagnostic } from '../domain/diagnostics.js';
import { orderDiagnostics } from '../domain/diagnostics.js';
import { classifyUrl } from '../safety/policy.js';
import { normalizeOutputLocation } from './paths.js';

export type TargetLocator =
  | { kind: 'role'; role: string; name?: string }
  | { kind: 'id'; value: string }
  | { kind: 'data-attribute'; attribute: string; value: string }
  | { kind: 'semantic-element'; tag: string }
  | { kind: 'css'; selector: string }
  | { kind: 'text'; text: string };

export interface NamedTarget {
  name: string;
  locators: TargetLocator[];
}

/** Raw, not-yet-validated target shape as it may appear in a RawObservationRequest. Exactly one of `selector` (legacy) or `locators` (canonical) may be present, never both. */
export interface RawNamedTarget {
  name?: unknown;
  selector?: unknown;
  locators?: unknown;
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

/**
 * v0.3 Batch 1 canonical scroll-action shape. Exactly the two bounded action
 * kinds below are supported; `target` on `target-scroll-by` refers to the
 * existing stable observer-owned target `name` (see `NamedTarget`), never a
 * CSS selector, Playwright locator, or DOM id evaluated directly.
 */
export type ScrollAction =
  | { kind: 'window-scroll-by'; deltaX: number; deltaY: number }
  | { kind: 'target-scroll-by'; target: string; deltaX: number; deltaY: number };

export interface ScrollScenario {
  action: ScrollAction;
}

export interface NormalizedObservationRequest {
  targetUrl: string;
  viewport: Viewport;
  targets: NamedTarget[];
  outputLocation: string;
  timeoutMs: number;
  readiness: ReadinessConfig;
  scrollScenario?: ScrollScenario;
}

export interface RawObservationRequest {
  targetUrl?: unknown;
  viewport?: unknown;
  targets?: unknown;
  outputLocation?: unknown;
  timeoutMs?: unknown;
  readiness?: unknown;
  scrollScenario?: unknown;
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
const MAX_LOCATORS_PER_TARGET = 5;
const MAX_ROLE_LENGTH = 64;
const MAX_ACCESSIBLE_NAME_LENGTH = 200;
const MAX_ID_VALUE_LENGTH = 200;
const DATA_ATTRIBUTE_NAME_RE = /^data-[a-z0-9-]{1,64}$/;
const MAX_DATA_ATTRIBUTE_VALUE_LENGTH = 500;
const MAX_TEXT_LENGTH = 200;
const SUPPORTED_SEMANTIC_ELEMENT_TAGS = new Set([
  'header',
  'nav',
  'main',
  'footer',
  'article',
  'section',
  'aside',
  'form',
  'dialog',
]);
const SUPPORTED_LOCATOR_KINDS = new Set(['role', 'id', 'data-attribute', 'semantic-element', 'css', 'text']);
const SUPPORTED_SCROLL_ACTION_KINDS = new Set(['window-scroll-by', 'target-scroll-by']);
/**
 * Conservative bound for a single controlled-observation scroll action. No
 * existing repository precedent for a scroll-delta magnitude; chosen large
 * enough to reach realistic overflow content (documents/containers well
 * beyond one viewport) while staying far short of a pathological/runaway
 * request - see docs/CONTRACTS.md and tests/unit/request.test.ts.
 */
export const SCROLL_DELTA_MAX_ABS = 20000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

/** Validates one raw locator object against the frozen v0.2 locator-kind contract. Total: always returns either a valid TargetLocator or a list of every problem found (never throws, never short-circuits). */
function validateLocator(raw: unknown, targetName: string, index: number): { ok: true; locator: TargetLocator } | { ok: false; diagnostics: Diagnostic[] } {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: 'error', message: `locator at index ${index} must be an object`, targetName }],
    };
  }
  const kind = raw.kind;
  if (typeof kind !== 'string' || !SUPPORTED_LOCATOR_KINDS.has(kind)) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: 'error', message: `locator at index ${index} has an unsupported kind`, targetName }],
    };
  }

  switch (kind) {
    case 'css': {
      if (!isBoundedString(raw.selector, 1, MAX_SELECTOR_LENGTH)) {
        return {
          ok: false,
          diagnostics: [
            { code: 'invalid-request', severity: 'error', message: `css locator at index ${index} must have a selector 1-${MAX_SELECTOR_LENGTH} characters`, targetName },
          ],
        };
      }
      return { ok: true, locator: { kind: 'css', selector: raw.selector } };
    }
    case 'role': {
      if (!isBoundedString(raw.role, 1, MAX_ROLE_LENGTH)) {
        return {
          ok: false,
          diagnostics: [{ code: 'invalid-request', severity: 'error', message: `role locator at index ${index} must have a role 1-${MAX_ROLE_LENGTH} characters`, targetName }],
        };
      }
      if (raw.name !== undefined && !isBoundedString(raw.name, 0, MAX_ACCESSIBLE_NAME_LENGTH)) {
        return {
          ok: false,
          diagnostics: [
            { code: 'invalid-request', severity: 'error', message: `role locator at index ${index} name must be at most ${MAX_ACCESSIBLE_NAME_LENGTH} characters`, targetName },
          ],
        };
      }
      return { ok: true, locator: raw.name === undefined ? { kind: 'role', role: raw.role } : { kind: 'role', role: raw.role, name: raw.name } };
    }
    case 'id': {
      if (!isBoundedString(raw.value, 1, MAX_ID_VALUE_LENGTH)) {
        return {
          ok: false,
          diagnostics: [{ code: 'invalid-request', severity: 'error', message: `id locator at index ${index} must have a value 1-${MAX_ID_VALUE_LENGTH} characters`, targetName }],
        };
      }
      return { ok: true, locator: { kind: 'id', value: raw.value } };
    }
    case 'data-attribute': {
      if (typeof raw.attribute !== 'string' || !DATA_ATTRIBUTE_NAME_RE.test(raw.attribute)) {
        return {
          ok: false,
          diagnostics: [
            { code: 'invalid-request', severity: 'error', message: `data-attribute locator at index ${index} must have an attribute matching ^data-[a-z0-9-]{1,64}$`, targetName },
          ],
        };
      }
      if (!isBoundedString(raw.value, 1, MAX_DATA_ATTRIBUTE_VALUE_LENGTH)) {
        return {
          ok: false,
          diagnostics: [
            {
              code: 'invalid-request',
              severity: 'error',
              message: `data-attribute locator at index ${index} must have a value 1-${MAX_DATA_ATTRIBUTE_VALUE_LENGTH} characters`,
              targetName,
            },
          ],
        };
      }
      return { ok: true, locator: { kind: 'data-attribute', attribute: raw.attribute, value: raw.value } };
    }
    case 'semantic-element': {
      if (typeof raw.tag !== 'string' || !SUPPORTED_SEMANTIC_ELEMENT_TAGS.has(raw.tag)) {
        return {
          ok: false,
          diagnostics: [
            {
              code: 'invalid-request',
              severity: 'error',
              message: `semantic-element locator at index ${index} must have a tag in {${[...SUPPORTED_SEMANTIC_ELEMENT_TAGS].join(', ')}}`,
              targetName,
            },
          ],
        };
      }
      return { ok: true, locator: { kind: 'semantic-element', tag: raw.tag } };
    }
    case 'text': {
      if (!isBoundedString(raw.text, 1, MAX_TEXT_LENGTH)) {
        return {
          ok: false,
          diagnostics: [{ code: 'invalid-request', severity: 'error', message: `text locator at index ${index} must have text 1-${MAX_TEXT_LENGTH} characters`, targetName }],
        };
      }
      return { ok: true, locator: { kind: 'text', text: raw.text } };
    }
    default:
      return { ok: false, diagnostics: [{ code: 'invalid-request', severity: 'error', message: `locator at index ${index} has an unsupported kind`, targetName }] };
  }
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Validates the optional v0.3 scrollScenario request shape. `configuredTargetNames`
 * is the lowercase set of already-normalized target names so `target-scroll-by`
 * can only reference an existing stable observer target (never a new/implicit
 * one). Total: collects every applicable diagnostic before returning; never
 * throws.
 */
function validateScrollScenario(
  raw: unknown,
  configuredTargetNames: ReadonlySet<string>,
): { ok: true; scenario: ScrollScenario } | { ok: false; diagnostics: Diagnostic[] } {
  if (!isPlainObject(raw)) {
    return { ok: false, diagnostics: [{ code: 'invalid-request', severity: 'error', message: 'scrollScenario must be an object' }] };
  }
  const extraScenarioKeys = Object.keys(raw).filter((key) => key !== 'action');
  if (extraScenarioKeys.length > 0) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: 'error', message: `scrollScenario has unsupported field(s): ${extraScenarioKeys.join(', ')}` }],
    };
  }

  const action = raw.action;
  if (!isPlainObject(action)) {
    return { ok: false, diagnostics: [{ code: 'invalid-request', severity: 'error', message: 'scrollScenario.action must be an object' }] };
  }
  const kind = action.kind;
  if (typeof kind !== 'string' || !SUPPORTED_SCROLL_ACTION_KINDS.has(kind)) {
    return {
      ok: false,
      diagnostics: [
        { code: 'invalid-request', severity: 'error', message: `scrollScenario.action.kind must be one of ${[...SUPPORTED_SCROLL_ACTION_KINDS].join(', ')}` },
      ],
    };
  }

  const allowedActionKeys = kind === 'target-scroll-by' ? ['kind', 'target', 'deltaX', 'deltaY'] : ['kind', 'deltaX', 'deltaY'];
  const extraActionKeys = Object.keys(action).filter((key) => !allowedActionKeys.includes(key));
  if (extraActionKeys.length > 0) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: 'error', message: `scrollScenario.action has unsupported field(s): ${extraActionKeys.join(', ')}` }],
    };
  }

  const deltaDiagnostics: Diagnostic[] = [];
  if (!isFiniteInteger(action.deltaX) || Math.abs(action.deltaX) > SCROLL_DELTA_MAX_ABS) {
    deltaDiagnostics.push({
      code: 'invalid-request',
      severity: 'error',
      message: `scrollScenario.action.deltaX must be an integer in [-${SCROLL_DELTA_MAX_ABS}, ${SCROLL_DELTA_MAX_ABS}]`,
    });
  }
  if (!isFiniteInteger(action.deltaY) || Math.abs(action.deltaY) > SCROLL_DELTA_MAX_ABS) {
    deltaDiagnostics.push({
      code: 'invalid-request',
      severity: 'error',
      message: `scrollScenario.action.deltaY must be an integer in [-${SCROLL_DELTA_MAX_ABS}, ${SCROLL_DELTA_MAX_ABS}]`,
    });
  }
  if (deltaDiagnostics.length > 0) {
    return { ok: false, diagnostics: deltaDiagnostics };
  }

  const deltaX = action.deltaX as number;
  const deltaY = action.deltaY as number;
  if (deltaX === 0 && deltaY === 0) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: 'error', message: 'scrollScenario.action requires a non-zero deltaX or deltaY' }],
    };
  }

  if (kind === 'window-scroll-by') {
    return { ok: true, scenario: { action: { kind: 'window-scroll-by', deltaX, deltaY } } };
  }

  if (typeof action.target !== 'string' || action.target.length === 0) {
    return {
      ok: false,
      diagnostics: [{ code: 'invalid-request', severity: 'error', message: 'scrollScenario.action.target is required for target-scroll-by' }],
    };
  }
  if (!configuredTargetNames.has(action.target.toLowerCase())) {
    return {
      ok: false,
      diagnostics: [
        { code: 'invalid-request', severity: 'error', message: 'scrollScenario.action.target must reference a configured target', targetName: action.target },
      ],
    };
  }

  return { ok: true, scenario: { action: { kind: 'target-scroll-by', target: action.target, deltaX, deltaY } } };
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
      for (const rawTargetUnknown of raw.targets as unknown[]) {
        if (!isPlainObject(rawTargetUnknown) || typeof rawTargetUnknown.name !== 'string') {
          diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'each target requires a string name and either a string selector or a locators array' });
          continue;
        }
        const rawTarget = rawTargetUnknown as RawNamedTarget;
        const name = rawTargetUnknown.name as string;

        if (!TARGET_NAME_RE.test(name)) {
          diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'target name must match ^[A-Za-z0-9_-]{1,64}$', targetName: name });
        }
        const normalizedName = name.toLowerCase();
        if (seenNames.has(normalizedName)) {
          diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'duplicate target name', targetName: name });
        } else {
          seenNames.add(normalizedName);
        }

        const hasSelector = rawTarget.selector !== undefined;
        const hasLocators = rawTarget.locators !== undefined;

        if (hasSelector && hasLocators) {
          diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'target must not specify both selector and locators', targetName: name });
          continue;
        }

        if (hasSelector) {
          if (typeof rawTarget.selector !== 'string' || rawTarget.selector.length === 0 || rawTarget.selector.length > MAX_SELECTOR_LENGTH) {
            diagnostics.push({
              code: 'invalid-request',
              severity: 'error',
              message: `target selector must be 1-${MAX_SELECTOR_LENGTH} characters`,
              targetName: name,
            });
            continue;
          }
          targets.push({ name, locators: [{ kind: 'css', selector: rawTarget.selector }] });
          continue;
        }

        if (hasLocators) {
          if (!Array.isArray(rawTarget.locators) || rawTarget.locators.length === 0) {
            diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'target locators must be a non-empty array', targetName: name });
            continue;
          }
          if (rawTarget.locators.length > MAX_LOCATORS_PER_TARGET) {
            diagnostics.push({
              code: 'invalid-request',
              severity: 'error',
              message: `target locators must contain at most ${MAX_LOCATORS_PER_TARGET} entries`,
              targetName: name,
            });
            continue;
          }
          const locators: TargetLocator[] = [];
          let anyInvalid = false;
          rawTarget.locators.forEach((rawLocator, index) => {
            const validated = validateLocator(rawLocator, name, index);
            if (validated.ok) {
              locators.push(validated.locator);
            } else {
              anyInvalid = true;
              diagnostics.push(...validated.diagnostics);
            }
          });
          if (!anyInvalid) {
            targets.push({ name, locators });
          }
          continue;
        }

        diagnostics.push({ code: 'invalid-request', severity: 'error', message: 'each target requires either a selector or a locators array', targetName: name });
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

  let scrollScenario: ScrollScenario | undefined;
  if (raw.scrollScenario !== undefined) {
    const configuredTargetNames = new Set(targets.map((target) => target.name.toLowerCase()));
    const validated = validateScrollScenario(raw.scrollScenario, configuredTargetNames);
    if (validated.ok) {
      scrollScenario = validated.scenario;
    } else {
      diagnostics.push(...validated.diagnostics);
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
      ...(scrollScenario ? { scrollScenario } : {}),
    },
  };
}
