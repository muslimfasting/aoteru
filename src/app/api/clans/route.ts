import { authenticate, readSessionToken } from '@/server/auth';
import { createClan } from '@/server/clans';
import { pool } from '@/server/db';
import { GameError } from '@/server/errors';
import { actAsPlayer, playerRoute } from '@/server/http';
import { createClanBody } from '@/server/schemas';
import { buildClanDirectory } from '@/server/clanviews';
import { buildMe } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/clans?search=&language=&recruitment=&sort= — clan discovery. */
export const GET = playerRoute({}, async ({ viewer, query, now }) =>
  buildClanDirectory(pool(), viewer, now, {
    search: query.get('search') ?? '',
    language: query.get('language') ?? '',
    recruitment: query.get('recruitment') ?? '',
    sort: query.get('sort') ?? 'rank',
  }),
);

/** POST /api/clans — found a clan (or, as the leader of a fallen clan, its new seat) in an unclaimed starting province. */
export const POST = playerRoute({ body: createClanBody, mutation: true }, async (ctx) => {
  await actAsPlayer(ctx, (g) => createClan(g, ctx.session.player, ctx.body));
  const fresh = await authenticate(pool(), readSessionToken(ctx.req.headers.get('cookie')));
  if (!fresh) throw new GameError('UNAUTHENTICATED', 'Please log in', 401);
  return buildMe(pool(), { player: fresh.player, clan: fresh.clan, member: fresh.member }, ctx.now);
});
