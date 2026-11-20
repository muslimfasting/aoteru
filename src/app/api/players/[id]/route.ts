import { buildPlayerProfile } from '@/server/clanviews';
import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { playerRoute } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/players/:id — a player's public profile. */
export const GET = playerRoute({ skipAdvance: true }, async ({ viewer, params }) => buildPlayerProfile(pool(), viewer, assertUuid(params.id, 'player id')));
