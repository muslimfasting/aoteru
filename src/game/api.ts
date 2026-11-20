/**
 * API contract between the web client and the game server.
 *
 * Every response below is produced by the server from its own state; the
 * client never sends resource amounts, timers or battle results — only intent
 * (what to build, whom to attack, how many soldiers to send).
 *
 * All timestamps are ISO-8601 UTC strings. All ids are UUID strings.
 * Errors use `ApiErrorBody` with a 4xx/5xx status.
 */
import type { BattleInputs, BattleOutcome, BattleResult, Weather } from './battle';
import type { BuildingType, ResourceBag, Terrain, UnitCounts, UnitType } from './config';
import type { Modifiers, PillarId } from './pillars';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface WorldMetaDTO {
  /** Server clock. Use it (not the device clock) for countdowns. */
  now: string;
  /** 1 = real time. 60 = one game hour per real minute. */
  speed: number;
  /** Real milliseconds per world tick (one game hour). */
  tickIntervalMs: number;
  /** Last processed tick. */
  tickNumber: number;
  nextTickAt: string;
  /** Game calendar derived from the tick number. Day starts at 1. */
  day: number;
  hour: number;
  /** True while the simulation is still catching up to the present. */
  behind: boolean;
  /** Clan currently proclaimed hegemon of the region, if any. */
  hegemon: { clanId: string; since: string } | null;
  /** Provinces a clan must hold to be proclaimed hegemon. */
  hegemonyProvinces: number;
}

export interface BannerDTO {
  /** id from BANNER_COLORS */
  color: string;
  /** id from BANNER_MONS */
  mon: string;
}

export interface ClanPublicDTO {
  id: string;
  name: string;
  daimyoName: string;
  /** id from PORTRAITS */
  portrait: string;
  banner: BannerDTO;
  isNpc: boolean;
  playerNickname: string | null;
  status: 'active' | 'fallen';
  provinceCount: number;
  capitalProvinceId: string | null;
  /** While set and in the future, the clan cannot be attacked. */
  protectedUntil: string | null;
  score: number;
}

export interface IncomeDTO {
  /** Hourly production of all provinces. */
  production: ResourceBag;
  /** Hourly food eaten by the population. */
  populationFood: number;
  upkeepFood: number;
  upkeepGold: number;
  /** Net change per game hour. */
  net: ResourceBag;
}

export interface ClanSelfDTO extends ClanPublicDTO {
  resources: ResourceBag;
  income: IncomeDTO;
  population: number;
  army: { total: number; capacity: number; power: number; recruiting: number };
  /** Food stores are empty: loyalty falls and soldiers desert. */
  starving: boolean;
  rank: number;
}

export interface PlayerDTO {
  id: string;
  nickname: string;
  email: string;
  createdAt: string;
}

/** GET /api/player/me */
export interface MeResponse {
  player: PlayerDTO;
  clan: ClanSelfDTO | null;
  world: WorldMetaDTO;
  unreadNotifications: number;
}

// ---------------------------------------------------------------------------
// Map and provinces
// ---------------------------------------------------------------------------

/** How a province stands toward the viewing clan. */
export type ProvinceRelation = 'own' | 'unclaimed' | 'enemy' | 'foreign';

export interface ProvinceSummaryDTO {
  id: string;
  /** Key into PROVINCE_BY_CODE (geometry, lore). */
  code: string;
  name: string;
  kanji: string;
  terrain: Terrain;
  ownerClanId: string | null;
  isCapital: boolean;
  /** Unclaimed and open for a new clan to be founded here. */
  isStartSlot: boolean;
  castleLevel: number;
  population: number;
  relation: ProvinceRelation;
  /** A battle is being fought here right now. */
  underAttack: boolean;
  /** Own provinces only. */
  garrison: UnitCounts | null;
  loyalty: number | null;
  /**
   * What the viewer knows of the defenders of a province they do not own:
   * exact after a successful scouting report, a rough band for provinces that
   * border their land, null otherwise.
   */
  strength: { label: string; exact: boolean; power: number | null } | null;
}

export interface MovementDTO {
  id: string;
  clanId: string;
  own: boolean;
  fromProvinceId: string;
  toProvinceId: string;
  /** Province ids entered along the way, ending with the destination. */
  path: string[];
  intent: 'move' | 'attack' | 'return';
  /** `besieging`: arrived and fighting; see `battleId`. */
  status: 'marching' | 'besieging';
  departedAt: string;
  arrivesAt: string;
  /** Composition is only visible to the owner. */
  units: UnitCounts | null;
  total: number | null;
  battleId: string | null;
}

export interface PendingBattleDTO {
  id: string;
  provinceId: string;
  attackerClanId: string;
  defenderClanId: string | null;
  startedAt: string;
  resolvesAt: string;
}

export interface WarDTO {
  id: string;
  attackerClanId: string;
  defenderClanId: string;
  status: 'active' | 'ended';
  declaredAt: string;
  endedAt: string | null;
}

export interface WorldEventDTO {
  id: string;
  /** e.g. conquest, war, peace, famine, harvest, merchants, earthquake, rebellion, founding, hegemony */
  type: string;
  title: string;
  description: string;
  provinceId: string | null;
  clanId: string | null;
  startsAt: string;
  /** Set for events with a lasting effect (famine, harvest). */
  endsAt: string | null;
  active: boolean;
}

/** GET /api/world/map — also available before the player has founded a clan. */
export interface WorldMapResponse {
  world: WorldMetaDTO;
  viewerClanId: string | null;
  provinces: ProvinceSummaryDTO[];
  clans: ClanPublicDTO[];
  movements: MovementDTO[];
  battles: PendingBattleDTO[];
  wars: WarDTO[];
  /** Events whose effects are in force right now. */
  activeEvents: WorldEventDTO[];
  /** Most recent entries of the realm chronicle, newest first. */
  chronicle: WorldEventDTO[];
}

export interface BuildingDTO {
  type: BuildingType;
  level: number;
  maxLevel: number;
  upgrading: { toLevel: number; startedAt: string; completesAt: string } | null;
  nextLevel: number | null;
  nextCost: ResourceBag | null;
  nextDurationMs: number | null;
  /** Rule that blocks the next upgrade (not counting resources), or null. */
  blockedReason: string | null;
  affordable: boolean;
  effect: string;
  nextEffect: string | null;
}

export interface RecruitOrderDTO {
  id: string;
  provinceId: string;
  provinceName: string;
  unitType: UnitType;
  count: number;
  startedAt: string;
  completesAt: string;
}

export interface RecruitOptionDTO {
  unitType: UnitType;
  blockedReason: string | null;
  /** Real milliseconds to train one soldier here. */
  durationMsEach: number;
  /** Largest order the clan can place right now (resources, population, capacity). */
  max: number;
}

export interface IntelDTO {
  operationId: string;
  reportedAt: string;
  expiresAt: string;
  units: UnitCounts;
  power: number;
  castleLevel: number;
  buildings: Record<BuildingType, number>;
  loyalty: number;
  /** Treasury of the owning clan, if any. */
  ownerResources: ResourceBag | null;
}

export interface ProvinceOwnDTO {
  loyalty: number;
  populationCap: number;
  /** Actual hourly production with every bonus applied. */
  production: ResourceBag;
  foodConsumption: number;
  buildings: BuildingDTO[];
  /** A province builds one thing at a time. */
  constructionBusy: boolean;
  garrison: UnitCounts;
  recruitment: RecruitOrderDTO[];
  recruitOptions: RecruitOptionDTO[];
  festival: { cost: ResourceBag; loyaltyGain: number; availableAt: string | null };
}

export interface ProvinceActionsDTO {
  canAttack: boolean;
  attackBlockedReason: string | null;
  canScout: boolean;
  scoutBlockedReason: string | null;
  scoutCost: number;
  /** 0..1 */
  scoutChance: number;
  scoutDurationMs: number;
  /** The viewer has no clan yet and may found one here. */
  canFound: boolean;
}

/** GET /api/provinces/:id */
export interface ProvinceDetailResponse {
  province: ProvinceSummaryDTO & {
    regionName: string;
    lore: string;
    base: ResourceBag;
    developmentLevel: number;
    /** Neighbouring province ids. */
    neighbors: string[];
    ownerName: string | null;
  };
  /** Present only when the viewer owns the province. */
  own: ProvinceOwnDTO | null;
  /** Latest unexpired scouting report held by the viewer. */
  intel: IntelDTO | null;
  actions: ProvinceActionsDTO;
  activeEvents: WorldEventDTO[];
}

// ---------------------------------------------------------------------------
// Military
// ---------------------------------------------------------------------------

/** GET /api/army */
export interface ArmyOverviewResponse {
  capacity: number;
  total: number;
  recruiting: number;
  power: number;
  upkeep: { food: number; gold: number };
  garrisons: { provinceId: string; provinceName: string; units: UnitCounts; power: number }[];
  movements: MovementDTO[];
  recruitment: RecruitOrderDTO[];
}

export interface MarchRequest {
  fromProvinceId: string;
  /** For POST /api/battles/declare this field is `targetProvinceId`. */
  toProvinceId: string;
  units: Partial<UnitCounts>;
}

/** POST /api/army/preview — what an order would do, without issuing it. */
export interface MarchPreviewResponse {
  ok: boolean;
  reason: string | null;
  intent: 'move' | 'attack';
  path: string[];
  durationMs: number;
  /** Food drawn from the stores when the army sets out. */
  supplies: number;
}

/** POST /api/army/move and POST /api/battles/declare */
export interface MarchResponse {
  movement: MovementDTO;
}

export interface BattleSummaryDTO {
  id: string;
  provinceId: string;
  provinceName: string;
  attackerClanId: string;
  attackerName: string;
  defenderClanId: string | null;
  defenderName: string;
  /** The viewer's part in the battle. */
  role: 'attacker' | 'defender';
  status: 'pending' | 'resolved' | 'cancelled';
  startedAt: string;
  resolvesAt: string;
  resolvedAt: string | null;
  /** From the attacker's point of view. */
  outcome: BattleOutcome | null;
  winner: 'attacker' | 'defender' | 'none' | null;
  provinceCaptured: boolean;
  attackerLosses: number | null;
  defenderLosses: number | null;
}

/** GET /api/battles */
export interface BattleListResponse {
  battles: BattleSummaryDTO[];
}

/** GET /api/battles/:id */
export interface BattleDetailResponse {
  battle: BattleSummaryDTO;
  weather: Weather | null;
  /** Stored inputs and seed; together they reproduce `result` exactly. */
  inputs: BattleInputs | null;
  seed: string | null;
  result: BattleResult | null;
  /** The server re-ran the simulation from the stored inputs and seed and got the same result. */
  verified: boolean | null;
}

// ---------------------------------------------------------------------------
// Five Pillars
// ---------------------------------------------------------------------------

export interface PillarDTO {
  id: PillarId;
  level: number;
  xp: number;
  /** null at maximum level. */
  xpToNext: number | null;
  /** Unspent skill points for this pillar. */
  points: number;
}

export interface SkillStateDTO {
  /** Key into SKILL_BY_CODE. */
  code: string;
  rank: number;
  /** Why the next rank cannot be learned right now, or null if it can. */
  blockedReason: string | null;
}

/** GET /api/pillars/me and POST /api/skills/unlock */
export interface PillarsResponse {
  pillars: PillarDTO[];
  skills: SkillStateDTO[];
  /** Sum of everything the pillars and skills currently grant. */
  modifiers: Modifiers;
}

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

export interface DiplomacyClanDTO {
  clan: ClanPublicDTO;
  relation: 'war' | 'neutral';
  warId: string | null;
  canDeclareWar: boolean;
  declareBlockedReason: string | null;
  /** A peace proposal waiting for an answer. */
  pendingPeace: 'incoming' | 'outgoing' | null;
  proposalId: string | null;
}

/** GET /api/diplomacy (and returned by every diplomacy mutation) */
export interface DiplomacyResponse {
  /** Gold cost to declare war, after Culture skills. */
  warCost: number;
  clans: DiplomacyClanDTO[];
  /** Wars involving the viewer, newest first. */
  wars: WarDTO[];
}

// ---------------------------------------------------------------------------
// Intelligence
// ---------------------------------------------------------------------------

export interface EspionageOpDTO {
  id: string;
  operation: 'scout';
  targetProvinceId: string;
  targetProvinceName: string;
  status: 'pending' | 'success' | 'failed';
  /** The target learned that someone was watching. */
  detected: boolean;
  cost: number;
  successChance: number;
  startedAt: string;
  completesAt: string;
  resolvedAt: string | null;
  report: IntelDTO | null;
  reportExpired: boolean;
}

/** GET /api/espionage and POST /api/espionage/execute */
export interface EspionageResponse {
  operations: EspionageOpDTO[];
}

// ---------------------------------------------------------------------------
// Ranking, notifications, chat
// ---------------------------------------------------------------------------

export interface LeaderboardEntryDTO {
  rank: number;
  clan: ClanPublicDTO;
  provinces: number;
  population: number;
  /** Sum of the five pillar levels. */
  pillarLevels: number;
  score: number;
  isViewer: boolean;
}

/** GET /api/leaderboard */
export interface LeaderboardResponse {
  entries: LeaderboardEntryDTO[];
}

export interface NotificationDTO {
  id: string;
  /** e.g. battle, building, recruitment, war, peace, espionage, event, province, system */
  type: string;
  title: string;
  body: string;
  /** In-app path to open, e.g. /game/battles/<id>. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** GET /api/notifications */
export interface NotificationsResponse {
  notifications: NotificationDTO[];
  unread: number;
}

export interface ChatMessageDTO {
  id: number;
  clanId: string | null;
  clanName: string;
  nickname: string;
  bannerColor: string;
  body: string;
  createdAt: string;
}

/** GET /api/chat */
export interface ChatResponse {
  messages: ChatMessageDTO[];
}

// ---------------------------------------------------------------------------
// Realtime (GDD §16)
//
// The server writes events to per-room outboxes ("world" and one private room
// per player). On serverless hosting they are delivered by polling
// GET /api/sync?cursor=<last id>; the event names match the WebSocket spec so
// the transport can be swapped later without touching the screens.
// ---------------------------------------------------------------------------

export type RealtimeEventName =
  | 'world:province_updated'
  | 'world:tick'
  | 'world:event'
  | 'resource:updated'
  | 'army:updated'
  | 'building:completed'
  | 'recruitment:completed'
  | 'battle:started'
  | 'battle:completed'
  | 'diplomacy:proposal'
  | 'diplomacy:updated'
  | 'espionage:completed'
  | 'pillars:updated'
  | 'notification:new'
  | 'chat:message';

export interface RealtimeEventDTO {
  id: number;
  event: RealtimeEventName;
  payload: Record<string, unknown>;
  at: string;
}

/** GET /api/sync?cursor=<number> */
export interface SyncResponse {
  /** Pass back as `cursor` on the next call. */
  cursor: number;
  events: RealtimeEventDTO[];
  world: WorldMetaDTO;
  resources: ResourceBag | null;
  unreadNotifications: number;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface RegisterRequest {
  email: string;
  password: string;
  nickname: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/** POST /api/auth/register and /api/auth/login */
export interface AuthResponse {
  player: PlayerDTO;
  hasClan: boolean;
}

/** POST /api/clans → MeResponse */
export interface CreateClanRequest {
  clanName: string;
  daimyoName: string;
  portrait: string;
  bannerColor: string;
  bannerMon: string;
  /** Must be an unclaimed start slot. */
  provinceId: string;
}

/** POST /api/buildings/upgrade → ProvinceDetailResponse */
export interface UpgradeBuildingRequest {
  provinceId: string;
  type: BuildingType;
}

/** POST /api/army/recruit → ProvinceDetailResponse */
export interface RecruitRequest {
  provinceId: string;
  unitType: UnitType;
  count: number;
}

/** POST /api/battles/declare → MarchResponse */
export interface DeclareBattleRequest {
  fromProvinceId: string;
  targetProvinceId: string;
  units: Partial<UnitCounts>;
}

/** POST /api/skills/unlock → PillarsResponse */
export interface UnlockSkillRequest {
  skillCode: string;
}

/** POST /api/wars/declare → DiplomacyResponse */
export interface DeclareWarRequest {
  clanId: string;
}

/** POST /api/diplomacy/propose → DiplomacyResponse */
export interface ProposeRequest {
  clanId: string;
  type: 'peace';
}

/** POST /api/diplomacy/respond → DiplomacyResponse */
export interface RespondRequest {
  proposalId: string;
  accept: boolean;
}

/** POST /api/espionage/execute → EspionageResponse */
export interface EspionageRequest {
  operation: 'scout';
  provinceId: string;
}

/** POST /api/notifications/read → NotificationsResponse. Omit `ids` to mark everything read. */
export interface MarkReadRequest {
  ids?: string[];
}

/** POST /api/chat → { message: ChatMessageDTO } */
export interface ChatRequest {
  body: string;
}
