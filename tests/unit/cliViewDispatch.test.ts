import { describe, expect, it, vi } from 'vitest';

/**
 * Isolated from tests/unit/cliView.test.ts (which exercises the real
 * `startViewer`/filesystem behavior): this file mocks the viewer service
 * seam to prove the CLI's "view" command is a thin delegator - it parses
 * argv into exactly the options `startViewer` receives, and never starts a
 * real server or opens a real browser during this test.
 */
const startViewerMock = vi.fn(async () => ({
  ok: true as const,
  url: 'http://127.0.0.1:4319',
  port: 4319,
  host: '127.0.0.1',
  root: '/some/root',
  close: vi.fn(async () => undefined),
}));
const openInDefaultBrowserMock = vi.fn(async () => undefined);

vi.mock('../../src/viewerServer/viewerService.js', () => ({
  startViewer: (...args: unknown[]) => startViewerMock(...args),
}));
vi.mock('../../src/viewerServer/openBrowser.js', () => ({
  openInDefaultBrowser: (...args: unknown[]) => openInDefaultBrowserMock(...args),
}));

const { runCli } = await import('../../src/cli.js');

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: { stdout: (t: string) => stdout.push(t), stderr: (t: string) => stderr.push(t) },
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

describe('runCli view - thin delegation to startViewer', () => {
  it('parses --root/--port and calls startViewer exactly once with those exact options', async () => {
    startViewerMock.mockClear();
    const out = capture();
    const code = await runCli(['view', '--root', '/some/root', '--port', '4319', '--no-open'], out.io);
    expect(code).toBe(0);
    expect(startViewerMock).toHaveBeenCalledTimes(1);
    expect(startViewerMock).toHaveBeenCalledWith({ root: '/some/root', port: 4319 });
    expect(out.stdout()).toContain('http://127.0.0.1:4319');
  });

  it('omits port from the delegated call when --port is not supplied, leaving the default to startViewer', async () => {
    startViewerMock.mockClear();
    const out = capture();
    await runCli(['view', '--root', '/some/root', '--no-open'], out.io);
    expect(startViewerMock).toHaveBeenCalledWith({ root: '/some/root' });
  });

  it('attempts to open the default browser unless --no-open is given', async () => {
    startViewerMock.mockClear();
    openInDefaultBrowserMock.mockClear();
    const out = capture();
    await runCli(['view', '--root', '/some/root'], out.io);
    expect(openInDefaultBrowserMock).toHaveBeenCalledTimes(1);
    expect(openInDefaultBrowserMock).toHaveBeenCalledWith('http://127.0.0.1:4319');
  });

  it('does not attempt to open the browser when --no-open is given', async () => {
    startViewerMock.mockClear();
    openInDefaultBrowserMock.mockClear();
    const out = capture();
    await runCli(['view', '--root', '/some/root', '--no-open'], out.io);
    expect(openInDefaultBrowserMock).not.toHaveBeenCalled();
  });

  it('a nonfatal browser-open failure never turns a successful server start into a nonzero exit', async () => {
    startViewerMock.mockClear();
    openInDefaultBrowserMock.mockClear();
    openInDefaultBrowserMock.mockRejectedValueOnce(new Error('no display available'));
    const out = capture();
    const code = await runCli(['view', '--root', '/some/root'], out.io);
    expect(code).toBe(0);
    expect(out.stderr()).toContain('could not open the default browser automatically');
  });
});
