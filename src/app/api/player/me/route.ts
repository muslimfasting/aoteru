import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';
import { buildMe } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/player/me — profile, clan, resources and income. */
export const GET = playerRoute({}, async ({ viewer, now }) => buildMe(pool(), viewer, now));
