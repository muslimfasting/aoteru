import { actAsPlayer, playerRoute } from '@/server/http';
import { leaveClan } from '@/server/members';
import { freshMe } from '@/server/respond';

export const dynamic = 'force-dynamic';

/** POST /api/clan/leave — leave the clan. The last member leaving dissolves it. */
export const POST = playerRoute({ mutation: true }, async (ctx) => {
  await actAsPlayer(ctx, (g) => leaveClan(g, ctx.session.player));
  return freshMe(ctx.req, ctx.now);
});
