import { spawn } from 'node:child_process';

/**
 * Best-effort convenience only: opens the platform default browser at `url`
 * using OS-native commands (no dependency). Failure here must never affect
 * viewer server startup success - callers treat a rejected promise as
 * non-fatal and continue with the server already running.
 */
export function openInDefaultBrowser(url: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let command: string;
    let args: string[];
    if (process.platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolvePromise();
    });
  });
}
