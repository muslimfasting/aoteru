import { pool } from '@/server/db';
import { act, clanRoute } from '@/server/http';
import { breakPact } from '@/server/pacts';
import { breakPactBody } from '@/server/schemas';
import { buildDiplomacy } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/diplomacy/break — end a treaty early. The clan that breaks its word pays for it in loyalty. */
export const POST = clanRoute({ body: breakPactBody, mutation: true, permission: 'diplomacy' }, async (ctx) => {
  await act(ctx, (g, clan) => breakPact(g, clan, ctx.body.pactId), 'diplomacy');
  return buildDiplomacy(pool(), ctx.clan, ctx.now);
});
