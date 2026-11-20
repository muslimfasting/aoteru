/**
 * Read models for the War Council and for choosing a tactic. Only members of
 * the clan ever see its plans; what is shown about the enemy is limited to
 * what the clan's own scouts have reported.
 */
import type { TacticOptionDTO, WarAssignmentDTO, WarCouncilResponse, WarPlanDTO } from '@/game/api';
import { DOCTRINE_DEFS, DUTY_DEFS, ROLE_DEFS, playerLevel, type ClanRole, type DoctrineId, type WarDuty } from '@/game/clan';
import { emptyUnits, normalizeUnits, totalUnits, type UnitCounts } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import type { PillarId } from '@/game/pillars';
import { STANCE_DEFS, TACTICS, TACTIC_DEFS, tacticBlockReason, tacticChance, type StanceId, type TacticId } from '@/game/strategy';
import { one, rows, type Db } from './db';
import { GameError } from './errors';
import { planMarch } from './military';
import { alliesOf, atWar, loadPlayerProgress, loadProgress, type ClanRow, type ProvinceRow } from './rows';
import { loadWorldView, type Viewer } from './views';
import type { WarPlanRow } from './warcouncil';
import { planBonuses } from './warplans';
import { gameMs } from './world';

const BASE_LEVELS: Record<PillarId, number> = { military: 1, leadership: 1, economy: 1, intelligence: 1, culture: 1 };

interface KnownStance {
  stance: StanceId;
  stanceName: string;
  reportedAt: string;
}

/** What the clan's freshest scouting report says about how a province is held. */
export async function knownStance(db: Db, clanId: string, provinceId: string, now: Date): Promise<KnownStance | null> {
  const row = await one<{ report: { stance?: StanceId; reportedAt: string } | null }>(
    db,
    `SELECT report FROM espionage
      WHERE clan_id = $1 AND target_province_id = $2 AND status = 'success' AND report_expires_at > $3
      ORDER BY resolved_at DESC LIMIT 1`,
    [clanId, provinceId, now],
  );
  const stance = row?.report?.stance;
  if (!stance || !STANCE_DEFS[stance]) return null;
  return { stance, stanceName: STANCE_DEFS[stance].name, reportedAt: row!.report!.reportedAt };
}

/** Every tactic as it stands for this host, commander and target. */
export async function tacticOptions(
  db: Db,
  clan: ClanRow,
  commanderId: string | null,
  units: Partial<UnitCounts>,
  target: Pick<ProvinceRow, 'id' | 'terrain'> | null,
  now: Date,
  speed: number,
  chanceBonus = 0,
): Promise<{ tactics: TacticOptionDTO[]; knownStance: KnownStance | null }> {
  const levels = (await loadProgress(db, clan.id, commanderId)).get(clan.id)?.levels ?? BASE_LEVELS;
  const known = target ? await knownStance(db, clan.id, target.id, now) : null;
  const doctrine = DOCTRINE_DEFS[clan.doctrine as DoctrineId]?.tacticChance ?? 0;
  const tactics = TACTICS.map((id): TacticOptionDTO => {
    const def = TACTIC_DEFS[id];
    const chance = def.baseChance >= 1 ? null : tacticChance({ tactic: id, attackerLevels: levels, defenderLevels: levels, chanceBonus: chanceBonus + doctrine });
    return {
      id,
      blockedReason: tacticBlockReason(id, units, levels, target?.terrain ?? null),
      chance,
      cost: def.cost,
      extraMs: def.extraMinutes > 0 ? gameMs({ speed }, def.extraMinutes) : 0,
      supplyFactor: def.supplyFactor,
      counteredByKnownStance: !!known && def.counter === known.stance,
    };
  });
  return { tactics, knownStance: known };
}

export async function buildWarCouncil(db: Db, viewer: Viewer, now: Date): Promise<WarCouncilResponse> {
  if (!viewer.clan || !viewer.member) throw new GameError('NO_CLAN', 'Join or found a clan first', 409);
  const clan = viewer.clan;
  const me = viewer.player.id;
  const view = await loadWorldView(db, now);
  const speed = view.state.speed;
  const canPlan = viewer.member.permissions.includes('war_plans');
  const canCommand = viewer.member.permissions.includes('command');
  const doctrine = DOCTRINE_DEFS[clan.doctrine as DoctrineId]?.tacticChance ?? 0;

  const planRows = await rows<WarPlanRow>(
    db,
    `SELECT * FROM war_plans WHERE clan_id = $1
      ORDER BY (status IN ('draft', 'ready', 'launched')) DESC, updated_at DESC LIMIT 30`,
    [clan.id],
  );
  const assignRows = planRows.length
    ? await rows<{ plan_id: string; player_id: string; duty: WarDuty; status: WarAssignmentDTO['status']; note: string; nickname: string; portrait: string }>(
        db,
        `SELECT a.plan_id, a.player_id, a.duty, a.status, a.note, p.nickname, p.portrait
           FROM war_assignments a JOIN players p ON p.id = a.player_id
          WHERE a.plan_id = ANY($1) ORDER BY a.created_at`,
        [planRows.map((p) => p.id)],
      )
    : [];
  const provinceById = new Map(view.provinces.map((p) => [p.id, p]));
  const nameOf = (p: ProvinceRow | undefined) => (p ? PROVINCE_BY_CODE[p.code]?.name ?? p.name : 'Unknown');
  const playerIds = [...new Set(planRows.flatMap((p) => [p.commander_player_id, p.created_by]).filter((x): x is string => !!x))];
  const nickRows = playerIds.length ? await rows<{ id: string; nickname: string }>(db, 'SELECT id, nickname FROM players WHERE id = ANY($1)', [playerIds]) : [];
  const nick = new Map(nickRows.map((r) => [r.id, r.nickname]));

  const plans: WarPlanDTO[] = [];
  for (const plan of planRows) {
    const target = provinceById.get(plan.target_province_id);
    const origin = provinceById.get(plan.origin_province_id);
    const units = normalizeUnits(plan.units ?? {});
    const tactic: TacticId = (TACTICS as readonly string[]).includes(plan.tactic) ? (plan.tactic as TacticId) : 'assault';
    const open = plan.status === 'draft' || plan.status === 'ready';
    const known = open && target ? await knownStance(db, clan.id, target.id, now) : null;
    const bonuses = await planBonuses(db, plan.id, !!known);
    const levels = (await loadProgress(db, clan.id, plan.commander_player_id)).get(clan.id)?.levels ?? BASE_LEVELS;
    const def = TACTIC_DEFS[tactic];

    let launch: WarPlanDTO['launch'] = { ok: false, reason: null, durationMs: 0, supplies: 0 };
    if (open && target && origin) {
      const march = await planMarch({ tx: db, now }, clan, origin.id, target.id, units);
      const blocked = march.ok ? tacticBlockReason(tactic, units, levels, target.terrain) : null;
      const commanderAccepted = assignRows.some(
        (a) => a.plan_id === plan.id && a.duty === 'commander' && a.player_id === plan.commander_player_id && a.status === 'accepted',
      );
      let reason = march.reason ?? (blocked ? `${def.name}: ${blocked}` : null);
      if (!reason && !plan.commander_player_id) reason = 'Name a commander';
      if (!reason && plan.status !== 'ready') reason = 'Mark the plan ready first';
      if (!reason && !commanderAccepted && plan.commander_player_id !== me) reason = 'The commander has not accepted the duty yet';
      launch = {
        ok: !reason,
        reason,
        durationMs: march.minutes > 0 ? gameMs({ speed }, march.minutes) + (def.extraMinutes > 0 ? gameMs({ speed }, def.extraMinutes) : 0) : 0,
        supplies: Math.ceil(march.supplies * def.supplyFactor * bonuses.supplyFactor),
      };
    }
    const owner = target?.owner_clan_id ? view.clans.find((c) => c.id === target.owner_clan_id) : null;
    plans.push({
      id: plan.id,
      title: plan.title,
      status: plan.status,
      tactic,
      targetProvinceId: plan.target_province_id,
      targetName: nameOf(target),
      targetOwnerName: owner?.name ?? null,
      originProvinceId: plan.origin_province_id,
      originName: nameOf(origin),
      units,
      total: totalUnits(units),
      commander: plan.commander_player_id ? { playerId: plan.commander_player_id, nickname: nick.get(plan.commander_player_id) ?? 'unknown' } : null,
      scheduledAt: plan.scheduled_at ? plan.scheduled_at.toISOString() : null,
      notes: plan.notes,
      createdBy: plan.created_by ? nick.get(plan.created_by) ?? null : null,
      createdAt: plan.created_at.toISOString(),
      launchedAt: plan.launched_at ? plan.launched_at.toISOString() : null,
      battleId: plan.battle_id,
      outcome: plan.outcome,
      assignments: assignRows
        .filter((a) => a.plan_id === plan.id)
        .map((a) => ({
          playerId: a.player_id,
          nickname: a.nickname,
          portrait: a.portrait,
          duty: a.duty,
          dutyName: DUTY_DEFS[a.duty]?.name ?? a.duty,
          status: a.status,
          note: a.note,
          isYou: a.player_id === me,
        })),
      bonuses: { chance: bonuses.chance, morale: bonuses.morale, supplyFactor: bonuses.supplyFactor, filled: bonuses.filled },
      chance:
        def.baseChance >= 1
          ? null
          : Math.round(tacticChance({ tactic, attackerLevels: levels, defenderLevels: levels, chanceBonus: bonuses.chance + doctrine }) * 1000) / 1000,
      knownStance: known ? { stance: known.stance, stanceName: known.stanceName, countersTactic: def.counter === known.stance } : null,
      launch,
      canEdit: canPlan && open,
      canLaunch: plan.status === 'ready' && (canCommand || plan.commander_player_id === me),
    });
  }

  const memberRows = await rows<{ player_id: string; role: ClanRole; nickname: string; portrait: string }>(
    db,
    'SELECT m.player_id, m.role, p.nickname, p.portrait FROM clan_members m JOIN players p ON p.id = m.player_id WHERE m.clan_id = $1 ORDER BY p.nickname',
    [clan.id],
  );
  const people = await loadPlayerProgress(db, memberRows.map((m) => m.player_id));
  const allies = alliesOf(view.pacts, clan.id);
  return {
    plans,
    canPlan,
    members: memberRows.map((m) => {
      const levels = people.get(m.player_id)!.levels;
      return { playerId: m.player_id, nickname: m.nickname, portrait: m.portrait, roleName: ROLE_DEFS[m.role].name, level: playerLevel(levels), pillars: levels };
    }),
    origins: view.provinces
      .filter((p) => p.owner_clan_id === clan.id)
      .map((p) => ({
        id: p.id,
        name: nameOf(p),
        garrison: view.armies.find((a) => a.status === 'garrison' && a.province_id === p.id && a.clan_id === clan.id)?.units ?? emptyUnits(),
      })),
    targets: view.provinces
      .filter((p) => p.owner_clan_id !== clan.id)
      .map((p) => ({
        id: p.id,
        name: nameOf(p),
        ownerName: p.owner_clan_id ? view.clans.find((c) => c.id === p.owner_clan_id)?.name ?? null : null,
        relation: !p.owner_clan_id
          ? ('unclaimed' as const)
          : atWar(view.wars, clan.id, p.owner_clan_id)
            ? ('enemy' as const)
            : allies.has(p.owner_clan_id)
              ? ('allied' as const)
              : ('foreign' as const),
        terrain: p.terrain,
      })),
    levels: (await loadProgress(db, clan.id)).get(clan.id)?.levels ?? BASE_LEVELS,
  };
}
