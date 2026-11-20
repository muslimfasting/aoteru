import { act, playerRoute } from '@/server/http';
import { contribute } from '@/server/purse';
import { freshHub } from '@/server/respond';
import { contributeBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/contribute — pay resources from the caller's purse into the clan treasury. */
export const POST = playerRoute({ body: contributeBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => contribute(g, clan, member, ctx.body.resources, me.nickname), {});
  return freshHub(ctx.req, ctx.now);
});
