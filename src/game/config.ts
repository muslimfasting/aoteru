/**
 * Game rules and balance data.
 *
 * This file is pure data + pure functions and is shared by the server (which is
 * the only authority) and the client (which uses it for labels and previews).
 * Nothing the client computes from it is ever trusted by the server.
 */

export const GAME_NAME = 'Aoteru';
export const GAME_SUBTITLE = 'Rise of Japan';
export const GAME_TAGLINE = 'Serve the Nation. Master the Art of War. Reunify Japan.';

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export const RESOURCE_KEYS = ['gold', 'food', 'wood', 'stone', 'iron'] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type ResourceBag = Record<ResourceKey, number>;

export const RESOURCE_INFO: Record<ResourceKey, { name: string; kanji: string; purpose: string }> = {
  gold: { name: 'Gold', kanji: '金', purpose: 'Economy and payments' },
  food: { name: 'Food', kanji: '米', purpose: 'Population and army upkeep' },
  wood: { name: 'Wood', kanji: '木', purpose: 'Construction' },
  stone: { name: 'Stone', kanji: '石', purpose: 'Infrastructure and defense' },
  iron: { name: 'Iron', kanji: '鉄', purpose: 'Weapons and military equipment' },
};

export function emptyBag(): ResourceBag {
  return { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
}

export function addBags(a: Partial<ResourceBag>, b: Partial<ResourceBag>): ResourceBag {
  const out = emptyBag();
  for (const k of RESOURCE_KEYS) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  return out;
}

export function scaleBag(a: Partial<ResourceBag>, factor: number): ResourceBag {
  const out = emptyBag();
  for (const k of RESOURCE_KEYS) out[k] = Math.ceil((a[k] ?? 0) * factor);
  return out;
}

export function canAfford(have: ResourceBag, cost: Partial<ResourceBag>): boolean {
  return RESOURCE_KEYS.every((k) => have[k] >= (cost[k] ?? 0));
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export type Terrain = 'plains' | 'hills' | 'mountains' | 'coast';

export const TERRAIN_INFO: Record<
  Terrain,
  { name: string; defense: number; travel: number; cavalry: number; note: string }
> = {
  plains: { name: 'Plains', defense: 1.0, travel: 1.0, cavalry: 1.0, note: 'Open ground. Cavalry charges at full strength.' },
  coast: { name: 'Coast', defense: 1.05, travel: 1.1, cavalry: 0.95, note: 'Harbours and river mouths slow a marching column.' },
  hills: { name: 'Hills', defense: 1.15, travel: 1.3, cavalry: 0.85, note: 'Broken ground favours the defender.' },
  mountains: { name: 'Mountains', defense: 1.3, travel: 1.6, cavalry: 0.7, note: 'Narrow passes. Defenders hold a strong advantage.' },
};

export const WORLD = {
  /** One world tick is one game hour. */
  ticksPerDay: 24,
  startingResources: { gold: 1200, food: 1500, wood: 1000, stone: 700, iron: 250 } as ResourceBag,
  startingGarrison: { ashigaru: 80, yari: 30 } as Partial<Record<UnitType, number>>,
  startingLoyalty: 70,
  /** New clans cannot be attacked for this many game hours. */
  protectionHours: 24,
  baseArmyCapacity: 400,
  /** Food eaten per person per game hour. */
  populationFoodPerHour: 0.01,
  /** Provinces needed to be proclaimed hegemon of the region (prototype victory). */
  hegemonyProvinces: 6,
  /** Game minutes a battle rages before it is resolved. */
  battleMinutes: 20,
  /** Base game minutes to march across one province border. */
  marchMinutesPerBorder: 45,
  /** Marching armies carry this multiple of their upkeep as campaign supplies. */
  marchSupplyFactor: 2,
  warDeclarationCost: 300,
  /** Game hours before a new war can be declared on the same clan after peace. */
  truceHours: 12,
  conqueredLoyalty: 30,
  festival: {
    cost: { gold: 250, food: 300 } as Partial<ResourceBag>,
    loyalty: 10,
    cooldownHours: 24,
    cultureXp: 40,
  },
  scout: {
    cost: 120,
    minutes: 30,
    baseSuccess: 0.6,
    baseDetection: 0.35,
    reportHours: 24,
  },
  maxChatLength: 280,
} as const;

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export const BUILDING_TYPES = ['castle', 'farm', 'market', 'barracks', 'dojo'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export interface BuildingDef {
  type: BuildingType;
  name: string;
  kanji: string;
  role: string;
  description: string;
  maxLevel: number;
  baseCost: Partial<ResourceBag>;
  costGrowth: number;
  /** Game minutes for the first level. */
  baseMinutes: number;
  timeGrowth: number;
  /** Other buildings that must exist in the province before this one. */
  requires: Partial<Record<BuildingType, number>>;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  castle: {
    type: 'castle',
    name: 'Citadel',
    kanji: '城',
    role: 'Headquarters and defense',
    description: 'Seat of the provincial government behind its old walls. Strengthens defenders, raises army capacity and caps every other building.',
    maxLevel: 10,
    baseCost: { gold: 400, wood: 300, stone: 400, iron: 50 },
    costGrowth: 1.7,
    baseMinutes: 30,
    timeGrowth: 1.5,
    requires: {},
  },
  farm: {
    type: 'farm',
    name: 'Farm',
    kanji: '田',
    role: 'Food production',
    description: 'Paddies and granaries. Each level adds 20% to the province food harvest.',
    maxLevel: 10,
    baseCost: { gold: 80, wood: 150, stone: 40 },
    costGrowth: 1.55,
    baseMinutes: 8,
    timeGrowth: 1.45,
    requires: {},
  },
  market: {
    type: 'market',
    name: 'Market',
    kanji: '市',
    role: 'Gold generation',
    description: 'Merchants and toll gates. Each level adds 20% to the province gold income.',
    maxLevel: 10,
    baseCost: { gold: 150, wood: 180, stone: 80 },
    costGrowth: 1.55,
    baseMinutes: 10,
    timeGrowth: 1.45,
    requires: {},
  },
  barracks: {
    type: 'barracks',
    name: 'Barracks',
    kanji: '兵',
    role: 'Army recruitment',
    description: 'Musters militia and line infantry. Level 2 trains riflemen. Each level speeds recruitment by 4%.',
    maxLevel: 10,
    baseCost: { gold: 200, wood: 250, stone: 120, iron: 40 },
    costGrowth: 1.55,
    baseMinutes: 12,
    timeGrowth: 1.45,
    requires: {},
  },
  dojo: {
    type: 'dojo',
    name: 'Academy',
    kanji: '道',
    role: 'Military training',
    description: 'The military academy trains the Guards; level 2 trains cavalry. Each level steels the local garrison (+4 morale).',
    maxLevel: 10,
    baseCost: { gold: 350, wood: 300, stone: 200, iron: 120 },
    costGrowth: 1.55,
    baseMinutes: 20,
    timeGrowth: 1.45,
    requires: { barracks: 2 },
  },
};

export const BUILDING_EFFECTS = {
  castleDefensePerLevel: 0.15,
  castleCapacityPerLevel: 150,
  farmFoodPerLevel: 0.2,
  marketGoldPerLevel: 0.2,
  barracksRecruitSpeedPerLevel: 0.04,
  dojoMoralePerLevel: 4,
  populationCapBase: 3000,
  populationCapPerDevelopment: 600,
} as const;

export type BuildingLevels = Record<BuildingType, number>;

export function emptyBuildingLevels(): BuildingLevels {
  return { castle: 0, farm: 0, market: 0, barracks: 0, dojo: 0 };
}

/** Cost to raise a building from `toLevel - 1` to `toLevel`. */
export function buildingCost(type: BuildingType, toLevel: number, costMod = 0): ResourceBag {
  const def = BUILDINGS[type];
  const factor = Math.pow(def.costGrowth, toLevel - 1) * Math.max(0.4, 1 - costMod);
  const out = emptyBag();
  for (const k of RESOURCE_KEYS) out[k] = Math.round(((def.baseCost[k] ?? 0) * factor) / 5) * 5;
  return out;
}

/** Game minutes to raise a building to `toLevel`. */
export function buildingMinutes(type: BuildingType, toLevel: number, timeMod = 0): number {
  const def = BUILDINGS[type];
  return def.baseMinutes * Math.pow(def.timeGrowth, toLevel - 1) * Math.max(0.3, 1 - timeMod);
}

/** Why a building cannot be upgraded right now (ignoring resources), or null. */
export function buildingBlockReason(type: BuildingType, levels: BuildingLevels): string | null {
  const def = BUILDINGS[type];
  const next = levels[type] + 1;
  if (next > def.maxLevel) return 'Already at maximum level';
  if (type !== 'castle' && next > levels.castle) {
    return `Requires ${BUILDINGS.castle.name} level ${next}`;
  }
  for (const [req, lvl] of Object.entries(def.requires) as [BuildingType, number][]) {
    if (levels[req] < lvl) return `Requires ${BUILDINGS[req].name} level ${lvl}`;
  }
  return null;
}

export function buildingEffectText(type: BuildingType, level: number): string {
  if (level <= 0) return 'Not built';
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  switch (type) {
    case 'castle':
      return `+${pct(level * BUILDING_EFFECTS.castleDefensePerLevel)} defense, +${level * BUILDING_EFFECTS.castleCapacityPerLevel} army capacity`;
    case 'farm':
      return `+${pct(level * BUILDING_EFFECTS.farmFoodPerLevel)} food`;
    case 'market':
      return `+${pct(level * BUILDING_EFFECTS.marketGoldPerLevel)} gold`;
    case 'barracks':
      return `${level >= 2 ? 'Militia, Line Infantry, Riflemen' : 'Militia, Line Infantry'} · ${pct(level * BUILDING_EFFECTS.barracksRecruitSpeedPerLevel)} faster muster`;
    case 'dojo':
      return `${level >= 2 ? 'Guards, Cavalry' : 'Guards'} · +${level * BUILDING_EFFECTS.dojoMoralePerLevel} garrison morale`;
  }
}

export function populationCap(developmentLevel: number): number {
  return BUILDING_EFFECTS.populationCapBase + developmentLevel * BUILDING_EFFECTS.populationCapPerDevelopment;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export const UNIT_TYPES = ['ashigaru', 'yari', 'archer', 'samurai', 'cavalry'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];
export type UnitClass = 'infantry' | 'ranged' | 'cavalry';
export type UnitCounts = Record<UnitType, number>;

export interface UnitDef {
  type: UnitType;
  name: string;
  kanji: string;
  role: string;
  class: UnitClass;
  attack: number;
  defense: number;
  hp: number;
  /** March speed multiplier; an army moves at the pace of its slowest unit. */
  speed: number;
  cost: Partial<ResourceBag>;
  /** Game minutes to train one soldier. */
  recruitMinutes: number;
  /** Per soldier per game hour. */
  upkeep: { food: number; gold: number };
  requires: Partial<Record<BuildingType, number>>;
  /** Damage multiplier against specific enemy unit types. */
  bonusVs: Partial<Record<UnitType, number>>;
  /** How much of the incoming damage this unit soaks relative to its numbers. */
  frontline: number;
  /** Military XP per soldier recruited. */
  xp: number;
}

/**
 * The five kinds of soldier. The world has rebuilt itself to roughly the age
 * of steam and telegraph, and its armies look the part: conscript militia,
 * drilled line infantry who form square against horse, riflemen, the Guards
 * and cavalry. The type ids are older than the names and are kept as they are
 * (they are stored with every army); only `name` is shown to players, and it
 * is already a collective noun — never append an "s".
 */
export const UNITS: Record<UnitType, UnitDef> = {
  ashigaru: {
    type: 'ashigaru',
    name: 'Militia',
    kanji: '足',
    role: 'Affordable infantry',
    class: 'infantry',
    attack: 8,
    defense: 6,
    hp: 20,
    speed: 1.0,
    cost: { gold: 12, food: 8, wood: 4 },
    recruitMinutes: 0.4,
    upkeep: { food: 0.2, gold: 0.02 },
    requires: { barracks: 1 },
    bonusVs: {},
    frontline: 1.0,
    xp: 0.2,
  },
  yari: {
    type: 'yari',
    name: 'Line Infantry',
    kanji: '槍',
    role: 'Anti-cavalry',
    class: 'infantry',
    attack: 9,
    defense: 10,
    hp: 24,
    speed: 0.95,
    cost: { gold: 18, food: 10, wood: 10, iron: 2 },
    recruitMinutes: 0.6,
    upkeep: { food: 0.25, gold: 0.04 },
    requires: { barracks: 1 },
    bonusVs: { cavalry: 1.8 },
    frontline: 1.1,
    xp: 0.3,
  },
  archer: {
    type: 'archer',
    name: 'Riflemen',
    kanji: '弓',
    role: 'Ranged attack',
    class: 'ranged',
    attack: 12,
    defense: 4,
    hp: 16,
    speed: 1.0,
    cost: { gold: 22, food: 10, wood: 12, iron: 1 },
    recruitMinutes: 0.8,
    upkeep: { food: 0.25, gold: 0.06 },
    requires: { barracks: 2 },
    bonusVs: { ashigaru: 1.25, yari: 1.3 },
    frontline: 0.5,
    xp: 0.35,
  },
  samurai: {
    type: 'samurai',
    name: 'Guards',
    kanji: '侍',
    role: 'Elite infantry',
    class: 'infantry',
    attack: 20,
    defense: 16,
    hp: 36,
    speed: 0.9,
    cost: { gold: 48, food: 20, iron: 14 },
    recruitMinutes: 2.0,
    upkeep: { food: 0.5, gold: 0.25 },
    requires: { dojo: 1 },
    bonusVs: { ashigaru: 1.2 },
    frontline: 1.2,
    xp: 0.8,
  },
  cavalry: {
    type: 'cavalry',
    name: 'Cavalry',
    kanji: '騎',
    role: 'Mobility and charge',
    class: 'cavalry',
    attack: 22,
    defense: 10,
    hp: 34,
    speed: 1.6,
    cost: { gold: 60, food: 30, iron: 8 },
    recruitMinutes: 2.5,
    upkeep: { food: 0.8, gold: 0.3 },
    requires: { dojo: 2 },
    bonusVs: { archer: 1.7, ashigaru: 1.3 },
    frontline: 0.8,
    xp: 1.0,
  },
};

export function emptyUnits(): UnitCounts {
  return { ashigaru: 0, yari: 0, archer: 0, samurai: 0, cavalry: 0 };
}

export function normalizeUnits(input: Partial<Record<string, number>> | null | undefined): UnitCounts {
  const out = emptyUnits();
  if (!input) return out;
  for (const t of UNIT_TYPES) {
    const v = Number(input[t] ?? 0);
    out[t] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }
  return out;
}

export function totalUnits(units: Partial<UnitCounts>): number {
  let n = 0;
  for (const t of UNIT_TYPES) n += units[t] ?? 0;
  return n;
}

export function addUnits(a: Partial<UnitCounts>, b: Partial<UnitCounts>): UnitCounts {
  const out = emptyUnits();
  for (const t of UNIT_TYPES) out[t] = (a[t] ?? 0) + (b[t] ?? 0);
  return out;
}

/** A single comparable strength score, used for displays, intel bands and NPC decisions. */
export function armyPower(units: Partial<UnitCounts>): number {
  let p = 0;
  for (const t of UNIT_TYPES) {
    const d = UNITS[t];
    p += ((units[t] ?? 0) * (d.attack + d.defense) * d.hp) / 40;
  }
  return Math.round(p);
}

export function unitCost(type: UnitType, count: number): ResourceBag {
  const out = emptyBag();
  for (const k of RESOURCE_KEYS) out[k] = Math.ceil((UNITS[type].cost[k] ?? 0) * count);
  return out;
}

/** Game minutes to train `count` soldiers. */
export function recruitMinutes(type: UnitType, count: number, barracksLevel: number): number {
  const speed = 1 - Math.min(0.6, barracksLevel * BUILDING_EFFECTS.barracksRecruitSpeedPerLevel);
  return UNITS[type].recruitMinutes * count * speed;
}

export function unitBlockReason(type: UnitType, levels: BuildingLevels): string | null {
  for (const [req, lvl] of Object.entries(UNITS[type].requires) as [BuildingType, number][]) {
    if (levels[req] < lvl) return `Requires ${BUILDINGS[req].name} level ${lvl}`;
  }
  if (type === 'archer' && levels.barracks < 2) return 'Requires Barracks level 2';
  return null;
}

/** Hourly upkeep for a body of troops. `upkeepMod` is the fractional reduction from skills. */
export function armyUpkeep(units: Partial<UnitCounts>, upkeepMod = 0): { food: number; gold: number } {
  let food = 0;
  let gold = 0;
  for (const t of UNIT_TYPES) {
    food += (units[t] ?? 0) * UNITS[t].upkeep.food;
    gold += (units[t] ?? 0) * UNITS[t].upkeep.gold;
  }
  const f = Math.max(0.4, 1 - upkeepMod);
  return { food: Math.round(food * f), gold: Math.round(gold * f) };
}

export function armySpeed(units: Partial<UnitCounts>): number {
  let slowest = Infinity;
  for (const t of UNIT_TYPES) if ((units[t] ?? 0) > 0) slowest = Math.min(slowest, UNITS[t].speed);
  return Number.isFinite(slowest) ? slowest : 1;
}

/** Game minutes to march through the given destination terrains (one per border crossed). */
export function marchMinutes(terrains: Terrain[], units: Partial<UnitCounts>, speedMod = 0): number {
  const base = terrains.reduce((sum, t) => sum + WORLD.marchMinutesPerBorder * TERRAIN_INFO[t].travel, 0);
  return base / (armySpeed(units) * (1 + speedMod));
}

/** Food an army must draw from the stores before it marches. */
export function marchSupplies(units: Partial<UnitCounts>, minutes: number): number {
  const hourly = armyUpkeep(units).food;
  return Math.ceil(hourly * (minutes / 60) * WORLD.marchSupplyFactor);
}

export function armyCapacity(castleLevels: number[], capacityMod = 0): number {
  const castles = castleLevels.reduce((s, l) => s + l * BUILDING_EFFECTS.castleCapacityPerLevel, 0);
  return Math.floor(WORLD.baseArmyCapacity + castles + capacityMod);
}

// ---------------------------------------------------------------------------
// Economy formula (GDD 5.4)
//   Hourly production = Base × Building Bonus × Economy Skill Bonus × Province Efficiency
// ---------------------------------------------------------------------------

export interface ProductionMods {
  prodAll: number;
  prodFood: number;
  prodGold: number;
  prodMaterials: number;
}

/** Province efficiency rises with loyalty: 50% at 0 loyalty, 100% at 100. */
export function provinceEfficiency(loyalty: number): number {
  return 0.5 + Math.max(0, Math.min(100, loyalty)) / 200;
}

export function provinceProduction(
  base: ResourceBag,
  levels: BuildingLevels,
  loyalty: number,
  mods: ProductionMods,
  eventMultipliers: Partial<ResourceBag> = {},
): ResourceBag {
  const eff = provinceEfficiency(loyalty);
  const building: ResourceBag = {
    food: 1 + levels.farm * BUILDING_EFFECTS.farmFoodPerLevel,
    gold: 1 + levels.market * BUILDING_EFFECTS.marketGoldPerLevel,
    wood: 1,
    stone: 1,
    iron: 1,
  };
  const skill: ResourceBag = {
    food: 1 + mods.prodAll + mods.prodFood,
    gold: 1 + mods.prodAll + mods.prodGold,
    wood: 1 + mods.prodAll + mods.prodMaterials,
    stone: 1 + mods.prodAll + mods.prodMaterials,
    iron: 1 + mods.prodAll + mods.prodMaterials,
  };
  const out = emptyBag();
  for (const k of RESOURCE_KEYS) {
    out[k] = Math.floor(base[k] * building[k] * skill[k] * eff * (eventMultipliers[k] ?? 1));
  }
  return out;
}

export function populationFood(population: number): number {
  return Math.round(population * WORLD.populationFoodPerHour);
}

// ---------------------------------------------------------------------------
// Intelligence bands
// ---------------------------------------------------------------------------

export function strengthLabel(power: number): string {
  if (power <= 0) return 'Undefended';
  if (power < 700) return 'Token guard';
  if (power < 1600) return 'Light garrison';
  if (power < 3200) return 'Moderate force';
  if (power < 6500) return 'Strong host';
  return 'Formidable host';
}

// ---------------------------------------------------------------------------
// Clan identity
// ---------------------------------------------------------------------------

export const BANNER_COLORS = [
  { id: 'crimson', name: 'Crimson', hex: '#9b2d30' },
  { id: 'indigo', name: 'Indigo', hex: '#31487a' },
  { id: 'pine', name: 'Pine', hex: '#2f6b4f' },
  { id: 'ochre', name: 'Ochre', hex: '#b8862f' },
  { id: 'wisteria', name: 'Wisteria', hex: '#6a4a85' },
  { id: 'teal', name: 'Teal', hex: '#2a7377' },
  { id: 'rust', name: 'Rust', hex: '#a4532a' },
  { id: 'plum', name: 'Plum', hex: '#8a3a62' },
  { id: 'slate', name: 'Slate', hex: '#4a5568' },
  { id: 'moss', name: 'Moss', hex: '#6b7a2f' },
] as const;
export type BannerColorId = (typeof BANNER_COLORS)[number]['id'];

export const BANNER_MONS = [
  { id: 'tomoe', name: 'Tomoe' },
  { id: 'diamonds', name: 'Four Diamonds' },
  { id: 'bars', name: 'Twin Bars' },
  { id: 'ring', name: 'Ring' },
  { id: 'blossom', name: 'Blossom' },
  { id: 'peaks', name: 'Three Peaks' },
  { id: 'crescent', name: 'Crescent' },
  { id: 'waves', name: 'Waves' },
] as const;
export type BannerMonId = (typeof BANNER_MONS)[number]['id'];

export const PORTRAITS = [
  { id: 'general', name: 'The General' },
  { id: 'strategist', name: 'The Strategist' },
  { id: 'steward', name: 'The Steward' },
  { id: 'shadow', name: 'The Shadow' },
  { id: 'sage', name: 'The Sage' },
  { id: 'lady', name: 'The Lady of War' },
] as const;
export type PortraitId = (typeof PORTRAITS)[number]['id'];

export function bannerHex(colorId: string): string {
  return BANNER_COLORS.find((c) => c.id === colorId)?.hex ?? '#6b6257';
}

export const NAME_RULES = {
  nickname: { min: 3, max: 20, pattern: /^[A-Za-z0-9_\-]+$/ },
  clanName: { min: 3, max: 24, pattern: /^[A-Za-z0-9' \-]+$/ },
  daimyoName: { min: 2, max: 28, pattern: /^[A-Za-z0-9' \-]+$/ },
  passwordMin: 8,
} as const;
