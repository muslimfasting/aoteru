/**
 * World creation: regions, the Kansai provinces, their first buildings, the
 * local warriors holding unclaimed land, and the NPC daimyo (MAP-01, MAP-02,
 * AI-01). Runs once, inside the first simulation step.
 */
import { BUILDING_TYPES, normalizeUnits, type BuildingLevels, type ResourceBag } from '@/game/config';
import { NPC_CLANS, PROVINCES, REGIONS } from '@/game/map';
import { addUnitsToArmy, ensureGarrison } from './armies';
import { one, type Db } from './db';
import { chronicle } from './notify';
import { initPillars } from './progression';
import { envSpeed, loadWorldState, type WorldStateRow } from './world';

const NPC_RESOURCES: ResourceBag = { gold: 2500, food: 4000, wood: 2000, stone: 1500, iron: 800 };

function initialLevels(castle: number, npcCapital: boolean): BuildingLevels {
  return npcCapital
    ? { castle, farm: 2, market: 2, barracks: 2, dojo: 1 }
    : { castle, farm: 1, market: 0, barracks: 0, dojo: 0 };
}

export async function createWorld(tx: Db, now: Date): Promise<WorldStateRow> {
  for (const r of REGIONS) {
    await tx.query('INSERT INTO regions (id, name, kanji, identity, playable) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING', [
      r.id,
      r.name,
      r.kanji,
      r.identity,
      r.playable,
    ]);
  }

  const clanIds = new Map<string, string>();
  for (const npc of NPC_CLANS) {
    const clan = await one<{ id: string }>(
      tx,
      `INSERT INTO clans (npc_key, name, daimyo_name, portrait, banner_color, banner_mon, is_npc, personality, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8) RETURNING id`,
      [npc.key, npc.name, npc.daimyoName, npc.portrait, npc.bannerColor, npc.bannerMon, npc.personality, now],
    );
    clanIds.set(npc.key, clan!.id);
    await tx.query('INSERT INTO resources (clan_id, gold, food, wood, stone, iron, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      clan!.id,
      NPC_RESOURCES.gold,
      NPC_RESOURCES.food,
      NPC_RESOURCES.wood,
      NPC_RESOURCES.stone,
      NPC_RESOURCES.iron,
      now,
    ]);
    await initPillars(tx, clan!.id, npc.pillarLevel);
  }

  for (const def of PROVINCES) {
    const npc = NPC_CLANS.find((n) => n.key === def.initialOwner);
    const ownerId = npc ? clanIds.get(npc.key)! : null;
    const levels = initialLevels(def.castleLevel, !!npc && npc.capital === def.code);
    const development = BUILDING_TYPES.reduce((sum, t) => sum + levels[t], 0);
    const province = await one<{ id: string }>(
      tx,
      `INSERT INTO provinces (code, name, region_id, owner_clan_id, terrain, population, base_food, base_gold, base_wood, base_stone, base_iron,
                              defense_level, development_level, loyalty, is_start_slot, owner_since, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [
        def.code,
        def.name,
        def.region,
        ownerId,
        def.terrain,
        def.population,
        def.base.food,
        def.base.gold,
        def.base.wood,
        def.base.stone,
        def.base.iron,
        def.castleLevel,
        development,
        ownerId ? 75 : 50,
        def.startSlot,
        ownerId ? now : null,
        now,
      ],
    );
    for (const type of BUILDING_TYPES) {
      await tx.query('INSERT INTO buildings (province_id, type, level) VALUES ($1, $2, $3)', [province!.id, type, levels[type]]);
    }
    const garrison = await ensureGarrison(tx, province!.id, ownerId);
    await addUnitsToArmy(tx, garrison, normalizeUnits(npc ? npc.garrison : def.neutralGarrison));
    if (npc && npc.capital === def.code) {
      await tx.query('UPDATE clans SET capital_province_id = $2 WHERE id = $1', [ownerId, province!.id]);
    }
    if (ownerId) {
      await tx.query(
        `INSERT INTO province_ownership_history (province_id, from_clan_id, to_clan_id, reason, created_at) VALUES ($1, NULL, $2, 'world_creation', $3)`,
        [province!.id, ownerId, now],
      );
    }
  }

  await tx.query('INSERT INTO world_state (id, epoch, speed, last_tick) VALUES (true, $1, $2, 0)', [now, envSpeed()]);
  await chronicle(
    { tx, now },
    {
      type: 'founding',
      title: 'The home provinces stand divided',
      description:
        'The capital is held by no great house. In Omi the Rokkaku tend their rice and their walls; on the inner sea the Miyoshi count their ships and look east. Between them lie provinces that answer to no lord — yet.',
    },
  );
  return (await loadWorldState(tx, true))!;
}
