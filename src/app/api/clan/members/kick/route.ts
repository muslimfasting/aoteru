import { act, playerRoute } from '@/server/http';
import { kickMember } from '@/server/members';
import { freshHub } from '@/server/respond';
import { memberBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/members/kick — remove a member of lower rank. */
export const POST = playerRoute({ body: memberBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => kickMember(g, clan, { ...member, nickname: me.nickname }, ctx.body.playerId), { permission: 'manage_members', allowFallen: true });
  return freshHub(ctx.req, ctx.now);
});
