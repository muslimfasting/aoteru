import { WORLD } from '@/game/config';
import { one } from './db';
import { conflict, forbidden, notFound } from './errors';
import { spend } from './economy';
import { audit } from './notify';
import { awardClanXp } from './progression';
import { loadMods, type ClanRow, type ProvinceRow } from './rows';
import { addMs, gameMs, type G } from './world';

/** Hold a festival: gold and rice for loyalty and Culture experience. One per province per game day. */
export async function holdFestival(g: G, clan: ClanRow, provinceId: string): Promise<void> {
  const province = await one<ProvinceRow>(g.tx, 'SELECT * FROM provinces WHERE id = $1 FOR UPDATE', [provinceId]);
  if (!province) throw notFound('Province');
  if (province.owner_clan_id !== clan.id) throw forbidden('You do not hold this province');
  if (province.last_festival_at) {
    const ready = addMs(province.last_festival_at, gameMs(g, WORLD.festival.cooldownHours * 60));
    if (ready.getTime() > g.now.getTime()) throw conflict('FESTIVAL_COOLDOWN', `The people of ${province.name} are still recovering from the last festival`);
  }
  const mods = await loadMods(g.tx, clan.id);
  await spend(g, clan.id, WORLD.festival.cost, 'festival', { type: 'province', id: province.id });
  const gain = Math.round(WORLD.festival.loyalty * (1 + mods.festival));
  await g.tx.query('UPDATE provinces SET loyalty = LEAST(100, loyalty + $2), last_festival_at = $3, updated_at = $3 WHERE id = $1', [
    province.id,
    gain,
    g.now,
  ]);
  await awardClanXp(g, clan.id, 'culture', WORLD.festival.cultureXp, mods.xpGain);
  await audit(g, 'province.festival', { type: 'province', id: province.id }, clan.id, { province: province.code, loyalty: gain });
}
