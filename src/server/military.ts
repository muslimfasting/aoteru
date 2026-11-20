import { TACTICS, TACTIC_DEFS, tacticBlockReason, type TacticId } from '@/game/strategy';
import {
  TERRAIN_INFO,
  UNITS,
  UNIT_TYPES,
  armyCapacity,
  marchMinutes,
  marchSupplies,
  normalizeUnits,
  recruitMinutes,
  totalUnits,
  unitBlockReason,
  unitCost,
  type UnitCounts,
  type UnitType,
} from '@/game/config';
import { findRoute } from '@/game/map';
import {
  addUnitsToArmy,
  clanArmies,
  ensureGarrison,
  getGarrison,
  mergeIntoGarrison,
  pendingRecruits,
  removeUnitsFromArmy,
  sendHome,
} from './armies';
import { createBattle } from './battles';
import { one, rows, type Db } from './db';
import { conflict, forbidden, invalid, notFound } from './errors';
import { getResources, spend } from './economy';
import { audit, emit, emitClan, notifyClan, WORLD_ROOM } from './notify';
import { awardClanXp } from './progression';
import {
  atWar,
  levelsByProvince,
  loadActiveWars,
  loadArmies,
  loadBuildings,
  alliesOf,
  loadActivePacts,
  loadMods,
  loadProgress,
  loadProvinces,
  type ClanRow,
  type ProvinceRow,
} from './rows';
import { addMs, gameMs, type G } from './world';

/** Soldiers a province keeps back: recruitment never drains a population below this. */
export const MIN_POPULATION = 500;
export const MAX_RECRUIT_ORDER = 2000;

export async function clanCapacity(tx: Db, clanId: string, capacityMod: number): Promise<number> {
  const castles = await rows<{ level: number }>(
    tx,
    `SELECT b.level FROM buildings b JOIN provinces p ON p.id = b.province_id WHERE p.owner_clan_id = $1 AND b.type = 'castle'`,
    [clanId],
  );
  return armyCapacity(castles.map((c) => c.level), capacityMod);
}

export async function clanHeadcount(tx: Db, clanId: string): Promise<{ total: number; recruiting: number }> {
  const armies = await clanArmies(tx, clanId);
  const total = armies.reduce((sum, a) => sum + totalUnits(a.units), 0);
  return { total, recruiting: await pendingRecruits(tx, clanId) };
}

/**
 * Order a muster (MIL-03..08): ownership, the required buildings, army
 * capacity, available population and the cost are validated server-side.
 * Orders in one province train one after another.
 */
export async function recruit(g: G, clanId: string, provinceId: string, unitType: UnitType, countInput: number): Promise<void> {
  if (!(UNIT_TYPES as readonly string[]).includes(unitType)) throw invalid('Unknown unit type');
  const count = Math.floor(Number(countInput));
  if (!Number.isFinite(count) || count < 1) throw invalid('Recruit at least one soldier');
  if (count > MAX_RECRUIT_ORDER) throw invalid(`A single order may muster at most ${MAX_RECRUIT_ORDER} soldiers`);

  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 FOR UPDATE', [provinceId]);
  if (!province) throw notFound('Province');
  if (province.owner_clan_id !== clanId) throw forbidden('You do not hold this province');

  const levels = levelsByProvince(await loadBuildings(g.tx, provinceId)).get(provinceId)!;
  const blocked = unitBlockReason(unitType, levels);
  if (blocked) throw conflict('UNIT_LOCKED', blocked);

  const mods = await loadMods(g.tx, clanId);
  const capacity = await clanCapacity(g.tx, clanId, mods.capacity);
  const head = await clanHeadcount(g.tx, clanId);
  if (head.total + head.recruiting + count > capacity) {
    const room = Math.max(0, capacity - head.total - head.recruiting);
    throw conflict('ARMY_CAPACITY', `Army capacity reached: room for ${room} more (capacity ${capacity}). Upgrade a castle or raise Leadership.`);
  }
  if (province.population - count < MIN_POPULATION) {
    throw conflict('NOT_ENOUGH_POPULATION', `${province.name} cannot spare that many people`);
  }

  const order = await one<{ id: string }>(
    g.tx,
    `INSERT INTO recruitment_orders (clan_id, province_id, unit_type, count, started_at, completes_at)
     SELECT $1, $2, $3, $4, q.start, q.start + ($5::bigint * interval '1 millisecond')
     FROM (SELECT GREATEST($6::timestamptz, COALESCE(MAX(completes_at), $6::timestamptz)) AS start
             FROM recruitment_orders WHERE province_id = $2 AND clan_id = $1 AND status = 'pending') q
     RETURNING id`,
    [clanId, provinceId, unitType, count, gameMs(g, recruitMinutes(unitType, count, levels.barracks)), g.now],
  );
  await spend(g, clanId, unitCost(unitType, count), 'recruitment', { type: 'recruitment', id: order!.id });
  await g.tx.query('UPDATE provinces SET population = population - $2, updated_at = $3 WHERE id = $1', [provinceId, count, g.now]);
  await audit(g, 'army.recruit', { type: 'recruitment', id: order!.id }, clanId, { province: province.code, unitType, count });
}

/** Deliver a finished muster to the province garrison. Safe to call more than once. */
export async function completeRecruitment(g: G, orderId: string): Promise<void> {
  const order = await one<{ id: string; clan_id: string; province_id: string; unit_type: UnitType; count: number }>(
    g.tx,
    `SELECT * FROM recruitment_orders WHERE id = $1 AND status = 'pending' AND completes_at <= $2 FOR UPDATE`,
    [orderId, g.now],
  );
  if (!order) return;
  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1', [order.province_id]);
  if (!province || province.owner_clan_id !== order.clan_id) {
    await g.tx.query(`UPDATE recruitment_orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
    return;
  }
  await g.tx.query(`UPDATE recruitment_orders SET status = 'done' WHERE id = $1`, [orderId]);
  const garrisonId = await ensureGarrison(g.tx, province.id, order.clan_id);
  await addUnitsToArmy(g.tx, garrisonId, { [order.unit_type]: order.count });
  const mods = await loadMods(g.tx, order.clan_id);
  await awardClanXp(g, order.clan_id, 'military', UNITS[order.unit_type].xp * order.count, mods.xpGain);
  await notifyClan(g, order.clan_id, {
    type: 'recruitment',
    title: `${order.count} ${UNITS[order.unit_type].name} ready`,
    body: `${order.count} ${UNITS[order.unit_type].name} have joined the garrison of ${province.name}.`,
    link: '/game/military',
  });
  await emitClan(g, order.clan_id, 'recruitment:completed', { provinceId: province.id, unitType: order.unit_type, count: order.count });
}

export interface MarchPlan {
  ok: boolean;
  reason: string | null;
  intent: 'move' | 'attack';
  from: ProvinceRow | null;
  target: ProvinceRow | null;
  /** Provinces entered, ending with the destination. */
  route: ProvinceRow[];
  minutes: number;
  supplies: number;
  units: UnitCounts;
}

/**
 * Work out what a march order would do — route, travel time, supplies — and
 * whether the rules allow it (MIL-09). Used both for previews and, with the
 * same checks, when the order is actually given.
 */
export async function planMarch(
  g: Pick<G, 'tx' | 'now'>,
  clan: Pick<ClanRow, 'id'>,
  fromId: string,
  toId: string,
  unitsInput: Partial<Record<string, number>>,
): Promise<MarchPlan> {
  const units = normalizeUnits(unitsInput);
  const plan: MarchPlan = { ok: false, reason: null, intent: 'move', from: null, target: null, route: [], minutes: 0, supplies: 0, units };
  const fail = (reason: string): MarchPlan => ({ ...plan, ok: false, reason });

  const provinces = await loadProvinces(g.tx);
  const byId = new Map(provinces.map((p) => [p.id, p]));
  const byCode = new Map(provinces.map((p) => [p.code, p]));
  const from = byId.get(fromId) ?? null;
  const target = byId.get(toId) ?? null;
  plan.from = from;
  plan.target = target;
  if (!from || !target) return fail('Unknown province');
  if (from.owner_clan_id !== clan.id) return fail('You do not hold the province of departure');
  if (from.id === target.id) return fail('The army is already there');

  if (target.owner_clan_id === clan.id) {
    plan.intent = 'move';
  } else {
    plan.intent = 'attack';
    if (target.owner_clan_id) {
      const wars = await loadActiveWars(g.tx);
      if (!atWar(wars, clan.id, target.owner_clan_id)) {
        const owner = await one<{ name: string }>(g.tx, 'SELECT name FROM clans WHERE id = $1', [target.owner_clan_id]);
        return fail(`You are not at war with the nation of ${owner?.name ?? 'ruling'}. Declare war first.`);
      }
    }
  }

  // Armies march through the clan's own land and, by treaty, through the land of its allies.
  const allies = alliesOf(await loadActivePacts(g.tx, g.now), clan.id);
  const codes = findRoute(
    from.code,
    target.code,
    (code) => {
      const owner = byCode.get(code)?.owner_clan_id;
      return !!owner && (owner === clan.id || allies.has(owner));
    },
    (code) => TERRAIN_INFO[byCode.get(code)!.terrain].travel,
  );
  if (!codes) return fail('No route: armies may only march through provinces you or your allies hold');
  plan.route = codes.map((c) => byCode.get(c)!);

  if (totalUnits(units) <= 0) return fail('Choose the soldiers to send');
  const garrison = await getGarrison(g.tx, from.id, clan.id);
  for (const t of UNIT_TYPES) {
    if (units[t] > (garrison?.units[t] ?? 0)) return fail(`Only ${garrison?.units[t] ?? 0} ${UNITS[t].name} are stationed in ${from.name}`);
  }

  const mods = await loadMods(g.tx, clan.id);
  plan.minutes = marchMinutes(plan.route.map((p) => p.terrain), units, mods.marchSpeed);
  plan.supplies = marchSupplies(units, plan.minutes);
  const stock = await getResources(g.tx, clan.id);
  if (stock.food < plan.supplies) return fail(`Not enough food to supply the march (need ${plan.supplies})`);

  return { ...plan, ok: true, reason: null };
}

export interface DispatchOptions {
  /** The tactic the army attacks with (see src/game/strategy.ts). Ignored for a move. */
  tactic?: string;
  /** The war plan this attack carries out. */
  planId?: string | null;
  /** Multiplier on the supplies, from the plan's logistics officer. */
  supplyFactor?: number;
}

/**
 * Give a march order. `expected` is what the endpoint is for — moving between
 * own provinces, or attacking — and the server refuses if the target says otherwise.
 */
export async function dispatchArmy(
  g: G,
  clan: ClanRow,
  /** The member leading the army; null for NPC clans. */
  commanderId: string | null,
  fromId: string,
  toId: string,
  unitsInput: Partial<Record<string, number>>,
  expected: 'move' | 'attack',
  options: DispatchOptions = {},
): Promise<string> {
  const plan = await planMarch(g, clan, fromId, toId, unitsInput);
  if (!plan.ok || !plan.from || !plan.target) throw conflict('MARCH_BLOCKED', plan.reason ?? 'This order cannot be carried out');
  if (plan.intent !== expected) {
    throw conflict(
      'MARCH_BLOCKED',
      expected === 'move' ? 'You can only move troops to a province you hold. To take another province, attack it.' : 'You already hold that province.',
    );
  }

  // The tactic must be one this host and this clan can actually carry out.
  let tactic: TacticId = 'assault';
  if (plan.intent === 'attack' && options.tactic && options.tactic !== 'assault') {
    if (!(TACTICS as readonly string[]).includes(options.tactic)) throw invalid('Unknown tactic');
    tactic = options.tactic as TacticId;
    const progress = (await loadProgress(g.tx, clan.id, commanderId)).get(clan.id);
    const levels = progress?.levels ?? { military: 1, leadership: 1, economy: 1, intelligence: 1, culture: 1 };
    const blocked = tacticBlockReason(tactic, plan.units, levels, plan.target.terrain);
    if (blocked) throw conflict('TACTIC_BLOCKED', `${TACTIC_DEFS[tactic].name}: ${blocked}`);
  }
  const tacticDef = TACTIC_DEFS[tactic];
  const supplies = Math.ceil(plan.supplies * tacticDef.supplyFactor * (options.supplyFactor ?? 1));

  // Lock the garrison, then deduct: the conditional updates make double-sending impossible.
  const garrison = await one<{ id: string }>(
    g.tx,
    `SELECT id FROM armies WHERE province_id = $1 AND clan_id = $2 AND status = 'garrison' FOR UPDATE`,
    [plan.from.id, clan.id],
  );
  if (!garrison) throw conflict('NOT_ENOUGH_TROOPS', 'There is no garrison in that province');
  await removeUnitsFromArmy(g.tx, garrison.id, plan.units);

  const arrivesAt = addMs(g.now, gameMs(g, plan.minutes));
  const army = await one<{ id: string }>(
    g.tx,
    `INSERT INTO armies (clan_id, province_id, status, intent, target_province_id, path, departed_at, arrives_at, commander_player_id, tactic, plan_id)
     VALUES ($1, $2, 'marching', $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [clan.id, plan.from.id, plan.intent, plan.target.id, JSON.stringify(plan.route.map((p) => p.id)), g.now, arrivesAt, commanderId, tactic, options.planId ?? null],
  );
  await addUnitsToArmy(g.tx, army!.id, plan.units);
  if (supplies > 0) await spend(g, clan.id, { food: supplies }, 'march_supplies', { type: 'army', id: army!.id });
  if (Object.values(tacticDef.cost).some((v) => (v ?? 0) > 0)) {
    await spend(g, clan.id, tacticDef.cost, 'tactic_preparation', { type: 'army', id: army!.id });
  }

  if (plan.intent === 'attack' && plan.target.owner_clan_id) {
    // Taking the field against another clan ends the newcomer's protection.
    await g.tx.query('UPDATE clans SET protected_until = NULL WHERE id = $1 AND protected_until IS NOT NULL', [clan.id]);
    await notifyClan(g, plan.target.owner_clan_id, {
      type: 'war',
      title: `An army marches on ${plan.target.name}`,
      body: `Scouts report a ${clan.name} host on the road to ${plan.target.name}. Reinforce the garrison before it arrives.`,
      link: '/game/map',
    });
  }
  await emit(g, WORLD_ROOM, 'army:updated', { armyId: army!.id, clanId: clan.id });
  await audit(g, plan.intent === 'attack' ? 'battle.declare' : 'army.move', { type: 'army', id: army!.id }, clan.id, {
    from: plan.from.code,
    to: plan.target.code,
    units: plan.units,
    supplies,
    tactic,
    planId: options.planId ?? null,
  });
  return army!.id;
}

/** An army reaches its destination: it garrisons friendly land, or gives battle. */
export async function arriveArmy(g: G, armyId: string): Promise<void> {
  const locked = await one<{ id: string }>(g.tx, `SELECT id FROM armies WHERE id = $1 AND status = 'marching' AND arrives_at <= $2 FOR UPDATE`, [
    armyId,
    g.now,
  ]);
  if (!locked) return;
  const [army] = await loadArmies(g.tx, 'a.id = $1', [armyId]);
  const target = army?.target_province_id
    ? await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 FOR UPDATE', [army.target_province_id])
    : null;
  // Whatever happens below, the timer must be consumed: an army that cannot arrive is removed.
  if (!army || !target || totalUnits(army.units) <= 0 || !army.clan_id) {
    await g.tx.query('DELETE FROM armies WHERE id = $1', [armyId]);
    return;
  }

  if (target.owner_clan_id === army.clan_id) {
    await mergeIntoGarrison(g.tx, army, target.id);
    await emit(g, WORLD_ROOM, 'army:updated', { armyId, clanId: army.clan_id });
    await notifyClan(g, army.clan_id, {
      type: 'army',
      title: `Your army has reached ${target.name}`,
      body: `${totalUnits(army.units)} soldiers have joined the garrison of ${target.name}.`,
      link: '/game/military',
    });
    return;
  }

  if (army.intent !== 'attack') {
    // The destination changed hands while the army was on the road.
    await sendHome(g, army, target, null);
    return;
  }

  const hostile = !target.owner_clan_id || atWar(await loadActiveWars(g.tx), army.clan_id, target.owner_clan_id) !== null;
  if (!hostile) {
    await sendHome(g, army, target, army.province_id);
    await notifyClan(g, army.clan_id, {
      type: 'army',
      title: `Your army turns back from ${target.name}`,
      body: `You are no longer at war with the holders of ${target.name}; the attack was called off.`,
      link: '/game/military',
    });
    return;
  }
  await createBattle(g, army, target);
}
