import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';
import { buildLeaderboard } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/leaderboard */
export const GET = playerRoute({}, async ({ viewer, now }) => buildLeaderboard(pool(), viewer, now));
