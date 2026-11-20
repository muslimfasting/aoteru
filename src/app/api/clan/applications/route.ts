import { act, playerRoute } from '@/server/http';
import { respondApplication } from '@/server/members';
import { freshHub } from '@/server/respond';
import { applicationBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/applications — accept or reject an application. */
export const POST = playerRoute({ body: applicationBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => respondApplication(g, clan, me, ctx.body.applicationId, ctx.body.accept), { permission: 'manage_members' });
  return freshHub(ctx.req, ctx.now);
});
