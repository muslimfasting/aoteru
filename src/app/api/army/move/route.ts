import { pool } from '@/server/db';
import { act, clanRoute } from '@/server/http';
import { dispatchArmy } from '@/server/military';
import { marchBody } from '@/server/schemas';
import { buildMovement } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/army/move — march troops between provinces you hold. */
export const POST = clanRoute({ body: marchBody, mutation: true }, async (ctx) => {
  const armyId = await act(ctx, (g, clan) => dispatchArmy(g, clan, ctx.body.fromProvinceId, ctx.body.toProvinceId, ctx.body.units, 'move'));
  return { movement: await buildMovement(pool(), ctx.clan.id, armyId) };
});
