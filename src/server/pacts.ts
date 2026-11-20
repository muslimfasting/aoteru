/**
 * Treaties between clans (change request §9.2-§9.3): non-aggression pacts and
 * alliances. Each has a duration, requirements and a consequence for breaking
 * it. War and peace live in diplomacy.ts; this module adds the standing
 * agreements and the single entry point for answering any proposal.
 */
import { PACT_BREAK_LOYALTY, PACT_DEFS, type PactType } from '@/game/clan';
import { armyPower } from '@/game/config';
import { one, type Db } from './db';
import { isProtected, respondPeace } from './diplomacy';
import { clanUnits } from './economy';
import { conflict, forbidden, invalid, notFound } from './errors';
import { audit, chronicle, emit, emitClan, notifyClan, WORLD_ROOM } from './notify';
import { awardClanXp } from './progression';
import { atWar, loadActivePacts, loadActiveWars, loadArmies, pactBetween, type ClanRow, type PactRow } from './rows';
import { addMs, dayLabel, gameMs, type G } from './world';

async function totalPower(tx: Db, clanId: string): Promise<number> {
  return armyPower(clanUnits(await loadArmies(tx, 'a.clan_id = $1', [clanId])));
}

/** Why `clan` may not offer this treaty to `target`, or null if it may. */
export async function pactBlockReason(g: Pick<G, 'tx' | 'now'>, clan: ClanRow, target: ClanRow, type: PactType, pacts: PactRow[]): Promise<string | null> {
  if (clan.id === target.id) return 'You cannot make a treaty with yourself';
  if (target.status !== 'active') return 'That clan has fallen';
  if (atWar(await loadActiveWars(g.tx), clan.id, target.id)) return 'You are at war. Make peace first.';
  const existing = pactBetween(pacts, clan.id, target.id);
  if (existing?.type === type) return `You already have ${type === 'alliance' ? 'an alliance' : 'a pact'} with that clan`;
  if (existing?.type === 'alliance' && type === 'nap') return 'You are already allied with that clan';
  return null;
}

async function createPact(g: G, type: PactType, a: ClanRow, b: ClanRow): Promise<string> {
  // An alliance replaces a non-aggression pact between the same two clans.
  await g.tx.query(
    `UPDATE pacts SET status = 'ended', ended_at = $3, end_reason = 'superseded'
      WHERE status = 'active' AND LEAST(clan_a, clan_b) = LEAST($1::uuid, $2::uuid) AND GREATEST(clan_a, clan_b) = GREATEST($1::uuid, $2::uuid)`,
    [a.id, b.id, g.now],
  );
  const hours = PACT_DEFS[type].hours;
  const pact = await one<{ id: string }>(
    g.tx,
    'INSERT INTO pacts (type, clan_a, clan_b, started_at, ends_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [type, a.id, b.id, g.now, hours ? addMs(g.now, gameMs(g, hours * 60)) : null],
  );
  await chronicle(g, {
    type: type === 'alliance' ? 'alliance' : 'pact',
    title: type === 'alliance' ? `${a.name} and ${b.name} are allied` : `${a.name} and ${b.name} sign a non-aggression pact`,
    description:
      type === 'alliance'
        ? `On ${dayLabel(g.tick)}, the ${a.name} and ${b.name} clans swore to stand together.`
        : `On ${dayLabel(g.tick)}, the ${a.name} and ${b.name} clans agreed to keep the peace between them for three days.`,
    clanId: a.id,
  });
  await awardClanXp(g, a.id, 'culture', type === 'alliance' ? 60 : 30, 0, null);
  await awardClanXp(g, b.id, 'culture', type === 'alliance' ? 60 : 30, 0, null);
  await emit(g, WORLD_ROOM, 'diplomacy:updated', { pactId: pact!.id });
  return pact!.id;
}

/**
 * Offer a treaty. A clan of players answers in its own time. An NPC house
 * decides at once by a fixed rule: it never binds itself in an alliance, and
 * signs a non-aggression pact only with a clan it does not clearly outmatch.
 */
export async function proposePact(g: G, clan: ClanRow, targetClanId: string, type: PactType): Promise<void> {
  if (!PACT_DEFS[type]) throw invalid('Unknown treaty');
  const target = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [targetClanId]);
  if (!target) throw notFound('Clan');
  const pacts = await loadActivePacts(g.tx);
  const blocked = await pactBlockReason(g, clan, target, type, pacts);
  if (blocked) throw conflict('PACT_BLOCKED', blocked);
  const name = PACT_DEFS[type].name.toLowerCase();

  const pending = await one(g.tx, `SELECT id FROM diplomacy WHERE from_clan_id = $1 AND to_clan_id = $2 AND type = $3 AND status = 'pending'`, [
    clan.id,
    target.id,
    type,
  ]);
  if (pending) throw conflict('ALREADY_PROPOSED', 'Your envoy is still waiting for an answer');

  // The same offer already on the table from the other side is simply accepted.
  const incoming = await one<{ id: string }>(
    g.tx,
    `SELECT id FROM diplomacy WHERE from_clan_id = $1 AND to_clan_id = $2 AND type = $3 AND status = 'pending' AND expires_at > $4`,
    [target.id, clan.id, type, g.now],
  );
  if (incoming) {
    await respondProposal(g, clan, incoming.id, true);
    return;
  }

  const proposal = await one<{ id: string }>(
    g.tx,
    `INSERT INTO diplomacy (type, from_clan_id, to_clan_id, created_at, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [type, clan.id, target.id, g.now, addMs(g.now, gameMs(g, 12 * 60))],
  );
  await audit(g, 'diplomacy.propose', { type: 'diplomacy', id: proposal!.id }, clan.id, { type, target: target.name });

  if (target.is_npc) {
    const accepts = type === 'nap' && !isProtected(clan, g.now) && (await totalPower(g.tx, target.id)) < (await totalPower(g.tx, clan.id)) * 1.25;
    await g.tx.query(`UPDATE diplomacy SET status = $2, responded_at = $3 WHERE id = $1`, [proposal!.id, accepts ? 'accepted' : 'rejected', g.now]);
    if (accepts) await createPact(g, type, clan, target);
    await notifyClan(g, clan.id, {
      type: 'peace',
      title: accepts ? `${target.name} signs the ${name}` : `${target.name} refuses the ${name}`,
      body: accepts
        ? `${target.daimyo_name} has put a seal to your proposal.`
        : type === 'alliance'
          ? `${target.daimyo_name} will not bind an old house to a new banner.`
          : `${target.daimyo_name} sees no need to tie the hands of the stronger side.`,
      link: '/game/diplomacy',
    });
    await emitClan(g, clan.id, 'diplomacy:updated', { proposalId: proposal!.id });
    return;
  }

  await notifyClan(g, target.id, {
    type: 'peace',
    title: `${clan.name} proposes ${type === 'alliance' ? 'an alliance' : 'a non-aggression pact'}`,
    body: `${clan.daimyo_name} has sent an envoy. ${PACT_DEFS[type].summary}`,
    link: '/game/diplomacy',
  });
  await emitClan(g, target.id, 'diplomacy:proposal', { proposalId: proposal!.id, fromClanId: clan.id, type });
  await emitClan(g, clan.id, 'diplomacy:updated', { proposalId: proposal!.id });
}

/** Answer any proposal addressed to the clan: peace, a pact or an alliance. */
export async function respondProposal(g: G, clan: ClanRow, proposalId: string, accept: boolean): Promise<void> {
  const proposal = await one<{ id: string; type: string; from_clan_id: string; to_clan_id: string; status: string; expires_at: Date }>(
    g.tx,
    'SELECT * FROM diplomacy WHERE id = $1 FOR UPDATE',
    [proposalId],
  );
  if (!proposal) throw notFound('Proposal');
  if (proposal.type === 'peace') return respondPeace(g, clan, proposalId, accept);

  if (proposal.to_clan_id !== clan.id) throw forbidden('That proposal was not addressed to you');
  if (proposal.status !== 'pending') throw conflict('PROPOSAL_CLOSED', 'That proposal has already been answered');
  if (proposal.expires_at.getTime() <= g.now.getTime()) {
    await g.tx.query(`UPDATE diplomacy SET status = 'expired', responded_at = $2 WHERE id = $1`, [proposalId, g.now]);
    throw conflict('PROPOSAL_CLOSED', 'That proposal has expired');
  }
  const from = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [proposal.from_clan_id]);
  if (!from) throw invalid('The proposing clan no longer exists');
  const type = proposal.type as PactType;
  if (accept) {
    const blocked = await pactBlockReason(g, from, clan, type, await loadActivePacts(g.tx));
    if (blocked) throw conflict('PACT_BLOCKED', blocked);
  }
  await g.tx.query(`UPDATE diplomacy SET status = $2, responded_at = $3 WHERE id = $1`, [proposalId, accept ? 'accepted' : 'rejected', g.now]);
  if (accept) await createPact(g, type, from, clan);
  const name = PACT_DEFS[type].name.toLowerCase();
  await notifyClan(g, from.id, {
    type: 'peace',
    title: accept ? `${clan.name} signs the ${name}` : `${clan.name} refuses the ${name}`,
    body: accept ? `${clan.daimyo_name} has put a seal to your proposal.` : `${clan.daimyo_name} has sent your envoy home.`,
    link: '/game/diplomacy',
  });
  await emitClan(g, from.id, 'diplomacy:updated', { proposalId });
  await emitClan(g, clan.id, 'diplomacy:updated', { proposalId });
  await audit(g, 'diplomacy.respond', { type: 'diplomacy', id: proposalId }, clan.id, { accept, type });
}

/**
 * End a treaty before its time. The clan that breaks its word loses loyalty
 * at home and may not declare war on the former partner for a while.
 */
export async function breakPact(g: G, clan: ClanRow, pactId: string): Promise<void> {
  const pact = await one<PactRow>(g.tx, `SELECT * FROM pacts WHERE id = $1 AND status = 'active' FOR UPDATE`, [pactId]);
  if (!pact || (pact.clan_a !== clan.id && pact.clan_b !== clan.id)) throw notFound('Treaty');
  const otherId = pact.clan_a === clan.id ? pact.clan_b : pact.clan_a;
  const other = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1', [otherId]);
  await g.tx.query(`UPDATE pacts SET status = 'ended', ended_at = $2, end_reason = 'broken', broken_by = $3 WHERE id = $1`, [pact.id, g.now, clan.id]);
  await g.tx.query('UPDATE provinces SET loyalty = GREATEST(0, loyalty - $2), updated_at = $3 WHERE owner_clan_id = $1', [clan.id, PACT_BREAK_LOYALTY, g.now]);
  const name = PACT_DEFS[pact.type].name.toLowerCase();
  await chronicle(g, {
    type: 'pact_broken',
    title: `${clan.name} breaks its ${name} with ${other?.name ?? 'its partner'}`,
    description: `On ${dayLabel(g.tick)}, the ${clan.name} clan tore up its ${name} with the ${other?.name ?? 'other'} clan. Its own people murmur at the broken word.`,
    clanId: clan.id,
  });
  await notifyClan(g, otherId, {
    type: 'war',
    title: `${clan.name} has broken the ${name}`,
    body: `The ${clan.name} clan no longer holds to its word. Look to your borders.`,
    link: '/game/diplomacy',
  });
  await emit(g, WORLD_ROOM, 'diplomacy:updated', { pactId: pact.id });
  await audit(g, 'diplomacy.break', { type: 'pact', id: pact.id }, clan.id, { type: pact.type, other: other?.name ?? null });
}

/** Pacts that have run their course lapse quietly. Runs inside the world tick. */
export async function expirePacts(g: Pick<G, 'tx' | 'now'>): Promise<void> {
  await g.tx.query(`UPDATE pacts SET status = 'ended', ended_at = $1, end_reason = 'expired' WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= $1`, [
    g.now,
  ]);
}

/** A clan that falls or dissolves keeps no treaties. */
export async function endPactsOf(g: Pick<G, 'tx' | 'now'>, clanId: string, reason: string): Promise<void> {
  await g.tx.query(`UPDATE pacts SET status = 'ended', ended_at = $2, end_reason = $3 WHERE status = 'active' AND (clan_a = $1 OR clan_b = $1)`, [
    clanId,
    g.now,
    reason,
  ]);
}
