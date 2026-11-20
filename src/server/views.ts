/**
 * Read models: everything the API returns is assembled here from server state.
 * These functions only read, and they apply the visibility rules — a player
 * sees their own numbers exactly, and other clans only as far as their scouts
 * and borders allow.
 */
import type {
  ArmyOverviewResponse,
  BattleDetailResponse,
  BattleListResponse,
  BattleSummaryDTO,
  BuildingDTO,
  ChatMessageDTO,
  ChatResponse,
  ClanPublicDTO,
  ClanSelfDTO,
  DiplomacyResponse,
  EspionageResponse,
  IntelDTO,
  LeaderboardResponse,
  MeResponse,
  MovementDTO,
  NotificationsResponse,
  PlayerDTO,
  ProvinceDetailResponse,
  ProvinceRelation,
  ProvinceSummaryDTO,
  RealtimeEventDTO,
  RecruitOptionDTO,
  RecruitOrderDTO,
  SyncResponse,
  WarDTO,
  WorldEventDTO,
  WorldMapResponse,
  WorldMetaDTO,
} from '@/game/api';
import type { BattleInputs, BattleResult } from '@/game/battle';
import {
  BUILDINGS,
  BUILDING_TYPES,
  RESOURCE_KEYS,
  UNITS,
  UNIT_TYPES,
  WORLD,
  armyCapacity,
  armyPower,
  buildingBlockReason,
  buildingCost,
  buildingEffectText,
  buildingMinutes,
  canAfford,
  emptyBuildingLevels,
  emptyUnits,
  populationCap,
  populationFood,
  recruitMinutes,
  scaleBag,
  strengthLabel,
  totalUnits,
  unitBlockReason,
  unitCost,
  type ResourceBag,
  type UnitType,
} from '@/game/config';
import { PROVINCE_BY_CODE, REGIONS } from '@/game/map';
import { emptyModifiers } from '@/game/pillars';
import { verifyBattle, type BattleRow } from './battles';
import { one, rows, type Db } from './db';
import { clanWars, isProtected, warBlockReason, warCost } from './diplomacy';
import { clanIncome, clanUnits, getResources, provinceOutput } from './economy';
import { forbidden, notFound } from './errors';
import { freshIntel, scoutBlockReason, scoutOdds } from './espionage';
import { MAX_RECRUIT_ORDER, MIN_POPULATION } from './military';
import { clanRoom, playerRoom, WORLD_ROOM } from './notify';
import {
  atWar,
  eventMultipliers,
  levelsByProvince,
  loadActiveEvents,
  loadArmies,
  loadBuildings,
  loadClans,
  loadProgress,
  loadProvinces,
  provinceBase,
  type ArmyRow,
  type BuildingRow,
  type ClanProgress,
  type ClanRow,
  type ProvinceRow,
  type WarRow,
  type WorldEventRow,
} from './rows';
import { addMs, gameMs, loadWorldState, worldMeta, type WorldStateRow } from './world';
import type { Membership } from './auth';
import { DOCTRINES, type DoctrineId, type PactType } from '@/game/clan';
import { STANCES, STANCE_PREP_MINUTES, TACTICS, stanceBlockReason, type TacticId } from '@/game/strategy';
import { pactBlockReason } from './pacts';
import { loadActivePacts, pactBetween, type PactRow } from './rows';
import { effectiveStance, pendingStance } from './stance';
import { buildPersonal, buildPlayerRanking, membershipDTO, unreadMessages } from './clanviews';
import { getPurse } from './purse';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface Viewer {
  player: PlayerDTO;
  clan: ClanRow | null;
  member: Membership | null;
}

function activeClan(viewer: Viewer): ClanRow | null {
  return viewer.clan && viewer.clan.status === 'active' ? viewer.clan : null;
}

interface ClanStats {
  provinceCount: number;
  population: number;
  power: number;
  units: number;
  pillarTotal: number;
  score: number;
}

export interface WorldView {
  now: Date;
  state: WorldStateRow;
  clans: ClanRow[];
  nicknames: Map<string, string>;
  memberCounts: Map<string, number>;
  provinces: ProvinceRow[];
  buildings: BuildingRow[];
  levels: ReturnType<typeof levelsByProvince>;
  armies: ArmyRow[];
  progress: Map<string, ClanProgress>;
  wars: WarRow[];
  pacts: PactRow[];
  stats: Map<string, ClanStats>;
}

async function requireState(db: Db): Promise<WorldStateRow> {
  const state = await loadWorldState(db);
  if (!state) throw new Error('The world has not been created yet');
  return state;
}

export async function loadWorldView(db: Db, now: Date): Promise<WorldView> {
  const [state, clans, nickRows, provinces, buildings, armies, progress, wars, pacts] = await Promise.all([
    requireState(db),
    loadClans(db),
    rows<{ clan_id: string; nickname: string; members: number }>(
      db,
      `SELECT c.id AS clan_id, p.nickname, (SELECT COUNT(*)::int FROM clan_members m WHERE m.clan_id = c.id) AS members
         FROM clans c JOIN players p ON p.id = c.player_id`,
    ),
    loadProvinces(db),
    loadBuildings(db),
    loadArmies(db),
    loadProgress(db),
    rows<WarRow>(db, `SELECT * FROM wars WHERE status = 'active' ORDER BY declared_at`),
    loadActivePacts(db, now),
  ]);
  const stats = new Map<string, ClanStats>();
  for (const clan of clans) {
    const own = provinces.filter((p) => p.owner_clan_id === clan.id);
    const units = clanUnits(armies.filter((a) => a.clan_id === clan.id));
    const power = armyPower(units);
    const population = own.reduce((s, p) => s + p.population, 0);
    const pillarTotal = progress.get(clan.id)?.pillarTotal ?? 5;
    stats.set(clan.id, {
      provinceCount: own.length,
      population,
      power,
      units: totalUnits(units),
      pillarTotal,
      // Public score: land, people and the Daimyo's learning. Army strength is deliberately left out —
      // every other term is public, so including it would let anyone read a rival's strength off the ranking.
      score: own.length * 1000 + Math.floor(population / 10) + pillarTotal * 50 + clan.victories * 100,
    });
  }
  return {
    now,
    state,
    clans,
    nicknames: new Map(nickRows.map((r) => [r.clan_id, r.nickname])),
    memberCounts: new Map(nickRows.map((r) => [r.clan_id, r.members])),
    provinces,
    buildings,
    levels: levelsByProvince(buildings),
    armies,
    progress,
    wars,
    pacts,
    stats,
  };
}

export function clanPublic(view: WorldView, clan: ClanRow): ClanPublicDTO {
  const stats = view.stats.get(clan.id);
  return {
    id: clan.id,
    name: clan.name,
    daimyoName: clan.daimyo_name,
    portrait: clan.portrait,
    banner: { color: clan.banner_color, mon: clan.banner_mon },
    isNpc: clan.is_npc,
    playerNickname: view.nicknames.get(clan.id) ?? null,
    tag: clan.tag,
    description: clan.description,
    recruitment: clan.recruitment,
    language: clan.language,
    memberCount: view.memberCounts.get(clan.id) ?? 0,
    doctrine: (DOCTRINES as readonly string[]).includes(clan.doctrine ?? '') ? (clan.doctrine as DoctrineId) : null,
    victories: clan.victories,
    defeats: clan.defeats,
    status: clan.status,
    provinceCount: stats?.provinceCount ?? 0,
    capitalProvinceId: clan.capital_province_id,
    protectedUntil: isProtected(clan, view.now) ? iso(clan.protected_until) : null,
    score: clan.status === 'active' ? stats?.score ?? 0 : 0,
  };
}

export function ranking(view: WorldView): ClanRow[] {
  return view.clans
    .filter((c) => c.status === 'active')
    .sort((a, b) => (view.stats.get(b.id)?.score ?? 0) - (view.stats.get(a.id)?.score ?? 0) || a.name.localeCompare(b.name));
}

async function unreadCount(db: Db, playerId: string): Promise<number> {
  const row = await one<{ n: number }>(db, 'SELECT COUNT(*)::int AS n FROM notifications WHERE player_id = $1 AND read_at IS NULL', [playerId]);
  return row?.n ?? 0;
}

export async function clanSelf(db: Db, view: WorldView, clan: ClanRow): Promise<ClanSelfDTO> {
  const own = view.provinces.filter((p) => p.owner_clan_id === clan.id);
  const mine = view.armies.filter((a) => a.clan_id === clan.id);
  const mods = view.progress.get(clan.id)?.mods ?? emptyModifiers();
  const [resources, events, pending] = await Promise.all([
    getResources(db, clan.id),
    loadActiveEvents(db, view.now),
    one<{ n: number }>(db, `SELECT COALESCE(SUM(count), 0)::int AS n FROM recruitment_orders WHERE clan_id = $1 AND status = 'pending'`, [clan.id]),
  ]);
  const income = clanIncome({ provinces: own, levels: view.levels, mods, eventMult: eventMultipliers(events), armies: mine });
  const stats = view.stats.get(clan.id)!;
  return {
    ...clanPublic(view, clan),
    resources,
    income,
    population: stats.population,
    army: {
      total: stats.units,
      capacity: armyCapacity(own.map((p) => view.levels.get(p.id)?.castle ?? 0), mods.capacity),
      power: stats.power,
      recruiting: pending?.n ?? 0,
    },
    starving: clan.starving_ticks > 0,
    rank: clan.status === 'active' ? ranking(view).findIndex((c) => c.id === clan.id) + 1 : 0,
  };
}

export async function buildMe(db: Db, viewer: Viewer, now: Date): Promise<MeResponse> {
  const view = await loadWorldView(db, now);
  const invites = await one<{ n: number }>(db, `SELECT COUNT(*)::int AS n FROM clan_invitations WHERE player_id = $1 AND status = 'pending'`, [
    viewer.player.id,
  ]);
  return {
    player: viewer.player,
    clan: viewer.clan ? await clanSelf(db, view, viewer.clan) : null,
    membership: membershipDTO(viewer.member),
    personal: await buildPersonal(db, viewer),
    world: worldMeta(view.state, now),
    unreadNotifications: await unreadCount(db, viewer.player.id),
    unreadMessages: await unreadMessages(db, viewer),
    pendingInvitations: invites?.n ?? 0,
  };
}

function toEvent(e: WorldEventRow, now: Date): WorldEventDTO {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    description: e.description,
    provinceId: e.province_id,
    clanId: e.clan_id,
    startsAt: e.starts_at.toISOString(),
    endsAt: iso(e.ends_at),
    active: !!e.ends_at && e.ends_at.getTime() > now.getTime(),
  };
}

function toWar(w: WarRow): WarDTO {
  return {
    id: w.id,
    attackerClanId: w.attacker_clan_id,
    defenderClanId: w.defender_clan_id,
    status: w.status,
    declaredAt: w.declared_at.toISOString(),
    endedAt: iso(w.ended_at),
  };
}

function relationOf(view: WorldView, clan: ClanRow | null, p: ProvinceRow): ProvinceRelation {
  if (!p.owner_clan_id) return 'unclaimed';
  if (!clan) return 'foreign';
  if (p.owner_clan_id === clan.id) return 'own';
  if (atWar(view.wars, clan.id, p.owner_clan_id)) return 'enemy';
  return pactBetween(view.pacts, clan.id, p.owner_clan_id)?.type === 'alliance' ? 'allied' : 'foreign';
}

function garrisonAt(view: WorldView, p: ProvinceRow): ArmyRow | undefined {
  return view.armies.find((a) => a.status === 'garrison' && a.province_id === p.id && a.clan_id === p.owner_clan_id);
}

function bordersClan(view: WorldView, clanId: string, p: ProvinceRow): boolean {
  const codes = PROVINCE_BY_CODE[p.code]?.neighbors ?? [];
  return view.provinces.some((o) => o.owner_clan_id === clanId && codes.includes(o.code));
}

function provinceSummary(
  view: WorldView,
  clan: ClanRow | null,
  p: ProvinceRow,
  intel: Map<string, IntelDTO>,
  underAttack: Set<string>,
): ProvinceSummaryDTO {
  const relation = relationOf(view, clan, p);
  const own = relation === 'own';
  const garrison = garrisonAt(view, p);
  let strength: ProvinceSummaryDTO['strength'] = null;
  if (!own && clan) {
    const report = intel.get(p.id);
    // Allies show each other their garrisons.
    const alliedPower = relation === 'allied' ? armyPower(garrison?.units ?? {}) : null;
    if (alliedPower !== null) strength = { label: strengthLabel(alliedPower), exact: true, power: alliedPower };
    else if (report) strength = { label: strengthLabel(report.power), exact: true, power: report.power };
    else if (bordersClan(view, clan.id, p)) strength = { label: strengthLabel(armyPower(garrison?.units ?? {})), exact: false, power: null };
  }
  const owner = p.owner_clan_id ? view.clans.find((c) => c.id === p.owner_clan_id) : null;
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    kanji: PROVINCE_BY_CODE[p.code]?.kanji ?? '',
    terrain: p.terrain,
    ownerClanId: p.owner_clan_id,
    isCapital: !!owner && owner.capital_province_id === p.id,
    isStartSlot: !p.owner_clan_id && p.is_start_slot && !underAttack.has(p.id),
    castleLevel: view.levels.get(p.id)?.castle ?? p.defense_level,
    population: p.population,
    relation,
    underAttack: underAttack.has(p.id),
    garrison: own ? garrison?.units ?? emptyUnits() : null,
    loyalty: own ? Math.round(p.loyalty) : null,
    strength,
  };
}

function toMovement(a: ArmyRow, viewerClanId: string | null, battleByArmy: Map<string, string>): MovementDTO {
  const own = !!viewerClanId && a.clan_id === viewerClanId;
  return {
    id: a.id,
    clanId: a.clan_id!,
    own,
    fromProvinceId: a.province_id,
    toProvinceId: a.target_province_id!,
    path: a.path ?? [a.target_province_id!],
    intent: a.intent ?? 'move',
    status: a.status === 'besieging' ? 'besieging' : 'marching',
    departedAt: (a.departed_at ?? new Date(0)).toISOString(),
    arrivesAt: (a.arrives_at ?? new Date(0)).toISOString(),
    units: own ? a.units : null,
    total: own ? totalUnits(a.units) : null,
    battleId: own ? battleByArmy.get(a.id) ?? null : null,
  };
}

async function pendingBattleRows(db: Db): Promise<BattleRow[]> {
  return rows<BattleRow>(db, `SELECT * FROM battles WHERE status = 'pending' ORDER BY resolves_at`);
}

export async function buildMap(db: Db, viewer: Viewer, now: Date): Promise<WorldMapResponse> {
  const clan = activeClan(viewer);
  const view = await loadWorldView(db, now);
  const [battles, active, recent, intel] = await Promise.all([
    pendingBattleRows(db),
    loadActiveEvents(db, now),
    rows<WorldEventRow>(
      db,
      'SELECT id, type, title, description, province_id, clan_id, effects, starts_at, ends_at FROM world_events ORDER BY starts_at DESC, created_at DESC LIMIT 30',
    ),
    clan ? freshIntel(db, clan.id, now) : Promise.resolve(new Map<string, IntelDTO>()),
  ]);
  const underAttack = new Set(battles.map((b) => b.province_id));
  const battleByArmy = new Map(battles.filter((b) => b.attacker_army_id).map((b) => [b.attacker_army_id!, b.id]));
  return {
    world: worldMeta(view.state, now),
    viewerClanId: clan?.id ?? null,
    provinces: view.provinces.map((p) => provinceSummary(view, clan, p, intel, underAttack)),
    clans: view.clans.filter((c) => c.status === 'active').map((c) => clanPublic(view, c)),
    movements: view.armies
      .filter((a) => a.status !== 'garrison' && a.clan_id && a.target_province_id)
      .map((a) => toMovement(a, clan?.id ?? null, battleByArmy)),
    battles: battles.map((b) => ({
      id: b.id,
      provinceId: b.province_id,
      attackerClanId: b.attacker_clan_id,
      defenderClanId: b.defender_clan_id,
      startedAt: b.started_at.toISOString(),
      resolvesAt: b.resolves_at.toISOString(),
    })),
    wars: view.wars.map(toWar),
    activeEvents: active.map((e) => toEvent(e, now)),
    chronicle: recent.map((e) => toEvent(e, now)),
  };
}

interface RecruitRow {
  id: string;
  province_id: string;
  province_name: string;
  unit_type: UnitType;
  count: number;
  started_at: Date;
  completes_at: Date;
}

function toRecruitOrder(r: RecruitRow): RecruitOrderDTO {
  return {
    id: r.id,
    provinceId: r.province_id,
    provinceName: r.province_name,
    unitType: r.unit_type,
    count: r.count,
    startedAt: r.started_at.toISOString(),
    completesAt: r.completes_at.toISOString(),
  };
}

async function recruitmentQueue(db: Db, clanId: string, provinceId?: string): Promise<RecruitOrderDTO[]> {
  const res = await rows<RecruitRow>(
    db,
    `SELECT r.id, r.province_id, p.name AS province_name, r.unit_type, r.count, r.started_at, r.completes_at
       FROM recruitment_orders r JOIN provinces p ON p.id = r.province_id
      WHERE r.clan_id = $1 AND r.status = 'pending' ${provinceId ? 'AND r.province_id = $2' : ''}
      ORDER BY r.completes_at`,
    provinceId ? [clanId, provinceId] : [clanId],
  );
  return res.map(toRecruitOrder);
}

export async function buildProvince(db: Db, viewer: Viewer, provinceId: string, now: Date): Promise<ProvinceDetailResponse> {
  const clan = activeClan(viewer);
  const view = await loadWorldView(db, now);
  const p = view.provinces.find((x) => x.id === provinceId);
  if (!p) throw notFound('Province');
  const def = PROVINCE_BY_CODE[p.code];
  const [battles, events, intel] = await Promise.all([
    pendingBattleRows(db),
    loadActiveEvents(db, now),
    clan ? freshIntel(db, clan.id, now, p.id) : Promise.resolve(new Map<string, IntelDTO>()),
  ]);
  const underAttack = new Set(battles.map((b) => b.province_id));
  const summary = provinceSummary(view, clan, p, intel, underAttack);
  const owner = p.owner_clan_id ? view.clans.find((c) => c.id === p.owner_clan_id) ?? null : null;
  const levels = view.levels.get(p.id) ?? emptyBuildingLevels();
  const mods = clan ? view.progress.get(clan.id)?.mods ?? emptyModifiers() : emptyModifiers();
  const speed = { speed: view.state.speed };

  let own: ProvinceDetailResponse['own'] = null;
  if (clan && p.owner_clan_id === clan.id) {
    const resources = await getResources(db, clan.id);
    const here = view.buildings.filter((b) => b.province_id === p.id);
    const busy = here.some((b) => b.upgrade_completes_at);
    const buildings: BuildingDTO[] = BUILDING_TYPES.map((type) => {
      const row = here.find((b) => b.type === type);
      const level = row?.level ?? 0;
      const upgrading = row?.upgrade_completes_at
        ? { toLevel: level + 1, startedAt: (row.upgrade_started_at ?? now).toISOString(), completesAt: row.upgrade_completes_at.toISOString() }
        : null;
      const maxed = level >= BUILDINGS[type].maxLevel;
      const nextCost = maxed ? null : buildingCost(type, level + 1, mods.buildCost);
      let blockedReason = buildingBlockReason(type, levels);
      if (!blockedReason && busy && !upgrading) blockedReason = 'The builders are busy with another project';
      if (upgrading) blockedReason = 'Under construction';
      return {
        type,
        level,
        maxLevel: BUILDINGS[type].maxLevel,
        upgrading,
        nextLevel: maxed ? null : level + 1,
        nextCost,
        nextDurationMs: maxed ? null : gameMs(speed, buildingMinutes(type, level + 1, mods.buildTime)),
        blockedReason,
        affordable: !!nextCost && canAfford(resources, nextCost),
        effect: buildingEffectText(type, level),
        nextEffect: maxed ? null : buildingEffectText(type, level + 1),
      };
    });

    const stats = view.stats.get(clan.id)!;
    const queue = await recruitmentQueue(db, clan.id);
    const recruiting = queue.reduce((s, o) => s + o.count, 0);
    const capacity = armyCapacity(
      view.provinces.filter((x) => x.owner_clan_id === clan.id).map((x) => view.levels.get(x.id)?.castle ?? 0),
      mods.capacity,
    );
    const room = Math.max(0, capacity - stats.units - recruiting);
    const recruitOptions: RecruitOptionDTO[] = UNIT_TYPES.map((unitType) => {
      const blocked = unitBlockReason(unitType, levels);
      const per = unitCost(unitType, 1);
      const affordable = Math.min(...RESOURCE_KEYS.map((k) => (per[k] > 0 ? Math.floor(resources[k] / per[k]) : Infinity)));
      const max = blocked ? 0 : Math.max(0, Math.min(affordable, room, p.population - MIN_POPULATION, MAX_RECRUIT_ORDER));
      return { unitType, blockedReason: blocked, durationMsEach: gameMs(speed, recruitMinutes(unitType, 1, levels.barracks)), max };
    });

    const festivalReady = p.last_festival_at ? addMs(p.last_festival_at, gameMs(speed, WORLD.festival.cooldownHours * 60)) : null;
    own = {
      loyalty: Math.round(p.loyalty * 10) / 10,
      populationCap: populationCap(p.development_level),
      production: provinceOutput(p, levels, mods, eventMultipliers(events).get(p.id)),
      foodConsumption: populationFood(p.population),
      buildings,
      constructionBusy: busy,
      garrison: garrisonAt(view, p)?.units ?? emptyUnits(),
      recruitment: queue.filter((o) => o.provinceId === p.id),
      recruitOptions,
      stance: (() => {
        const pending = pendingStance(p, now);
        const garrisonTotal = totalUnits(garrisonAt(view, p)?.units ?? emptyUnits());
        return {
          current: effectiveStance(p, now),
          pending: pending ? { stance: pending.stance, readyAt: pending.readyAt.toISOString() } : null,
          options: STANCES.map((id) => ({ id, blockedReason: stanceBlockReason(id, p.terrain, garrisonTotal) })),
          prepMs: gameMs(speed, STANCE_PREP_MINUTES),
        };
      })(),
      festival: {
        cost: scaleBag(WORLD.festival.cost, 1),
        loyaltyGain: Math.round(WORLD.festival.loyalty * (1 + mods.festival)),
        availableAt: festivalReady && festivalReady.getTime() > now.getTime() ? festivalReady.toISOString() : null,
      },
    };
  }

  // What the viewer may do here.
  let canAttack = false;
  let attackBlockedReason: string | null = null;
  let canScout = false;
  let scoutBlockedReason: string | null = null;
  let odds = { success: 0, detection: 0, cost: WORLD.scout.cost as number, minutes: WORLD.scout.minutes as number };
  if (clan && p.owner_clan_id !== clan.id) {
    if (owner && !atWar(view.wars, clan.id, owner.id)) attackBlockedReason = `You are not at war with the ${owner.name} clan. Declare war first.`;
    else if (!view.provinces.some((x) => x.owner_clan_id === clan.id)) attackBlockedReason = 'You hold no province to march from';
    else canAttack = true;
    scoutBlockedReason = await scoutBlockReason(db, clan.id, p);
    canScout = !scoutBlockedReason;
    odds = scoutOdds(mods, owner ? view.progress.get(owner.id)?.mods ?? emptyModifiers() : emptyModifiers());
  } else if (!clan) {
    attackBlockedReason = 'Found a clan first';
    scoutBlockedReason = 'Found a clan first';
  }

  return {
    province: {
      ...summary,
      regionName: REGIONS.find((r) => r.id === p.region_id)?.name ?? p.region_id,
      lore: def?.lore ?? '',
      base: provinceBase(p),
      developmentLevel: p.development_level,
      neighbors: (def?.neighbors ?? []).map((code) => view.provinces.find((x) => x.code === code)?.id).filter((id): id is string => !!id),
      ownerName: owner?.name ?? null,
    },
    own,
    intel: intel.get(p.id) ?? null,
    actions: {
      canAttack,
      attackBlockedReason,
      canScout,
      scoutBlockedReason,
      scoutCost: odds.cost,
      scoutChance: Math.round(odds.success * 100) / 100,
      scoutDurationMs: gameMs(speed, odds.minutes),
      canFound: !clan && summary.isStartSlot,
    },
    activeEvents: events.filter((e) => e.province_id === p.id).map((e) => toEvent(e, now)),
  };
}

export async function buildArmy(db: Db, clan: ClanRow, now: Date): Promise<ArmyOverviewResponse> {
  const view = await loadWorldView(db, now);
  const mine = view.armies.filter((a) => a.clan_id === clan.id);
  const mods = view.progress.get(clan.id)?.mods ?? emptyModifiers();
  const battles = await pendingBattleRows(db);
  const battleByArmy = new Map(battles.filter((b) => b.attacker_army_id).map((b) => [b.attacker_army_id!, b.id]));
  const queue = await recruitmentQueue(db, clan.id);
  const own = view.provinces.filter((p) => p.owner_clan_id === clan.id);
  const units = clanUnits(mine);
  let food = 0;
  let gold = 0;
  for (const t of UNIT_TYPES) {
    food += units[t] * UNITS[t].upkeep.food;
    gold += units[t] * UNITS[t].upkeep.gold;
  }
  const factor = Math.max(0.4, 1 - mods.upkeep);
  return {
    capacity: armyCapacity(own.map((p) => view.levels.get(p.id)?.castle ?? 0), mods.capacity),
    total: totalUnits(units),
    recruiting: queue.reduce((s, o) => s + o.count, 0),
    power: armyPower(units),
    upkeep: { food: Math.round(food * factor), gold: Math.round(gold * factor) },
    garrisons: own.map((p) => {
      const g = mine.find((a) => a.status === 'garrison' && a.province_id === p.id);
      const u = g?.units ?? emptyUnits();
      return { provinceId: p.id, provinceName: p.name, units: u, power: armyPower(u) };
    }),
    movements: mine.filter((a) => a.status !== 'garrison' && a.target_province_id).map((a) => toMovement(a, clan.id, battleByArmy)),
    recruitment: queue,
  };
}

/** A single movement, right after the order that created it. */
export async function buildMovement(db: Db, clanId: string, armyId: string): Promise<MovementDTO> {
  const [army] = await loadArmies(db, 'a.id = $1', [armyId]);
  if (!army) throw notFound('Army');
  return toMovement(army, clanId, new Map());
}

interface BattleListRow extends BattleRow {
  tactic: string;
  plan_id: string | null;
  province_name: string;
  attacker_name: string;
  defender_name: string | null;
  outcome: BattleSummaryDTO['outcome'];
  winner: BattleSummaryDTO['winner'];
  province_captured: boolean | null;
  attacker_losses: number | null;
  defender_losses: number | null;
  result: BattleResult | null;
}

const BATTLE_SELECT = `
  SELECT b.*, p.name AS province_name, ac.name AS attacker_name, dc.name AS defender_name,
         r.outcome, r.winner, r.province_captured, r.attacker_losses, r.defender_losses, r.result
    FROM battles b
    JOIN provinces p ON p.id = b.province_id
    JOIN clans ac ON ac.id = b.attacker_clan_id
    LEFT JOIN clans dc ON dc.id = b.defender_clan_id
    LEFT JOIN battle_reports r ON r.battle_id = b.id`;

function toBattleSummary(b: BattleListRow, clanId: string): BattleSummaryDTO {
  return {
    id: b.id,
    provinceId: b.province_id,
    provinceName: b.province_name,
    attackerClanId: b.attacker_clan_id,
    attackerName: b.attacker_name,
    defenderClanId: b.defender_clan_id,
    defenderName: b.defender_name ?? `Warriors of ${b.province_name}`,
    role: b.attacker_clan_id === clanId ? 'attacker' : 'defender',
    // The defender learns the tactic from the battle report, not before.
    tactic: (b.attacker_clan_id === clanId || b.status === 'resolved') && (TACTICS as readonly string[]).includes(b.tactic) ? (b.tactic as TacticId) : 'assault',
    planId: b.attacker_clan_id === clanId ? b.plan_id ?? null : null,
    status: b.status,
    startedAt: b.started_at.toISOString(),
    resolvesAt: b.resolves_at.toISOString(),
    resolvedAt: iso(b.resolved_at),
    outcome: b.outcome ?? null,
    winner: b.winner ?? null,
    provinceCaptured: b.province_captured ?? false,
    attackerLosses: b.attacker_losses,
    defenderLosses: b.defender_losses,
  };
}

export async function buildBattles(db: Db, clan: ClanRow): Promise<BattleListResponse> {
  const res = await rows<BattleListRow>(
    db,
    `${BATTLE_SELECT} WHERE (b.attacker_clan_id = $1 OR b.defender_clan_id = $1) AND b.status <> 'cancelled' ORDER BY b.started_at DESC LIMIT 50`,
    [clan.id],
  );
  return { battles: res.map((b) => toBattleSummary(b, clan.id)) };
}

/** Battle reports are for the two sides that fought (BATTLE-08). */
export async function buildBattle(db: Db, clan: ClanRow, battleId: string): Promise<BattleDetailResponse> {
  const b = await one<BattleListRow>(db, `${BATTLE_SELECT} WHERE b.id = $1`, [battleId]);
  if (!b) throw notFound('Battle');
  if (b.attacker_clan_id !== clan.id && b.defender_clan_id !== clan.id) throw forbidden('That battle was not yours');
  const resolved = b.status === 'resolved' && b.inputs && b.result;
  return {
    battle: toBattleSummary(b, clan.id),
    weather: b.weather,
    inputs: resolved ? (b.inputs as BattleInputs) : null,
    seed: resolved ? b.seed : null,
    result: resolved ? b.result : null,
    verified: resolved ? verifyBattle(b.inputs as BattleInputs, b.seed, b.result as BattleResult) : null,
  };
}

export async function buildDiplomacy(db: Db, clan: ClanRow, now: Date): Promise<DiplomacyResponse> {
  const view = await loadWorldView(db, now);
  const mods = view.progress.get(clan.id)?.mods ?? emptyModifiers();
  const proposals = await rows<{ id: string; type: 'peace' | PactType; from_clan_id: string; to_clan_id: string }>(
    db,
    `SELECT id, type, from_clan_id, to_clan_id FROM diplomacy WHERE status = 'pending' AND expires_at > $2 AND (from_clan_id = $1 OR to_clan_id = $1)`,
    [clan.id, now],
  );
  const cost = warCost(mods.warCost);
  const gold = (await getResources(db, clan.id)).gold;
  const ctx = { tx: db, now, speed: view.state.speed };
  const others = view.clans.filter((c) => c.id !== clan.id && c.status === 'active');
  const clans = [];
  for (const other of others) {
    const war = atWar(view.wars, clan.id, other.id);
    let reason = war ? 'You are already at war' : await warBlockReason(ctx, clan, other, view.wars);
    if (!reason && gold < cost) reason = `Declaring war costs ${cost} gold`;
    const incoming = proposals.find((p) => p.type === 'peace' && p.from_clan_id === other.id && p.to_clan_id === clan.id);
    const outgoing = proposals.find((p) => p.type === 'peace' && p.from_clan_id === clan.id && p.to_clan_id === other.id);
    const pact = pactBetween(view.pacts, clan.id, other.id);
    const pendingPacts = proposals
      .filter((p) => p.type !== 'peace' && (p.from_clan_id === other.id || p.to_clan_id === other.id))
      .map((p) => ({ proposalId: p.id, type: p.type as PactType, direction: p.from_clan_id === other.id ? ('incoming' as const) : ('outgoing' as const) }));
    const offered = (type: PactType) => (pendingPacts.some((p) => p.type === type) ? 'An offer is already waiting for an answer' : null);
    clans.push({
      clan: clanPublic(view, other),
      relation: war ? ('war' as const) : pact ? pact.type : ('neutral' as const),
      pact: pact ? { id: pact.id, type: pact.type, startedAt: pact.started_at.toISOString(), endsAt: pact.ends_at ? pact.ends_at.toISOString() : null } : null,
      pendingPacts,
      napBlockedReason: offered('nap') ?? (await pactBlockReason(ctx, clan, other, 'nap', view.pacts)),
      allianceBlockedReason: offered('alliance') ?? (await pactBlockReason(ctx, clan, other, 'alliance', view.pacts)),
      warId: war?.id ?? null,
      canDeclareWar: !reason,
      declareBlockedReason: reason,
      pendingPeace: incoming ? ('incoming' as const) : outgoing ? ('outgoing' as const) : null,
      proposalId: incoming?.id ?? outgoing?.id ?? null,
    });
  }
  return { warCost: cost, clans, wars: (await clanWars(db, clan.id)).map(toWar) };
}

export async function buildEspionage(db: Db, clan: ClanRow, now: Date): Promise<EspionageResponse> {
  const res = await rows<any>(
    db,
    `SELECT e.*, p.name AS province_name FROM espionage e JOIN provinces p ON p.id = e.target_province_id
      WHERE e.clan_id = $1 ORDER BY e.started_at DESC LIMIT 40`,
    [clan.id],
  );
  return {
    operations: res.map((e) => ({
      id: e.id,
      operation: 'scout' as const,
      targetProvinceId: e.target_province_id,
      targetProvinceName: e.province_name,
      status: e.status,
      detected: e.detected,
      cost: e.cost,
      successChance: Math.round(e.success_chance * 100) / 100,
      startedAt: e.started_at.toISOString(),
      completesAt: e.completes_at.toISOString(),
      resolvedAt: iso(e.resolved_at),
      report: e.report ?? null,
      reportExpired: !!e.report_expires_at && e.report_expires_at.getTime() <= now.getTime(),
    })),
  };
}

export async function buildLeaderboard(db: Db, viewer: Viewer, now: Date): Promise<LeaderboardResponse> {
  const view = await loadWorldView(db, now);
  return {
    entries: ranking(view).map((clan, i) => {
      const stats = view.stats.get(clan.id)!;
      return {
        rank: i + 1,
        clan: clanPublic(view, clan),
        provinces: stats.provinceCount,
        population: stats.population,
        pillarLevels: stats.pillarTotal,
        score: stats.score,
        isViewer: viewer.clan?.id === clan.id,
      };
    }),
    players: await buildPlayerRanking(db, viewer),
  };
}

export async function buildNotifications(db: Db, playerId: string): Promise<NotificationsResponse> {
  const res = await rows<any>(db, 'SELECT * FROM notifications WHERE player_id = $1 ORDER BY created_at DESC, id LIMIT 60', [playerId]);
  return {
    notifications: res.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: iso(n.read_at),
      createdAt: n.created_at.toISOString(),
    })),
    unread: await unreadCount(db, playerId),
  };
}

export async function currentWorldMeta(db: Db, now: Date): Promise<WorldMetaDTO> {
  return worldMeta(await requireState(db), now);
}

/**
 * Realtime delivery by polling. A client only ever receives events from the
 * shared world room, its clan's room and its own private room (authorised rooms, GDD §16).
 */
export async function buildSync(db: Db, viewer: Viewer, cursor: number | null, now: Date): Promise<SyncResponse> {
  const rooms = [WORLD_ROOM, playerRoom(viewer.player.id)];
  if (viewer.clan) rooms.push(clanRoom(viewer.clan.id));
  const head = await one<{ id: number }>(db, 'SELECT COALESCE(MAX(id), 0) AS id FROM realtime_events');
  let events: RealtimeEventDTO[] = [];
  let next = head?.id ?? 0;
  if (cursor !== null && cursor < next) {
    const res = await rows<any>(db, 'SELECT id, event, payload, created_at FROM realtime_events WHERE id > $1 AND room = ANY($2) ORDER BY id LIMIT 200', [
      cursor,
      rooms,
    ]);
    events = res.map((e) => ({ id: e.id, event: e.event, payload: e.payload, at: e.created_at.toISOString() }));
    // A full page resumes from its last event; otherwise jump to the head (skipping other players'
    // private events), or past anything newer that this query already returned.
    const last = res.length > 0 ? (res[res.length - 1].id as number) : 0;
    next = res.length === 200 ? last : Math.max(next, last);
  }
  const clan = activeClan(viewer);
  let resources: ResourceBag | null = null;
  if (clan) resources = await getResources(db, clan.id);
  return {
    cursor: next,
    events,
    world: await currentWorldMeta(db, now),
    resources,
    purse: await getPurse(db, viewer.player.id),
    unreadNotifications: await unreadCount(db, viewer.player.id),
    unreadMessages: await unreadMessages(db, viewer),
  };
}
