import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatCheckHumanResult, runCli } from '../../src/cli.js';
import { emptyCheckResult } from '../../src/projectWorkflow/checkResult.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
function output() { const stdout: string[] = []; const stderr: string[] = []; return { io: { stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value) }, stdout: () => stdout.join(''), stderr: () => stderr.join('') }; }

describe('project workflow CLI', () => {
  it('groups top-level help and exposes init/capture/check help', async () => {
    const out = output(); expect(await runCli(['--help'], out.io)).toBe(0); expect(out.stdout()).toContain('Common workflow:'); expect(out.stdout()).toContain('Advanced:'); expect(out.stdout()).toMatch(/^\s*check/m);
    const init = output(); expect(await runCli(['init', '--help'], init.io)).toBe(0); expect(init.stdout()).toContain('--default-baseline');
    const capture = output(); expect(await runCli(['capture', '--help'], capture.io)).toBe(0); expect(capture.stdout()).toContain('capture <alias>');
    const check = output(); expect(await runCli(['check', '--help'], check.io)).toBe(0); expect(check.stdout()).toContain('REVIEW_REQUIRED 2');
  });
  it('initializes, refuses duplicates, replaces config only, and never duplicates gitignore', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'observer-cli-project-')); roots.push(dir); const prior = process.cwd(); process.chdir(dir);
    try {
      await writeFile('.gitignore', 'existing/\n');
      const args = ['init', '--url', 'http://127.0.0.1:3000', '--target', 'header=#header', '--target', 'main=main'];
      expect(await runCli(args, output().io)).toBe(0);
      expect(JSON.parse(await readFile('frontend-observer.json', 'utf8')).targets).toHaveLength(2);
      expect(JSON.parse(await readFile('.frontend-observer/catalog.json', 'utf8')).observations).toEqual({});
      expect((await readFile('.gitignore', 'utf8')).match(/\.frontend-observer\//g)).toHaveLength(1);
      expect(await runCli(args, output().io)).toBe(1);
      expect(await runCli([...args, '--replace', '--default-baseline', 'golden'], output().io)).toBe(0);
      expect((await readFile('.gitignore', 'utf8')).match(/\.frontend-observer\//g)).toHaveLength(1);
    } finally { process.chdir(prior); }
  });
  it('initializes from a structured targets file and capture requires a project', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'observer-cli-targets-')); roots.push(dir); const prior = process.cwd(); process.chdir(dir);
    try {
      await writeFile('targets.json', JSON.stringify({ targets: [{ name: 'main', locators: [{ kind: 'semantic-element', tag: 'main' }] }] }));
      expect(await runCli(['init', '--url', 'http://localhost:3000', '--targets-file', 'targets.json'], output().io)).toBe(0);
      const nestedMissing = await mkdtemp(path.join(tmpdir(), 'observer-cli-missing-')); roots.push(nestedMissing); process.chdir(nestedMissing);
      const out = output(); expect(await runCli(['capture', 'baseline'], out.io)).toBe(1); expect(out.stderr()).toContain('project-not-initialized');
    } finally { process.chdir(prior); }
  });
  it('rejects invalid check syntax and emits JSON even when project discovery is BLOCKED', async () => {
    const invalid = output(); expect(await runCli(['check', 'one', 'two'], invalid.io)).toBe(1); expect(invalid.stderr()).toContain('at most one baseline');
    const unknown = output(); expect(await runCli(['check', '--root', 'x'], unknown.io)).toBe(1); expect(unknown.stderr()).toContain('at most one baseline');
    const dir = await mkdtemp(path.join(tmpdir(), 'observer-cli-check-missing-')); roots.push(dir); const prior = process.cwd(); process.chdir(dir);
    try {
      const blocked = output(); expect(await runCli(['check', '--json'], blocked.io)).toBe(3);
      expect(JSON.parse(blocked.stdout())).toMatchObject({ schemaVersion: '1.0.0', status: 'BLOCKED', blockers: [{ code: 'project-not-initialized' }] });
      expect(blocked.stdout().endsWith('\n')).toBe(true); expect(blocked.stdout().trim().split('\n')).toHaveLength(1);
    } finally { process.chdir(prior); }
  });
  it('formats every workflow status concisely without canonical IDs or absolute paths', () => {
    for (const status of ['PASS', 'FAIL', 'REVIEW_REQUIRED', 'BLOCKED'] as const) {
      const result = emptyCheckResult(); result.status = status;
      result.baseline = { alias: 'baseline', observationId: 'long-canonical-id', requestId: 'request-id', artifactPath: 'C:/private/evidence' };
      result.candidate = { alias: 'current', observationId: 'other-long-id', requestId: 'other-request', artifactPath: 'C:/private/current' };
      result.comparison = { state: 'comparable', differenceCount: 1 };
      if (status === 'BLOCKED') result.blockers.push({ code: 'comparison-incomparable', message: 'canonical evidence is incomparable' });
      const text = formatCheckHumanResult(result);
      expect(text).toContain(`Check: ${status}`); expect(text).toContain('Baseline: baseline'); expect(text).toContain('Candidate: current'); expect(text).toContain('Inspect: my-frontend-observer view');
      expect(text).not.toContain('long-canonical-id'); expect(text).not.toContain('C:/private');
    }
  });
});
