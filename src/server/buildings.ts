import {
  BUILDINGS,
  BUILDING_TYPES,
  buildingBlockReason,
  buildingCost,
  buildingMinutes,
  type BuildingType,
} from '@/game/config';
import { one, rows } from './db';
import { conflict, forbidden, invalid, notFound } from './errors';
import { spend } from './economy';
import { audit, emit, emitClan, notifyClan, WORLD_ROOM } from './notify';
import { awardClanXp } from './progression';
import { levelsByProvince, loadMods, type BuildingRow, type ProvinceRow } from './rows';
import { addMs, gameMs, type G } from './world';

/**
 * Start a building upgrade (BUILD-02..05). Ownership, prerequisites, the
 * one-project-per-province rule and the cost are all validated here; the timer
 * is a stored timestamp, so construction continues while the player is offline.
 */
export async function startUpgrade(g: G, clanId: string, provinceId: string, type: BuildingType): Promise<void> {
  if (!(BUILDING_TYPES as readonly string[]).includes(type)) throw invalid('Unknown building');
  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 FOR UPDATE', [provinceId]);
  if (!province) throw notFound('Province');
  if (province.owner_clan_id !== clanId) throw forbidden('You do not hold this province');

  const buildings = await rows<BuildingRow>(g.tx, 'SELECT * FROM buildings WHERE province_id = $1 FOR UPDATE', [provinceId]);
  if (buildings.some((b) => b.upgrade_completes_at)) {
    throw conflict('CONSTRUCTION_BUSY', 'The builders of this province are already at work');
  }
  const target = buildings.find((b) => b.type === type);
  if (!target) throw notFound('Building');
  const levels = levelsByProvince(buildings).get(provinceId)!;
  const reason = buildingBlockReason(type, levels);
  if (reason) throw conflict('BUILDING_LOCKED', reason);

  const mods = await loadMods(g.tx, clanId);
  const toLevel = target.level + 1;
  await spend(g, clanId, buildingCost(type, toLevel, mods.buildCost), 'building_upgrade', { type: 'building', id: target.id });
  const completesAt = addMs(g.now, gameMs(g, buildingMinutes(type, toLevel, mods.buildTime)));
  await g.tx.query('UPDATE buildings SET upgrade_started_at = $2, upgrade_completes_at = $3 WHERE id = $1', [target.id, g.now, completesAt]);
  await audit(g, 'building.upgrade', { type: 'building', id: target.id }, clanId, { province: province.code, building: type, toLevel });
}

/** Finish an upgrade whose timer has run out. Safe to call more than once. */
export async function completeUpgrade(g: G, buildingId: string): Promise<void> {
  const building = await one<BuildingRow>(
    g.tx,
    'SELECT * FROM buildings WHERE id = $1 AND upgrade_completes_at IS NOT NULL AND upgrade_completes_at <= $2 FOR UPDATE',
    [buildingId, g.now],
  );
  if (!building) return;
  const level = building.level + 1;
  await g.tx.query('UPDATE buildings SET level = $2, upgrade_started_at = NULL, upgrade_completes_at = NULL WHERE id = $1', [buildingId, level]);
  const province = await one<ProvinceRow>(
    g.tx,
    `UPDATE provinces
        SET development_level = development_level + 1,
            defense_level = CASE WHEN $2::text = 'castle' THEN $3::int ELSE defense_level END,
            updated_at = $4
      WHERE id = $1 RETURNING *`,
    [building.province_id, building.type, level, g.now],
  );
  if (!province) return;
  const owner = province.owner_clan_id;
  if (owner) {
    const mods = await loadMods(g.tx, owner);
    await awardClanXp(g, owner, 'economy', 15 * level, mods.xpGain);
    await notifyClan(g, owner, {
      type: 'building',
      title: `${BUILDINGS[building.type].name} level ${level} completed`,
      body: `The ${BUILDINGS[building.type].name.toLowerCase()} in ${province.name} now stands at level ${level}.`,
      link: `/game/castle?province=${province.id}`,
    });
    await emitClan(g, owner, 'building:completed', { provinceId: province.id, type: building.type, level });
  }
  if (building.type === 'castle') await emit(g, WORLD_ROOM, 'world:province_updated', { provinceId: province.id });
}
