/**
 * The Five Pillars — the Daimyo's progression system (GDD §4).
 *
 * Each pillar levels from 1 to 100 through play. Every level grants one skill
 * point for that pillar. Skills have ranks, prerequisites and, at pillar level
 * 5, a choice between two mutually exclusive specialization branches.
 *
 * Everything a pillar or skill does is expressed as a modifier, and the server
 * reads only the aggregated `Modifiers` object when it resolves the economy,
 * battles, espionage and so on.
 */

export const PILLARS = ['military', 'leadership', 'economy', 'intelligence', 'culture'] as const;
export type PillarId = (typeof PILLARS)[number];

export const MAX_PILLAR_LEVEL = 100;

export interface Modifiers {
  /** Army damage, as a fraction (0.1 = +10%). */
  attack: number;
  /** Damage resistance for all troops. */
  toughness: number;
  /** Extra damage resistance while defending a province. */
  defense: number;
  infantry: number;
  ranged: number;
  cavalry: number;
  /** Fraction of the enemy castle bonus ignored when attacking. */
  siege: number;
  marchSpeed: number;
  /** Flat army capacity. */
  capacity: number;
  /** Flat starting morale. */
  morale: number;
  /** Flat morale removed from enemies who face this clan. */
  enemyMorale: number;
  /** Extra damage in the opening round of a battle. */
  firstRound: number;
  /** Extra attack when the clan holds a fresh scout report on the target. */
  intelAttack: number;
  prodAll: number;
  prodFood: number;
  prodGold: number;
  prodMaterials: number;
  buildCost: number;
  buildTime: number;
  upkeep: number;
  /** Flat loyalty gained per game day in every province. */
  loyaltyPerDay: number;
  popGrowth: number;
  /** Flat loyalty added to a freshly conquered province. */
  conquestLoyalty: number;
  scoutSuccess: number;
  scoutDefense: number;
  scoutCost: number;
  scoutTime: number;
  /** Extra chance to catch enemy scouts. */
  detect: number;
  /** How long scout reports stay valid, as a fraction. */
  reportDuration: number;
  warCost: number;
  festival: number;
  xpGain: number;
}

export type ModifierKey = keyof Modifiers;

export function emptyModifiers(): Modifiers {
  return {
    attack: 0, toughness: 0, defense: 0, infantry: 0, ranged: 0, cavalry: 0, siege: 0, marchSpeed: 0,
    capacity: 0, morale: 0, enemyMorale: 0, firstRound: 0, intelAttack: 0,
    prodAll: 0, prodFood: 0, prodGold: 0, prodMaterials: 0, buildCost: 0, buildTime: 0, upkeep: 0,
    loyaltyPerDay: 0, popGrowth: 0, conquestLoyalty: 0,
    scoutSuccess: 0, scoutDefense: 0, scoutCost: 0, scoutTime: 0, detect: 0, reportDuration: 0,
    warCost: 0, festival: 0, xpGain: 0,
  };
}

export interface PillarDef {
  id: PillarId;
  name: string;
  kanji: string;
  purpose: string;
  /** What each pillar level grants on its own. */
  perLevel: Partial<Modifiers>;
  perLevelText: string;
  xpSources: string[];
}

export const PILLAR_DEFS: Record<PillarId, PillarDef> = {
  military: {
    id: 'military',
    name: 'Military',
    kanji: '武',
    purpose: 'Improve military effectiveness.',
    perLevel: { attack: 0.005, toughness: 0.005 },
    perLevelText: '+0.5% army attack and toughness per level',
    xpSources: ['Recruiting soldiers', 'Fighting battles', 'Conquering provinces'],
  },
  leadership: {
    id: 'leadership',
    name: 'Leadership',
    kanji: '統',
    purpose: 'Improve command and governance.',
    perLevel: { capacity: 20, loyaltyPerDay: 0.05 },
    perLevelText: '+20 army capacity and +0.05 loyalty per day per level',
    xpSources: ['Governing provinces each hour', 'Conquering provinces'],
  },
  economy: {
    id: 'economy',
    name: 'Economy',
    kanji: '経',
    purpose: 'Improve wealth and production.',
    perLevel: { prodAll: 0.005 },
    perLevelText: '+0.5% to all production per level',
    xpSources: ['Completing buildings', 'Hourly production'],
  },
  intelligence: {
    id: 'intelligence',
    name: 'Intelligence',
    kanji: '謀',
    purpose: 'Improve strategic information and covert operations.',
    perLevel: { scoutSuccess: 0.01, detect: 0.005 },
    perLevelText: '+1% scouting success and +0.5% spy detection per level',
    xpSources: ['Scouting enemy provinces', 'Catching enemy scouts'],
  },
  culture: {
    id: 'culture',
    name: 'Culture & Wisdom',
    kanji: '文',
    purpose: 'Improve reputation, diplomacy, and influence.',
    perLevel: { loyaltyPerDay: 0.08, festival: 0.01 },
    perLevelText: '+0.08 loyalty per day and +1% festival effect per level',
    xpSources: ['Loyal provinces each hour', 'Holding festivals', 'Making peace', 'Holding the capital'],
  },
};

export interface SkillDef {
  code: string;
  pillar: PillarId;
  name: string;
  category: string;
  description: string;
  maxRank: number;
  /** Modifier gained per rank. */
  perRank: Partial<Modifiers>;
  effectText: string;
  requiresLevel: number;
  requiresSkills: { code: string; rank: number }[];
  /** Specialization branch: only one skill per branch group can be learned. */
  branch?: string;
}

export const SKILLS: SkillDef[] = [
  // ---- Military ----------------------------------------------------------
  {
    code: 'mil_tactics', pillar: 'military', name: 'Tactics', category: 'Tactics',
    description: 'Drilled formations and signals let your captains strike where the enemy line is thin.',
    maxRank: 5, perRank: { attack: 0.03 }, effectText: '+3% army attack per rank',
    requiresLevel: 1, requiresSkills: [],
  },
  {
    code: 'mil_defense', pillar: 'military', name: 'Defense', category: 'Defense',
    description: 'Palisades, kill zones and disciplined reserves make your provinces costly to take.',
    maxRank: 5, perRank: { defense: 0.04 }, effectText: '+4% toughness when defending per rank',
    requiresLevel: 2, requiresSkills: [],
  },
  {
    code: 'mil_siege', pillar: 'military', name: 'Siege Warfare', category: 'Siege Warfare',
    description: 'Sappers, ladders and fire arrows wear down castle walls.',
    maxRank: 5, perRank: { siege: 0.1 }, effectText: 'Ignore 10% of enemy castle defense per rank',
    requiresLevel: 4, requiresSkills: [{ code: 'mil_tactics', rank: 2 }],
  },
  {
    code: 'mil_infantry', pillar: 'military', name: 'Way of the Spear', category: 'Infantry Mastery',
    description: 'Your foot soldiers fight as one wall of steel.',
    maxRank: 5, perRank: { infantry: 0.05 }, effectText: '+5% infantry damage per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'mil_tactics', rank: 3 }], branch: 'military_mastery',
  },
  {
    code: 'mil_cavalry', pillar: 'military', name: 'Way of the Horse', category: 'Cavalry Mastery',
    description: 'Swift riders break lines and outrun rumours of their coming.',
    maxRank: 5, perRank: { cavalry: 0.07, marchSpeed: 0.04 }, effectText: '+7% cavalry damage and +4% march speed per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'mil_tactics', rank: 3 }], branch: 'military_mastery',
  },

  // ---- Leadership --------------------------------------------------------
  {
    code: 'lead_command', pillar: 'leadership', name: 'Command', category: 'Command',
    description: 'More captains sworn to your banner means more men you can keep in the field.',
    maxRank: 5, perRank: { capacity: 80 }, effectText: '+80 army capacity per rank',
    requiresLevel: 1, requiresSkills: [],
  },
  {
    code: 'lead_governance', pillar: 'leadership', name: 'Governance', category: 'Governance',
    description: 'Fair magistrates and honest ledgers keep the provinces content.',
    maxRank: 5, perRank: { loyaltyPerDay: 0.6 }, effectText: '+0.6 loyalty per day per rank',
    requiresLevel: 2, requiresSkills: [],
  },
  {
    code: 'lead_population', pillar: 'leadership', name: 'Population Management', category: 'Population Management',
    description: 'Land grants and irrigation draw settlers to your villages.',
    maxRank: 5, perRank: { popGrowth: 0.08 }, effectText: '+8% population growth per rank',
    requiresLevel: 3, requiresSkills: [{ code: 'lead_governance', rank: 1 }],
  },
  {
    code: 'lead_discipline', pillar: 'leadership', name: 'Iron Discipline', category: 'General Management',
    description: 'Your armies hold where others break.',
    maxRank: 5, perRank: { morale: 4 }, effectText: '+4 starting morale per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'lead_command', rank: 2 }], branch: 'leadership_rule',
  },
  {
    code: 'lead_benevolence', pillar: 'leadership', name: 'Benevolent Rule', category: 'Loyalty',
    description: 'Conquered people are treated as your own, and soon believe it.',
    maxRank: 5, perRank: { conquestLoyalty: 6 }, effectText: '+6 loyalty in newly conquered provinces per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'lead_command', rank: 2 }], branch: 'leadership_rule',
  },

  // ---- Economy -----------------------------------------------------------
  {
    code: 'eco_agriculture', pillar: 'economy', name: 'Agriculture', category: 'Agriculture',
    description: 'Better seed, terraces and water rights raise every harvest.',
    maxRank: 5, perRank: { prodFood: 0.04 }, effectText: '+4% food production per rank',
    requiresLevel: 1, requiresSkills: [],
  },
  {
    code: 'eco_taxation', pillar: 'economy', name: 'Taxation', category: 'Taxation',
    description: 'Land surveys make sure the treasury receives what it is owed.',
    maxRank: 5, perRank: { prodGold: 0.04 }, effectText: '+4% gold income per rank',
    requiresLevel: 2, requiresSkills: [],
  },
  {
    code: 'eco_infrastructure', pillar: 'economy', name: 'Infrastructure', category: 'Infrastructure',
    description: 'Roads, bridges and standing work crews make construction cheaper and faster.',
    maxRank: 5, perRank: { buildCost: 0.03, buildTime: 0.04 }, effectText: '-3% building cost and -4% build time per rank',
    requiresLevel: 3, requiresSkills: [{ code: 'eco_agriculture', rank: 1 }],
  },
  {
    code: 'eco_trade', pillar: 'economy', name: 'Trade Network', category: 'Trade',
    description: 'Merchant houses carry your goods to every harbour.',
    maxRank: 5, perRank: { prodGold: 0.05, prodMaterials: 0.03 }, effectText: '+5% gold and +3% materials per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'eco_taxation', rank: 2 }], branch: 'economy_focus',
  },
  {
    code: 'eco_resources', pillar: 'economy', name: 'Resource Management', category: 'Resource Management',
    description: 'Careful stewardship of forests, quarries and mines, and of every bowl of army rice.',
    maxRank: 5, perRank: { prodMaterials: 0.06, upkeep: 0.03 }, effectText: '+6% materials and -3% army upkeep per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'eco_taxation', rank: 2 }], branch: 'economy_focus',
  },

  // ---- Intelligence ------------------------------------------------------
  {
    code: 'int_scouting', pillar: 'intelligence', name: 'Scouting', category: 'Scouting',
    description: 'Trained eyes on every road count spears before the enemy knows they are watched.',
    maxRank: 5, perRank: { scoutSuccess: 0.06 }, effectText: '+6% scouting success per rank',
    requiresLevel: 1, requiresSkills: [],
  },
  {
    code: 'int_counter', pillar: 'intelligence', name: 'Counterintelligence', category: 'Counterintelligence',
    description: 'Checkpoints and informers make your lands dangerous for foreign spies.',
    maxRank: 5, perRank: { scoutDefense: 0.06, detect: 0.08 }, effectText: '-6% enemy scouting success and +8% detection per rank',
    requiresLevel: 2, requiresSkills: [],
  },
  {
    code: 'int_strategy', pillar: 'intelligence', name: 'Strategy', category: 'Strategy',
    description: 'A battle planned with true knowledge of the enemy is half won.',
    maxRank: 5, perRank: { intelAttack: 0.03 }, effectText: '+3% attack per rank when you hold a fresh scout report on the target',
    requiresLevel: 3, requiresSkills: [{ code: 'int_scouting', rank: 1 }],
  },
  {
    code: 'int_network', pillar: 'intelligence', name: 'Spy Network', category: 'Espionage',
    description: 'Agents in every post town work faster, cheaper and remember more.',
    maxRank: 5, perRank: { scoutCost: 0.12, scoutTime: 0.1, reportDuration: 0.2 }, effectText: '-12% scouting cost, -10% duration, +20% report lifetime per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'int_scouting', rank: 2 }], branch: 'intelligence_doctrine',
  },
  {
    code: 'int_ambush', pillar: 'intelligence', name: 'Ambush Doctrine', category: 'Sabotage',
    description: 'Your armies choose the ground and strike first.',
    maxRank: 5, perRank: { firstRound: 0.05 }, effectText: '+5% damage in the opening round per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'int_scouting', rank: 2 }], branch: 'intelligence_doctrine',
  },

  // ---- Culture & Wisdom --------------------------------------------------
  {
    code: 'cul_diplomacy', pillar: 'culture', name: 'Diplomacy', category: 'Diplomacy',
    description: 'Envoys who know the proper words make war cheaper to begin and easier to end.',
    maxRank: 5, perRank: { warCost: 0.1 }, effectText: '-10% war declaration cost per rank; rivals accept peace more readily',
    requiresLevel: 1, requiresSkills: [],
  },
  {
    code: 'cul_honor', pillar: 'culture', name: 'Honor', category: 'Honor',
    description: 'A lord who keeps his word is followed without being asked twice.',
    maxRank: 5, perRank: { loyaltyPerDay: 0.5, festival: 0.1 }, effectText: '+0.5 loyalty per day and +10% festival effect per rank',
    requiresLevel: 2, requiresSkills: [],
  },
  {
    code: 'cul_education', pillar: 'culture', name: 'Education', category: 'Education',
    description: 'Temple schools and tutors sharpen every retainer who serves you.',
    maxRank: 5, perRank: { xpGain: 0.04 }, effectText: '+4% experience for all pillars per rank',
    requiresLevel: 3, requiresSkills: [{ code: 'cul_honor', rank: 1 }],
  },
  {
    code: 'cul_influence', pillar: 'culture', name: 'Cultural Influence', category: 'Cultural Influence',
    description: 'Poets, potters and tea masters make your court the place to be.',
    maxRank: 5, perRank: { popGrowth: 0.05, loyaltyPerDay: 0.4 }, effectText: '+5% population growth and +0.4 loyalty per day per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'cul_diplomacy', rank: 2 }], branch: 'culture_legacy',
  },
  {
    code: 'cul_reputation', pillar: 'culture', name: 'Renown', category: 'Reputation',
    description: 'Your name arrives on the battlefield before your banners do.',
    maxRank: 5, perRank: { enemyMorale: 3 }, effectText: 'Enemies facing you start with -3 morale per rank',
    requiresLevel: 5, requiresSkills: [{ code: 'cul_diplomacy', rank: 2 }], branch: 'culture_legacy',
  },
];

export const SKILL_BY_CODE: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.code, s]));

export const BRANCH_NAMES: Record<string, string> = {
  military_mastery: 'Mastery',
  leadership_rule: 'Style of Rule',
  economy_focus: 'Economic Focus',
  intelligence_doctrine: 'Doctrine',
  culture_legacy: 'Legacy',
};

/** XP needed to advance from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  if (level >= MAX_PILLAR_LEVEL) return Infinity;
  return Math.floor(50 * Math.pow(level, 1.5));
}

/** Apply gained XP. Returns the new level/xp and how many levels were gained. */
export function applyXp(level: number, xp: number, gained: number): { level: number; xp: number; levelsGained: number } {
  let lvl = level;
  let pool = xp + Math.max(0, Math.floor(gained));
  let gainedLevels = 0;
  while (lvl < MAX_PILLAR_LEVEL && pool >= xpToNext(lvl)) {
    pool -= xpToNext(lvl);
    lvl += 1;
    gainedLevels += 1;
  }
  if (lvl >= MAX_PILLAR_LEVEL) pool = 0;
  return { level: lvl, xp: pool, levelsGained: gainedLevels };
}

export type PillarLevels = Record<PillarId, number>;
export type SkillRanks = Record<string, number>;

export function computeModifiers(levels: Partial<PillarLevels>, ranks: SkillRanks): Modifiers {
  const mods = emptyModifiers();
  for (const pillar of PILLARS) {
    const lvl = Math.max(0, (levels[pillar] ?? 1) - 1);
    for (const [key, value] of Object.entries(PILLAR_DEFS[pillar].perLevel) as [ModifierKey, number][]) {
      mods[key] += value * lvl;
    }
  }
  for (const skill of SKILLS) {
    const rank = Math.min(skill.maxRank, ranks[skill.code] ?? 0);
    if (rank <= 0) continue;
    for (const [key, value] of Object.entries(skill.perRank) as [ModifierKey, number][]) {
      mods[key] += value * rank;
    }
  }
  return mods;
}

/** Why a skill cannot be ranked up right now, or null if it can. */
export function skillBlockReason(
  skill: SkillDef,
  pillarLevel: number,
  points: number,
  ranks: SkillRanks,
): string | null {
  const rank = ranks[skill.code] ?? 0;
  if (rank >= skill.maxRank) return 'Already mastered';
  if (pillarLevel < skill.requiresLevel) return `Requires ${PILLAR_DEFS[skill.pillar].name} level ${skill.requiresLevel}`;
  for (const req of skill.requiresSkills) {
    if ((ranks[req.code] ?? 0) < req.rank) return `Requires ${SKILL_BY_CODE[req.code].name} rank ${req.rank}`;
  }
  if (skill.branch) {
    const rival = SKILLS.find((s) => s.branch === skill.branch && s.code !== skill.code && (ranks[s.code] ?? 0) > 0);
    if (rival) return `Locked: you chose ${rival.name}`;
  }
  if (points < 1) return 'No skill points available';
  return null;
}
