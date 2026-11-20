import { actAsPlayer, playerRoute } from '@/server/http';
import { respondInvitation } from '@/server/members';
import { freshMe } from '@/server/respond';
import { invitationAnswerBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/invitations/respond — accept or decline an invitation to join a clan. */
export const POST = playerRoute({ body: invitationAnswerBody, mutation: true }, async (ctx) => {
  await actAsPlayer(ctx, (g) => respondInvitation(g, ctx.session.player, ctx.body.invitationId, ctx.body.accept));
  return freshMe(ctx.req, ctx.now);
});
