import { describe, expect, it } from 'vitest';
import {
  BATTLE_OUTCOMES,
  currentBattleRules,
  neutralBattleMods,
  rollWeather,
  simulateBattle,
  WEATHERS,
  type BattleInputs,
} from '@/game/battle';
import { normalizeUnits, totalUnits, UNIT_TYPES, type Terrain, type UnitCounts } from '@/game/config';

function inputs(attacker: Partial<UnitCounts>, defender: Partial<UnitCounts>, over: Partial<BattleInputs> = {}): BattleInputs {
  return {
    rules: currentBattleRules(),
    province: { code: 'test', name: 'Test', terrain: 'plains' as Terrain, castleLevel: 0 },
    weather: 'clear',
    attacker: { clanId: 'a', name: 'Attackers', units: normalizeUnits(attacker), morale: 100, mods: neutralBattleMods() },
    defender: { clanId: 'd', name: 'Defenders', units: normalizeUnits(defender), morale: 100, mods: neutralBattleMods() },
    ...over,
  };
}

describe('battle engine', () => {
  it('is reproducible: same inputs and seed give the identical report', () => {
    const i = inputs({ ashigaru: 300, yari: 80, archer: 60, samurai: 40 }, { ashigaru: 200, yari: 90, archer: 70, cavalry: 20 });
    const first = simulateBattle(i, 'seed-1');
    const second = simulateBattle(JSON.parse(JSON.stringify(i)), 'seed-1');
    expect(second).toEqual(first);
  });

  it('gives different rolls for different seeds', () => {
    const i = inputs({ ashigaru: 200 }, { ashigaru: 200 });
    const reports = new Set(Array.from({ length: 12 }, (_, n) => JSON.stringify(simulateBattle(i, `seed-${n}`).rounds)));
    expect(reports.size).toBeGreaterThan(1);
  });

  it('keeps the books balanced: initial = losses + remaining, never negative', () => {
    for (let n = 0; n < 60; n++) {
      const i = inputs(
        { ashigaru: 50 + n * 7, yari: n * 3, archer: n * 2, samurai: n, cavalry: n % 9 },
        { ashigaru: 80 + n * 5, yari: n * 2, archer: 40, samurai: n % 13, cavalry: n % 5 },
        { province: { code: 't', name: 'T', terrain: (['plains', 'hills', 'mountains', 'coast'] as const)[n % 4], castleLevel: n % 4 }, weather: WEATHERS[n % WEATHERS.length] },
      );
      const r = simulateBattle(i, `books-${n}`);
      expect(BATTLE_OUTCOMES).toContain(r.outcome);
      for (const side of ['attacker', 'defender'] as const) {
        for (const t of UNIT_TYPES) {
          expect(r[side].remaining[t]).toBeGreaterThanOrEqual(0);
          expect(r[side].losses[t] + r[side].remaining[t]).toBe(i[side].units[t]);
        }
        const perRound = r.rounds.reduce((s, round) => s + totalUnits(side === 'attacker' ? round.attackerLosses : round.defenderLosses), 0);
        const pursuit = r.pursuit.side === side ? totalUnits(r.pursuit.losses) : 0;
        expect(perRound + pursuit).toBe(totalUnits(r[side].losses));
      }
    }
  });

  it('the attacker only ever wins with men left standing', () => {
    for (let n = 0; n < 80; n++) {
      const r = simulateBattle(inputs({ ashigaru: 30 + n * 4 }, { ashigaru: 150, archer: 30 }), `win-${n}`);
      if (r.winner === 'attacker') {
        expect(totalUnits(r.attacker.remaining)).toBeGreaterThan(0);
        expect(['victory', 'decisive_victory']).toContain(r.outcome);
      } else {
        expect(['draw', 'defeat', 'retreat']).toContain(r.outcome);
      }
    }
  });

  it('an undefended province falls without a fight', () => {
    const r = simulateBattle(inputs({ ashigaru: 10 }, {}), 's');
    expect(r.outcome).toBe('decisive_victory');
    expect(r.rounds).toHaveLength(0);
    expect(totalUnits(r.attacker.losses)).toBe(0);
  });

  it('castles and mountains favour the defender', () => {
    const wins = (terrain: Terrain, castleLevel: number) => {
      let w = 0;
      for (let n = 0; n < 100; n++) {
        const r = simulateBattle(inputs({ ashigaru: 260 }, { ashigaru: 200 }, { province: { code: 't', name: 'T', terrain, castleLevel } }), `fort-${n}`);
        if (r.winner === 'attacker') w++;
      }
      return w;
    };
    expect(wins('plains', 0)).toBeGreaterThan(wins('mountains', 3));
  });

  it('yari blunt a cavalry charge better than ashigaru of equal cost', () => {
    const lossesAgainst = (defender: Partial<UnitCounts>) => {
      let lost = 0;
      for (let n = 0; n < 60; n++) lost += totalUnits(simulateBattle(inputs({ cavalry: 100 }, defender), `cav-${n}`).attacker.losses);
      return lost;
    };
    // 200 yari and 300 ashigaru both cost 3600 gold.
    expect(lossesAgainst({ yari: 200 })).toBeGreaterThan(lossesAgainst({ ashigaru: 300 }));
  });

  it('commander bonuses matter', () => {
    const base = inputs({ ashigaru: 200 }, { ashigaru: 200 });
    const boosted: BattleInputs = { ...base, attacker: { ...base.attacker, mods: { ...neutralBattleMods(), attack: 0.3 } } };
    let plain = 0;
    let better = 0;
    for (let n = 0; n < 100; n++) {
      if (simulateBattle(base, `cmd-${n}`).winner === 'attacker') plain++;
      if (simulateBattle(boosted, `cmd-${n}`).winner === 'attacker') better++;
    }
    expect(better).toBeGreaterThan(plain);
  });

  it('weather is derived from the seed', () => {
    expect(rollWeather('abc')).toBe(rollWeather('abc'));
    expect(WEATHERS).toContain(rollWeather('xyz'));
  });
});
