import { pool } from '@/server/db';
import { clanRoute } from '@/server/http';
import { buildDiplomacy } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/diplomacy — relations with every other clan. */
export const GET = clanRoute({}, async ({ clan, now }) => buildDiplomacy(pool(), clan, now));
