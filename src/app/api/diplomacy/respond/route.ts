import { pool } from '@/server/db';
import { respondPeace } from '@/server/diplomacy';
import { act, clanRoute } from '@/server/http';
import { respondBody } from '@/server/schemas';
import { buildDiplomacy } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/diplomacy/respond */
export const POST = clanRoute({ body: respondBody, mutation: true }, async (ctx) => {
  await act(ctx, (g, clan) => respondPeace(g, clan, ctx.body.proposalId, ctx.body.accept));
  return buildDiplomacy(pool(), ctx.clan, new Date());
});
