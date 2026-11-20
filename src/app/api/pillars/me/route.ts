import { pool } from '@/server/db';
import { clanRoute } from '@/server/http';
import { getPillars } from '@/server/progression';

export const dynamic = 'force-dynamic';

/** GET /api/pillars/me — Five Pillars levels, skills and active modifiers. */
export const GET = clanRoute({}, async ({ clan }) => getPillars(pool(), clan.id));
