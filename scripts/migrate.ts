/**
 * Migration runner (OPS-02). Applies every .sql file in db/migrations exactly
 * once, in name order, and records it in schema_migrations. All pending
 * migrations run in one transaction under an advisory lock, so two deployments
 * building at the same time cannot apply the same migration twice.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:reset              drop everything and start over (needs --yes in production)
 *   tsx scripts/migrate.ts --if-configured   used by `npm run build`: skip quietly when no database is configured
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadEnv } from './env';

loadEnv();

const args = new Set(process.argv.slice(2));
// Prefer a direct (unpooled) connection for DDL when the host provides one.
const url =
  process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;

async function main(): Promise<void> {
  if (!url) {
    if (args.has('--if-configured')) {
      console.log('[migrate] DATABASE_URL is not set; skipping migrations.');
      return;
    }
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (args.has('--reset')) {
      if (process.env.NODE_ENV === 'production' && !args.has('--yes')) {
        throw new Error('Refusing to reset a production database without --yes.');
      }
      console.log('[migrate] resetting schema "public"');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(4207002)');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
      const dir = join(process.cwd(), 'db', 'migrations');
      const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      let count = 0;
      for (const file of files) {
        if (applied.has(file)) continue;
        console.log(`[migrate] applying ${file}`);
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        count += 1;
      }
      await client.query('COMMIT');
      console.log(count === 0 ? '[migrate] database is up to date' : `[migrate] applied ${count} migration(s)`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err.message ?? err);
  process.exit(1);
});
