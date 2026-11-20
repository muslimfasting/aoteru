import type { RealtimeEventName } from '@/game/api';
import type { ResourceBag } from '@/game/config';
import { one, type Db } from './db';
import type { G } from './world';

type Ctx = Pick<G, 'tx' | 'now'>;

export const WORLD_ROOM = 'world';
export const playerRoom = (playerId: string) => `player:${playerId}`;

/**
 * Queue a realtime event (GDD §16). Events go to the shared world room or to a
 * single player's private room — never a resource balance to everyone.
 */
export async function emit(g: Ctx, room: string, event: RealtimeEventName, payload: Record<string, unknown> = {}): Promise<void> {
  await g.tx.query('INSERT INTO realtime_events (room, event, payload, created_at) VALUES ($1, $2, $3, $4)', [
    room,
    event,
    JSON.stringify(payload),
    g.now,
  ]);
}

async function playerOfClan(tx: Db, clanId: string | null): Promise<string | null> {
  if (!clanId) return null;
  const row = await one<{ player_id: string | null }>(tx, 'SELECT player_id FROM clans WHERE id = $1', [clanId]);
  return row?.player_id ?? null;
}

/** Emit to the human player behind a clan, if there is one (NPC clans have no room). */
export async function emitClan(g: Ctx, clanId: string | null, event: RealtimeEventName, payload: Record<string, unknown> = {}): Promise<void> {
  const playerId = await playerOfClan(g.tx, clanId);
  if (playerId) await emit(g, playerRoom(playerId), event, payload);
}

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  link?: string | null;
}

export async function notifyPlayer(g: Ctx, playerId: string, n: NotificationInput): Promise<void> {
  const row = await one<{ id: string }>(
    g.tx,
    `INSERT INTO notifications (player_id, type, title, body, link, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [playerId, n.type, n.title, n.body, n.link ?? null, g.now],
  );
  await emit(g, playerRoom(playerId), 'notification:new', {
    id: row!.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
  });
}

export async function notifyClan(g: Ctx, clanId: string | null, n: NotificationInput): Promise<void> {
  const playerId = await playerOfClan(g.tx, clanId);
  if (playerId) await notifyPlayer(g, playerId, n);
}

export interface ChronicleInput {
  type: string;
  title: string;
  description: string;
  provinceId?: string | null;
  clanId?: string | null;
  /** Lasting effect, e.g. `{ production: { food: 0.5 } }`, in force until `endsAt`. */
  effects?: { production?: Partial<ResourceBag> } | null;
  endsAt?: Date | null;
}

/** Record an entry in the realm chronicle and tell everyone watching the world. */
export async function chronicle(g: Ctx, e: ChronicleInput): Promise<string> {
  const row = await one<{ id: string }>(
    g.tx,
    `INSERT INTO world_events (type, title, description, province_id, clan_id, effects, starts_at, ends_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7) RETURNING id`,
    [e.type, e.title, e.description, e.provinceId ?? null, e.clanId ?? null, e.effects ? JSON.stringify(e.effects) : null, g.now, e.endsAt ?? null],
  );
  await emit(g, WORLD_ROOM, 'world:event', { id: row!.id, type: e.type, title: e.title, provinceId: e.provinceId ?? null });
  return row!.id;
}

/** Append to the audit log. Called inside the same transaction as the action it records. */
export async function audit(
  g: Pick<G, 'tx' | 'now' | 'actorPlayerId'>,
  action: string,
  entity: { type: string; id: string | null },
  clanId: string | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  await g.tx.query(
    `INSERT INTO audit_logs (actor_player_id, clan_id, action, entity_type, entity_id, data, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [g.actorPlayerId, clanId, action, entity.type, entity.id, JSON.stringify(data), g.now],
  );
}
