/**
 * The world tick (GDD §13): one game hour of production, consumption, upkeep,
 * experience, and — once a game day — population, loyalty, rebellions and
 * random events, followed by the NPC daimyo taking their turns.
 *
 * A tick runs inside one transaction under the world lock. Its row in
 * `world_ticks` is inserted first, so the primary key makes it impossible to
 * process the same tick twice; if anything fails the whole tick rolls back and
 * is retried on the next pass.
 */
import { UNIT_TYPES, WORLD, armyPower, populationCap, totalUnits, type UnitCounts } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import { createRng } from '@/game/rng';
import { addUnitsToArmy, deleteArmy, ensureGarrison, setArmyUnits } from './armies';
import { type Db } from './db';
import { expireProposals } from './diplomacy';
import { applyHourly, bagTotal, clanIncome, grant } from './economy';
import { chronicle, emit, emitClan, notifyClan, WORLD_ROOM } from './notify';
import { runNpcTurn } from './npc';
import { awardXp } from './progression';
import {
  eventMultipliers,
  levelsByProvince,
  loadActiveEvents,
  loadArmies,
  loadBuildings,
  loadClans,
  loadProgress,
  loadProvinces,
  type ArmyRow,
  type ClanRow,
  type ProvinceRow,
} from './rows';
import { transferProvince } from './territory';
import { addMs, dayLabel, gameMs, tickTime, type G, type WorldStateRow } from './world';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export async function processTick(tx: Db, state: WorldStateRow, tickNumber: number): Promise<void> {
  const now = tickTime(state, tickNumber);
  const g: G = { tx, now, speed: state.speed, tick: tickNumber, actorPlayerId: null };
  await tx.query(`INSERT INTO world_ticks (tick_number, tick_time, status) VALUES ($1, $2, 'processing')`, [tickNumber, now]);

  const clans = await loadClans(tx);
  const provinces = await loadProvinces(tx);
  const buildings = await loadBuildings(tx);
  const armies = await loadArmies(tx);
  const progress = await loadProgress(tx);
  const events = await loadActiveEvents(tx, now);
  const levels = levelsByProvince(buildings);
  const eventMult = eventMultipliers(events);
  const active = clans.filter((c) => c.status === 'active');
  const starving = new Set<string>();
  const summary = { clans: active.length, produced: 0, starving: 0, events: 0 };

  // 1-3. Production, food consumption and army upkeep.
  for (const clan of active) {
    const own = provinces.filter((p) => p.owner_clan_id === clan.id);
    if (own.length === 0) continue;
    const mine = armies.filter((a) => a.clan_id === clan.id);
    const mods = progress.get(clan.id)!.mods;
    const income = clanIncome({ provinces: own, levels, mods, eventMult, armies: mine });
    const { after, shortfall } = await applyHourly(
      g,
      clan.id,
      [
        { reason: 'production', deltas: income.production },
        { reason: 'population_food', deltas: { food: -income.populationFood } },
        { reason: 'army_upkeep', deltas: { food: -income.upkeepFood, gold: -income.upkeepGold } },
      ],
      { type: 'tick', id: String(tickNumber) },
    );
    summary.produced += bagTotal(income.production);
    await emitClan(g, clan.id, 'resource:updated', { resources: after });

    if (shortfall.food > 0) {
      starving.add(clan.id);
      summary.starving += 1;
      await starve(g, clan, own, mine);
    } else if (clan.starving_ticks > 0) {
      await tx.query('UPDATE clans SET starving_ticks = 0 WHERE id = $1', [clan.id]);
    }

    // Experience from ruling: governing (Leadership), producing (Economy), keeping the peace (Culture).
    const population = own.reduce((s, p) => s + p.population, 0);
    await awardXp(g, clan.id, 'leadership', own.length * 2 + Math.floor(population / 2000), mods.xpGain);
    await awardXp(g, clan.id, 'economy', Math.floor(bagTotal(income.production) / 100), mods.xpGain);
    let culture = 0;
    for (const p of own) {
      culture += p.loyalty >= 80 ? 2 : p.loyalty >= 60 ? 1 : 0;
      if (p.code === 'yamashiro') culture += 3;
    }
    await awardXp(g, clan.id, 'culture', culture, mods.xpGain);
  }

  // 6-7. Daily: population, loyalty, rebellion; twice daily: a chance of a world event.
  if (tickNumber % WORLD.ticksPerDay === 0) await dailyUpdate(g, active, starving);
  if (tickNumber % 12 === 6) summary.events += await rollWorldEvent(g);

  await expireProposals(g);

  // NPC daimyo take their turns after the world has moved.
  for (const clan of active.filter((c) => c.is_npc)) await runNpcTurn(g, clan);

  if (tickNumber % WORLD.ticksPerDay === 0) await prune(g);

  // 8-9. Save world state, dispatch notifications.
  await tx.query('UPDATE world_state SET last_tick = $1, last_tick_at = $2, last_error = NULL, last_error_at = NULL WHERE id', [tickNumber, now]);
  await tx.query(`UPDATE world_ticks SET status = 'completed', completed_at = clock_timestamp(), summary = $2 WHERE tick_number = $1`, [
    tickNumber,
    JSON.stringify(summary),
  ]);
  await emit(g, WORLD_ROOM, 'world:tick', { tick: tickNumber });
}

/** Empty granaries: loyalty falls and soldiers slip away (GDD §5.4). */
async function starve(g: G, clan: ClanRow, own: ProvinceRow[], armies: ArmyRow[]): Promise<void> {
  const ticks = clan.starving_ticks + 1;
  await g.tx.query('UPDATE clans SET starving_ticks = $2 WHERE id = $1', [clan.id, ticks]);
  await g.tx.query('UPDATE provinces SET loyalty = GREATEST(0, loyalty - 2), updated_at = $2 WHERE owner_clan_id = $1', [clan.id, g.now]);
  let deserted = 0;
  for (const army of armies) {
    const left = { ...army.units } as UnitCounts;
    for (const t of UNIT_TYPES) {
      if (left[t] <= 0) continue;
      const gone = Math.max(1, Math.ceil(left[t] * 0.04));
      left[t] -= Math.min(left[t], gone);
      deserted += gone;
    }
    if (totalUnits(left) <= 0 && army.status !== 'garrison') await deleteArmy(g.tx, army.id);
    else await setArmyUnits(g.tx, army.id, left);
  }
  if (ticks === 1 || ticks % 12 === 0) {
    await notifyClan(g, clan.id, {
      type: 'event',
      title: 'Your granaries are empty',
      body: `There is no food left for ${own.length > 1 ? 'your provinces' : own[0].name} and the army. Loyalty is falling and ${deserted} soldiers have deserted. Build farms or reduce the army.`,
      link: '/game',
    });
  }
  if (deserted > 0) await emitClan(g, clan.id, 'army:updated', { clanId: clan.id });
}

async function dailyUpdate(g: G, clans: ClanRow[], starving: Set<string>): Promise<void> {
  const provinces = await loadProvinces(g.tx);
  const progress = await loadProgress(g.tx);
  const levels = levelsByProvince(await loadBuildings(g.tx));
  const armies = await loadArmies(g.tx, `a.status = 'garrison'`);
  const clanById = new Map(clans.map((c) => [c.id, c]));

  for (const p of provinces) {
    const clan = p.owner_clan_id ? clanById.get(p.owner_clan_id) : undefined;
    if (!clan) continue;
    const mods = progress.get(clan.id)!.mods;
    const hungry = starving.has(clan.id) || clan.starving_ticks > 0;

    // Population growth (ECO-09): faster in loyal, fed provinces, up to what the land supports.
    const cap = populationCap(p.development_level);
    let population = p.population;
    if (hungry) population = Math.max(500, Math.floor(population * 0.98));
    else if (population < cap) population = Math.min(cap, population + Math.ceil(population * 0.015 * (p.loyalty / 100) * (1 + mods.popGrowth)));

    // Loyalty drifts upward under steady rule; a castle and good governance speed it.
    const castle = levels.get(p.id)?.castle ?? 0;
    const loyalty = clamp(p.loyalty + 1 + mods.loyaltyPerDay + castle * 0.2 - (hungry ? 5 : 0), 0, 100);
    await g.tx.query('UPDATE provinces SET population = $2, loyalty = $3, updated_at = $4 WHERE id = $1', [p.id, population, loyalty, g.now]);

    // Rebellion (AI-06): a disloyal province with too thin a garrison may rise.
    if (loyalty < 20) {
      const garrison = armies.find((a) => a.province_id === p.id && a.clan_id === clan.id);
      const order = armyPower(garrison?.units ?? {});
      const rng = createRng(`rebellion:${g.tick}:${p.code}`);
      if (order < population / 4 && rng.chance(((20 - loyalty) / 20) * 0.5)) {
        await rebel(g, { ...p, population, loyalty }, clan, garrison);
      }
    }
  }
}

async function rebel(g: G, province: ProvinceRow, clan: ClanRow, garrison: ArmyRow | undefined): Promise<void> {
  // The lord's men are driven out to the nearest province he still holds.
  if (garrison) {
    const neighborCodes = PROVINCE_BY_CODE[province.code]?.neighbors ?? [];
    const refuge = (await loadProvinces(g.tx)).find((p) => p.owner_clan_id === clan.id && p.id !== province.id && neighborCodes.includes(p.code));
    if (refuge && totalUnits(garrison.units) > 0) {
      await addUnitsToArmy(g.tx, await ensureGarrison(g.tx, refuge.id, clan.id), garrison.units);
    }
    await deleteArmy(g.tx, garrison.id);
  }
  await transferProvince(g, province, null, 'rebellion', null, 50);
  const rebels = await ensureGarrison(g.tx, province.id, null);
  await setArmyUnits(g.tx, rebels, {
    ashigaru: Math.round(province.population / 40),
    yari: Math.round(province.population / 120),
    archer: Math.round(province.population / 160),
    samurai: 0,
    cavalry: 0,
  });
  await chronicle(g, {
    type: 'rebellion',
    title: `${province.name} rises in rebellion`,
    description: `On ${dayLabel(g.tick)}, the people of ${province.name} drove out the officers of the ${clan.name} clan and closed the roads. The province answers to no lord.`,
    provinceId: province.id,
    clanId: clan.id,
  });
  await notifyClan(g, clan.id, {
    type: 'province',
    title: `${province.name} has rebelled`,
    body: `Loyalty in ${province.name} collapsed and the province threw off your rule. Keep loyalty above 20 or station a strong garrison.`,
    link: '/game/map',
  });
}

/** World events (GDD §10, AI-05): seeded by the tick number, so a replayed tick rolls the same event. */
async function rollWorldEvent(g: G): Promise<number> {
  const rng = createRng(`event:${g.tick}`);
  if (!rng.chance(0.45)) return 0;
  const provinces = (await loadProvinces(g.tx)).filter((p) => p.owner_clan_id);
  if (provinces.length === 0) return 0;
  const province = provinces[rng.int(0, provinces.length - 1)];
  const clans = await loadClans(g.tx);
  const owner = clans.find((c) => c.id === province.owner_clan_id);
  if (!owner) return 0;
  const type = rng.weighted([
    ['harvest', 30],
    ['merchants', 30],
    ['famine', 22],
    ['earthquake', 18],
  ] as const);
  const lasting = addMs(g.now, gameMs(g, 12 * 60));

  if (type === 'harvest') {
    await chronicle(g, {
      type,
      title: `Bountiful harvest in ${province.name}`,
      description: `On ${dayLabel(g.tick)}, the paddies of ${province.name} yielded half again their usual rice. Food production +50% for half a day.`,
      provinceId: province.id,
      clanId: owner.id,
      effects: { production: { food: 1.5 } },
      endsAt: lasting,
    });
    await notifyClan(g, owner.id, {
      type: 'event',
      title: `Bountiful harvest in ${province.name}`,
      body: 'Food production in the province is up by half for the next twelve hours.',
      link: `/game/castle?province=${province.id}`,
    });
  } else if (type === 'famine') {
    await chronicle(g, {
      type,
      title: `Famine strikes ${province.name}`,
      description: `On ${dayLabel(g.tick)}, blight and drought ruined the fields of ${province.name}. Food production is halved for half a day.`,
      provinceId: province.id,
      clanId: owner.id,
      effects: { production: { food: 0.5 } },
      endsAt: lasting,
    });
    await notifyClan(g, owner.id, {
      type: 'event',
      title: `Famine in ${province.name}`,
      body: 'Food production in the province is halved for the next twelve hours. Watch your granaries.',
      link: `/game/castle?province=${province.id}`,
    });
  } else if (type === 'merchants') {
    const gold = 150 + rng.int(0, 150);
    await grant(g, owner.id, { gold }, 'merchant_caravan', { type: 'event', id: String(g.tick) });
    await chronicle(g, {
      type,
      title: `Merchants arrive in ${province.name}`,
      description: `On ${dayLabel(g.tick)}, a caravan from the western provinces paid ${gold} gold in tolls and gifts to the lord of ${province.name}.`,
      provinceId: province.id,
      clanId: owner.id,
    });
    await notifyClan(g, owner.id, {
      type: 'event',
      title: `Merchants arrive in ${province.name}`,
      body: `A trading caravan has paid ${gold} gold into your treasury.`,
      link: '/game',
    });
  } else {
    const lost = Math.floor(province.population * 0.05);
    await g.tx.query('UPDATE provinces SET population = population - $2, loyalty = GREATEST(0, loyalty - 5), updated_at = $3 WHERE id = $1', [
      province.id,
      lost,
      g.now,
    ]);
    await chronicle(g, {
      type,
      title: `Earthquake in ${province.name}`,
      description: `On ${dayLabel(g.tick)}, the earth shook ${province.name}. ${lost} people were lost and the survivors murmur of ill omens.`,
      provinceId: province.id,
      clanId: owner.id,
    });
    await notifyClan(g, owner.id, {
      type: 'event',
      title: `Earthquake in ${province.name}`,
      body: `${lost} people were lost and loyalty has dropped by 5.`,
      link: `/game/castle?province=${province.id}`,
    });
    await emit(g, WORLD_ROOM, 'world:province_updated', { provinceId: province.id });
  }
  return 1;
}

/** Housekeeping for tables that only need a short memory. */
async function prune(g: G): Promise<void> {
  await g.tx.query(`DELETE FROM realtime_events WHERE created_at < now() - interval '2 hours'`);
  await g.tx.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '1 day'`);
  await g.tx.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour'`);
  await g.tx.query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days'`);
}
