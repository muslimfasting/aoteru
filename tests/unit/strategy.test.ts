import { describe, expect, it } from 'vitest';
import { currentBattleRules, neutralBattleMods, simulateBattle, type BattleInputs } from '@/game/battle';
import { DOCTRINES, DOCTRINE_DEFS, applyDoctrine, contributionPoints, outranks, residenceCost, residenceIncome } from '@/game/clan';
import { emptyUnits, totalUnits } from '@/game/config';
import { emptyModifiers } from '@/game/pillars';
import {
  STANCES,
  STANCE_DEFS,
  TACTICS,
  TACTIC_DEFS,
  defaultStance,
  resolveStrategy,
  stanceBlockReason,
  tacticBlockReason,
  tacticChance,
  type StrategyInput,
} from '@/game/strategy';

const levels = (n = 1) => ({ military: n, leadership: n, economy: n, intelligence: n, culture: n });
const input = (over: Partial<StrategyInput>): StrategyInput => ({
  tactic: 'assault',
  stance: 'formation',
  attackerHasIntel: false,
  attackerLevels: levels(),
  defenderLevels: levels(),
  chanceBonus: 0,
  ...over,
});
/** A stance that neither defeats the tactic nor does anything of its own. */
const idle = (tactic: StrategyInput['tactic']): StrategyInput['stance'] => (TACTIC_DEFS[tactic].counter === 'stockpile' ? 'formation' : 'stockpile');
/** A seed for which the tactic's roll succeeds (or fails). */
function seedWhere(tactic: StrategyInput['tactic'], want: 'succeeded' | 'failed'): string {
  for (let i = 0; i < 500; i++) {
    const seed = `seed-${i}`;
    if (resolveStrategy(input({ tactic, stance: idle(tactic) }), seed).tacticResult === want) return seed;
  }
  throw new Error(`no seed found for ${tactic} ${want}`);
}

describe('strategy definitions', () => {
  it('gives every tactic but the plain assault exactly one stance that defeats it', () => {
    for (const id of TACTICS) {
      const t = TACTIC_DEFS[id];
      if (id === 'assault') {
        expect(t.counter).toBeNull();
        continue;
      }
      expect(t.counter, id).not.toBeNull();
      expect(STANCE_DEFS[t.counter!].counters, id).toBe(id);
    }
  });

  it('lets no stance stop everything: each one counters at most one tactic', () => {
    for (const id of STANCES) {
      const stopped = TACTICS.filter((t) => TACTIC_DEFS[t].counter === id);
      expect(stopped.length, id).toBeLessThanOrEqual(1);
      expect(STANCE_DEFS[id].counters ?? null).toBe(stopped[0] ?? null);
    }
    // ...and the ambush, which no tactic answers, is answered by scouting.
    expect(STANCE_DEFS.ambush.counters).toBeNull();
  });

  it('gives every special tactic a requirement, a cost or a chance to fail', () => {
    for (const id of TACTICS) {
      if (id === 'assault') continue;
      const t = TACTIC_DEFS[id];
      const priced = Object.values(t.cost).some((v) => (v ?? 0) > 0);
      expect(t.baseChance < 1 || priced || t.requires !== null, id).toBe(true);
    }
  });
});

describe('tactic requirements', () => {
  it('needs cavalry and open ground to flank', () => {
    expect(tacticBlockReason('flanking', { ashigaru: 100 }, levels(), 'plains')).toMatch(/cavalry/);
    expect(tacticBlockReason('flanking', { ashigaru: 80, cavalry: 20 }, levels(), 'plains')).toBeNull();
    expect(tacticBlockReason('flanking', { ashigaru: 80, cavalry: 20 }, levels(), 'mountains')).toMatch(/mountains/);
  });

  it('needs the clan to have the skill for a tactic', () => {
    expect(tacticBlockReason('night_raid', { ashigaru: 100 }, levels(2), 'plains')).toMatch(/Intelligence level 3/);
    expect(tacticBlockReason('night_raid', { ashigaru: 100 }, levels(3), 'plains')).toBeNull();
    expect(tacticBlockReason('pincer', { ashigaru: 200 }, levels(5), 'plains')).toMatch(/300 soldiers/);
    expect(tacticBlockReason('pincer', { ashigaru: 300 }, levels(5), 'plains')).toBeNull();
    expect(tacticBlockReason('assault', { ashigaru: 1 }, levels(), 'mountains')).toBeNull();
  });

  it('only lets a garrison hide where there is somewhere to hide', () => {
    expect(stanceBlockReason('ambush', 'plains', 500)).toMatch(/hills or mountains/);
    expect(stanceBlockReason('ambush', 'hills', 500)).toBeNull();
    expect(stanceBlockReason('reserve', 'plains', 100)).toMatch(/150/);
    expect(stanceBlockReason('formation', 'coast', 0)).toBeNull();
  });
});

describe('resolving a tactic against a stance', () => {
  it('is deterministic for a seed', () => {
    const a = resolveStrategy(input({ tactic: 'night_raid', stance: 'hold' }), 'same-seed');
    const b = resolveStrategy(input({ tactic: 'night_raid', stance: 'hold' }), 'same-seed');
    expect(a).toEqual(b);
  });

  it('always defeats a tactic the stance was made for, whatever the seed', () => {
    for (const id of TACTICS) {
      const counter = TACTIC_DEFS[id].counter;
      if (!counter) continue;
      for (const seed of ['a', 'b', 'c', 'd']) {
        const r = resolveStrategy(input({ tactic: id, stance: counter, attackerLevels: levels(20) }), seed);
        expect(r.tacticResult, id).toBe('countered');
        expect(r.stanceResult, id).toBe('countering');
        expect(r.chance).toBeNull();
        // Being countered always leaves the attacker worse off than a plain assault.
        const worse = r.attacker.attack < 0 || r.attacker.morale < 0 || r.attacker.firstRound < 0;
        expect(worse, id).toBe(true);
      }
    }
  });

  it('rewards a tactic that comes off and costs a little when it miscarries', () => {
    for (const id of TACTICS) {
      if (id === 'assault') continue;
      const won = resolveStrategy(input({ tactic: id, stance: idle(id) }), seedWhere(id, 'succeeded'));
      const better = won.attacker.attack > 0 || won.attacker.firstRound > 0 || won.attacker.siege > 0 || won.positionFactor < 1 || won.defender.morale < 0;
      expect(better, id).toBe(true);
      const lost = resolveStrategy(input({ tactic: id, stance: idle(id) }), seedWhere(id, 'failed'));
      expect(lost.attacker.morale, id).toBeLessThan(0);
      expect(lost.attacker.attack, id).toBe(0);
    }
  });

  it('weighs skill and help into the chance, within bounds', () => {
    const even = tacticChance({ tactic: 'night_raid', attackerLevels: levels(5), defenderLevels: levels(5), chanceBonus: 0 });
    const skilled = tacticChance({ tactic: 'night_raid', attackerLevels: levels(10), defenderLevels: levels(5), chanceBonus: 0 });
    const helped = tacticChance({ tactic: 'night_raid', attackerLevels: levels(5), defenderLevels: levels(5), chanceBonus: 0.1 });
    expect(even).toBeCloseTo(0.65);
    expect(skilled).toBeGreaterThan(even);
    expect(helped).toBeCloseTo(0.75);
    expect(tacticChance({ tactic: 'night_raid', attackerLevels: levels(99), defenderLevels: levels(1), chanceBonus: 1 })).toBe(0.95);
    expect(tacticChance({ tactic: 'night_raid', attackerLevels: levels(1), defenderLevels: levels(99), chanceBonus: 0 })).toBe(0.35);
    expect(tacticChance({ tactic: 'assault', attackerLevels: levels(), defenderLevels: levels(), chanceBonus: 0 })).toBe(1);
  });

  it('springs an ambush on a blind attacker and wastes it on one who scouted', () => {
    const blind = resolveStrategy(input({ stance: 'ambush' }), 's');
    expect(blind.stanceResult).toBe('sprung');
    expect(blind.defender.firstRound).toBeCloseTo(0.5);
    expect(blind.attacker.morale).toBe(-8);
    const scouted = resolveStrategy(input({ stance: 'ambush', attackerHasIntel: true }), 's');
    expect(scouted.stanceResult).toBe('revealed');
    expect(scouted.defender.firstRound).toBe(0);
    expect(scouted.defender.morale).toBe(-6);
    // Either way the garrison is outside its walls.
    expect(blind.positionFactor).toBeCloseTo(0.75);
    expect(scouted.positionFactor).toBeCloseTo(0.75);
  });

  it('makes a stance cost something when what it guards against does not come', () => {
    expect(resolveStrategy(input({ stance: 'night_watch' }), 's').defender.morale).toBe(-4);
    expect(resolveStrategy(input({ stance: 'reserve' }), 's').defender.attack).toBeCloseTo(-0.06);
    expect(resolveStrategy(input({ stance: 'hold' }), 's').defender.attack).toBeCloseTo(-0.08);
  });

  it('holds an unled garrison in a stance its land allows, stable for a seed', () => {
    for (let i = 0; i < 40; i++) {
      const plains = defaultStance('plains', 500, `p:${i}`);
      expect(plains).not.toBe('ambush');
      expect(defaultStance('plains', 500, `p:${i}`)).toBe(plains);
      expect(defaultStance('plains', 50, `p:${i}`)).not.toBe('reserve');
      expect(STANCES).toContain(defaultStance('mountains', 500, `m:${i}`));
    }
  });
});

describe('strategy in the battle engine', () => {
  const base = (positionFactor?: number): BattleInputs => ({
    rules: currentBattleRules(),
    province: { code: 'x', name: 'X', terrain: 'mountains', castleLevel: 5 },
    weather: 'clear',
    attacker: { clanId: 'a', name: 'A', units: { ...emptyUnits(), ashigaru: 900, archer: 200 }, morale: 100, mods: neutralBattleMods() },
    defender: { clanId: 'd', name: 'D', units: { ...emptyUnits(), ashigaru: 400, archer: 100 }, morale: 100, mods: neutralBattleMods() },
    ...(positionFactor === undefined ? {} : { positionFactor }),
  });

  it('fights exactly as before when no strategy is recorded', () => {
    expect(simulateBattle(base(), 'old-battle')).toEqual(simulateBattle(base(1), 'old-battle'));
  });

  it('takes the walls and the high ground away from a garrison that was drawn out', () => {
    const behindWalls = simulateBattle(base(1), 'seed-1');
    const drawnOut = simulateBattle(base(0.4), 'seed-1');
    const inTheOpen = simulateBattle(base(0), 'seed-1');
    const lost = (r: ReturnType<typeof simulateBattle>) => totalUnits(r.defender.losses) / totalUnits(r.defender.initial);
    expect(lost(drawnOut)).toBeGreaterThan(lost(behindWalls));
    expect(lost(inTheOpen)).toBeGreaterThanOrEqual(lost(drawnOut));
  });
});

describe('clan rules', () => {
  it('ranks the roles and weighs contributions', () => {
    expect(outranks('leader', 'officer')).toBe(true);
    expect(outranks('officer', 'general')).toBe(true);
    expect(outranks('general', 'treasurer')).toBe(false);
    expect(outranks('samurai', 'recruit')).toBe(true);
    expect(contributionPoints({ gold: 100, wood: 50 })).toBe(140);
    expect(contributionPoints({ iron: 10, food: 10 })).toBe(25);
  });

  it('pays a residence more as it grows and as its owner learns economy', () => {
    expect(residenceIncome(2, 1).gold).toBeGreaterThan(residenceIncome(1, 1).gold);
    expect(residenceIncome(1, 6).gold).toBeGreaterThan(residenceIncome(1, 1).gold);
    expect(residenceCost(3).gold).toBeGreaterThan(residenceCost(2).gold);
  });

  it('gives every doctrine an edge and a price, without touching what it does not name', () => {
    for (const id of DOCTRINES) {
      const def = DOCTRINE_DEFS[id];
      const values = Object.values(def.mods);
      expect(values.some((v) => v > 0), id).toBe(true);
      expect(values.some((v) => v < 0), id).toBe(true);
      const mods = applyDoctrine(emptyModifiers(), id);
      for (const [key, value] of Object.entries(mods)) {
        expect(value, `${id}.${key}`).toBeCloseTo((def.mods as Record<string, number>)[key] ?? 0);
      }
    }
    expect(applyDoctrine(emptyModifiers(), null)).toEqual(emptyModifiers());
  });
});
