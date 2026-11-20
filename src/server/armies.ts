/** Low-level army bookkeeping shared by recruitment, marching and battles. */
import { UNIT_TYPES, marchMinutes, totalUnits, type UnitCounts } from '@/game/config';
import { one, type Db } from './db';
import { conflict } from './errors';
import { emit, notifyClan, WORLD_ROOM } from './notify';
import { loadArmies, type ArmyRow, type ClanRow, type ProvinceRow } from './rows';
import { addMs, gameMs, type G } from './world';

export async function getGarrison(tx: Db, provinceId: string, clanId: string | null): Promise<ArmyRow | null> {
  const [army] = clanId
    ? await loadArmies(tx, `a.province_id = $1 AND a.clan_id = $2 AND a.status = 'garrison'`, [provinceId, clanId])
    : await loadArmies(tx, `a.province_id = $1 AND a.clan_id IS NULL AND a.status = 'garrison'`, [provinceId]);
  return army ?? null;
}

/** Find or create the garrison a clan (or the local warriors, for null) keeps in a province. */
export async function ensureGarrison(tx: Db, provinceId: string, clanId: string | null): Promise<string> {
  const existing = clanId
    ? await one<{ id: string }>(tx, `SELECT id FROM armies WHERE province_id = $1 AND clan_id = $2 AND status = 'garrison' FOR UPDATE`, [provinceId, clanId])
    : await one<{ id: string }>(tx, `SELECT id FROM armies WHERE province_id = $1 AND clan_id IS NULL AND status = 'garrison' FOR UPDATE`, [provinceId]);
  if (existing) return existing.id;
  const created = await one<{ id: string }>(tx, `INSERT INTO armies (clan_id, province_id, status) VALUES ($1, $2, 'garrison') RETURNING id`, [
    clanId,
    provinceId,
  ]);
  return created!.id;
}

export async function addUnitsToArmy(tx: Db, armyId: string, units: Partial<UnitCounts>): Promise<void> {
  for (const t of UNIT_TYPES) {
    const n = units[t] ?? 0;
    if (n <= 0) continue;
    await tx.query(
      `INSERT INTO army_units (army_id, unit_type, count) VALUES ($1, $2, $3)
       ON CONFLICT (army_id, unit_type) DO UPDATE SET count = army_units.count + EXCLUDED.count`,
      [armyId, t, n],
    );
  }
}

/** Take soldiers out of an army. Each deduction is conditional, so troops can never be sent twice. */
export async function removeUnitsFromArmy(tx: Db, armyId: string, units: Partial<UnitCounts>): Promise<void> {
  for (const t of UNIT_TYPES) {
    const n = units[t] ?? 0;
    if (n <= 0) continue;
    const res = await tx.query('UPDATE army_units SET count = count - $3 WHERE army_id = $1 AND unit_type = $2 AND count >= $3', [armyId, t, n]);
    if (res.rowCount !== 1) throw conflict('NOT_ENOUGH_TROOPS', 'The garrison does not have that many soldiers');
  }
}

export async function setArmyUnits(tx: Db, armyId: string, units: UnitCounts): Promise<void> {
  await tx.query('DELETE FROM army_units WHERE army_id = $1', [armyId]);
  await addUnitsToArmy(tx, armyId, units);
}

export async function deleteArmy(tx: Db, armyId: string): Promise<void> {
  await tx.query('DELETE FROM armies WHERE id = $1', [armyId]);
}

/** Fold a field army into the garrison of the province it has reached. */
export async function mergeIntoGarrison(tx: Db, army: Pick<ArmyRow, 'id' | 'clan_id' | 'units'>, provinceId: string): Promise<void> {
  const garrisonId = await ensureGarrison(tx, provinceId, army.clan_id);
  if (garrisonId === army.id) return;
  await addUnitsToArmy(tx, garrisonId, army.units);
  await deleteArmy(tx, army.id);
}

/**
 * Send what is left of an army back to friendly land: the preferred province
 * if the clan still holds it, otherwise the capital, otherwise any province.
 * With nowhere to go, the army disbands.
 */
export async function sendHome(
  g: G,
  army: Pick<ArmyRow, 'id' | 'clan_id' | 'units'>,
  from: Pick<ProvinceRow, 'id' | 'name'>,
  preferredHomeId: string | null,
  durationMs?: number,
): Promise<void> {
  if (!army.clan_id || totalUnits(army.units) <= 0) {
    await deleteArmy(g.tx, army.id);
    return;
  }
  const clan = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [army.clan_id]);
  let home: ProvinceRow | null = null;
  if (preferredHomeId) {
    home = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 AND owner_clan_id = $2', [preferredHomeId, army.clan_id]);
  }
  if (!home && clan?.capital_province_id) {
    home = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 AND owner_clan_id = $2', [clan.capital_province_id, army.clan_id]);
  }
  if (!home) {
    home = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE owner_clan_id = $1 ORDER BY population DESC LIMIT 1', [army.clan_id]);
  }
  if (!home) {
    await deleteArmy(g.tx, army.id);
    await notifyClan(g, army.clan_id, {
      type: 'army',
      title: 'An army has disbanded',
      body: `With no land left to return to, your soldiers near ${from.name} have scattered.`,
      link: '/game/military',
    });
    return;
  }
  if (home.id === from.id) {
    await mergeIntoGarrison(g.tx, army, home.id);
    return;
  }
  const ms = durationMs ?? gameMs(g, marchMinutes([home.terrain], army.units));
  await g.tx.query(
    `UPDATE armies
        SET status = 'marching', intent = 'return', province_id = $2, target_province_id = $3,
            path = $4, departed_at = $5, arrives_at = $6
      WHERE id = $1`,
    [army.id, from.id, home.id, JSON.stringify([home.id]), g.now, addMs(g.now, ms)],
  );
  await emit(g, WORLD_ROOM, 'army:updated', { armyId: army.id, clanId: army.clan_id });
}

/** Every soldier a clan has under arms, wherever they are. */
export async function clanArmies(tx: Db, clanId: string): Promise<ArmyRow[]> {
  return loadArmies(tx, 'a.clan_id = $1', [clanId]);
}

export async function pendingRecruits(tx: Db, clanId: string): Promise<number> {
  const row = await one<{ n: number }>(tx, `SELECT COALESCE(SUM(count), 0)::int AS n FROM recruitment_orders WHERE clan_id = $1 AND status = 'pending'`, [
    clanId,
  ]);
  return row?.n ?? 0;
}
