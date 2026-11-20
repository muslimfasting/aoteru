import type { IncomeDTO } from '@/game/api';
import {
  RESOURCE_KEYS,
  addUnits,
  armyUpkeep,
  emptyBag,
  emptyBuildingLevels,
  emptyUnits,
  populationFood,
  provinceProduction,
  type BuildingLevels,
  type ResourceBag,
  type ResourceKey,
  type UnitCounts,
} from '@/game/config';
import type { Modifiers } from '@/game/pillars';
import { one, type Db } from './db';
import { conflict } from './errors';
import { emitClan } from './notify';
import { provinceBase, type ArmyRow, type ProvinceRow } from './rows';
import type { G } from './world';

export async function getResources(db: Db, clanId: string): Promise<ResourceBag> {
  const row = await one<ResourceBag>(db, 'SELECT gold, food, wood, stone, iron FROM resources WHERE clan_id = $1', [clanId]);
  return row ?? emptyBag();
}

export interface LedgerRef {
  type: string;
  id: string | null;
}

type Ctx = Pick<G, 'tx' | 'now'> & { actorPlayerId?: string | null };

async function writeLedger(
  g: Ctx,
  clanId: string,
  deltas: Partial<ResourceBag>,
  after: ResourceBag,
  reason: string,
  ref?: LedgerRef,
): Promise<void> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const k of RESOURCE_KEYS) {
    const amount = deltas[k] ?? 0;
    if (amount === 0) continue;
    const i = values.length;
    values.push(clanId, k, amount, after[k], reason, ref?.type ?? null, ref?.id ?? null, g.now, g.actorPlayerId ?? null);
    tuples.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}, $${i + 8}, $${i + 9})`);
  }
  if (tuples.length === 0) return;
  await g.tx.query(
    `INSERT INTO transactions (clan_id, resource, amount, balance_after, reason, ref_type, ref_id, created_at, actor_player_id) VALUES ${tuples.join(', ')}`,
    values,
  );
}

function cleanCost(cost: Partial<ResourceBag>): ResourceBag {
  const out = emptyBag();
  for (const k of RESOURCE_KEYS) out[k] = Math.max(0, Math.ceil(cost[k] ?? 0));
  return out;
}

/**
 * Spend resources. The balance check and the deduction are a single atomic
 * UPDATE, so two concurrent requests can never spend the same gold twice, and
 * the CHECK constraints make a negative balance impossible.
 */
export async function spend(
  g: Ctx,
  clanId: string,
  cost: Partial<ResourceBag>,
  reason: string,
  ref?: LedgerRef,
): Promise<ResourceBag> {
  const c = cleanCost(cost);
  const after = await one<ResourceBag>(
    g.tx,
    `UPDATE resources
        SET gold = gold - $2, food = food - $3, wood = wood - $4, stone = stone - $5, iron = iron - $6, updated_at = $7
      WHERE clan_id = $1 AND gold >= $2 AND food >= $3 AND wood >= $4 AND stone >= $5 AND iron >= $6
      RETURNING gold, food, wood, stone, iron`,
    [clanId, c.gold, c.food, c.wood, c.stone, c.iron, g.now],
  );
  if (!after) {
    const have = await getResources(g.tx, clanId);
    const short = RESOURCE_KEYS.filter((k) => have[k] < c[k]).map((k) => `${c[k] - have[k]} ${k}`);
    throw conflict('INSUFFICIENT_RESOURCES', `Not enough resources: short by ${short.join(', ')}`);
  }
  const deltas: Partial<ResourceBag> = {};
  for (const k of RESOURCE_KEYS) deltas[k] = -c[k];
  await writeLedger(g, clanId, deltas, after, reason, ref);
  await emitClan(g, clanId, 'resource:updated', { resources: after });
  return after;
}

/** Add resources (production, rewards, loot). */
export async function grant(
  g: Ctx,
  clanId: string,
  bag: Partial<ResourceBag>,
  reason: string,
  ref?: LedgerRef,
  announce = true,
): Promise<ResourceBag> {
  const c = cleanCost(bag);
  const after = await one<ResourceBag>(
    g.tx,
    `UPDATE resources
        SET gold = gold + $2, food = food + $3, wood = wood + $4, stone = stone + $5, iron = iron + $6, updated_at = $7
      WHERE clan_id = $1
      RETURNING gold, food, wood, stone, iron`,
    [clanId, c.gold, c.food, c.wood, c.stone, c.iron, g.now],
  );
  if (!after) throw new Error(`No resources row for nation ${clanId}`);
  await writeLedger(g, clanId, c, after, reason, ref);
  if (announce) await emitClan(g, clanId, 'resource:updated', { resources: after });
  return after;
}

/**
 * Apply an hourly balance change that may be negative. A resource that would
 * go below zero is clamped to zero; the returned `shortfall` says by how much.
 */
export async function applyHourly(
  g: Ctx,
  clanId: string,
  entries: { reason: string; deltas: Partial<ResourceBag> }[],
  ref: LedgerRef,
): Promise<{ after: ResourceBag; shortfall: ResourceBag }> {
  const before = await one<ResourceBag>(g.tx, 'SELECT gold, food, wood, stone, iron FROM resources WHERE clan_id = $1 FOR UPDATE', [clanId]);
  if (!before) throw new Error(`No resources row for nation ${clanId}`);
  const running: ResourceBag = { ...before };
  const shortfall = emptyBag();
  for (const entry of entries) {
    const applied: Partial<ResourceBag> = {};
    for (const k of RESOURCE_KEYS) {
      const delta = Math.round(entry.deltas[k] ?? 0);
      if (delta === 0) continue;
      const next = running[k] + delta;
      if (next < 0) {
        shortfall[k] += -next;
        applied[k] = -running[k];
        running[k] = 0;
      } else {
        applied[k] = delta;
        running[k] = next;
      }
    }
    await writeLedger(g, clanId, applied, running, entry.reason, ref);
  }
  await g.tx.query(
    'UPDATE resources SET gold = $2, food = $3, wood = $4, stone = $5, iron = $6, updated_at = $7 WHERE clan_id = $1',
    [clanId, running.gold, running.food, running.wood, running.stone, running.iron, g.now],
  );
  return { after: running, shortfall };
}

export interface ClanEconomyInput {
  provinces: ProvinceRow[];
  levels: Map<string, BuildingLevels>;
  mods: Modifiers;
  eventMult: Map<string, Partial<ResourceBag>>;
  armies: ArmyRow[];
}

export function clanUnits(armies: ArmyRow[]): UnitCounts {
  return armies.reduce((sum, a) => addUnits(sum, a.units), emptyUnits());
}

export function provinceOutput(p: ProvinceRow, levels: BuildingLevels | undefined, mods: Modifiers, mult?: Partial<ResourceBag>): ResourceBag {
  return provinceProduction(provinceBase(p), levels ?? emptyBuildingLevels(), p.loyalty, mods, mult);
}

/** Hourly income of a clan from the given state (GDD §5.4). Pure. */
export function clanIncome(input: ClanEconomyInput): IncomeDTO {
  const production = emptyBag();
  let popFood = 0;
  for (const p of input.provinces) {
    const out = provinceOutput(p, input.levels.get(p.id), input.mods, input.eventMult.get(p.id));
    for (const k of RESOURCE_KEYS) production[k] += out[k];
    popFood += populationFood(p.population);
  }
  const upkeep = armyUpkeep(clanUnits(input.armies), input.mods.upkeep);
  const net: ResourceBag = { ...production };
  net.food -= popFood + upkeep.food;
  net.gold -= upkeep.gold;
  return { production, populationFood: popFood, upkeepFood: upkeep.food, upkeepGold: upkeep.gold, net };
}

export function bagTotal(bag: Partial<Record<ResourceKey, number>>): number {
  return RESOURCE_KEYS.reduce((s, k) => s + (bag[k] ?? 0), 0);
}
