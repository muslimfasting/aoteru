/**
 * Battle simulation engine (GDD §7).
 *
 * `simulateBattle` is a pure function: the same inputs and the same seed always
 * produce the same result. The server stores both next to every battle, so any
 * report can be re-run and verified later. The rules in force (unit statistics
 * and combat constants) are snapshotted into the inputs, which keeps old
 * battles reproducible even after the balance changes.
 *
 *   Army Power = Unit Base Power × Commander Bonus × Morale Modifier
 *                × Terrain Modifier × Technology Modifier
 */
import {
  BUILDING_EFFECTS,
  TERRAIN_INFO,
  UNITS,
  UNIT_TYPES,
  emptyUnits,
  totalUnits,
  armyPower,
  type Terrain,
  type UnitClass,
  type UnitCounts,
  type UnitType,
} from './config';
import { createRng, type Rng } from './rng';
import type { StrategyResolution } from './strategy';

export const WEATHERS = ['clear', 'rain', 'fog', 'wind', 'snow'] as const;
export type Weather = (typeof WEATHERS)[number];

export const WEATHER_INFO: Record<
  Weather,
  { name: string; weight: number; ranged: number; cavalry: number; attackerMorale: number; note: string }
> = {
  clear: { name: 'Clear skies', weight: 50, ranged: 1, cavalry: 1, attackerMorale: 0, note: 'No effect.' },
  rain: { name: 'Heavy rain', weight: 20, ranged: 0.7, cavalry: 0.9, attackerMorale: 0, note: 'Wet powder and mud: riflemen -30%, cavalry -10%.' },
  fog: { name: 'Morning fog', weight: 12, ranged: 0.85, cavalry: 1, attackerMorale: 5, note: 'Riflemen -15%. The attacker closes unseen (+5 morale).' },
  wind: { name: 'Strong wind', weight: 10, ranged: 0.9, cavalry: 1, attackerMorale: 0, note: 'Riflemen -10%: the smoke hangs and the aim drifts.' },
  snow: { name: 'Snow', weight: 8, ranged: 0.95, cavalry: 0.8, attackerMorale: -5, note: 'Cavalry -20%. The march wears on the attacker (-5 morale).' },
};

export function rollWeather(seed: string): Weather {
  return createRng(`weather:${seed}`).weighted(WEATHERS.map((w) => [w, WEATHER_INFO[w].weight] as const));
}

export interface BattleRules {
  version: number;
  maxRounds: number;
  /** Share of raw offense that becomes damage before toughness is applied. */
  lethality: number;
  defenseScale: number;
  /** Per-round random swing, e.g. 0.08 = ±8%. */
  randomSpread: number;
  /** A side breaks when its morale falls below this... */
  routMorale: number;
  /** ...or when this fraction (or less) of its starting strength remains. */
  routStrength: number;
  moraleLossFactor: number;
  moraleLoserPenalty: number;
  moraleWinnerBonus: number;
  /** Opening-round bonus for ranged units. */
  volleyBonus: number;
  /** Opening-round bonus for cavalry on open ground. */
  chargeBonus: number;
  /** Share of a broken side cut down while fleeing. */
  pursuitLoss: number;
  /** A win is decisive when the attacker loses no more than this share. */
  decisiveLossRatio: number;
  /** An attacker that breaks but keeps this share of its men has retreated rather than been defeated. */
  retreatStrength: number;
  castleDefensePerLevel: number;
  units: Record<
    UnitType,
    { class: UnitClass; attack: number; defense: number; hp: number; frontline: number; bonusVs: Partial<Record<UnitType, number>> }
  >;
  terrain: Record<Terrain, { defense: number; cavalry: number }>;
  weather: Record<Weather, { ranged: number; cavalry: number }>;
}

/** The combat rules currently in force. Tune here; old battles keep their own snapshot. */
export function currentBattleRules(): BattleRules {
  const units = {} as BattleRules['units'];
  for (const t of UNIT_TYPES) {
    const d = UNITS[t];
    units[t] = { class: d.class, attack: d.attack, defense: d.defense, hp: d.hp, frontline: d.frontline, bonusVs: { ...d.bonusVs } };
  }
  const terrain = {} as BattleRules['terrain'];
  for (const [k, v] of Object.entries(TERRAIN_INFO) as [Terrain, (typeof TERRAIN_INFO)[Terrain]][]) {
    terrain[k] = { defense: v.defense, cavalry: v.cavalry };
  }
  const weather = {} as BattleRules['weather'];
  for (const w of WEATHERS) weather[w] = { ranged: WEATHER_INFO[w].ranged, cavalry: WEATHER_INFO[w].cavalry };
  return {
    version: 1,
    maxRounds: 8,
    lethality: 0.42,
    defenseScale: 20,
    randomSpread: 0.08,
    routMorale: 25,
    routStrength: 0.3,
    moraleLossFactor: 100,
    moraleLoserPenalty: 5,
    moraleWinnerBonus: 2,
    volleyBonus: 0.5,
    chargeBonus: 0.4,
    pursuitLoss: 0.15,
    decisiveLossRatio: 0.2,
    retreatStrength: 0.5,
    castleDefensePerLevel: BUILDING_EFFECTS.castleDefensePerLevel,
    units,
    terrain,
    weather,
  };
}

export interface BattleSideMods {
  /** Commander bonus to damage (fraction). */
  attack: number;
  /** Commander bonus to damage resistance (fraction). */
  toughness: number;
  infantry: number;
  ranged: number;
  cavalry: number;
  firstRound: number;
  /** Fraction of the castle bonus this side ignores when attacking. */
  siege: number;
}

export interface BattleSide {
  clanId: string | null;
  name: string;
  /** The member who led this side, where one did. */
  commander?: string | null;
  units: UnitCounts;
  /** Starting morale with every flat modifier already applied. */
  morale: number;
  mods: BattleSideMods;
}

export interface BattleInputs {
  rules: BattleRules;
  province: { code: string; name: string; terrain: Terrain; castleLevel: number };
  weather: Weather;
  attacker: BattleSide;
  defender: BattleSide;
  /**
   * Multiplier on the defender's advantage from castle and terrain (1 =
   * unchanged, 0 = fighting in the open). Set by the strategy resolution:
   * a garrison lured out, raided at night or lying in ambush gives up its walls.
   */
  positionFactor?: number;
  /**
   * How the attacker's tactic fared against the defender's stance. Its effects
   * are already folded into both sides' modifiers and morale above; it is kept
   * here so the report can explain the battle and the record can be audited.
   */
  strategy?: StrategyResolution & { tacticName: string; stanceName: string; attackerHadIntel: boolean };
}

export const BATTLE_OUTCOMES = ['decisive_victory', 'victory', 'draw', 'defeat', 'retreat'] as const;
/** Always stated from the attacker's point of view. */
export type BattleOutcome = (typeof BATTLE_OUTCOMES)[number];

export const OUTCOME_LABEL: Record<BattleOutcome, string> = {
  decisive_victory: 'Decisive Victory',
  victory: 'Victory',
  draw: 'Draw',
  defeat: 'Defeat',
  retreat: 'Retreat',
};

export interface BattleRound {
  round: number;
  attackerDamage: number;
  defenderDamage: number;
  attackerLosses: UnitCounts;
  defenderLosses: UnitCounts;
  attackerMorale: number;
  defenderMorale: number;
  attackerRemaining: number;
  defenderRemaining: number;
}

export interface BattleSideResult {
  initial: UnitCounts;
  losses: UnitCounts;
  remaining: UnitCounts;
  initialPower: number;
  finalMorale: number;
}

export interface BattleResult {
  outcome: BattleOutcome;
  winner: 'attacker' | 'defender' | 'none';
  rounds: BattleRound[];
  attacker: BattleSideResult;
  defender: BattleSideResult;
  /** Losses inflicted on the broken side as it fled (already included in its totals). */
  pursuit: { side: 'attacker' | 'defender' | null; losses: UnitCounts };
  /** Effective castle bonus the defender fought with, after siege skills. */
  castleBonus: number;
}

function moraleFactor(morale: number): number {
  return Math.max(0.5, Math.min(1.12, 0.6 + (0.4 * morale) / 100));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function offense(
  rules: BattleRules,
  own: UnitCounts,
  enemy: UnitCounts,
  mods: BattleSideMods,
  morale: number,
  terrain: Terrain,
  weather: Weather,
  roundNo: number,
  rng: Rng,
): number {
  const enemyTotal = totalUnits(enemy);
  const openGround = rules.terrain[terrain].cavalry >= 0.95;
  let power = 0;
  for (const t of UNIT_TYPES) {
    const n = own[t];
    if (n <= 0) continue;
    const u = rules.units[t];
    // Counter bonus, weighted by how much of the enemy host each target type makes up.
    let counter = 1;
    if (enemyTotal > 0) {
      counter = 0;
      for (const e of UNIT_TYPES) counter += (enemy[e] / enemyTotal) * (u.bonusVs[e] ?? 1);
    }
    let m = 1 + mods[u.class];
    if (u.class === 'cavalry') m *= rules.terrain[terrain].cavalry * rules.weather[weather].cavalry;
    if (u.class === 'ranged') m *= rules.weather[weather].ranged;
    if (roundNo === 1) {
      if (u.class === 'ranged') m *= 1 + rules.volleyBonus;
      if (u.class === 'cavalry' && openGround) m *= 1 + rules.chargeBonus;
    }
    power += n * u.attack * counter * m;
  }
  power *= 1 + mods.attack;
  power *= moraleFactor(morale);
  if (roundNo === 1) power *= 1 + mods.firstRound;
  power *= rng.range(1 - rules.randomSpread, 1 + rules.randomSpread);
  return power;
}

/** Average armour of a host, raised by the commander's toughness bonus. */
function toughness(rules: BattleRules, own: UnitCounts, mods: BattleSideMods): number {
  const total = totalUnits(own);
  if (total <= 0) return 0;
  let def = 0;
  for (const t of UNIT_TYPES) def += own[t] * rules.units[t].defense;
  return (def / total) * (1 + mods.toughness);
}

/** Turn a pool of damage into casualties, spread by how exposed each unit type is. */
function casualties(rules: BattleRules, own: UnitCounts, damage: number, rng: Rng): UnitCounts {
  const losses = emptyUnits();
  let exposure = 0;
  for (const t of UNIT_TYPES) exposure += own[t] * rules.units[t].frontline;
  if (exposure <= 0 || damage <= 0) return losses;
  for (const t of UNIT_TYPES) {
    if (own[t] <= 0) continue;
    const share = (own[t] * rules.units[t].frontline) / exposure;
    const exact = (damage * share) / rules.units[t].hp;
    let killed = Math.floor(exact);
    if (rng.chance(exact - killed)) killed += 1;
    losses[t] = Math.min(own[t], killed);
  }
  return losses;
}

function subtract(units: UnitCounts, losses: UnitCounts): void {
  for (const t of UNIT_TYPES) units[t] = Math.max(0, units[t] - losses[t]);
}

function accumulate(into: UnitCounts, losses: UnitCounts): void {
  for (const t of UNIT_TYPES) into[t] += losses[t];
}

export function simulateBattle(inputs: BattleInputs, seed: string): BattleResult {
  const rules = inputs.rules;
  const rng = createRng(`battle:${seed}`);
  const terrain = inputs.province.terrain;

  const a = { units: { ...inputs.attacker.units }, morale: inputs.attacker.morale };
  const d = { units: { ...inputs.defender.units }, morale: inputs.defender.morale };
  const initA = totalUnits(a.units);
  const initD = totalUnits(d.units);
  const lossesA = emptyUnits();
  const lossesD = emptyUnits();
  const rounds: BattleRound[] = [];

  const castleBonus =
    inputs.province.castleLevel * rules.castleDefensePerLevel * Math.max(0, 1 - inputs.attacker.mods.siege);
  const positionFactor = Math.max(0, Math.min(1, inputs.positionFactor ?? 1));
  const defenderPosition = 1 + (rules.terrain[terrain].defense * (1 + castleBonus) - 1) * positionFactor;

  let outcome: BattleOutcome = 'draw';
  let winner: BattleResult['winner'] = 'none';
  const pursuit: BattleResult['pursuit'] = { side: null, losses: emptyUnits() };

  const finish = (): BattleResult => ({
    outcome,
    winner,
    rounds,
    attacker: {
      initial: { ...inputs.attacker.units },
      losses: lossesA,
      remaining: a.units,
      initialPower: armyPower(inputs.attacker.units),
      finalMorale: round1(a.morale),
    },
    defender: {
      initial: { ...inputs.defender.units },
      losses: lossesD,
      remaining: d.units,
      initialPower: armyPower(inputs.defender.units),
      finalMorale: round1(d.morale),
    },
    pursuit,
    castleBonus: Math.round(castleBonus * 1000) / 1000,
  });

  // An undefended province falls without a fight; an empty attacking force cannot win.
  if (initA <= 0) {
    outcome = 'defeat';
    winner = 'defender';
    return finish();
  }
  if (initD <= 0) {
    outcome = 'decisive_victory';
    winner = 'attacker';
    return finish();
  }

  for (let r = 1; r <= rules.maxRounds; r++) {
    const beforeA = totalUnits(a.units);
    const beforeD = totalUnits(d.units);

    const offA = offense(rules, a.units, d.units, inputs.attacker.mods, a.morale, terrain, inputs.weather, r, rng);
    const offD = offense(rules, d.units, a.units, inputs.defender.mods, d.morale, terrain, inputs.weather, r, rng);
    const toughA = toughness(rules, a.units, inputs.attacker.mods);
    const toughD = toughness(rules, d.units, inputs.defender.mods);

    // Terrain and castle walls divide the damage the defender takes outright.
    const dmgToD = (offA * rules.lethality) / ((1 + toughD / rules.defenseScale) * defenderPosition);
    const dmgToA = (offD * rules.lethality) / (1 + toughA / rules.defenseScale);

    // Both sides strike simultaneously.
    const roundLossA = casualties(rules, a.units, dmgToA, rng);
    const roundLossD = casualties(rules, d.units, dmgToD, rng);
    subtract(a.units, roundLossA);
    subtract(d.units, roundLossD);
    accumulate(lossesA, roundLossA);
    accumulate(lossesD, roundLossD);

    const fracA = totalUnits(roundLossA) / beforeA;
    const fracD = totalUnits(roundLossD) / beforeD;
    a.morale -= fracA * rules.moraleLossFactor;
    d.morale -= fracD * rules.moraleLossFactor;
    if (fracA > fracD) {
      a.morale -= rules.moraleLoserPenalty;
      d.morale += rules.moraleWinnerBonus;
    } else if (fracD > fracA) {
      d.morale -= rules.moraleLoserPenalty;
      a.morale += rules.moraleWinnerBonus;
    }
    a.morale = Math.max(0, Math.min(150, a.morale));
    d.morale = Math.max(0, Math.min(150, d.morale));

    const remA = totalUnits(a.units);
    const remD = totalUnits(d.units);
    rounds.push({
      round: r,
      attackerDamage: Math.round(dmgToD),
      defenderDamage: Math.round(dmgToA),
      attackerLosses: roundLossA,
      defenderLosses: roundLossD,
      attackerMorale: round1(a.morale),
      defenderMorale: round1(d.morale),
      attackerRemaining: remA,
      defenderRemaining: remD,
    });

    const brokenA = remA <= 0 || a.morale < rules.routMorale || remA / initA <= rules.routStrength;
    const brokenD = remD <= 0 || d.morale < rules.routMorale || remD / initD <= rules.routStrength;

    if (brokenA && brokenD) {
      outcome = 'draw';
      winner = 'none';
      return finish();
    }
    if (brokenD) {
      if (remD > 0) {
        pursuit.side = 'defender';
        for (const t of UNIT_TYPES) pursuit.losses[t] = Math.round(d.units[t] * rules.pursuitLoss);
        subtract(d.units, pursuit.losses);
        accumulate(lossesD, pursuit.losses);
      }
      winner = 'attacker';
      outcome = totalUnits(lossesA) / initA <= rules.decisiveLossRatio ? 'decisive_victory' : 'victory';
      return finish();
    }
    if (brokenA) {
      if (remA > 0) {
        pursuit.side = 'attacker';
        for (const t of UNIT_TYPES) pursuit.losses[t] = Math.round(a.units[t] * rules.pursuitLoss);
        subtract(a.units, pursuit.losses);
        accumulate(lossesA, pursuit.losses);
      }
      winner = 'defender';
      outcome = totalUnits(a.units) / initA >= rules.retreatStrength ? 'retreat' : 'defeat';
      return finish();
    }
  }

  // Night falls with both lines intact: the attacker withdraws.
  outcome = 'draw';
  winner = 'none';
  return finish();
}

export function neutralBattleMods(): BattleSideMods {
  return { attack: 0, toughness: 0, infantry: 0, ranged: 0, cavalry: 0, firstRound: 0, siege: 0 };
}
