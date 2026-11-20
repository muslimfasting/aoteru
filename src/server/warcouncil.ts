/**
 * The War Council (change request §7): the clan plans an attack together.
 *
 * A strategist drafts a plan — target, province of departure, host, tactic,
 * commander — and gives members their duties. Members accept. When the plan
 * is marked ready, someone who may command (or its commander) launches it;
 * from there it is an ordinary attack, resolved by the server, that carries
 * the plan's tactic and whatever its accepted assignments are worth.
 */
import { DUTY_DEFS, WAR_DUTIES, type WarDuty } from '@/game/clan';
import { normalizeUnits, totalUnits } from '@/game/config';
import { TACTICS, TACTIC_DEFS, type TacticId } from '@/game/strategy';
import { one, rows, type Db } from './db';
import { GameError, conflict, invalid, notFound } from './errors';
import { dispatchArmy } from './military';
import { audit, clanActivity, emitClan, notifyPlayer } from './notify';
import type { ClanRow, MemberRow, ProvinceRow } from './rows';
import { planBonuses } from './warplans';
import type { G } from './world';

export interface WarPlanRow {
  id: string;
  clan_id: string;
  title: string;
  target_province_id: string;
  origin_province_id: string;
  tactic: string;
  units: Record<string, number>;
  commander_player_id: string | null;
  scheduled_at: Date | null;
  notes: string;
  status: 'draft' | 'ready' | 'launched' | 'completed' | 'cancelled';
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  launched_at: Date | null;
  army_id: string | null;
  battle_id: string | null;
  outcome: string | null;
}

export interface WarPlanInput {
  title: string;
  targetProvinceId: string;
  originProvinceId: string;
  tactic: string;
  units: Partial<Record<string, number>>;
  commanderId: string | null;
  scheduledAt?: string | null;
  notes?: string;
}

interface Actor {
  id: string;
  nickname: string;
}

const MAX_OPEN_PLANS = 12;
const clean = (value: string, max: number) => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);

async function lockPlan(tx: Db, clan: ClanRow, planId: string): Promise<WarPlanRow> {
  const plan = await one<WarPlanRow>(tx, 'SELECT * FROM war_plans WHERE id = $1 AND clan_id = $2 FOR UPDATE', [planId, clan.id]);
  if (!plan) throw notFound('War plan');
  return plan;
}

async function memberOf(tx: Db, clan: ClanRow, playerId: string): Promise<{ player_id: string; nickname: string }> {
  const row = await one<{ player_id: string; nickname: string }>(
    tx,
    'SELECT m.player_id, p.nickname FROM clan_members m JOIN players p ON p.id = m.player_id WHERE m.player_id = $1 AND m.clan_id = $2',
    [playerId, clan.id],
  );
  if (!row) throw conflict('NOT_A_MEMBER', 'That player is not an official of the nation');
  return row;
}

/** Check and normalise what a plan says. The attack itself is validated again, in full, when it is launched. */
async function validate(g: G, clan: ClanRow, input: WarPlanInput) {
  const title = clean(input.title ?? '', 60);
  if (title.length < 3) throw invalid('Give the plan a name of at least 3 characters');
  if (!(TACTICS as readonly string[]).includes(input.tactic)) throw invalid('Unknown tactic');
  const origin = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1', [input.originProvinceId]);
  const target = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1', [input.targetProvinceId]);
  if (!origin || !target) throw notFound('Province');
  if (origin.owner_clan_id !== clan.id) throw conflict('PLAN_INVALID', 'The army must set out from a province the nation holds');
  if (target.owner_clan_id === clan.id) throw conflict('PLAN_INVALID', 'The nation already holds the target');
  const units = normalizeUnits(input.units ?? {});
  if (totalUnits(units) <= 0) throw invalid('Choose the soldiers to send');
  let scheduledAt: Date | null = null;
  if (input.scheduledAt) {
    scheduledAt = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw invalid('The attack time is not a valid date');
    if (scheduledAt.getTime() > g.now.getTime() + 14 * 86_400_000) throw invalid('The attack time is too far in the future');
  }
  const commander = input.commanderId ? await memberOf(g.tx, clan, input.commanderId) : null;
  return { title, tactic: input.tactic as TacticId, origin, target, units, scheduledAt, commander, notes: clean(input.notes ?? '', 600) };
}

/** Keep the plan's commander and the `commander` assignment in step. */
async function syncCommander(g: G, plan: { id: string; title: string }, commanderId: string | null, actor: Actor): Promise<void> {
  await g.tx.query(`DELETE FROM war_assignments WHERE plan_id = $1 AND duty = 'commander' AND player_id IS DISTINCT FROM $2`, [plan.id, commanderId]);
  if (!commanderId) return;
  const created = await one(
    g.tx,
    `INSERT INTO war_assignments (plan_id, player_id, duty, status, assigned_by, created_at, responded_at)
     VALUES ($1, $2, 'commander', $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING player_id`,
    [plan.id, commanderId, commanderId === actor.id ? 'accepted' : 'assigned', actor.id, g.now, commanderId === actor.id ? g.now : null],
  );
  if (created && commanderId !== actor.id) {
    await notifyPlayer(g, commanderId, {
      type: 'war',
      title: `You are named commander of "${plan.title}"`,
      body: `${actor.nickname} asks you to lead the attack. Accept the duty in the War Council.`,
      link: '/game/war',
    });
  }
}

export async function createPlan(g: G, clan: ClanRow, actor: Actor, input: WarPlanInput): Promise<string> {
  const v = await validate(g, clan, input);
  const open = await one<{ n: number }>(g.tx, `SELECT COUNT(*)::int AS n FROM war_plans WHERE clan_id = $1 AND status IN ('draft', 'ready')`, [clan.id]);
  if ((open?.n ?? 0) >= MAX_OPEN_PLANS) throw conflict('TOO_MANY_PLANS', 'The council has too many open plans. Launch or cancel one first.');
  const plan = await one<{ id: string }>(
    g.tx,
    `INSERT INTO war_plans (clan_id, title, target_province_id, origin_province_id, tactic, units, commander_player_id, scheduled_at, notes, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
    [clan.id, v.title, v.target.id, v.origin.id, v.tactic, JSON.stringify(v.units), v.commander?.player_id ?? null, v.scheduledAt, v.notes, actor.id, g.now],
  );
  // Whoever drafts the plan is its strategist.
  await g.tx.query(
    `INSERT INTO war_assignments (plan_id, player_id, duty, status, assigned_by, created_at, responded_at) VALUES ($1, $2, 'strategist', 'accepted', $2, $3, $3)`,
    [plan!.id, actor.id, g.now],
  );
  await syncCommander(g, { id: plan!.id, title: v.title }, v.commander?.player_id ?? null, actor);
  await clanActivity(g, clan.id, 'war_plan', `${actor.nickname} drafted the war plan "${v.title}" against ${v.target.name}.`);
  await audit(g, 'war.plan.create', { type: 'war_plan', id: plan!.id }, clan.id, { target: v.target.code, tactic: v.tactic });
  await emitClan(g, clan.id, 'war:updated', { planId: plan!.id });
  return plan!.id;
}

export async function updatePlan(g: G, clan: ClanRow, actor: Actor, planId: string, input: WarPlanInput): Promise<void> {
  const plan = await lockPlan(g.tx, clan, planId);
  if (plan.status !== 'draft' && plan.status !== 'ready') throw conflict('PLAN_CLOSED', 'That plan can no longer be changed');
  const v = await validate(g, clan, input);
  await g.tx.query(
    `UPDATE war_plans SET title = $2, target_province_id = $3, origin_province_id = $4, tactic = $5, units = $6, commander_player_id = $7,
                          scheduled_at = $8, notes = $9, updated_at = $10
      WHERE id = $1`,
    [plan.id, v.title, v.target.id, v.origin.id, v.tactic, JSON.stringify(v.units), v.commander?.player_id ?? null, v.scheduledAt, v.notes, g.now],
  );
  await syncCommander(g, { id: plan.id, title: v.title }, v.commander?.player_id ?? null, actor);
  await audit(g, 'war.plan.update', { type: 'war_plan', id: plan.id }, clan.id, { target: v.target.code, tactic: v.tactic });
  await emitClan(g, clan.id, 'war:updated', { planId: plan.id });
}

export async function setPlanStatus(g: G, clan: ClanRow, actor: Actor, planId: string, status: 'draft' | 'ready' | 'cancelled'): Promise<void> {
  const plan = await lockPlan(g.tx, clan, planId);
  if (plan.status !== 'draft' && plan.status !== 'ready') throw conflict('PLAN_CLOSED', 'That plan can no longer be changed');
  if (status === 'ready' && !plan.commander_player_id) throw conflict('PLAN_INCOMPLETE', 'Name a commander before marking the plan ready');
  await g.tx.query('UPDATE war_plans SET status = $2, outcome = $3, updated_at = $4 WHERE id = $1', [
    plan.id,
    status,
    status === 'cancelled' ? 'cancelled by the council' : null,
    g.now,
  ]);
  if (status !== plan.status) {
    const assigned = await rows<{ player_id: string }>(g.tx, 'SELECT DISTINCT player_id FROM war_assignments WHERE plan_id = $1', [plan.id]);
    if (status === 'ready') {
      for (const a of assigned) {
        if (a.player_id === actor.id) continue;
        await notifyPlayer(g, a.player_id, {
          type: 'war',
          title: `War plan "${plan.title}" is ready`,
          body: 'The council has settled the plan. Make sure you have accepted your duty.',
          link: '/game/war',
        });
      }
    }
    if (status === 'cancelled') await clanActivity(g, clan.id, 'war_plan', `${actor.nickname} cancelled the war plan "${plan.title}".`);
  }
  await emitClan(g, clan.id, 'war:updated', { planId: plan.id });
}

export async function assignDuty(g: G, clan: ClanRow, actor: Actor, planId: string, playerId: string, duty: string, note: string): Promise<void> {
  if (!(WAR_DUTIES as readonly string[]).includes(duty)) throw invalid('Unknown duty');
  if (duty === 'commander') throw invalid('Name the commander on the plan itself');
  const plan = await lockPlan(g.tx, clan, planId);
  if (plan.status !== 'draft' && plan.status !== 'ready') throw conflict('PLAN_CLOSED', 'That plan can no longer be changed');
  const member = await memberOf(g.tx, clan, playerId);
  const created = await one(
    g.tx,
    `INSERT INTO war_assignments (plan_id, player_id, duty, status, note, assigned_by, created_at, responded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING player_id`,
    [plan.id, member.player_id, duty, playerId === actor.id ? 'accepted' : 'assigned', clean(note, 160), actor.id, g.now, playerId === actor.id ? g.now : null],
  );
  if (!created) throw conflict('ALREADY_ASSIGNED', `${member.nickname} already has that duty`);
  if (playerId !== actor.id) {
    await notifyPlayer(g, playerId, {
      type: 'war',
      title: `A duty for you in "${plan.title}": ${DUTY_DEFS[duty as WarDuty].name}`,
      body: `${actor.nickname} asks you to serve as ${DUTY_DEFS[duty as WarDuty].name}. ${DUTY_DEFS[duty as WarDuty].summary} Accept it in the War Council.`,
      link: '/game/war',
    });
  }
  await emitClan(g, clan.id, 'war:updated', { planId: plan.id });
}

export async function removeDuty(g: G, clan: ClanRow, planId: string, playerId: string, duty: string): Promise<void> {
  const plan = await lockPlan(g.tx, clan, planId);
  if (plan.status !== 'draft' && plan.status !== 'ready') throw conflict('PLAN_CLOSED', 'That plan can no longer be changed');
  if (duty === 'commander') throw invalid('Change the commander on the plan itself');
  const gone = await one(g.tx, 'DELETE FROM war_assignments WHERE plan_id = $1 AND player_id = $2 AND duty = $3 RETURNING player_id', [plan.id, playerId, duty]);
  if (!gone) throw notFound('Assignment');
  await emitClan(g, clan.id, 'war:updated', { planId: plan.id });
}

/** A member accepts or declines a duty given to them. */
export async function respondDuty(g: G, clan: ClanRow, member: Actor, planId: string, duty: string, accept: boolean): Promise<void> {
  const plan = await lockPlan(g.tx, clan, planId);
  if (plan.status !== 'draft' && plan.status !== 'ready') throw conflict('PLAN_CLOSED', 'That plan is no longer open');
  const row = await one(
    g.tx,
    `UPDATE war_assignments SET status = $4, responded_at = $5 WHERE plan_id = $1 AND player_id = $2 AND duty = $3 RETURNING player_id`,
    [plan.id, member.id, duty, accept ? 'accepted' : 'declined', g.now],
  );
  if (!row) throw notFound('Assignment');
  if (plan.created_by && plan.created_by !== member.id) {
    await notifyPlayer(g, plan.created_by, {
      type: 'war',
      title: `${member.nickname} ${accept ? 'accepts' : 'declines'}: ${DUTY_DEFS[duty as WarDuty]?.name ?? duty}`,
      body: `War plan "${plan.title}".`,
      link: '/game/war',
    });
  }
  await emitClan(g, clan.id, 'war:updated', { planId: plan.id });
}

/**
 * Launch a ready plan. Allowed to members who may command, and to the plan's
 * own commander. The attack is validated in full by the same code as any
 * other order: route, state of war, troops in the garrison, the tactic's
 * requirements, supplies and cost.
 */
export async function launchPlan(g: G, clan: ClanRow, member: MemberRow & { nickname: string }, planId: string, mayCommand: boolean): Promise<string> {
  const plan = await lockPlan(g.tx, clan, planId);
  if (plan.status === 'launched' || plan.status === 'completed') throw conflict('PLAN_CLOSED', 'That plan has already been launched');
  if (plan.status !== 'ready') throw conflict('PLAN_NOT_READY', 'The council has not marked that plan ready');
  if (!plan.commander_player_id) throw conflict('PLAN_INCOMPLETE', 'The plan has no commander');
  const isCommander = plan.commander_player_id === member.player_id;
  if (!isCommander && !mayCommand) {
    throw new GameError('FORBIDDEN_ROLE', 'Only the plan\'s commander or a member who may command can launch it', 403);
  }
  await memberOf(g.tx, clan, plan.commander_player_id);
  if (isCommander) {
    await g.tx.query(`UPDATE war_assignments SET status = 'accepted', responded_at = $3 WHERE plan_id = $1 AND player_id = $2 AND duty = 'commander'`, [
      plan.id,
      member.player_id,
      g.now,
    ]);
  } else {
    const accepted = await one(g.tx, `SELECT 1 FROM war_assignments WHERE plan_id = $1 AND player_id = $2 AND duty = 'commander' AND status = 'accepted'`, [
      plan.id,
      plan.commander_player_id,
    ]);
    if (!accepted) throw conflict('PLAN_INCOMPLETE', 'The commander has not accepted the duty yet');
  }

  const bonuses = await planBonuses(g.tx, plan.id, false);
  const armyId = await dispatchArmy(g, clan, plan.commander_player_id, plan.origin_province_id, plan.target_province_id, plan.units, 'attack', {
    tactic: plan.tactic,
    planId: plan.id,
    supplyFactor: bonuses.supplyFactor,
  });
  await g.tx.query(`UPDATE war_plans SET status = 'launched', launched_at = $2, army_id = $3, updated_at = $2 WHERE id = $1`, [plan.id, g.now, armyId]);
  const assigned = await rows<{ player_id: string }>(g.tx, `SELECT DISTINCT player_id FROM war_assignments WHERE plan_id = $1 AND status <> 'declined'`, [plan.id]);
  for (const a of assigned) {
    if (a.player_id === member.player_id) continue;
    await notifyPlayer(g, a.player_id, {
      type: 'war',
      title: `"${plan.title}" is under way`,
      body: `${member.nickname} has launched the attack with ${TACTIC_DEFS[plan.tactic as TacticId]?.name ?? 'a frontal assault'}.`,
      link: '/game/war',
    });
  }
  await clanActivity(g, clan.id, 'war_plan', `${member.nickname} launched the war plan "${plan.title}".`);
  await audit(g, 'war.plan.launch', { type: 'war_plan', id: plan.id }, clan.id, { armyId });
  await emitClan(g, clan.id, 'war:updated', { planId: plan.id });
  return armyId;
}
