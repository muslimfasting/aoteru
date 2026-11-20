import { act, playerRoute } from '@/server/http';
import { setRole } from '@/server/members';
import { freshHub } from '@/server/respond';
import { setRoleBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/members/role — appoint a member to a role below the caller's own rank. */
export const POST = playerRoute({ body: setRoleBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => setRole(g, clan, { ...member, nickname: me.nickname }, ctx.body.playerId, ctx.body.role), { permission: 'manage_members', allowFallen: true });
  return freshHub(ctx.req, ctx.now);
});
