import { act, playerRoute } from '@/server/http';
import { withdraw } from '@/server/purse';
import { freshHub } from '@/server/respond';
import { withdrawBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/withdraw — pay treasury resources out to a member's purse. */
export const POST = playerRoute({ body: withdrawBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => withdraw(g, clan, me, ctx.body.playerId, ctx.body.resources, ctx.body.note ?? ''), { permission: 'treasury' });
  return freshHub(ctx.req, ctx.now);
});
