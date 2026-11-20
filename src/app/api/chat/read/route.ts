import { buildChatThreads, markChatRead } from '@/server/clanviews';
import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';
import { chatReadBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/chat/read — mark the clan channel ('clan') or a private thread (the other player's id) read. */
export const POST = playerRoute({ body: chatReadBody, skipAdvance: true }, async ({ viewer, body }) => {
  await markChatRead(pool(), viewer, body.thread);
  return buildChatThreads(pool(), viewer);
});
