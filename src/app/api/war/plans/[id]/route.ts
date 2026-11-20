import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { act, clanRoute } from '@/server/http';
import { warPlanBody } from '@/server/schemas';
import * as council from '@/server/warcouncil';
import { buildWarCouncil } from '@/server/warviews';

export const dynamic = 'force-dynamic';

/** POST /api/war/plans/:id — change a plan that has not been launched. */
export const POST = clanRoute({ body: warPlanBody, mutation: true, permission: 'war_plans' }, async (ctx) => {
  const planId = assertUuid(ctx.params.id, 'plan id');
  const me = { id: ctx.session.player.id, nickname: ctx.session.player.nickname };
  await act(ctx, async (g, clan) => {
    await council.updatePlan(g, clan, me, planId, ctx.body);
  }, 'war_plans');
  return buildWarCouncil(pool(), ctx.viewer, ctx.now);
});
