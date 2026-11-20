import { act, playerRoute } from '@/server/http';
import { invitePlayer } from '@/server/members';
import { freshHub } from '@/server/respond';
import { inviteBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/invitations — invite a player by nickname. */
export const POST = playerRoute({ body: inviteBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => invitePlayer(g, clan, me, ctx.body.nickname), { permission: 'manage_members' });
  return freshHub(ctx.req, ctx.now);
});
