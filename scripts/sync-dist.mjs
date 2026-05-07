import { cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'front-end', 'dist');
const target = resolve(root, 'dist');

await rm(target, { force: true, recursive: true });
await cp(source, target, { recursive: true });
