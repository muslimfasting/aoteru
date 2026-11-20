import { PORTRAITS } from '@/game/config';
import { invalid } from '@/server/errors';
import { actAsPlayer, playerRoute } from '@/server/http';
import { setTrainingFocus } from '@/server/purse';
import { freshMe } from '@/server/respond';
import { profileBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/player/profile — change the caller's portrait or the pillar they train at home. */
export const POST = playerRoute({ body: profileBody, mutation: true }, async (ctx) => {
  await actAsPlayer(ctx, async (g) => {
    if (ctx.body.portrait !== undefined) {
      if (!PORTRAITS.some((p) => p.id === ctx.body.portrait)) throw invalid('Choose a portrait');
      await g.tx.query('UPDATE players SET portrait = $2 WHERE id = $1', [ctx.session.player.id, ctx.body.portrait]);
    }
    if (ctx.body.trainingFocus !== undefined) await setTrainingFocus(g, ctx.session.player.id, ctx.body.trainingFocus);
  });
  return freshMe(ctx.req, ctx.now);
});
