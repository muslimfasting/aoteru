import { postChat } from '@/server/chat';
import { pool, withWorldLock } from '@/server/db';
import { playerRoute } from '@/server/http';
import { chatBody } from '@/server/schemas';
import { buildChat, buildChatMessage } from '@/server/views';
import { gameContext } from '@/server/world';

export const dynamic = 'force-dynamic';

/** GET /api/chat — recent messages of the world channel. */
export const GET = playerRoute({ skipAdvance: true }, async () => buildChat(pool()));

/** POST /api/chat */
export const POST = playerRoute({ body: chatBody, mutation: true, skipAdvance: true }, async ({ body, session }) => {
  const id = await withWorldLock(async (tx) => {
    const g = await gameContext(tx, new Date(), session.player.id);
    return postChat(g, session.player.id, session.clan?.id ?? null, body.body);
  });
  return { message: await buildChatMessage(pool(), id) };
});
