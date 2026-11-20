import { pool } from '@/server/db';
import { proposePeace } from '@/server/diplomacy';
import { act, clanRoute } from '@/server/http';
import { proposePact } from '@/server/pacts';
import { proposeBody } from '@/server/schemas';
import { buildDiplomacy } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/diplomacy/propose */
export const POST = clanRoute({ body: proposeBody, mutation: true, permission: 'diplomacy' }, async (ctx) => {
  await act(ctx, (g, clan) => (ctx.body.type === 'peace' ? proposePeace(g, clan, ctx.body.clanId) : proposePact(g, clan, ctx.body.clanId, ctx.body.type)), 'diplomacy');
  return buildDiplomacy(pool(), ctx.clan, new Date());
});
