import type { PillarsResponse } from '@/game/api';
import { ROLE_DEFS, SEAT_OF_PILLAR, type ClanRole } from '@/game/clan';
import {
  PILLARS,
  PILLAR_DEFS,
  SKILLS,
  SKILL_BY_CODE,
  applyXp,
  computeModifiers,
  skillBlockReason,
  xpToNext,
  type PillarId,
  type SkillRanks,
} from '@/game/pillars';
import { one, rows, type Db } from './db';
import { conflict, invalid } from './errors';
import { audit, emit, notifyPlayer, playerRoom } from './notify';
import { loadProgress, type PillarRow } from './rows';
import type { G } from './world';

type Ctx = Pick<G, 'tx' | 'now'> & { actorPlayerId?: string | null };

/** Create the five pillar rows of an NPC clan. Players have their own (see `initPlayerPillars`). */
export async function initPillars(tx: Db, clanId: string, level = 1): Promise<void> {
  for (const pillar of PILLARS) {
    await tx.query(
      `INSERT INTO five_pillars (clan_id, pillar, level, xp, points) VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (clan_id, pillar) DO NOTHING`,
      [clanId, pillar, level, Math.max(0, level - 1)],
    );
  }
}

/** Create the five pillar rows of a new player. */
export async function initPlayerPillars(tx: Db, playerId: string): Promise<void> {
  for (const pillar of PILLARS) {
    await tx.query('INSERT INTO player_pillars (player_id, pillar) VALUES ($1, $2) ON CONFLICT DO NOTHING', [playerId, pillar]);
  }
}

/**
 * Award pillar experience to one player. `xpGain` is the experience modifier
 * (Education). Level-ups grant one skill point each.
 */
export async function awardXp(g: Ctx, playerId: string | null, pillar: PillarId, amount: number, xpGain = 0): Promise<void> {
  if (!playerId || amount <= 0) return;
  const row = await one<{ level: number; xp: number }>(
    g.tx,
    'SELECT level, xp FROM player_pillars WHERE player_id = $1 AND pillar = $2 FOR UPDATE',
    [playerId, pillar],
  );
  if (!row) return;
  const gained = Math.floor(amount * (1 + xpGain));
  if (gained <= 0) return;
  const next = applyXp(row.level, row.xp, gained);
  await g.tx.query('UPDATE player_pillars SET level = $3, xp = $4, points = points + $5 WHERE player_id = $1 AND pillar = $2', [
    playerId,
    pillar,
    next.level,
    next.xp,
    next.levelsGained,
  ]);
  if (next.levelsGained > 0) {
    await notifyPlayer(g, playerId, {
      type: 'pillar',
      title: `${PILLAR_DEFS[pillar].name} reaches level ${next.level}`,
      body: `You gained ${next.levelsGained} skill point${next.levelsGained > 1 ? 's' : ''} to spend in the ${PILLAR_DEFS[pillar].name} pillar.`,
      link: '/game/pillars',
    });
    await emit(g, playerRoom(playerId), 'pillars:updated', { pillar, level: next.level });
  }
}

async function awardNpcXp(g: Ctx, clanId: string, pillar: PillarId, amount: number, xpGain: number): Promise<void> {
  const row = await one<PillarRow>(g.tx, 'SELECT clan_id, pillar, level, xp, points FROM five_pillars WHERE clan_id = $1 AND pillar = $2 FOR UPDATE', [
    clanId,
    pillar,
  ]);
  if (!row) return;
  const gained = Math.floor(amount * (1 + xpGain));
  if (gained <= 0) return;
  const next = applyXp(row.level, row.xp, gained);
  await g.tx.query('UPDATE five_pillars SET level = $3, xp = $4, points = points + $5 WHERE clan_id = $1 AND pillar = $2', [
    clanId,
    pillar,
    next.level,
    next.xp,
    next.levelsGained,
  ]);
}

/**
 * Award experience for something a clan did. It goes to the member who did it
 * (`playerId`, or the acting player when they belong to the clan); for the
 * work of the simulation itself — the hourly tick, a defence — it goes to the
 * members holding the council seat for that pillar, or to the leader when the
 * seat is empty.
 */
export async function awardClanXp(
  g: Ctx,
  clanId: string | null,
  pillar: PillarId,
  amount: number,
  xpGain = 0,
  playerId?: string | null,
): Promise<void> {
  if (!clanId || amount <= 0) return;
  const members = await rows<{ player_id: string; role: ClanRole }>(g.tx, 'SELECT player_id, role FROM clan_members WHERE clan_id = $1', [clanId]);
  if (members.length === 0) {
    await awardNpcXp(g, clanId, pillar, amount, xpGain);
    return;
  }
  const actor = playerId === undefined ? g.actorPlayerId ?? null : playerId;
  if (actor && members.some((m) => m.player_id === actor)) {
    await awardXp(g, actor, pillar, amount, xpGain);
    return;
  }
  const seat = SEAT_OF_PILLAR[pillar];
  let recipients = members.filter((m) => m.role === seat);
  if (recipients.length === 0) recipients = members.filter((m) => m.role === 'leader');
  for (const m of recipients) await awardXp(g, m.player_id, pillar, amount, xpGain);
}

export async function getPillars(db: Db, playerId: string): Promise<PillarsResponse> {
  const pillarRows = await rows<{ pillar: PillarId; level: number; xp: number; points: number }>(
    db,
    'SELECT pillar, level, xp, points FROM player_pillars WHERE player_id = $1',
    [playerId],
  );
  const skillRows = await rows<{ skill_code: string; rank: number }>(db, 'SELECT skill_code, rank FROM player_skill_ranks WHERE player_id = $1', [playerId]);
  const byPillar = new Map(pillarRows.map((r) => [r.pillar, r]));
  const ranks: SkillRanks = Object.fromEntries(skillRows.map((r) => [r.skill_code, r.rank]));
  const levels = Object.fromEntries(PILLARS.map((p) => [p, byPillar.get(p)?.level ?? 1])) as Record<PillarId, number>;

  // What the clan's council currently lends to everyone, and who carries each pillar.
  let council: PillarsResponse['council'] = null;
  const member = await one<{ clan_id: string; role: ClanRole }>(db, 'SELECT clan_id, role FROM clan_members WHERE player_id = $1', [playerId]);
  if (member) {
    const progress = (await loadProgress(db, member.clan_id)).get(member.clan_id);
    if (progress) {
      const holderIds = [...new Set(Object.values(progress.seats))];
      const names = await rows<{ id: string; nickname: string }>(db, 'SELECT id, nickname FROM players WHERE id = ANY($1)', [holderIds]);
      const nameOf = new Map(names.map((n) => [n.id, n.nickname]));
      council = {
        modifiers: progress.mods,
        seats: PILLARS.map((p) => ({
          pillar: p,
          seatRole: SEAT_OF_PILLAR[p],
          seatName: ROLE_DEFS[SEAT_OF_PILLAR[p]].name,
          playerId: progress.seats[p] ?? null,
          nickname: progress.seats[p] ? nameOf.get(progress.seats[p]!) ?? null : null,
          level: progress.levels[p],
          isYou: progress.seats[p] === playerId,
        })),
      };
    }
  }

  return {
    pillars: PILLARS.map((p) => {
      const row = byPillar.get(p);
      const level = row?.level ?? 1;
      const need = xpToNext(level);
      return { id: p, level, xp: row?.xp ?? 0, xpToNext: Number.isFinite(need) ? need : null, points: row?.points ?? 0 };
    }),
    skills: SKILLS.map((s) => ({
      code: s.code,
      rank: ranks[s.code] ?? 0,
      blockedReason: skillBlockReason(s, levels[s.pillar], byPillar.get(s.pillar)?.points ?? 0, ranks),
    })),
    modifiers: computeModifiers(levels, ranks),
    council,
  };
}

/** Spend one skill point on the next rank of a skill. All rules are checked here, on the server. */
export async function unlockSkill(g: G, playerId: string, skillCode: string): Promise<void> {
  const skill = SKILL_BY_CODE[skillCode];
  if (!skill) throw invalid('Unknown skill');
  const pillar = await one<{ level: number; points: number }>(
    g.tx,
    'SELECT level, points FROM player_pillars WHERE player_id = $1 AND pillar = $2 FOR UPDATE',
    [playerId, skill.pillar],
  );
  if (!pillar) throw conflict('NO_PILLARS', 'You have no pillars yet');
  const skillRows = await rows<{ skill_code: string; rank: number }>(g.tx, 'SELECT skill_code, rank FROM player_skill_ranks WHERE player_id = $1', [playerId]);
  const ranks: SkillRanks = Object.fromEntries(skillRows.map((r) => [r.skill_code, r.rank]));
  const reason = skillBlockReason(skill, pillar.level, pillar.points, ranks);
  if (reason) throw conflict('SKILL_LOCKED', reason);

  const spent = await one(g.tx, 'UPDATE player_pillars SET points = points - 1 WHERE player_id = $1 AND pillar = $2 AND points >= 1 RETURNING points', [
    playerId,
    skill.pillar,
  ]);
  if (!spent) throw conflict('SKILL_LOCKED', 'No skill points available');
  await g.tx.query(
    `INSERT INTO player_skill_ranks (player_id, skill_code, rank, unlocked_at) VALUES ($1, $2, 1, $3)
     ON CONFLICT (player_id, skill_code) DO UPDATE SET rank = player_skill_ranks.rank + 1`,
    [playerId, skillCode, g.now],
  );
  const member = await one<{ clan_id: string }>(g.tx, 'SELECT clan_id FROM clan_members WHERE player_id = $1', [playerId]);
  await audit(g, 'skill.unlock', { type: 'skill', id: skillCode }, member?.clan_id ?? null, { rank: (ranks[skillCode] ?? 0) + 1 });
  await emit(g, playerRoom(playerId), 'pillars:updated', { skill: skillCode });
}
