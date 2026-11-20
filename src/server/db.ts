import pg from 'pg';

// Resource balances are bigint and loyalty is numeric; both fit safely in a JS number here.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

/** Anything that can run a query: the pool or a transaction client. */
export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __aoteruPool: pg.Pool | undefined;
}

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

export function pool(): pg.Pool {
  if (!globalThis.__aoteruPool) {
    const connectionString = databaseUrl();
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and point it at PostgreSQL.');
    }
    globalThis.__aoteruPool = new pg.Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    globalThis.__aoteruPool.on('error', (err) => {
      console.error('[db] idle client error', err.message);
    });
  }
  return globalThis.__aoteruPool;
}

export async function closePool(): Promise<void> {
  if (globalThis.__aoteruPool) {
    await globalThis.__aoteruPool.end();
    globalThis.__aoteruPool = undefined;
  }
}

export async function rows<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(text, params);
  return res.rows as T[];
}

export async function one<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const res = await db.query(text, params);
  return (res.rows[0] as T) ?? null;
}

/** Run `fn` in a single database transaction; roll back if it throws. */
export async function withTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The world lock.
 *
 * Every transaction that changes game state — a simulation step or a player
 * action — holds this transaction-scoped advisory lock. That makes the world a
 * single-writer system: ticks can never run twice at once, a player order can
 * never interleave with a battle being resolved, and realtime events are
 * committed in the order of their ids. Reads never take it.
 */
const WORLD_LOCK_KEY = 4207001;

export async function withWorldLock<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return withTx(async (tx) => {
    await tx.query(`SET LOCAL lock_timeout = '10s'`);
    await tx.query('SELECT pg_advisory_xact_lock($1)', [WORLD_LOCK_KEY]);
    return fn(tx);
  });
}

/** Like `withWorldLock`, but returns `null` straight away if another writer holds the lock. */
export async function tryWithWorldLock<T>(fn: (tx: Db) => Promise<T>): Promise<T | null> {
  return withTx(async (tx) => {
    const got = await one<{ locked: boolean }>(tx, 'SELECT pg_try_advisory_xact_lock($1) AS locked', [WORLD_LOCK_KEY]);
    if (!got?.locked) return null;
    return fn(tx);
  });
}
