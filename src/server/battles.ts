import { DOCTRINE_DEFS, type DoctrineId } from '@/game/clan';
import { emptyModifiers } from '@/game/pillars';
import { STANCE_DEFS, TACTICS, TACTIC_DEFS, resolveStrategy, type StanceId, type StrategySideEffect, type TacticId } from '@/game/strategy';
import { effectiveStance, npcStance } from './stance';
import { abandonPlan, completePlan, planBonuses } from './warplans';
import { randomUUID } from 'node:crypto';
import {
  OUTCOME_LABEL,
  WEATHER_INFO,
  currentBattleRules,
  neutralBattleMods,
  rollWeather,
  simulateBattle,
  type BattleInputs,
  type BattleResult,
  type BattleSideMods,
  type Weather,
} from '@/game/battle';
import { BUILDING_EFFECTS, RESOURCE_KEYS, WORLD, emptyBag, emptyUnits, totalUnits, type ResourceBag } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import type { Modifiers } from '@/game/pillars';
import { addUnitsToArmy, deleteArmy, ensureGarrison, getGarrison, mergeIntoGarrison, sendHome, setArmyUnits } from './armies';
import { one, rows } from './db';
import { getResources, grant, spend } from './economy';
import { audit, chronicle, emit, emitClan, notifyClan, WORLD_ROOM } from './notify';
import { awardClanXp } from './progression';
import { atWar, levelsByProvince, loadActiveWars, loadArmies, loadBuildings, loadProgress, type ArmyRow, type ClanRow, type ProvinceRow } from './rows';
import { transferProvince } from './territory';
import { addMs, dayLabel, gameMs, type G } from './world';

export interface BattleRow {
  id: string;
  province_id: string;
  attacker_clan_id: string;
  defender_clan_id: string | null;
  attacker_army_id: string | null;
  origin_province_id: string | null;
  status: 'pending' | 'resolved' | 'cancelled';
  seed: string;
  weather: Weather | null;
  inputs: BattleInputs | null;
  started_at: Date;
  resolves_at: Date;
  resolved_at: Date | null;
}

/** An attacking army has arrived: open a battle that the simulation resolves when its timer runs out. */
export async function createBattle(g: G, army: ArmyRow, province: ProvinceRow): Promise<string> {
  const seed = randomUUID();
  const battle = await one<{ id: string }>(
    g.tx,
    `INSERT INTO battles (province_id, attacker_clan_id, defender_clan_id, attacker_army_id, origin_province_id, seed, weather, started_at, resolves_at,
                          tactic, commander_player_id, plan_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      province.id,
      army.clan_id,
      province.owner_clan_id,
      army.id,
      army.province_id,
      seed,
      rollWeather(seed),
      g.now,
      // A siege takes longer to come to a decision.
      addMs(g.now, gameMs(g, WORLD.battleMinutes + (TACTIC_DEFS[army.tactic as TacticId]?.extraMinutes ?? 0))),
      army.tactic,
      army.commander_player_id,
      army.plan_id,
    ],
  );
  await g.tx.query(`UPDATE armies SET status = 'besieging' WHERE id = $1`, [army.id]);

  const attacker = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [army.clan_id]);
  const payload = { battleId: battle!.id, provinceId: province.id };
  await emitClan(g, army.clan_id, 'battle:started', payload);
  await emitClan(g, province.owner_clan_id, 'battle:started', payload);
  await emit(g, WORLD_ROOM, 'world:province_updated', { provinceId: province.id });
  await emit(g, WORLD_ROOM, 'army:updated', { armyId: army.id, clanId: army.clan_id });
  await notifyClan(g, army.clan_id, {
    type: 'battle',
    title: `Battle joined at ${province.name}`,
    body: `Your army has reached ${province.name} and is engaging the defenders.`,
    link: `/game/battles/${battle!.id}`,
  });
  await notifyClan(g, province.owner_clan_id, {
    type: 'battle',
    title: `${province.name} is under attack`,
    body: `The nation of ${attacker?.name ?? 'enemy'} is assaulting ${province.name}.`,
    link: `/game/battles/${battle!.id}`,
  });
  return battle!.id;
}

const BASE_LEVELS = { military: 1, leadership: 1, economy: 1, intelligence: 1, culture: 1 };

/** Fold the outcome of the strategy contest into a side's battle modifiers. */
function withStrategy(mods: BattleSideMods, effect: StrategySideEffect): BattleSideMods {
  return {
    ...mods,
    attack: mods.attack + effect.attack,
    toughness: mods.toughness + effect.toughness,
    firstRound: mods.firstRound + effect.firstRound,
    siege: Math.min(1, mods.siege + effect.siege),
  };
}

function sideMods(mods: Modifiers, extra: { attack?: number; toughness?: number } = {}): BattleSideMods {
  return {
    attack: mods.attack + (extra.attack ?? 0),
    toughness: mods.toughness + (extra.toughness ?? 0),
    infantry: mods.infantry,
    ranged: mods.ranged,
    cavalry: mods.cavalry,
    firstRound: mods.firstRound,
    siege: mods.siege,
  };
}

async function cancelBattle(g: G, battle: BattleRow): Promise<void> {
  await g.tx.query(`UPDATE battles SET status = 'cancelled', resolved_at = $2 WHERE id = $1`, [battle.id, g.now]);
  await emit(g, WORLD_ROOM, 'world:province_updated', { provinceId: battle.province_id });
  await emitClan(g, battle.attacker_clan_id, 'battle:completed', { battleId: battle.id, cancelled: true });
}

/** Where a beaten garrison falls back to: the nearest land its clan still holds. */
async function retreatDefenders(g: G, garrison: ArmyRow, province: ProvinceRow, remaining: typeof garrison.units): Promise<string | null> {
  if (!garrison.clan_id || totalUnits(remaining) <= 0) {
    await deleteArmy(g.tx, garrison.id);
    return null;
  }
  const neighborCodes = PROVINCE_BY_CODE[province.code]?.neighbors ?? [];
  const refuge = await one<ProvinceRow>(
    g.tx,
    `SELECT p.* FROM provinces p JOIN clans c ON c.id = p.owner_clan_id
      WHERE p.owner_clan_id = $1 AND p.code = ANY($2) AND p.id <> $3
      ORDER BY (c.capital_province_id = p.id) DESC, p.population DESC, p.code LIMIT 1`,
    [garrison.clan_id, neighborCodes, province.id],
  );
  if (!refuge) {
    await deleteArmy(g.tx, garrison.id);
    return null;
  }
  const refugeGarrison = await ensureGarrison(g.tx, refuge.id, garrison.clan_id);
  await addUnitsToArmy(g.tx, refugeGarrison, remaining);
  await deleteArmy(g.tx, garrison.id);
  return refuge.name;
}

/**
 * Resolve a battle whose timer has run out (BATTLE-07).
 *
 * - The battle row is locked and must still be pending, so a battle is
 *   resolved — and its casualties applied — exactly once, however often the
 *   worker retries.
 * - The inputs are snapshotted and stored with the seed before anything is
 *   applied; `simulateBattle(inputs, seed)` reproduces the stored report.
 * - The province changes hands only when the attacker actually wins.
 */
export async function resolveBattle(g: G, battleId: string): Promise<void> {
  const battle = await one<BattleRow>(g.tx, `SELECT * FROM battles WHERE id = $1 AND status = 'pending' AND resolves_at <= $2 FOR UPDATE`, [
    battleId,
    g.now,
  ]);
  if (!battle) return;
  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 FOR UPDATE', [battle.province_id]);
  if (!province) return cancelBattle(g, battle);

  const [army] = battle.attacker_army_id ? await loadArmies(g.tx, `a.id = $1 AND a.status = 'besieging'`, [battle.attacker_army_id]) : [];
  const attacker = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [battle.attacker_clan_id]);
  if (!army || !attacker || attacker.status !== 'active' || totalUnits(army.units) <= 0) {
    if (army) await deleteArmy(g.tx, army.id);
    await abandonPlan(g, army?.plan_id ?? null, 'called off');
    return cancelBattle(g, battle);
  }

  // The situation may have changed while the armies were engaged.
  if (province.owner_clan_id === attacker.id) {
    await mergeIntoGarrison(g.tx, army, province.id);
    await abandonPlan(g, army.plan_id, 'the province was already taken');
    return cancelBattle(g, battle);
  }
  if (province.owner_clan_id && !atWar(await loadActiveWars(g.tx), attacker.id, province.owner_clan_id)) {
    await sendHome(g, army, province, battle.origin_province_id);
    await notifyClan(g, attacker.id, {
      type: 'battle',
      title: `The assault on ${province.name} is called off`,
      body: `You are no longer at war with the holders of ${province.name}. Your army is marching home.`,
      link: '/game/military',
    });
    await abandonPlan(g, army.plan_id, 'peace was made');
    return cancelBattle(g, battle);
  }

  const defenderId = province.owner_clan_id;
  const defender = defenderId ? await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [defenderId]) : null;
  const garrison = await getGarrison(g.tx, province.id, defenderId);
  const levels = levelsByProvince(await loadBuildings(g.tx, province.id)).get(province.id);
  const castleLevel = levels?.castle ?? province.defense_level;
  // The member leading the army fights with their own Military pillar.
  const progressA = (await loadProgress(g.tx, attacker.id, army.commander_player_id)).get(attacker.id);
  const progressD = defenderId ? (await loadProgress(g.tx, defenderId)).get(defenderId) : undefined;
  const modsA = progressA?.mods ?? emptyModifiers();
  const modsD = progressD?.mods ?? emptyModifiers();

  // Strategy: a fresh scouting report on the target sharpens the attack.
  const intel = await one(
    g.tx,
    `SELECT id FROM espionage WHERE clan_id = $1 AND target_province_id = $2 AND status = 'success' AND report_expires_at > $3 LIMIT 1`,
    [attacker.id, province.id, g.now],
  );
  const weather: Weather = battle.weather ?? rollWeather(battle.seed);
  const attackerMorale = 100 + modsA.morale - modsD.enemyMorale + WEATHER_INFO[weather].attackerMorale - (attacker.starving_ticks > 0 ? 20 : 0);
  const defenderMorale = defender
    ? 100 +
      modsD.morale -
      modsA.enemyMorale -
      (defender.starving_ticks > 0 ? 20 : 0) +
      (levels?.dojo ?? 0) * BUILDING_EFFECTS.dojoMoralePerLevel +
      (province.loyalty - 50) / 5
    : 95 - modsA.enemyMorale;

  // The Art of War: the attacker's tactic against the stance the province is held in.
  const tactic: TacticId = (TACTICS as readonly string[]).includes(army.tactic) ? (army.tactic as TacticId) : 'assault';
  const stance: StanceId =
    defender && !defender.is_npc ? effectiveStance(province, g.now) : npcStance(province, totalUnits(garrison?.units ?? emptyUnits()), g.tick);
  const bonus = await planBonuses(g.tx, army.plan_id, !!intel);
  const doctrineChance = DOCTRINE_DEFS[attacker.doctrine as DoctrineId]?.tacticChance ?? 0;
  const strategy = resolveStrategy(
    {
      tactic,
      stance,
      attackerHasIntel: !!intel,
      attackerLevels: progressA?.levels ?? BASE_LEVELS,
      defenderLevels: progressD?.levels ?? BASE_LEVELS,
      chanceBonus: bonus.chance + doctrineChance,
    },
    battle.seed,
  );
  const commander = army.commander_player_id
    ? await one<{ nickname: string }>(g.tx, 'SELECT nickname FROM players WHERE id = $1', [army.commander_player_id])
    : null;

  const inputs: BattleInputs = {
    rules: currentBattleRules(),
    province: { code: province.code, name: province.name, terrain: province.terrain, castleLevel },
    weather,
    attacker: {
      clanId: attacker.id,
      name: attacker.name,
      commander: commander?.nickname ?? null,
      units: army.units,
      morale: Math.round((attackerMorale + strategy.attacker.morale + bonus.morale) * 10) / 10,
      mods: withStrategy(sideMods(modsA, { attack: intel ? modsA.intelAttack : 0 }), strategy.attacker),
    },
    defender: {
      clanId: defenderId,
      name: defender?.name ?? `Militia of ${province.name}`,
      units: garrison?.units ?? emptyUnits(),
      morale: Math.round((defenderMorale + strategy.defender.morale) * 10) / 10,
      mods: withStrategy(defender ? sideMods(modsD, { toughness: modsD.defense }) : neutralBattleMods(), strategy.defender),
    },
    positionFactor: strategy.positionFactor,
    strategy: { ...strategy, tacticName: TACTIC_DEFS[tactic].name, stanceName: STANCE_DEFS[stance].name, attackerHadIntel: !!intel },
  };
  const result: BattleResult = simulateBattle(inputs, battle.seed);
  const attackerLost = totalUnits(result.attacker.losses);
  const defenderLost = totalUnits(result.defender.losses);
  const captured = result.winner === 'attacker' && totalUnits(result.attacker.remaining) > 0;

  // Store the record first: the primary key on battle_reports is the last line of defence against double application.
  await g.tx.query(`UPDATE battles SET status = 'resolved', resolved_at = $2, inputs = $3, weather = $4, defender_clan_id = $5 WHERE id = $1`, [
    battle.id,
    g.now,
    JSON.stringify(inputs),
    weather,
    defenderId,
  ]);
  await g.tx.query(
    `INSERT INTO battle_reports (battle_id, outcome, winner, province_captured, attacker_losses, defender_losses, result, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [battle.id, result.outcome, result.winner, captured, attackerLost, defenderLost, JSON.stringify(result), g.now],
  );

  // Casualties.
  await setArmyUnits(g.tx, army.id, result.attacker.remaining);
  if (garrison) await setArmyUnits(g.tx, garrison.id, result.defender.remaining);

  let loot: ResourceBag = emptyBag();
  let refuge: string | null = null;
  if (captured) {
    if (garrison) refuge = await retreatDefenders(g, garrison, province, result.defender.remaining);
    await transferProvince(g, province, attacker.id, 'conquest', battle.id);
    await g.tx.query(
      `UPDATE armies SET status = 'garrison', intent = NULL, province_id = $2, target_province_id = NULL, path = NULL, departed_at = NULL, arrives_at = NULL
        WHERE id = $1`,
      [army.id, province.id],
    );
    // Spoils: a tenth of a defeated clan's stores, or the local storehouses of an unclaimed province.
    if (defenderId) {
      const stock = await getResources(g.tx, defenderId);
      for (const k of RESOURCE_KEYS) loot[k] = Math.floor(stock[k] * 0.1);
      if (RESOURCE_KEYS.some((k) => loot[k] > 0)) {
        await spend(g, defenderId, loot, 'battle_plunder', { type: 'battle', id: battle.id });
      }
    } else {
      loot = { gold: 200, food: 200, wood: 100, stone: 50, iron: 20 };
    }
    if (RESOURCE_KEYS.some((k) => loot[k] > 0)) await grant(g, attacker.id, loot, 'battle_loot', { type: 'battle', id: battle.id });
  } else if (totalUnits(result.attacker.remaining) > 0) {
    const marched = army.arrives_at && army.departed_at ? army.arrives_at.getTime() - army.departed_at.getTime() : undefined;
    await sendHome(g, { ...army, units: result.attacker.remaining }, province, battle.origin_province_id, marched);
  } else {
    await deleteArmy(g.tx, army.id);
  }

  // Experience for both commanders.
  const attackerWon = result.winner === 'attacker';
  await awardClanXp(
    g,
    attacker.id,
    'military',
    (20 + defenderLost * 0.5) * (attackerWon ? 1.5 : 1) + (captured ? 60 : 0),
    modsA.xpGain,
    army.commander_player_id,
  );
  if (captured) await awardClanXp(g, attacker.id, 'leadership', 80, modsA.xpGain, null);
  if (defenderId) await awardClanXp(g, defenderId, 'military', (15 + attackerLost * 0.5) * (result.winner === 'defender' ? 1.5 : 1), modsD.xpGain, null);
  if (army.commander_player_id) {
    await g.tx.query('UPDATE players SET battles_led = battles_led + 1, battles_won = battles_won + $2, reputation = reputation + $3 WHERE id = $1', [
      army.commander_player_id,
      attackerWon ? 1 : 0,
      attackerWon ? (captured ? 5 : 2) : 0,
    ]);
  }

  // The clans' war records, and the war plan this attack carried out.
  if (result.winner !== 'none') {
    const winnerId = attackerWon ? attacker.id : defenderId;
    const loserId = attackerWon ? defenderId : attacker.id;
    if (winnerId) await g.tx.query('UPDATE clans SET victories = victories + 1 WHERE id = $1', [winnerId]);
    if (loserId) await g.tx.query('UPDATE clans SET defeats = defeats + 1 WHERE id = $1', [loserId]);
  }
  await completePlan(g, army.plan_id, battle.id, result, captured);

  const label = OUTCOME_LABEL[result.outcome];
  const defenderName = inputs.defender.name;
  const lootText = RESOURCE_KEYS.filter((k) => loot[k] > 0).map((k) => `${loot[k]} ${k}`).join(', ');
  await notifyClan(g, attacker.id, {
    type: 'battle',
    title: `${label} at ${province.name}`,
    body: captured
      ? `${province.name} is yours. You lost ${attackerLost} soldiers; the enemy lost ${defenderLost}.${lootText ? ` Spoils: ${lootText}.` : ''}`
      : `Your attack on ${province.name} did not take the province. You lost ${attackerLost} soldiers; the enemy lost ${defenderLost}.`,
    link: `/game/battles/${battle.id}`,
  });
  await notifyClan(g, defenderId, {
    type: 'battle',
    title: captured ? `${province.name} has fallen` : `${province.name} holds`,
    body: captured
      ? `The nation of ${attacker.name} has taken ${province.name}. You lost ${defenderLost} soldiers${refuge ? `; the survivors withdrew to ${refuge}` : ''}.`
      : `Your garrison threw back the nation of ${attacker.name}. You lost ${defenderLost} soldiers; the enemy lost ${attackerLost}.`,
    link: `/game/battles/${battle.id}`,
  });
  if (captured) {
    await chronicle(g, {
      type: 'conquest',
      title: `${attacker.name} takes ${province.name}`,
      description: `On ${dayLabel(g.tick)}, under ${WEATHER_INFO[weather].name.toLowerCase()}, the ${attacker.name} banner was raised over ${province.name}, taken from ${defender ? `the nation of ${defenderName}` : 'its local militia'}. ${attackerLost + defenderLost} men fell.`,
      provinceId: province.id,
      clanId: attacker.id,
    });
  }
  await audit({ ...g, actorPlayerId: null }, 'battle.resolve', { type: 'battle', id: battle.id }, attacker.id, {
    province: province.code,
    outcome: result.outcome,
    captured,
    attackerLost,
    defenderLost,
  });

  const payload = { battleId: battle.id, provinceId: province.id, outcome: result.outcome, captured };
  await emitClan(g, attacker.id, 'battle:completed', payload);
  await emitClan(g, defenderId, 'battle:completed', payload);
  await emit(g, WORLD_ROOM, 'world:province_updated', { provinceId: province.id });
  await emit(g, WORLD_ROOM, 'army:updated', { clanId: attacker.id });
}

/** Serialise with sorted keys: JSONB does not preserve key order, so compare canonically. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Re-run a stored battle and check that the stored report is exactly what comes out. */
export function verifyBattle(inputs: BattleInputs, seed: string, stored: BattleResult): boolean {
  return canonical(simulateBattle(inputs, seed)) === canonical(stored);
}

export async function pendingBattles(db: G['tx']): Promise<BattleRow[]> {
  return rows<BattleRow>(db, `SELECT * FROM battles WHERE status = 'pending' ORDER BY resolves_at`);
}
