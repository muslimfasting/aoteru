import { assertUuid } from '@/server/errors';
import { actAsPlayer, playerRoute } from '@/server/http';
import { joinClan } from '@/server/members';
import { freshMe } from '@/server/respond';

export const dynamic = 'force-dynamic';

/** POST /api/clans/:id/join — join a clan with open recruitment. */
export const POST = playerRoute({ mutation: true }, async (ctx) => {
  const clanId = assertUuid(ctx.params.id, 'clan id');
  await actAsPlayer(ctx, (g) => joinClan(g, ctx.session.player, clanId));
  return freshMe(ctx.req, ctx.now);
});
