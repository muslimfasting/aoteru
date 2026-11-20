import { authenticate, readSessionToken } from '@/server/auth';
import { createClan } from '@/server/clans';
import { one, pool, withWorldLock } from '@/server/db';
import { GameError } from '@/server/errors';
import { playerRoute } from '@/server/http';
import type { ClanRow } from '@/server/rows';
import { createClanBody } from '@/server/schemas';
import { buildMe } from '@/server/views';
import { gameContext } from '@/server/world';

export const dynamic = 'force-dynamic';

/** POST /api/clans — found a clan (or rise again after a fall) in an unclaimed starting province. */
export const POST = playerRoute({ body: createClanBody, mutation: true }, async ({ body, session, req, now }) => {
  await withWorldLock(async (tx) => {
    const g = await gameContext(tx, new Date(), session.player.id);
    const existing = await one<ClanRow>(tx, 'SELECT * FROM clans WHERE player_id = $1 FOR UPDATE', [session.player.id]);
    await createClan(g, session.player, existing, body);
  });
  const fresh = await authenticate(pool(), readSessionToken(req.headers.get('cookie')));
  if (!fresh) throw new GameError('UNAUTHENTICATED', 'Please log in', 401);
  return buildMe(pool(), { player: fresh.player, clan: fresh.clan }, now);
});
