import type { PillarsResponse } from '@/game/api';
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
import { audit, emitClan, notifyClan } from './notify';
import type { PillarRow } from './rows';
import type { G } from './world';

/** Create the five pillar rows for a new clan. */
export async function initPillars(tx: Db, clanId: string, level = 1): Promise<void> {
  for (const pillar of PILLARS) {
    await tx.query(
      `INSERT INTO five_pillars (clan_id, pillar, level, xp, points) VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (clan_id, pillar) DO NOTHING`,
      [clanId, pillar, level, Math.max(0, level - 1)],
    );
  }
}

/**
 * Award pillar experience for a valid gameplay action. `xpGain` is the clan's
 * experience modifier (Education). Level-ups grant one skill point each.
 */
export async function awardXp(g: Pick<G, 'tx' | 'now'>, clanId: string | null, pillar: PillarId, amount: number, xpGain = 0): Promise<void> {
  if (!clanId || amount <= 0) return;
  const row = await one<PillarRow>(
    g.tx,
    'SELECT clan_id, pillar, level, xp, points FROM five_pillars WHERE clan_id = $1 AND pillar = $2 FOR UPDATE',
    [clanId, pillar],
  );
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
  if (next.levelsGained > 0) {
    await notifyClan(g, clanId, {
      type: 'pillar',
      title: `${PILLAR_DEFS[pillar].name} reaches level ${next.level}`,
      body: `You gained ${next.levelsGained} skill point${next.levelsGained > 1 ? 's' : ''} to spend in the ${PILLAR_DEFS[pillar].name} pillar.`,
      link: '/game/pillars',
    });
    await emitClan(g, clanId, 'pillars:updated', { pillar, level: next.level });
  }
}

export async function getPillars(db: Db, clanId: string): Promise<PillarsResponse> {
  const pillarRows = await rows<PillarRow>(db, 'SELECT clan_id, pillar, level, xp, points FROM five_pillars WHERE clan_id = $1', [clanId]);
  const skillRows = await rows<{ skill_code: string; rank: number }>(db, 'SELECT skill_code, rank FROM player_skills WHERE clan_id = $1', [clanId]);
  const byPillar = new Map(pillarRows.map((r) => [r.pillar, r]));
  const ranks: SkillRanks = Object.fromEntries(skillRows.map((r) => [r.skill_code, r.rank]));
  const levels = Object.fromEntries(PILLARS.map((p) => [p, byPillar.get(p)?.level ?? 1])) as Record<PillarId, number>;
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
  };
}

/** Spend one skill point on the next rank of a skill. All rules are checked here, on the server. */
export async function unlockSkill(g: G, clanId: string, skillCode: string): Promise<void> {
  const skill = SKILL_BY_CODE[skillCode];
  if (!skill) throw invalid('Unknown skill');
  const pillar = await one<PillarRow>(
    g.tx,
    'SELECT clan_id, pillar, level, xp, points FROM five_pillars WHERE clan_id = $1 AND pillar = $2 FOR UPDATE',
    [clanId, skill.pillar],
  );
  if (!pillar) throw conflict('NO_PILLARS', 'Your Daimyo has no pillars yet');
  const skillRows = await rows<{ skill_code: string; rank: number }>(g.tx, 'SELECT skill_code, rank FROM player_skills WHERE clan_id = $1', [clanId]);
  const ranks: SkillRanks = Object.fromEntries(skillRows.map((r) => [r.skill_code, r.rank]));
  const reason = skillBlockReason(skill, pillar.level, pillar.points, ranks);
  if (reason) throw conflict('SKILL_LOCKED', reason);

  const spent = await one(g.tx, 'UPDATE five_pillars SET points = points - 1 WHERE clan_id = $1 AND pillar = $2 AND points >= 1 RETURNING points', [
    clanId,
    skill.pillar,
  ]);
  if (!spent) throw conflict('SKILL_LOCKED', 'No skill points available');
  await g.tx.query(
    `INSERT INTO player_skills (clan_id, skill_code, rank, unlocked_at) VALUES ($1, $2, 1, $3)
     ON CONFLICT (clan_id, skill_code) DO UPDATE SET rank = player_skills.rank + 1`,
    [clanId, skillCode, g.now],
  );
  await audit(g, 'skill.unlock', { type: 'skill', id: skillCode }, clanId, { rank: (ranks[skillCode] ?? 0) + 1 });
  await emitClan(g, clanId, 'pillars:updated', { skill: skillCode });
}
