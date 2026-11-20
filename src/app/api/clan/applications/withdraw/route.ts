import { buildClanDirectory } from '@/server/clanviews';
import { pool } from '@/server/db';
import { actAsPlayer, playerRoute } from '@/server/http';
import { withdrawApplication } from '@/server/members';
import { withdrawApplicationBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clan/applications/withdraw — take back one's own application. */
export const POST = playerRoute({ body: withdrawApplicationBody, mutation: true }, async (ctx) => {
  await actAsPlayer(ctx, (g) => withdrawApplication(g, ctx.session.player.id, ctx.body.applicationId));
  return buildClanDirectory(pool(), ctx.viewer, ctx.now, { search: '', language: '', recruitment: '', sort: 'rank' });
});
