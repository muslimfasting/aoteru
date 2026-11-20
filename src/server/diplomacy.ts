import { WORLD, armyPower } from '@/game/config';
import { one, rows, type Db } from './db';
import { conflict, forbidden, invalid, notFound } from './errors';
import { clanUnits, spend } from './economy';
import { audit, chronicle, emit, emitClan, notifyClan, WORLD_ROOM } from './notify';
import { awardClanXp } from './progression';
import { atWar, loadActiveWars, loadArmies, loadMods, type ClanRow, type WarRow } from './rows';
import { addMs, dayLabel, gameMs, type G } from './world';

export function warCost(warCostMod: number): number {
  return Math.round(WORLD.warDeclarationCost * Math.max(0.2, 1 - warCostMod));
}

export function isProtected(clan: Pick<ClanRow, 'protected_until'>, now: Date): boolean {
  return clan.protected_until !== null && clan.protected_until.getTime() > now.getTime();
}

/** Why `clan` may not declare war on `target` right now, or null if it may. */
export async function warBlockReason(g: Pick<G, 'tx' | 'now' | 'speed'>, clan: ClanRow, target: ClanRow, wars: WarRow[]): Promise<string | null> {
  if (clan.id === target.id) return 'You cannot declare war on yourself';
  if (target.status !== 'active') return 'That clan has fallen';
  if (atWar(wars, clan.id, target.id)) return 'You are already at war';
  if (isProtected(target, g.now)) return 'A newly founded clan is under the truce of the realm and cannot be attacked yet';
  const lastPeace = await one<{ ended_at: Date }>(
    g.tx,
    `SELECT ended_at FROM wars
      WHERE status = 'ended' AND end_reason = 'peace'
        AND ((attacker_clan_id = $1 AND defender_clan_id = $2) OR (attacker_clan_id = $2 AND defender_clan_id = $1))
      ORDER BY ended_at DESC LIMIT 1`,
    [clan.id, target.id],
  );
  if (lastPeace && addMs(lastPeace.ended_at, gameMs(g, WORLD.truceHours * 60)).getTime() > g.now.getTime()) {
    return 'The peace you signed is still binding';
  }
  return null;
}

/** Declare war (MP-03): costs gold, ends the declarer's own protection, and is announced to the realm. */
export async function declareWar(g: G, clan: ClanRow, targetClanId: string): Promise<string> {
  const target = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1 FOR UPDATE', [targetClanId]);
  if (!target) throw notFound('Clan');
  const wars = await loadActiveWars(g.tx);
  const reason = await warBlockReason(g, clan, target, wars);
  if (reason) throw conflict('WAR_BLOCKED', reason);

  const mods = await loadMods(g.tx, clan.id);
  const war = await one<{ id: string }>(
    g.tx,
    `INSERT INTO wars (attacker_clan_id, defender_clan_id, declared_at) VALUES ($1, $2, $3) RETURNING id`,
    [clan.id, target.id, g.now],
  );
  await spend(g, clan.id, { gold: warCost(mods.warCost) }, 'war_declaration', { type: 'war', id: war!.id });
  await g.tx.query('UPDATE clans SET protected_until = NULL WHERE id = $1', [clan.id]);
  await chronicle(g, {
    type: 'war',
    title: `${clan.name} declares war on ${target.name}`,
    description: `On ${dayLabel(g.tick)}, ${clan.daimyo_name} sent a declaration of war to ${target.daimyo_name}. The roads between their lands are closed.`,
    clanId: clan.id,
  });
  await notifyClan(g, target.id, {
    type: 'war',
    title: `${clan.name} has declared war on you`,
    body: `${clan.daimyo_name} of the ${clan.name} clan has declared war. Look to your borders.`,
    link: '/game/diplomacy',
  });
  await emit(g, WORLD_ROOM, 'diplomacy:updated', { warId: war!.id });
  await audit(g, 'war.declare', { type: 'war', id: war!.id }, clan.id, { target: target.name });
  return war!.id;
}

async function endWar(g: G, war: WarRow, a: ClanRow, b: ClanRow): Promise<void> {
  await g.tx.query(`UPDATE wars SET status = 'ended', ended_at = $2, end_reason = 'peace' WHERE id = $1`, [war.id, g.now]);
  await g.tx.query(
    `UPDATE diplomacy SET status = 'expired', responded_at = $3
      WHERE status = 'pending' AND ((from_clan_id = $1 AND to_clan_id = $2) OR (from_clan_id = $2 AND to_clan_id = $1))`,
    [a.id, b.id, g.now],
  );
  await chronicle(g, {
    type: 'peace',
    title: `Peace between ${a.name} and ${b.name}`,
    description: `On ${dayLabel(g.tick)}, envoys of the ${a.name} and ${b.name} clans exchanged oaths and the fighting ceased.`,
    clanId: a.id,
  });
  for (const clan of [a, b]) {
    const mods = await loadMods(g.tx, clan.id);
    await awardClanXp(g, clan.id, 'culture', 60, mods.xpGain);
  }
  await emit(g, WORLD_ROOM, 'diplomacy:updated', { warId: war.id });
}

async function totalPower(tx: Db, clanId: string): Promise<number> {
  return armyPower(clanUnits(await loadArmies(tx, 'a.clan_id = $1', [clanId])));
}

/**
 * Propose peace (MP-04). A player answers in their own time; an NPC daimyo
 * decides at once by a fixed rule: it accepts when it is the weaker side or
 * its people are starving. Diplomacy skill makes it more willing.
 */
export async function proposePeace(g: G, clan: ClanRow, targetClanId: string): Promise<void> {
  const target = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [targetClanId]);
  if (!target) throw notFound('Clan');
  const war = atWar(await loadActiveWars(g.tx), clan.id, target.id);
  if (!war) throw conflict('NOT_AT_WAR', 'You are not at war with that clan');
  const pending = await one(g.tx, `SELECT id FROM diplomacy WHERE from_clan_id = $1 AND to_clan_id = $2 AND type = 'peace' AND status = 'pending'`, [
    clan.id,
    target.id,
  ]);
  if (pending) throw conflict('ALREADY_PROPOSED', 'Your envoy is still waiting for an answer');

  // An offer already on the table from the other side is simply accepted.
  const incoming = await one<{ id: string }>(
    g.tx,
    `SELECT id FROM diplomacy WHERE from_clan_id = $1 AND to_clan_id = $2 AND type = 'peace' AND status = 'pending' AND expires_at > $3`,
    [target.id, clan.id, g.now],
  );
  if (incoming) {
    await respondPeace(g, clan, incoming.id, true);
    return;
  }

  const proposal = await one<{ id: string }>(
    g.tx,
    `INSERT INTO diplomacy (type, from_clan_id, to_clan_id, created_at, expires_at) VALUES ('peace', $1, $2, $3, $4) RETURNING id`,
    [clan.id, target.id, g.now, addMs(g.now, gameMs(g, 12 * 60))],
  );
  await audit(g, 'diplomacy.propose', { type: 'diplomacy', id: proposal!.id }, clan.id, { type: 'peace', target: target.name });

  if (target.is_npc) {
    const mods = await loadMods(g.tx, clan.id);
    const diplomacyRanks = Math.round(mods.warCost / 0.1);
    const mine = await totalPower(g.tx, clan.id);
    const theirs = await totalPower(g.tx, target.id);
    const accepts = target.starving_ticks > 0 || theirs < mine * (0.9 + 0.08 * diplomacyRanks);
    if (accepts) {
      await g.tx.query(`UPDATE diplomacy SET status = 'accepted', responded_at = $2 WHERE id = $1`, [proposal!.id, g.now]);
      await endWar(g, war, clan, target);
      await notifyClan(g, clan.id, {
        type: 'peace',
        title: `${target.name} accepts peace`,
        body: `${target.daimyo_name} has accepted your offer. The war is over.`,
        link: '/game/diplomacy',
      });
    } else {
      await g.tx.query(`UPDATE diplomacy SET status = 'rejected', responded_at = $2 WHERE id = $1`, [proposal!.id, g.now]);
      await notifyClan(g, clan.id, {
        type: 'peace',
        title: `${target.name} rejects peace`,
        body: `${target.daimyo_name} sees no reason to stop while holding the stronger hand.`,
        link: '/game/diplomacy',
      });
    }
    await emitClan(g, clan.id, 'diplomacy:updated', { proposalId: proposal!.id });
    return;
  }

  await notifyClan(g, target.id, {
    type: 'peace',
    title: `${clan.name} offers peace`,
    body: `${clan.daimyo_name} has sent an envoy proposing an end to the war.`,
    link: '/game/diplomacy',
  });
  await emitClan(g, target.id, 'diplomacy:proposal', { proposalId: proposal!.id, fromClanId: clan.id, type: 'peace' });
  await emitClan(g, clan.id, 'diplomacy:updated', { proposalId: proposal!.id });
}

export async function respondPeace(g: G, clan: ClanRow, proposalId: string, accept: boolean): Promise<void> {
  const proposal = await one<{ id: string; from_clan_id: string; to_clan_id: string; status: string; expires_at: Date }>(
    g.tx,
    'SELECT * FROM diplomacy WHERE id = $1 FOR UPDATE',
    [proposalId],
  );
  if (!proposal) throw notFound('Proposal');
  if (proposal.to_clan_id !== clan.id) throw forbidden('That proposal was not addressed to you');
  if (proposal.status !== 'pending') throw conflict('PROPOSAL_CLOSED', 'That proposal has already been answered');
  if (proposal.expires_at.getTime() <= g.now.getTime()) {
    await g.tx.query(`UPDATE diplomacy SET status = 'expired', responded_at = $2 WHERE id = $1`, [proposalId, g.now]);
    throw conflict('PROPOSAL_CLOSED', 'That proposal has expired');
  }
  const from = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [proposal.from_clan_id]);
  if (!from) throw invalid('The proposing clan no longer exists');

  await g.tx.query(`UPDATE diplomacy SET status = $2, responded_at = $3 WHERE id = $1`, [proposalId, accept ? 'accepted' : 'rejected', g.now]);
  if (accept) {
    const war = atWar(await loadActiveWars(g.tx), clan.id, from.id);
    if (war) await endWar(g, war, from, clan);
  }
  await notifyClan(g, from.id, {
    type: 'peace',
    title: accept ? `${clan.name} accepts peace` : `${clan.name} rejects peace`,
    body: accept ? `${clan.daimyo_name} has accepted your offer. The war is over.` : `${clan.daimyo_name} has sent your envoy home without an answer.`,
    link: '/game/diplomacy',
  });
  await emitClan(g, from.id, 'diplomacy:updated', { proposalId });
  await emitClan(g, clan.id, 'diplomacy:updated', { proposalId });
  await audit(g, 'diplomacy.respond', { type: 'diplomacy', id: proposalId }, clan.id, { accept });
}

/** Proposals nobody answered lapse. */
export async function expireProposals(g: Pick<G, 'tx' | 'now'>): Promise<void> {
  await g.tx.query(`UPDATE diplomacy SET status = 'expired', responded_at = $1 WHERE status = 'pending' AND expires_at <= $1`, [g.now]);
}

export async function clanWars(db: Db, clanId: string): Promise<WarRow[]> {
  return rows<WarRow>(db, 'SELECT * FROM wars WHERE attacker_clan_id = $1 OR defender_clan_id = $1 ORDER BY declared_at DESC LIMIT 30', [clanId]);
}
