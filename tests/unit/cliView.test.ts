import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../../src/cli.js';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

const createdDirs: string[] = [];
afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runCli view - CLI dispatch (syntax/fast-fail paths only; full server lifecycle is covered by tests/browser/viewerServer.test.ts)', () => {
  it('--help lists view as a top-level command and documents --root/--port/--no-open', async () => {
    const out = capture();
    const code = await runCli(['--help'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('view');
  });

  it('view --help documents --root/--port/--no-open and states it never runs browser observation', async () => {
    const out = capture();
    const code = await runCli(['view', '--help'], out.io);
    expect(code).toBe(0);
    for (const flag of ['--root', '--port', '--no-open']) {
      expect(out.stdout()).toContain(flag);
    }
    expect(out.stdout()).toContain('never launches a browser observation');
  });

  it('rejects a missing --root with a nonzero exit and a clear error', async () => {
    const out = capture();
    const code = await runCli(['view'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--root is required');
  });

  it('rejects an unrecognized flag as a CLI syntax error', async () => {
    const out = capture();
    const code = await runCli(['view', '--root', '.', '--bogus'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('unrecognized argument');
  });

  it('rejects a malformed --port (non-numeric)', async () => {
    const out = capture();
    const code = await runCli(['view', '--root', '.', '--port', 'abc'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--port must be an integer');
  });

  it('rejects an out-of-range --port', async () => {
    const out = capture();
    const code = await runCli(['view', '--root', '.', '--port', '70000'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--port must be an integer');
  });

  it('rejects a duplicated --root flag', async () => {
    const out = capture();
    const code = await runCli(['view', '--root', '.', '--root', '.'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--root may only be specified once');
  });

  it('fails closed (nonzero exit, structured diagnostic, no hang) on a nonexistent --root, without starting a server', async () => {
    const out = capture();
    const missingRoot = path.join(tmpdir(), 'my-frontend-observer-view-test-does-not-exist');
    const code = await runCli(['view', '--root', missingRoot, '--no-open'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[viewer-root-invalid]');
  });

  it('fails closed when --root points at a file rather than a directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'my-frontend-observer-view-test-'));
    createdDirs.push(dir);
    const filePath = path.join(dir, 'not-a-directory.txt');
    await writeFile(filePath, 'x');
    const out = capture();
    const code = await runCli(['view', '--root', filePath, '--no-open'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[viewer-root-invalid]');
  });

  it('existing commands remain unchanged: observe/compare help still documents their own flags after adding view', async () => {
    const out = capture();
    const observeCode = await runCli(['observe', '--help'], out.io);
    expect(observeCode).toBe(0);
    expect(out.stdout()).toContain('--url');

    const out2 = capture();
    const compareCode = await runCli(['compare', '--help'], out2.io);
    expect(compareCode).toBe(0);
    expect(out2.stdout()).toContain('--before');
  });
});
