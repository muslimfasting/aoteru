import { pool } from '@/server/db';
import { declareWar } from '@/server/diplomacy';
import { act, clanRoute } from '@/server/http';
import { declareWarBody } from '@/server/schemas';
import { buildDiplomacy } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/wars/declare */
export const POST = clanRoute({ body: declareWarBody, mutation: true, permission: 'diplomacy' }, async (ctx) => {
  await act(ctx, (g, clan) => declareWar(g, clan, ctx.body.clanId), 'diplomacy');
  return buildDiplomacy(pool(), ctx.clan, new Date());
});
