/**
 * Row types and bulk loaders. The world is small (tens of provinces and
 * clans), so the simulation and the read models load whole tables at once
 * rather than issuing a query per province.
 */
import {
  BUILDING_TYPES,
  emptyBuildingLevels,
  normalizeUnits,
  type BuildingLevels,
  type BuildingType,
  type ResourceBag,
  type Terrain,
  type UnitCounts,
} from '@/game/config';
import { SEAT_OF_PILLAR, type ClanRole, type RecruitmentMode } from '@/game/clan';
import { PILLARS, SKILLS, computeModifiers, emptyModifiers, type Modifiers, type PillarId, type SkillRanks } from '@/game/pillars';
import { rows, type Db } from './db';

export interface ClanRow {
  id: string;
  /** The leader. Null for NPC clans and for disbanded clans. */
  player_id: string | null;
  npc_key: string | null;
  name: string;
  daimyo_name: string;
  portrait: string;
  banner_color: string;
  banner_mon: string;
  is_npc: boolean;
  personality: string | null;
  status: 'active' | 'fallen' | 'disbanded';
  capital_province_id: string | null;
  protected_until: Date | null;
  starving_ticks: number;
  created_at: Date;
  tag: string;
  description: string;
  recruitment: RecruitmentMode;
  language: string;
  doctrine: string | null;
  doctrine_set_at: Date | null;
  announcement: string | null;
  announcement_at: Date | null;
  announcement_by: string | null;
}

export interface MemberRow {
  player_id: string;
  clan_id: string;
  role: ClanRole;
  joined_at: Date;
  contribution: number;
}

export interface ProvinceRow {
  id: string;
  code: string;
  name: string;
  region_id: string;
  owner_clan_id: string | null;
  terrain: Terrain;
  population: number;
  base_food: number;
  base_gold: number;
  base_wood: number;
  base_stone: number;
  base_iron: number;
  defense_level: number;
  development_level: number;
  loyalty: number;
  is_start_slot: boolean;
  last_festival_at: Date | null;
  owner_since: Date | null;
}

export interface BuildingRow {
  id: string;
  province_id: string;
  type: BuildingType;
  level: number;
  upgrade_started_at: Date | null;
  upgrade_completes_at: Date | null;
}

export interface ArmyRow {
  id: string;
  clan_id: string | null;
  province_id: string;
  status: 'garrison' | 'marching' | 'besieging';
  intent: 'move' | 'attack' | 'return' | null;
  target_province_id: string | null;
  path: string[] | null;
  departed_at: Date | null;
  arrives_at: Date | null;
  /** The member who led this army out, if any. */
  commander_player_id: string | null;
  units: UnitCounts;
}

export interface ResourceRow extends ResourceBag {
  clan_id: string;
}

export interface WarRow {
  id: string;
  attacker_clan_id: string;
  defender_clan_id: string;
  status: 'active' | 'ended';
  declared_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
}

export interface WorldEventRow {
  id: string;
  type: string;
  title: string;
  description: string;
  province_id: string | null;
  clan_id: string | null;
  effects: { production?: Partial<ResourceBag> } | null;
  starts_at: Date;
  ends_at: Date | null;
}

export function provinceBase(p: ProvinceRow): ResourceBag {
  return { gold: p.base_gold, food: p.base_food, wood: p.base_wood, stone: p.base_stone, iron: p.base_iron };
}

export async function loadClans(db: Db): Promise<ClanRow[]> {
  return rows<ClanRow>(db, 'SELECT * FROM clans ORDER BY created_at, id');
}

export async function loadProvinces(db: Db): Promise<ProvinceRow[]> {
  return rows<ProvinceRow>(db, 'SELECT * FROM provinces ORDER BY code');
}

export async function loadBuildings(db: Db, provinceId?: string): Promise<BuildingRow[]> {
  return provinceId
    ? rows<BuildingRow>(db, 'SELECT * FROM buildings WHERE province_id = $1', [provinceId])
    : rows<BuildingRow>(db, 'SELECT * FROM buildings');
}

export function levelsByProvince(buildings: BuildingRow[]): Map<string, BuildingLevels> {
  const map = new Map<string, BuildingLevels>();
  for (const b of buildings) {
    let levels = map.get(b.province_id);
    if (!levels) {
      levels = emptyBuildingLevels();
      map.set(b.province_id, levels);
    }
    if ((BUILDING_TYPES as readonly string[]).includes(b.type)) levels[b.type] = b.level;
  }
  return map;
}

const ARMY_SELECT = `
  SELECT a.id, a.clan_id, a.province_id, a.status, a.intent, a.target_province_id, a.path,
         a.departed_at, a.arrives_at, a.commander_player_id,
         COALESCE(jsonb_object_agg(u.unit_type, u.count) FILTER (WHERE u.unit_type IS NOT NULL), '{}'::jsonb) AS units
  FROM armies a
  LEFT JOIN army_units u ON u.army_id = a.id`;

function toArmy(r: any): ArmyRow {
  return { ...r, units: normalizeUnits(r.units) } as ArmyRow;
}

export async function loadArmies(db: Db, where = '', params: unknown[] = []): Promise<ArmyRow[]> {
  const res = await rows(db, `${ARMY_SELECT} ${where ? `WHERE ${where}` : ''} GROUP BY a.id ORDER BY a.created_at, a.id`, params);
  return res.map(toArmy);
}

export async function loadResources(db: Db): Promise<Map<string, ResourceRow>> {
  const res = await rows<ResourceRow>(db, 'SELECT clan_id, gold, food, wood, stone, iron FROM resources');
  return new Map(res.map((r) => [r.clan_id, r]));
}

export interface PillarRow {
  clan_id: string;
  pillar: PillarId;
  level: number;
  xp: number;
  points: number;
}

export interface ClanProgress {
  levels: Record<PillarId, number>;
  ranks: SkillRanks;
  mods: Modifiers;
  pillarTotal: number;
  /** Which member carries each pillar for the clan (human clans only). */
  seats: Partial<Record<PillarId, string>>;
}

export interface PlayerProgress {
  levels: Record<PillarId, number>;
  ranks: SkillRanks;
}

const baseLevels = (): Record<PillarId, number> => ({ military: 1, leadership: 1, economy: 1, intelligence: 1, culture: 1 });

/** Pillar levels and skill ranks of the given players. */
export async function loadPlayerProgress(db: Db, playerIds: string[]): Promise<Map<string, PlayerProgress>> {
  const out = new Map<string, PlayerProgress>();
  for (const id of playerIds) out.set(id, { levels: baseLevels(), ranks: {} });
  if (playerIds.length === 0) return out;
  const pillarRows = await rows<{ player_id: string; pillar: PillarId; level: number }>(
    db,
    'SELECT player_id, pillar, level FROM player_pillars WHERE player_id = ANY($1)',
    [playerIds],
  );
  const skillRows = await rows<{ player_id: string; skill_code: string; rank: number }>(
    db,
    'SELECT player_id, skill_code, rank FROM player_skill_ranks WHERE player_id = ANY($1)',
    [playerIds],
  );
  for (const r of pillarRows) out.get(r.player_id)!.levels[r.pillar] = r.level;
  for (const r of skillRows) out.get(r.player_id)!.ranks[r.skill_code] = r.rank;
  return out;
}

/**
 * The clan's standing in the Five Pillars, put together from its council:
 * each pillar is carried by the strongest of the members holding its seat and
 * the leader. `commanderId`, when given, carries the Military pillar instead —
 * the member leading an army fights with their own skill, not the General's.
 */
export function composeProgress(
  members: { player_id: string; role: ClanRole }[],
  people: Map<string, PlayerProgress>,
  commanderId?: string | null,
): ClanProgress {
  const progress: ClanProgress = { levels: baseLevels(), ranks: {}, mods: emptyModifiers(), pillarTotal: PILLARS.length, seats: {} };
  for (const pillar of PILLARS) {
    const seat = SEAT_OF_PILLAR[pillar];
    let candidates = members.filter((m) => m.role === seat || m.role === 'leader');
    if (pillar === 'military' && commanderId && members.some((m) => m.player_id === commanderId)) {
      candidates = members.filter((m) => m.player_id === commanderId);
    }
    let best: string | null = null;
    for (const m of candidates) {
      const level = people.get(m.player_id)?.levels[pillar] ?? 1;
      if (best === null || level > (people.get(best)?.levels[pillar] ?? 1)) best = m.player_id;
    }
    if (!best) continue;
    const holder = people.get(best);
    progress.levels[pillar] = holder?.levels[pillar] ?? 1;
    progress.seats[pillar] = best;
    for (const skill of SKILLS) {
      if (skill.pillar !== pillar) continue;
      const rank = holder?.ranks[skill.code] ?? 0;
      if (rank > 0) progress.ranks[skill.code] = rank;
    }
  }
  progress.mods = computeModifiers(progress.levels, progress.ranks);
  progress.pillarTotal = PILLARS.reduce((sum, id) => sum + progress.levels[id], 0);
  return progress;
}

/**
 * Pillar levels, skill ranks and the resulting modifiers for every clan (or
 * one). NPC clans have their own rows; clans of players are composed from
 * their council seats.
 */
export async function loadProgress(db: Db, clanId?: string, commanderId?: string | null): Promise<Map<string, ClanProgress>> {
  const filter = clanId ? 'WHERE clan_id = $1' : '';
  const params = clanId ? [clanId] : [];
  const pillarRows = await rows<PillarRow>(db, `SELECT clan_id, pillar, level, xp, points FROM five_pillars ${filter}`, params);
  const skillRows = await rows<{ clan_id: string; skill_code: string; rank: number }>(
    db,
    `SELECT clan_id, skill_code, rank FROM player_skills ${filter}`,
    params,
  );
  const out = new Map<string, ClanProgress>();
  const ensure = (id: string): ClanProgress => {
    let p = out.get(id);
    if (!p) {
      p = { levels: baseLevels(), ranks: {}, mods: emptyModifiers(), pillarTotal: PILLARS.length, seats: {} };
      out.set(id, p);
    }
    return p;
  };
  for (const r of pillarRows) ensure(r.clan_id).levels[r.pillar] = r.level;
  for (const r of skillRows) ensure(r.clan_id).ranks[r.skill_code] = r.rank;
  for (const p of out.values()) {
    p.mods = computeModifiers(p.levels, p.ranks);
    p.pillarTotal = PILLARS.reduce((sum, id) => sum + p.levels[id], 0);
  }

  const members = await rows<{ clan_id: string; player_id: string; role: ClanRole }>(
    db,
    `SELECT clan_id, player_id, role FROM clan_members ${filter}`,
    params,
  );
  if (members.length > 0) {
    const people = await loadPlayerProgress(db, members.map((m) => m.player_id));
    const byClan = new Map<string, typeof members>();
    for (const m of members) {
      const list = byClan.get(m.clan_id) ?? [];
      list.push(m);
      byClan.set(m.clan_id, list);
    }
    for (const [id, list] of byClan) out.set(id, composeProgress(list, people, commanderId));
  }
  return out;
}

/** The clan's modifiers. With `commanderId`, the Military pillar is that member's own. */
export async function loadMods(db: Db, clanId: string | null, commanderId?: string | null): Promise<Modifiers> {
  if (!clanId) return emptyModifiers();
  const progress = await loadProgress(db, clanId, commanderId);
  return progress.get(clanId)?.mods ?? emptyModifiers();
}

export async function loadMembers(db: Db, clanId: string): Promise<MemberRow[]> {
  return rows<MemberRow>(db, 'SELECT player_id, clan_id, role, joined_at, contribution FROM clan_members WHERE clan_id = $1 ORDER BY joined_at, player_id', [clanId]);
}

export async function loadActiveWars(db: Db): Promise<WarRow[]> {
  return rows<WarRow>(db, `SELECT * FROM wars WHERE status = 'active' ORDER BY declared_at`);
}

export function atWar(wars: WarRow[], a: string, b: string): WarRow | null {
  return (
    wars.find(
      (w) =>
        w.status === 'active' &&
        ((w.attacker_clan_id === a && w.defender_clan_id === b) || (w.attacker_clan_id === b && w.defender_clan_id === a)),
    ) ?? null
  );
}

/** Events whose lasting effect covers `now`. */
export async function loadActiveEvents(db: Db, now: Date): Promise<WorldEventRow[]> {
  return rows<WorldEventRow>(
    db,
    `SELECT id, type, title, description, province_id, clan_id, effects, starts_at, ends_at
     FROM world_events WHERE ends_at IS NOT NULL AND starts_at <= $1 AND ends_at > $1 ORDER BY starts_at`,
    [now],
  );
}

/** Combined production multipliers from active events, per province. */
export function eventMultipliers(events: WorldEventRow[]): Map<string, Partial<ResourceBag>> {
  const out = new Map<string, Partial<ResourceBag>>();
  for (const e of events) {
    if (!e.province_id || !e.effects?.production) continue;
    const current = out.get(e.province_id) ?? {};
    for (const [k, v] of Object.entries(e.effects.production) as [keyof ResourceBag, number][]) {
      current[k] = (current[k] ?? 1) * v;
    }
    out.set(e.province_id, current);
  }
  return out;
}
