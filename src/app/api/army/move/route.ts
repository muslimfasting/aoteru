import { pool } from '@/server/db';
import { act, clanRoute } from '@/server/http';
import { dispatchArmy } from '@/server/military';
import { marchBody } from '@/server/schemas';
import { buildMovement } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/army/move — march troops between provinces you hold. */
export const POST = clanRoute({ body: marchBody, mutation: true, permission: 'command' }, async (ctx) => {
  const armyId = await act(ctx, (g, clan, member) => dispatchArmy(g, clan, member.player_id, ctx.body.fromProvinceId, ctx.body.toProvinceId, ctx.body.units, 'move'), 'command');
  return { movement: await buildMovement(pool(), ctx.clan.id, armyId) };
});
