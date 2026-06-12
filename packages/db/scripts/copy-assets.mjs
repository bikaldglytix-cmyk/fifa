// Copies migration SQL into dist so `node dist/migrate.js` finds it at runtime.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'drizzle');
const dest = join(root, 'dist', 'drizzle');
if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log('copied drizzle/ -> dist/drizzle');
} else {
  console.log('no drizzle/ migrations yet (run npm run generate first)');
}
