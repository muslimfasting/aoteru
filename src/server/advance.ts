/**
 * The simulation engine (GDD §13).
 *
 * The world is advanced as a discrete-event simulation over stored timestamps:
 * each step takes the single earliest thing that is due — a building finishing,
 * a muster completing, an army arriving, a battle or a scouting mission coming
 * due, or the next hourly tick — and processes it at the time it was due, in
 * its own transaction under the world lock.
 *
 * Because every step is driven by stored times rather than by when the worker
 * happens to run, the world reaches exactly the same state whether it is
 * advanced every second by a worker, once a minute by a cron job, or all at
 * once after nobody has looked at it for a day. That is what lets the same
 * engine run on serverless hosting and under a long-lived worker.
 *
 * Guarantees: a step commits completely or not at all (retryable); two
 * advancers can never run a step at the same time (world lock); a tick can
 * never be processed twice (`world_ticks` primary key); a timer can never fire
 * twice (each handler re-checks and locks its row).
 */
import { arriveArmy, completeRecruitment } from './military';
import { resolveBattle } from './battles';
import { completeUpgrade } from './buildings';
import { one, pool, tryWithWorldLock, withWorldLock, type Db } from './db';
import { resolveEspionage } from './espionage';
import { createWorld } from './seed';
import { processTick } from './tick';
import { envSpeed, loadWorldState, tickIntervalMs, tickTime, type G, type WorldStateRow } from './world';

type TimerKind = 'building' | 'recruitment' | 'army' | 'battle' | 'espionage';

interface DueTimer {
  kind: TimerKind;
  id: string;
  due: Date;
}

async function nextTimer(tx: Db): Promise<DueTimer | null> {
  return one<DueTimer>(
    tx,
    `SELECT kind, id, due FROM (
       (SELECT 'building' AS kind, id::text AS id, upgrade_completes_at AS due FROM buildings
         WHERE upgrade_completes_at IS NOT NULL ORDER BY upgrade_completes_at LIMIT 1)
       UNION ALL
       (SELECT 'recruitment', id::text, completes_at FROM recruitment_orders WHERE status = 'pending' ORDER BY completes_at LIMIT 1)
       UNION ALL
       (SELECT 'army', id::text, arrives_at FROM armies WHERE status = 'marching' AND arrives_at IS NOT NULL ORDER BY arrives_at LIMIT 1)
       UNION ALL
       (SELECT 'battle', id::text, resolves_at FROM battles WHERE status = 'pending' ORDER BY resolves_at LIMIT 1)
       UNION ALL
       (SELECT 'espionage', id::text, completes_at FROM espionage WHERE status = 'pending' ORDER BY completes_at LIMIT 1)
     ) t ORDER BY due, kind, id LIMIT 1`,
  );
}

/** If the configured speed changed, re-anchor the clock so the next tick is one new interval away. */
async function syncSpeed(tx: Db, state: WorldStateRow, now: Date): Promise<WorldStateRow> {
  const speed = envSpeed();
  if (Math.abs(speed - state.speed) < 1e-9) return state;
  const epoch = new Date(now.getTime() - state.last_tick * tickIntervalMs(speed));
  await tx.query('UPDATE world_state SET speed = $1, epoch = $2 WHERE id', [speed, epoch]);
  return { ...state, speed, epoch };
}

type StepResult = 'worked' | 'idle';

async function step(tx: Db, now: Date): Promise<StepResult> {
  let state = await loadWorldState(tx, true);
  if (!state) {
    await createWorld(tx, now);
    return 'worked';
  }
  state = await syncSpeed(tx, state, now);

  const timer = await nextTimer(tx);
  const nextTick = tickTime(state, state.last_tick + 1);
  const timerDue = timer && timer.due.getTime() <= now.getTime() ? timer : null;
  const tickDue = nextTick.getTime() <= now.getTime();

  // Timers that fall due before (or exactly at) the next tick are handled first.
  if (timerDue && (!tickDue || timerDue.due.getTime() <= nextTick.getTime())) {
    const g: G = { tx, now: timerDue.due, speed: state.speed, tick: state.last_tick, actorPlayerId: null };
    switch (timerDue.kind) {
      case 'building':
        await completeUpgrade(g, timerDue.id);
        break;
      case 'recruitment':
        await completeRecruitment(g, timerDue.id);
        break;
      case 'army':
        await arriveArmy(g, timerDue.id);
        break;
      case 'battle':
        await resolveBattle(g, timerDue.id);
        break;
      case 'espionage':
        await resolveEspionage(g, timerDue.id);
        break;
    }
    return 'worked';
  }
  if (tickDue) {
    await processTick(tx, state, state.last_tick + 1);
    return 'worked';
  }
  return 'idle';
}

export interface AdvanceOptions {
  now?: Date;
  /** Stop after this much wall time; the rest is picked up by the next call. */
  budgetMs?: number;
  /** Wait for the world lock instead of giving way to another advancer. */
  blocking?: boolean;
  maxSteps?: number;
}

export interface AdvanceResult {
  steps: number;
  /** idle: fully caught up. busy: another advancer holds the lock. budget: more work remains. */
  status: 'idle' | 'busy' | 'budget';
}

export async function advanceWorld(opts: AdvanceOptions = {}): Promise<AdvanceResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 5000;
  const maxSteps = opts.maxSteps ?? 5000;
  let steps = 0;
  while (steps < maxSteps) {
    const now = opts.now ?? new Date();
    let result: StepResult | null;
    try {
      result = opts.blocking ? await withWorldLock((tx) => step(tx, now)) : await tryWithWorldLock((tx) => step(tx, now));
    } catch (err) {
      await recordError(err);
      throw err;
    }
    if (result === null) return { steps, status: 'busy' };
    if (result === 'idle') return { steps, status: 'idle' };
    steps += 1;
    if (Date.now() - started > budget) return { steps, status: 'budget' };
  }
  return { steps, status: 'budget' };
}

async function recordError(err: unknown): Promise<void> {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error('[world] simulation step failed:', err);
  try {
    await pool().query('UPDATE world_state SET last_error = $1, last_error_at = now() WHERE id', [message.slice(0, 1000)]);
  } catch {
    // The database itself is unreachable; nothing more to record.
  }
}

let lastLazyAttempt = 0;

/**
 * Opportunistic catch-up on the request path. Reads call this so the world is
 * current before they answer; it never waits for the lock, runs at most once a
 * second per server instance, and never fails the request it rides on.
 */
export async function advanceLazily(budgetMs = 2500): Promise<void> {
  const t = Date.now();
  if (t - lastLazyAttempt < 1000) return;
  lastLazyAttempt = t;
  try {
    await advanceWorld({ budgetMs, blocking: false });
  } catch {
    // Already logged and recorded by advanceWorld; the read continues on current state.
  }
}

/** Before a player's order: bring the world up to the present so the order is judged against current state. */
export async function advanceForMutation(budgetMs = 4000): Promise<void> {
  try {
    await advanceWorld({ budgetMs, blocking: true });
  } catch {
    // Recorded; the order is still validated against committed state under the world lock.
  }
}
