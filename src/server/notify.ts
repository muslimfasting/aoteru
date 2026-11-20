import type { RealtimeEventName } from '@/game/api';
import type { ResourceBag } from '@/game/config';
import { one, rows, type Db } from './db';
import type { G } from './world';

type Ctx = Pick<G, 'tx' | 'now'>;

export const WORLD_ROOM = 'world';
export const playerRoom = (playerId: string) => `player:${playerId}`;
export const clanRoom = (clanId: string) => `clan:${clanId}`;

/**
 * Queue a realtime event (GDD §16). Events go to the shared world room, to a
 * clan's room (heard by its members) or to a single player's private room —
 * never a resource balance to everyone.
 */
export async function emit(g: Ctx, room: string, event: RealtimeEventName, payload: Record<string, unknown> = {}): Promise<void> {
  await g.tx.query('INSERT INTO realtime_events (room, event, payload, created_at) VALUES ($1, $2, $3, $4)', [
    room,
    event,
    JSON.stringify(payload),
    g.now,
  ]);
}

/** The players who belong to a clan. Empty for NPC clans. */
export async function memberIds(tx: Db, clanId: string | null): Promise<string[]> {
  if (!clanId) return [];
  const res = await rows<{ player_id: string }>(tx, 'SELECT player_id FROM clan_members WHERE clan_id = $1', [clanId]);
  return res.map((r) => r.player_id);
}

/** Emit to the members of a clan (NPC clans have nobody listening, so nothing is queued). */
export async function emitClan(g: Ctx, clanId: string | null, event: RealtimeEventName, payload: Record<string, unknown> = {}): Promise<void> {
  if (!clanId) return;
  if (!(await one(g.tx, 'SELECT 1 FROM clan_members WHERE clan_id = $1 LIMIT 1', [clanId]))) return;
  await emit(g, clanRoom(clanId), event, payload);
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

/** Notify every member of a clan. `except` leaves out the member who caused the news. */
export async function notifyClan(g: Ctx, clanId: string | null, n: NotificationInput, except?: string | null): Promise<void> {
  for (const playerId of await memberIds(g.tx, clanId)) {
    if (playerId === except) continue;
    await notifyPlayer(g, playerId, n);
  }
}

/** Notify the members of a clan whose role holds a permission (and always the leader). */
export async function notifyClanRoles(g: Ctx, clanId: string, permission: string, n: NotificationInput): Promise<void> {
  const res = await rows<{ player_id: string }>(
    g.tx,
    `SELECT m.player_id FROM clan_members m
      WHERE m.clan_id = $1
        AND (m.role = 'leader' OR EXISTS (
              SELECT 1 FROM clan_role_permissions p WHERE p.clan_id = m.clan_id AND p.role = m.role AND p.permission = $2))`,
    [clanId, permission],
  );
  for (const r of res) await notifyPlayer(g, r.player_id, n);
}

/** Append to the clan's activity history and tell its members. */
export async function clanActivity(g: Ctx & { actorPlayerId?: string | null }, clanId: string, type: string, body: string): Promise<void> {
  await g.tx.query('INSERT INTO clan_activity (clan_id, actor_player_id, type, body, created_at) VALUES ($1, $2, $3, $4, $5)', [
    clanId,
    g.actorPlayerId ?? null,
    type,
    body,
    g.now,
  ]);
  await emit(g, clanRoom(clanId), 'clan:updated', { clanId, type });
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
