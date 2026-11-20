import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { act, clanRoute } from '@/server/http';
import { warRespondBody } from '@/server/schemas';
import * as council from '@/server/warcouncil';
import { buildWarCouncil } from '@/server/warviews';

export const dynamic = 'force-dynamic';

/** POST /api/war/plans/:id/respond — accept or decline a duty given to the caller. */
export const POST = clanRoute({ body: warRespondBody, mutation: true }, async (ctx) => {
  const planId = assertUuid(ctx.params.id, 'plan id');
  const me = { id: ctx.session.player.id, nickname: ctx.session.player.nickname };
  await act(ctx, async (g, clan) => {
    await council.respondDuty(g, clan, me, planId, ctx.body.duty, ctx.body.accept);
  });
  return buildWarCouncil(pool(), ctx.viewer, ctx.now);
});
