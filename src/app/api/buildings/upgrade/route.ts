import { startUpgrade } from '@/server/buildings';
import { pool } from '@/server/db';
import { act, clanRoute } from '@/server/http';
import { upgradeBody } from '@/server/schemas';
import { buildProvince } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/buildings/upgrade */
export const POST = clanRoute({ body: upgradeBody, mutation: true, permission: 'build' }, async (ctx) => {
  await act(ctx, (g, clan) => startUpgrade(g, clan.id, ctx.body.provinceId, ctx.body.type), 'build');
  return buildProvince(pool(), ctx.viewer, ctx.body.provinceId, new Date());
});
