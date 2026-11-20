/**
 * The Art of War (change request §6): battlefield strategies and their counters.
 *
 * An attacking army marches with one TACTIC. A province is held in one
 * STANCE. When the battle is fought the server resolves the pair — was the
 * tactic countered, did it come off, was an ambush revealed by scouts — and
 * turns the answer into the modifiers the battle engine fights with.
 *
 * No choice is always best: every tactic has a requirement, a cost, a chance
 * to fail and a stance that defeats it; every stance has a price and a tactic
 * it cannot stop. Everything here is pure: the same inputs and seed always
 * give the same resolution, which is stored with the battle so it can be
 * audited and replayed.
 */
import { UNITS, UNIT_TYPES, totalUnits, type ResourceBag, type Terrain, type UnitCounts } from './config';
import type { PillarId } from './pillars';
import { createRng } from './rng';

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const TACTICS = ['assault', 'flanking', 'night_raid', 'feigned_retreat', 'siege', 'pincer'] as const;
export type TacticId = (typeof TACTICS)[number];

export const STANCES = ['formation', 'night_watch', 'hold', 'ambush', 'reserve', 'stockpile'] as const;
export type StanceId = (typeof STANCES)[number];

export interface TacticDef {
  id: TacticId;
  name: string;
  /** Sun Tzu-style line shown under the name. */
  maxim: string;
  summary: string;
  /** What it does when it comes off. */
  effect: string;
  /** What happens when the defender was ready for it. */
  risk: string;
  /** The stance that defeats it; null if nothing does. */
  counter: StanceId | null;
  /** Chance to come off when not countered, before skill is weighed. 1 = certain. */
  baseChance: number;
  /** The pillar whose level shifts the chance (attacker's level against the defender's). */
  pillar: PillarId | null;
  /** Clan pillar level needed to order it. */
  requires: { pillar: PillarId; level: number } | null;
  /** Paid from the treasury when the army sets out. */
  cost: Partial<ResourceBag>;
  /** Extra game minutes before the battle is decided. */
  extraMinutes: number;
  /** Multiplier on the food the march consumes. */
  supplyFactor: number;
}

export const TACTIC_DEFS: Record<TacticId, TacticDef> = {
  assault: {
    id: 'assault',
    name: 'Frontal Assault',
    maxim: 'March straight at the gate.',
    summary: 'No tricks: the whole host attacks at once.',
    effect: 'No bonus and nothing to go wrong.',
    risk: 'Walks into an ambush at full cost.',
    counter: null,
    baseChance: 1,
    pillar: null,
    requires: null,
    cost: {},
    extraMinutes: 0,
    supplyFactor: 1,
  },
  flanking: {
    id: 'flanking',
    name: 'Flanking',
    maxim: 'Appear where you are not expected.',
    summary: 'Horsemen ride around the line and strike its side.',
    effect: '+18% damage and the enemy loses 6 morale.',
    risk: 'Against a Defensive Formation the riders are caught: -10% damage and no opening charge.',
    counter: 'formation',
    baseChance: 0.8,
    pillar: 'military',
    requires: null,
    cost: {},
    extraMinutes: 0,
    supplyFactor: 1,
  },
  night_raid: {
    id: 'night_raid',
    name: 'Night Raid',
    maxim: 'Strike while the enemy sleeps.',
    summary: 'A picked force scales the walls in darkness before the main attack.',
    effect: '+45% damage in the opening round, walls and terrain count 30% less, the enemy loses 8 morale.',
    risk: 'A Night Watch is waiting: you lose 15 morale and the defenders strike first.',
    counter: 'night_watch',
    baseChance: 0.65,
    pillar: 'intelligence',
    requires: { pillar: 'intelligence', level: 3 },
    cost: { gold: 150 },
    extraMinutes: 0,
    supplyFactor: 1,
  },
  feigned_retreat: {
    id: 'feigned_retreat',
    name: 'Feigned Retreat',
    maxim: 'Feign disorder, and crush him.',
    summary: 'The vanguard breaks and runs to draw the defenders out of their walls.',
    effect: 'Walls and terrain count 60% less and you gain +20% damage in the opening round.',
    risk: 'If they Hold the Walls nobody follows: you lose 10 morale and the opening round.',
    counter: 'hold',
    baseChance: 0.75,
    pillar: 'leadership',
    requires: { pillar: 'leadership', level: 3 },
    cost: {},
    extraMinutes: 0,
    supplyFactor: 1,
  },
  siege: {
    id: 'siege',
    name: 'Siege',
    maxim: 'Starve them before you storm them.',
    summary: 'Surround the castle, cut its supplies and attack when it weakens.',
    effect: 'The defenders lose 15 morale and 35% of the castle bonus is ignored. Takes longer and eats twice the supplies.',
    risk: 'Against Deep Stores the camp starves first: you lose 12 morale and gain nothing.',
    counter: 'stockpile',
    baseChance: 0.9,
    pillar: 'economy',
    requires: { pillar: 'economy', level: 2 },
    cost: { food: 200 },
    extraMinutes: 120,
    supplyFactor: 2,
  },
  pincer: {
    id: 'pincer',
    name: 'Pincer Movement',
    maxim: 'Divide to surround, unite to strike.',
    summary: 'Two wings close on the enemy from both sides.',
    effect: '+12% damage, the enemy fights 10% less protected and loses 5 morale.',
    risk: 'Reserve Troops crush one wing: -12% damage and you lose 8 morale.',
    counter: 'reserve',
    baseChance: 0.75,
    pillar: 'military',
    requires: { pillar: 'military', level: 4 },
    cost: {},
    extraMinutes: 0,
    supplyFactor: 1,
  },
};

export interface StanceDef {
  id: StanceId;
  name: string;
  maxim: string;
  summary: string;
  /** What it defeats. */
  counters: TacticId | null;
  /** What it costs when it is not needed. */
  price: string;
  /** Paid from the treasury when the stance is ordered. */
  cost: Partial<ResourceBag>;
}

export const STANCE_DEFS: Record<StanceId, StanceDef> = {
  formation: {
    id: 'formation',
    name: 'Defensive Formation',
    maxim: 'Make yourself unassailable first.',
    summary: 'Spears outward, flanks anchored. The standing order of every garrison.',
    counters: 'flanking',
    price: 'None. +5% protection.',
    cost: {},
  },
  night_watch: {
    id: 'night_watch',
    name: 'Night Watch',
    maxim: 'He who is prepared waits for the unprepared.',
    summary: 'Doubled sentries and watch fires through the night.',
    counters: 'night_raid',
    price: 'Tired men: -4 morale when no raid comes.',
    cost: {},
  },
  hold: {
    id: 'hold',
    name: 'Hold the Walls',
    maxim: 'Do not swallow bait offered by the enemy.',
    summary: 'Nobody pursues, whatever the enemy seems to do.',
    counters: 'feigned_retreat',
    price: '+8% protection, but -8% damage: a garrison that never sallies.',
    cost: {},
  },
  ambush: {
    id: 'ambush',
    name: 'Ambush',
    maxim: 'Lie hidden like the thunderbolt.',
    summary: 'The garrison hides in the hills and falls on the column as it arrives.',
    counters: null,
    price: 'Outside the walls: castle and terrain count 25% less. Revealed by enemy scouts, it fails and costs 6 morale.',
    cost: {},
  },
  reserve: {
    id: 'reserve',
    name: 'Reserve Troops',
    maxim: 'Keep a force in hand for the decisive moment.',
    summary: 'A third of the garrison is held back to meet whatever breaks through.',
    counters: 'pincer',
    price: 'Fewer men on the line: -6% damage when no pincer comes.',
    cost: {},
  },
  stockpile: {
    id: 'stockpile',
    name: 'Deep Stores',
    maxim: 'An army without provisions is lost.',
    summary: 'Granaries filled and hidden paths kept open to outlast a siege.',
    counters: 'siege',
    price: 'Costs 250 food to lay in.',
    cost: { food: 250 },
  },
};

/** Game minutes before a newly ordered stance is in force. The old one holds until then. */
export const STANCE_PREP_MINUTES = 120;

/** Terrains in which a garrison can hide. */
export const AMBUSH_TERRAINS: readonly Terrain[] = ['hills', 'mountains'];

/** Shares of the host a tactic needs. */
export const FLANKING_CAVALRY_SHARE = 0.15;
export const PINCER_MIN_SOLDIERS = 300;

// ---------------------------------------------------------------------------
// Requirements (checked by the server before the order is accepted)
// ---------------------------------------------------------------------------

export function cavalryShare(units: Partial<UnitCounts>): number {
  const total = totalUnits(units);
  if (total <= 0) return 0;
  let cavalry = 0;
  for (const t of UNIT_TYPES) if (UNITS[t].class === 'cavalry') cavalry += units[t] ?? 0;
  return cavalry / total;
}

/** Why this host cannot use the tactic, or null if it can. */
export function tacticBlockReason(
  tactic: TacticId,
  units: Partial<UnitCounts>,
  levels: Record<PillarId, number>,
  terrain: Terrain | null,
): string | null {
  const def = TACTIC_DEFS[tactic];
  if (!def) return 'Unknown tactic';
  if (def.requires && levels[def.requires.pillar] < def.requires.level) {
    return `Needs ${def.requires.pillar[0].toUpperCase()}${def.requires.pillar.slice(1)} level ${def.requires.level} (the nation has ${levels[def.requires.pillar]})`;
  }
  if (tactic === 'flanking') {
    if (cavalryShare(units) < FLANKING_CAVALRY_SHARE) return `At least ${Math.round(FLANKING_CAVALRY_SHARE * 100)}% of the host must be cavalry`;
    if (terrain === 'mountains') return 'There is no room to ride around a line in the mountains';
  }
  if (tactic === 'pincer' && totalUnits(units) < PINCER_MIN_SOLDIERS) return `Needs at least ${PINCER_MIN_SOLDIERS} soldiers to split into two wings`;
  return null;
}

/** Why this province cannot be held in the stance, or null if it can. */
export function stanceBlockReason(stance: StanceId, terrain: Terrain, garrison: number): string | null {
  if (!STANCE_DEFS[stance]) return 'Unknown stance';
  if (stance === 'ambush' && !AMBUSH_TERRAINS.includes(terrain)) return 'An ambush needs hills or mountains to hide in';
  if (stance === 'reserve' && garrison < 150) return 'Needs a garrison of at least 150 to hold a reserve';
  return null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface StrategySideEffect {
  /** Fractions added to the side's battle modifiers. */
  attack: number;
  toughness: number;
  firstRound: number;
  siege: number;
  /** Flat morale change before the first round. */
  morale: number;
}

export interface StrategyInput {
  tactic: TacticId;
  stance: StanceId;
  /** The attacker holds a fresh scouting report on the province. */
  attackerHasIntel: boolean;
  /** Clan pillar levels of both sides (the attacker's Military is the commander's). */
  attackerLevels: Record<PillarId, number>;
  defenderLevels: Record<PillarId, number>;
  /** Flat bonus to the tactic's chance from doctrine and war-plan duties. */
  chanceBonus: number;
}

export interface StrategyResolution {
  tactic: TacticId;
  stance: StanceId;
  /** countered: the stance defeated the tactic. succeeded / failed: it was not countered and the roll decided. plain: nothing to roll. */
  tacticResult: 'plain' | 'succeeded' | 'failed' | 'countered';
  /** Chance the tactic had to come off (0..1), when it was rolled. */
  chance: number | null;
  /** held: nothing special. sprung: the ambush worked. revealed: scouts found the ambush. wasted: the stance guarded against something that did not come. countering: it defeated the tactic. */
  stanceResult: 'held' | 'sprung' | 'revealed' | 'wasted' | 'countering';
  attacker: StrategySideEffect;
  defender: StrategySideEffect;
  /** Multiplier on the defender's castle and terrain advantage (1 = unchanged). */
  positionFactor: number;
  /** Plain-language account for the battle report, in order. */
  notes: string[];
}

const noEffect = (): StrategySideEffect => ({ attack: 0, toughness: 0, firstRound: 0, siege: 0, morale: 0 });

export function tacticChance(input: Pick<StrategyInput, 'tactic' | 'attackerLevels' | 'defenderLevels' | 'chanceBonus'>): number {
  const def = TACTIC_DEFS[input.tactic];
  if (def.baseChance >= 1 || !def.pillar) return 1;
  const edge = input.attackerLevels[def.pillar] - input.defenderLevels[def.pillar];
  return Math.max(0.35, Math.min(0.95, def.baseChance + edge * 0.03 + input.chanceBonus));
}

/**
 * Resolve a tactic against a stance. Pure and deterministic for a given seed.
 * The numbers here are the single place strategy balance lives.
 */
export function resolveStrategy(input: StrategyInput, seed: string): StrategyResolution {
  const tactic = TACTIC_DEFS[input.tactic] ? input.tactic : 'assault';
  const stance = STANCE_DEFS[input.stance] ? input.stance : 'formation';
  const t = TACTIC_DEFS[tactic];
  const s = STANCE_DEFS[stance];
  const a = noEffect();
  const d = noEffect();
  let positionFactor = 1;
  const notes: string[] = [];

  // --- the tactic ----------------------------------------------------------
  let tacticResult: StrategyResolution['tacticResult'] = 'plain';
  let chance: number | null = null;
  const countered = t.counter !== null && t.counter === stance;
  if (tactic === 'assault') {
    notes.push('The attackers came on in a plain frontal assault.');
  } else if (countered) {
    tacticResult = 'countered';
    notes.push(`${t.name} was met by ${s.name}: the defenders were ready for it.`);
    if (tactic === 'flanking') {
      a.attack -= 0.1;
      a.firstRound -= 0.15;
    } else if (tactic === 'night_raid') {
      a.morale -= 15;
      d.firstRound += 0.25;
    } else if (tactic === 'feigned_retreat') {
      a.morale -= 10;
      a.firstRound -= 0.25;
    } else if (tactic === 'siege') {
      a.morale -= 12;
      d.morale += 5;
    } else if (tactic === 'pincer') {
      a.attack -= 0.12;
      a.morale -= 8;
    }
  } else {
    chance = tacticChance({ ...input, tactic });
    const roll = createRng(`strategy:${seed}`).next();
    if (roll < chance) {
      tacticResult = 'succeeded';
      notes.push(`${t.name} came off as planned.`);
      if (tactic === 'flanking') {
        a.attack += 0.18;
        d.morale -= 6;
      } else if (tactic === 'night_raid') {
        a.firstRound += 0.45;
        d.morale -= 8;
        positionFactor *= 0.7;
      } else if (tactic === 'feigned_retreat') {
        a.firstRound += 0.2;
        positionFactor *= 0.4;
      } else if (tactic === 'siege') {
        d.morale -= 15;
        a.siege += 0.35;
        a.firstRound -= 0.1;
      } else if (tactic === 'pincer') {
        a.attack += 0.12;
        d.toughness -= 0.1;
        d.morale -= 5;
      }
    } else {
      tacticResult = 'failed';
      notes.push(`${t.name} miscarried: the plan fell apart in the execution.`);
      a.morale -= 5;
      if (tactic === 'siege') a.morale -= 3;
    }
  }

  // --- the stance ----------------------------------------------------------
  let stanceResult: StrategyResolution['stanceResult'] = 'held';
  if (countered) {
    stanceResult = 'countering';
    if (stance === 'formation') d.toughness += 0.05;
    if (stance === 'hold') d.toughness += 0.08;
  } else if (stance === 'ambush') {
    positionFactor *= 0.75;
    if (input.attackerHasIntel) {
      stanceResult = 'revealed';
      d.morale -= 6;
      notes.push('Scouts had found the ambush: the attackers came ready and caught the garrison outside its walls.');
    } else {
      stanceResult = 'sprung';
      d.firstRound += 0.5;
      a.morale -= 8;
      notes.push('The garrison lay in ambush and fell on the column as it arrived.');
    }
  } else if (stance === 'formation') {
    d.toughness += 0.05;
  } else if (stance === 'night_watch') {
    stanceResult = 'wasted';
    d.morale -= 4;
    notes.push('The garrison had stood watch all night for a raid that never came.');
  } else if (stance === 'hold') {
    d.toughness += 0.08;
    d.attack -= 0.08;
    notes.push('The garrison kept to its walls and would not be drawn out.');
  } else if (stance === 'reserve') {
    stanceResult = 'wasted';
    d.attack -= 0.06;
    notes.push('A reserve was held back for an encirclement that did not come.');
  } else if (stance === 'stockpile') {
    notes.push('The storehouses were full, but no siege was laid.');
  }

  return {
    tactic,
    stance,
    tacticResult,
    chance: chance === null ? null : Math.round(chance * 1000) / 1000,
    stanceResult,
    attacker: a,
    defender: d,
    positionFactor: Math.round(positionFactor * 1000) / 1000,
    notes,
  };
}

/** The stance an NPC or unclaimed garrison holds: fixed by the land it stands on, with a seeded twist. */
export function defaultStance(terrain: Terrain, garrison: number, seed: string): StanceId {
  const rng = createRng(`stance:${seed}`);
  const options: [StanceId, number][] = [
    ['formation', 5],
    ['night_watch', 2],
    ['hold', 2],
  ];
  if (AMBUSH_TERRAINS.includes(terrain)) options.push(['ambush', 3]);
  if (garrison >= 150) options.push(['reserve', 1]);
  return rng.weighted(options);
}
