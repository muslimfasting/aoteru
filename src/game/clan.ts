/**
 * Clan organisation: roles, permissions, council seats and the personal economy.
 * Shared by server and client; pure data and pure functions.
 */
import type { ResourceBag, ResourceKey } from './config';
import type { PillarId } from './pillars';

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
  leader: { id: 'leader', name: 'Shogun', rank: 100, summary: 'Leads the clan. May do everything.', seat: 'leadership' },
  officer: { id: 'officer', name: 'Daimyo', rank: 80, summary: 'Runs members, armies and diplomacy for the leader.', seat: 'culture' },
  general: { id: 'general', name: 'General', rank: 60, summary: 'Raises troops and commands the armies.', seat: 'military' },
  strategist: { id: 'strategist', name: 'Strategist', rank: 60, summary: 'Draws up the war plans.', seat: null },
  intelligence: { id: 'intelligence', name: 'Intelligence Officer', rank: 60, summary: 'Runs scouts and spies.', seat: 'intelligence' },
  treasurer: { id: 'treasurer', name: 'Treasurer', rank: 60, summary: 'Keeps the treasury and pays for the works.', seat: 'economy' },
  samurai: { id: 'samurai', name: 'Samurai', rank: 20, summary: 'A sworn member of the clan.', seat: null },
  recruit: { id: 'recruit', name: 'Recruit', rank: 10, summary: 'Newly joined, still proving themselves.', seat: null },
};

/**
 * Council seats. Each pillar of the clan is carried by the member holding the
 * matching seat — or by the leader, whichever is stronger in it. A clan of
 * specialists is therefore stronger than one person trying to master everything.
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
  manage_members: { name: 'Members', summary: 'Invite players, answer applications, assign roles and remove members of lower rank.' },
  manage_clan: { name: 'Clan profile', summary: 'Edit the description and recruitment settings, post announcements.' },
  build: { name: 'Construction', summary: 'Upgrade buildings and hold festivals with treasury resources.' },
  recruit: { name: 'Recruitment', summary: 'Recruit troops with treasury resources.' },
  command: { name: 'Command', summary: 'Move armies and launch attacks.' },
  war_plans: { name: 'War council', summary: 'Create war plans, choose strategies and assign members.' },
  diplomacy: { name: 'Diplomacy', summary: 'Declare war, and propose or answer treaties.' },
  espionage: { name: 'Intelligence', summary: 'Send scouts and run intelligence operations.' },
  treasury: { name: 'Treasury', summary: 'Pay out treasury resources to members.' },
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
  application: { name: 'Application', summary: 'Players apply; the clan decides.' },
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
