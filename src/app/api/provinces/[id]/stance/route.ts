import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { act, clanRoute } from '@/server/http';
import { stanceBody } from '@/server/schemas';
import { setStance } from '@/server/stance';
import { buildProvince } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/provinces/:id/stance — order how the garrison of an own province is to fight. */
export const POST = clanRoute({ body: stanceBody, mutation: true, permission: 'command' }, async (ctx) => {
  const provinceId = assertUuid(ctx.params.id, 'province id');
  await act(ctx, (g, clan) => setStance(g, clan, provinceId, ctx.body.stance), 'command');
  return buildProvince(pool(), ctx.viewer, provinceId, ctx.now);
});
