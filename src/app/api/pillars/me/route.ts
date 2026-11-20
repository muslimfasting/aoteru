import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';
import { getPillars } from '@/server/progression';

export const dynamic = 'force-dynamic';

/** GET /api/pillars/me — the player's own Five Pillars, plus what their clan's council lends everyone. */
export const GET = playerRoute({}, async ({ viewer }) => getPillars(pool(), viewer.player.id));
