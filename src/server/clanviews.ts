/**
 * Read models for clans, members, the personal economy and chat. Like the
 * rest of the read models these only read (apart from the "read up to here"
 * marker of a chat thread) and apply the visibility rules: a clan's treasury
 * log, applications and chat are only ever shown to its members.
 */
import type {
  ChatChannel,
  ChatMessageDTO,
  ChatResponse,
  ChatThreadsResponse,
  ClanApplicationDTO,
  ClanDirectoryEntryDTO,
  ClanDirectoryResponse,
  ClanHubResponse,
  ClanInvitationDTO,
  ClanJoinStateDTO,
  ClanMemberDTO,
  ClanProfileResponse,
  MembershipDTO,
  PersonalDTO,
  PlayerCardDTO,
  PlayerProfileResponse,
  PlayerRankDTO,
  PlayerSearchResponse,
} from '@/game/api';
import {
  DOCTRINES,
  DOCTRINE_COOLDOWN_HOURS,
  type DoctrineId,
  CLAN_PERMISSIONS,
  CLAN_ROLES,
  CLAN_RULES,
  PERSONAL,
  ROLE_DEFS,
  outranks,
  playerLevel,
  residenceCost,
  residenceIncome,
  type ClanPermission,
  type ClanRole,
} from '@/game/clan';
import { RESOURCE_KEYS, emptyBag, type ResourceBag } from '@/game/config';
import { PROVINCE_BY_CODE, REGIONS } from '@/game/map';
import { PILLARS, type PillarId } from '@/game/pillars';
import type { Membership } from './auth';
import { one, rows, type Db } from './db';
import { GameError, notFound } from './errors';
import { getPurse } from './purse';
import { loadPlayerProgress, type ClanRow } from './rows';
import { clanPublic, clanSelf, loadWorldView, ranking, type Viewer, type WorldView } from './views';
import { gameMs } from './world';

const iso = (d: Date) => d.toISOString();

export function membershipDTO(member: Membership | null): MembershipDTO | null {
  if (!member) return null;
  return {
    clanId: member.clanId,
    role: member.role,
    roleName: ROLE_DEFS[member.role].name,
    permissions: member.permissions,
    joinedAt: new Date(member.joinedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Personal economy
// ---------------------------------------------------------------------------

export async function buildPersonal(db: Db, viewer: Viewer): Promise<PersonalDTO> {
  const id = viewer.player.id;
  const row = await one<{ residence_level: number; training_focus: PillarId; reputation: number; battles_led: number; battles_won: number }>(
    db,
    'SELECT residence_level, training_focus, reputation, battles_led, battles_won FROM players WHERE id = $1',
    [id],
  );
  const progress = (await loadPlayerProgress(db, [id])).get(id)!;
  const level = row?.residence_level ?? 1;
  const holdsLand = viewer.clan
    ? !!(await one(db, `SELECT 1 FROM provinces WHERE owner_clan_id = $1 LIMIT 1`, [viewer.clan.id])) && viewer.clan.status === 'active'
    : false;
  return {
    purse: await getPurse(db, id),
    residenceLevel: level,
    maxResidenceLevel: PERSONAL.maxResidenceLevel,
    residenceIncome: residenceIncome(level, progress.levels.economy),
    incomeActive: holdsLand,
    nextResidenceCost: level < PERSONAL.maxResidenceLevel ? residenceCost(level + 1) : null,
    trainingFocus: row?.training_focus ?? 'military',
    trainingXpPerHour: 3 + level,
    level: playerLevel(progress.levels),
    reputation: row?.reputation ?? 0,
    battlesLed: row?.battles_led ?? 0,
    battlesWon: row?.battles_won ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

const CARD_SELECT = `
  SELECT p.id, p.nickname, p.portrait, p.created_at, p.reputation, p.battles_led, p.battles_won,
         m.role, m.joined_at, m.contribution, c.id AS clan_id, c.name AS clan_name, c.tag AS clan_tag, c.banner_color,
         (COALESCE((SELECT SUM(pp.level - 1) FROM player_pillars pp WHERE pp.player_id = p.id), 0) + 1)::int AS level
    FROM players p
    LEFT JOIN clan_members m ON m.player_id = p.id
    LEFT JOIN clans c ON c.id = m.clan_id`;

function toCard(r: any): PlayerCardDTO {
  return {
    playerId: r.id,
    nickname: r.nickname,
    portrait: r.portrait,
    clanId: r.clan_id ?? null,
    clanName: r.clan_name ?? null,
    clanTag: r.clan_tag ?? null,
    bannerColor: r.banner_color ?? null,
    roleName: r.role ? ROLE_DEFS[r.role as ClanRole].name : null,
    level: r.level,
  };
}

export async function playerCards(db: Db, ids: string[]): Promise<Map<string, PlayerCardDTO>> {
  if (ids.length === 0) return new Map();
  const res = await rows<any>(db, `${CARD_SELECT} WHERE p.id = ANY($1)`, [ids]);
  return new Map(res.map((r) => [r.id as string, toCard(r)]));
}

export async function buildPlayerSearch(db: Db, viewer: Viewer, search: string): Promise<PlayerSearchResponse> {
  const q = search.trim().slice(0, 30);
  const res = q
    ? await rows<any>(db, `${CARD_SELECT} WHERE p.nickname ILIKE $1 AND p.id <> $2 ORDER BY p.nickname LIMIT 20`, [
        `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`,
        viewer.player.id,
      ])
    : await rows<any>(db, `${CARD_SELECT} WHERE p.id <> $1 ORDER BY p.created_at DESC LIMIT 20`, [viewer.player.id]);
  return { players: res.map(toCard) };
}

export async function buildPlayerProfile(db: Db, viewer: Viewer, playerId: string): Promise<PlayerProfileResponse> {
  const r = await one<any>(db, `${CARD_SELECT} WHERE p.id = $1`, [playerId]);
  if (!r) throw notFound('Player');
  const progress = (await loadPlayerProgress(db, [playerId])).get(playerId)!;
  const canInvite =
    !!viewer.member &&
    viewer.clan?.status === 'active' &&
    viewer.member.permissions.includes('manage_members') &&
    r.clan_id !== viewer.member.clanId &&
    playerId !== viewer.player.id;
  return {
    player: toCard(r),
    pillars: progress.levels,
    reputation: r.reputation,
    battlesLed: r.battles_led,
    battlesWon: r.battles_won,
    contribution: Number(r.contribution ?? 0),
    joinedClanAt: r.joined_at ? iso(r.joined_at) : null,
    createdAt: iso(r.created_at),
    isViewer: playerId === viewer.player.id,
    canInvite,
  };
}

export async function buildPlayerRanking(db: Db, viewer: Viewer): Promise<PlayerRankDTO[]> {
  const res = await rows<any>(
    db,
    `SELECT x.*, (x.level * 100 + COALESCE(x.contribution, 0) / 20 + x.battles_won * 150 + x.reputation * 10)::int AS score
       FROM (${CARD_SELECT}) x
      ORDER BY score DESC, x.nickname LIMIT 50`,
  );
  return res.map((r, i) => ({
    rank: i + 1,
    playerId: r.id,
    nickname: r.nickname,
    portrait: r.portrait,
    clanId: r.clan_id ?? null,
    clanName: r.clan_name ?? null,
    clanTag: r.clan_tag ?? null,
    roleName: r.role ? ROLE_DEFS[r.role as ClanRole].name : null,
    level: r.level,
    contribution: Number(r.contribution ?? 0),
    battlesWon: r.battles_won,
    reputation: r.reputation,
    score: r.score,
    isViewer: r.id === viewer.player.id,
  }));
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function memberList(db: Db, view: WorldView, clan: ClanRow, viewer: Viewer): Promise<ClanMemberDTO[]> {
  const res = await rows<{ player_id: string; role: ClanRole; joined_at: Date; contribution: number; nickname: string; portrait: string }>(
    db,
    `SELECT m.player_id, m.role, m.joined_at, m.contribution, p.nickname, p.portrait
       FROM clan_members m JOIN players p ON p.id = m.player_id WHERE m.clan_id = $1`,
    [clan.id],
  );
  const people = await loadPlayerProgress(db, res.map((r) => r.player_id));
  const seats = view.progress.get(clan.id)?.seats ?? {};
  const mine = viewer.member && viewer.member.clanId === clan.id ? viewer.member : null;
  const canManageMembers = !!mine && mine.permissions.includes('manage_members');
  return res
    .map((r) => {
      const levels = people.get(r.player_id)!.levels;
      return {
        playerId: r.player_id,
        nickname: r.nickname,
        portrait: r.portrait,
        role: r.role,
        roleName: ROLE_DEFS[r.role].name,
        joinedAt: iso(r.joined_at),
        contribution: Number(r.contribution),
        level: playerLevel(levels),
        pillars: levels,
        carries: PILLARS.filter((p) => seats[p] === r.player_id),
        isYou: r.player_id === viewer.player.id,
        canManage: canManageMembers && r.player_id !== viewer.player.id && outranks(mine!.role, r.role),
      };
    })
    .sort((a, b) => ROLE_DEFS[b.role].rank - ROLE_DEFS[a.role].rank || CLAN_ROLES.indexOf(a.role) - CLAN_ROLES.indexOf(b.role) || b.contribution - a.contribution || a.nickname.localeCompare(b.nickname));
}

function regionOf(view: WorldView, clan: ClanRow): string | null {
  const capital = view.provinces.find((p) => p.id === clan.capital_province_id);
  if (!capital) return null;
  return REGIONS.find((r) => r.id === capital.region_id)?.name ?? null;
}

interface JoinContext {
  viewer: Viewer;
  applications: Map<string, string>;
  invitations: Map<string, string>;
}

function joinState(view: WorldView, clan: ClanRow, ctx: JoinContext): ClanJoinStateDTO {
  const applicationId = ctx.applications.get(clan.id) ?? null;
  const invitationId = ctx.invitations.get(clan.id) ?? null;
  const base = { applicationId, invitationId };
  if (ctx.viewer.member?.clanId === clan.id) return { option: null, blockedReason: 'You are a member', ...base };
  if (clan.is_npc) return { option: null, blockedReason: 'A government of the old order; it takes in no outsiders', ...base };
  if (clan.status !== 'active') return { option: null, blockedReason: 'This nation has fallen', ...base };
  if (ctx.viewer.member) return { option: null, blockedReason: 'Leave your nation before joining another', ...base };
  if ((view.memberCounts.get(clan.id) ?? 0) >= CLAN_RULES.maxMembers) return { option: null, blockedReason: 'This nation is full', ...base };
  if (invitationId) return { option: 'accept_invitation', blockedReason: null, ...base };
  if (clan.recruitment === 'open') return { option: 'join', blockedReason: null, ...base };
  if (clan.recruitment === 'application') {
    return applicationId ? { option: 'applied', blockedReason: null, ...base } : { option: 'apply', blockedReason: null, ...base };
  }
  return { option: null, blockedReason: clan.recruitment === 'invite' ? 'By invitation only' : 'Not taking new members', ...base };
}

async function joinContext(db: Db, viewer: Viewer): Promise<JoinContext> {
  const apps = await rows<{ id: string; clan_id: string }>(db, `SELECT id, clan_id FROM clan_applications WHERE player_id = $1 AND status = 'pending'`, [
    viewer.player.id,
  ]);
  const invs = await rows<{ id: string; clan_id: string }>(db, `SELECT id, clan_id FROM clan_invitations WHERE player_id = $1 AND status = 'pending'`, [
    viewer.player.id,
  ]);
  return { viewer, applications: new Map(apps.map((a) => [a.clan_id, a.id])), invitations: new Map(invs.map((i) => [i.clan_id, i.id])) };
}

async function invitationList(db: Db, view: WorldView, where: string, params: unknown[]): Promise<ClanInvitationDTO[]> {
  const res = await rows<any>(
    db,
    `SELECT i.id, i.clan_id, i.player_id, i.created_at, p.nickname, b.nickname AS invited_by
       FROM clan_invitations i JOIN players p ON p.id = i.player_id LEFT JOIN players b ON b.id = i.invited_by
      WHERE i.status = 'pending' AND ${where} ORDER BY i.created_at DESC`,
    params,
  );
  const out: ClanInvitationDTO[] = [];
  for (const r of res) {
    const clan = view.clans.find((c) => c.id === r.clan_id);
    if (!clan) continue;
    out.push({ id: r.id, clan: clanPublic(view, clan), playerId: r.player_id, nickname: r.nickname, invitedBy: r.invited_by ?? null, createdAt: iso(r.created_at) });
  }
  return out;
}

async function applicationList(db: Db, where: string, params: unknown[]): Promise<ClanApplicationDTO[]> {
  const res = await rows<any>(
    db,
    `SELECT a.id, a.clan_id, a.player_id, a.message, a.created_at, c.name AS clan_name
       FROM clan_applications a JOIN clans c ON c.id = a.clan_id
      WHERE a.status = 'pending' AND ${where} ORDER BY a.created_at`,
    params,
  );
  const cards = await playerCards(db, res.map((r) => r.player_id));
  return res
    .filter((r) => cards.has(r.player_id))
    .map((r) => ({ id: r.id, clanId: r.clan_id, clanName: r.clan_name, player: cards.get(r.player_id)!, message: r.message, createdAt: iso(r.created_at) }));
}

// ---------------------------------------------------------------------------
// Discovery and profile
// ---------------------------------------------------------------------------

export interface DirectoryFilter {
  search: string;
  language: string;
  recruitment: string;
  sort: string;
}

export async function buildClanDirectory(db: Db, viewer: Viewer, now: Date, filter: DirectoryFilter): Promise<ClanDirectoryResponse> {
  const view = await loadWorldView(db, now);
  const ctx = await joinContext(db, viewer);
  const ranked = ranking(view);
  const q = filter.search.trim().toLowerCase();
  let list = view.clans.filter((c) => c.status !== 'disbanded');
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.tag.toLowerCase().includes(q));
  if (filter.language) list = list.filter((c) => c.language === filter.language);
  if (filter.recruitment) list = list.filter((c) => !c.is_npc && c.recruitment === filter.recruitment);
  const entries: ClanDirectoryEntryDTO[] = list.map((clan) => ({
    clan: clanPublic(view, clan),
    rank: ranked.findIndex((c) => c.id === clan.id) + 1,
    regionName: regionOf(view, clan),
    join: joinState(view, clan, ctx),
    isViewer: viewer.member?.clanId === clan.id,
  }));
  const rankOrder = (e: ClanDirectoryEntryDTO) => (e.rank > 0 ? e.rank : 9999);
  if (filter.sort === 'members') entries.sort((a, b) => b.clan.memberCount - a.clan.memberCount || rankOrder(a) - rankOrder(b));
  else if (filter.sort === 'name') entries.sort((a, b) => a.clan.name.localeCompare(b.clan.name));
  else entries.sort((a, b) => rankOrder(a) - rankOrder(b) || a.clan.name.localeCompare(b.clan.name));
  return {
    entries,
    invitations: await invitationList(db, view, 'i.player_id = $1', [viewer.player.id]),
    applications: await applicationList(db, 'a.player_id = $1', [viewer.player.id]),
    viewerClanId: viewer.member?.clanId ?? null,
    maxMembers: CLAN_RULES.maxMembers,
  };
}

export async function buildClanProfile(db: Db, viewer: Viewer, clanId: string, now: Date): Promise<ClanProfileResponse> {
  const view = await loadWorldView(db, now);
  const clan = view.clans.find((c) => c.id === clanId && c.status !== 'disbanded');
  if (!clan) throw notFound('Nation');
  const ctx = await joinContext(db, viewer);
  return {
    clan: clanPublic(view, clan),
    rank: ranking(view).findIndex((c) => c.id === clan.id) + 1,
    regionName: regionOf(view, clan),
    members: await memberList(db, view, clan, viewer),
    provinces: view.provinces
      .filter((p) => p.owner_clan_id === clan.id)
      .map((p) => ({ id: p.id, name: PROVINCE_BY_CODE[p.code]?.name ?? p.name, isCapital: p.id === clan.capital_province_id })),
    join: joinState(view, clan, ctx),
    isMember: viewer.member?.clanId === clan.id,
  };
}

// ---------------------------------------------------------------------------
// The viewer's own clan
// ---------------------------------------------------------------------------

export async function buildClanHub(db: Db, viewer: Viewer, now: Date): Promise<ClanHubResponse> {
  if (!viewer.clan || !viewer.member) throw new GameError('NO_CLAN', 'Join or found a nation first', 409);
  const clan = viewer.clan;
  const view = await loadWorldView(db, now);
  const canManageMembers = viewer.member.permissions.includes('manage_members');

  const permRows = await rows<{ role: ClanRole; permission: ClanPermission }>(db, 'SELECT role, permission FROM clan_role_permissions WHERE clan_id = $1', [
    clan.id,
  ]);
  const permissions = Object.fromEntries(CLAN_ROLES.map((r) => [r, [] as ClanPermission[]])) as Record<ClanRole, ClanPermission[]>;
  for (const r of permRows) permissions[r.role]?.push(r.permission);
  permissions.leader = [...CLAN_PERMISSIONS];

  const activity = await rows<any>(db, 'SELECT id, type, body, created_at FROM clan_activity WHERE clan_id = $1 ORDER BY id DESC LIMIT 40', [clan.id]);
  const log = await rows<any>(
    db,
    `SELECT t.id, t.resource, t.amount, t.balance_after, t.reason, t.created_at, p.nickname AS actor
       FROM transactions t LEFT JOIN players p ON p.id = t.actor_player_id
      WHERE t.clan_id = $1 AND t.reason NOT IN ('production', 'population_food', 'army_upkeep')
      ORDER BY t.id DESC LIMIT 60`,
    [clan.id],
  );
  const contribRows = await rows<{ player_id: string; nickname: string; resource: string; amount: number; points: number }>(
    db,
    `SELECT m.player_id, p.nickname, c.resource, COALESCE(c.amount, 0) AS amount, m.contribution AS points
       FROM clan_members m JOIN players p ON p.id = m.player_id
       LEFT JOIN clan_contributions c ON c.clan_id = m.clan_id AND c.player_id = m.player_id
      WHERE m.clan_id = $1`,
    [clan.id],
  );
  const contributions = new Map<string, { playerId: string; nickname: string; points: number; resources: ResourceBag }>();
  for (const r of contribRows) {
    const entry = contributions.get(r.player_id) ?? { playerId: r.player_id, nickname: r.nickname, points: Number(r.points), resources: emptyBag() };
    if (r.resource && (RESOURCE_KEYS as readonly string[]).includes(r.resource)) entry.resources[r.resource as keyof ResourceBag] = Number(r.amount);
    contributions.set(r.player_id, entry);
  }

  let announcement: ClanHubResponse['announcement'] = null;
  if (clan.announcement && clan.announcement_at) {
    const by = clan.announcement_by ? await one<{ nickname: string }>(db, 'SELECT nickname FROM players WHERE id = $1', [clan.announcement_by]) : null;
    announcement = { body: clan.announcement, by: by?.nickname ?? null, at: iso(new Date(clan.announcement_at)) };
  }

  return {
    clan: await clanSelf(db, view, clan),
    membership: membershipDTO(viewer.member)!,
    personal: await buildPersonal(db, viewer),
    announcement,
    members: await memberList(db, view, clan, viewer),
    applications: canManageMembers ? await applicationList(db, 'a.clan_id = $1', [clan.id]) : [],
    invitations: await invitationList(db, view, 'i.clan_id = $1', [clan.id]),
    permissions,
    activity: activity.map((a) => ({ id: Number(a.id), type: a.type, body: a.body, createdAt: iso(a.created_at) })),
    treasury: {
      log: log.map((t) => ({
        id: Number(t.id),
        resource: t.resource,
        amount: Number(t.amount),
        balanceAfter: Number(t.balance_after),
        reason: t.reason,
        actor: t.actor ?? null,
        createdAt: iso(t.created_at),
      })),
      contributions: [...contributions.values()].sort((a, b) => b.points - a.points || a.nickname.localeCompare(b.nickname)),
    },
    maxMembers: CLAN_RULES.maxMembers,
    fallen: clan.status !== 'active',
    doctrine: {
      current: (DOCTRINES as readonly string[]).includes(clan.doctrine ?? '') ? (clan.doctrine as DoctrineId) : null,
      setAt: clan.doctrine_set_at ? iso(new Date(clan.doctrine_set_at)) : null,
      changeAvailableAt:
        clan.doctrine && clan.doctrine_set_at
          ? iso(new Date(new Date(clan.doctrine_set_at).getTime() + gameMs({ speed: view.state.speed }, DOCTRINE_COOLDOWN_HOURS * 60)))
          : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

const CHAT_SELECT = `
  SELECT m.id, m.channel, m.player_id, m.recipient_player_id, m.clan_id, m.body, m.created_at,
         COALESCE(c.name, 'Wanderer') AS clan_name, c.tag AS clan_tag,
         COALESCE(p.nickname, 'unknown') AS nickname, p.portrait, COALESCE(c.banner_color, 'slate') AS banner_color
    FROM chat_messages m LEFT JOIN clans c ON c.id = m.clan_id LEFT JOIN players p ON p.id = m.player_id`;

function toChat(m: any, viewerId: string): ChatMessageDTO {
  return {
    id: Number(m.id),
    channel: m.channel,
    playerId: m.player_id,
    clanId: m.clan_id,
    clanName: m.clan_name,
    clanTag: m.clan_tag ?? null,
    nickname: m.nickname,
    portrait: m.portrait ?? null,
    bannerColor: m.banner_color,
    body: m.body,
    createdAt: iso(m.created_at),
    mine: m.player_id === viewerId,
  };
}

const dmThread = (otherId: string) => `dm:${otherId}`;

async function markThreadRead(db: Db, playerId: string, thread: string, lastId: number): Promise<void> {
  if (lastId <= 0) return;
  await db.query(
    `INSERT INTO chat_reads (player_id, thread, last_read_id) VALUES ($1, $2, $3)
     ON CONFLICT (player_id, thread) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id)`,
    [playerId, thread, lastId],
  );
}

/** Mark the clan channel ('clan') or a private thread (the other player's id) read up to its newest message. */
export async function markChatRead(db: Db, viewer: Viewer, thread: string): Promise<void> {
  const me = viewer.player.id;
  if (thread === 'clan') {
    if (!viewer.member) return;
    const last = await one<{ id: number }>(db, `SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE channel = 'clan' AND clan_id = $1`, [viewer.member.clanId]);
    await markThreadRead(db, me, 'clan', Number(last?.id ?? 0));
    return;
  }
  if (!/^[0-9a-f-]{36}$/i.test(thread)) return;
  const last = await one<{ id: number }>(
    db,
    `SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages
      WHERE channel = 'dm' AND ((player_id = $1 AND recipient_player_id = $2) OR (player_id = $2 AND recipient_player_id = $1))`,
    [me, thread],
  );
  await markThreadRead(db, me, dmThread(thread), Number(last?.id ?? 0));
}

export async function buildChat(db: Db, viewer: Viewer, channel: ChatChannel, withId: string | null): Promise<ChatResponse> {
  const me = viewer.player.id;
  if (channel === 'clan') {
    if (!viewer.member) throw new GameError('NO_CLAN', 'Join a nation to use the nation channel', 409);
    const res = await rows<any>(db, `${CHAT_SELECT} WHERE m.channel = 'clan' AND m.clan_id = $1 ORDER BY m.id DESC LIMIT 100`, [viewer.member.clanId]);
    await markChatRead(db, viewer, 'clan');
    return { channel, messages: res.reverse().map((m) => toChat(m, me)), with: null };
  }
  if (channel === 'dm') {
    if (!withId) throw new GameError('INVALID', 'Choose who to talk to', 400);
    const other = (await playerCards(db, [withId])).get(withId);
    if (!other || withId === me) throw notFound('Player');
    const res = await rows<any>(
      db,
      `${CHAT_SELECT} WHERE m.channel = 'dm' AND ((m.player_id = $1 AND m.recipient_player_id = $2) OR (m.player_id = $2 AND m.recipient_player_id = $1))
        ORDER BY m.id DESC LIMIT 100`,
      [me, withId],
    );
    await markChatRead(db, viewer, withId);
    return { channel, messages: res.reverse().map((m) => toChat(m, me)), with: other };
  }
  const res = await rows<any>(db, `${CHAT_SELECT} WHERE m.channel = 'world' ORDER BY m.id DESC LIMIT 80`);
  return { channel: 'world', messages: res.reverse().map((m) => toChat(m, me)), with: null };
}

/** One message, only if the viewer may read it. */
export async function buildChatMessage(db: Db, viewer: Viewer, id: number): Promise<ChatMessageDTO> {
  const m = await one<any>(db, `${CHAT_SELECT} WHERE m.id = $1`, [id]);
  if (!m) throw notFound('Message');
  const me = viewer.player.id;
  const allowed =
    m.channel === 'world' ||
    (m.channel === 'clan' && viewer.member?.clanId === m.clan_id) ||
    (m.channel === 'dm' && (m.player_id === me || m.recipient_player_id === me));
  if (!allowed) throw notFound('Message');
  return toChat(m, me);
}

async function clanUnread(db: Db, viewer: Viewer): Promise<number> {
  if (!viewer.member) return 0;
  const row = await one<{ n: number }>(
    db,
    `SELECT COUNT(*)::int AS n FROM chat_messages m
      WHERE m.channel = 'clan' AND m.clan_id = $2 AND m.player_id IS DISTINCT FROM $1
        AND m.id > COALESCE((SELECT last_read_id FROM chat_reads r WHERE r.player_id = $1 AND r.thread = 'clan'), 0)
        AND m.created_at >= $3`,
    [viewer.player.id, viewer.member.clanId, new Date(viewer.member.joinedAt)],
  );
  return row?.n ?? 0;
}

async function dmUnread(db: Db, playerId: string): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    `SELECT COUNT(*)::int AS n FROM chat_messages m
      WHERE m.channel = 'dm' AND m.recipient_player_id = $1
        AND m.id > COALESCE((SELECT last_read_id FROM chat_reads r WHERE r.player_id = $1 AND r.thread = 'dm:' || m.player_id::text), 0)`,
    [playerId],
  );
  return row?.n ?? 0;
}

export async function unreadMessages(db: Db, viewer: Viewer): Promise<number> {
  return (await dmUnread(db, viewer.player.id)) + (await clanUnread(db, viewer));
}

export async function buildChatThreads(db: Db, viewer: Viewer): Promise<ChatThreadsResponse> {
  const me = viewer.player.id;
  const res = await rows<any>(
    db,
    `WITH mine AS (
       SELECT m.id, m.body, m.created_at, m.player_id,
              CASE WHEN m.player_id = $1 THEN m.recipient_player_id ELSE m.player_id END AS other
         FROM chat_messages m
        WHERE m.channel = 'dm' AND (m.player_id = $1 OR m.recipient_player_id = $1)
     ), latest AS (
       SELECT DISTINCT ON (other) other, id, body, created_at, player_id FROM mine WHERE other IS NOT NULL ORDER BY other, id DESC
     )
     SELECT l.other, l.id, l.body, l.created_at, l.player_id,
            (SELECT COUNT(*)::int FROM mine x
              WHERE x.other = l.other AND x.player_id IS DISTINCT FROM $1 AND x.id > COALESCE(r.last_read_id, 0)) AS unread
       FROM latest l LEFT JOIN chat_reads r ON r.player_id = $1 AND r.thread = 'dm:' || l.other::text
      ORDER BY l.id DESC LIMIT 60`,
    [me],
  );
  const cards = await playerCards(db, res.map((r) => r.other));
  return {
    threads: res
      .filter((r) => cards.has(r.other))
      .map((r) => ({
        with: cards.get(r.other)!,
        lastMessage: { body: r.body, createdAt: iso(r.created_at), mine: r.player_id === me },
        unread: r.unread,
      })),
    clanUnread: await clanUnread(db, viewer),
    hasClan: !!viewer.member,
  };
}
