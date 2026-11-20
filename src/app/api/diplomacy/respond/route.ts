import { pool } from '@/server/db';
import { respondProposal } from '@/server/pacts';
import { act, clanRoute } from '@/server/http';
import { respondBody } from '@/server/schemas';
import { buildDiplomacy } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/diplomacy/respond */
export const POST = clanRoute({ body: respondBody, mutation: true, permission: 'diplomacy' }, async (ctx) => {
  await act(ctx, (g, clan) => respondProposal(g, clan, ctx.body.proposalId, ctx.body.accept), 'diplomacy');
  return buildDiplomacy(pool(), ctx.clan, new Date());
});
