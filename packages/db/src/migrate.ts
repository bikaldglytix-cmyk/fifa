/** Applies drizzle SQL migrations against either driver. Run: npm run db:migrate */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createDb } from './client';

const dynamicImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as never;

export async function runMigrations(): Promise<void> {
  const migrationsFolder = [join(__dirname, 'drizzle'), join(__dirname, '..', 'drizzle')].find(existsSync);
  if (!migrationsFolder) throw new Error('No drizzle/ migrations folder found. Run `npm run generate -w @fifa/db` first.');

  const { db, kind, raw, close } = await createDb();
  console.log(`[db] applying migrations (${kind}) from ${migrationsFolder}`);
  if (kind === 'postgres') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await dynamicImport('drizzle-orm/pglite/migrator');
    await migrate(db as never, { migrationsFolder });
  }
  console.log('[db] migrations complete');
  await close();
}

if (require.main === module) {
  runMigrations().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
