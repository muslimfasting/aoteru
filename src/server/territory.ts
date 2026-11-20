import { WORLD } from '@/game/config';
import { one, rows } from './db';
import { chronicle, emit, notifyClan, notifyPlayer, WORLD_ROOM } from './notify';
import { loadMods, type ClanRow, type ProvinceRow } from './rows';
import { dayLabel, loadWorldState, type G } from './world';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Change the owner of a province. This is the only place ownership is ever
 * written after world creation, so every change is validated by a caller that
 * holds the world lock, recorded in the history table and announced.
 */
export async function transferProvince(
  g: G,
  province: ProvinceRow,
  toClanId: string | null,
  reason: 'conquest' | 'founding' | 'rebellion' | 'abandoned',
  battleId: string | null = null,
  loyalty?: number,
): Promise<void> {
  const fromClanId = province.owner_clan_id;
  let newLoyalty = loyalty;
  if (newLoyalty === undefined) {
    if (toClanId) {
      const mods = await loadMods(g.tx, toClanId);
      newLoyalty = clamp(WORLD.conqueredLoyalty + mods.conquestLoyalty, 0, 100);
    } else {
      newLoyalty = 50;
    }
  }
  await g.tx.query(
    `UPDATE provinces SET owner_clan_id = $2, loyalty = $3, owner_since = $4, updated_at = $4,
                          stance = 'formation', stance_next = NULL, stance_ready_at = NULL
      WHERE id = $1`,
    [
    province.id,
    toClanId,
    newLoyalty,
    g.now,
  ]);
  await g.tx.query(
    'INSERT INTO province_ownership_history (province_id, from_clan_id, to_clan_id, reason, battle_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [province.id, fromClanId, toClanId, reason, battleId, g.now],
  );
  // Musters ordered by a previous owner are abandoned.
  await g.tx.query(
    `UPDATE recruitment_orders SET status = 'cancelled' WHERE province_id = $1 AND status = 'pending' AND clan_id IS DISTINCT FROM $2`,
    [province.id, toClanId],
  );

  if (fromClanId) await handleLoss(g, fromClanId, province);
  if (toClanId) {
    await g.tx.query('UPDATE clans SET capital_province_id = $2 WHERE id = $1 AND capital_province_id IS NULL', [toClanId, province.id]);
  }
  await updateHegemony(g);
  await emit(g, WORLD_ROOM, 'world:province_updated', { provinceId: province.id, ownerClanId: toClanId });
}

async function handleLoss(g: G, clanId: string, lost: ProvinceRow): Promise<void> {
  const clan = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1 FOR UPDATE', [clanId]);
  if (!clan || clan.status === 'disbanded') return;
  const remaining = await rows<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE owner_clan_id = $1 ORDER BY population DESC, code', [clanId]);
  if (remaining.length === 0) {
    await clanFalls(g, clan, lost);
    return;
  }
  if (clan.capital_province_id === lost.id) {
    const seat = remaining[0];
    await g.tx.query('UPDATE clans SET capital_province_id = $2 WHERE id = $1', [clanId, seat.id]);
    await notifyClan(g, clanId, {
      type: 'province',
      title: 'Your capital has fallen',
      body: `${lost.name} is lost. Your court has withdrawn to ${seat.name}.`,
      link: '/game/map',
    });
  }
}

/** A clan with no land left is out of the struggle — until its Daimyo founds a new seat. */
async function clanFalls(g: G, clan: ClanRow, lastProvince: ProvinceRow): Promise<void> {
  await g.tx.query(`UPDATE clans SET status = 'fallen', capital_province_id = NULL, protected_until = NULL, starving_ticks = 0 WHERE id = $1`, [clan.id]);
  await g.tx.query(
    `UPDATE wars SET status = 'ended', ended_at = $2, end_reason = 'clan_fallen'
      WHERE status = 'active' AND (attacker_clan_id = $1 OR defender_clan_id = $1)`,
    [clan.id, g.now],
  );
  await g.tx.query(`UPDATE diplomacy SET status = 'expired', responded_at = $2 WHERE status = 'pending' AND (from_clan_id = $1 OR to_clan_id = $1)`, [
    clan.id,
    g.now,
  ]);
  await g.tx.query(`UPDATE recruitment_orders SET status = 'cancelled' WHERE clan_id = $1 AND status = 'pending'`, [clan.id]);
  await g.tx.query(`UPDATE pacts SET status = 'ended', ended_at = $2, end_reason = 'clan_fallen' WHERE status = 'active' AND (clan_a = $1 OR clan_b = $1)`, [
    clan.id,
    g.now,
  ]);
  await g.tx.query(`UPDATE war_plans SET status = 'cancelled', outcome = 'the clan fell', updated_at = $2 WHERE clan_id = $1 AND status IN ('draft', 'ready', 'launched')`, [
    clan.id,
    g.now,
  ]);
  // Armies in the field have no lord left to serve. Battles they were fighting are cancelled when they come due.
  await g.tx.query('DELETE FROM armies WHERE clan_id = $1', [clan.id]);
  await chronicle(g, {
    type: 'fallen',
    title: `The government of ${clan.name} has fallen`,
    description: `On ${dayLabel(g.tick)}, with the loss of ${lastProvince.name}, the nation of ${clan.name} held no land in the realm. ${clan.daimyo_name} vanished from the records.`,
    clanId: clan.id,
    provinceId: lastProvince.id,
  });
  await notifyClan(g, clan.id, {
    type: 'province',
    title: 'Your nation has fallen',
    body: 'Your last province is lost. Everyone keeps what they have learned in the Five Pillars. The Chancellor may found a new seat in any unclaimed starting province; officials may also leave for another nation.',
    link: '/game/clan',
  });
  await emit(g, WORLD_ROOM, 'diplomacy:updated', { clanId: clan.id });
}

/** Proclaim (or strip) the regional hegemon — the prototype's victory condition. The world carries on either way. */
export async function updateHegemony(g: G): Promise<void> {
  const state = await loadWorldState(g.tx, true);
  if (!state) return;
  const counts = await rows<{ owner_clan_id: string; n: number }>(
    g.tx,
    `SELECT owner_clan_id, COUNT(*)::int AS n FROM provinces WHERE owner_clan_id IS NOT NULL GROUP BY owner_clan_id ORDER BY n DESC, owner_clan_id`,
  );
  const byClan = new Map(counts.map((c) => [c.owner_clan_id, c.n]));
  const current = state.hegemon_clan_id;

  if (current && (byClan.get(current) ?? 0) < WORLD.hegemonyProvinces) {
    const clan = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [current]);
    await g.tx.query('UPDATE world_state SET hegemon_clan_id = NULL, hegemon_since = NULL WHERE id');
    await chronicle(g, {
      type: 'hegemony',
      title: `The ${clan?.name ?? 'former'} hegemony is broken`,
      description: `On ${dayLabel(g.tick)}, the nation of ${clan?.name ?? 'ruling'} no longer held enough of Kansai to command it. The realm is contested once more.`,
      clanId: current,
    });
  }

  const top = counts[0];
  const holder = (byClan.get(current ?? '') ?? 0) >= WORLD.hegemonyProvinces ? current : null;
  if (!holder && top && top.n >= WORLD.hegemonyProvinces) {
    const clan = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [top.owner_clan_id]);
    if (!clan) return;
    await g.tx.query('UPDATE world_state SET hegemon_clan_id = $1, hegemon_since = $2 WHERE id', [clan.id, g.now]);
    await chronicle(g, {
      type: 'hegemony',
      title: `${clan.daimyo_name} is proclaimed Hegemon of Kansai`,
      description: `On ${dayLabel(g.tick)}, holding ${top.n} provinces, the nation of ${clan.name} was acknowledged master of the home provinces. Rivals now gather against the new order.`,
      clanId: clan.id,
    });
    const players = await rows<{ id: string }>(g.tx, 'SELECT id FROM players');
    for (const p of players) {
      await notifyPlayer(g, p.id, {
        type: 'event',
        title: `${clan.daimyo_name} is proclaimed Hegemon of Kansai`,
        body: `The nation of ${clan.name} now holds ${top.n} provinces. The struggle continues: break the hegemony or defend it.`,
        link: '/game/map',
      });
    }
  }
}
