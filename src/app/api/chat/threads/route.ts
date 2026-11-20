import { buildChatThreads } from '@/server/clanviews';
import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/chat/threads — the caller's private conversations and unread counts. */
export const GET = playerRoute({ skipAdvance: true }, async ({ viewer }) => buildChatThreads(pool(), viewer));
