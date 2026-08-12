import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

  it('observe --help documents --url/--viewport/--target/--targets-file/--scroll-scenario-file/--output/--timeout', async () => {
    const out = capture();
    const code = await runCli(['observe', '--help'], out.io);
    expect(code).toBe(0);
    for (const flag of ['--url', '--viewport', '--target', '--targets-file', '--scroll-scenario-file', '--output', '--timeout']) {
      expect(out.stdout()).toContain(flag);
    }
    expect(out.stdout()).toContain('window-scroll-by');
    expect(out.stdout()).toContain('target-scroll-by');
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

describe('runCli observe --targets-file (v0.2 Batch 4 CLI/input boundary)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeTargetsFile(content: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-cli-targets-file-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'targets.json');
    await writeFile(filePath, content, 'utf8');
    return filePath;
  }

  it('requires a value: bare --targets-file fails before browser launch', async () => {
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--targets-file requires a file path argument');
  });

  it('rejects a second --targets-file flag', async () => {
    const filePath = await writeTargetsFile(JSON.stringify({ targets: [] }));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', filePath, '--targets-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--targets-file may only be specified once');
  });

  it('rejects --target combined with --targets-file, before browser launch', async () => {
    const filePath = await writeTargetsFile(JSON.stringify({ targets: [] }));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--target', 'a=b', '--targets-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--target and --targets-file cannot be combined');
  });

  it('reports a clear error for a missing/unreadable file', async () => {
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', '/does/not/exist-targets.json'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--targets-file could not be read');
  });

  it('reports a clear error for invalid JSON', async () => {
    const filePath = await writeTargetsFile('{ not valid json');
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--targets-file is not valid JSON');
  });

  it('rejects a non-object root (array, null)', async () => {
    for (const content of ['[]', 'null']) {
      const filePath = await writeTargetsFile(content);
      const out = capture();
      const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', filePath], out.io);
      expect(code).toBe(1);
      expect(out.stderr()).toContain('--targets-file root must be a JSON object');
    }
  });

  it('rejects an object root missing the "targets" property entirely', async () => {
    const filePath = await writeTargetsFile(JSON.stringify({}));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('must have a "targets" property');
  });

  it('rejects an object root with an unrecognized field instead of "targets"', async () => {
    const filePath = await writeTargetsFile(JSON.stringify({ foo: [] }));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('unsupported top-level field');
  });

  it('rejects unknown top-level fields alongside a valid "targets" property', async () => {
    const filePath = await writeTargetsFile(JSON.stringify({ targets: [], viewport: '1280x720' }));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('unsupported top-level field(s): viewport');
  });

  it('rejects unknown top-level fields such as a misplaced "url"', async () => {
    const filePath = await writeTargetsFile(JSON.stringify({ targets: [], url: 'http://localhost:3000' }));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('unsupported top-level field(s): url');
  });

  it('passes representative invalid target-file content through to the existing domain validator, not an ad hoc CLI error', async () => {
    const filePath = await writeTargetsFile(JSON.stringify({ targets: [{ name: 'a', locators: [{ kind: 'unsupported-kind' }] }] }));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--targets-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[invalid-request]');
  });

  it('accepts a relative targets-file path resolved from the current working directory', async () => {
    const filePath = await writeTargetsFile(JSON.stringify({ targets: [{ name: 'a', locators: [{ kind: 'css', selector: 'body' }] }] }));
    const relativePath = path.relative(process.cwd(), filePath);
    const out = capture();
    // --url deliberately points nowhere reachable; this only proves the file itself parses
    // and reaches domain validation (a safe non-loopback URL still fails first, deterministically).
    const code = await runCli(['observe', '--url', 'http://example.com/', '--targets-file', relativePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[unsafe-url]');
  });
});

describe('runCli observe --scroll-scenario-file (v0.3 Batch 4 CLI/input boundary)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeScenarioFile(content: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mfo-cli-scroll-scenario-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'scroll.json');
    await writeFile(filePath, content, 'utf8');
    return filePath;
  }

  it('requires a value: bare --scroll-scenario-file fails before browser launch', async () => {
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--scroll-scenario-file'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--scroll-scenario-file requires a file path argument');
  });

  it('rejects a second --scroll-scenario-file flag', async () => {
    const filePath = await writeScenarioFile(JSON.stringify({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 100 } }));
    const out = capture();
    const code = await runCli(
      ['observe', '--url', 'http://127.0.0.1/x', '--scroll-scenario-file', filePath, '--scroll-scenario-file', filePath],
      out.io,
    );
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--scroll-scenario-file may only be specified once');
  });

  it('reports a clear error for a missing/unreadable file', async () => {
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--scroll-scenario-file', '/does/not/exist-scroll.json'], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--scroll-scenario-file could not be read');
  });

  it('reports a clear error for invalid JSON', async () => {
    const filePath = await writeScenarioFile('{ not valid json');
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--scroll-scenario-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('--scroll-scenario-file is not valid JSON');
  });

  it('rejects a non-object root (array, null, string)', async () => {
    for (const content of ['[]', 'null', '"scroll"']) {
      const filePath = await writeScenarioFile(content);
      const out = capture();
      const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--scroll-scenario-file', filePath], out.io);
      expect(code).toBe(1);
      expect(out.stderr()).toContain('--scroll-scenario-file root must be a JSON object');
    }
  });

  it('is compatible with both --target and --targets-file (not another mutually-exclusive target mode)', async () => {
    const scenarioPath = await writeScenarioFile(JSON.stringify({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 100 } }));
    const out = capture();
    // --url deliberately points nowhere reachable; this only proves the flag combination itself
    // parses and reaches domain validation, not a full browser observation.
    const code = await runCli(
      ['observe', '--url', 'http://example.com/', '--target', 'a=b', '--scroll-scenario-file', scenarioPath],
      out.io,
    );
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[unsafe-url]');
    expect(out.stderr()).not.toContain('cannot be combined');
  });

  it('passes an invalid action kind through to the existing domain validator, not an ad hoc CLI error', async () => {
    const filePath = await writeScenarioFile(JSON.stringify({ action: { kind: 'unsupported-action', deltaX: 0, deltaY: 500 } }));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--scroll-scenario-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[invalid-request]');
  });

  it('passes a both-zero delta through to the existing domain validator', async () => {
    const filePath = await writeScenarioFile(JSON.stringify({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 0 } }));
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--scroll-scenario-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[invalid-request]');
  });

  it('passes an unknown target-scroll-by target through to the existing domain validator', async () => {
    const filePath = await writeScenarioFile(
      JSON.stringify({ action: { kind: 'target-scroll-by', target: 'does-not-exist', deltaX: 0, deltaY: 400 } }),
    );
    const out = capture();
    const code = await runCli(['observe', '--url', 'http://127.0.0.1/x', '--scroll-scenario-file', filePath], out.io);
    expect(code).toBe(1);
    expect(out.stderr()).toContain('[invalid-request]');
  });

  it('accepts a relative scenario-file path resolved from the current working directory', async () => {
    const filePath = await writeScenarioFile(JSON.stringify({ action: { kind: 'window-scroll-by', deltaX: 0, deltaY: 200 } }));
    const relativePath = path.relative(process.cwd(), filePath);
    const out = capture();
    // --url deliberately points nowhere reachable; this only proves the file itself parses
    // and reaches domain validation (a safe non-loopback URL still fails first, deterministically).
    const code = await runCli(['observe', '--url', 'http://example.com/', '--scroll-scenario-file', relativePath], out.io);
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
