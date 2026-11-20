/**
 * The stance a province is held in (see src/game/strategy.ts). A clan orders
 * it; it takes time to prepare, so a garrison cannot change its dispositions
 * the moment an enemy column appears on the road.
 */
import { WORLD, totalUnits } from '@/game/config';
import { STANCES, STANCE_DEFS, STANCE_PREP_MINUTES, defaultStance, stanceBlockReason, type StanceId } from '@/game/strategy';
import { getGarrison } from './armies';
import { one } from './db';
import { spend } from './economy';
import { conflict, forbidden, invalid, notFound } from './errors';
import { audit, emitClan } from './notify';
import type { ClanRow, ProvinceRow } from './rows';
import { addMs, gameMs, type G } from './world';

const isStance = (value: string | null | undefined): value is StanceId => !!value && (STANCES as readonly string[]).includes(value);

/** The stance in force at `now`: a newly ordered one only once it has been prepared. */
export function effectiveStance(p: Pick<ProvinceRow, 'stance' | 'stance_next' | 'stance_ready_at'>, now: Date): StanceId {
  if (isStance(p.stance_next) && p.stance_ready_at && p.stance_ready_at.getTime() <= now.getTime()) return p.stance_next;
  return isStance(p.stance) ? p.stance : 'formation';
}

/** A stance being prepared, if any. */
export function pendingStance(p: Pick<ProvinceRow, 'stance_next' | 'stance_ready_at'>, now: Date): { stance: StanceId; readyAt: Date } | null {
  if (isStance(p.stance_next) && p.stance_ready_at && p.stance_ready_at.getTime() > now.getTime()) {
    return { stance: p.stance_next, readyAt: p.stance_ready_at };
  }
  return null;
}

/**
 * The stance of a garrison nobody gives orders to (unclaimed land, NPC clans):
 * decided by the terrain and the day, so a scouting report stays true until
 * the next dawn.
 */
export function npcStance(province: Pick<ProvinceRow, 'code' | 'terrain'>, garrison: number, tick: number): StanceId {
  return defaultStance(province.terrain, garrison, `${province.code}:${Math.floor(tick / WORLD.ticksPerDay)}`);
}

/** Order a new stance for a province the clan holds. */
export async function setStance(g: G, clan: ClanRow, provinceId: string, stanceInput: string): Promise<void> {
  if (!isStance(stanceInput)) throw invalid('Unknown stance');
  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 FOR UPDATE', [provinceId]);
  if (!province) throw notFound('Province');
  if (province.owner_clan_id !== clan.id) throw forbidden('You do not hold this province');
  const current = effectiveStance(province, g.now);
  const pending = pendingStance(province, g.now);
  if (!pending && current === stanceInput) throw conflict('STANCE_UNCHANGED', `${province.name} already holds that stance`);
  if (pending?.stance === stanceInput) throw conflict('STANCE_UNCHANGED', 'That stance is already being prepared');
  const garrison = await getGarrison(g.tx, province.id, clan.id);
  const blocked = stanceBlockReason(stanceInput, province.terrain, totalUnits(garrison?.units ?? {}));
  if (blocked) throw conflict('STANCE_BLOCKED', blocked);

  const def = STANCE_DEFS[stanceInput];
  if (Object.values(def.cost).some((v) => (v ?? 0) > 0)) await spend(g, clan.id, def.cost, 'stance_preparation', { type: 'province', id: province.id });
  const readyAt = addMs(g.now, gameMs(g, STANCE_PREP_MINUTES));
  // Whatever is in force stays in force until the new stance is ready.
  await g.tx.query('UPDATE provinces SET stance = $2, stance_next = $3, stance_ready_at = $4, updated_at = $5 WHERE id = $1', [
    province.id,
    current,
    stanceInput === current ? null : stanceInput,
    stanceInput === current ? null : readyAt,
    g.now,
  ]);
  await audit(g, 'province.stance', { type: 'province', id: province.id }, clan.id, { stance: stanceInput, from: current });
  await emitClan(g, clan.id, 'army:updated', { provinceId: province.id, clanId: clan.id });
}
