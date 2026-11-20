/**
 * NPC daimyo (GDD §9, AI-01..03).
 *
 * Deterministic and rule-based: an NPC looks at the same world state and uses
 * the very same order functions as a player (so every rule, cost and timer
 * applies to it too), in this fixed order of priorities:
 *
 *   1. protect vulnerable territories   4. recruit military
 *   2. maintain food reserves           5. evaluate wars
 *   3. develop the economy              6. expand when sufficiently strong
 */
import {
  BUILDING_EFFECTS,
  BUILDING_TYPES,
  TERRAIN_INFO,
  UNITS,
  UNIT_TYPES,
  armyPower,
  armyUpkeep,
  buildingBlockReason,
  buildingCost,
  canAfford,
  emptyBuildingLevels,
  emptyUnits,
  totalUnits,
  unitBlockReason,
  unitCost,
  type BuildingType,
  type ResourceBag,
  type UnitCounts,
  type UnitType,
} from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import { startUpgrade } from './buildings';
import { one } from './db';
import { declareWar, warBlockReason, warCost } from './diplomacy';
import { clanIncome, clanUnits, getResources } from './economy';
import { GameError } from './errors';
import { MIN_POPULATION, clanCapacity, dispatchArmy, recruit } from './military';
import {
  atWar,
  eventMultipliers,
  levelsByProvince,
  loadActiveEvents,
  loadActiveWars,
  loadArmies,
  loadBuildings,
  loadClans,
  loadMods,
  loadProvinces,
  type ArmyRow,
  type ClanRow,
  type ProvinceRow,
} from './rows';
import type { G } from './world';

const GOLD_RESERVE = 200;
const TARGET_MIX: Record<UnitType, number> = { ashigaru: 0.45, yari: 0.2, archer: 0.2, samurai: 0.15, cavalry: 0 };

/**
 * Run an order the way a player would. A rule saying "no" is simply the end of
 * that idea: the savepoint undoes anything the half-finished order wrote, so a
 * refused order can never leave the tick in a partial state.
 */
async function attempt(g: G, fn: () => Promise<unknown>): Promise<boolean> {
  await g.tx.query('SAVEPOINT npc_order');
  try {
    await fn();
    await g.tx.query('RELEASE SAVEPOINT npc_order');
    return true;
  } catch (err) {
    await g.tx.query('ROLLBACK TO SAVEPOINT npc_order');
    if (err instanceof GameError) return false;
    throw err;
  }
}

function scaleUnits(units: UnitCounts, factor: number): UnitCounts {
  const out = emptyUnits();
  for (const t of UNIT_TYPES) out[t] = Math.floor(units[t] * factor);
  return out;
}

export async function runNpcTurn(g: G, clan: ClanRow): Promise<void> {
  const aggressive = clan.personality === 'aggressive';
  const provinces = await loadProvinces(g.tx);
  const own = provinces.filter((p) => p.owner_clan_id === clan.id);
  if (own.length === 0) return;
  const byCode = new Map(provinces.map((p) => [p.code, p]));
  const buildings = await loadBuildings(g.tx);
  const levels = levelsByProvince(buildings);
  const mods = await loadMods(g.tx, clan.id);
  let armies = await loadArmies(g.tx);
  let wars = await loadActiveWars(g.tx);
  let stock = await getResources(g.tx, clan.id);

  const mine = () => armies.filter((a) => a.clan_id === clan.id);
  const garrisonOf = (provinceId: string, clanId: string | null): ArmyRow | undefined =>
    armies.find((a) => a.status === 'garrison' && a.province_id === provinceId && a.clan_id === clanId);
  const foreignNeighbors = (p: ProvinceRow): ProvinceRow[] =>
    (PROVINCE_BY_CODE[p.code]?.neighbors ?? []).map((c) => byCode.get(c)!).filter((n) => n && n.owner_clan_id !== clan.id);
  const border = own.filter((p) => foreignNeighbors(p).length > 0);
  const garrisonPower = (p: ProvinceRow) => armyPower(garrisonOf(p.id, clan.id)?.units ?? {});
  const weakestBorder = [...(border.length ? border : own)].sort((a, b) => garrisonPower(a) - garrisonPower(b) || a.code.localeCompare(b.code))[0];

  // 1. Protect vulnerable territories: garrisons with no enemy in sight march to the thinnest border.
  for (const p of own) {
    if (foreignNeighbors(p).length > 0 || p.id === weakestBorder.id) continue;
    const garrison = garrisonOf(p.id, clan.id);
    if (!garrison || totalUnits(garrison.units) < 40) continue;
    await attempt(g, () => dispatchArmy(g, clan, p.id, weakestBorder.id, scaleUnits(garrison.units, 0.7), 'move'));
  }

  // 2. Maintain food reserves: know whether the granaries can carry more mouths.
  const events = await loadActiveEvents(g.tx, g.now);
  const income = clanIncome({ provinces: own, levels, mods, eventMult: eventMultipliers(events), armies: mine() });
  const hungry = income.net.food < 30;

  // 3. Develop the economy: one project per province, lowest building first, farms first when hungry.
  const order: BuildingType[] = hungry ? ['farm', 'market', 'castle', 'barracks', 'dojo'] : ['market', 'farm', 'barracks', 'castle', 'dojo'];
  for (const p of own) {
    const here = buildings.filter((b) => b.province_id === p.id);
    if (here.some((b) => b.upgrade_completes_at)) continue;
    const lv = levels.get(p.id) ?? emptyBuildingLevels();
    const candidates = order
      .filter((t) => (BUILDING_TYPES as readonly string[]).includes(t) && !buildingBlockReason(t, lv))
      .filter((t) => !((t === 'barracks' || t === 'dojo') && lv[t] >= 3))
      .sort((a, b) => lv[a] - lv[b] || order.indexOf(a) - order.indexOf(b));
    for (const type of candidates) {
      const cost = buildingCost(type, lv[type] + 1, mods.buildCost);
      const spare: ResourceBag = { ...stock, gold: stock.gold - GOLD_RESERVE };
      if (!canAfford(spare, cost)) continue;
      if (await attempt(g, () => startUpgrade(g, clan.id, p.id, type))) {
        stock = await getResources(g.tx, clan.id);
        break;
      }
    }
  }

  // 4. Recruit: fill the weakest border garrison toward a balanced host, if the granaries allow it.
  const capacity = await clanCapacity(g.tx, clan.id, mods.capacity);
  const units = clanUnits(mine());
  const pending = await one<{ n: number; here: number }>(
    g.tx,
    `SELECT COALESCE(SUM(count), 0)::int AS n, COALESCE(SUM(count) FILTER (WHERE province_id = $2), 0)::int AS here
       FROM recruitment_orders WHERE clan_id = $1 AND status = 'pending'`,
    [clan.id, weakestBorder.id],
  );
  const room = capacity - totalUnits(units) - (pending?.n ?? 0);
  if (room >= 20 && (pending?.here ?? 0) === 0 && (!hungry || stock.food > 2000)) {
    const lv = levels.get(weakestBorder.id) ?? emptyBuildingLevels();
    const total = Math.max(1, totalUnits(units));
    const wanted = UNIT_TYPES.filter((t) => TARGET_MIX[t] > 0 && !unitBlockReason(t, lv)).sort(
      (a, b) => units[a] / total - TARGET_MIX[a] - (units[b] / total - TARGET_MIX[b]),
    );
    for (const type of wanted) {
      const batch = aggressive ? 60 : 40;
      const perUnit = unitCost(type, 1);
      const affordable = Math.min(
        ...(['gold', 'food', 'wood', 'iron'] as const).map((k) =>
          perUnit[k] > 0 ? Math.floor((stock[k] - (k === 'gold' ? GOLD_RESERVE : 0)) / perUnit[k]) : Infinity,
        ),
      );
      const upkeepRoom =
        UNITS[type].upkeep.food > 0 ? Math.floor(Math.max(0, income.net.food + (stock.food > 2000 ? 40 : 0)) / UNITS[type].upkeep.food) : batch;
      const count = Math.min(batch, room, affordable, upkeepRoom, weakestBorder.population - MIN_POPULATION);
      if (count < 10) continue;
      if (await attempt(g, () => recruit(g, clan.id, weakestBorder.id, type, count))) {
        stock = await getResources(g.tx, clan.id);
        break;
      }
    }
  }

  // 5. Evaluate wars. An aggressive daimyo turns on a neighbouring clan that has grown past a
  //    single province and is clearly weaker. Lone-province clans are left to find their feet.
  const fighting = wars.some((w) => w.attacker_clan_id === clan.id || w.defender_clan_id === clan.id);
  if (aggressive && !fighting && g.tick % 6 === 0) {
    const clans = await loadClans(g.tx);
    const myPower = armyPower(units);
    const neighbors = new Set(border.flatMap((p) => foreignNeighbors(p).map((n) => n.owner_clan_id).filter((id): id is string => !!id)));
    let target: { clan: ClanRow; power: number } | null = null;
    for (const id of [...neighbors].sort()) {
      const other = clans.find((c) => c.id === id);
      if (!other || other.status !== 'active') continue;
      if (provinces.filter((p) => p.owner_clan_id === id).length < 2) continue;
      const power = armyPower(clanUnits(armies.filter((a) => a.clan_id === id)));
      if (myPower < power * 1.6) continue;
      if (await warBlockReason(g, clan, other, wars)) continue;
      if (!target || power < target.power) target = { clan: other, power };
    }
    if (target && stock.gold >= warCost(mods.warCost) + GOLD_RESERVE) {
      const chosen = target.clan;
      if (await attempt(g, () => declareWar(g, clan, chosen.id))) {
        wars = await loadActiveWars(g.tx);
        stock = await getResources(g.tx, clan.id);
      }
    }
  }

  // 6. Expand when sufficiently strong: one campaign at a time, only with a clear margin,
  //    and never by stripping the home garrison.
  armies = await loadArmies(g.tx);
  if (mine().some((a) => a.status !== 'garrison')) return;
  const keep = aggressive ? 0.35 : 0.5;
  const margin = aggressive ? 1.5 : 2.0;
  let best: { from: ProvinceRow; to: ProvinceRow; units: UnitCounts; score: number } | null = null;
  for (const p of [...border].sort((a, b) => a.code.localeCompare(b.code))) {
    const garrison = garrisonOf(p.id, clan.id);
    if (!garrison) continue;
    const available = scaleUnits(garrison.units, 1 - keep);
    const availablePower = armyPower(available);
    for (const n of foreignNeighbors(p)) {
      if (n.owner_clan_id && !atWar(wars, clan.id, n.owner_clan_id)) continue;
      // Unclaimed starting provinces are left for new daimyo to found their clans in.
      if (!n.owner_clan_id && n.is_start_slot) continue;
      const defenders = garrisonOf(n.id, n.owner_clan_id)?.units ?? emptyUnits();
      const castle = levels.get(n.id)?.castle ?? n.defense_level;
      const defense = armyPower(defenders) * TERRAIN_INFO[n.terrain].defense * (1 + castle * BUILDING_EFFECTS.castleDefensePerLevel);
      const need = defense * margin + 50;
      if (availablePower < need) continue;
      const prize = n.base_gold + n.base_food + n.population / 20;
      const score = prize / need;
      if (!best || score > best.score) {
        const share = Math.min(1, (need * 1.3) / availablePower);
        best = { from: p, to: n, units: scaleUnits(available, share), score };
      }
    }
  }
  if (best && totalUnits(best.units) > 0) {
    const plan = best;
    // The campaign must not starve the clan: check supplies against the hourly balance.
    const upkeep = armyUpkeep(plan.units, mods.upkeep);
    if (stock.food > upkeep.food * 6) {
      await attempt(g, () => dispatchArmy(g, clan, plan.from.id, plan.to.id, plan.units, 'attack'));
    }
  }
}
