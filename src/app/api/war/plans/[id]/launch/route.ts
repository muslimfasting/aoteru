import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { act, clanRoute, hasPermission } from '@/server/http';
import * as council from '@/server/warcouncil';
import { buildWarCouncil } from '@/server/warviews';

export const dynamic = 'force-dynamic';

/** POST /api/war/plans/:id/launch — launch a ready plan (needs `command`, or being the plan's commander). */
export const POST = clanRoute({ mutation: true }, async (ctx) => {
  const planId = assertUuid(ctx.params.id, 'plan id');
  const me = { id: ctx.session.player.id, nickname: ctx.session.player.nickname };
  await act(ctx, async (g, clan, member) => {
    await council.launchPlan(g, clan, { ...member, nickname: me.nickname }, planId, await hasPermission(g.tx, member, 'command'));
  });
  return buildWarCouncil(pool(), ctx.viewer, ctx.now);
});
