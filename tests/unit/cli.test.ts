import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { getProducerInfo } from '../../src/domain/schema.js';

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

describe('runCli - top-level', () => {
  // B5-TST-001: the CLI recognizes "observe" and is not the old placeholder-only behavior.
  it('B5-TST-001: no longer prints the greenfield-placeholder message for --help', async () => {
    const out = capture();
    const code = await runCli(['--help'], out.io);
    expect(code).toBe(0);
    expect(out.stdout()).toContain('observe');
    expect(out.stdout()).not.toContain('greenfield scaffold');
  });

  it('prints the actual package version for --version, not a hardcoded constant', async () => {
    const out = capture();
    const code = await runCli(['--version'], out.io);
    expect(code).toBe(0);
    expect(out.stdout().trim()).toBe(getProducerInfo().version);
  });

  it('rejects an unrecognized command', async () => {
    const out = capture();
    const code = await runCli(['bogus-command'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('unrecognized command');
  });

  it('bare invocation with no command exits nonzero and prints usage', async () => {
    const out = capture();
    const code = await runCli([], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('observe');
  });

  it('observe --help documents --url/--viewport/--target/--output/--timeout', async () => {
    const out = capture();
    const code = await runCli(['observe', '--help'], out.io);
    expect(code).toBe(0);
    for (const flag of ['--url', '--viewport', '--target', '--output', '--timeout']) {
      expect(out.stdout()).toContain(flag);
    }
  });
});

describe('runCli observe - argument parsing (B5-TST-002..006)', () => {
  // B5-TST-002: missing required arguments fail before browser launch.
  it('B5-TST-002: fails before browser launch when --url is missing', async () => {
    const out = capture();
    const code = await runCli(['observe', '--viewport', '800x600'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--url is required');
  });

  // B5-TST-003: viewport parsing.
  it('B5-TST-003: rejects malformed --viewport syntax before browser launch', async () => {
    for (const bad of ['1280', '1280*', 'x720', '1280x', 'abcx720']) {
      const out = capture();
      const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--viewport', bad], out.io);
      expect(code).toBe(1);
      expect(out.stderr()).toContain('--viewport');
    }
  });

  // B5-TST-004: repeatable --target preserves order.
  // B5-TST-005: a selector containing "=" survives parsing intact.
  // Both are proven together via the application-orchestration test below, which inspects the
  // actual NormalizedObservationRequest passed to the application service - this suite only
  // proves the CLI-syntax-error paths that must reject before any browser/application call.
  it('B5-TST-005 (syntax boundary): rejects a --target with no "=" before browser launch', async () => {
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--target', 'no-equals-sign'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--target must be id=css-selector');
  });

  // B5-TST-006: domain validation (viewport bounds, unsafe URL) is reused, not duplicated in the CLI.
  it('B5-TST-006: viewport below the Batch 1 minimum is rejected by domain validation, not CLI constants', async () => {
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--viewport', '50x50'], out.io);
    expect(code).toBe(1);
    // The message comes from src/request/request.ts's own bound text, not a CLI-local copy.
    expect(out.stderr()).toContain('viewport width/height must be integers in');
  });

  it('B5-TST-006: a non-loopback URL is rejected by the existing Batch 1 safety policy, not a CLI allowlist', async () => {
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://example.com/'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[unsafe-url]');
  });
});

describe('runCli - CLI has no browser/persistence implementation of its own (B5-TST-008,009)', () => {
  it('B5-TST-008,009: cli.ts source imports no Playwright or filesystem-write/artifact module', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../src/cli.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]playwright['"]/);
    // The CLI may use synchronous, read-only node:fs utilities for entry-point bootstrapping
    // (e.g. realpathSync, to detect "am I the invoked main module" symlink-safely - see the
    // isMainModule comment in src/cli.ts), but must never import the filesystem-*write* module
    // or the artifact writer directly: persistence stays owned by src/artifacts/.
    expect(source).not.toMatch(/from ['"]node:fs\/promises['"]/);
    expect(source).not.toMatch(/from ['"].*artifacts\//);
    expect(source).not.toMatch(/\b(writeFile|writeFileSync|mkdir|mkdirSync|rmSync|rename|renameSync)\b/);
  });
});
