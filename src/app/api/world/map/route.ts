import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';
import { buildMap } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/world/map — provinces, owners, movements, battles, wars and the chronicle. */
export const GET = playerRoute({}, async ({ viewer, now }) => buildMap(pool(), viewer, now));
