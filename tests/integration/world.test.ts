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

import type { PlayerDTO } from '@/game/api';
import { simulateBattle } from '@/game/battle';
import { CLAN_PERMISSIONS, type ClanPermission, type ClanRole } from '@/game/clan';
import { WORLD, buildingCost, totalUnits, unitCost, type UnitCounts } from '@/game/config';
import { PROVINCE_BY_CODE } from '@/game/map';
import { STANCE_PREP_MINUTES } from '@/game/strategy';
import { advanceWorld } from '@/server/advance';
import { addUnitsToArmy, getGarrison } from '@/server/armies';
import { register } from '@/server/auth';
import { resolveBattle, verifyBattle } from '@/server/battles';
import { startUpgrade } from '@/server/buildings';
import { createClan } from '@/server/clans';
import { closePool, one, pool, rows, withWorldLock, type Db } from '@/server/db';
import { declareWar, proposePeace, respondPeace, warBlockReason } from '@/server/diplomacy';
import { getResources, grant } from '@/server/economy';
import { GameError } from '@/server/errors';
import { executeScout } from '@/server/espionage';
import { hasPermission } from '@/server/http';
import { joinClan, setDoctrine, setRole } from '@/server/members';
import { breakPact, proposePact, respondProposal } from '@/server/pacts';
import { effectiveStance, setStance } from '@/server/stance';
import { assignDuty, createPlan, launchPlan, respondDuty, setPlanStatus, updatePlan } from '@/server/warcouncil';
import { buildWarCouncil } from '@/server/warviews';
import { dispatchArmy, planMarch, recruit } from '@/server/military';
import { getPillars, unlockSkill } from '@/server/progression';
import { loadArmies, loadMods, type ClanRow, type MemberRow, type ProvinceRow } from '@/server/rows';
import { processTick } from '@/server/tick';
import { buildBattle, buildBattles, buildDiplomacy, buildMap, buildMe, buildProvince, buildSync, type Viewer } from '@/server/views';
import { gameContext, loadWorldState, type G } from '@/server/world';

// Virtual clock. At speed 60 one game minute is one real second.
let clock = Date.now() - 8 * 3600_000;
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

type TestPlayer = PlayerDTO;

/** The viewer the API would build for this player: their clan and their role in it, read fresh. */
async function viewerOf(player: TestPlayer): Promise<Viewer> {
  const m = await one<{ clan_id: string; role: ClanRole; joined_at: Date }>(db(), 'SELECT clan_id, role, joined_at FROM clan_members WHERE player_id = $1', [
    player.id,
  ]);
  if (!m) return { player, clan: null, member: null };
  const clan = (await one<ClanRow>(db(), 'SELECT * FROM clans WHERE id = $1', [m.clan_id]))!;
  const perms = await rows<{ permission: ClanPermission }>(db(), 'SELECT permission FROM clan_role_permissions WHERE clan_id = $1 AND role = $2', [
    m.clan_id,
    m.role,
  ]);
  return {
    player,
    clan,
    member: { clanId: m.clan_id, role: m.role, permissions: m.role === 'leader' ? [...CLAN_PERMISSIONS] : perms.map((x) => x.permission), joinedAt: m.joined_at },
  };
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
      await createClan(g, p1, { clanName: 'Uesugi', tag: 'UES', daimyoName: 'Kagetora', portrait: 'general', bannerColor: 'crimson', bannerMon: 'tomoe', provinceId: iga.id });
    });
    // The same province, and the same banner colour, cannot be taken twice.
    await expectRefused(
      order(p2.id, (g) => createClan(g, p2, { clanName: 'Takeda', tag: 'TAK', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'teal', bannerMon: 'peaks', provinceId: iga.id })),
      'PROVINCE_TAKEN',
    );
    await expectRefused(
      order(p2.id, (g) => createClan(g, p2, { clanName: 'Takeda', tag: 'TAK', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'crimson', bannerMon: 'peaks', provinceId: kii.id })),
      'BANNER_TAKEN',
    );
    await expectRefused(
      order(p2.id, (g) => createClan(g, p2, { clanName: 'uesugi', tag: 'UES', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'teal', bannerMon: 'peaks', provinceId: kii.id })),
      'CLAN_NAME_TAKEN',
    );
    // A refused founding leaves nothing behind.
    expect(await count('clans WHERE player_id = $1', [p2.id])).toBe(0);
    await order(p2.id, (g) => createClan(g, p2, { clanName: 'Takeda', tag: 'TAK', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'teal', bannerMon: 'peaks', provinceId: kii.id }));

    const clan = await clanOf(p1.id);
    expect((await province('iga')).owner_clan_id).toBe(clan.id);
    expect(clan.capital_province_id).toBe(iga.id);
    expect(clan.protected_until!.getTime()).toBeGreaterThan(clock);
    expect(await getResources(db(), clan.id)).toEqual(WORLD.startingResources);
    expect(totalUnits((await getGarrison(db(), iga.id, clan.id))!.units)).toBe(110);
    expect(await getGarrison(db(), iga.id, null)).toBeNull();
    expect(await count('player_pillars WHERE player_id = $1', [p1.id])).toBe(5);
    expect(await count(`province_ownership_history WHERE province_id = $1 AND reason = 'founding'`, [iga.id])).toBe(1);
    const ise = await province('ise');
    await expectRefused(
      order(p1.id, (g, c) => createClan(g, p1, { clanName: 'Second', tag: 'SEC', daimyoName: 'Kagetora', portrait: 'general', bannerColor: 'plum', bannerMon: 'tomoe', provinceId: ise.id })),
      'ALREADY_IN_CLAN',
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
    const me = await buildMe(db(), await viewerOf(p1), now());
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
    const pillars = await getPillars(db(), p1.id);
    expect(pillars.pillars).toHaveLength(5);
    const military = pillars.pillars.find((p) => p.id === 'military')!;
    expect(military.xp + military.level).toBeGreaterThan(1); // recruiting earned Military XP
    expect(pillars.pillars.find((p) => p.id === 'economy')!.xp).toBeGreaterThan(0); // building and production earned Economy XP
    expect(pillars.pillars.find((p) => p.id === 'leadership')!.xp).toBeGreaterThan(0);

    await expectRefused(order(p1.id, (g) => unlockSkill(g, p1.id, 'mil_infantry')), 'SKILL_LOCKED');
    await db().query(`UPDATE player_pillars SET level = 5, points = 4 WHERE player_id = $1 AND pillar = 'military'`, [p1.id]);
    for (let i = 0; i < 3; i++) await order(p1.id, (g) => unlockSkill(g, p1.id, 'mil_tactics'));
    await order(p1.id, (g) => unlockSkill(g, p1.id, 'mil_infantry'));
    // Out of points, and the rival branch is closed for good.
    await expectRefused(order(p1.id, (g) => unlockSkill(g, p1.id, 'mil_tactics')), 'SKILL_LOCKED');
    await db().query(`UPDATE player_pillars SET points = 1 WHERE player_id = $1 AND pillar = 'military'`, [p1.id]);
    await expectRefused(order(p1.id, (g) => unlockSkill(g, p1.id, 'mil_cavalry')), 'SKILL_LOCKED');
    await expectRefused(order(p1.id, (g) => unlockSkill(g, p1.id, 'no_such_skill')), 'INVALID');

    const after = await getPillars(db(), p1.id);
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
    await expectRefused(order(p1.id, (g, c) => dispatchArmy(g, c, p1.id, iga.id, ise.id, { ashigaru: 250, yari: 60 }, 'move')), 'MARCH_BLOCKED');
    const food = (await getResources(db(), clan.id)).food;
    await order(p1.id, (g, c) => dispatchArmy(g, c, p1.id, iga.id, ise.id, { ashigaru: 250, yari: 60 }, 'attack'));
    expect((await getResources(db(), clan.id)).food).toBe(food - plan.supplies);
    expect((await getGarrison(db(), iga.id, clan.id))!.units).toMatchObject({ ashigaru: 30, yari: 10 });
    // The same soldiers cannot be sent twice.
    await expectRefused(order(p1.id, (g, c) => dispatchArmy(g, c, p1.id, iga.id, ise.id, { ashigaru: 250 }, 'attack')), 'MARCH_BLOCKED');
    expect(await count(`armies WHERE clan_id = $1 AND status = 'marching'`, [clan.id])).toBe(1);

    const map = await buildMap(db(), await viewerOf(p1), now());
    expect(map.movements.filter((m) => m.own)).toHaveLength(1);
    expect(map.movements[0].units).toMatchObject({ ashigaru: 250, yari: 60 });
    // Another player sees that an army is on the road, but not what it is made of.
    const seenByP2 = await buildMap(db(), await viewerOf(p2), now());
    expect(seenByP2.movements[0].units).toBeNull();

    // The army arrives and gives battle; the battle is resolved later, by its own timer.
    await pass(Math.ceil(plan.minutes) + 1);
    const battle = await one<{ id: string; status: string }>(db(), 'SELECT id, status FROM battles WHERE attacker_clan_id = $1', [clan.id]);
    expect(battle!.status).toBe('pending');
    battleId = battle!.id;
    expect((await province('ise')).owner_clan_id).toBeNull();
    expect((await buildMap(db(), await viewerOf(p1), now())).provinces.find((p) => p.code === 'ise')!.underAttack).toBe(true);
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
    const me = await buildMe(db(), await viewerOf(p1), now());
    expect(me.clan!.provinceCount).toBe(2);
  });

  it('lets two players interact: protection, war, battle, peace', async () => {
    const c1 = await clanOf(p1.id);
    const c2 = await clanOf(p2.id);
    const ise = await province('ise');
    const kii = await province('kii');

    // No attack without a war; no war against a protected newcomer... but p1 attacked no clan, so is still protected.
    await expectRefused(order(p2.id, (g, c) => dispatchArmy(g, c, p2.id, kii.id, ise.id, { ashigaru: 50 }, 'attack')), 'MARCH_BLOCKED');
    await expectRefused(order(p2.id, (g, c) => declareWar(g, c, c1.id)), 'WAR_BLOCKED');

    // A game day later the truce of the realm has lapsed.
    await pass(WORLD.protectionHours * 60 + 1);
    const gold = (await getResources(db(), c2.id)).gold;
    await order(p2.id, (g, c) => declareWar(g, c, c1.id));
    expect((await getResources(db(), c2.id)).gold).toBe(gold - WORLD.warDeclarationCost);
    await expectRefused(order(p2.id, (g, c) => declareWar(g, c, c1.id)), 'WAR_BLOCKED');
    await expectRefused(order(p1.id, (g, c) => declareWar(g, c, c2.id)), 'WAR_BLOCKED');
    expect(await count(`notifications WHERE player_id = $1 AND type = 'war'`, [p1.id])).toBe(1);
    expect((await buildProvince(db(), await viewerOf(p2), ise.id, now())).actions.canAttack).toBe(true);

    // p2 throws its small garrison at Ise and is beaten back; the province does not change hands.
    await order(p2.id, (g, c) => dispatchArmy(g, c, p2.id, kii.id, ise.id, { ashigaru: 70, yari: 25 }, 'attack'));
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
    const view = await buildProvince(db(), await viewerOf(p2), ise.id, now());
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
    await db().query(`UPDATE player_pillars SET level = 4, points = 3 WHERE player_id = $1 AND pillar = 'economy'`, [p2.id]);

    // Once the peace has run its course, p1 declares war and marches on Kii with everything in Ise.
    await pass(WORLD.truceHours * 60 + 1);
    await order(p1.id, (g, c) => declareWar(g, c, c2.id));
    const host = (await getGarrison(db(), ise.id, c1.id))!.units;
    await order(p1.id, (g, c) => dispatchArmy(g, c, p1.id, ise.id, kii.id, host, 'attack'));
    await pass(200);
    expect((await province('kii')).owner_clan_id).toBe(c1.id);

    const fallen = await clanOf(p2.id);
    expect(fallen.status).toBe('fallen');
    expect(fallen.capital_province_id).toBeNull();
    expect(await count('armies WHERE clan_id = $1', [c2.id])).toBe(0);
    expect(await count(`wars WHERE status = 'active'`)).toBe(0);
    expect(await count(`world_events WHERE type = 'fallen' AND clan_id = $1`, [c2.id])).toBe(1);
    // A fallen clan cannot give orders...
    const me = await buildMe(db(), await viewerOf(p2), now());
    expect(me.clan!.status).toBe('fallen');
    expect(me.clan!.provinceCount).toBe(0);

    // ...but its Daimyo can found a new seat, keeping everything learned in the Five Pillars.
    const izumi = await province('izumi');
    await order(p2.id, (g, c) => createClan(g, p2, { clanName: 'Takeda', tag: 'TAK', daimyoName: 'Harunobu', portrait: 'sage', bannerColor: 'teal', bannerMon: 'peaks', provinceId: izumi.id }));
    const risen = await clanOf(p2.id);
    expect(risen.id).toBe(c2.id);
    expect(risen.status).toBe('active');
    expect(risen.capital_province_id).toBe(izumi.id);
    expect(await getResources(db(), c2.id)).toEqual(WORLD.startingResources);
    expect((await getPillars(db(), p2.id)).pillars.find((p) => p.id === 'economy')).toMatchObject({ level: 4, points: 3 });
    expect(totalUnits((await getGarrison(db(), izumi.id, c2.id))!.units)).toBe(110);
    // The conqueror's capital is unchanged and it now rules three provinces.
    expect((await buildMe(db(), await viewerOf(p1), now())).clan!.provinceCount).toBe(3);
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
    const first = await buildSync(db(), await viewerOf(p1), null, now());
    expect(first.events).toHaveLength(0);
    expect(first.cursor).toBeGreaterThan(0);
    const all = await buildSync(db(), await viewerOf(p1), 0, now());
    expect(all.events.length).toBeGreaterThan(0);
    const privateToP2 = await count(`realtime_events WHERE room = $1`, [`player:${p2.id}`]);
    expect(privateToP2).toBeGreaterThan(0);
    // The world room, the player's own room and their clan's room: nothing else.
    const allowed = new Set(
      (await rows<{ id: number }>(db(), `SELECT id FROM realtime_events WHERE room IN ('world', $1, $2)`, [`player:${p1.id}`, `clan:${c1.id}`])).map((r) => r.id),
    );
    for (const e of all.events) expect(allowed.has(e.id)).toBe(true);
    const c2 = await clanOf(p2.id);
    expect(await count(`realtime_events WHERE room = $1`, [`clan:${c2.id}`])).toBeGreaterThan(0);
    expect(first.resources).toEqual(await getResources(db(), c1.id));
  });
});

describe('the art of war', () => {
  const meta = { ip: null, userAgent: null };
  /** Run a member's order as the API does: membership and clan re-read and locked inside the transaction. */
  async function orderAs<T>(playerId: string, fn: (g: G, clan: ClanRow, member: MemberRow) => Promise<T>): Promise<T> {
    return withWorldLock(async (tx: Db) => {
      const g = await gameContext(tx, now(), playerId);
      const member = (await one<MemberRow>(tx, 'SELECT player_id, clan_id, role, joined_at, contribution FROM clan_members WHERE player_id = $1 FOR UPDATE', [playerId]))!;
      const clan = (await one<ClanRow>(tx, 'SELECT * FROM clans WHERE id = $1 FOR UPDATE', [member.clan_id]))!;
      return fn(g, clan, member);
    });
  }
  let naoe: PlayerDTO;
  let kojima: PlayerDTO;

  it('plans an attack in the war council and fights it with the chosen tactic', async () => {
    const c1 = await clanOf(p1.id);
    naoe = (await register({ email: 'naoe@example.com', password: 'long enough pw', nickname: 'Naoe' }, meta)).player;
    kojima = (await register({ email: 'kojima@example.com', password: 'long enough pw', nickname: 'Kojima' }, meta)).player;
    await db().query(`UPDATE clans SET recruitment = 'open' WHERE id = $1`, [c1.id]);
    for (const p of [naoe, kojima]) {
      await withWorldLock(async (tx: Db) => joinClan(await gameContext(tx, now(), p.id), p, c1.id));
    }
    await orderAs(p1.id, (g, clan, m) => setRole(g, clan, { ...m, nickname: p1.nickname }, naoe.id, 'strategist'));
    await orderAs(p1.id, (g, clan, m) => setRole(g, clan, { ...m, nickname: p1.nickname }, kojima.id, 'samurai'));
    // Kojima is the clan's best soldier, though he holds no office.
    await db().query(`UPDATE player_pillars SET level = 8 WHERE player_id = $1 AND pillar = 'military'`, [kojima.id]);
    const strategist = (await one<MemberRow>(db(), 'SELECT * FROM clan_members WHERE player_id = $1', [naoe.id]))!;
    const samurai = (await one<MemberRow>(db(), 'SELECT * FROM clan_members WHERE player_id = $1', [kojima.id]))!;
    expect(await hasPermission(db(), strategist, 'war_plans')).toBe(true);
    expect(await hasPermission(db(), strategist, 'command')).toBe(false);
    expect(await hasPermission(db(), samurai, 'war_plans')).toBe(false);

    // A province of the clan with unclaimed land next to it.
    const mine = await rows<ProvinceRow>(db(), 'SELECT * FROM provinces WHERE owner_clan_id = $1 ORDER BY code', [c1.id]);
    let origin: ProvinceRow | null = null;
    let target: ProvinceRow | null = null;
    for (const p of mine) {
      for (const code of PROVINCE_BY_CODE[p.code].neighbors) {
        const q = await province(code);
        if (!q.owner_clan_id && !origin) {
          origin = p;
          target = q;
        }
      }
    }
    expect(origin, 'the clan borders unclaimed land').not.toBeNull();
    const from = origin!;
    const to = target!;
    const garrison = (await getGarrison(db(), from.id, c1.id))!;
    await addUnitsToArmy(db(), garrison.id, { ashigaru: 900, cavalry: 300, archer: 200 });
    await withWorldLock(async (tx: Db) => grant(await gameContext(tx, now()), c1.id, { food: 40000, gold: 5000 }, 'test_grant'));
    const host = { ashigaru: 800, cavalry: 250, archer: 150 };
    const planned = await planMarch({ tx: db(), now: now() }, c1, from.id, to.id, host);
    expect(planned.ok).toBe(true);

    // The strategist drafts the plan, names the commander and hands out duties.
    const actor = { id: naoe.id, nickname: 'Naoe' };
    const draft = { title: `Take ${to.name}`, targetProvinceId: to.id, originProvinceId: from.id, units: host, commanderId: kojima.id, notes: 'Withdraw if the vanguard breaks.' };
    const planId = await orderAs(naoe.id, (g, clan) => createPlan(g, clan, actor, { ...draft, tactic: 'night_raid' }));
    await expectRefused(orderAs(naoe.id, (g, clan) => createPlan(g, clan, actor, { ...draft, originProvinceId: to.id, tactic: 'assault' })), 'PLAN_INVALID');
    await orderAs(naoe.id, (g, clan) => assignDuty(g, clan, actor, planId, p1.id, 'logistics', 'Keep the carts moving.'));
    await orderAs(naoe.id, (g, clan) => assignDuty(g, clan, actor, planId, p1.id, 'reinforcement', ''));
    await expectRefused(orderAs(naoe.id, (g, clan) => assignDuty(g, clan, actor, planId, p1.id, 'logistics', '')), 'ALREADY_ASSIGNED');
    await expectRefused(orderAs(naoe.id, (g, clan) => assignDuty(g, clan, actor, planId, p2.id, 'scout', '')), 'NOT_A_MEMBER');

    let council = await buildWarCouncil(db(), await viewerOf(kojima), now());
    let plan = council.plans.find((x) => x.id === planId)!;
    expect(plan.assignments.find((a) => a.duty === 'commander')).toMatchObject({ nickname: 'Kojima', status: 'assigned', isYou: true });
    expect(plan.assignments.find((a) => a.duty === 'strategist')).toMatchObject({ nickname: 'Naoe', status: 'accepted' });
    expect(plan.canEdit).toBe(false);
    expect(plan.canLaunch).toBe(false);
    expect(plan.launch.ok).toBe(false);

    // Not before the council calls it ready; not by someone with no part in it; not without the commander's word.
    const launchAs = (p: PlayerDTO, mayCommand: boolean) => orderAs(p.id, (g, clan, m) => launchPlan(g, clan, { ...m, nickname: p.nickname }, planId, mayCommand));
    await expectRefused(launchAs(kojima, false), 'PLAN_NOT_READY');
    await orderAs(naoe.id, (g, clan) => setPlanStatus(g, clan, actor, planId, 'ready'));
    await expectRefused(launchAs(naoe, false), 'FORBIDDEN_ROLE');
    await expectRefused(launchAs(p1, true), 'PLAN_INCOMPLETE');
    // The clan has not the skill for a night raid: the order is refused when it is given.
    await expectRefused(launchAs(kojima, false), 'TACTIC_BLOCKED');
    expect(await count(`armies WHERE plan_id = $1`, [planId])).toBe(0);
    expect((await one<{ status: string }>(db(), 'SELECT status FROM war_plans WHERE id = $1', [planId]))!.status).toBe('ready');

    await orderAs(naoe.id, (g, clan) => updatePlan(g, clan, actor, planId, { ...draft, tactic: 'flanking' }));
    await orderAs(p1.id, (g, clan) => respondDuty(g, clan, { id: p1.id, nickname: p1.nickname }, planId, 'logistics', true));
    await orderAs(p1.id, (g, clan) => respondDuty(g, clan, { id: p1.id, nickname: p1.nickname }, planId, 'reinforcement', true));
    council = await buildWarCouncil(db(), await viewerOf(naoe), now());
    plan = council.plans.find((x) => x.id === planId)!;
    expect(plan.tactic).toBe('flanking');
    expect(plan.bonuses.supplyFactor).toBe(0.8);
    expect(plan.bonuses.morale).toBe(4);
    expect(plan.bonuses.filled).toEqual(expect.arrayContaining(['strategist', 'logistics', 'reinforcement']));
    expect(plan.chance).toBeGreaterThan(0.8);
    expect(plan.canEdit).toBe(true);

    // The commander launches. The army carries the plan, its tactic and its commander.
    const armyId = await launchAs(kojima, false);
    const army = (await loadArmies(db(), 'a.id = $1', [armyId]))[0];
    expect(army).toMatchObject({ tactic: 'flanking', plan_id: planId, commander_player_id: kojima.id, status: 'marching' });
    const supplies = await one<{ amount: number }>(db(), `SELECT amount FROM transactions WHERE reason = 'march_supplies' AND ref_id = $1`, [armyId]);
    expect(-supplies!.amount).toBe(Math.ceil(planned.supplies * 0.8));
    await expectRefused(launchAs(kojima, false), 'PLAN_CLOSED');
    await expectRefused(orderAs(naoe.id, (g, clan) => updatePlan(g, clan, actor, planId, { ...draft, tactic: 'assault' })), 'PLAN_CLOSED');

    clock = army.arrives_at!.getTime();
    await pass(1);
    await pass(WORLD.battleMinutes + 2);
    const battle = (await one<any>(db(), 'SELECT * FROM battles WHERE plan_id = $1', [planId]))!;
    expect(battle.status).toBe('resolved');
    expect(battle.tactic).toBe('flanking');
    expect(battle.commander_player_id).toBe(kojima.id);
    const strategy = battle.inputs.strategy;
    expect(strategy.tactic).toBe('flanking');
    expect(strategy.tacticName).toBe('Flanking');
    expect(battle.inputs.attacker.commander).toBe('Kojima');
    // Flanking breaks on a Defensive Formation and is otherwise decided by the seeded roll.
    if (strategy.stance === 'formation') {
      expect(strategy.tacticResult).toBe('countered');
      expect(strategy.attacker.attack).toBeLessThan(0);
    } else {
      expect(['succeeded', 'failed']).toContain(strategy.tacticResult);
      expect(strategy.chance).toBeGreaterThan(0.8);
    }
    expect(strategy.notes.length).toBeGreaterThan(0);
    // The army fought with its commander's own Military pillar, not the leader's.
    const withCommander = await loadMods(db(), c1.id, kojima.id);
    const withoutHim = await loadMods(db(), c1.id);
    expect(withCommander.attack).not.toBeCloseTo(withoutHim.attack, 5);
    expect(battle.inputs.attacker.mods.attack).toBeCloseTo(withCommander.attack + strategy.attacker.attack, 5);
    expect(battle.inputs.attacker.mods.attack).not.toBeCloseTo(withoutHim.attack + strategy.attacker.attack, 5);
    // The record reproduces, strategy and all.
    const report = (await one<{ result: any }>(db(), 'SELECT result FROM battle_reports WHERE battle_id = $1', [battle.id]))!;
    expect(verifyBattle(battle.inputs, battle.seed, report.result)).toBe(true);

    // The plan is closed with the outcome, everyone who served is told, and the records are kept.
    const done = (await one<{ status: string; outcome: string; battle_id: string }>(db(), 'SELECT status, outcome, battle_id FROM war_plans WHERE id = $1', [planId]))!;
    expect(done).toMatchObject({ status: 'completed', outcome: report.result.outcome, battle_id: battle.id });
    // One report per member, however many duties they held.
    expect(await count(`notifications WHERE player_id = $1 AND link = $2 AND title LIKE 'War plan%'`, [p1.id, `/game/battles/${battle.id}`])).toBe(1);
    expect(await count(`notifications WHERE player_id = $1 AND link = $2 AND title LIKE 'War plan%'`, [naoe.id, `/game/battles/${battle.id}`])).toBe(1);
    expect((await one<{ battles_led: number }>(db(), 'SELECT battles_led FROM players WHERE id = $1', [kojima.id]))!.battles_led).toBe(1);
    const record = (await one<{ victories: number; defeats: number }>(db(), 'SELECT victories, defeats FROM clans WHERE id = $1', [c1.id]))!;
    if (report.result.winner !== 'none') expect(record.victories + record.defeats).toBeGreaterThan(0);
    const list = await buildBattles(db(), await clanOf(p1.id));
    expect(list.battles.find((b) => b.id === battle.id)).toMatchObject({ tactic: 'flanking', planId });
  });

  it('orders a stance that takes time to prepare', async () => {
    const c1 = await clanOf(p1.id);
    const capital = (await one<ProvinceRow>(db(), 'SELECT * FROM provinces WHERE id = $1', [c1.capital_province_id]))!;
    expect(effectiveStance(capital, now())).toBe('formation');
    await expectRefused(orderAs(p1.id, (g, clan) => setStance(g, clan, capital.id, 'formation')), 'STANCE_UNCHANGED');
    await orderAs(p1.id, (g, clan) => setStance(g, clan, capital.id, 'night_watch'));
    // The old order holds until the new one has been prepared.
    let row = (await one<ProvinceRow>(db(), 'SELECT * FROM provinces WHERE id = $1', [capital.id]))!;
    expect(effectiveStance(row, now())).toBe('formation');
    const view = await buildProvince(db(), await viewerOf(p1), capital.id, now());
    expect(view.own!.stance.current).toBe('formation');
    expect(view.own!.stance.pending!.stance).toBe('night_watch');
    await expectRefused(orderAs(p1.id, (g, clan) => setStance(g, clan, capital.id, 'night_watch')), 'STANCE_UNCHANGED');
    await pass(STANCE_PREP_MINUTES + 1);
    row = (await one<ProvinceRow>(db(), 'SELECT * FROM provinces WHERE id = $1', [capital.id]))!;
    expect(effectiveStance(row, now())).toBe('night_watch');

    // Deep stores are paid for; an ambush needs somewhere to hide.
    const food = (await getResources(db(), c1.id)).food;
    await orderAs(p1.id, (g, clan) => setStance(g, clan, capital.id, 'stockpile'));
    expect(await count(`transactions WHERE clan_id = $1 AND reason = 'stance_preparation' AND resource = 'food' AND amount = -250`, [c1.id])).toBe(1);
    expect((await getResources(db(), c1.id)).food).toBeLessThanOrEqual(food - 250 + 5000);
    const flat = (await rows<ProvinceRow>(db(), 'SELECT * FROM provinces WHERE owner_clan_id = $1', [c1.id])).find((p) => p.terrain === 'plains' || p.terrain === 'coast');
    if (flat) await expectRefused(orderAs(p1.id, (g, clan) => setStance(g, clan, flat.id, 'ambush')), 'STANCE_BLOCKED');
    // Somebody else's province is not yours to order.
    const theirs = (await one<ProvinceRow>(db(), 'SELECT * FROM provinces WHERE owner_clan_id = $1 LIMIT 1', [(await clanOf(p2.id)).id]))!;
    await expectRefused(orderAs(p1.id, (g, clan) => setStance(g, clan, theirs.id, 'hold')), 'FORBIDDEN');
  });

  it('binds clans by treaties, with a price for breaking them', async () => {
    const c1 = await clanOf(p1.id);
    const c2 = await clanOf(p2.id);
    expect(c2.status).toBe('active');
    await withWorldLock(async (tx: Db) => grant(await gameContext(tx, now()), c1.id, { gold: 5000 }, 'test_grant'));
    // No treaty while the two are at war: peace comes first.
    if (await count(`wars WHERE status = 'active' AND attacker_clan_id IN ($1, $2) AND defender_clan_id IN ($1, $2)`, [c1.id, c2.id])) {
      await expectRefused(order(p1.id, (g, c) => proposePact(g, c, c2.id, 'nap')), 'PACT_BLOCKED');
      await order(p1.id, (g, c) => proposePeace(g, c, c2.id));
      const peace = (await one<{ id: string }>(db(), `SELECT id FROM diplomacy WHERE type = 'peace' AND status = 'pending' AND to_clan_id = $1`, [c2.id]))!;
      await order(p2.id, (g, c) => respondPeace(g, c, peace.id, true));
    }

    // A non-aggression pact: offered, accepted, and binding.
    await order(p1.id, (g, c) => proposePact(g, c, c2.id, 'nap'));
    await expectRefused(order(p1.id, (g, c) => proposePact(g, c, c2.id, 'nap')), 'ALREADY_PROPOSED');
    let theirs = await buildDiplomacy(db(), c2, now());
    const offer = theirs.clans.find((x) => x.clan.id === c1.id)!.pendingPacts[0];
    expect(offer).toMatchObject({ type: 'nap', direction: 'incoming' });
    await order(p2.id, (g, c) => respondProposal(g, c, offer.proposalId, true));
    let mine = await buildDiplomacy(db(), c1, now());
    let entry = mine.clans.find((x) => x.clan.id === c2.id)!;
    expect(entry.relation).toBe('nap');
    expect(entry.pact!.endsAt).not.toBeNull();
    expect(entry.canDeclareWar).toBe(false);
    await expectRefused(order(p1.id, (g, c) => declareWar(g, c, c2.id)), 'WAR_BLOCKED');

    // An alliance replaces it: allies see each other's garrisons.
    await order(p2.id, (g, c) => proposePact(g, c, c1.id, 'alliance'));
    mine = await buildDiplomacy(db(), c1, now());
    const alliance = mine.clans.find((x) => x.clan.id === c2.id)!.pendingPacts.find((x) => x.type === 'alliance')!;
    await order(p1.id, (g, c) => respondProposal(g, c, alliance.proposalId, true));
    expect(await count(`pacts WHERE status = 'active'`)).toBe(1);
    expect(await count(`pacts WHERE status = 'ended' AND end_reason = 'superseded'`)).toBe(1);
    const map = await buildMap(db(), await viewerOf(p1), now());
    const allied = map.provinces.filter((p) => p.ownerClanId === c2.id);
    expect(allied.length).toBeGreaterThan(0);
    for (const p of allied) {
      expect(p.relation).toBe('allied');
      expect(p.strength).toMatchObject({ exact: true });
    }
    entry = (await buildDiplomacy(db(), c1, now())).clans.find((x) => x.clan.id === c2.id)!;
    expect(entry.relation).toBe('alliance');
    expect(entry.allianceBlockedReason).not.toBeNull();

    // An old house does not bind itself to a new banner.
    const npc = (await one<ClanRow>(db(), `SELECT * FROM clans WHERE is_npc AND status = 'active' LIMIT 1`))!;
    if (await count(`wars WHERE status = 'active' AND attacker_clan_id IN ($1, $2) AND defender_clan_id IN ($1, $2)`, [c1.id, npc.id])) {
      await expectRefused(order(p1.id, (g, c) => proposePact(g, c, npc.id, 'alliance')), 'PACT_BLOCKED');
    } else {
      await order(p1.id, (g, c) => proposePact(g, c, npc.id, 'alliance'));
      expect(await count(`diplomacy WHERE from_clan_id = $1 AND to_clan_id = $2 AND type = 'alliance' AND status = 'rejected'`, [c1.id, npc.id])).toBe(1);
    }
    expect(await count(`pacts WHERE status = 'active' AND (clan_a = $1 OR clan_b = $1)`, [npc.id])).toBe(0);

    // Breaking one's word costs loyalty at home and delays the war it was broken for.
    const before = await rows<{ id: string; loyalty: number }>(db(), 'SELECT id, loyalty FROM provinces WHERE owner_clan_id = $1 ORDER BY id', [c1.id]);
    const pactId = entry.pact!.id;
    await expectRefused(order(p1.id, (g, c) => breakPact(g, c, '00000000-0000-4000-8000-000000000000')), 'NOT_FOUND');
    await order(p1.id, (g, c) => breakPact(g, c, pactId));
    const after = await rows<{ id: string; loyalty: number }>(db(), 'SELECT id, loyalty FROM provinces WHERE owner_clan_id = $1 ORDER BY id', [c1.id]);
    for (const [i, p] of before.entries()) expect(after[i].loyalty).toBeCloseTo(Math.max(0, p.loyalty - 8), 1);
    expect(await count(`pacts WHERE status = 'active'`)).toBe(0);
    expect(await count(`world_events WHERE type = 'pact_broken' AND clan_id = $1`, [c1.id])).toBe(1);
    // (The newcomer's truce would hide the reason we are looking for.)
    await db().query('UPDATE clans SET protected_until = NULL WHERE id = $1', [c2.id]);
    const blocked = async () => {
      const g = { tx: db(), now: now(), speed: 60 };
      return warBlockReason(g, await clanOf(p1.id), await clanOf(p2.id), await rows(db(), `SELECT * FROM wars WHERE status = 'active'`));
    };
    expect(await blocked()).toMatch(/broken your word/);
    await pass(12 * 60 + 5);
    expect((await blocked()) ?? '').not.toMatch(/broken your word/);

    // A pact runs out by itself.
    await order(p1.id, (g, c) => proposePact(g, c, c2.id, 'nap'));
    const again = (await buildDiplomacy(db(), c2, now())).clans.find((x) => x.clan.id === c1.id)!.pendingPacts[0];
    await order(p2.id, (g, c) => respondProposal(g, c, again.proposalId, true));
    expect(await count(`pacts WHERE status = 'active'`)).toBe(1);
    await pass(72 * 60 + 61);
    expect(await count(`pacts WHERE status = 'active'`)).toBe(0);
    expect(await count(`pacts WHERE end_reason = 'expired'`)).toBe(1);
  });

  it('lets the leader set the clan on a doctrine, and holds it there', async () => {
    const c1 = await clanOf(p1.id);
    const plain = await loadMods(db(), c1.id);
    await expectRefused(orderAs(naoe.id, (g, clan, m) => setDoctrine(g, clan, { ...m, nickname: 'Naoe' }, 'aggressive')), 'FORBIDDEN_ROLE');
    await orderAs(p1.id, (g, clan, m) => setDoctrine(g, clan, { ...m, nickname: p1.nickname }, 'aggressive'));
    const tiger = await loadMods(db(), c1.id);
    expect(tiger.attack).toBeCloseTo(plain.attack + 0.06);
    expect(tiger.marchSpeed).toBeCloseTo(plain.marchSpeed + 0.1);
    expect(tiger.defense).toBeCloseTo(plain.defense - 0.05);
    await expectRefused(orderAs(p1.id, (g, clan, m) => setDoctrine(g, clan, { ...m, nickname: p1.nickname }, 'defensive')), 'DOCTRINE_COOLDOWN');
    const profile = await buildMap(db(), await viewerOf(p2), now());
    expect(profile.clans.find((c) => c.id === c1.id)!.doctrine).toBe('aggressive');
    // The virtual clock must still be behind the wall clock for the HTTP tests that follow.
    expect(clock).toBeLessThan(Date.now());
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
      body: JSON.stringify({ clanName: 'Oda', tag: 'ODA', daimyoName: 'Nobunaga', portrait: 'strategist', bannerColor: 'ochre', bannerMon: 'blossom', provinceId: slot.id }),
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
    // NPC houses and the clans of players that still hold land (the world has moved on by now).
    expect(board.entries.length).toBeGreaterThanOrEqual(3);
    expect(board.players.length).toBeGreaterThanOrEqual(3);
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

  // -------------------------------------------------------------------------
  // Clan-based play (change request v2.0)
  // -------------------------------------------------------------------------

  const post = async (mod: string, path: string, body: unknown = {}, params?: Record<string, string>) =>
    call((await import(mod)).POST, path, { method: 'POST', body: JSON.stringify(body), params });
  const get = async (mod: string, path: string, params?: Record<string, string>) => call((await import(mod)).GET, path, { params });
  const signUp = async (email: string, nickname: string) => {
    cookie = '';
    const res = await post('@/app/api/auth/register/route', '/api/auth/register', { email, password: 'long enough pw', nickname });
    expect(res.status).toBe(200);
    return { cookie: res.headers.get('set-cookie')!.split(';')[0], id: res.body.player.id as string };
  };
  let leader = '';
  let ranmaru: { cookie: string; id: string };
  let hide: { cookie: string; id: string };
  let outsider: { cookie: string; id: string };
  let odaId = '';

  it('lets players discover a clan, apply, be invited and join', async () => {
    leader = cookie;
    ranmaru = await signUp('ran@example.com', 'Ranmaru');
    hide = await signUp('hide@example.com', 'Hideyoshi');
    outsider = await signUp('dosan@example.com', 'Dosan');

    // A new player has a purse and pillars of their own before joining anyone.
    cookie = ranmaru.cookie;
    const fresh = (await get('@/app/api/player/me/route', '/api/player/me')).body;
    expect(fresh.clan).toBeNull();
    expect(fresh.membership).toBeNull();
    expect(fresh.personal.purse.gold).toBe(300);
    expect((await get('@/app/api/pillars/me/route', '/api/pillars/me')).body.council).toBeNull();

    const dir = (await get('@/app/api/clans/route', '/api/clans')).body;
    const oda = dir.entries.find((e: any) => e.clan.name === 'Oda');
    odaId = oda.clan.id;
    expect(oda.clan.tag).toBe('ODA');
    expect(oda.clan.memberCount).toBe(1);
    expect(oda.join.option).toBe('apply');
    expect(dir.entries.find((e: any) => e.clan.isNpc).join.option).toBeNull();
    expect((await get('@/app/api/clans/route', '/api/clans?search=od')).body.entries).toHaveLength(1);

    // Not open: joining outright is refused; applying works once.
    expect((await post('@/app/api/clans/[id]/join/route', `/api/clans/${odaId}/join`, {}, { id: odaId })).body.error.code).toBe('NOT_OPEN');
    const applied = await post('@/app/api/clans/[id]/apply/route', `/api/clans/${odaId}/apply`, { message: 'I will carry your sandals.' }, { id: odaId });
    expect(applied.status).toBe(200);
    expect(applied.body.applications).toHaveLength(1);
    expect((await post('@/app/api/clans/[id]/apply/route', `/api/clans/${odaId}/apply`, {}, { id: odaId })).body.error.code).toBe('ALREADY_APPLIED');

    // The leader sees the application and admits the applicant as a Recruit.
    cookie = leader;
    let hub = (await get('@/app/api/clan/route', '/api/clan')).body;
    expect(hub.membership.role).toBe('leader');
    expect(hub.applications).toHaveLength(1);
    expect(hub.applications[0].message).toBe('I will carry your sandals.');
    hub = (await post('@/app/api/clan/applications/route', '/api/clan/applications', { applicationId: hub.applications[0].id, accept: true })).body;
    expect(hub.members).toHaveLength(2);
    expect(hub.members.find((m: any) => m.nickname === 'Ranmaru').role).toBe('recruit');
    expect(hub.applications).toHaveLength(0);

    // Invitation only: the invited player may accept, nobody else can get in.
    hub = (await post('@/app/api/clan/settings/route', '/api/clan/settings', { recruitment: 'invite', description: 'Rule the realm by force.' })).body;
    expect(hub.clan.recruitment).toBe('invite');
    expect(hub.clan.description).toBe('Rule the realm by force.');
    hub = (await post('@/app/api/clan/invitations/route', '/api/clan/invitations', { nickname: 'hideyoshi' })).body;
    expect(hub.invitations).toHaveLength(1);
    expect((await post('@/app/api/clan/invitations/route', '/api/clan/invitations', { nickname: 'hideyoshi' })).body.error.code).toBe('ALREADY_INVITED');

    cookie = outsider.cookie;
    expect((await post('@/app/api/clans/[id]/apply/route', `/api/clans/${odaId}/apply`, {}, { id: odaId })).body.error.code).toBe('NOT_OPEN');

    cookie = hide.cookie;
    const invited = (await get('@/app/api/clans/route', '/api/clans')).body;
    expect(invited.invitations).toHaveLength(1);
    expect(invited.entries.find((e: any) => e.clan.id === odaId).join.option).toBe('accept_invitation');
    const joined = await post('@/app/api/clan/invitations/respond/route', '/api/clan/invitations/respond', { invitationId: invited.invitations[0].id, accept: true });
    expect(joined.status).toBe(200);
    expect(joined.body.clan.name).toBe('Oda');
    expect(joined.body.membership.role).toBe('recruit');
    // One clan at a time.
    expect((await post('@/app/api/clans/[id]/join/route', `/api/clans/${odaId}/join`, {}, { id: odaId })).body.error.code).toBe('ALREADY_IN_CLAN');
    expect(await count('clan_members WHERE clan_id = $1', [odaId])).toBe(3);
  });

  it('holds every member to the permissions of their role', async () => {
    cookie = leader;
    const hub = (await get('@/app/api/clan/route', '/api/clan')).body;
    const capital = hub.clan.capitalProvinceId as string;

    // A Recruit may not spend the treasury or command.
    cookie = ranmaru.cookie;
    const denied = await post('@/app/api/buildings/upgrade/route', '/api/buildings/upgrade', { provinceId: capital, type: 'market' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN_ROLE');
    expect((await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: hide.id, role: 'general' })).body.error.code).toBe('FORBIDDEN_ROLE');
    // ...but shares the clan's land and treasury views.
    expect((await get('@/app/api/army/route', '/api/army')).status).toBe(200);

    // The leader appoints a Treasurer and a Daimyo.
    cookie = leader;
    await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: ranmaru.id, role: 'treasurer' });
    const appointed = (await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: hide.id, role: 'officer' })).body;
    expect(appointed.members.find((m: any) => m.nickname === 'Hideyoshi').roleName).toBe('Daimyo');
    expect((await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: ranmaru.id, role: 'leader' })).body.error.code).toBe('INVALID');

    // The Treasurer may build (the builders may be busy, but the role is no longer the obstacle), not recruit.
    cookie = ranmaru.cookie;
    const build = await post('@/app/api/buildings/upgrade/route', '/api/buildings/upgrade', { provinceId: capital, type: 'market' });
    expect(build.body.error?.code).not.toBe('FORBIDDEN_ROLE');
    const recruitDenied = await post('@/app/api/army/recruit/route', '/api/army/recruit', { provinceId: capital, unitType: 'ashigaru', count: 5 });
    expect(recruitDenied.body.error.code).toBe('FORBIDDEN_ROLE');

    // The leader reconfigures what a Treasurer may do; it takes effect at once.
    cookie = leader;
    const perms = (await post('@/app/api/clan/permissions/route', '/api/clan/permissions', { role: 'treasurer', permissions: ['treasury', 'build', 'recruit'] })).body;
    expect(perms.permissions.treasurer.sort()).toEqual(['build', 'recruit', 'treasury']);
    cookie = ranmaru.cookie;
    const recruitNow = await post('@/app/api/army/recruit/route', '/api/army/recruit', { provinceId: capital, unitType: 'ashigaru', count: 5 });
    expect(recruitNow.body.error?.code).not.toBe('FORBIDDEN_ROLE');
    // Only the leader edits permissions.
    expect((await post('@/app/api/clan/permissions/route', '/api/clan/permissions', { role: 'recruit', permissions: ['treasury'] })).body.error.code).toBe('FORBIDDEN_ROLE');

    // A Daimyo manages members below their own rank only.
    cookie = hide.cookie;
    expect((await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: ranmaru.id, role: 'officer' })).body.error.code).toBe('FORBIDDEN_ROLE');
    expect((await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: ranmaru.id, role: 'general' })).status).toBe(200);
    cookie = leader;
    await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: ranmaru.id, role: 'treasurer' });
  });

  it('keeps the shared treasury secure and auditable', async () => {
    cookie = ranmaru.cookie;
    const paid = await post('@/app/api/clan/contribute/route', '/api/clan/contribute', { resources: { gold: 100, wood: 50 } });
    expect(paid.status).toBe(200);
    const mine = paid.body.treasury.contributions.find((c: any) => c.nickname === 'Ranmaru');
    expect(mine.resources.gold).toBe(100);
    expect(mine.resources.wood).toBe(50);
    expect(mine.points).toBe(140);
    // Both ledgers record the same movement, with the member who made it.
    expect(await count(`transactions WHERE clan_id = $1 AND reason = 'member_contribution' AND actor_player_id = $2 AND resource = 'gold' AND amount = 100`, [odaId, ranmaru.id])).toBe(1);
    expect(await count(`player_transactions WHERE player_id = $1 AND reason = 'clan_contribution' AND resource = 'gold' AND amount = -100`, [ranmaru.id])).toBe(1);
    expect(paid.body.treasury.log.some((t: any) => t.reason === 'member_contribution' && t.actor === 'Ranmaru' && t.amount === 100)).toBe(true);

    // More than the purse holds: refused, and nothing moves.
    const tooMuch = await post('@/app/api/clan/contribute/route', '/api/clan/contribute', { resources: { gold: 10_000_000 } });
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_RESOURCES');
    expect((await one<{ contribution: number }>(db(), 'SELECT contribution FROM clan_members WHERE player_id = $1', [ranmaru.id]))!.contribution).toBe(140);

    // The Treasurer pays a member from the treasury; a Daimyo holds no key to it.
    const grantOut = await post('@/app/api/clan/withdraw/route', '/api/clan/withdraw', { playerId: hide.id, resources: { gold: 30 }, note: 'for the road' });
    expect(grantOut.status).toBe(200);
    expect(await count(`transactions WHERE clan_id = $1 AND reason = 'treasury_withdrawal' AND actor_player_id = $2 AND amount = -30`, [odaId, ranmaru.id])).toBe(1);
    expect(await count(`player_transactions WHERE player_id = $1 AND reason = 'treasury_grant' AND amount = 30`, [hide.id])).toBe(1);
    expect(grantOut.body.activity.some((a: any) => a.type === 'withdrawal' && a.body.includes('for the road'))).toBe(true);
    cookie = hide.cookie;
    expect((await post('@/app/api/clan/withdraw/route', '/api/clan/withdraw', { playerId: hide.id, resources: { gold: 500 } })).body.error.code).toBe('FORBIDDEN_ROLE');
    // Nobody can pay treasury resources to someone outside the clan.
    cookie = ranmaru.cookie;
    expect((await post('@/app/api/clan/withdraw/route', '/api/clan/withdraw', { playerId: outsider.id, resources: { gold: 1 } })).body.error.code).toBe('NOT_FOUND');

    // The personal residence is paid from the purse.
    const before = (await one<{ residence_level: number }>(db(), 'SELECT residence_level FROM players WHERE id = $1', [hide.id]))!.residence_level;
    cookie = hide.cookie;
    const home = await post('@/app/api/player/residence/route', '/api/player/residence');
    expect(home.status).toBe(200);
    expect(home.body.personal.residenceLevel).toBe(before + 1);
  });

  it('carries each pillar of the clan through its council seat', async () => {
    // The Treasurer is the clan's best economist: the clan's Economy is theirs.
    await db().query(`UPDATE player_pillars SET level = 9 WHERE player_id = $1 AND pillar = 'economy'`, [ranmaru.id]);
    cookie = leader;
    const pillars = (await get('@/app/api/pillars/me/route', '/api/pillars/me')).body;
    const seat = pillars.council.seats.find((s: any) => s.pillar === 'economy');
    expect(seat.nickname).toBe('Ranmaru');
    expect(seat.level).toBe(9);
    expect(pillars.council.modifiers.prodAll).toBeGreaterThan(pillars.modifiers.prodAll);
    // Without the seat the same skill counts for nothing.
    await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: ranmaru.id, role: 'samurai' });
    const without = (await get('@/app/api/pillars/me/route', '/api/pillars/me')).body;
    expect(without.council.seats.find((s: any) => s.pillar === 'economy').nickname).toBe('Nobunaga');
    await post('@/app/api/clan/members/role/route', '/api/clan/members/role', { playerId: ranmaru.id, role: 'treasurer' });
  });

  it('keeps clan chat to the clan and private messages to the two players', async () => {
    cookie = ranmaru.cookie;
    const said = await post('@/app/api/chat/route', '/api/chat', { channel: 'clan', body: 'The granaries are full.' });
    expect(said.body.message.channel).toBe('clan');

    cookie = hide.cookie;
    const clanChat = (await get('@/app/api/chat/route', '/api/chat?channel=clan')).body;
    expect(clanChat.messages.map((m: any) => m.body)).toContain('The granaries are full.');
    const world = (await get('@/app/api/chat/route', '/api/chat?channel=world')).body;
    expect(world.messages.map((m: any) => m.body)).not.toContain('The granaries are full.');

    // An outsider has no clan channel, and the clan's room is not in their feed.
    cookie = outsider.cookie;
    expect((await get('@/app/api/chat/route', '/api/chat?channel=clan')).body.error.code).toBe('NO_CLAN');
    expect((await post('@/app/api/chat/route', '/api/chat', { channel: 'clan', body: 'Let me in' })).body.error.code).toBe('NO_CLAN');
    const feed = (await get('@/app/api/sync/route', '/api/sync?cursor=0')).body;
    const clanEventIds = new Set((await rows<{ id: number }>(db(), 'SELECT id FROM realtime_events WHERE room = $1', [`clan:${odaId}`])).map((r) => r.id));
    expect(clanEventIds.size).toBeGreaterThan(0);
    expect(feed.events.some((e: any) => clanEventIds.has(e.id))).toBe(false);

    // A private message reaches its recipient and nobody else.
    const dm = await post('@/app/api/chat/route', '/api/chat', { channel: 'dm', to: ranmaru.id, body: 'Name your price.' });
    expect(dm.status).toBe(200);
    expect((await post('@/app/api/chat/route', '/api/chat', { channel: 'dm', to: outsider.id, body: 'me' })).body.error.code).toBe('INVALID');

    cookie = ranmaru.cookie;
    expect((await get('@/app/api/player/me/route', '/api/player/me')).body.unreadMessages).toBeGreaterThanOrEqual(1);
    const threads = (await get('@/app/api/chat/threads/route', '/api/chat/threads')).body;
    expect(threads.threads).toHaveLength(1);
    expect(threads.threads[0].with.nickname).toBe('Dosan');
    expect(threads.threads[0].unread).toBe(1);
    const thread = (await get('@/app/api/chat/route', `/api/chat?channel=dm&with=${outsider.id}`)).body;
    expect(thread.messages.map((m: any) => m.body)).toEqual(['Name your price.']);
    expect(thread.messages[0].mine).toBe(false);
    expect((await get('@/app/api/chat/threads/route', '/api/chat/threads')).body.threads[0].unread).toBe(0);
    await post('@/app/api/chat/route', '/api/chat', { channel: 'dm', to: outsider.id, body: 'More than you have.' });

    cookie = hide.cookie;
    expect((await get('@/app/api/chat/threads/route', '/api/chat/threads')).body.threads).toHaveLength(0);
    expect((await get('@/app/api/chat/route', `/api/chat?channel=dm&with=${outsider.id}`)).body.messages).toHaveLength(0);
    const hideFeed = (await get('@/app/api/sync/route', '/api/sync?cursor=0')).body;
    expect(hideFeed.events.some((e: any) => e.event === 'chat:message' && e.payload.channel === 'dm')).toBe(false);

    cookie = outsider.cookie;
    const reply = (await get('@/app/api/chat/route', `/api/chat?channel=dm&with=${ranmaru.id}`)).body;
    expect(reply.messages.map((m: any) => m.body)).toEqual(['Name your price.', 'More than you have.']);
  });

  it('hands over leadership, lets members leave, and dissolves a clan with its last member', async () => {
    // A leader with followers cannot simply walk away.
    cookie = leader;
    expect((await post('@/app/api/clan/leave/route', '/api/clan/leave')).body.error.code).toBe('LEADER_MUST_HAND_OVER');
    cookie = hide.cookie;
    expect((await post('@/app/api/clan/members/transfer/route', '/api/clan/members/transfer', { playerId: ranmaru.id })).body.error.code).toBe('FORBIDDEN_ROLE');
    cookie = leader;
    const handed = (await post('@/app/api/clan/members/transfer/route', '/api/clan/members/transfer', { playerId: hide.id })).body;
    expect(handed.membership.role).toBe('officer');
    expect(handed.members.find((m: any) => m.role === 'leader').nickname).toBe('Hideyoshi');
    expect((await one<{ player_id: string }>(db(), 'SELECT player_id FROM clans WHERE id = $1', [odaId]))!.player_id).toBe(hide.id);
    expect(await count(`clan_members WHERE clan_id = $1 AND role = 'leader'`, [odaId])).toBe(1);

    // A member who leaves keeps their purse and everything learned.
    cookie = ranmaru.cookie;
    const left = await post('@/app/api/clan/leave/route', '/api/clan/leave');
    expect(left.body.clan).toBeNull();
    expect(left.body.personal.purse.gold).toBeGreaterThan(0);
    expect((await get('@/app/api/pillars/me/route', '/api/pillars/me')).body.pillars.find((p: any) => p.id === 'economy').level).toBe(9);
    expect((await get('@/app/api/clan/route', '/api/clan')).body.error.code).toBe('NO_CLAN');

    // The new leader removes the old one; an removed member is free to found a clan of their own.
    cookie = hide.cookie;
    const kicked = (await post('@/app/api/clan/members/kick/route', '/api/clan/members/kick', { playerId: (await one<{ id: string }>(db(), `SELECT id FROM players WHERE nickname = 'Nobunaga'`))!.id })).body;
    expect(kicked.members).toHaveLength(1);

    // A clan of one: when its leader leaves, it is dissolved and its land returns to the local warriors.
    const capital = (await one<{ capital_province_id: string }>(db(), 'SELECT capital_province_id FROM clans WHERE id = $1', [odaId]))!.capital_province_id;
    const gone = await post('@/app/api/clan/leave/route', '/api/clan/leave');
    expect(gone.body.clan).toBeNull();
    const dissolved = (await one<ClanRow>(db(), 'SELECT * FROM clans WHERE id = $1', [odaId]))!;
    expect(dissolved.status).toBe('disbanded');
    expect(dissolved.player_id).toBeNull();
    expect(await count('provinces WHERE owner_clan_id = $1', [odaId])).toBe(0);
    expect(totalUnits((await getGarrison(db(), capital, null))!.units)).toBeGreaterThan(0);
    expect(await count('armies WHERE clan_id = $1', [odaId])).toBe(0);
    expect(await count('clan_members WHERE clan_id = $1', [odaId])).toBe(0);
    expect(await count(`province_ownership_history WHERE province_id = $1 AND reason = 'abandoned'`, [capital])).toBe(1);

    // Its name, tag, colour and seat are free again; a new clan with open gates takes them.
    cookie = outsider.cookie;
    const map = (await get('@/app/api/world/map/route', '/api/world/map')).body;
    expect(map.provinces.find((p: any) => p.id === capital).isStartSlot).toBe(true);
    expect(map.clans.some((c: any) => c.id === odaId)).toBe(false);
    const founded = await post('@/app/api/clans/route', '/api/clans', {
      clanName: 'Oda',
      tag: 'oda',
      recruitment: 'open',
      daimyoName: 'Dosan',
      portrait: 'shadow',
      bannerColor: 'ochre',
      bannerMon: 'tomoe',
      provinceId: capital,
    });
    expect(founded.status).toBe(200);
    expect(founded.body.membership.role).toBe('leader');
    expect(founded.body.clan.tag).toBe('ODA');
    expect(founded.body.clan.id).not.toBe(odaId);
    // Open recruitment: anyone without a clan walks in.
    cookie = ranmaru.cookie;
    const walkedIn = await post('@/app/api/clans/[id]/join/route', `/api/clans/${founded.body.clan.id}/join`, {}, { id: founded.body.clan.id });
    expect(walkedIn.body.clan.name).toBe('Oda');
    expect(walkedIn.body.membership.role).toBe('recruit');
  });
});
