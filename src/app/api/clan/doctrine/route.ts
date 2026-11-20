import { act, playerRoute } from '@/server/http';
import { setDoctrine } from '@/server/members';
import { freshHub } from '@/server/respond';
import { doctrineBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/doctrine — choose the clan's doctrine (leader only). */
export const POST = playerRoute({ body: doctrineBody, mutation: true }, async (ctx) => {
  await act(ctx, (g, clan, member) => setDoctrine(g, clan, { ...member, nickname: ctx.session.player.nickname }, ctx.body.doctrine));
  return freshHub(ctx.req, ctx.now);
});
