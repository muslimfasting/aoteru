import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  BUILDING_TYPES,
  UNITS,
  UNIT_TYPES,
  WORLD,
  armyCapacity,
  armyPower,
  armyUpkeep,
  buildingBlockReason,
  buildingCost,
  buildingMinutes,
  emptyBuildingLevels,
  marchMinutes,
  normalizeUnits,
  provinceEfficiency,
  provinceProduction,
  recruitMinutes,
  unitBlockReason,
} from '@/game/config';
import { MAP_SIZE, NPC_CLANS, PROVINCES, PROVINCE_BY_CODE, REGIONS, findRoute } from '@/game/map';
import {
  PILLARS,
  SKILLS,
  SKILL_BY_CODE,
  applyXp,
  computeModifiers,
  emptyModifiers,
  skillBlockReason,
  xpToNext,
} from '@/game/pillars';

const noMods = { prodAll: 0, prodFood: 0, prodGold: 0, prodMaterials: 0 };

describe('map', () => {
  it('has seven regions and a 5-10 province prototype region', () => {
    expect(REGIONS).toHaveLength(7);
    expect(PROVINCES.length).toBeGreaterThanOrEqual(5);
    expect(PROVINCES.length).toBeLessThanOrEqual(10);
    expect(NPC_CLANS).toHaveLength(2);
  });

  it('adjacency is symmetric and matches shared borders', () => {
    const key = (p: readonly [number, number]) => `${p[0]},${p[1]}`;
    for (const a of PROVINCES) {
      expect(a.neighbors).not.toContain(a.code);
      for (const code of a.neighbors) {
        const b = PROVINCE_BY_CODE[code];
        expect(b, `${a.code} lists unknown neighbour ${code}`).toBeDefined();
        expect(b.neighbors, `${code} should list ${a.code}`).toContain(a.code);
      }
      // Two provinces are neighbours exactly when their polygons share an edge (two consecutive vertices).
      for (const b of PROVINCES) {
        if (a === b) continue;
        const edges = new Set(a.polygon.map((p, i) => [key(p), key(a.polygon[(i + 1) % a.polygon.length])].sort().join('|')));
        const shares = b.polygon.some((p, i) => edges.has([key(p), key(b.polygon[(i + 1) % b.polygon.length])].sort().join('|')));
        expect(shares, `${a.code}-${b.code}`).toBe(a.neighbors.includes(b.code));
      }
    }
  });

  it('keeps every province inside the map and reachable', () => {
    for (const p of PROVINCES) {
      for (const [x, y] of p.polygon) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(MAP_SIZE.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(MAP_SIZE.height);
      }
      if (p.code !== 'tanba') expect(findRoute('tanba', p.code, () => true, () => 1)).not.toBeNull();
    }
  });

  it('routes only pass through provinces the army may cross', () => {
    // Iga -> Kawachi needs Yamashiro or Yamato in between.
    expect(findRoute('iga', 'kawachi', () => false, () => 1)).toBeNull();
    expect(findRoute('iga', 'kawachi', (c) => c === 'yamato', () => 1)).toEqual(['yamato', 'kawachi']);
    expect(findRoute('iga', 'ise', () => false, () => 1)).toEqual(['ise']);
  });

  it('offers enough starting provinces for the test world', () => {
    const slots = PROVINCES.filter((p) => p.startSlot);
    expect(slots.length).toBe(5);
    for (const s of slots) expect(s.initialOwner).toBeUndefined();
  });
});

describe('economy formula', () => {
  const base = { gold: 100, food: 200, wood: 50, stone: 40, iron: 20 };

  it('production = base x building bonus x skill bonus x province efficiency', () => {
    const levels = { ...emptyBuildingLevels(), farm: 2, market: 1 };
    const out = provinceProduction(base, levels, 100, { ...noMods, prodAll: 0.1, prodFood: 0.2 });
    expect(out.food).toBe(Math.floor(200 * 1.4 * 1.3 * 1));
    expect(out.gold).toBe(Math.floor(100 * 1.2 * 1.1 * 1));
    expect(out.wood).toBe(Math.floor(50 * 1.1));
  });

  it('efficiency follows loyalty and events scale output', () => {
    expect(provinceEfficiency(0)).toBe(0.5);
    expect(provinceEfficiency(100)).toBe(1);
    const famine = provinceProduction(base, emptyBuildingLevels(), 100, noMods, { food: 0.5 });
    expect(famine.food).toBe(100);
    expect(famine.gold).toBe(100);
  });

  it('upkeep and capacity', () => {
    expect(armyUpkeep(normalizeUnits({ ashigaru: 100 }))).toEqual({ food: 20, gold: 2 });
    expect(armyUpkeep(normalizeUnits({ ashigaru: 100 }), 0.5).food).toBe(10);
    expect(armyCapacity([1])).toBe(WORLD.baseArmyCapacity + 150);
    expect(armyCapacity([2, 1], 80)).toBe(WORLD.baseArmyCapacity + 450 + 80);
    expect(armyPower(normalizeUnits({ samurai: 10 }))).toBeGreaterThan(armyPower(normalizeUnits({ ashigaru: 10 })));
  });
});

describe('buildings and units', () => {
  it('costs and times grow with level and shrink with skills', () => {
    for (const type of BUILDING_TYPES) {
      expect(buildingCost(type, 2).gold).toBeGreaterThan(buildingCost(type, 1).gold);
      expect(buildingMinutes(type, 3)).toBeGreaterThan(buildingMinutes(type, 2));
      expect(buildingCost(type, 2, 0.15).gold).toBeLessThan(buildingCost(type, 2).gold);
      expect(BUILDINGS[type].maxLevel).toBeGreaterThan(1);
    }
  });

  it('enforces building prerequisites', () => {
    const levels = { ...emptyBuildingLevels(), castle: 1 };
    expect(buildingBlockReason('farm', levels)).toBeNull();
    expect(buildingBlockReason('dojo', levels)).toMatch(/Barracks level 2/);
    expect(buildingBlockReason('farm', { ...levels, farm: 1 })).toMatch(/Citadel level 2/);
    expect(buildingBlockReason('castle', { ...levels, castle: 10 })).toMatch(/maximum/);
  });

  it('enforces unit prerequisites', () => {
    const none = emptyBuildingLevels();
    for (const t of UNIT_TYPES) expect(unitBlockReason(t, none)).not.toBeNull();
    const built = { castle: 2, farm: 1, market: 0, barracks: 2, dojo: 1 };
    expect(unitBlockReason('ashigaru', built)).toBeNull();
    expect(unitBlockReason('archer', built)).toBeNull();
    expect(unitBlockReason('samurai', built)).toBeNull();
    expect(unitBlockReason('cavalry', built)).toMatch(/Academy level 2/);
  });

  it('recruitment and marching take time', () => {
    expect(recruitMinutes('ashigaru', 100, 0)).toBeCloseTo(40);
    expect(recruitMinutes('ashigaru', 100, 5)).toBeLessThan(40);
    const foot = marchMinutes(['mountains'], normalizeUnits({ ashigaru: 10 }));
    const horse = marchMinutes(['mountains'], normalizeUnits({ cavalry: 10 }));
    expect(horse).toBeLessThan(foot);
    expect(marchMinutes(['plains'], normalizeUnits({ ashigaru: 10 }))).toBeLessThan(foot);
    expect(marchMinutes(['plains'], normalizeUnits({ cavalry: 10, samurai: 1 }))).toBeGreaterThan(marchMinutes(['plains'], normalizeUnits({ cavalry: 10 })));
    for (const t of UNIT_TYPES) expect(UNITS[t].cost.gold).toBeGreaterThan(0);
  });
});

describe('five pillars', () => {
  it('has five pillars with five skills each, including one branch choice', () => {
    expect(PILLARS).toHaveLength(5);
    for (const pillar of PILLARS) {
      const skills = SKILLS.filter((s) => s.pillar === pillar);
      expect(skills).toHaveLength(5);
      expect(skills.filter((s) => s.branch)).toHaveLength(2);
      for (const s of skills) for (const req of s.requiresSkills) expect(SKILL_BY_CODE[req.code].pillar).toBe(pillar);
    }
  });

  it('levels 1-100 with a rising XP curve', () => {
    expect(xpToNext(1)).toBe(50);
    expect(xpToNext(50)).toBeGreaterThan(xpToNext(10));
    expect(xpToNext(100)).toBe(Infinity);
    expect(applyXp(1, 0, 49)).toEqual({ level: 1, xp: 49, levelsGained: 0 });
    expect(applyXp(1, 49, 1)).toEqual({ level: 2, xp: 0, levelsGained: 1 });
    expect(applyXp(1, 0, 50 + 141 + 10)).toEqual({ level: 3, xp: 10, levelsGained: 2 });
    expect(applyXp(99, 0, 10_000_000).level).toBe(100);
  });

  it('aggregates modifiers from levels and skill ranks', () => {
    expect(computeModifiers({}, {})).toEqual(emptyModifiers());
    const mods = computeModifiers({ military: 5, economy: 3 }, { mil_tactics: 3, mil_infantry: 2, eco_agriculture: 5 });
    expect(mods.attack).toBeCloseTo(0.005 * 4 + 0.03 * 3);
    expect(mods.infantry).toBeCloseTo(0.1);
    expect(mods.prodAll).toBeCloseTo(0.01);
    expect(mods.prodFood).toBeCloseTo(0.2);
  });

  it('enforces levels, prerequisites, points and exclusive branches', () => {
    const tactics = SKILL_BY_CODE.mil_tactics;
    const spear = SKILL_BY_CODE.mil_infantry;
    const horse = SKILL_BY_CODE.mil_cavalry;
    expect(skillBlockReason(tactics, 1, 0, {})).toMatch(/No skill points/);
    expect(skillBlockReason(tactics, 1, 1, {})).toBeNull();
    expect(skillBlockReason(tactics, 9, 1, { mil_tactics: 5 })).toMatch(/mastered/);
    expect(skillBlockReason(spear, 4, 1, { mil_tactics: 3 })).toMatch(/level 5/);
    expect(skillBlockReason(spear, 5, 1, { mil_tactics: 2 })).toMatch(/Tactics rank 3/);
    expect(skillBlockReason(spear, 5, 1, { mil_tactics: 3 })).toBeNull();
    expect(skillBlockReason(horse, 5, 1, { mil_tactics: 3, mil_infantry: 1 })).toMatch(/you chose Way of the Bayonet/);
  });
});
