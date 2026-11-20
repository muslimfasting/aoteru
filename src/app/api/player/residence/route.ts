import { actAsPlayer, playerRoute } from '@/server/http';
import { upgradeResidence } from '@/server/purse';
import { freshMe } from '@/server/respond';

export const dynamic = 'force-dynamic';

/** POST /api/player/residence — raise the caller's residence by one level, paid from their purse. */
export const POST = playerRoute({ mutation: true }, async (ctx) => {
  await actAsPlayer(ctx, (g) => upgradeResidence(g, ctx.session.player.id));
  return freshMe(ctx.req, ctx.now);
});
