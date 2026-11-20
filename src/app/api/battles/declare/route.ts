import { pool } from '@/server/db';
import { act, clanRoute } from '@/server/http';
import { dispatchArmy } from '@/server/military';
import { declareBattleBody } from '@/server/schemas';
import { buildMovement } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/battles/declare — send an army to attack an unclaimed province or one held by a clan you are at war with. */
export const POST = clanRoute({ body: declareBattleBody, mutation: true }, async (ctx) => {
  const armyId = await act(ctx, (g, clan) => dispatchArmy(g, clan, ctx.body.fromProvinceId, ctx.body.targetProvinceId, ctx.body.units, 'attack'));
  return { movement: await buildMovement(pool(), ctx.clan.id, armyId) };
});
