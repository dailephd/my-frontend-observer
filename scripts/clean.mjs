import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const projectRoot = process.cwd();
const target = resolve(projectRoot, 'dist');
if (dirname(target) !== projectRoot || target === projectRoot) {
  throw new Error(`Refusing to clean unexpected path: ${target}`);
}
await rm(target, { recursive: true, force: true });
