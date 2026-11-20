import { postChat } from '@/server/chat';
import { buildChat, buildChatMessage } from '@/server/clanviews';
import { pool, withWorldLock } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { playerRoute } from '@/server/http';
import { chatBody } from '@/server/schemas';
import { gameContext } from '@/server/world';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chat?channel=world|clan|dm[&with=<playerId>] — recent messages of the
 * world channel, the caller's clan channel, or a private thread.
 */
export const GET = playerRoute({ skipAdvance: true }, async ({ viewer, query }) => {
  const raw = query.get('channel');
  const channel = raw === 'clan' || raw === 'dm' ? raw : 'world';
  const withId = channel === 'dm' ? assertUuid(query.get('with') ?? '', 'player id') : null;
  return buildChat(pool(), viewer, channel, withId);
});

/** POST /api/chat */
export const POST = playerRoute({ body: chatBody, mutation: true, skipAdvance: true }, async ({ body, session, viewer }) => {
  const id = await withWorldLock(async (tx) => {
    const g = await gameContext(tx, new Date(), session.player.id);
    return postChat(g, session.player.id, session.member, body);
  });
  return { message: await buildChatMessage(pool(), viewer, id) };
});
