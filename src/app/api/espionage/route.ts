import { pool } from '@/server/db';
import { clanRoute } from '@/server/http';
import { buildEspionage } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/espionage — scouting operations and their reports. */
export const GET = clanRoute({}, async ({ clan, now }) => buildEspionage(pool(), clan, now));
