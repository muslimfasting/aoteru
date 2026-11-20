import { pool } from '@/server/db';
import { clanRoute } from '@/server/http';
import { buildArmy } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/army — garrisons, movements, recruitment queue, capacity and upkeep. */
export const GET = clanRoute({}, async ({ clan, now }) => buildArmy(pool(), clan, now));
