import { BANNER_COLORS, BANNER_MONS, NAME_RULES, PORTRAITS, RESOURCE_KEYS, WORLD, normalizeUnits } from '@/game/config';
import type { CreateClanRequest } from '@/game/api';
import { deleteArmy, ensureGarrison, getGarrison, setArmyUnits } from './armies';
import { one } from './db';
import { getResources } from './economy';
import { conflict, invalid, notFound } from './errors';
import { audit, chronicle } from './notify';
import { initPillars } from './progression';
import type { ClanRow, ProvinceRow } from './rows';
import { transferProvince } from './territory';
import { addMs, dayLabel, gameMs, type G } from './world';

function cleanName(value: string, rule: { min: number; max: number; pattern: RegExp }, what: string): string {
  const v = (value ?? '').trim().replace(/\s+/g, ' ');
  if (v.length < rule.min || v.length > rule.max) throw invalid(`${what} must be ${rule.min}-${rule.max} characters`);
  if (!rule.pattern.test(v)) throw invalid(`${what} may only use letters, numbers, spaces, hyphens and apostrophes`);
  return v;
}

/**
 * Found a clan (CLAN-01..05): create the Daimyo, the clan and its banner, and
 * assign the chosen starting province. The province row is locked and must
 * still be an unclaimed start slot, so two players can never be given the same
 * land. A Daimyo whose clan has fallen founds anew with the same call and
 * keeps everything learned in the Five Pillars.
 */
export async function createClan(g: G, player: { id: string; nickname: string }, existing: ClanRow | null, input: CreateClanRequest): Promise<string> {
  if (existing && existing.status === 'active') throw conflict('ALREADY_HAS_CLAN', 'You already lead a clan');
  const clanName = cleanName(input.clanName, NAME_RULES.clanName, 'Clan name');
  const daimyoName = cleanName(input.daimyoName, NAME_RULES.daimyoName, 'Daimyo name');
  if (!PORTRAITS.some((p) => p.id === input.portrait)) throw invalid('Choose a portrait');
  if (!BANNER_COLORS.some((c) => c.id === input.bannerColor)) throw invalid('Choose a banner colour');
  if (!BANNER_MONS.some((m) => m.id === input.bannerMon)) throw invalid('Choose a banner crest');

  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 FOR UPDATE', [input.provinceId]);
  if (!province) throw notFound('Province');
  if (province.owner_clan_id || !province.is_start_slot) {
    throw conflict('PROVINCE_TAKEN', `${province.name} is no longer available. Choose another starting province.`);
  }
  // A province someone is fighting over is not a safe place to raise a banner.
  if (await one(g.tx, `SELECT 1 FROM battles WHERE province_id = $1 AND status = 'pending'`, [province.id])) {
    throw conflict('PROVINCE_TAKEN', `${province.name} is under attack. Choose another starting province.`);
  }

  const nameTaken = await one(g.tx, 'SELECT 1 FROM clans WHERE lower(name) = lower($1) AND id IS DISTINCT FROM $2', [clanName, existing?.id ?? null]);
  if (nameTaken) throw conflict('CLAN_NAME_TAKEN', 'Another clan already bears that name');
  const colorTaken = await one(g.tx, `SELECT 1 FROM clans WHERE banner_color = $1 AND status = 'active' AND id IS DISTINCT FROM $2`, [
    input.bannerColor,
    existing?.id ?? null,
  ]);
  if (colorTaken) throw conflict('BANNER_TAKEN', 'Another clan already flies that colour');

  const protectedUntil = addMs(g.now, gameMs(g, WORLD.protectionHours * 60));
  let clanId: string;
  if (existing) {
    clanId = existing.id;
    await g.tx.query(
      `UPDATE clans SET name = $2, daimyo_name = $3, portrait = $4, banner_color = $5, banner_mon = $6,
                        status = 'active', capital_province_id = NULL, protected_until = $7, starving_ticks = 0
        WHERE id = $1`,
      [clanId, clanName, daimyoName, input.portrait, input.bannerColor, input.bannerMon, protectedUntil],
    );
    // A fresh start: the treasury is reset to the founding grant, and the ledger records the adjustment.
    const s = WORLD.startingResources;
    const before = await getResources(g.tx, clanId);
    await g.tx.query('UPDATE resources SET gold = $2, food = $3, wood = $4, stone = $5, iron = $6, updated_at = $7 WHERE clan_id = $1', [
      clanId,
      s.gold,
      s.food,
      s.wood,
      s.stone,
      s.iron,
      g.now,
    ]);
    for (const k of RESOURCE_KEYS) {
      if (s[k] === before[k]) continue;
      await g.tx.query(
        `INSERT INTO transactions (clan_id, resource, amount, balance_after, reason, ref_type, ref_id, created_at) VALUES ($1::uuid, $2, $3, $4, 'refounding_grant', 'clan', $1::text, $5)`,
        [clanId, k, s[k] - before[k], s[k], g.now],
      );
    }
  } else {
    const created = await one<{ id: string }>(
      g.tx,
      `INSERT INTO clans (player_id, name, daimyo_name, portrait, banner_color, banner_mon, protected_until, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [player.id, clanName, daimyoName, input.portrait, input.bannerColor, input.bannerMon, protectedUntil, g.now],
    );
    clanId = created!.id;
    // ECO-02: initial resource allocation.
    const s = WORLD.startingResources;
    await g.tx.query('INSERT INTO resources (clan_id, gold, food, wood, stone, iron, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      clanId,
      s.gold,
      s.food,
      s.wood,
      s.stone,
      s.iron,
      g.now,
    ]);
    for (const [resource, amount] of Object.entries(s)) {
      await g.tx.query(
        `INSERT INTO transactions (clan_id, resource, amount, balance_after, reason, ref_type, ref_id, created_at) VALUES ($1::uuid, $2, $3, $3, 'founding_grant', 'clan', $1::text, $4)`,
        [clanId, resource, amount, g.now],
      );
    }
    await initPillars(g.tx, clanId, 1);
  }

  // The local warriors swear to the new lord: their garrison is replaced by the Daimyo's retainers.
  const locals = await getGarrison(g.tx, province.id, null);
  if (locals) await deleteArmy(g.tx, locals.id);
  await transferProvince(g, province, clanId, 'founding', null, WORLD.startingLoyalty);
  const garrison = await ensureGarrison(g.tx, province.id, clanId);
  await setArmyUnits(g.tx, garrison, normalizeUnits(WORLD.startingGarrison));
  await g.tx.query('UPDATE clans SET capital_province_id = $2 WHERE id = $1', [clanId, province.id]);

  await chronicle(g, {
    type: 'founding',
    title: existing ? `The ${clanName} clan rises again in ${province.name}` : `The ${clanName} clan is founded in ${province.name}`,
    description: `On ${dayLabel(g.tick)}, ${daimyoName} raised a banner over ${province.name} and the local warriors swore to follow it.`,
    provinceId: province.id,
    clanId,
  });
  await audit(g, existing ? 'clan.refound' : 'clan.create', { type: 'clan', id: clanId }, clanId, { clanName, province: province.code, player: player.nickname });
  return clanId;
}
