import { buildClanProfile } from '@/server/clanviews';
import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { playerRoute } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/clans/:id — public profile of a clan: banner, members, land. */
export const GET = playerRoute({}, async ({ viewer, params, now }) => buildClanProfile(pool(), viewer, assertUuid(params.id, 'clan id'), now));
