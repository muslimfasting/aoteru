import { advanceLazily } from '@/server/advance';
import { pool } from '@/server/db';
import { json, publicRoute } from '@/server/http';
import { loadWorldState, tickTime } from '@/server/world';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — database reachability and how far the simulation is behind (OPS-07).
 *
 * Asking also nudges the world forward (throttled, never blocking), so any
 * uptime monitor pointed here keeps the simulation current while no player is
 * online — without needing the cron secret.
 */
export const GET = publicRoute({}, async ({ req }) => {
  const started = Date.now();
  // Error details are for operators only.
  const secret = process.env.CRON_SECRET;
  const operator = !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
  try {
    if (await loadWorldState(pool())) await advanceLazily();
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
