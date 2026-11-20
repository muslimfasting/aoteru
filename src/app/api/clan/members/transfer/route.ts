import { act, playerRoute } from '@/server/http';
import { transferLeadership } from '@/server/members';
import { freshHub } from '@/server/respond';
import { memberBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/members/transfer — hand the leadership to another member (leader only). */
export const POST = playerRoute({ body: memberBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => transferLeadership(g, clan, { ...member, nickname: me.nickname }, ctx.body.playerId), { allowFallen: true });
  return freshHub(ctx.req, ctx.now);
});
