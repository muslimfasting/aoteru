import { act, playerRoute } from '@/server/http';
import { revokeInvitation } from '@/server/members';
import { freshHub } from '@/server/respond';
import { invitationBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/invitations/revoke — take back an invitation. */
export const POST = playerRoute({ body: invitationBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => revokeInvitation(g, clan, ctx.body.invitationId), { permission: 'manage_members', allowFallen: true });
  return freshHub(ctx.req, ctx.now);
});
