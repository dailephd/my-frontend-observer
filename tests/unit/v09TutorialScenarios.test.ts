import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { TUTORIAL_SCENARIO_IDS, TUTORIAL_TARGET_ID } from '../../examples/v09-demo/scripts/generate-tutorial-target.mjs';

const repoRoot = path.resolve(__dirname, '../..');
const tutorialsRoot = path.join(repoRoot, 'examples', 'v09-demo', 'tutorials');

/** The four committed scenario files, in tutorial order. */
const EXPECTED_FILES = [
  '01-annotation-basics.json',
  '02-runtime-intent-contract.json',
  '03-reference-authoring.json',
  '04-reference-materialization.json',
];

const EXPECTED_IDS = [
  'observer-v09-annotation-basics',
  'observer-v09-runtime-contract',
  'observer-v09-reference-authoring',
  'observer-v09-reference-materialization',
];

/**
 * The released my-dev-kit-lab 0.4.8 vocabulary. These are asserted so a
 * scenario cannot quietly acquire an Observer-only extension; the lab's own
 * `tutorial validate` remains the authority and is run separately, and this
 * file deliberately does not reimplement it.
 */
const LAB_ACTION_TYPES = new Set(['goto', 'click', 'fill', 'press', 'hover', 'drag', 'wait-for', 'pointer-click', 'pointer-drag']);
const LAB_LOCATOR_KINDS = new Set(['role', 'text', 'css', 'test-id']);
const LAB_ASSERTION_TYPES = new Set([
  'element-visible',
  'text-equals',
  'text-contains',
  'url-path-equals',
  'attribute-equals',
  'http-json-equals',
  'json-file-equals',
  'file-exists',
]);
const SCENARIO_KEYS = new Set(['schemaVersion', 'id', 'title', 'description', 'targetId', 'browser', 'steps']);
const STEP_KEYS = new Set(['id', 'narration', 'pauseBeforeMs', 'pauseAfterMs', 'action', 'highlight', 'callout', 'screenshot', 'assertions']);

/** Observer-only fields a scenario must never carry. */
const FORBIDDEN_FIELDS = ['artifactIdQuery', 'observerCommand', 'referenceId', 'annotationId', 'mouseX', 'mouseY', 'customScript', 'evaluate', 'script'];

async function loadScenarios(): Promise<{ file: string; value: Record<string, unknown> }[]> {
  return Promise.all(
    EXPECTED_FILES.map(async (file) => ({ file, value: JSON.parse(await readFile(path.join(tutorialsRoot, file), 'utf8')) })),
  );
}

describe('v0.9 tutorial scenarios - committed set', () => {
  it('contains exactly the four initial scenario files', async () => {
    const entries = (await readdir(tutorialsRoot)).sort();
    expect(entries).toEqual(EXPECTED_FILES);
  });

  it('declares the released lab scenario schema version', async () => {
    for (const { file, value } of await loadScenarios()) {
      expect(value.schemaVersion, file).toBe('1.0.0');
    }
  });

  it('uses stable, unique ids in tutorial order', async () => {
    const scenarios = await loadScenarios();
    expect(scenarios.map((entry) => entry.value.id)).toEqual(EXPECTED_IDS);
    expect(new Set(scenarios.map((entry) => entry.value.id)).size).toBe(4);
    // Every scenario id is one the target-contract generator can prepare.
    for (const id of EXPECTED_IDS) expect(TUTORIAL_SCENARIO_IDS).toContain(id);
  });

  it('shares one target identity', async () => {
    for (const { file, value } of await loadScenarios()) {
      expect(value.targetId, file).toBe(TUTORIAL_TARGET_ID);
      expect(value.targetId, file).toBe('my-frontend-observer-v09-demo');
    }
  });

  it('uses the canonical 1440x900 tutorial viewport', async () => {
    for (const { file, value } of await loadScenarios()) {
      expect(value.browser, file).toEqual({ viewport: { width: 1440, height: 900 } });
    }
  });

  it('gives every step a stable id and non-empty narration', async () => {
    for (const { file, value } of await loadScenarios()) {
      const steps = value.steps as { id: string; narration: string }[];
      expect(steps.length, file).toBeGreaterThan(0);
      const ids = new Set<string>();
      for (const step of steps) {
        expect(typeof step.id, `${file} step id`).toBe('string');
        expect(ids.has(step.id), `${file} duplicate step id ${step.id}`).toBe(false);
        ids.add(step.id);
        expect(typeof step.narration, `${file}/${step.id} narration`).toBe('string');
        expect(step.narration.trim().length, `${file}/${step.id} narration`).toBeGreaterThan(0);
      }
    }
  });

  it('holds every step long enough to read its narration', async () => {
    // Without a pause a step lasts only as long as its action, which left
    // multi-sentence subtitle cues on screen for a fraction of a second.
    // 15 characters per second, never under 1.2 seconds, within the lab's
    // 60 second per-step limit.
    for (const { file, value } of await loadScenarios()) {
      for (const step of value.steps as { id: string; narration: string; pauseAfterMs?: number }[]) {
        const where = `${file}/${step.id}`;
        const readingMs = Math.max(1200, Math.ceil((step.narration.length / 15) * 10) * 100);
        expect(Number.isInteger(step.pauseAfterMs), `${where} pauseAfterMs`).toBe(true);
        expect(step.pauseAfterMs!, where).toBeGreaterThanOrEqual(readingMs);
        expect(step.pauseAfterMs!, where).toBeLessThanOrEqual(60_000);
      }
    }
  });

  it('uses only released lab actions, locators and assertions', async () => {
    for (const { file, value } of await loadScenarios()) {
      expect([...Object.keys(value)].every((key) => SCENARIO_KEYS.has(key)), file).toBe(true);
      for (const step of value.steps as Record<string, unknown>[]) {
        expect(Object.keys(step).every((key) => STEP_KEYS.has(key)), `${file}/${String(step.id)}`).toBe(true);
        const action = step.action as { type?: string } | undefined;
        if (action !== undefined) expect(LAB_ACTION_TYPES.has(String(action.type)), `${file}/${String(step.id)} action`).toBe(true);
        for (const assertion of (step.assertions ?? []) as { type: string }[]) {
          expect(LAB_ASSERTION_TYPES.has(assertion.type), `${file}/${String(step.id)} assertion`).toBe(true);
        }
      }
      for (const locator of [...JSON.stringify(value).matchAll(/"kind":\s*"([^"]+)"/g)].map((match) => match[1]!)) {
        expect(LAB_LOCATOR_KINDS.has(locator), `${file} locator kind ${locator}`).toBe(true);
      }
    }
  });

  it('anchors every positional pointer action to a surface with in-bounds fractions', async () => {
    let pointerActions = 0;
    for (const { file, value } of await loadScenarios()) {
      for (const step of value.steps as Record<string, unknown>[]) {
        const action = step.action as Record<string, unknown> | undefined;
        if (action === undefined) continue;
        if (action.type !== 'pointer-click' && action.type !== 'pointer-drag') continue;
        pointerActions += 1;
        const where = `${file}/${String(step.id)}`;
        expect(action.coordinateSpace, where).toBe('fraction');
        expect(action.locator, where).toBeDefined();
        const points = action.type === 'pointer-click' ? [action.position] : [action.from, action.to];
        for (const point of points as { x: number; y: number }[]) {
          expect(point.x >= 0 && point.x <= 1, `${where} x`).toBe(true);
          expect(point.y >= 0 && point.y <= 1, `${where} y`).toBe(true);
        }
        if (action.type === 'pointer-drag') {
          const from = action.from as { x: number; y: number };
          const to = action.to as { x: number; y: number };
          // The released validator rejects a zero-length drag.
          expect(from.x !== to.x || from.y !== to.y, `${where} endpoints`).toBe(true);
        }
      }
    }
    expect(pointerActions).toBeGreaterThan(0);
  });

  it('never drives drawing through the element-to-element drag action', async () => {
    for (const { file, value } of await loadScenarios()) {
      for (const step of value.steps as Record<string, unknown>[]) {
        const action = step.action as { type?: string } | undefined;
        expect(action?.type, `${file}/${String(step.id)}`).not.toBe('drag');
      }
    }
  });

  it('carries no Observer-only field and no machine-specific absolute path', async () => {
    for (const { file, value } of await loadScenarios()) {
      const serialized = JSON.stringify(value);
      for (const field of FORBIDDEN_FIELDS) {
        expect(serialized, `${file} must not carry ${field}`).not.toContain(`"${field}"`);
      }
      expect(serialized, file).not.toMatch(/[A-Za-z]:\\\\/);
      expect(serialized, file).not.toContain('/Users/');
      expect(serialized, file).not.toContain('/home/');
      // A scenario may only navigate inside the application origin.
      expect(serialized, file).not.toContain('http://127.0.0.1');
      expect(serialized, file).not.toContain('https://');
    }
  });

  it('binds no selector to a generated evidence identifier', async () => {
    for (const { file, value } of await loadScenarios()) {
      const serialized = JSON.stringify(value);
      // A 32+ character hex run is what every Observer artifact id looks like.
      expect(serialized, `${file} must not bind to a generated id`).not.toMatch(/[0-9a-f]{32}/);
      expect(serialized, file).not.toContain('annotation-item-');
      expect(serialized, file).not.toMatch(/:nth-child/);
    }
  });
});
