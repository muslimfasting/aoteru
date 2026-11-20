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
import type { ClanPermission, ClanRole, DoctrineId, PactType, RecruitmentMode, WarDuty } from './clan';
import type { BuildingType, ResourceBag, Terrain, UnitCounts, UnitType } from './config';
import type { Modifiers, PillarId } from './pillars';
import type { StanceId, TacticId } from './strategy';

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
  /** Nickname of the clan's leader; null for NPC clans. */
  playerNickname: string | null;
  /** Short tag shown beside member names, e.g. "ODA". */
  tag: string;
  description: string;
  recruitment: RecruitmentMode;
  /** id from CLAN_LANGUAGES */
  language: string;
  memberCount: number;
  /** The clan's way of war (DOCTRINE_DEFS), if it has chosen one. */
  doctrine: DoctrineId | null;
  /** Battles won and lost, attacking or defending. */
  victories: number;
  defeats: number;
  status: 'active' | 'fallen' | 'disbanded';
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
  /** id from PORTRAITS */
  portrait: string;
  createdAt: string;
}

/** The viewer's place in their clan. */
export interface MembershipDTO {
  clanId: string;
  role: ClanRole;
  roleName: string;
  /** What the role may do right now. Buttons for anything else should be hidden or disabled. */
  permissions: ClanPermission[];
  joinedAt: string;
}

/** The viewer's personal economy and standing (they keep these when changing clan). */
export interface PersonalDTO {
  purse: ResourceBag;
  residenceLevel: number;
  maxResidenceLevel: number;
  /** Paid every game hour while the clan holds land. */
  residenceIncome: ResourceBag;
  /** False when the player has no clan, or the clan holds no land: no income is paid. */
  incomeActive: boolean;
  /** null at the maximum level. */
  nextResidenceCost: ResourceBag | null;
  /** The pillar trained at home (a little experience every game hour). */
  trainingFocus: PillarId;
  trainingXpPerHour: number;
  /** Overall level: sum of pillar levels above the first, plus one. */
  level: number;
  reputation: number;
  battlesLed: number;
  battlesWon: number;
}

/** GET /api/player/me */
export interface MeResponse {
  player: PlayerDTO;
  /** The clan the viewer belongs to (its treasury, income and army are shared by all members). */
  clan: ClanSelfDTO | null;
  membership: MembershipDTO | null;
  personal: PersonalDTO;
  world: WorldMetaDTO;
  unreadNotifications: number;
  /** Unread private messages plus unread clan chat. */
  unreadMessages: number;
  /** Invitations to join a clan waiting for an answer. */
  pendingInvitations: number;
}

// ---------------------------------------------------------------------------
// Map and provinces
// ---------------------------------------------------------------------------

/** How a province stands toward the viewing clan. */
export type ProvinceRelation = 'own' | 'unclaimed' | 'enemy' | 'allied' | 'foreign';

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
  /** The stance the garrison held when it was scouted (absent in reports made before stances existed). */
  stance?: StanceId;
  stanceName?: string;
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
  /** How the garrison is ordered to fight (STANCE_DEFS). Changing it needs the `command` permission. */
  stance: {
    current: StanceId;
    /** A newly ordered stance still being prepared; `current` holds until `readyAt`. */
    pending: { stance: StanceId; readyAt: string } | null;
    options: { id: StanceId; blockedReason: string | null }[];
    /** Real milliseconds a new stance takes to prepare. */
    prepMs: number;
  };
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
  /** Attacks only: the tactic to use (TACTIC_DEFS). Defaults to a frontal assault. */
  tactic?: TacticId;
}
/** One tactic as it stands for a given host and target. */
export interface TacticOptionDTO {
  id: TacticId;
  /** Why this host cannot use it, or null. */
  blockedReason: string | null;
  /** Chance to come off against an equally skilled defender who has not prepared for it; null when nothing is rolled. */
  chance: number | null;
  cost: Partial<ResourceBag>;
  /** Extra real milliseconds before the battle is decided. */
  extraMs: number;
  supplyFactor: number;
  /** The scouted stance of the target defeats this tactic. */
  counteredByKnownStance: boolean;
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
  /** Attacks only: every tactic, with whether this host can use it. */
  tactics: TacticOptionDTO[];
  /** What a fresh scouting report says about how the target is held; null without one. */
  knownStance: { stance: StanceId; stanceName: string; reportedAt: string } | null;
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
  /** The attacker's tactic. Hidden ('assault') from the defender until the battle is resolved. */
  tactic: TacticId;
  /** The war plan this attack carried out, for the attacker. */
  planId: string | null;
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
  /** What the viewer's own pillars and skills would grant if they carried every pillar. */
  modifiers: Modifiers;
  /**
   * The clan's council: each pillar is carried for the whole clan by the
   * strongest of the leader and the member holding that pillar's seat. Null
   * when the viewer has no clan.
   */
  council: {
    /** What the clan actually fights, builds and scouts with. */
    modifiers: Modifiers;
    seats: {
      pillar: PillarId;
      seatRole: ClanRole;
      seatName: string;
      playerId: string | null;
      nickname: string | null;
      level: number;
      isYou: boolean;
    }[];
  } | null;
}

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

export interface PactDTO {
  id: string;
  type: PactType;
  startedAt: string;
  /** Null: lasts until one side ends it. */
  endsAt: string | null;
}
export interface DiplomacyClanDTO {
  clan: ClanPublicDTO;
  relation: 'war' | 'neutral' | 'nap' | 'alliance';
  /** The standing treaty with this clan, if any. */
  pact: PactDTO | null;
  /** Treaty offers waiting for an answer (peace offers are in `pendingPeace`). */
  pendingPacts: { proposalId: string; type: PactType; direction: 'incoming' | 'outgoing' }[];
  /** Why a treaty cannot be offered, or null if it can. */
  napBlockedReason: string | null;
  allianceBlockedReason: string | null;
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
export interface PlayerRankDTO {
  rank: number;
  playerId: string;
  nickname: string;
  portrait: string;
  clanId: string | null;
  clanName: string | null;
  clanTag: string | null;
  roleName: string | null;
  level: number;
  contribution: number;
  battlesWon: number;
  reputation: number;
  score: number;
  isViewer: boolean;
}
export interface LeaderboardResponse {
  /** Clan ranking. */
  entries: LeaderboardEntryDTO[];
  /** Individual ranking. */
  players: PlayerRankDTO[];
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

export type ChatChannel = 'world' | 'clan' | 'dm';
export interface ChatMessageDTO {
  id: number;
  channel: ChatChannel;
  /** Sender. */
  playerId: string | null;
  clanId: string | null;
  clanName: string;
  clanTag: string | null;
  nickname: string;
  portrait: string | null;
  bannerColor: string;
  body: string;
  createdAt: string;
  mine: boolean;
}
/**
 * GET /api/chat?channel=world | GET /api/chat?channel=clan | GET /api/chat?channel=dm&with=<playerId>
 * Reading the clan channel or a private thread marks it read.
 */
export interface ChatResponse {
  channel: ChatChannel;
  messages: ChatMessageDTO[];
  /** For a private thread: the other player. */
  with: PlayerCardDTO | null;
}
export interface PlayerCardDTO {
  playerId: string;
  nickname: string;
  portrait: string;
  clanId: string | null;
  clanName: string | null;
  clanTag: string | null;
  bannerColor: string | null;
  roleName: string | null;
  level: number;
}
export interface ChatThreadDTO {
  with: PlayerCardDTO;
  lastMessage: { body: string; createdAt: string; mine: boolean };
  unread: number;
}
/** GET /api/chat/threads — private conversations, newest first, and unread counts. */
export interface ChatThreadsResponse {
  threads: ChatThreadDTO[];
  /** Unread messages in the clan channel (0 without a clan). */
  clanUnread: number;
  hasClan: boolean;
}
/** GET /api/players?search=<text> — find players to message or invite. */
export interface PlayerSearchResponse {
  players: PlayerCardDTO[];
}
/** GET /api/players/:id */
export interface PlayerProfileResponse {
  player: PlayerCardDTO;
  pillars: Record<PillarId, number>;
  reputation: number;
  battlesLed: number;
  battlesWon: number;
  contribution: number;
  joinedClanAt: string | null;
  createdAt: string;
  isViewer: boolean;
  /** The viewer may invite this player into their clan. */
  canInvite: boolean;
}

// ---------------------------------------------------------------------------
// Clans: discovery, profile, management, treasury (change request §2, §4)
// ---------------------------------------------------------------------------
/** What the viewer can do about joining a clan. */
export type JoinOption = 'join' | 'apply' | 'accept_invitation' | 'applied' | null;
export interface ClanJoinStateDTO {
  option: JoinOption;
  /** Why the viewer cannot join (already in a clan, full, closed, ...), or null. */
  blockedReason: string | null;
  applicationId: string | null;
  invitationId: string | null;
}
export interface ClanDirectoryEntryDTO {
  clan: ClanPublicDTO;
  /** 0 for clans without land. */
  rank: number;
  /** Region of the clan's headquarters. */
  regionName: string | null;
  join: ClanJoinStateDTO;
  isViewer: boolean;
}
export interface ClanInvitationDTO {
  id: string;
  clan: ClanPublicDTO;
  playerId: string;
  nickname: string;
  invitedBy: string | null;
  createdAt: string;
}
export interface ClanApplicationDTO {
  id: string;
  clanId: string;
  clanName: string;
  player: PlayerCardDTO;
  message: string;
  createdAt: string;
}
/** GET /api/clans */
export interface ClanDirectoryResponse {
  entries: ClanDirectoryEntryDTO[];
  /** Invitations the viewer has received. */
  invitations: ClanInvitationDTO[];
  /** Applications the viewer has sent that are still waiting. */
  applications: ClanApplicationDTO[];
  viewerClanId: string | null;
  maxMembers: number;
}
export interface ClanMemberDTO {
  playerId: string;
  nickname: string;
  portrait: string;
  role: ClanRole;
  roleName: string;
  joinedAt: string;
  /** Weighted value of everything paid into the treasury. */
  contribution: number;
  level: number;
  pillars: Record<PillarId, number>;
  /** Pillars this member currently carries for the clan. */
  carries: PillarId[];
  isYou: boolean;
  /** The viewer may change this member's role or remove them. */
  canManage: boolean;
}
/** GET /api/clans/:id — public profile of any clan. */
export interface ClanProfileResponse {
  clan: ClanPublicDTO;
  rank: number;
  regionName: string | null;
  members: ClanMemberDTO[];
  provinces: { id: string; name: string; isCapital: boolean }[];
  join: ClanJoinStateDTO;
  isMember: boolean;
}
export interface ClanActivityDTO {
  id: number;
  /** joined, left, removed, role, leadership, invited, contribution, withdrawal, settings, permissions, announcement */
  type: string;
  body: string;
  createdAt: string;
}
export interface TreasuryEntryDTO {
  id: number;
  resource: string;
  /** Positive: into the treasury. Negative: out of it. */
  amount: number;
  balanceAfter: number;
  /** e.g. member_contribution, treasury_withdrawal, building_upgrade, recruitment, production, upkeep */
  reason: string;
  /** Member who caused it; null for the simulation (production, upkeep). */
  actor: string | null;
  createdAt: string;
}
export interface ContributionDTO {
  playerId: string;
  nickname: string;
  points: number;
  resources: ResourceBag;
}
/** GET /api/clan — everything about the viewer's own clan. Returned by every clan-management mutation. */
export interface ClanHubResponse {
  clan: ClanSelfDTO;
  membership: MembershipDTO;
  personal: PersonalDTO;
  announcement: { body: string; by: string | null; at: string } | null;
  members: ClanMemberDTO[];
  /** Waiting applications. Empty unless the viewer holds `manage_members`. */
  applications: ClanApplicationDTO[];
  /** Invitations the clan has sent that are still open. */
  invitations: ClanInvitationDTO[];
  /** What each role may do in this clan. */
  permissions: Record<ClanRole, ClanPermission[]>;
  activity: ClanActivityDTO[];
  treasury: {
    /** Latest movements, newest first. */
    log: TreasuryEntryDTO[];
    contributions: ContributionDTO[];
  };
  maxMembers: number;
  /** The clan has lost all its land; the leader must found a new seat. */
  fallen: boolean;
  /** The clan's doctrine and when the leader may next change it. */
  doctrine: { current: DoctrineId | null; setAt: string | null; changeAvailableAt: string | null };
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
  /** payload: { id, channel, with? } — `with` is the other player of a private thread. */
  | 'chat:message'
  /** The viewer's clan or their membership changed: reload /api/player/me and /api/clan. */
  | 'clan:updated'
  /** A clan was founded, dissolved or changed its public profile: reload /api/clans. */
  | 'clan:directory'
  /** payload: { purse } */
  | 'purse:updated'
  /** A war plan of the viewer's clan changed: reload /api/war. */
  | 'war:updated';

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
  /** Clan treasury. */
  resources: ResourceBag | null;
  purse: ResourceBag;
  unreadNotifications: number;
  unreadMessages: number;
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
  /** 2-5 letters or numbers, unique. Left out, one is made from the clan name. */
  tag?: string;
  description?: string;
  recruitment?: RecruitmentMode;
  language?: string;
  /** Name the leader is known by. */
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
  /** TACTIC_DEFS id; defaults to 'assault'. */
  tactic?: TacticId;
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
  type: 'peace' | PactType;
}
/** POST /api/diplomacy/break → DiplomacyResponse. Ends a treaty early, at a cost in loyalty. */
export interface BreakPactRequest {
  pactId: string;
}
/** POST /api/provinces/:id/stance → ProvinceDetailResponse (needs `command`). */
export interface StanceRequest {
  stance: StanceId;
}
/** POST /api/clan/doctrine → ClanHubResponse (leader only). */
export interface DoctrineRequest {
  doctrine: DoctrineId;
}

// ---------------------------------------------------------------------------
// War Council (change request §7)
// ---------------------------------------------------------------------------
export interface WarAssignmentDTO {
  playerId: string;
  nickname: string;
  portrait: string;
  duty: WarDuty;
  dutyName: string;
  status: 'assigned' | 'accepted' | 'declined';
  note: string;
  isYou: boolean;
}
export interface WarPlanDTO {
  id: string;
  title: string;
  /** draft → ready → launched → completed, or cancelled. */
  status: 'draft' | 'ready' | 'launched' | 'completed' | 'cancelled';
  tactic: TacticId;
  targetProvinceId: string;
  targetName: string;
  /** Owner of the target right now; null for unclaimed land. */
  targetOwnerName: string | null;
  originProvinceId: string;
  originName: string;
  units: UnitCounts;
  total: number;
  commander: { playerId: string; nickname: string } | null;
  /** When the clan means to strike (for coordination; launching is a separate order). */
  scheduledAt: string | null;
  /** Retreat condition, backup strategy and anything else the council should know. */
  notes: string;
  createdBy: string | null;
  createdAt: string;
  launchedAt: string | null;
  battleId: string | null;
  /** Battle outcome once fought, or why the plan was abandoned. */
  outcome: string | null;
  assignments: WarAssignmentDTO[];
  /** What the accepted assignments add to the attack. */
  bonuses: { chance: number; morale: number; supplyFactor: number; filled: WarDuty[] };
  /** Chance the tactic comes off against an equally skilled, unprepared defender, bonuses included; null for a plain assault. */
  chance: number | null;
  /** What a fresh scouting report says about the target; null without one. */
  knownStance: { stance: StanceId; stanceName: string; countersTactic: boolean } | null;
  /** Whether the order could be given right now, and what it would take. */
  launch: { ok: boolean; reason: string | null; durationMs: number; supplies: number };
  /** The viewer may edit the plan and its assignments. */
  canEdit: boolean;
  /** The viewer may launch it (holds `command`, or is its commander). */
  canLaunch: boolean;
}
/** GET /api/war — the clan's war council. Returned by every war-plan mutation. */
export interface WarCouncilResponse {
  plans: WarPlanDTO[];
  /** The viewer holds `war_plans`. */
  canPlan: boolean;
  /** Members who can be given duties. */
  members: { playerId: string; nickname: string; portrait: string; roleName: string; level: number; pillars: Record<PillarId, number> }[];
  /** Provinces an attack can start from, with their garrisons. */
  origins: { id: string; name: string; garrison: UnitCounts }[];
  /** Provinces the clan does not hold. */
  targets: { id: string; name: string; ownerName: string | null; relation: ProvinceRelation; terrain: Terrain }[];
  /** Clan pillar levels, for tactic requirements. */
  levels: Record<PillarId, number>;
}
/** POST /api/war/plans (create) and POST /api/war/plans/:id (edit a draft or ready plan) → WarCouncilResponse (needs war_plans) */
export interface WarPlanRequest {
  title: string;
  targetProvinceId: string;
  originProvinceId: string;
  tactic: TacticId;
  units: Partial<UnitCounts>;
  commanderId: string | null;
  scheduledAt?: string | null;
  notes?: string;
}
/** POST /api/war/plans/:id/status → WarCouncilResponse (needs war_plans) */
export interface WarPlanStatusRequest {
  status: 'draft' | 'ready' | 'cancelled';
}
/** POST /api/war/plans/:id/assign and .../unassign → WarCouncilResponse (needs war_plans). The commander is set on the plan itself. */
export interface WarAssignRequest {
  playerId: string;
  duty: WarDuty;
  note?: string;
}
/** POST /api/war/plans/:id/respond → WarCouncilResponse. A member accepts or declines a duty given to them. */
export interface WarRespondRequest {
  duty: WarDuty;
  accept: boolean;
}
/** POST /api/war/plans/:id/launch → WarCouncilResponse. The plan must be ready; needs `command`, or being its commander. */

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
  /** Defaults to 'world'. */
  channel?: ChatChannel;
  /** Recipient player id, for channel 'dm'. */
  to?: string;
  body: string;
}
/** POST /api/chat/read → ChatThreadsResponse. `thread` is 'clan' or the other player's id. */
export interface ChatReadRequest {
  thread: string;
}
/** POST /api/clans/:id/join → MeResponse (open clans). */
/** POST /api/clans/:id/apply → ClanDirectoryResponse */
export interface ApplyRequest {
  message?: string;
}
/** POST /api/clan/applications → ClanHubResponse (needs manage_members) */
export interface AnswerApplicationRequest {
  applicationId: string;
  accept: boolean;
}
/** POST /api/clan/applications/withdraw → ClanDirectoryResponse */
export interface WithdrawApplicationRequest {
  applicationId: string;
}
/** POST /api/clan/invitations → ClanHubResponse (needs manage_members) */
export interface InviteRequest {
  nickname: string;
}
/** POST /api/clan/invitations/revoke → ClanHubResponse */
export interface RevokeInvitationRequest {
  invitationId: string;
}
/** POST /api/clan/invitations/respond → MeResponse */
export interface AnswerInvitationRequest {
  invitationId: string;
  accept: boolean;
}
/** POST /api/clan/leave → MeResponse */
/** POST /api/clan/members/role → ClanHubResponse (needs manage_members; only below your own rank) */
export interface SetRoleRequest {
  playerId: string;
  role: ClanRole;
}
/** POST /api/clan/members/kick and POST /api/clan/members/transfer → ClanHubResponse */
export interface MemberRequest {
  playerId: string;
}
/** POST /api/clan/settings → ClanHubResponse (needs manage_clan) */
export interface ClanSettingsRequest {
  description?: string;
  recruitment?: RecruitmentMode;
  language?: string;
}
/** POST /api/clan/permissions → ClanHubResponse (leader only) */
export interface SetPermissionsRequest {
  role: ClanRole;
  permissions: ClanPermission[];
}
/** POST /api/clan/announcement → ClanHubResponse (needs manage_clan). An empty body clears it. */
export interface AnnouncementRequest {
  body: string;
}
/** POST /api/clan/contribute → ClanHubResponse. Moves resources from the viewer's purse to the treasury. */
export interface ContributeRequest {
  resources: Partial<ResourceBag>;
}
/** POST /api/clan/withdraw → ClanHubResponse (needs treasury). Pays treasury resources to a member's purse. */
export interface WithdrawRequest {
  playerId: string;
  resources: Partial<ResourceBag>;
  note?: string;
}
/** POST /api/player/residence → MeResponse. Upgrades the residence by one level from the purse. */
/** POST /api/player/profile → MeResponse */
export interface ProfileRequest {
  portrait?: string;
  trainingFocus?: PillarId;
}
