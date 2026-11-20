import { pool } from '@/server/db';
import { actAsPlayer, playerRoute } from '@/server/http';
import { getPillars, unlockSkill } from '@/server/progression';
import { unlockSkillBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/skills/unlock — spend one of the player's own skill points. */
export const POST = playerRoute({ body: unlockSkillBody, mutation: true }, async (ctx) => {
  await actAsPlayer(ctx, (g) => unlockSkill(g, ctx.session.player.id, ctx.body.skillCode));
  return getPillars(pool(), ctx.session.player.id);
});
