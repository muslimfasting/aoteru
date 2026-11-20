import { act, playerRoute } from '@/server/http';
import { setPermissions } from '@/server/members';
import { freshHub } from '@/server/respond';
import { permissionsBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/permissions — what a role may do (leader only). */
export const POST = playerRoute({ body: permissionsBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => setPermissions(g, clan, { ...member, nickname: me.nickname }, ctx.body.role, ctx.body.permissions), { allowFallen: true });
  return freshHub(ctx.req, ctx.now);
});
