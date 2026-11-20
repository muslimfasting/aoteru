import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { clanRoute } from '@/server/http';
import { buildBattle } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/battles/:id — the full report, with stored inputs and seed. */
export const GET = clanRoute({}, async ({ clan, params }) => buildBattle(pool(), clan, assertUuid(params.id, 'battle id')));
