/**
 * The personal economy (change request §4.1, §4.3, §4.4): every player has a
 * purse of their own, fed by their residence, and pays into the shared clan
 * treasury. Every movement is one atomic conditional UPDATE plus a ledger row,
 * so nothing can be spent twice and everything can be audited.
 */
import { CONTRIBUTION_WEIGHT, PERSONAL, contributionPoints, residenceCost, residenceIncome } from '@/game/clan';
import { RESOURCE_INFO, RESOURCE_KEYS, emptyBag, type ResourceBag } from '@/game/config';
import { PILLAR_DEFS, type PillarId } from '@/game/pillars';
import { one, rows, type Db } from './db';
import { grant, spend } from './economy';
import { conflict, invalid, notFound } from './errors';
import { audit, clanActivity, emit, notifyPlayer, playerRoom } from './notify';
import { awardXp } from './progression';
import type { ClanRow, MemberRow } from './rows';
import type { G } from './world';

type Ctx = Pick<G, 'tx' | 'now'> & { actorPlayerId?: string | null };

function clean(bag: Partial<Record<string, number>>): ResourceBag {
  const out = emptyBag();
  for (const k of RESOURCE_KEYS) {
    const v = Number(bag[k] ?? 0);
    if (!Number.isFinite(v) || v < 0) throw invalid('Amounts must be zero or more');
    out[k] = Math.floor(v);
  }
  return out;
}

const total = (bag: ResourceBag) => RESOURCE_KEYS.reduce((s, k) => s + bag[k], 0);
const describe = (bag: ResourceBag) =>
  RESOURCE_KEYS.filter((k) => bag[k] > 0)
    .map((k) => `${bag[k].toLocaleString('en-US')} ${RESOURCE_INFO[k].name.toLowerCase()}`)
    .join(', ');

async function writeLedger(g: Ctx, playerId: string, deltas: Partial<ResourceBag>, after: ResourceBag, reason: string, ref?: { type: string; id: string | null }) {
  for (const k of RESOURCE_KEYS) {
    const amount = deltas[k] ?? 0;
    if (amount === 0) continue;
    await g.tx.query(
      `INSERT INTO player_transactions (player_id, resource, amount, balance_after, reason, ref_type, ref_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [playerId, k, amount, after[k], reason, ref?.type ?? null, ref?.id ?? null, g.now],
    );
  }
}

/** Give a new player their purse. */
export async function openPurse(tx: Db, playerId: string): Promise<void> {
  const s = PERSONAL.startingPurse;
  const created = await one(
    tx,
    `INSERT INTO player_resources (player_id, gold, food, wood, stone, iron) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (player_id) DO NOTHING RETURNING player_id`,
    [playerId, s.gold, s.food, s.wood, s.stone, s.iron],
  );
  if (created) await writeLedger({ tx, now: new Date() }, playerId, s, s, 'starting_purse');
}

export async function getPurse(db: Db, playerId: string): Promise<ResourceBag> {
  const row = await one<ResourceBag>(db, 'SELECT gold, food, wood, stone, iron FROM player_resources WHERE player_id = $1', [playerId]);
  return row ?? emptyBag();
}

export async function spendPurse(g: Ctx, playerId: string, cost: ResourceBag, reason: string, ref?: { type: string; id: string | null }): Promise<ResourceBag> {
  const after = await one<ResourceBag>(
    g.tx,
    `UPDATE player_resources
        SET gold = gold - $2, food = food - $3, wood = wood - $4, stone = stone - $5, iron = iron - $6, updated_at = $7
      WHERE player_id = $1 AND gold >= $2 AND food >= $3 AND wood >= $4 AND stone >= $5 AND iron >= $6
      RETURNING gold, food, wood, stone, iron`,
    [playerId, cost.gold, cost.food, cost.wood, cost.stone, cost.iron, g.now],
  );
  if (!after) {
    const have = await getPurse(g.tx, playerId);
    const short = RESOURCE_KEYS.filter((k) => have[k] < cost[k]).map((k) => `${cost[k] - have[k]} ${k}`);
    throw conflict('INSUFFICIENT_RESOURCES', `Your purse is short by ${short.join(', ')}`);
  }
  const deltas: Partial<ResourceBag> = {};
  for (const k of RESOURCE_KEYS) deltas[k] = -cost[k];
  await writeLedger(g, playerId, deltas, after, reason, ref);
  await emit(g, playerRoom(playerId), 'purse:updated', { purse: after });
  return after;
}

export async function grantPurse(
  g: Ctx,
  playerId: string,
  bag: ResourceBag,
  reason: string,
  ref?: { type: string; id: string | null },
  announce = true,
): Promise<ResourceBag> {
  const after = await one<ResourceBag>(
    g.tx,
    `UPDATE player_resources
        SET gold = gold + $2, food = food + $3, wood = wood + $4, stone = stone + $5, iron = iron + $6, updated_at = $7
      WHERE player_id = $1
      RETURNING gold, food, wood, stone, iron`,
    [playerId, bag.gold, bag.food, bag.wood, bag.stone, bag.iron, g.now],
  );
  if (!after) throw new Error(`No purse for player ${playerId}`);
  await writeLedger(g, playerId, bag, after, reason, ref);
  if (announce) await emit(g, playerRoom(playerId), 'purse:updated', { purse: after });
  return after;
}

/**
 * A member pays into the clan treasury. Both balances move in the same
 * transaction; the member's running contribution and the clan's history record it.
 */
export async function contribute(g: G, clan: ClanRow, member: MemberRow, input: Partial<Record<string, number>>, nickname: string): Promise<void> {
  const bag = clean(input);
  if (total(bag) <= 0) throw invalid('Choose what to contribute');
  await spendPurse(g, member.player_id, bag, 'clan_contribution', { type: 'clan', id: clan.id });
  await grant(g, clan.id, bag, 'member_contribution', { type: 'player', id: member.player_id });
  for (const k of RESOURCE_KEYS) {
    if (bag[k] <= 0) continue;
    await g.tx.query(
      `INSERT INTO clan_contributions (clan_id, player_id, resource, amount) VALUES ($1, $2, $3, $4)
       ON CONFLICT (clan_id, player_id, resource) DO UPDATE SET amount = clan_contributions.amount + EXCLUDED.amount`,
      [clan.id, member.player_id, k, bag[k]],
    );
  }
  const points = contributionPoints(bag);
  await g.tx.query('UPDATE clan_members SET contribution = contribution + $2 WHERE player_id = $1', [member.player_id, points]);
  await g.tx.query('UPDATE players SET reputation = reputation + $2 WHERE id = $1', [member.player_id, Math.floor(points / 500)]);
  await awardXp(g, member.player_id, 'economy', Math.floor((points / 100) * PERSONAL.contributionXpPer100));
  await clanActivity(g, clan.id, 'contribution', `${nickname} paid ${describe(bag)} into the treasury.`);
  await audit(g, 'treasury.contribute', { type: 'clan', id: clan.id }, clan.id, { bag, points });
}

/** An authorised member pays treasury resources out to a member's purse. */
export async function withdraw(
  g: G,
  clan: ClanRow,
  actor: { id: string; nickname: string },
  toPlayerId: string,
  input: Partial<Record<string, number>>,
  note: string,
): Promise<void> {
  const bag = clean(input);
  if (total(bag) <= 0) throw invalid('Choose what to pay out');
  const recipient = await one<{ player_id: string; nickname: string }>(
    g.tx,
    'SELECT m.player_id, p.nickname FROM clan_members m JOIN players p ON p.id = m.player_id WHERE m.player_id = $1 AND m.clan_id = $2',
    [toPlayerId, clan.id],
  );
  if (!recipient) throw notFound('Member');
  const cleanNote = note.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  await spend(g, clan.id, bag, 'treasury_withdrawal', { type: 'player', id: toPlayerId });
  await grantPurse(g, toPlayerId, bag, 'treasury_grant', { type: 'clan', id: clan.id });
  await clanActivity(
    g,
    clan.id,
    'withdrawal',
    `${actor.nickname} paid ${describe(bag)} from the treasury to ${recipient.nickname}${cleanNote ? ` (${cleanNote})` : ''}.`,
  );
  if (toPlayerId !== actor.id) {
    await notifyPlayer(g, toPlayerId, {
      type: 'treasury',
      title: 'A grant from the treasury',
      body: `${actor.nickname} paid you ${describe(bag)} from the ${clan.name} treasury${cleanNote ? `: ${cleanNote}` : '.'}`,
      link: '/game/clan',
    });
  }
  await audit(g, 'treasury.withdraw', { type: 'player', id: toPlayerId }, clan.id, { bag, note: cleanNote });
}

/** Raise the player's residence by one level, paid from their own purse. */
export async function upgradeResidence(g: G, playerId: string): Promise<number> {
  const player = await one<{ residence_level: number }>(g.tx, 'SELECT residence_level FROM players WHERE id = $1 FOR UPDATE', [playerId]);
  if (!player) throw notFound('Player');
  if (player.residence_level >= PERSONAL.maxResidenceLevel) throw conflict('MAX_LEVEL', 'Your residence is already as grand as it can be');
  const to = player.residence_level + 1;
  await spendPurse(g, playerId, residenceCost(to), 'residence_upgrade', { type: 'residence', id: String(to) });
  await g.tx.query('UPDATE players SET residence_level = $2 WHERE id = $1', [playerId, to]);
  await awardXp(g, playerId, 'economy', 20 * to);
  await audit(g, 'residence.upgrade', { type: 'player', id: playerId }, null, { level: to });
  return to;
}

/** Choose the pillar a player trains at home. */
export async function setTrainingFocus(g: G, playerId: string, pillar: PillarId): Promise<void> {
  if (!PILLAR_DEFS[pillar]) throw invalid('Unknown pillar');
  await g.tx.query('UPDATE players SET training_focus = $2 WHERE id = $1', [playerId, pillar]);
}

/**
 * Hourly: members of clans that hold land draw the income of their residence
 * and gain a little experience in the pillar they train. Runs inside the world tick.
 */
export async function payResidences(g: Ctx): Promise<number> {
  const members = await rows<{ player_id: string; residence_level: number; training_focus: PillarId; economy: number }>(
    g.tx,
    `SELECT m.player_id, p.residence_level, p.training_focus,
            COALESCE((SELECT level FROM player_pillars pp WHERE pp.player_id = m.player_id AND pp.pillar = 'economy'), 1) AS economy
       FROM clan_members m
       JOIN players p ON p.id = m.player_id
       JOIN clans c ON c.id = m.clan_id
      WHERE c.status = 'active' AND EXISTS (SELECT 1 FROM provinces pr WHERE pr.owner_clan_id = c.id)
      ORDER BY m.player_id`,
  );
  for (const m of members) {
    await grantPurse(g, m.player_id, residenceIncome(m.residence_level, m.economy), 'residence_income', undefined, false);
    await awardXp({ ...g, actorPlayerId: null }, m.player_id, PILLAR_DEFS[m.training_focus] ? m.training_focus : 'military', 3 + m.residence_level);
  }
  return members.length;
}

export { CONTRIBUTION_WEIGHT };
