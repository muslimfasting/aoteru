import { randomUUID } from 'node:crypto';
import type { IntelDTO } from '@/game/api';
import { WORLD, armyPower, emptyBuildingLevels, emptyUnits } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import type { Modifiers } from '@/game/pillars';
import { createRng } from '@/game/rng';
import { getGarrison } from './armies';
import { one, rows, type Db } from './db';
import { conflict, invalid, notFound } from './errors';
import { getResources, spend } from './economy';
import { audit, emitClan, notifyClan } from './notify';
import { awardClanXp } from './progression';
import { levelsByProvince, loadBuildings, loadMods, type ClanRow, type ProvinceRow } from './rows';
import { addMs, gameMs, type G } from './world';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function scoutOdds(mine: Modifiers, theirs: Modifiers): { success: number; detection: number; cost: number; minutes: number } {
  return {
    success: clamp(WORLD.scout.baseSuccess + mine.scoutSuccess - theirs.scoutDefense, 0.1, 0.95),
    detection: clamp(WORLD.scout.baseDetection + theirs.detect - mine.scoutSuccess * 0.5, 0.05, 0.9),
    cost: Math.round(WORLD.scout.cost * Math.max(0.2, 1 - mine.scoutCost)),
    minutes: WORLD.scout.minutes * Math.max(0.3, 1 - mine.scoutTime),
  };
}

/** Why the clan cannot scout this province, or null. Scouts work from the clan's own borders. */
export async function scoutBlockReason(db: Db, clanId: string, province: ProvinceRow): Promise<string | null> {
  if (province.owner_clan_id === clanId) return 'This is your own province';
  const neighborCodes = PROVINCE_BY_CODE[province.code]?.neighbors ?? [];
  const reach = await one(db, 'SELECT 1 FROM provinces WHERE owner_clan_id = $1 AND code = ANY($2) LIMIT 1', [clanId, neighborCodes]);
  if (!reach) return 'Your scouts can only reach provinces that border your land';
  const pending = await one(db, `SELECT 1 FROM espionage WHERE clan_id = $1 AND target_province_id = $2 AND status = 'pending'`, [clanId, province.id]);
  if (pending) return 'Your scouts are already on their way there';
  return null;
}

/** Send scouts into a province (ESP-01..05). The outcome is decided when they return. */
export async function executeScout(g: G, clan: ClanRow, provinceId: string): Promise<string> {
  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1', [provinceId]);
  if (!province) throw notFound('Province');
  const blocked = await scoutBlockReason(g.tx, clan.id, province);
  if (blocked) throw conflict('SCOUT_BLOCKED', blocked);

  const mine = await loadMods(g.tx, clan.id);
  const theirs = await loadMods(g.tx, province.owner_clan_id);
  const odds = scoutOdds(mine, theirs);
  const op = await one<{ id: string }>(
    g.tx,
    `INSERT INTO espionage (clan_id, target_province_id, target_clan_id, operation, cost, success_chance, detection_chance, seed, started_at, completes_at)
     VALUES ($1, $2, $3, 'scout', $4, $5, $6, $7, $8, $9) RETURNING id`,
    [clan.id, province.id, province.owner_clan_id, odds.cost, odds.success, odds.detection, randomUUID(), g.now, addMs(g.now, gameMs(g, odds.minutes))],
  );
  await spend(g, clan.id, { gold: odds.cost }, 'espionage', { type: 'espionage', id: op!.id });
  await audit(g, 'espionage.execute', { type: 'espionage', id: op!.id }, clan.id, { operation: 'scout', province: province.code });
  return op!.id;
}

/** The scouts return (or do not). Decided by the stored seed; safe to call more than once. */
export async function resolveEspionage(g: G, opId: string): Promise<void> {
  const op = await one<{
    id: string;
    clan_id: string;
    target_province_id: string;
    success_chance: number;
    detection_chance: number;
    seed: string;
  }>(g.tx, `SELECT * FROM espionage WHERE id = $1 AND status = 'pending' AND completes_at <= $2 FOR UPDATE`, [opId, g.now]);
  if (!op) return;
  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1', [op.target_province_id]);
  const clan = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [op.clan_id]);
  if (!province || !clan) {
    await g.tx.query(`UPDATE espionage SET status = 'failed', resolved_at = $2 WHERE id = $1`, [opId, g.now]);
    return;
  }
  const rng = createRng(`espionage:${op.seed}`);
  // A province that became yours in the meantime needs no spying.
  const success = province.owner_clan_id === clan.id ? false : rng.chance(op.success_chance);
  const detected = rng.chance(success ? op.detection_chance * 0.5 : op.detection_chance);
  const mods = await loadMods(g.tx, clan.id);

  let report: IntelDTO | null = null;
  let expiresAt: Date | null = null;
  if (success) {
    const garrison = await getGarrison(g.tx, province.id, province.owner_clan_id);
    const levels = levelsByProvince(await loadBuildings(g.tx, province.id)).get(province.id) ?? emptyBuildingLevels();
    const units = garrison?.units ?? emptyUnits();
    expiresAt = addMs(g.now, gameMs(g, WORLD.scout.reportHours * 60 * (1 + mods.reportDuration)));
    report = {
      operationId: op.id,
      reportedAt: g.now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      units,
      power: armyPower(units),
      castleLevel: levels.castle,
      buildings: levels,
      loyalty: Math.round(province.loyalty),
      ownerResources: province.owner_clan_id ? await getResources(g.tx, province.owner_clan_id) : null,
    };
  }
  await g.tx.query(
    `UPDATE espionage SET status = $2, detected = $3, resolved_at = $4, report = $5, report_expires_at = $6 WHERE id = $1`,
    [opId, success ? 'success' : 'failed', detected, g.now, report ? JSON.stringify(report) : null, expiresAt],
  );

  await awardClanXp(g, clan.id, 'intelligence', success ? 25 : 8, mods.xpGain);
  await notifyClan(g, clan.id, {
    type: 'espionage',
    title: success ? `Scouts return from ${province.name}` : `Scouts lost in ${province.name}`,
    body: success
      ? `Your scouts counted ${report!.units ? Object.values(report!.units).reduce((a, b) => a + b, 0) : 0} defenders in ${province.name}.${detected ? ' They were seen on the way out.' : ''}`
      : `Your scouts brought back nothing from ${province.name}.${detected ? ' The defenders know someone was watching.' : ''}`,
    link: '/game/intel',
  });
  await emitClan(g, clan.id, 'espionage:completed', { operationId: op.id, provinceId: province.id, success });

  if (detected && province.owner_clan_id && province.owner_clan_id !== clan.id) {
    const theirs = await loadMods(g.tx, province.owner_clan_id);
    await awardClanXp(g, province.owner_clan_id, 'intelligence', 15, theirs.xpGain);
    await notifyClan(g, province.owner_clan_id, {
      type: 'espionage',
      title: `Spies caught in ${province.name}`,
      body: `Your guards intercepted scouts of the ${clan.name} clan in ${province.name}.`,
      link: '/game/intel',
    });
  }
}

/** The viewer's latest unexpired scouting report on each province. */
export async function freshIntel(db: Db, clanId: string, now: Date, provinceId?: string): Promise<Map<string, IntelDTO>> {
  const res = await rows<{ target_province_id: string; report: IntelDTO }>(
    db,
    `SELECT DISTINCT ON (target_province_id) target_province_id, report
       FROM espionage
      WHERE clan_id = $1 AND status = 'success' AND report_expires_at > $2 ${provinceId ? 'AND target_province_id = $3' : ''}
      ORDER BY target_province_id, resolved_at DESC`,
    provinceId ? [clanId, now, provinceId] : [clanId, now],
  );
  return new Map(res.map((r) => [r.target_province_id, r.report]));
}

export function assertOperation(op: unknown): asserts op is 'scout' {
  if (op !== 'scout') throw invalid('Unknown operation');
}
