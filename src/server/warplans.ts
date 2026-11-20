/**
 * What a war plan's assignments are worth in the field, and what happens to
 * the plan when its battle has been fought. Kept apart from the War Council
 * orders (warcouncil.ts) so the battle resolver can use it without a cycle.
 */
import type { BattleResult } from '@/game/battle';
import type { WarDuty } from '@/game/clan';
import { PILLARS, type PillarId } from '@/game/pillars';
import { one, rows, type Db } from './db';
import { clanActivity, emitClan, notifyPlayer } from './notify';
import { awardXp } from './progression';
import { loadPlayerProgress } from './rows';
import type { G } from './world';

export interface PlanBonuses {
  /** Added to the chance that the tactic comes off. */
  chance: number;
  /** Flat morale for the attacking army. */
  morale: number;
  /** Multiplier on the food the march consumes. */
  supplyFactor: number;
  /** Duties that are filled by a member who accepted. */
  filled: WarDuty[];
}

export const NO_PLAN_BONUS: PlanBonuses = { chance: 0, morale: 0, supplyFactor: 1, filled: [] };

/** Members who accepted a duty in the plan. */
async function acceptedDuties(tx: Db, planId: string): Promise<{ player_id: string; duty: WarDuty }[]> {
  return rows<{ player_id: string; duty: WarDuty }>(tx, `SELECT player_id, duty FROM war_assignments WHERE plan_id = $1 AND status = 'accepted'`, [planId]);
}

/**
 * What the accepted assignments of a plan add. Teamwork counts: a plan with a
 * strategist, a scout who has actually scouted the target, a logistics officer
 * and reserves standing by fights better than one member acting alone.
 */
export async function planBonuses(tx: Db, planId: string | null, hasIntel: boolean): Promise<PlanBonuses> {
  if (!planId) return NO_PLAN_BONUS;
  const accepted = await acceptedDuties(tx, planId);
  if (accepted.length === 0) return NO_PLAN_BONUS;
  const has = (duty: WarDuty) => accepted.some((a) => a.duty === duty);
  let chance = 0;
  const strategists = accepted.filter((a) => a.duty === 'strategist').map((a) => a.player_id);
  if (strategists.length > 0) {
    const people = await loadPlayerProgress(tx, strategists);
    const best = Math.max(...strategists.map((id) => people.get(id)?.levels.intelligence ?? 1));
    chance += Math.min(0.06, best * 0.01);
  }
  if (has('scout') && hasIntel) chance += 0.08;
  return {
    chance,
    morale: has('reinforcement') ? 4 : 0,
    supplyFactor: has('logistics') ? 0.8 : 1,
    filled: [...new Set(accepted.map((a) => a.duty))],
  };
}

const DUTY_XP: Record<WarDuty, { pillar: PillarId; amount: number }> = {
  commander: { pillar: 'leadership', amount: 20 },
  strategist: { pillar: 'intelligence', amount: 30 },
  scout: { pillar: 'intelligence', amount: 25 },
  logistics: { pillar: 'economy', amount: 25 },
  reinforcement: { pillar: 'military', amount: 20 },
  defender: { pillar: 'military', amount: 20 },
  spy: { pillar: 'intelligence', amount: 20 },
};

/** The plan's battle is over: record the outcome and reward everyone who took part. */
export async function completePlan(g: G, planId: string | null, battleId: string, result: BattleResult, captured: boolean): Promise<void> {
  if (!planId) return;
  const plan = await one<{ id: string; clan_id: string; title: string; status: string }>(
    g.tx,
    'SELECT id, clan_id, title, status FROM war_plans WHERE id = $1 FOR UPDATE',
    [planId],
  );
  if (!plan || plan.status !== 'launched') return;
  await g.tx.query(`UPDATE war_plans SET status = 'completed', outcome = $2, battle_id = $3, updated_at = $4 WHERE id = $1`, [
    plan.id,
    result.outcome,
    battleId,
    g.now,
  ]);
  const won = result.winner === 'attacker';
  const told = new Set<string>();
  for (const a of await acceptedDuties(g.tx, plan.id)) {
    // Still a member? Someone who left before the battle earns nothing from it.
    const member = await one(g.tx, 'SELECT 1 FROM clan_members WHERE player_id = $1 AND clan_id = $2', [a.player_id, plan.clan_id]);
    if (!member) continue;
    // Experience for every duty carried; standing and the report once per member.
    const xp = DUTY_XP[a.duty];
    if (PILLARS.includes(xp.pillar)) await awardXp({ ...g, actorPlayerId: null }, a.player_id, xp.pillar, Math.round(xp.amount * (won ? 1.5 : 1)));
    if (told.has(a.player_id)) continue;
    told.add(a.player_id);
    await g.tx.query('UPDATE clan_members SET contribution = contribution + $2 WHERE player_id = $1', [a.player_id, won ? 60 : 30]);
    await g.tx.query('UPDATE players SET reputation = reputation + $2 WHERE id = $1', [a.player_id, won ? (captured ? 3 : 2) : 1]);
    await notifyPlayer(g, a.player_id, {
      type: 'battle',
      title: `War plan "${plan.title}": ${won ? (captured ? 'the province is taken' : 'victory') : 'the attack failed'}`,
      body: 'Your part in the plan has been recorded. Read the battle report to see how the strategy fared.',
      link: `/game/battles/${battleId}`,
    });
  }
  await clanActivity(g, plan.clan_id, 'war_plan', `War plan "${plan.title}" was carried out: ${result.outcome.replace('_', ' ')}.`);
  await emitClan(g, plan.clan_id, 'war:updated', { planId: plan.id });
}

/** The army of a launched plan never fought (called off, clan fell): close the plan. */
export async function abandonPlan(g: G, planId: string | null, reason: string): Promise<void> {
  if (!planId) return;
  await g.tx.query(`UPDATE war_plans SET status = 'cancelled', outcome = $2, updated_at = $3 WHERE id = $1 AND status = 'launched'`, [planId, reason, g.now]);
}
