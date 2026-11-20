import type { WorldMetaDTO } from '@/game/api';
import { WORLD } from '@/game/config';
import { one, type Db } from './db';

export const HOUR_MS = 3_600_000;

export interface WorldStateRow {
  epoch: Date;
  speed: number;
  last_tick: number;
  last_tick_at: Date | null;
  hegemon_clan_id: string | null;
  hegemon_since: Date | null;
  last_error: string | null;
  last_error_at: Date | null;
}

/**
 * Game context handed to every service: the transaction, the moment the action
 * happens ("now" is the simulated time while the world is catching up, never
 * the wall clock) and the world speed.
 */
export interface G {
  tx: Db;
  now: Date;
  speed: number;
  /** Last processed tick. */
  tick: number;
  /** Who is acting, for the audit log. Null for the simulation itself. */
  actorPlayerId: string | null;
}

export function envSpeed(): number {
  const s = Number(process.env.WORLD_SPEED ?? '1');
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(s, 7200);
}

export function tickIntervalMs(speed: number): number {
  return HOUR_MS / speed;
}

/** Real milliseconds for a span of game minutes. */
export function gameMs(g: { speed: number }, minutes: number): number {
  return Math.max(1, Math.round((minutes * 60_000) / g.speed));
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function tickTime(state: Pick<WorldStateRow, 'epoch' | 'speed'>, tick: number): Date {
  return new Date(state.epoch.getTime() + tick * tickIntervalMs(state.speed));
}

export async function loadWorldState(db: Db, forUpdate = false): Promise<WorldStateRow | null> {
  return one<WorldStateRow>(db, `SELECT * FROM world_state WHERE id${forUpdate ? ' FOR UPDATE' : ''}`);
}

export async function gameContext(tx: Db, now: Date, actorPlayerId: string | null = null): Promise<G> {
  const state = await loadWorldState(tx);
  if (!state) throw new Error('World has not been created yet');
  return { tx, now, speed: state.speed, tick: state.last_tick, actorPlayerId };
}

export function worldMeta(state: WorldStateRow, now: Date): WorldMetaDTO {
  const interval = tickIntervalMs(state.speed);
  const next = tickTime(state, state.last_tick + 1);
  return {
    now: now.toISOString(),
    speed: state.speed,
    tickIntervalMs: interval,
    tickNumber: state.last_tick,
    nextTickAt: next.toISOString(),
    day: Math.floor(state.last_tick / WORLD.ticksPerDay) + 1,
    hour: state.last_tick % WORLD.ticksPerDay,
    behind: now.getTime() - next.getTime() > Math.max(5_000, interval),
    hegemon:
      state.hegemon_clan_id && state.hegemon_since
        ? { clanId: state.hegemon_clan_id, since: state.hegemon_since.toISOString() }
        : null,
    hegemonyProvinces: WORLD.hegemonyProvinces,
  };
}

/** "the 3rd day" — used by the chronicle. */
export function dayLabel(tick: number): string {
  const day = Math.floor(tick / WORLD.ticksPerDay) + 1;
  const mod100 = day % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th';
  return `the ${day}${suffix} day`;
}
