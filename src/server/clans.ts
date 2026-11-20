import { CLAN_LANGUAGES, CLAN_RULES, RECRUITMENT_MODES } from '@/game/clan';
import { BANNER_COLORS, BANNER_MONS, NAME_RULES, PORTRAITS, RESOURCE_KEYS, WORLD, normalizeUnits } from '@/game/config';
import type { CreateClanRequest } from '@/game/api';
import { deleteArmy, ensureGarrison, getGarrison, setArmyUnits } from './armies';
import { one } from './db';
import { getResources } from './economy';
import { conflict, invalid, notFound } from './errors';
import { seedPermissions } from './members';
import { audit, chronicle, emit, playerRoom, WORLD_ROOM } from './notify';
import type { ClanRow, MemberRow, ProvinceRow } from './rows';
import { transferProvince } from './territory';
import { addMs, dayLabel, gameMs, type G } from './world';

function cleanName(value: string, rule: { min: number; max: number; pattern: RegExp }, what: string): string {
  const v = (value ?? '').trim().replace(/\s+/g, ' ');
  if (v.length < rule.min || v.length > rule.max) throw invalid(`${what} must be ${rule.min}-${rule.max} characters`);
  if (!rule.pattern.test(v)) throw invalid(`${what} may only use letters, numbers, spaces, hyphens and apostrophes`);
  return v;
}

/** A tag made from the clan name, for founders who did not choose one. */
async function freeTag(g: G, clanName: string): Promise<string> {
  const letters = clanName.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const base = (letters.length >= 2 ? letters : `${letters}CLAN`).slice(0, 4);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, 3)}${n}`;
    if (!(await one(g.tx, `SELECT 1 FROM clans WHERE upper(tag) = $1 AND status <> 'disbanded'`, [candidate]))) return candidate;
  }
  return base;
}

/**
 * Found a clan (change request §2.2): the founder becomes its leader, the clan
 * gets its banner, tag and recruitment settings, and the chosen starting
 * province becomes its headquarters. The province row is locked and must still
 * be an unclaimed start slot, so two clans can never be given the same land.
 * The leader of a fallen clan founds its new seat with the same call; the clan
 * keeps its members.
 */
export async function createClan(g: G, player: { id: string; nickname: string }, input: CreateClanRequest): Promise<string> {
  let existing: ClanRow | null = null;
  const member = await one<MemberRow>(g.tx, 'SELECT player_id, clan_id, role, joined_at, contribution FROM clan_members WHERE player_id = $1 FOR UPDATE', [
    player.id,
  ]);
  if (member) {
    const current = await one<ClanRow>(g.tx, 'SELECT * FROM clans WHERE id = $1 FOR UPDATE', [member.clan_id]);
    if (current?.status === 'active') throw conflict('ALREADY_IN_CLAN', 'You already belong to a nation. Leave it before founding your own.');
    if (member.role !== 'leader') {
      throw conflict('ALREADY_IN_CLAN', 'Your nation has fallen. Only its leader can found a new seat. Leave the nation to found your own.');
    }
    existing = current;
  }

  const clanName = cleanName(input.clanName, NAME_RULES.clanName, 'Nation name');
  const daimyoName = cleanName(input.daimyoName, NAME_RULES.daimyoName, 'Leader name');
  if (!PORTRAITS.some((p) => p.id === input.portrait)) throw invalid('Choose a portrait');
  if (!BANNER_COLORS.some((c) => c.id === input.bannerColor)) throw invalid('Choose a banner colour');
  if (!BANNER_MONS.some((m) => m.id === input.bannerMon)) throw invalid('Choose a banner crest');

  const rawTag = (input.tag ?? existing?.tag ?? (await freeTag(g, clanName))).trim().toUpperCase();
  if (rawTag.length < CLAN_RULES.tag.min || rawTag.length > CLAN_RULES.tag.max || !CLAN_RULES.tag.pattern.test(rawTag)) {
    throw invalid(`Nation tag must be ${CLAN_RULES.tag.min}-${CLAN_RULES.tag.max} letters or numbers`);
  }
  const description = (input.description ?? existing?.description ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CLAN_RULES.descriptionMax);
  const recruitment = input.recruitment ?? existing?.recruitment ?? 'application';
  if (!(RECRUITMENT_MODES as readonly string[]).includes(recruitment)) throw invalid('Unknown recruitment setting');
  const language = input.language ?? existing?.language ?? 'en';
  if (!CLAN_LANGUAGES.some((l) => l.id === language)) throw invalid('Unknown language');

  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 FOR UPDATE', [input.provinceId]);
  if (!province) throw notFound('Province');
  if (province.owner_clan_id || !province.is_start_slot) {
    throw conflict('PROVINCE_TAKEN', `${province.name} is no longer available. Choose another starting province.`);
  }
  // A province someone is fighting over is not a safe place to raise a banner.
  if (await one(g.tx, `SELECT 1 FROM battles WHERE province_id = $1 AND status = 'pending'`, [province.id])) {
    throw conflict('PROVINCE_TAKEN', `${province.name} is under attack. Choose another starting province.`);
  }

  const nameTaken = await one(g.tx, `SELECT 1 FROM clans WHERE lower(name) = lower($1) AND status <> 'disbanded' AND id IS DISTINCT FROM $2`, [
    clanName,
    existing?.id ?? null,
  ]);
  if (nameTaken) throw conflict('CLAN_NAME_TAKEN', 'Another nation already bears that name');
  const tagTaken = await one(g.tx, `SELECT 1 FROM clans WHERE upper(tag) = $1 AND status <> 'disbanded' AND id IS DISTINCT FROM $2`, [rawTag, existing?.id ?? null]);
  if (tagTaken) throw conflict('CLAN_TAG_TAKEN', 'Another nation already uses that tag');
  const colorTaken = await one(g.tx, `SELECT 1 FROM clans WHERE banner_color = $1 AND status = 'active' AND id IS DISTINCT FROM $2`, [
    input.bannerColor,
    existing?.id ?? null,
  ]);
  if (colorTaken) throw conflict('BANNER_TAKEN', 'Another nation already flies that colour');

  const protectedUntil = addMs(g.now, gameMs(g, WORLD.protectionHours * 60));
  let clanId: string;
  if (existing) {
    clanId = existing.id;
    await g.tx.query(
      `UPDATE clans SET name = $2, daimyo_name = $3, portrait = $4, banner_color = $5, banner_mon = $6,
                        status = 'active', capital_province_id = NULL, protected_until = $7, starving_ticks = 0,
                        tag = $8, description = $9, recruitment = $10, language = $11
        WHERE id = $1`,
      [clanId, clanName, daimyoName, input.portrait, input.bannerColor, input.bannerMon, protectedUntil, rawTag, description, recruitment, language],
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
      `INSERT INTO clans (player_id, name, daimyo_name, portrait, banner_color, banner_mon, protected_until, created_at,
                          tag, description, recruitment, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [player.id, clanName, daimyoName, input.portrait, input.bannerColor, input.bannerMon, protectedUntil, g.now, rawTag, description, recruitment, language],
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
    await g.tx.query(`INSERT INTO clan_members (player_id, clan_id, role, joined_at) VALUES ($1, $2, 'leader', $3)`, [player.id, clanId, g.now]);
    await seedPermissions(g.tx, clanId);
    await g.tx.query(`UPDATE clan_applications SET status = 'withdrawn', decided_at = $2 WHERE player_id = $1 AND status = 'pending'`, [player.id, g.now]);
    await g.tx.query(`UPDATE clan_invitations SET status = 'declined', decided_at = $2 WHERE player_id = $1 AND status = 'pending'`, [player.id, g.now]);
  }
  await g.tx.query('UPDATE players SET portrait = $2 WHERE id = $1', [player.id, input.portrait]);

  // The local warriors swear to the new lord: their garrison is replaced by the clan's retainers.
  const locals = await getGarrison(g.tx, province.id, null);
  if (locals) await deleteArmy(g.tx, locals.id);
  await transferProvince(g, province, clanId, 'founding', null, WORLD.startingLoyalty);
  const garrison = await ensureGarrison(g.tx, province.id, clanId);
  await setArmyUnits(g.tx, garrison, normalizeUnits(WORLD.startingGarrison));
  await g.tx.query('UPDATE clans SET capital_province_id = $2 WHERE id = $1', [clanId, province.id]);

  await chronicle(g, {
    type: 'founding',
    title: existing ? `The nation of ${clanName} rises again in ${province.name}` : `The nation of ${clanName} is founded in ${province.name}`,
    description: `On ${dayLabel(g.tick)}, ${daimyoName} raised a flag over ${province.name} and the local militia swore to follow it.`,
    provinceId: province.id,
    clanId,
  });
  await audit(g, existing ? 'clan.refound' : 'clan.create', { type: 'clan', id: clanId }, clanId, { clanName, province: province.code, player: player.nickname });
  await emit(g, playerRoom(player.id), 'clan:updated', { clanId, type: 'founded' });
  await emit(g, WORLD_ROOM, 'clan:directory', { clanId });
  return clanId;
}
