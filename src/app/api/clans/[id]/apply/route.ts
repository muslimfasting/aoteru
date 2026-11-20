import { buildClanDirectory } from '@/server/clanviews';
import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { actAsPlayer, playerRoute } from '@/server/http';
import { applyToClan } from '@/server/members';
import { freshViewer } from '@/server/respond';
import { applyBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/clans/:id/apply — ask to join a clan that takes applications. */
export const POST = playerRoute({ body: applyBody, mutation: true }, async (ctx) => {
  const clanId = assertUuid(ctx.params.id, 'clan id');
  await actAsPlayer(ctx, (g) => applyToClan(g, ctx.session.player, clanId, ctx.body.message ?? ''));
  return buildClanDirectory(pool(), await freshViewer(ctx.req), ctx.now, { search: '', language: '', recruitment: '', sort: 'rank' });
});
