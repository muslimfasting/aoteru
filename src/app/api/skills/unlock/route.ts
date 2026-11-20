import { pool } from '@/server/db';
import { act, clanRoute } from '@/server/http';
import { getPillars, unlockSkill } from '@/server/progression';
import { unlockSkillBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/skills/unlock */
export const POST = clanRoute({ body: unlockSkillBody, mutation: true }, async (ctx) => {
  await act(ctx, (g, clan) => unlockSkill(g, clan.id, ctx.body.skillCode));
  return getPillars(pool(), ctx.clan.id);
});
