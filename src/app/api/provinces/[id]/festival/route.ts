import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { act, clanRoute } from '@/server/http';
import { holdFestival } from '@/server/province';
import { buildProvince } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/provinces/:id/festival */
export const POST = clanRoute({ mutation: true }, async (ctx) => {
  const provinceId = assertUuid(ctx.params.id, 'province id');
  await act(ctx, (g, clan) => holdFestival(g, clan, provinceId));
  return buildProvince(pool(), ctx.viewer, provinceId, new Date());
});
