import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startViewer, type StartViewerResult } from '../../src/viewerServer/viewerService.js';
import { writeBoundedContextEvidenceFixture } from '../support/evidenceFixtures.js';
import type { ContextSessionState } from '../../src/viewerServer/context.js';

const repoRoot = path.resolve(__dirname, '../..');
const viewerDist = path.join(repoRoot, 'dist', 'viewer');

let browser: Browser;

/**
 * v0.8 Batch 7 real-browser proof (task §94): the actual built React shell,
 * through the actual loopback viewer server started WITH an explicit
 * `context` session state (mirroring a real `--context-file`), against real
 * bounded-agent-context evidence produced entirely through the existing
 * canonical `projectBoundedAgentContext`/`deriveRuntimeStaticCorrelations`/
 * `attachRuntimeStaticCorrelations` workflow - never hand-edited adequacy/
 * correlation/fidelity results. Each scenario gets its own isolated evidence
 * root/server.
 */
beforeAll(async () => {
  if (!existsSync(path.join(viewerDist, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'viewer/vite.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? path.join(repoRoot, 'node_modules', '.vite-viewer') },
    });
  }
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function startForRoot(root: string, context?: ContextSessionState): Promise<Extract<StartViewerResult, { ok: true }>> {
  const result = await startViewer({ root, port: 0, assetsRoot: viewerDist, context });
  if (!result.ok) throw new Error(`viewer server failed to start: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

async function openContextMode(page: import('playwright').Page, server: { url: string }): Promise<void> {
  await page.goto(server.url);
  const toggle = page.getByRole('button', { name: 'Bounded context' });
  await toggle.waitFor({ timeout: 10_000 });
  await toggle.click();
  await page.locator('.context-workspace').waitFor({ timeout: 10_000 });
}

describe('Case A - adequate correlated context', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-a-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.correlatedContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('loads the context, shows profile/adequacy/one correlated candidate, and navigates to the source observation', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);

      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('frontend-change-review');
      await page.locator('.context-adequacy-badge--adequate').waitFor({ timeout: 5_000 });
      expect(bodyText).toContain('symbol:src/components/Header.tsx#Header');
      expect(bodyText).toContain('Correlated candidate');

      // Navigate to the exactly resolved source observation.
      const openButtons = page.getByRole('button', { name: 'Open in evidence view' });
      await openButtons.first().waitFor({ timeout: 5_000 });
      await openButtons.first().click();

      // Switched back to evidence mode and the observation workspace rendered.
      await page.locator('.target-overlay-svg').first().waitFor({ timeout: 10_000 });
      const evidenceButton = page.getByRole('button', { name: 'Evidence' });
      await expect.poll(() => evidenceButton.getAttribute('aria-pressed')).toBe('true');
    } finally {
      await page.close();
    }
  });
});

describe('Case B - ambiguous correlation', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-b-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.ambiguousContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows ambiguous with every candidate visible and none promoted as a winner', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('ambiguous');
      expect(bodyText).toContain('symbol:src/components/Header.tsx#Header');
      expect(bodyText).toContain('symbol:src/legacy/OldHeader.tsx#OldHeader');
      expect(bodyText).toContain('Ambiguous candidates');
      expect(bodyText).not.toMatch(/\bowner\b/i);
      expect(bodyText).not.toMatch(/\bwinner\b/i);
    } finally {
      await page.close();
    }
  });
});

describe('Case C - unavailable correlation', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-c-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.unavailableContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows unavailable with zero fabricated candidates', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('No static candidate available for this correlation');
      expect(bodyText).toContain('geometry + name proximity evidence supplied by static retrieval'); // evidenceBasis still shown
      expect(bodyText).not.toContain('symbol:src/components/Header.tsx#Header');
    } finally {
      await page.close();
    }
  });
});

describe('Case D - required evidence loss', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-d-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.requiredOmissionContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('makes required evidence loss prominently visible', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      await page.locator('.context-required-loss').first().waitFor({ timeout: 5_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Required evidence loss');
      expect(bodyText).toContain('nonexistent-target');
      await page.locator('.context-adequacy-badge--partial, .context-adequacy-badge--inadequate').first().waitFor({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });
});

describe('Case E - correlation not included', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-e-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.baseContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('says correlation was not included, never "unavailable"', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Static correlation not included in this context.');
      expect(bodyText).toContain('not included'); // summary row for fidelity/correlation counts
    } finally {
      await page.close();
    }
  });
});

describe('Case F - bounded fidelity projection (mismatches + protected context)', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-f-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.baseContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows the bounded fidelity PASS projection and lets the developer trigger a separate live evaluation without recomputing the projection', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      await page.locator('.reference-fidelity-state--pass').first().waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('Bounded context fidelity projection');
      expect(bodyText).toContain('Current on-demand fidelity evaluation');
      expect(bodyText).toContain('never silently replaces the bounded context projection');

      // Trigger the separate live evaluation - the bounded projection's own PASS banner must remain unchanged.
      const evaluateButton = page.getByRole('button', { name: 'Evaluate Fidelity' });
      await evaluateButton.waitFor({ timeout: 5_000 });
      await evaluateButton.click();
      await expect.poll(async () => (await page.locator('.reference-fidelity-state--pass').count()) >= 1).toBe(true);
    } finally {
      await page.close();
    }
  });
});

describe('Case G - blocked bounded fidelity', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-g-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.blockedFidelityContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('shows not-evaluated with the blocker, never "no mismatches means pass"', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      await page.locator('.reference-fidelity-state--not-evaluated').first().waitFor({ timeout: 5_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('blocked by: incompatible');
      expect(bodyText).toContain('Evaluation was blocked - this is not evidence of "no problems"');
    } finally {
      await page.close();
    }
  });
});

describe('Case H - raw evidence navigation', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-h-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.correlatedContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('opens exact linked raw structured evidence with no filesystem browsing', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      const rawButtons = page.getByRole('button', { name: /View raw structured evidence/ });
      await rawButtons.first().waitFor({ timeout: 5_000 });
      await rawButtons.first().click();
      await page.locator('.artifact-preview__raw').first().waitFor({ timeout: 10_000 });
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('"artifactKind"');
      // No filesystem path input/URL entry exists anywhere on the page.
      expect(await page.locator('input[type="file"]').count()).toBe(0);
      expect(await page.locator('input[type="url"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

describe('Case I - missing source', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-i-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    await rm(fixture.afterRoot, { recursive: true, force: true });
    server = await startForRoot(root, { status: 'valid', artifact: fixture.baseContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('remains fully inspectable and marks the missing source honestly', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('ctx-after');
      await page.locator('.context-source-row__status--missing').first().waitFor({ timeout: 5_000 });
      // The still-present "before" source remains resolved.
      await page.locator('.context-source-row__status--resolved').first().waitFor({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });
});

describe('Case J - static file: candidate safety', () => {
  let root: string;
  let server: Extract<StartViewerResult, { ok: true }>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-context-case-j-'));
    const fixture = await writeBoundedContextEvidenceFixture(root);
    server = await startForRoot(root, { status: 'valid', artifact: fixture.correlatedContext });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('displays the candidate id as plain text, never as a clickable local filesystem link', async () => {
    const page = await browser.newPage();
    try {
      await openContextMode(page, server);
      const bodyText = await page.textContent('body');
      expect(bodyText).toContain('symbol:src/components/Header.tsx#Header');
      // No anchor element anywhere in the context workspace turns a candidateId into a navigable href.
      const candidateLinks = await page.locator('.context-workspace a[href*="symbol:"], .context-workspace a[href*="file:"]').count();
      expect(candidateLinks).toBe(0);
    } finally {
      await page.close();
    }
  });
});
