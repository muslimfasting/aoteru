import { act, playerRoute } from '@/server/http';
import { setAnnouncement } from '@/server/members';
import { freshHub } from '@/server/respond';
import { announcementBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/announcement — post or clear the clan announcement. */
export const POST = playerRoute({ body: announcementBody, mutation: true }, async (ctx) => {
  const me = ctx.session.player;
  await act(ctx, (g, clan, member) => setAnnouncement(g, clan, me, ctx.body.body), { permission: 'manage_clan', allowFallen: true });
  return freshHub(ctx.req, ctx.now);
});
