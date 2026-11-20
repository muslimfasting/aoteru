/**
 * End-to-end test of the game server against a real PostgreSQL database.
 *
 * It walks the first-playable journey (GDD §24) and the MVP acceptance
 * criteria (§22): register, found a clan, build, produce, recruit, develop the
 * Five Pillars, march, fight, conquer, and interact with a second player —
 * using a virtual clock, so hours of world time pass in milliseconds.
 *
 * Needs a throwaway database:
 *   TEST_DATABASE_URL=postgres://aoteru:aoteru@127.0.0.1:5432/aoteru_test npm run test:integration
 * The schema "public" of that database is dropped and recreated.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://aoteru:aoteru@127.0.0.1:5432/aoteru_test';
process.env.DATABASE_URL = TEST_DB;
process.env.WORLD_SPEED = '60';
process.env.CRON_SECRET = 'test-secret';

import { simulateBattle } from '@/game/battle';
import { WORLD, buildingCost, totalUnits, unitCost, type UnitCounts } from '@/game/config';
import { advanceWorld } from '@/server/advance';
import { getGarrison } from '@/server/armies';
import { register } from '@/server/auth';
import { resolveBattle, verifyBattle } from '@/server/battles';
import { startUpgrade } from '@/server/buildings';
import { createClan } from '@/server/clans';
import { closePool, one, pool, rows, withWorldLock, type Db } from '@/server/db';
import { declareWar, proposePeace, respondPeace } from '@/server/diplomacy';
import { getResources, grant } from '@/server/economy';
import { GameError } from '@/server/errors';
import { executeScout } from '@/server/espionage';
import { dispatchArmy, planMarch, recruit } from '@/server/military';
import { getPillars, unlockSkill } from '@/server/progression';
import type { ClanRow, ProvinceRow } from '@/server/rows';
import { processTick } from '@/server/tick';
import { buildBattle, buildBattles, buildMap, buildMe, buildProvince, buildSync } from '@/server/views';
import { gameContext, loadWorldState, type G } from '@/server/world';

// Virtual clock. At speed 60 one game minute is one real second.
let clock = Date.now() - 3 * 3600_000;
const now = () => new Date(clock);
const GAME_MINUTE = 1000;

/** Let world time pass and run the simulation up to the new present. */
async function pass(gameMinutes: number) {
  clock += gameMinutes * GAME_MINUTE;
  const result = await advanceWorld({ now: now(), blocking: true, budgetMs: 110_000 });
  expect(result.status).toBe('idle');
  return result;
}

/** Run a player's order exactly as the API does: one transaction under the world lock. */
async function order<T>(playerId: string, fn: (g: G, clan: ClanRow) => Promise<T>): Promise<T> {
  return withWorldLock(async (tx: Db) => {
    const g = await gameContext(tx, now(), playerId);
    const clan = (await one<ClanRow>(tx, 'SELECT * FROM clans WHERE player_id = $1 FOR UPDATE', [playerId]))!;
    return fn(g, clan);
  });
}

async function expectRefused(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((err: unknown) => err instanceof GameError && err.code === code);
}

const db = () => pool();
const province = async (code: string) => (await one<ProvinceRow>(db(), 'SELECT * FROM provinces WHERE code = $1', [code]))!;
const clanOf = async (playerId: string) => (await one<ClanRow>(db(), 'SELECT * FROM clans WHERE player_id = $1', [playerId]))!;
const count = async (sql: string, params: unknown[] = []) => (await one<{ n: number }>(db(), `SELECT COUNT(*)::int AS n FROM ${sql}`, params))!.n;

interface TestPlayer {
  id: string;
  nickname: string;
  email: string;
  createdAt: string;
}
let p1: TestPlayer;
let p2: TestPlayer;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: TEST_DB });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const dir = join(process.cwd(), 'db', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(dir, file), 'utf8'));
  }
  await admin.end();
});

afterAll(async () => {
  await closePool();
});

describe('persistent world', () => {
  it('creates the world: 7 regions, 10 Kansai provinces, 2 NPC daimyo', async () => {
    const result = await advanceWorld({ now: now(), blocking: true });
    expect(result.steps).toBe(1);
    expect(await count('regions')).toBe(7);
    expect(await count('provinces')).toBe(10);
    expect(await count('clans WHERE is_npc')).toBe(2);
    expect(await count('provinces WHERE owner_clan_id IS NOT NULL')).toBe(2);
    expect(await count('provinces WHERE is_start_slot AND owner_clan_id IS NULL')).toBe(5);
    // Every province is garrisoned by exactly one force.
    expect(await count(`armies WHERE status = 'garrison'`)).toBe(10);
    expect(await count('buildings')).toBe(50);
    // Creating it again is a no-op.
    expect((await advanceWorld({ now: now(), blocking: true })).steps).toBe(0);
    expect(await count('world_state')).toBe(1);
  });

  it('registers players with unique identities', async () => {
    p1 = (await register({ email: 'Kage@Example.com', password: 'correct horse', nickname: 'Kagetora' }, { ip: null, userAgent: null })).player;
    p2 = (await register({ email: 'haru@example.com', password: 'battery staple', nickname: 'Harunobu' }, { ip: null, userAgent: null })).player;
    await expectRefused(register({ email: 'kage@example.com', password: 'another pass', nickname: 'Other' }, { ip: null, userAgent: null }), 'EMAIL_TAKEN');
    await expectRefused(register({ email: 'new@example.com', password: 'another pass', nickname: 'kagetora' }, { ip: null, userAgent: null }), 'NICKNAME_TAKEN');
    await expectRefused(register({ email: 'new@example.com', password: 'short', nickname: 'Shorty' }, { ip: null, userAgent: null }), 'INVALID');
    await expectRefused(register({ email: 'new@example.com', password: 'long enough', nickname: 'x' }, { ip: null, userAgent: null }), 'INVALID');
    const stored = await one<{ password_hash: string }>(db(), 'SELECT password_hash FROM users WHERE lower(email) = $1', ['kage@example.com']);
    expect(stored!.password_hash).not.toContain('correct horse');
  });

  it('founds clans on distinct starting provinces without ownership conflicts', async () => {
    const iga = await province('iga');
    const kii = await province('kii');
    await order(p1.id, async (g) => {
      await createClan(g, p1, null, { clanName: 'Uesugi', daimyoName: 'Kagetora', portrait: 'general', bannerColor: 'crimson', bannerMon: 'tomoe', provinceId: iga.id });
    });
    // The same province, and the same banner colour, cannot be taken twice.
    await expectRefused(
      order(p2.id, (g) => createClan(g, p2, null, { clanName: 'Takeda', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'teal', bannerMon: 'peaks', provinceId: iga.id })),
      'PROVINCE_TAKEN',
    );
    await expectRefused(
      order(p2.id, (g) => createClan(g, p2, null, { clanName: 'Takeda', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'crimson', bannerMon: 'peaks', provinceId: kii.id })),
      'BANNER_TAKEN',
    );
    await expectRefused(
      order(p2.id, (g) => createClan(g, p2, null, { clanName: 'uesugi', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'teal', bannerMon: 'peaks', provinceId: kii.id })),
      'CLAN_NAME_TAKEN',
    );
    // A refused founding leaves nothing behind.
    expect(await count('clans WHERE player_id = $1', [p2.id])).toBe(0);
    await order(p2.id, (g) => createClan(g, p2, null, { clanName: 'Takeda', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'teal', bannerMon: 'peaks', provinceId: kii.id }));

    const clan = await clanOf(p1.id);
    expect((await province('iga')).owner_clan_id).toBe(clan.id);
    expect(clan.capital_province_id).toBe(iga.id);
    expect(clan.protected_until!.getTime()).toBeGreaterThan(clock);
    expect(await getResources(db(), clan.id)).toEqual(WORLD.startingResources);
    expect(totalUnits((await getGarrison(db(), iga.id, clan.id))!.units)).toBe(110);
    expect(await getGarrison(db(), iga.id, null)).toBeNull();
    expect(await count('five_pillars WHERE clan_id = $1', [clan.id])).toBe(5);
    expect(await count(`province_ownership_history WHERE province_id = $1 AND reason = 'founding'`, [iga.id])).toBe(1);
    const ise = await province('ise');
    await expectRefused(
      order(p1.id, (g, c) => createClan(g, p1, c, { clanName: 'Second', daimyoName: 'Kagetora', portrait: 'general', bannerColor: 'plum', bannerMon: 'tomoe', provinceId: ise.id })),
      'ALREADY_HAS_CLAN',
    );
  });

  it('builds infrastructure with validated costs and persistent timers', async () => {
    const clan = await clanOf(p1.id);
    const iga = await province('iga');
    const before = await getResources(db(), clan.id);
    await order(p1.id, (g) => startUpgrade(g, clan.id, iga.id, 'barracks'));
    const cost = buildingCost('barracks', 1);
    const after = await getResources(db(), clan.id);
    expect(after.gold).toBe(before.gold - cost.gold);
    expect(after.wood).toBe(before.wood - cost.wood);
    expect(await count(`transactions WHERE clan_id = $1 AND reason = 'building_upgrade'`, [clan.id])).toBeGreaterThanOrEqual(3);

    // One project per province; rules and ownership are enforced server-side.
    await expectRefused(order(p1.id, (g) => startUpgrade(g, clan.id, iga.id, 'farm')), 'CONSTRUCTION_BUSY');
    await expectRefused(order(p2.id, (g, c) => startUpgrade(g, c.id, iga.id, 'farm')), 'FORBIDDEN');
    const kii = await province('kii');
    await expectRefused(order(p2.id, (g, c) => startUpgrade(g, c.id, kii.id, 'dojo')), 'BUILDING_LOCKED');
    expect(await getResources(db(), clan.id)).toEqual(after);

    // Not finished early...
    await pass(11);
    expect((await one<{ level: number }>(db(), `SELECT level FROM buildings WHERE province_id = $1 AND type = 'barracks'`, [iga.id]))!.level).toBe(0);
    // ...finished once the timer has run, with nobody online.
    await pass(2);
    const built = await one<{ level: number; upgrade_completes_at: Date | null }>(db(), `SELECT * FROM buildings WHERE province_id = $1 AND type = 'barracks'`, [iga.id]);
    expect(built!.level).toBe(1);
    expect(built!.upgrade_completes_at).toBeNull();
    expect(await count(`notifications WHERE player_id = $1 AND type = 'building'`, [p1.id])).toBe(1);
  });

  it('refuses to spend what the clan does not have, and changes nothing', async () => {
    const clan = await clanOf(p2.id);
    const kii = await province('kii');
    await db().query('UPDATE resources SET wood = 10 WHERE clan_id = $1', [clan.id]);
    await expectRefused(order(p2.id, (g) => startUpgrade(g, clan.id, kii.id, 'barracks')), 'INSUFFICIENT_RESOURCES');
    expect((await getResources(db(), clan.id)).wood).toBe(10);
    expect(await count('buildings WHERE province_id = $1 AND upgrade_completes_at IS NOT NULL', [kii.id])).toBe(0);
    await db().query('UPDATE resources SET wood = 1000 WHERE clan_id = $1', [clan.id]);
    // The database itself refuses a negative balance.
    await expect(db().query('UPDATE resources SET gold = -1 WHERE clan_id = $1', [clan.id])).rejects.toThrow();
    // And the ledger cannot be rewritten.
    await expect(db().query('UPDATE transactions SET amount = 0')).rejects.toThrow(/immutable/);
    await expect(db().query('DELETE FROM transactions')).rejects.toThrow(/immutable/);
  });

  it('produces and consumes resources every world tick, exactly once', async () => {
    const clan = await clanOf(p1.id);
    const state = (await loadWorldState(db()))!;
    // Stand just before the next tick, then cross it.
    const untilTick = Math.ceil((state.epoch.getTime() + (state.last_tick + 1) * 60_000 - clock) / GAME_MINUTE);
    await pass(Math.max(0, untilTick - 1));
    const me = await buildMe(db(), { player: p1, clan }, now());
    const before = me.clan!.resources;
    const net = me.clan!.income.net;
    expect(net.gold).toBeGreaterThan(0);
    expect(me.clan!.income.populationFood).toBeGreaterThan(0);
    expect(me.clan!.income.upkeepFood).toBeGreaterThan(0);
    const ticksBefore = await count('world_ticks');

    await pass(2);
    expect(await count('world_ticks')).toBe(ticksBefore + 1);
    const after = await getResources(db(), clan.id);
    for (const k of ['gold', 'food', 'wood', 'stone', 'iron'] as const) expect(after[k]).toBe(before[k] + net[k]);
    expect(await count(`transactions WHERE clan_id = $1 AND reason = 'production'`, [clan.id])).toBeGreaterThanOrEqual(5);
    expect(await count(`transactions WHERE clan_id = $1 AND reason = 'army_upkeep'`, [clan.id])).toBeGreaterThanOrEqual(1);

    // Running the engine again at the same moment does nothing.
    expect((await advanceWorld({ now: now(), blocking: true })).steps).toBe(0);
    // A tick can never be processed twice: the second attempt fails and rolls back whole.
    const current = (await loadWorldState(db()))!;
    await expect(withWorldLock((tx) => processTick(tx, current, current.last_tick))).rejects.toThrow(/duplicate key/);
    expect(await getResources(db(), clan.id)).toEqual(after);
    expect(await count('world_ticks')).toBe(ticksBefore + 1);
  });

  it('recruits soldiers against resources, population and army capacity', async () => {
    const clan = await clanOf(p1.id);
    const iga = await province('iga');
    await order(p1.id, (g) => grant(g, clan.id, { gold: 6000, food: 6000, wood: 3000, iron: 500 }, 'test_grant'));
    const before = await getResources(db(), clan.id);

    await expectRefused(order(p1.id, (g) => recruit(g, clan.id, iga.id, 'samurai', 10)), 'UNIT_LOCKED');
    await expectRefused(order(p1.id, (g) => recruit(g, clan.id, iga.id, 'ashigaru', 1000)), 'ARMY_CAPACITY');
    await expectRefused(order(p2.id, (g, c) => recruit(g, c.id, iga.id, 'ashigaru', 10)), 'FORBIDDEN');

    await order(p1.id, (g) => recruit(g, clan.id, iga.id, 'ashigaru', 200));
    const cost = unitCost('ashigaru', 200);
    const after = await getResources(db(), clan.id);
    expect(after.gold).toBe(before.gold - cost.gold);
    expect(after.food).toBe(before.food - cost.food);
    expect((await province('iga')).population).toBe(iga.population - 200);
    // Queued, not delivered yet.
    expect((await getGarrison(db(), iga.id, clan.id))!.units.ashigaru).toBe(80);
    // A second order in the same province trains after the first.
    await order(p1.id, (g) => recruit(g, clan.id, iga.id, 'yari', 40));
    const queue = await rows<{ started_at: Date; completes_at: Date }>(db(), `SELECT * FROM recruitment_orders WHERE clan_id = $1 ORDER BY completes_at`, [clan.id]);
    expect(queue[1].started_at.getTime()).toBe(queue[0].completes_at.getTime());

    await pass(78);
    expect((await getGarrison(db(), iga.id, clan.id))!.units.ashigaru).toBe(280);
    await pass(25);
    const garrison = (await getGarrison(db(), iga.id, clan.id))!.units;
    expect(garrison).toMatchObject({ ashigaru: 280, yari: 70 });
    expect(await count(`recruitment_orders WHERE clan_id = $1 AND status = 'pending'`, [clan.id])).toBe(0);
  });

  it('develops the Five Pillars: XP from play, server-checked skills and branches', async () => {
    const clan = await clanOf(p1.id);
    const pillars = await getPillars(db(), clan.id);
    expect(pillars.pillars).toHaveLength(5);
    const military = pillars.pillars.find((p) => p.id === 'military')!;
    expect(military.xp + military.level).toBeGreaterThan(1); // recruiting earned Military XP
    expect(pillars.pillars.find((p) => p.id === 'economy')!.xp).toBeGreaterThan(0); // building and production earned Economy XP
    expect(pillars.pillars.find((p) => p.id === 'leadership')!.xp).toBeGreaterThan(0);

    await expectRefused(order(p1.id, (g) => unlockSkill(g, clan.id, 'mil_infantry')), 'SKILL_LOCKED');
    await db().query(`UPDATE five_pillars SET level = 5, points = 4 WHERE clan_id = $1 AND pillar = 'military'`, [clan.id]);
    for (let i = 0; i < 3; i++) await order(p1.id, (g) => unlockSkill(g, clan.id, 'mil_tactics'));
    await order(p1.id, (g) => unlockSkill(g, clan.id, 'mil_infantry'));
    // Out of points, and the rival branch is closed for good.
    await expectRefused(order(p1.id, (g) => unlockSkill(g, clan.id, 'mil_tactics')), 'SKILL_LOCKED');
    await db().query(`UPDATE five_pillars SET points = 1 WHERE clan_id = $1 AND pillar = 'military'`, [clan.id]);
    await expectRefused(order(p1.id, (g) => unlockSkill(g, clan.id, 'mil_cavalry')), 'SKILL_LOCKED');
    await expectRefused(order(p1.id, (g) => unlockSkill(g, clan.id, 'no_such_skill')), 'INVALID');

    const after = await getPillars(db(), clan.id);
    expect(after.skills.find((s) => s.code === 'mil_tactics')!.rank).toBe(3);
    expect(after.modifiers.attack).toBeCloseTo(0.005 * 4 + 0.03 * 3);
    expect(after.modifiers.infantry).toBeCloseTo(0.05);
    expect(after.skills.find((s) => s.code === 'mil_cavalry')!.blockedReason).toMatch(/you chose/);
  });

  let battleId = '';

  it('marches an army with validated route, supplies and troop counts', async () => {
    const clan = await clanOf(p1.id);
    const iga = await province('iga');
    const ise = await province('ise');
    const kawachi = await province('kawachi');
    const omi = await province('omi');

    // Kawachi does not border Iga and there is no friendly land between; Omi belongs to a clan we are not at war with.
    expect((await planMarch({ tx: db(), now: now() }, clan, iga.id, kawachi.id, { ashigaru: 10 })).reason).toMatch(/No route/);
    expect((await planMarch({ tx: db(), now: now() }, clan, iga.id, omi.id, { ashigaru: 10 })).reason).toMatch(/not at war/);
    expect((await planMarch({ tx: db(), now: now() }, clan, iga.id, ise.id, { ashigaru: 9999 })).reason).toMatch(/Only 280/);
    const plan = await planMarch({ tx: db(), now: now() }, clan, iga.id, ise.id, { ashigaru: 250, yari: 60 });
    expect(plan).toMatchObject({ ok: true, intent: 'attack' });
    expect(plan.supplies).toBeGreaterThan(0);

    // "Move" is only for provinces you hold.
    await expectRefused(order(p1.id, (g, c) => dispatchArmy(g, c, iga.id, ise.id, { ashigaru: 250, yari: 60 }, 'move')), 'MARCH_BLOCKED');
    const food = (await getResources(db(), clan.id)).food;
    await order(p1.id, (g, c) => dispatchArmy(g, c, iga.id, ise.id, { ashigaru: 250, yari: 60 }, 'attack'));
    expect((await getResources(db(), clan.id)).food).toBe(food - plan.supplies);
    expect((await getGarrison(db(), iga.id, clan.id))!.units).toMatchObject({ ashigaru: 30, yari: 10 });
    // The same soldiers cannot be sent twice.
    await expectRefused(order(p1.id, (g, c) => dispatchArmy(g, c, iga.id, ise.id, { ashigaru: 250 }, 'attack')), 'MARCH_BLOCKED');
    expect(await count(`armies WHERE clan_id = $1 AND status = 'marching'`, [clan.id])).toBe(1);

    const map = await buildMap(db(), { player: p1, clan }, now());
    expect(map.movements.filter((m) => m.own)).toHaveLength(1);
    expect(map.movements[0].units).toMatchObject({ ashigaru: 250, yari: 60 });
    // Another player sees that an army is on the road, but not what it is made of.
    const seenByP2 = await buildMap(db(), { player: p2, clan: await clanOf(p2.id) }, now());
    expect(seenByP2.movements[0].units).toBeNull();

    // The army arrives and gives battle; the battle is resolved later, by its own timer.
    await pass(Math.ceil(plan.minutes) + 1);
    const battle = await one<{ id: string; status: string }>(db(), 'SELECT id, status FROM battles WHERE attacker_clan_id = $1', [clan.id]);
    expect(battle!.status).toBe('pending');
    battleId = battle!.id;
    expect((await province('ise')).owner_clan_id).toBeNull();
    expect((await buildMap(db(), { player: p1, clan }, now())).provinces.find((p) => p.code === 'ise')!.underAttack).toBe(true);
  });

  it('resolves the battle once, reproducibly, and transfers the province only on victory', async () => {
    const clan = await clanOf(p1.id);
    const ise = await province('ise');
    await pass(WORLD.battleMinutes + 1);

    const detail = await buildBattle(db(), clan, battleId);
    expect(detail.battle.status).toBe('resolved');
    expect(['victory', 'decisive_victory']).toContain(detail.battle.outcome);
    expect(detail.battle.provinceCaptured).toBe(true);
    expect(detail.verified).toBe(true);
    // Anyone holding the stored inputs and seed gets the same report.
    expect(verifyBattle(detail.inputs!, detail.seed!, simulateBattle(detail.inputs!, detail.seed!))).toBe(true);
    expect(detail.result!.rounds.length).toBeGreaterThan(0);
    // Military skills were part of the stored inputs.
    expect(detail.inputs!.attacker.mods.attack).toBeCloseTo(0.11);
    expect(detail.inputs!.attacker.mods.infantry).toBeCloseTo(0.05);

    // Ownership changed, and was recorded.
    expect((await province('ise')).owner_clan_id).toBe(clan.id);
    expect(await count(`province_ownership_history WHERE province_id = $1 AND reason = 'conquest' AND battle_id = $2`, [ise.id, battleId])).toBe(1);
    expect(await count(`world_events WHERE type = 'conquest' AND province_id = $1`, [ise.id])).toBe(1);

    // Casualties were applied exactly once: survivors now garrison the province.
    const survivors = (await getGarrison(db(), ise.id, clan.id))!.units;
    const expected = detail.result!.attacker.remaining as UnitCounts;
    expect(survivors).toEqual(expected);
    expect(await getGarrison(db(), ise.id, null)).toBeNull();
    await withWorldLock(async (tx) => resolveBattle(await gameContext(tx, now()), battleId));
    expect((await getGarrison(db(), ise.id, clan.id))!.units).toEqual(expected);
    expect(await count('battle_reports WHERE battle_id = $1', [battleId])).toBe(1);

    expect(await count(`transactions WHERE clan_id = $1 AND reason = 'battle_loot'`, [clan.id])).toBeGreaterThan(0);
    expect(await count(`notifications WHERE player_id = $1 AND type = 'battle'`, [p1.id])).toBe(2);
    expect((await buildBattles(db(), clan)).battles).toHaveLength(1);
    const me = await buildMe(db(), { player: p1, clan: await clanOf(p1.id) }, now());
    expect(me.clan!.provinceCount).toBe(2);
  });

  it('lets two players interact: protection, war, battle, peace', async () => {
    const c1 = await clanOf(p1.id);
    const c2 = await clanOf(p2.id);
    const ise = await province('ise');
    const kii = await province('kii');

    // No attack without a war; no war against a protected newcomer... but p1 attacked no clan, so is still protected.
    await expectRefused(order(p2.id, (g, c) => dispatchArmy(g, c, kii.id, ise.id, { ashigaru: 50 }, 'attack')), 'MARCH_BLOCKED');
    await expectRefused(order(p2.id, (g, c) => declareWar(g, c, c1.id)), 'WAR_BLOCKED');

    // A game day later the truce of the realm has lapsed.
    await pass(WORLD.protectionHours * 60 + 1);
    const gold = (await getResources(db(), c2.id)).gold;
    await order(p2.id, (g, c) => declareWar(g, c, c1.id));
    expect((await getResources(db(), c2.id)).gold).toBe(gold - WORLD.warDeclarationCost);
    await expectRefused(order(p2.id, (g, c) => declareWar(g, c, c1.id)), 'WAR_BLOCKED');
    await expectRefused(order(p1.id, (g, c) => declareWar(g, c, c2.id)), 'WAR_BLOCKED');
    expect(await count(`notifications WHERE player_id = $1 AND type = 'war'`, [p1.id])).toBe(1);
    expect((await buildProvince(db(), { player: p2, clan: c2 }, ise.id, now())).actions.canAttack).toBe(true);

    // p2 throws its small garrison at Ise and is beaten back; the province does not change hands.
    await order(p2.id, (g, c) => dispatchArmy(g, c, kii.id, ise.id, { ashigaru: 70, yari: 25 }, 'attack'));
    await pass(200);
    const fought = await one<{ id: string; status: string }>(db(), 'SELECT id, status FROM battles WHERE attacker_clan_id = $1', [c2.id]);
    expect(fought!.status).toBe('resolved');
    const report = await buildBattle(db(), c2, fought!.id);
    expect(report.battle.provinceCaptured).toBe(false);
    expect(report.verified).toBe(true);
    expect((await province('ise')).owner_clan_id).toBe(c1.id);
    // Both sides can read the report; it lists each from its own point of view.
    expect((await buildBattle(db(), c1, fought!.id)).battle.role).toBe('defender');
    // Survivors (if any) have marched home and rejoined the garrison; nothing is left in the field.
    expect(await count(`armies WHERE clan_id = $1 AND status <> 'garrison'`, [c2.id])).toBe(0);
    const home = (await getGarrison(db(), kii.id, c2.id))!.units;
    expect(totalUnits(home)).toBe(110 - totalUnits(report.result!.attacker.losses));

    // Peace: proposed by one side, accepted by the other.
    await order(p2.id, (g, c) => proposePeace(g, c, c1.id));
    const proposal = await one<{ id: string }>(db(), `SELECT id FROM diplomacy WHERE status = 'pending' AND to_clan_id = $1`, [c1.id]);
    await expectRefused(order(p2.id, (g, c) => respondPeace(g, c, proposal!.id, true)), 'FORBIDDEN');
    await order(p1.id, (g, c) => respondPeace(g, c, proposal!.id, true));
    expect(await count(`wars WHERE status = 'active'`)).toBe(0);
    expect(await count(`wars WHERE status = 'ended' AND end_reason = 'peace'`)).toBe(1);
    // The peace is binding for a while.
    await expectRefused(order(p2.id, (g, c) => declareWar(g, c, c1.id)), 'WAR_BLOCKED');
  });

  it('runs scouting operations with stored odds and seed', async () => {
    const c2 = await clanOf(p2.id);
    const ise = await province('ise');
    const tanba = await province('tanba');
    await expectRefused(order(p2.id, (g, c) => executeScout(g, c, tanba.id)), 'SCOUT_BLOCKED');
    const gold = (await getResources(db(), c2.id)).gold;
    const opId = await order(p2.id, (g, c) => executeScout(g, c, ise.id));
    expect((await getResources(db(), c2.id)).gold).toBe(gold - WORLD.scout.cost);
    await expectRefused(order(p2.id, (g, c) => executeScout(g, c, ise.id)), 'SCOUT_BLOCKED');
    await pass(WORLD.scout.minutes + 1);
    const op = await one<any>(db(), 'SELECT * FROM espionage WHERE id = $1', [opId]);
    expect(['success', 'failed']).toContain(op.status);
    const view = await buildProvince(db(), { player: p2, clan: c2 }, ise.id, now());
    if (op.status === 'success') {
      expect(view.intel!.units).toEqual((await getGarrison(db(), ise.id, (await clanOf(p1.id)).id))!.units);
      expect(view.province.strength).toMatchObject({ exact: true });
    } else {
      expect(view.intel).toBeNull();
      // Without a report a neighbour still gets a rough band, never exact numbers.
      expect(view.province.strength).toMatchObject({ exact: false, power: null });
    }
    expect(view.province.garrison).toBeNull();
    expect(view.own).toBeNull();
  });

  it('a clan that loses its last province falls, and its Daimyo may rise again', async () => {
    const c1 = await clanOf(p1.id);
    const c2 = await clanOf(p2.id);
    const ise = await province('ise');
    const kii = await province('kii');
    await db().query(`UPDATE five_pillars SET level = 4, points = 3 WHERE clan_id = $1 AND pillar = 'economy'`, [c2.id]);

    // Once the peace has run its course, p1 declares war and marches on Kii with everything in Ise.
    await pass(WORLD.truceHours * 60 + 1);
    await order(p1.id, (g, c) => declareWar(g, c, c2.id));
    const host = (await getGarrison(db(), ise.id, c1.id))!.units;
    await order(p1.id, (g, c) => dispatchArmy(g, c, ise.id, kii.id, host, 'attack'));
    await pass(200);
    expect((await province('kii')).owner_clan_id).toBe(c1.id);

    const fallen = await clanOf(p2.id);
    expect(fallen.status).toBe('fallen');
    expect(fallen.capital_province_id).toBeNull();
    expect(await count('armies WHERE clan_id = $1', [c2.id])).toBe(0);
    expect(await count(`wars WHERE status = 'active'`)).toBe(0);
    expect(await count(`world_events WHERE type = 'fallen' AND clan_id = $1`, [c2.id])).toBe(1);
    // A fallen clan cannot give orders...
    const me = await buildMe(db(), { player: p2, clan: fallen }, now());
    expect(me.clan!.status).toBe('fallen');
    expect(me.clan!.provinceCount).toBe(0);

    // ...but its Daimyo can found a new seat, keeping everything learned in the Five Pillars.
    const izumi = await province('izumi');
    await order(p2.id, (g, c) => createClan(g, p2, c, { clanName: 'Takeda', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'teal', bannerMon: 'peaks', provinceId: izumi.id }));
    const risen = await clanOf(p2.id);
    expect(risen.id).toBe(c2.id);
    expect(risen.status).toBe('active');
    expect(risen.capital_province_id).toBe(izumi.id);
    expect(await getResources(db(), c2.id)).toEqual(WORLD.startingResources);
    expect((await getPillars(db(), c2.id)).pillars.find((p) => p.id === 'economy')).toMatchObject({ level: 4, points: 3 });
    expect(totalUnits((await getGarrison(db(), izumi.id, c2.id))!.units)).toBe(110);
    // The conqueror's capital is unchanged and it now rules three provinces.
    expect((await buildMe(db(), { player: p1, clan: await clanOf(p1.id) }, now())).clan!.provinceCount).toBe(3);
  });

  it('keeps running with everyone offline, and NPC daimyo act', async () => {
    const ticks = await count('world_ticks');
    const before = await getResources(db(), (await clanOf(p1.id)).id);
    const npcBuildings = (await one<{ n: number }>(db(), `SELECT SUM(b.level)::int AS n FROM buildings b JOIN provinces p ON p.id = b.province_id JOIN clans c ON c.id = p.owner_clan_id WHERE c.is_npc`))!.n;
    const npcUnits = (await one<{ n: number }>(db(), `SELECT COALESCE(SUM(u.count), 0)::int AS n FROM army_units u JOIN armies a ON a.id = u.army_id JOIN clans c ON c.id = a.clan_id WHERE c.is_npc`))!.n;

    await pass(20 * 60);
    expect(await count('world_ticks')).toBe(ticks + 20);
    expect(await count(`world_ticks WHERE status <> 'completed'`)).toBe(0);
    const after = await getResources(db(), (await clanOf(p1.id)).id);
    expect(after.gold).toBeGreaterThan(before.gold);

    const npcBuildingsAfter = (await one<{ n: number }>(db(), `SELECT SUM(b.level)::int AS n FROM buildings b JOIN provinces p ON p.id = b.province_id JOIN clans c ON c.id = p.owner_clan_id WHERE c.is_npc`))!.n;
    const npcUnitsAfter = (await one<{ n: number }>(db(), `SELECT COALESCE(SUM(u.count), 0)::int AS n FROM army_units u JOIN armies a ON a.id = u.army_id JOIN clans c ON c.id = a.clan_id WHERE c.is_npc`))!.n;
    expect(npcBuildingsAfter + npcUnitsAfter).toBeGreaterThan(npcBuildings + npcUnits);

    // World invariants.
    expect(await count('resources WHERE gold < 0 OR food < 0 OR wood < 0 OR stone < 0 OR iron < 0')).toBe(0);
    expect(await count('provinces WHERE loyalty < 0 OR loyalty > 100 OR population < 0')).toBe(0);
    expect(await count('army_units WHERE count < 0')).toBe(0);
    expect(await count(`provinces p WHERE (SELECT COUNT(*) FROM armies a WHERE a.province_id = p.id AND a.status = 'garrison' AND a.clan_id IS NOT DISTINCT FROM p.owner_clan_id) > 1`)).toBe(0);
    expect(await count(`armies a JOIN provinces p ON p.id = a.province_id WHERE a.status = 'garrison' AND a.clan_id IS DISTINCT FROM p.owner_clan_id`)).toBe(0);
    expect(await count(`clans c WHERE c.status = 'active' AND NOT EXISTS (SELECT 1 FROM provinces p WHERE p.owner_clan_id = c.id)`)).toBe(0);
    expect((await loadWorldState(db()))!.last_error).toBeNull();
    // Every balance equals the last ledger entry for it.
    expect(
      await count(`(
        SELECT DISTINCT ON (t.clan_id, t.resource) t.clan_id, t.resource, t.balance_after,
               CASE t.resource WHEN 'gold' THEN r.gold WHEN 'food' THEN r.food WHEN 'wood' THEN r.wood WHEN 'stone' THEN r.stone ELSE r.iron END AS actual
          FROM transactions t JOIN resources r ON r.clan_id = t.clan_id
          JOIN clans c ON c.id = t.clan_id WHERE c.id = $1
         ORDER BY t.clan_id, t.resource, t.id DESC
      ) x WHERE x.balance_after <> x.actual`, [(await clanOf(p1.id)).id]),
    ).toBe(0);
  });

  it('delivers realtime events only to the rooms a player may hear', async () => {
    const c1 = await clanOf(p1.id);
    const first = await buildSync(db(), { player: p1, clan: c1 }, null, now());
    expect(first.events).toHaveLength(0);
    expect(first.cursor).toBeGreaterThan(0);
    const all = await buildSync(db(), { player: p1, clan: c1 }, 0, now());
    expect(all.events.length).toBeGreaterThan(0);
    const privateToP2 = await count(`realtime_events WHERE room = $1`, [`player:${p2.id}`]);
    expect(privateToP2).toBeGreaterThan(0);
    const allowed = new Set((await rows<{ id: number }>(db(), `SELECT id FROM realtime_events WHERE room IN ('world', $1)`, [`player:${p1.id}`])).map((r) => r.id));
    for (const e of all.events) expect(allowed.has(e.id)).toBe(true);
    expect(first.resources).toEqual(await getResources(db(), c1.id));
  });
});

describe('HTTP API', () => {
  let cookie = '';
  const call = async (handler: (req: Request, args: any) => Promise<Response>, path: string, init: RequestInit & { params?: Record<string, string> } = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    if (init.body) headers.set('content-type', 'application/json');
    const res = await handler(new Request(`http://localhost${path}`, { ...init, headers }), { params: Promise.resolve(init.params ?? {}) });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  };

  it('catches the world up to the present before serving', async () => {
    const result = await advanceWorld({ blocking: true, budgetMs: 110_000 });
    expect(result.status).toBe('idle');
  });

  it('authenticates with an httpOnly session cookie', async () => {
    const { GET: me } = await import('@/app/api/player/me/route');
    const { POST: registerRoute } = await import('@/app/api/auth/register/route');
    const { POST: loginRoute } = await import('@/app/api/auth/login/route');
    const { POST: logoutRoute } = await import('@/app/api/auth/logout/route');

    expect((await call(me, '/api/player/me')).status).toBe(401);
    const bad = await call(registerRoute, '/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'nope' }) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID');

    const reg = await call(registerRoute, '/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'nobu@example.com', password: 'tenka fubu!', nickname: 'Nobunaga' }) });
    expect(reg.status).toBe(200);
    const setCookie = reg.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    cookie = setCookie.split(';')[0];

    const profile = await call(me, '/api/player/me');
    expect(profile.status).toBe(200);
    expect(profile.body.player.nickname).toBe('Nobunaga');
    expect(profile.body.clan).toBeNull();

    // Logout revokes the session on the server, not just in the browser.
    await call(logoutRoute, '/api/auth/logout', { method: 'POST' });
    expect((await call(me, '/api/player/me')).status).toBe(401);
    const wrong = await call(loginRoute, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'nobu@example.com', password: 'wrong password' }) });
    expect(wrong.status).toBe(401);
    cookie = '';
    const login = await call(loginRoute, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'NOBU@example.com', password: 'tenka fubu!' }) });
    expect(login.status).toBe(200);
    cookie = login.headers.get('set-cookie')!.split(';')[0];
  });

  it('requires a clan for game actions and rejects cross-site requests', async () => {
    const { GET: army } = await import('@/app/api/army/route');
    const { POST: upgrade } = await import('@/app/api/buildings/upgrade/route');
    expect((await call(army, '/api/army')).body.error.code).toBe('NO_CLAN');
    const tanba = await province('tanba');
    const crossSite = await call(upgrade, '/api/buildings/upgrade', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: JSON.stringify({ provinceId: tanba.id, type: 'farm' }),
    });
    expect(crossSite.status).toBe(403);
  });

  it('founds a clan through the API and replays idempotent requests instead of repeating them', async () => {
    const { POST: clans } = await import('@/app/api/clans/route');
    const { GET: map } = await import('@/app/api/world/map/route');
    const { POST: upgrade } = await import('@/app/api/buildings/upgrade/route');
    const { GET: provinceRoute } = await import('@/app/api/provinces/[id]/route');

    const world = await call(map, '/api/world/map');
    expect(world.status).toBe(200);
    const slot = world.body.provinces.find((p: any) => p.isStartSlot && p.code === 'tanba') ?? world.body.provinces.find((p: any) => p.isStartSlot);
    expect(slot).toBeDefined();

    const founded = await call(clans, '/api/clans', {
      method: 'POST',
      headers: { 'idempotency-key': 'found-1' },
      body: JSON.stringify({ clanName: 'Oda', daimyoName: 'Nobunaga', portrait: 'strategist', bannerColor: 'ochre', bannerMon: 'blossom', provinceId: slot.id }),
    });
    expect(founded.status).toBe(200);
    expect(founded.body.clan.name).toBe('Oda');
    expect(founded.body.clan.provinceCount).toBe(1);
    expect(founded.body.clan.resources).toEqual(WORLD.startingResources);

    const body = JSON.stringify({ provinceId: slot.id, type: 'market' });
    const first = await call(upgrade, '/api/buildings/upgrade', { method: 'POST', headers: { 'idempotency-key': 'upgrade-1' }, body });
    expect(first.status).toBe(200);
    const market = first.body.own.buildings.find((b: any) => b.type === 'market');
    expect(market.upgrading).not.toBeNull();
    const clan = await one<{ id: string }>(db(), `SELECT id FROM clans WHERE name = 'Oda'`);
    const goldAfterFirst = (await getResources(db(), clan!.id)).gold;
    expect(goldAfterFirst).toBe(WORLD.startingResources.gold - buildingCost('market', 1).gold);

    // The same request again (a retry after a dropped connection) returns the stored answer and spends nothing.
    const replay = await call(upgrade, '/api/buildings/upgrade', { method: 'POST', headers: { 'idempotency-key': 'upgrade-1' }, body });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replay')).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect((await getResources(db(), clan!.id)).gold).toBe(goldAfterFirst);
    // A genuinely new request is judged on its merits.
    const second = await call(upgrade, '/api/buildings/upgrade', { method: 'POST', headers: { 'idempotency-key': 'upgrade-2' }, body });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONSTRUCTION_BUSY');

    const detail = await call(provinceRoute, `/api/provinces/${slot.id}`, { params: { id: slot.id } });
    expect(detail.body.province.relation).toBe('own');
    expect(detail.body.own.recruitOptions).toHaveLength(5);
    expect((await call(provinceRoute, '/api/provinces/not-a-uuid', { params: { id: 'not-a-uuid' } })).status).toBe(400);
  });

  it('serves the remaining read endpoints and protects the cron endpoint', async () => {
    const routes: [string, string][] = [
      ['@/app/api/army/route', '/api/army'],
      ['@/app/api/battles/route', '/api/battles'],
      ['@/app/api/pillars/me/route', '/api/pillars/me'],
      ['@/app/api/diplomacy/route', '/api/diplomacy'],
      ['@/app/api/espionage/route', '/api/espionage'],
      ['@/app/api/leaderboard/route', '/api/leaderboard'],
      ['@/app/api/notifications/route', '/api/notifications'],
      ['@/app/api/chat/route', '/api/chat'],
      ['@/app/api/sync/route', '/api/sync'],
      ['@/app/api/health/route', '/api/health'],
    ];
    for (const [mod, path] of routes) {
      const { GET } = await import(mod);
      const res = await call(GET, path);
      expect(res.status, path).toBe(200);
    }
    const { GET: leaderboard } = await import('@/app/api/leaderboard/route');
    const board = (await call(leaderboard, '/api/leaderboard')).body;
    expect(board.entries).toHaveLength(5); // two NPC daimyo and three players
    expect(board.entries.filter((e: any) => e.isViewer)).toHaveLength(1);
    expect(board.entries[0].score).toBeGreaterThanOrEqual(board.entries[1].score);

    const { POST: chat } = await import('@/app/api/chat/route');
    const said = await call(chat, '/api/chat', { method: 'POST', body: JSON.stringify({ body: '  The roads to the capital are open.  ' }) });
    expect(said.body.message.body).toBe('The roads to the capital are open.');
    expect(said.body.message.clanName).toBe('Oda');

    const { GET: cron } = await import('@/app/api/cron/advance/route');
    expect((await call(cron, '/api/cron/advance')).status).toBe(403);
    const ok = await call(cron, '/api/cron/advance', { headers: { authorization: 'Bearer test-secret' } });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });
});
