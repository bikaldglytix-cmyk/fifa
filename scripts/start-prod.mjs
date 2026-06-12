#!/usr/bin/env node
/**
 * Production boot (Render startCommand / any node host):
 *   1. apply drizzle migrations (idempotent)
 *   2. seed the real-2026 dataset — ONLY when the database is empty
 *   3. start the API
 *
 * Requires the workspace to be built first (npm run build:packages && npm run build:api).
 * DATABASE_URL must point at Postgres for persistence; without it the API falls
 * back to embedded PGlite, which is wiped on every deploy on ephemeral disks.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// picks up repo-root .env for local runs; production hosts inject real env vars
const { loadEnv } = require('../apps/api/dist/bootstrap.js');
loadEnv();

if (!process.env.DATABASE_URL) {
  console.warn('[start-prod] WARNING: DATABASE_URL is not set — using embedded PGlite (data will NOT survive redeploys)');
}

const { runMigrations } = require('../packages/db/dist/migrate.js');
await runMigrations();

const { createDb } = require('../packages/db/dist/client.js');
const { raw, close } = await createDb();
const res = await raw.query('select count(*)::int as n from countries');
const countries = res.rows?.[0]?.n ?? 0;
await close();

if (countries === 0) {
  console.log('[start-prod] empty database — seeding real 2026 dataset...');
  const { seed } = require('../packages/db/dist/seed.js');
  await seed();
} else {
  console.log(`[start-prod] database already seeded (${countries} countries) — skipping seed`);
}

await import('../apps/api/dist/main.js');
