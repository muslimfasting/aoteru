import { pool } from '@/server/db';
import { executeScout } from '@/server/espionage';
import { act, clanRoute } from '@/server/http';
import { espionageBody } from '@/server/schemas';
import { buildEspionage } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/espionage/execute */
export const POST = clanRoute({ body: espionageBody, mutation: true, permission: 'espionage' }, async (ctx) => {
  await act(ctx, (g, clan) => executeScout(g, clan, ctx.body.provinceId), 'espionage');
  return buildEspionage(pool(), ctx.clan, new Date());
});
