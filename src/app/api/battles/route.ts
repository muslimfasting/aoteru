import { pool } from '@/server/db';
import { clanRoute } from '@/server/http';
import { buildBattles } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/battles — battle history of the viewer's clan. */
export const GET = clanRoute({}, async ({ clan }) => buildBattles(pool(), clan));
