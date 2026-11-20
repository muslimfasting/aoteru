/**
 * How a nation is governed: offices, permissions, cabinet seats and the personal economy.
 *
 * The factions of the game are nations with governments, and players are their
 * officials. (The code keeps the older word "clan" for a faction throughout.)
 * Shared by server and client; pure data and pure functions.
 */
import type { ResourceBag, ResourceKey } from './config';
import type { Modifiers, PillarId } from './pillars';

// ---------------------------------------------------------------------------
// Roles (change request §2.4)
// ---------------------------------------------------------------------------

export const CLAN_ROLES = ['leader', 'officer', 'general', 'strategist', 'intelligence', 'treasurer', 'samurai', 'recruit'] as const;
export type ClanRole = (typeof CLAN_ROLES)[number];

export interface RoleDef {
  id: ClanRole;
  /** Title shown in the interface. */
  name: string;
  /** Higher outranks lower. A member can only manage members of lower rank. */
  rank: number;
  summary: string;
  /** The pillar this seat lends to the whole clan (see `SEAT_OF_PILLAR`). */
  seat: PillarId | null;
}

export const ROLE_DEFS: Record<ClanRole, RoleDef> = {
  leader: { id: 'leader', name: 'Chancellor', rank: 100, summary: 'Heads the government. May do everything.', seat: 'leadership' },
  officer: { id: 'officer', name: 'Minister of State', rank: 80, summary: 'Runs appointments, the army and foreign affairs for the Chancellor.', seat: 'culture' },
  general: { id: 'general', name: 'General', rank: 60, summary: 'Raises troops and commands the armies.', seat: 'military' },
  strategist: { id: 'strategist', name: 'Chief of Staff', rank: 60, summary: 'Draws up the war plans.', seat: null },
  intelligence: { id: 'intelligence', name: 'Director of Intelligence', rank: 60, summary: 'Runs scouts and spies.', seat: 'intelligence' },
  treasurer: { id: 'treasurer', name: 'Minister of Finance', rank: 60, summary: 'Keeps the treasury and pays for the public works.', seat: 'economy' },
  samurai: { id: 'samurai', name: 'Official', rank: 20, summary: 'A sworn official of the nation.', seat: null },
  recruit: { id: 'recruit', name: 'Clerk', rank: 10, summary: 'Newly appointed, still proving themselves.', seat: null },
};

/**
 * The cabinet. Each pillar of the nation is carried by the official holding the
 * matching seat — or by the Chancellor, whichever is stronger in it. A
 * government of specialists is therefore stronger than one person trying to
 * master everything.
 */
export const SEAT_OF_PILLAR: Record<PillarId, ClanRole> = {
  leadership: 'leader',
  military: 'general',
  economy: 'treasurer',
  intelligence: 'intelligence',
  culture: 'officer',
};

// ---------------------------------------------------------------------------
// Permissions (§2.4: configurable per role)
// ---------------------------------------------------------------------------

export const CLAN_PERMISSIONS = ['manage_members', 'manage_clan', 'build', 'recruit', 'command', 'war_plans', 'diplomacy', 'espionage', 'treasury'] as const;
export type ClanPermission = (typeof CLAN_PERMISSIONS)[number];

export const PERMISSION_DEFS: Record<ClanPermission, { name: string; summary: string }> = {
  manage_members: { name: 'Appointments', summary: 'Invite players, answer applications, appoint officials and dismiss those of lower rank.' },
  manage_clan: { name: 'Nation profile', summary: 'Edit the description and recruitment settings, post announcements.' },
  build: { name: 'Construction', summary: 'Upgrade buildings and hold festivals with treasury resources.' },
  recruit: { name: 'Recruitment', summary: 'Recruit troops with treasury resources.' },
  command: { name: 'Command', summary: 'Move armies and launch attacks.' },
  war_plans: { name: 'War council', summary: 'Create war plans, choose strategies and assign officials.' },
  diplomacy: { name: 'Diplomacy', summary: 'Declare war, and propose or answer treaties.' },
  espionage: { name: 'Intelligence', summary: 'Send scouts and run intelligence operations.' },
  treasury: { name: 'Treasury', summary: 'Pay out treasury resources to officials.' },
};

export const DEFAULT_ROLE_PERMISSIONS: Record<ClanRole, readonly ClanPermission[]> = {
  leader: CLAN_PERMISSIONS,
  officer: ['manage_members', 'manage_clan', 'build', 'recruit', 'command', 'war_plans', 'diplomacy', 'espionage'],
  general: ['recruit', 'command', 'war_plans'],
  strategist: ['war_plans'],
  intelligence: ['espionage'],
  treasurer: ['treasury', 'build'],
  samurai: [],
  recruit: [],
};

/** Roles whose permissions the leader can edit (the leader's own are fixed). */
export const CONFIGURABLE_ROLES = CLAN_ROLES.filter((r) => r !== 'leader');

export function outranks(a: ClanRole, b: ClanRole): boolean {
  return ROLE_DEFS[a].rank > ROLE_DEFS[b].rank;
}

// ---------------------------------------------------------------------------
// Recruitment, language, limits
// ---------------------------------------------------------------------------

export const RECRUITMENT_MODES = ['open', 'application', 'invite', 'closed'] as const;
export type RecruitmentMode = (typeof RECRUITMENT_MODES)[number];

export const RECRUITMENT_DEFS: Record<RecruitmentMode, { name: string; summary: string }> = {
  open: { name: 'Open', summary: 'Anyone may join at once.' },
  application: { name: 'Application', summary: 'Players apply; the nation decides.' },
  invite: { name: 'Invitation only', summary: 'Only invited players may join.' },
  closed: { name: 'Closed', summary: 'Not taking new members.' },
};

export const CLAN_LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'id', name: 'Bahasa Indonesia' },
  { id: 'ja', name: 'Japanese' },
  { id: 'es', name: 'Spanish' },
  { id: 'other', name: 'Other' },
] as const;
export type ClanLanguage = (typeof CLAN_LANGUAGES)[number]['id'];

export const CLAN_RULES = {
  tag: { min: 2, max: 5, pattern: /^[A-Za-z0-9]+$/ },
  descriptionMax: 400,
  announcementMax: 400,
  applicationMessageMax: 200,
  maxMembers: 30,
} as const;

// ---------------------------------------------------------------------------
// Personal economy (§4.1) and contributions (§4.4)
// ---------------------------------------------------------------------------

export const PERSONAL = {
  /** What a new player arrives with. */
  startingPurse: { gold: 300, food: 200, wood: 150, stone: 100, iron: 50 } as ResourceBag,
  maxResidenceLevel: 10,
  /** Economy XP per 100 contribution points paid into the treasury. */
  contributionXpPer100: 6,
} as const;

/** What one unit of each resource is worth when weighing a member's contribution. */
export const CONTRIBUTION_WEIGHT: Record<ResourceKey, number> = { gold: 1, food: 0.5, wood: 0.8, stone: 1, iron: 2 };

export function contributionPoints(bag: Partial<ResourceBag>): number {
  let total = 0;
  for (const k of Object.keys(CONTRIBUTION_WEIGHT) as ResourceKey[]) total += (bag[k] ?? 0) * CONTRIBUTION_WEIGHT[k];
  return Math.floor(total);
}

/**
 * Hourly income of a member's residence: a stipend that grows with the
 * residence and with the member's own Economy pillar. Only members of a clan
 * that still holds land are paid.
 */
export function residenceIncome(level: number, economyLevel: number): ResourceBag {
  const mult = 1 + Math.max(0, economyLevel - 1) * 0.03;
  const r = (n: number) => Math.round(n * mult);
  return {
    gold: r(10 + level * 6),
    food: r(8 + level * 5),
    wood: r(5 + level * 4),
    stone: r(3 + level * 3),
    iron: r(1 + level * 1.5),
  };
}

/** Cost to raise a residence to `toLevel`, paid from the personal purse. */
export function residenceCost(toLevel: number): ResourceBag {
  const f = Math.pow(1.55, toLevel - 2);
  return {
    gold: Math.round(180 * f),
    food: Math.round(60 * f),
    wood: Math.round(140 * f),
    stone: Math.round(90 * f),
    iron: Math.round(20 * f),
  };
}

/** A player's overall level: the sum of their pillar levels above the first. */
export function playerLevel(pillarLevels: Record<PillarId, number>): number {
  return 1 + Object.values(pillarLevels).reduce((sum, l) => sum + (l - 1), 0);
}

// ---------------------------------------------------------------------------
// Doctrine (§10): the clan's way of war. An edge, never a restriction.
// ---------------------------------------------------------------------------

export const DOCTRINES = ['aggressive', 'defensive', 'intelligence', 'diplomatic'] as const;
export type DoctrineId = (typeof DOCTRINES)[number];

export interface DoctrineDef {
  id: DoctrineId;
  name: string;
  motto: string;
  summary: string;
  /** Added to the clan's modifiers. */
  mods: Partial<Modifiers>;
  /** Added to the chance that the clan's tactics come off. */
  tacticChance: number;
  /** Plain list of what it gives and what it costs. */
  effects: string[];
}

export const DOCTRINE_DEFS: Record<DoctrineId, DoctrineDef> = {
  aggressive: {
    id: 'aggressive',
    name: 'Way of the Tiger',
    motto: 'Strike first, strike fast.',
    summary: 'Fast attacks, cavalry and expansion.',
    mods: { attack: 0.06, marchSpeed: 0.1, cavalry: 0.05, defense: -0.05 },
    tacticChance: 0,
    effects: ['+6% damage', '+10% march speed', '+5% cavalry', '-5% protection when defending'],
  },
  defensive: {
    id: 'defensive',
    name: 'Way of the Mountain',
    motto: 'Be immovable.',
    summary: 'Citadels, fortification and supply.',
    mods: { defense: 0.12, upkeep: -0.05, attack: -0.04 },
    tacticChance: 0,
    effects: ['+12% protection when defending', '-5% army upkeep', '-4% damage'],
  },
  intelligence: {
    id: 'intelligence',
    name: 'Way of the Shadow',
    motto: 'Know the enemy and know yourself.',
    summary: 'Scouts, deception and surprise.',
    mods: { scoutSuccess: 0.1, detect: 0.1, intelAttack: 0.05, morale: -2 },
    tacticChance: 0.05,
    effects: ['+10% scouting success', '+10% chance to catch enemy scouts', 'Tactics come off 5% more often', '-2 morale'],
  },
  diplomatic: {
    id: 'diplomatic',
    name: 'Way of the Crane',
    motto: 'Win without fighting.',
    summary: 'Loyal provinces, alliances and reputation.',
    mods: { loyaltyPerDay: 0.5, conquestLoyalty: 8, prodGold: 0.05, attack: -0.03 },
    tacticChance: 0,
    effects: ['+0.5 loyalty per day in every province', '+8 loyalty in conquered provinces', '+5% gold', '-3% damage'],
  },
};

/** Game hours a clan must keep a doctrine before choosing another. */
export const DOCTRINE_COOLDOWN_HOURS = 72;

export function applyDoctrine(mods: Modifiers, doctrine: string | null | undefined): Modifiers {
  const def = doctrine ? DOCTRINE_DEFS[doctrine as DoctrineId] : undefined;
  if (!def) return mods;
  const out = { ...mods };
  for (const [key, value] of Object.entries(def.mods) as [keyof Modifiers, number][]) out[key] += value;
  return out;
}

// ---------------------------------------------------------------------------
// War council duties (§7.2) and treaties (§9.3)
// ---------------------------------------------------------------------------

export const WAR_DUTIES = ['commander', 'scout', 'defender', 'logistics', 'spy', 'reinforcement', 'strategist'] as const;
export type WarDuty = (typeof WAR_DUTIES)[number];

export const DUTY_DEFS: Record<WarDuty, { name: string; summary: string; effect: string }> = {
  commander: { name: 'Commander', summary: 'Leads the attack.', effect: 'The army fights with this official\'s own Military pillar.' },
  strategist: { name: 'Strategist', summary: 'Shapes the plan.', effect: 'The tactic comes off more often: +1% per Intelligence level of this official (up to +6%).' },
  scout: { name: 'Scout', summary: 'Watches the enemy.', effect: 'With a fresh scouting report on the target, the tactic comes off 8% more often.' },
  logistics: { name: 'Logistics Officer', summary: 'Manages the supplies.', effect: 'The march consumes 20% less food.' },
  reinforcement: { name: 'Reinforcement', summary: 'Stands ready with reserves.', effect: 'The army starts with +4 morale.' },
  defender: { name: 'Defender', summary: 'Guards the home province while the army is away.', effect: 'Keeps watch over the province of departure.' },
  spy: { name: 'Spy', summary: 'Gathers information inside enemy land.', effect: 'Reports what they learn to the council.' },
};

export const PACT_TYPES = ['nap', 'alliance'] as const;
export type PactType = (typeof PACT_TYPES)[number];

export const PACT_DEFS: Record<PactType, { name: string; summary: string; hours: number | null }> = {
  nap: { name: 'Non-aggression Pact', summary: 'Neither nation may declare war on or attack the other for three days.', hours: 72 },
  alliance: {
    name: 'Alliance',
    summary: 'No war between the two nations; each sees the other\'s garrisons, may march through the other\'s land and is called when the other is attacked.',
    hours: null,
  },
};

/** After breaking a treaty a clan may not declare war on the former partner for this many game hours. */
export const PACT_BREAK_COOLDOWN_HOURS = 12;
/** Loyalty lost in every province of a clan that breaks its word. */
export const PACT_BREAK_LOYALTY = 8;
