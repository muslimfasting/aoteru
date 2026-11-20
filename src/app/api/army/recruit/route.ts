import { pool } from '@/server/db';
import { act, clanRoute } from '@/server/http';
import { recruit } from '@/server/military';
import { recruitBody } from '@/server/schemas';
import { buildProvince } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/army/recruit */
export const POST = clanRoute({ body: recruitBody, mutation: true, permission: 'recruit' }, async (ctx) => {
  await act(ctx, (g, clan) => recruit(g, clan.id, ctx.body.provinceId, ctx.body.unitType, ctx.body.count), 'recruit');
  return buildProvince(pool(), ctx.viewer, ctx.body.provinceId, new Date());
});
