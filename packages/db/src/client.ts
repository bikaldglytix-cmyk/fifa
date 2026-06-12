/**
 * Database client factory.
 *
 * Two drivers behind one interface:
 *  - `postgres`: node-postgres Pool, selected when DATABASE_URL is set
 *    (production / docker-compose).
 *  - `pglite`: embedded Postgres (WASM) stored under PGLITE_DIR
 *    (default <repo>/.pgdata) — zero-dependency local development.
 */
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema> & { $client?: unknown };

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  /** close underlying connection(s) */
  close: () => Promise<void>;
  /** raw driver (Pool or PGlite) for migrator use */
  raw: unknown;
}

// Preserve dynamic import in CommonJS output (tsc would otherwise transpile
// `import()` to `require()` which breaks ESM-only packages).
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as never;

let handle: DbHandle | null = null;

export async function createDb(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE ?? 20) });
    const db = drizzlePg(pool, { schema }) as Db;
    return { db, kind: 'postgres', raw: pool, close: () => pool.end() };
  }

  const dir = process.env.PGLITE_DIR ?? require('node:path').join(findRepoRoot(), '.pgdata');
  const { PGlite } = await dynamicImport('@electric-sql/pglite');
  const pglite = await PGlite.create(dir);
  const { drizzle: drizzlePglite } = await dynamicImport('drizzle-orm/pglite');
  const db = drizzlePglite(pglite, { schema }) as unknown as Db;
  return { db, kind: 'pglite', raw: pglite, close: () => pglite.close() };
}

/** Process-wide singleton (API runtime). */
export async function getDb(): Promise<DbHandle> {
  if (!handle) handle = await createDb();
  return handle;
}

export function findRepoRoot(): string {
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const { join, dirname } = require('node:path') as typeof import('node:path');
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'packages'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
