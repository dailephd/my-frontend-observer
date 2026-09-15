import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../../src/cli.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
function output() { const stdout: string[] = []; const stderr: string[] = []; return { io: { stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value) }, stdout: () => stdout.join(''), stderr: () => stderr.join('') }; }

describe('project workflow CLI', () => {
  it('groups top-level help and exposes init/capture help without check', async () => {
    const out = output(); expect(await runCli(['--help'], out.io)).toBe(0); expect(out.stdout()).toContain('Common workflow:'); expect(out.stdout()).toContain('Advanced:'); expect(out.stdout()).not.toMatch(/^\s*check/m);
    const init = output(); expect(await runCli(['init', '--help'], init.io)).toBe(0); expect(init.stdout()).toContain('--default-baseline');
    const capture = output(); expect(await runCli(['capture', '--help'], capture.io)).toBe(0); expect(capture.stdout()).toContain('capture <alias>');
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
});
