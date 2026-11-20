import { pool } from '@/server/db';
import { json, publicRoute } from '@/server/http';
import { loadWorldState, tickTime } from '@/server/world';

export const dynamic = 'force-dynamic';

/** GET /api/health — database reachability and how far the simulation is behind (OPS-07). */
export const GET = publicRoute({}, async ({ req }) => {
  const started = Date.now();
  // Error details are for operators only.
  const secret = process.env.CRON_SECRET;
  const operator = !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
  try {
    const state = await loadWorldState(pool());
    const now = new Date();
    const nextTick = state ? tickTime(state, state.last_tick + 1) : null;
    return {
      ok: true,
      db: 'up',
      dbLatencyMs: Date.now() - started,
      world: state
        ? {
            tick: state.last_tick,
            speed: state.speed,
            lastTickAt: state.last_tick_at,
            behindMs: nextTick ? Math.max(0, now.getTime() - nextTick.getTime()) : 0,
            healthy: !state.last_error,
            lastError: operator ? state.last_error : undefined,
            lastErrorAt: state.last_error_at,
          }
        : null,
    };
  } catch (err) {
    console.error('[health] database check failed', err);
    return json({ ok: false, db: 'down', error: operator && err instanceof Error ? err.message : undefined }, 503);
  }
});
