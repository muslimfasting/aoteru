import { pool } from '@/server/db';
import { proposePeace } from '@/server/diplomacy';
import { act, clanRoute } from '@/server/http';
import { proposeBody } from '@/server/schemas';
import { buildDiplomacy } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/diplomacy/propose */
export const POST = clanRoute({ body: proposeBody, mutation: true, permission: 'diplomacy' }, async (ctx) => {
  await act(ctx, (g, clan) => proposePeace(g, clan, ctx.body.clanId), 'diplomacy');
  return buildDiplomacy(pool(), ctx.clan, new Date());
});
