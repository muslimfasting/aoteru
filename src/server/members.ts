/**
 * Clan membership (change request §2): joining, applications, invitations,
 * roles, permissions, leaving and disbanding. Every function runs inside the
 * caller's transaction under the world lock and re-reads the rows it judges.
 */
import {
  DOCTRINES,
  DOCTRINE_COOLDOWN_HOURS,
  DOCTRINE_DEFS,
  CLAN_LANGUAGES,
  CLAN_PERMISSIONS,
  CLAN_ROLES,
  CLAN_RULES,
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  RECRUITMENT_MODES,
  ROLE_DEFS,
  outranks,
  type ClanPermission,
  type ClanRole,
  type RecruitmentMode,
} from '@/game/clan';
import { normalizeUnits } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import { ensureGarrison, setArmyUnits } from './armies';
import { one, rows, type Db } from './db';
import { GameError, conflict, invalid, notFound } from './errors';
import { audit, chronicle, clanActivity, emit, notifyClan, notifyClanRoles, notifyPlayer, playerRoom, WORLD_ROOM } from './notify';
import type { ClanRow, MemberRow, ProvinceRow } from './rows';
import { transferProvince } from './territory';
import { addMs, dayLabel, gameMs, type G } from './world';

interface PlayerRef {
  id: string;
  nickname: string;
}

const text = (value: string, max: number) => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);

async function membershipOf(tx: Db, playerId: string): Promise<MemberRow | null> {
  return one<MemberRow>(tx, 'SELECT player_id, clan_id, role, joined_at, contribution FROM clan_members WHERE player_id = $1 FOR UPDATE', [playerId]);
}

async function lockClan(tx: Db, clanId: string): Promise<ClanRow> {
  const clan = await one<ClanRow>(tx, 'SELECT * FROM clans WHERE id = $1 FOR UPDATE', [clanId]);
  if (!clan || clan.status === 'disbanded') throw notFound('Nation');
  return clan;
}

async function memberCount(tx: Db, clanId: string): Promise<number> {
  const row = await one<{ n: number }>(tx, 'SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [clanId]);
  return row?.n ?? 0;
}

/** Write a clan's permission table from the defaults. */
export async function seedPermissions(tx: Db, clanId: string): Promise<void> {
  for (const role of CONFIGURABLE_ROLES) {
    for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) {
      await tx.query('INSERT INTO clan_role_permissions (clan_id, role, permission) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [clanId, role, permission]);
    }
  }
}

function assertJoinable(clan: ClanRow, count: number): void {
  if (clan.is_npc) throw conflict('NOT_JOINABLE', 'That nation does not take in outsiders');
  if (clan.status !== 'active') throw conflict('NOT_JOINABLE', 'That nation has fallen');
  if (count >= CLAN_RULES.maxMembers) throw conflict('CLAN_FULL', `${clan.name} is full (${CLAN_RULES.maxMembers} members)`);
}

async function assertFree(tx: Db, playerId: string): Promise<void> {
  const current = await membershipOf(tx, playerId);
  if (current) throw conflict('ALREADY_IN_CLAN', 'You already belong to a nation. Leave it first.');
}

/** Admit a player. Their other pending applications and invitations are closed. */
async function addMember(g: G, clan: ClanRow, player: PlayerRef, how: string): Promise<void> {
  await g.tx.query(`INSERT INTO clan_members (player_id, clan_id, role, joined_at) VALUES ($1, $2, 'recruit', $3)`, [player.id, clan.id, g.now]);
  await g.tx.query(`UPDATE clan_applications SET status = 'withdrawn', decided_at = $2 WHERE player_id = $1 AND status = 'pending'`, [player.id, g.now]);
  await g.tx.query(`UPDATE clan_invitations SET status = 'declined', decided_at = $2 WHERE player_id = $1 AND status = 'pending'`, [player.id, g.now]);
  await clanActivity(g, clan.id, 'joined', `${player.nickname} joined the nation${how}.`);
  await notifyClan(
    g,
    clan.id,
    { type: 'clan', title: `${player.nickname} has joined ${clan.name}`, body: `A new ${ROLE_DEFS.recruit.name.toLowerCase()} takes the oath of office${how}.`, link: '/game/clan' },
    player.id,
  );
  await emit(g, playerRoom(player.id), 'clan:updated', { clanId: clan.id, type: 'joined' });
  await emit(g, WORLD_ROOM, 'clan:directory', { clanId: clan.id });
  await audit(g, 'clan.join', { type: 'clan', id: clan.id }, clan.id, { player: player.nickname });
}

/** Join a clan with open recruitment. */
export async function joinClan(g: G, player: PlayerRef, clanId: string): Promise<void> {
  await assertFree(g.tx, player.id);
  const clan = await lockClan(g.tx, clanId);
  assertJoinable(clan, await memberCount(g.tx, clan.id));
  if (clan.recruitment !== 'open') {
    throw conflict('NOT_OPEN', clan.recruitment === 'application' ? `${clan.name} asks for an application` : `${clan.name} is not open to join`);
  }
  await addMember(g, clan, player, '');
}

export async function applyToClan(g: G, player: PlayerRef, clanId: string, message: string): Promise<void> {
  await assertFree(g.tx, player.id);
  const clan = await lockClan(g.tx, clanId);
  assertJoinable(clan, await memberCount(g.tx, clan.id));
  if (clan.recruitment === 'open') return joinClan(g, player, clanId);
  if (clan.recruitment !== 'application') throw conflict('NOT_OPEN', `${clan.name} does not take applications`);
  const pending = await one(g.tx, `SELECT 1 FROM clan_applications WHERE clan_id = $1 AND player_id = $2 AND status = 'pending'`, [clan.id, player.id]);
  if (pending) throw conflict('ALREADY_APPLIED', 'Your application is already waiting for an answer');
  await g.tx.query('INSERT INTO clan_applications (clan_id, player_id, message, created_at) VALUES ($1, $2, $3, $4)', [
    clan.id,
    player.id,
    text(message, CLAN_RULES.applicationMessageMax),
    g.now,
  ]);
  await notifyClanRoles(g, clan.id, 'manage_members', {
    type: 'clan',
    title: `${player.nickname} asks to join`,
    body: `An application to join ${clan.name} is waiting for an answer.`,
    link: '/game/clan',
  });
  await emit(g, playerRoom(player.id), 'clan:updated', { clanId: clan.id, type: 'applied' });
}

export async function withdrawApplication(g: G, playerId: string, applicationId: string): Promise<void> {
  const row = await one(
    g.tx,
    `UPDATE clan_applications SET status = 'withdrawn', decided_at = $3 WHERE id = $1 AND player_id = $2 AND status = 'pending' RETURNING id`,
    [applicationId, playerId, g.now],
  );
  if (!row) throw notFound('Application');
}

export async function respondApplication(g: G, clan: ClanRow, actor: PlayerRef, applicationId: string, accept: boolean): Promise<void> {
  const app = await one<{ id: string; player_id: string; nickname: string }>(
    g.tx,
    `SELECT a.id, a.player_id, p.nickname FROM clan_applications a JOIN players p ON p.id = a.player_id
      WHERE a.id = $1 AND a.clan_id = $2 AND a.status = 'pending' FOR UPDATE OF a`,
    [applicationId, clan.id],
  );
  if (!app) throw notFound('Application');
  if (accept) {
    if (await membershipOf(g.tx, app.player_id)) {
      await g.tx.query(`UPDATE clan_applications SET status = 'withdrawn', decided_at = $2 WHERE id = $1`, [app.id, g.now]);
      throw conflict('ALREADY_IN_CLAN', `${app.nickname} has joined another nation in the meantime`);
    }
    assertJoinable(clan, await memberCount(g.tx, clan.id));
    await g.tx.query(`UPDATE clan_applications SET status = 'accepted', decided_by = $2, decided_at = $3 WHERE id = $1`, [app.id, actor.id, g.now]);
    await addMember(g, clan, { id: app.player_id, nickname: app.nickname }, `, admitted by ${actor.nickname}`);
    await notifyPlayer(g, app.player_id, {
      type: 'clan',
      title: `Welcome to ${clan.name}`,
      body: `${actor.nickname} accepted your application. You join as a ${ROLE_DEFS.recruit.name}.`,
      link: '/game/clan',
    });
  } else {
    await g.tx.query(`UPDATE clan_applications SET status = 'rejected', decided_by = $2, decided_at = $3 WHERE id = $1`, [app.id, actor.id, g.now]);
    await notifyPlayer(g, app.player_id, {
      type: 'clan',
      title: `${clan.name} declined your application`,
      body: 'You are free to apply to another nation, or to found your own.',
      link: '/game/clans',
    });
    await emit(g, playerRoom(app.player_id), 'clan:updated', { clanId: clan.id, type: 'rejected' });
  }
}

export async function invitePlayer(g: G, clan: ClanRow, actor: PlayerRef, nickname: string): Promise<void> {
  const target = await one<{ id: string; nickname: string }>(g.tx, 'SELECT id, nickname FROM players WHERE lower(nickname) = lower($1)', [nickname.trim()]);
  if (!target) throw notFound('Player');
  if (await one(g.tx, 'SELECT 1 FROM clan_members WHERE player_id = $1 AND clan_id = $2', [target.id, clan.id])) {
    throw conflict('ALREADY_MEMBER', `${target.nickname} is already a member`);
  }
  assertJoinable(clan, await memberCount(g.tx, clan.id));
  const created = await one(
    g.tx,
    `INSERT INTO clan_invitations (clan_id, player_id, invited_by, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (clan_id, player_id) WHERE status = 'pending' DO NOTHING RETURNING id`,
    [clan.id, target.id, actor.id, g.now],
  );
  if (!created) throw conflict('ALREADY_INVITED', `${target.nickname} already holds an invitation`);
  await notifyPlayer(g, target.id, {
    type: 'clan',
    title: `${clan.name} invites you`,
    body: `${actor.nickname} invites you to join the nation of ${clan.name}.`,
    link: '/game/clans',
  });
  await emit(g, playerRoom(target.id), 'clan:updated', { clanId: clan.id, type: 'invited' });
  await clanActivity(g, clan.id, 'invited', `${actor.nickname} invited ${target.nickname}.`);
}

export async function revokeInvitation(g: G, clan: ClanRow, invitationId: string): Promise<void> {
  const row = await one(
    g.tx,
    `UPDATE clan_invitations SET status = 'revoked', decided_at = $3 WHERE id = $1 AND clan_id = $2 AND status = 'pending' RETURNING id`,
    [invitationId, clan.id, g.now],
  );
  if (!row) throw notFound('Invitation');
}

export async function respondInvitation(g: G, player: PlayerRef, invitationId: string, accept: boolean): Promise<void> {
  const inv = await one<{ id: string; clan_id: string }>(
    g.tx,
    `SELECT id, clan_id FROM clan_invitations WHERE id = $1 AND player_id = $2 AND status = 'pending' FOR UPDATE`,
    [invitationId, player.id],
  );
  if (!inv) throw notFound('Invitation');
  if (!accept) {
    await g.tx.query(`UPDATE clan_invitations SET status = 'declined', decided_at = $2 WHERE id = $1`, [inv.id, g.now]);
    return;
  }
  await assertFree(g.tx, player.id);
  const clan = await lockClan(g.tx, inv.clan_id);
  assertJoinable(clan, await memberCount(g.tx, clan.id));
  await g.tx.query(`UPDATE clan_invitations SET status = 'accepted', decided_at = $2 WHERE id = $1`, [inv.id, g.now]);
  await addMember(g, clan, player, ' by invitation');
}

/**
 * Dissolve a clan whose last member is leaving: its land returns to the local
 * warriors, its wars end, and its name and tag become free.
 */
async function disbandClan(g: G, clan: ClanRow, leaderName: string): Promise<void> {
  const provinces = await rows<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE owner_clan_id = $1 ORDER BY code FOR UPDATE', [clan.id]);
  // Marked dissolved first, so giving up the land is not also recorded as a defeat.
  await g.tx.query('DELETE FROM clan_members WHERE clan_id = $1', [clan.id]);
  await g.tx.query(`UPDATE clans SET status = 'disbanded', player_id = NULL, capital_province_id = NULL, protected_until = NULL WHERE id = $1`, [clan.id]);
  // The departing lord's soldiers go home; the provinces are held again by local warriors.
  await g.tx.query('DELETE FROM armies WHERE clan_id = $1', [clan.id]);
  for (const p of provinces) {
    const garrison = await ensureGarrison(g.tx, p.id, null);
    await setArmyUnits(g.tx, garrison, normalizeUnits(PROVINCE_BY_CODE[p.code]?.neutralGarrison ?? {}));
    await transferProvince(g, p, null, 'abandoned');
  }
  await g.tx.query(
    `UPDATE wars SET status = 'ended', ended_at = $2, end_reason = 'clan_disbanded'
      WHERE status = 'active' AND (attacker_clan_id = $1 OR defender_clan_id = $1)`,
    [clan.id, g.now],
  );
  await g.tx.query(`UPDATE diplomacy SET status = 'expired', responded_at = $2 WHERE status = 'pending' AND (from_clan_id = $1 OR to_clan_id = $1)`, [
    clan.id,
    g.now,
  ]);
  await g.tx.query(`UPDATE recruitment_orders SET status = 'cancelled' WHERE clan_id = $1 AND status = 'pending'`, [clan.id]);
  await g.tx.query(`UPDATE pacts SET status = 'ended', ended_at = $2, end_reason = 'clan_disbanded' WHERE status = 'active' AND (clan_a = $1 OR clan_b = $1)`, [
    clan.id,
    g.now,
  ]);
  await g.tx.query(`UPDATE war_plans SET status = 'cancelled', outcome = 'the clan was dissolved', updated_at = $2 WHERE clan_id = $1 AND status IN ('draft', 'ready', 'launched')`, [
    clan.id,
    g.now,
  ]);
  await g.tx.query(`UPDATE clan_applications SET status = 'rejected', decided_at = $2 WHERE clan_id = $1 AND status = 'pending'`, [clan.id, g.now]);
  await g.tx.query(`UPDATE clan_invitations SET status = 'revoked', decided_at = $2 WHERE clan_id = $1 AND status = 'pending'`, [clan.id, g.now]);
  await chronicle(g, {
    type: 'fallen',
    title: `The nation of ${clan.name} is dissolved`,
    description: `On ${dayLabel(g.tick)}, ${leaderName} lowered the banner of the nation of ${clan.name}. Its lands returned to the local warriors.`,
    clanId: clan.id,
  });
  await emit(g, WORLD_ROOM, 'diplomacy:updated', { clanId: clan.id });
  await emit(g, WORLD_ROOM, 'clan:directory', { clanId: clan.id });
}

/** Leave the clan. A leader must hand over first, unless they are the last member — then the clan is dissolved. */
export async function leaveClan(g: G, player: PlayerRef): Promise<{ disbanded: boolean }> {
  const member = await membershipOf(g.tx, player.id);
  if (!member) throw conflict('NO_CLAN', 'You do not belong to a nation');
  const clan = await lockClan(g.tx, member.clan_id);
  const count = await memberCount(g.tx, clan.id);
  if (member.role === 'leader') {
    if (count > 1) throw conflict('LEADER_MUST_HAND_OVER', 'Hand the government over to another official before leaving');
    await disbandClan(g, clan, player.nickname);
    await audit(g, 'clan.disband', { type: 'clan', id: clan.id }, clan.id, { player: player.nickname });
    await emit(g, playerRoom(player.id), 'clan:updated', { clanId: clan.id, type: 'left' });
    return { disbanded: true };
  }
  await g.tx.query('DELETE FROM clan_members WHERE player_id = $1', [player.id]);
  await g.tx.query('UPDATE armies SET commander_player_id = NULL WHERE commander_player_id = $1', [player.id]);
  await clanActivity(g, clan.id, 'left', `${player.nickname} left the nation.`);
  await notifyClanRoles(g, clan.id, 'manage_members', {
    type: 'clan',
    title: `${player.nickname} has left ${clan.name}`,
    body: `The ${ROLE_DEFS[member.role].name} no longer serves the nation.`,
    link: '/game/clan',
  });
  await emit(g, playerRoom(player.id), 'clan:updated', { clanId: clan.id, type: 'left' });
  await emit(g, WORLD_ROOM, 'clan:directory', { clanId: clan.id });
  await audit(g, 'clan.leave', { type: 'clan', id: clan.id }, clan.id, { player: player.nickname });
  return { disbanded: false };
}

async function targetMember(tx: Db, clan: ClanRow, playerId: string): Promise<MemberRow & { nickname: string; portrait: string }> {
  const row = await one<MemberRow & { nickname: string; portrait: string }>(
    tx,
    `SELECT m.player_id, m.clan_id, m.role, m.joined_at, m.contribution, p.nickname, p.portrait
       FROM clan_members m JOIN players p ON p.id = m.player_id
      WHERE m.player_id = $1 AND m.clan_id = $2 FOR UPDATE OF m`,
    [playerId, clan.id],
  );
  if (!row) throw notFound('Member');
  return row;
}

export async function kickMember(g: G, clan: ClanRow, actor: MemberRow & { nickname: string }, targetId: string): Promise<void> {
  if (targetId === actor.player_id) throw invalid('To leave the nation, use "Leave nation"');
  const target = await targetMember(g.tx, clan, targetId);
  if (!outranks(actor.role, target.role)) throw new GameError('FORBIDDEN_ROLE', `You cannot remove a ${ROLE_DEFS[target.role].name}`, 403);
  await g.tx.query('DELETE FROM clan_members WHERE player_id = $1', [target.player_id]);
  await g.tx.query('UPDATE armies SET commander_player_id = NULL WHERE commander_player_id = $1', [target.player_id]);
  await clanActivity(g, clan.id, 'removed', `${actor.nickname} removed ${target.nickname} from the nation.`);
  await notifyPlayer(g, target.player_id, {
    type: 'clan',
    title: `You were removed from ${clan.name}`,
    body: 'You keep your purse and everything you have learned. Join another nation or found your own.',
    link: '/game/clans',
  });
  await emit(g, playerRoom(target.player_id), 'clan:updated', { clanId: clan.id, type: 'left' });
  await emit(g, WORLD_ROOM, 'clan:directory', { clanId: clan.id });
  await audit(g, 'clan.kick', { type: 'player', id: target.player_id }, clan.id, { player: target.nickname });
}

export async function setRole(g: G, clan: ClanRow, actor: MemberRow & { nickname: string }, targetId: string, role: ClanRole): Promise<void> {
  if (!(CLAN_ROLES as readonly string[]).includes(role)) throw invalid('Unknown role');
  if (role === 'leader') throw invalid('To hand over the nation, use "Hand over leadership"');
  if (targetId === actor.player_id) throw invalid('You cannot change your own role');
  const target = await targetMember(g.tx, clan, targetId);
  if (!outranks(actor.role, target.role)) throw new GameError('FORBIDDEN_ROLE', `You cannot change the role of a ${ROLE_DEFS[target.role].name}`, 403);
  if (!outranks(actor.role, role)) throw new GameError('FORBIDDEN_ROLE', `Only someone of higher rank can appoint a ${ROLE_DEFS[role].name}`, 403);
  if (target.role === role) return;
  await g.tx.query('UPDATE clan_members SET role = $2 WHERE player_id = $1', [target.player_id, role]);
  await clanActivity(g, clan.id, 'role', `${actor.nickname} appointed ${target.nickname} ${ROLE_DEFS[role].name}.`);
  await notifyPlayer(g, target.player_id, {
    type: 'clan',
    title: `You are now ${ROLE_DEFS[role].name} of ${clan.name}`,
    body: ROLE_DEFS[role].summary,
    link: '/game/clan',
  });
  await emit(g, playerRoom(target.player_id), 'clan:updated', { clanId: clan.id, type: 'role' });
  await audit(g, 'clan.role', { type: 'player', id: target.player_id }, clan.id, { role, from: target.role });
}

export async function transferLeadership(g: G, clan: ClanRow, actor: MemberRow & { nickname: string }, targetId: string): Promise<void> {
  if (actor.role !== 'leader') throw new GameError('FORBIDDEN_ROLE', 'Only the Chancellor can hand over the government', 403);
  if (targetId === actor.player_id) throw invalid('You already lead the nation');
  const target = await targetMember(g.tx, clan, targetId);
  await g.tx.query(`UPDATE clan_members SET role = 'officer' WHERE player_id = $1`, [actor.player_id]);
  await g.tx.query(`UPDATE clan_members SET role = 'leader' WHERE player_id = $1`, [target.player_id]);
  await g.tx.query('UPDATE clans SET player_id = $2, daimyo_name = $3, portrait = $4 WHERE id = $1', [clan.id, target.player_id, target.nickname, target.portrait]);
  await clanActivity(g, clan.id, 'leadership', `${actor.nickname} handed the government over to ${target.nickname}.`);
  await notifyClan(g, clan.id, {
    type: 'clan',
    title: `${target.nickname} is now ${ROLE_DEFS.leader.name} of ${clan.name}`,
    body: `${actor.nickname} has handed over the government and serves on as ${ROLE_DEFS.officer.name}.`,
    link: '/game/clan',
  });
  await emit(g, WORLD_ROOM, 'clan:directory', { clanId: clan.id });
  await audit(g, 'clan.transfer', { type: 'player', id: target.player_id }, clan.id, { from: actor.nickname, to: target.nickname });
}

export interface ClanSettingsInput {
  description?: string;
  recruitment?: RecruitmentMode;
  language?: string;
}

export async function updateSettings(g: G, clan: ClanRow, actor: PlayerRef, input: ClanSettingsInput): Promise<void> {
  const description = input.description === undefined ? clan.description : text(input.description, CLAN_RULES.descriptionMax);
  const recruitment = input.recruitment ?? clan.recruitment;
  const language = input.language ?? clan.language;
  if (!(RECRUITMENT_MODES as readonly string[]).includes(recruitment)) throw invalid('Unknown recruitment setting');
  if (!CLAN_LANGUAGES.some((l) => l.id === language)) throw invalid('Unknown language');
  await g.tx.query('UPDATE clans SET description = $2, recruitment = $3, language = $4 WHERE id = $1', [clan.id, description, recruitment, language]);
  if (recruitment !== clan.recruitment) await clanActivity(g, clan.id, 'settings', `${actor.nickname} set recruitment to "${recruitment}".`);
  await emit(g, WORLD_ROOM, 'clan:directory', { clanId: clan.id });
  await audit(g, 'clan.settings', { type: 'clan', id: clan.id }, clan.id, { recruitment, language });
}

/** Replace what one role may do. Only the leader decides this. */
export async function setPermissions(g: G, clan: ClanRow, actor: MemberRow & { nickname: string }, role: ClanRole, permissions: string[]): Promise<void> {
  if (actor.role !== 'leader') throw new GameError('FORBIDDEN_ROLE', 'Only the Chancellor can change what an office may do', 403);
  if (!(CONFIGURABLE_ROLES as readonly string[]).includes(role)) throw invalid('That role cannot be configured');
  const wanted = [...new Set(permissions)];
  for (const p of wanted) if (!(CLAN_PERMISSIONS as readonly string[]).includes(p)) throw invalid(`Unknown permission "${p}"`);
  await g.tx.query('DELETE FROM clan_role_permissions WHERE clan_id = $1 AND role = $2', [clan.id, role]);
  for (const p of wanted as ClanPermission[]) {
    await g.tx.query('INSERT INTO clan_role_permissions (clan_id, role, permission) VALUES ($1, $2, $3)', [clan.id, role, p]);
  }
  await clanActivity(g, clan.id, 'permissions', `${actor.nickname} changed what a ${ROLE_DEFS[role].name} may do.`);
  await audit(g, 'clan.permissions', { type: 'clan', id: clan.id }, clan.id, { role, permissions: wanted });
}

export async function setAnnouncement(g: G, clan: ClanRow, actor: PlayerRef, body: string): Promise<void> {
  const clean = text(body, CLAN_RULES.announcementMax);
  await g.tx.query('UPDATE clans SET announcement = $2, announcement_at = $3, announcement_by = $4 WHERE id = $1', [
    clan.id,
    clean || null,
    clean ? g.now : null,
    clean ? actor.id : null,
  ]);
  if (clean) {
    await clanActivity(g, clan.id, 'announcement', `${actor.nickname} posted an announcement.`);
    await notifyClan(g, clan.id, { type: 'clan', title: `Announcement from ${actor.nickname}`, body: clean, link: '/game/clan' }, actor.id);
  }
}

/** Choose the clan's doctrine (§10). Only the leader decides, and a doctrine must be kept for a while. */
export async function setDoctrine(g: G, clan: ClanRow, actor: MemberRow & { nickname: string }, doctrine: string): Promise<void> {
  if (actor.role !== 'leader') throw new GameError('FORBIDDEN_ROLE', 'Only the Chancellor chooses the national doctrine', 403);
  if (!(DOCTRINES as readonly string[]).includes(doctrine)) throw invalid('Unknown doctrine');
  if (clan.doctrine === doctrine) throw conflict('DOCTRINE_UNCHANGED', 'The nation already follows that doctrine');
  if (clan.doctrine && clan.doctrine_set_at) {
    const free = addMs(new Date(clan.doctrine_set_at), gameMs(g, DOCTRINE_COOLDOWN_HOURS * 60));
    if (free.getTime() > g.now.getTime()) throw conflict('DOCTRINE_COOLDOWN', 'A doctrine must be followed for three days before the nation can turn to another');
  }
  await g.tx.query('UPDATE clans SET doctrine = $2, doctrine_set_at = $3 WHERE id = $1', [clan.id, doctrine, g.now]);
  const def = DOCTRINE_DEFS[doctrine as keyof typeof DOCTRINE_DEFS];
  await clanActivity(g, clan.id, 'doctrine', `${actor.nickname} set the nation on the ${def.name}.`);
  await notifyClan(g, clan.id, { type: 'clan', title: `The nation follows the ${def.name}`, body: `${def.motto} ${def.summary}`, link: '/game/clan' }, actor.player_id);
  await emit(g, WORLD_ROOM, 'clan:directory', { clanId: clan.id });
  await audit(g, 'clan.doctrine', { type: 'clan', id: clan.id }, clan.id, { doctrine });
}
